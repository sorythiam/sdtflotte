// Fonction « billing » : abonnement Yoon Fleet en libre-service.
//   checkout : calcule le montant (côté serveur, il fait foi), crée le paiement et la page PayDunya
//   confirm  : revérifie un paiement auprès de PayDunya et active la formule s'il est payé
//   webhook  : notification (IPN) de PayDunya, revérifiée de la même façon
// Rien n'est jamais validé sur la seule parole du navigateur ou de la notification :
// c'est l'appel « confirm » de PayDunya, avec nos clés, qui fait foi.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { checkoutQuote, type SubscriptionPayment } from '../../../src/domain/saas';
import { PLAN_INFO } from '../../../src/domain/pricing';
import type { Plan } from '../../../src/domain/types';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const env = (k: string) => Deno.env.get(k) ?? '';
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const PD_KEYS = { master: env('PAYDUNYA_MASTER_KEY'), private: env('PAYDUNYA_PRIVATE_KEY'), token: env('PAYDUNYA_TOKEN') };
const PD_LIVE = env('PAYDUNYA_MODE') === 'live';
const PD_BASE = PD_LIVE ? 'https://app.paydunya.com/api/v1' : 'https://app.paydunya.com/sandbox-api/v1';
const APP_URL = (env('APP_URL') || 'https://yoonfleet.vercel.app').replace(/\/$/, '');
const VAT_RATE = Number(env('SAAS_VAT_RATE') || '0');
const ALLOWED_ORIGINS = [APP_URL, 'http://localhost:5173', 'http://localhost:4173'];

const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : APP_URL,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });

const pdHeaders = () => ({
  'Content-Type': 'application/json',
  'PAYDUNYA-MASTER-KEY': PD_KEYS.master,
  'PAYDUNYA-PRIVATE-KEY': PD_KEYS.private,
  'PAYDUNYA-TOKEN': PD_KEYS.token,
});
const pdReady = () => !!(PD_KEYS.master && PD_KEYS.private && PD_KEYS.token);

/** Utilisateur connecté et son entreprise ; seul l'administrateur paie. */
async function caller(req: Request): Promise<{ userId: string; email: string; orgId: string; role: string }> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, 'Session expirée, reconnectez-vous.');
  const { data: m } = await admin.from('memberships').select('org_id, role').eq('user_id', data.user.id).limit(1).maybeSingle();
  if (!m) throw new HttpError(403, 'Aucune entreprise rattachée à ce compte.');
  return { userId: data.user.id, email: data.user.email ?? '', orgId: m.org_id as string, role: m.role as string };
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const toApp = (r: Record<string, unknown>): SubscriptionPayment => ({
  id: r.id as string, plan: r.plan as Plan, vehicles: r.vehicles as number, billing: r.billing as 'annuel' | 'mensuel',
  baseHt: r.base_ht as number, creditHt: r.credit_ht as number, amountHt: r.amount_ht as number, vatRate: Number(r.vat_rate),
  vat: r.vat as number, amountTtc: r.amount_ttc as number, provider: r.provider as string, status: r.status as SubscriptionPayment['status'],
  periodStart: (r.period_start as string) ?? null, periodEnd: (r.period_end as string) ?? null, invoiceNumber: (r.invoice_number as string) ?? null,
  paidAt: (r.paid_at as string) ?? null, createdBy: (r.created_by as string) ?? null, createdAt: r.created_at as string,
});
const publicRow = (r: Record<string, unknown>) => {
  const { provider_ref: _ref, raw: _raw, org_id: _org, ...rest } = r;
  return rest;
};

async function lastPaid(orgId: string) {
  const { data } = await admin.from('subscription_payments').select('*').eq('org_id', orgId).eq('status', 'payee')
    .order('paid_at', { ascending: false }).limit(1).maybeSingle();
  return data ? toApp(data) : null;
}

async function checkout(req: Request, body: Record<string, unknown>) {
  const who = await caller(req);
  if (who.role !== 'admin') throw new HttpError(403, 'Seul l’administrateur du compte peut payer l’abonnement.');
  if (!pdReady()) throw new HttpError(503, 'Le paiement en ligne n’est pas encore activé. Envoyez une demande d’activation, nous vous recontactons.');
  const plan = body.plan as Plan;
  if (!PLAN_INFO[plan]) throw new HttpError(400, 'Formule inconnue.');
  const billing = body.billing === 'mensuel' ? 'mensuel' : 'annuel';
  const vehicles = Math.floor(Number(body.vehicles));
  const { data: org } = await admin.from('organizations').select('id, name, paid_until').eq('id', who.orgId).single();
  const q = checkoutQuote({ plan, vehicles, billing }, { paidUntil: org?.paid_until ?? null, last: await lastPaid(who.orgId) }, new Date(), VAT_RATE);
  if (q.error) throw new HttpError(400, q.error);

  const { data: pay, error } = await admin.from('subscription_payments').insert({
    org_id: who.orgId, plan, vehicles: q.vehicles, billing, base_ht: q.baseHt, credit_ht: q.creditHt, amount_ht: q.amountHt,
    vat_rate: q.vatRate, vat: q.vat, amount_ttc: q.amountTtc, provider: 'paydunya', status: 'en_attente', created_by: who.email,
  }).select('*').single();
  if (error || !pay) throw new HttpError(500, 'Impossible de préparer le paiement.');

  const label = `Yoon Fleet ${PLAN_INFO[plan].label}, ${q.vehicles} véhicules, ${billing === 'annuel' ? '1 an' : '1 mois'}`;
  const back = `${APP_URL}/abonnement/retour?paiement=${pay.id}`;
  const res = await fetch(`${PD_BASE}/checkout-invoice/create`, {
    method: 'POST',
    headers: pdHeaders(),
    body: JSON.stringify({
      invoice: {
        total_amount: q.amountTtc,
        description: `${label} — ${org?.name ?? ''}`.slice(0, 200),
        items: { item_0: { name: label, quantity: 1, unit_price: String(q.amountTtc), total_price: String(q.amountTtc) } },
      },
      store: { name: 'Yoon Fleet', website_url: APP_URL },
      custom_data: { payment_id: pay.id, org_id: who.orgId },
      actions: { return_url: back, cancel_url: `${back}&annule=1`, callback_url: `${env('SUPABASE_URL')}/functions/v1/billing?ipn=1` },
    }),
  });
  const pd = (await res.json().catch(() => ({}))) as { response_code?: string; response_text?: string; token?: string };
  if (pd.response_code !== '00' || !pd.token || !pd.response_text?.startsWith('http')) {
    await admin.from('subscription_payments').update({ status: 'echouee', raw: pd }).eq('id', pay.id);
    throw new HttpError(502, 'Le service de paiement a refusé la demande. Réessayez dans un instant.');
  }
  await admin.from('subscription_payments').update({ provider_ref: pd.token }).eq('id', pay.id);
  return { paymentId: pay.id, url: pd.response_text };
}

/** Demande l'état à PayDunya et met le paiement à jour. */
async function settle(payId: string) {
  const { data: pay } = await admin.from('subscription_payments').select('*').eq('id', payId).maybeSingle();
  if (!pay) throw new HttpError(404, 'Paiement introuvable.');
  if (pay.status !== 'en_attente' || !pay.provider_ref || pay.provider !== 'paydunya') return pay;
  const res = await fetch(`${PD_BASE}/checkout-invoice/confirm/${encodeURIComponent(pay.provider_ref)}`, { headers: pdHeaders() });
  const pd = (await res.json().catch(() => ({}))) as { response_code?: string; status?: string; invoice?: { total_amount?: number | string }; custom_data?: { payment_id?: string } };
  const status = String(pd.status ?? '').toLowerCase();
  if (status === 'completed') {
    const paid = Number(pd.invoice?.total_amount);
    if (pd.custom_data?.payment_id && pd.custom_data.payment_id !== pay.id) throw new HttpError(409, 'Paiement incohérent.');
    if (Number.isFinite(paid) && paid < pay.amount_ttc) {
      await admin.from('subscription_payments').update({ status: 'echouee', raw: pd }).eq('id', pay.id);
      throw new HttpError(409, 'Montant reçu différent du montant attendu. Contactez Yoon Fleet.');
    }
    const { data: done, error } = await admin.rpc('activate_subscription', { p_id: pay.id, p_raw: pd });
    if (error) throw new HttpError(500, 'Paiement reçu, mais l’activation a échoué. Contactez Yoon Fleet.');
    return done;
  }
  if (status === 'cancelled' || status === 'failed') {
    const { data } = await admin.from('subscription_payments').update({ status: status === 'cancelled' ? 'annulee' : 'echouee', raw: pd }).eq('id', pay.id).select('*').single();
    return data ?? pay;
  }
  return pay; // pending : le client n'a pas encore validé sur son téléphone
}

async function confirm(req: Request, body: Record<string, unknown>) {
  const who = await caller(req);
  const id = String(body.paymentId ?? '');
  const { data: pay } = await admin.from('subscription_payments').select('org_id').eq('id', id).maybeSingle();
  if (!pay || pay.org_id !== who.orgId) throw new HttpError(404, 'Paiement introuvable.');
  return publicRow(await settle(id));
}

/** IPN PayDunya : formulaire « data[invoice][token]=… » ou JSON. On ne garde que le jeton. */
async function webhook(req: Request) {
  const text = await req.text();
  let token = '';
  try {
    const j = JSON.parse(text);
    token = j?.data?.invoice?.token ?? j?.invoice?.token ?? j?.token ?? '';
  } catch {
    const f = new URLSearchParams(text);
    token = f.get('data[invoice][token]') ?? f.get('invoice_token') ?? f.get('token') ?? '';
  }
  if (!token) return;
  const { data: pay } = await admin.from('subscription_payments').select('id').eq('provider', 'paydunya').eq('provider_ref', token).maybeSingle();
  if (pay) await settle(pay.id as string);
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'Méthode non permise' }, 405, origin);
  try {
    if (new URL(req.url).searchParams.get('ipn') === '1') {
      await webhook(req);
      return json({ ok: true }, 200, origin);
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action === 'checkout') return json(await checkout(req, body), 200, origin);
    if (body.action === 'confirm') return json(await confirm(req, body), 200, origin);
    return json({ error: 'Action inconnue' }, 400, origin);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : 'Erreur' }, status, origin);
  }
});
