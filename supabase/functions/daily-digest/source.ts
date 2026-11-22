// Fonction Supabase « daily-digest » : envoie chaque matin le récapitulatif des alertes.
// Source TypeScript ; index.js est produit par `npm run build:functions` (esbuild),
// pour réutiliser exactement les mêmes règles que l'application (src/domain/alerts.ts).
//
// Appel : POST, en-tête x-cron-secret (secret rangé dans le coffre Supabase).
// Corps facultatif : { "dryRun": true, "orgId": "..." }.
// Sans RESEND_API_KEY, la fonction calcule tout mais n'envoie rien (simulation).

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { alertsFor, buildAlerts, COUNTRY_UTC_OFFSET, defaultDailyDigest, digestEmail, localDay } from '../../../src/domain/alerts';
import type { Role } from '../../../src/domain/types';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (req: Request) => Promise<Response>): void };

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
// deno-lint-ignore no-explicit-any
const toApp = (rows: any[] | null) => (rows ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v])));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST attendu' }, 405);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data: ok } = await sb.rpc('daily_digest_secret_ok', { p: req.headers.get('x-cron-secret') ?? '' });
  if (ok !== true) return json({ error: 'Non autorisé' }, 401);

  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean; orgId?: string };
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const dryRun = body.dryRun === true || !apiKey;
  const from = Deno.env.get('ALERTS_FROM') ?? 'Yoon Fleet <onboarding@resend.dev>';
  const appUrl = Deno.env.get('APP_URL') ?? 'https://yoonfleet.vercel.app';
  const now = new Date();

  let q = sb.from('organizations').select('id, name, country');
  if (body.orgId) q = q.eq('id', body.orgId);
  const { data: orgs, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const report: unknown[] = [];
  for (const org of orgs ?? []) {
    const { data: members } = await sb.from('memberships').select('user_id, email, role, daily_digest').eq('org_id', org.id);
    const recipients = (members ?? []).filter((m) => m.email && (m.daily_digest ?? defaultDailyDigest(m.role as Role)));
    if (recipients.length === 0) continue;

    const since = new Date(now.getTime() - 180 * 86400000).toISOString();
    const [vehicles, clients, reservations, payments, maintenances, requests, plans, invoices] = await Promise.all([
      sb.from('vehicles').select('*').eq('org_id', org.id),
      sb.from('clients').select('*').eq('org_id', org.id),
      sb.from('reservations').select('*').eq('org_id', org.id).or(`status.in.(reservee,en_cours),and(status.eq.terminee,end.gte.${since})`),
      sb.from('payments').select('*').eq('org_id', org.id),
      sb.from('maintenances').select('*').eq('org_id', org.id).gte('start', new Date(now.getTime() - 2 * 86400000).toISOString()),
      sb.from('booking_requests').select('id, status, name, category, start, end, created_at').eq('org_id', org.id).eq('status', 'nouvelle'),
      sb.from('maintenance_plans').select('*').eq('org_id', org.id).eq('active', true),
      sb.from('invoices').select('reservation_id, total_ttc').eq('org_id', org.id),
    ]);
    const failed = [vehicles, clients, reservations, payments, maintenances, requests, plans, invoices].find((r) => r.error);
    if (failed) {
      report.push({ org: org.name, error: failed.error!.message });
      continue;
    }

    const offset = COUNTRY_UTC_OFFSET[org.country] ?? 0;
    const all = buildAlerts(
      {
        vehicles: toApp(vehicles.data) as never,
        clients: toApp(clients.data) as never,
        reservations: toApp(reservations.data) as never,
        payments: toApp(payments.data) as never,
        maintenances: toApp(maintenances.data) as never,
        bookingRequests: toApp(requests.data) as never,
        plans: toApp(plans.data) as never,
        invoices: toApp(invoices.data) as never,
      },
      now,
      offset,
    );
    const day = new Date(localDay(now, offset).start + offset * 60000).toISOString().slice(0, 10);
    const dateLabel = day.split('-').reverse().join('/');

    for (const m of recipients) {
      const mail = digestEmail(org.name, alertsFor(all, m.role as Role), appUrl, dateLabel);
      if (!mail) {
        report.push({ org: org.name, to: m.email, skipped: 'rien à signaler' });
        continue;
      }
      if (dryRun) {
        report.push({ org: org.name, to: m.email, subject: mail.subject, simulated: true });
        continue;
      }
      // Un seul envoi par personne et par jour, même si la tâche est relancée.
      const { data: claimed } = await sb
        .from('digest_log')
        .upsert({ org_id: org.id, user_id: m.user_id, sent_on: day, alerts: alertsFor(all, m.role as Role).length }, { onConflict: 'org_id,user_id,sent_on', ignoreDuplicates: true })
        .select('user_id');
      if (!claimed?.length) {
        report.push({ org: org.name, to: m.email, skipped: 'déjà envoyé aujourd’hui' });
        continue;
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [m.email], subject: mail.subject, html: mail.html, text: mail.text }),
      });
      const out = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) {
        await sb.from('digest_log').delete().match({ org_id: org.id, user_id: m.user_id, sent_on: day });
        report.push({ org: org.name, to: m.email, error: out.message ?? `HTTP ${res.status}` });
        continue;
      }
      await sb.from('digest_log').update({ provider_id: out.id ?? null }).match({ org_id: org.id, user_id: m.user_id, sent_on: day });
      report.push({ org: org.name, to: m.email, subject: mail.subject, sent: true });
    }
  }

  return json({ dryRun, at: now.toISOString(), results: report });
});
