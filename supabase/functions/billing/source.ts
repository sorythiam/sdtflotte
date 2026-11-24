// Fonction « billing » : abonnement Yoon Fleet en libre-service.
//   checkout : calcule le montant (côté serveur, il fait foi), crée le paiement et la page PayDunya
//   confirm  : revérifie un paiement auprès de PayDunya et active la formule s'il est payé
//   webhook  : notification (IPN) de PayDunya, revérifiée de la même façon
// Rien n'est jamais validé sur la seule parole du navigateur ou de la notification :
// c'est l'appel « confirm » de PayDunya, avec nos clés, qui fait foi.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { checkoutQuote, SAAS_VAT_RATE, type SubscriptionPayment } from '../../../src/domain/saas';
import { PLAN_INFO } from '../../../src/domain/pricing';
import type { Plan } from '../../../src/domain/types';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const env = (k: string) => Deno.env.get(k) ?? '';
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const PD_KEYS = { master: env('PAYDUNYA_MASTER_KEY'), private: env('PAYDUNYA_PRIVATE_KEY'), token: env('PAYDUNYA_TOKEN') };
const PD_LIVE = env('PAYDUNYA_MODE') === 'live';
const PD_BASE = PD_LIVE ? 'https://app.paydunya.com/api/v1' : 'https://app.paydunya.com/sandbox-api/v1';
const BX = { api: env('BICTORYS_API_KEY'), priv: env('BICTORYS_PRIVATE_KEY'), hook: env('BICTORYS_WEBHOOK_SECRET') };
const BX_BASE = env('BICTORYS_MODE') === 'live' ? 'https://api.bictorys.com' : 'https://api.test.bictorys.com';
const bxReady = () => !!BX.api;
/** Prestataire des nouveaux paiements : Bictorys par défaut, PayDunya si seul configuré. */
const PROVIDER = (env('BILLING_PROVIDER') || (bxReady() ? 'bictorys' : 'paydunya')) as 'bictorys' | 'paydunya';
const providerReady = () => (PROVIDER === 'bictorys' ? bxReady() : pdReady());
const APP_URL = (env('APP_URL') || 'https://yoonfleet.vercel.app').replace(/\/$/, '');
const VAT_RATE = Number(env('SAAS_VAT_RATE') || SAAS_VAT_RATE);
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
  if (!providerReady()) throw new HttpError(503, 'Le paiement en ligne n’est pas encore activé. Envoyez une demande d’activation, nous vous recontactons.');
  const plan = body.plan as Plan;
  if (!PLAN_INFO[plan]) throw new HttpError(400, 'Formule inconnue.');
  const billing = body.billing === 'mensuel' ? 'mensuel' : 'annuel';
  const vehicles = Math.floor(Number(body.vehicles));
  const { data: org } = await admin.from('organizations').select('id, name, country, paid_until, contract').eq('id', who.orgId).single();
  const q = checkoutQuote({ plan, vehicles, billing }, { paidUntil: org?.paid_until ?? null, last: await lastPaid(who.orgId) }, new Date(), VAT_RATE);
  if (q.error) throw new HttpError(400, q.error);

  const { data: pay, error } = await admin.from('subscription_payments').insert({
    org_id: who.orgId, plan, vehicles: q.vehicles, billing, base_ht: q.baseHt, credit_ht: q.creditHt, amount_ht: q.amountHt,
    vat_rate: q.vatRate, vat: q.vat, amount_ttc: q.amountTtc, provider: PROVIDER, status: 'en_attente', created_by: who.email,
  }).select('*').single();
  if (error || !pay) throw new HttpError(500, 'Impossible de préparer le paiement.');

  const label = `Yoon Fleet ${PLAN_INFO[plan].label}, ${q.vehicles} véhicules, ${billing === 'annuel' ? '1 an' : '1 mois'}`;
  const back = `${APP_URL}/abonnement/retour?paiement=${pay.id}`;
  try {
    const { ref, url } = PROVIDER === 'bictorys'
      ? await bictorysCreate(pay.id as string, q.amountTtc, back, { name: (org?.contract as { legalName?: string } | null)?.legalName || org?.name || '', email: who.email, phone: (org?.contract as { phone?: string } | null)?.phone ?? '', country: org?.country ?? 'SN' })
      : await paydunyaCreate(pay.id as string, q.amountTtc, back, `${label} — ${org?.name ?? ''}`, label, who.orgId);
    await admin.from('subscription_payments').update({ provider_ref: ref }).eq('id', pay.id);
    return { paymentId: pay.id, url };
  } catch (e) {
    await admin.from('subscription_payments').update({ status: 'echouee', raw: { error: String(e) } }).eq('id', pay.id);
    throw new HttpError(502, 'Le service de paiement a refusé la demande. Réessayez dans un instant.');
  }
}

// ---------------------------------------------------------------- PayDunya
async function paydunyaCreate(payId: string, amount: number, back: string, description: string, label: string, orgId: string) {
  const res = await fetch(`${PD_BASE}/checkout-invoice/create`, {
    method: 'POST',
    headers: pdHeaders(),
    body: JSON.stringify({
      invoice: { total_amount: amount, description: description.slice(0, 200), items: { item_0: { name: label, quantity: 1, unit_price: String(amount), total_price: String(amount) } } },
      store: { name: 'Yoon Fleet', website_url: APP_URL },
      custom_data: { payment_id: payId, org_id: orgId },
      actions: { return_url: back, cancel_url: `${back}&annule=1`, callback_url: `${env('SUPABASE_URL')}/functions/v1/billing?ipn=1` },
    }),
  });
  const pd = (await res.json().catch(() => ({}))) as { response_code?: string; response_text?: string; token?: string };
  if (pd.response_code !== '00' || !pd.token || !pd.response_text?.startsWith('http')) throw new Error(`PayDunya ${JSON.stringify(pd).slice(0, 300)}`);
  return { ref: pd.token, url: pd.response_text };
}

type Outcome = { state: 'completed' | 'pending' | 'cancelled' | 'failed'; amount: number | null; reference: string | null; raw: unknown };

async function paydunyaCheck(token: string): Promise<Outcome> {
  const res = await fetch(`${PD_BASE}/checkout-invoice/confirm/${encodeURIComponent(token)}`, { headers: pdHeaders() });
  const pd = (await res.json().catch(() => ({}))) as { status?: string; invoice?: { total_amount?: number | string }; custom_data?: { payment_id?: string } };
  const st = String(pd.status ?? '').toLowerCase();
  const amount = Number(pd.invoice?.total_amount);
  return {
    state: st === 'completed' ? 'completed' : st === 'cancelled' ? 'cancelled' : st === 'failed' ? 'failed' : 'pending',
    amount: Number.isFinite(amount) ? amount : null,
    reference: pd.custom_data?.payment_id ?? null,
    raw: pd,
  };
}

// ---------------------------------------------------------------- Bictorys
const BX_COUNTRIES = ['SN', 'CI', 'BF', 'ML', 'TG', 'BJ'];
const e164 = (phone: string, country: string) => {
  const d = phone.replace(/\D/g, '');
  if (!d) return undefined;
  if (phone.trim().startsWith('+') || d.startsWith('00')) return `+${d.replace(/^00/, '')}`;
  const cc: Record<string, string> = { SN: '221', CI: '225', BF: '226', ML: '223', TG: '228', BJ: '229' };
  return `+${cc[country] ?? '221'}${d}`;
};

async function bictorysCreate(payId: string, amount: number, back: string, c: { name: string; email: string; phone: string; country: string }) {
  const country = BX_COUNTRIES.includes(c.country) ? c.country : 'SN';
  const res = await fetch(`${BX_BASE}/pay/v1/charges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': BX.api },
    body: JSON.stringify({
      amount,
      currency: 'XOF',
      country,
      paymentReference: payId,
      successRedirectUrl: back,
      ErrorRedirectUrl: `${back}&annule=1`,
      customerObject: { name: c.name.slice(0, 120) || 'Client Yoon Fleet', email: c.email || undefined, phone: e164(c.phone, country), country },
    }),
  });
  // Page hébergée : réponse 202 « CheckoutLinkObject » { link, chargeId, opToken } ;
  // l'API directe renvoie plutôt { transactionId, redirectUrl }.
  const j = (await res.json().catch(() => ({}))) as { transactionId?: string; chargeId?: string; redirectUrl?: string; link?: string };
  const url = j.link || j.redirectUrl;
  const ref = j.chargeId || j.transactionId;
  if (!res.ok || !ref || !url?.startsWith('http')) throw new Error(`Bictorys ${res.status} ${JSON.stringify(j).slice(0, 300)}`);
  return { ref, url };
}

async function bictorysCheck(transactionId: string): Promise<Outcome> {
  const url = `${BX_BASE}/pay/v1/transactions/${encodeURIComponent(transactionId)}/status`;
  let res = await fetch(url, { headers: { 'X-Api-Key': BX.api } });
  if ((res.status === 401 || res.status === 403) && BX.priv) res = await fetch(url, { headers: { 'X-API-Key': BX.priv } });
  const j = (await res.json().catch(() => ({}))) as { status?: string; amount?: number | string; paymentReference?: string };
  const st = String(j.status ?? '').toLowerCase();
  const amount = Number(j.amount);
  return {
    state: st === 'succeeded' || st === 'authorized' ? 'completed' : st === 'cancelled' || st === 'expired' ? 'cancelled' : st === 'failed' || st === 'reversed' ? 'failed' : 'pending',
    // La réponse courte du statut peut omettre le montant : on ne le contrôle que s'il est donné.
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    reference: j.paymentReference ?? null,
    raw: { httpStatus: res.status, ...j },
  };
}

/** Webhook Bictorys : signature HMAC si activée, sinon clé secrète en en-tête. */
async function bictorysAuthentic(req: Request, raw: string): Promise<boolean> {
  if (!BX.hook) return false;
  const sig = req.headers.get('X-Webhook-Signature');
  const ts = req.headers.get('X-Webhook-Timestamp');
  if (sig && ts) {
    const t = Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000;
    if (!Number.isFinite(t) || Math.abs(Date.now() - t) > 5 * 60 * 1000) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(BX.hook), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${raw}`)));
    const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
    return safeEqual(hex, sig.replace(/^sha256=/, '').toLowerCase());
  }
  return safeEqual(req.headers.get('X-Secret-Key') ?? '', BX.hook);
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Demande l'état au prestataire et met le paiement à jour. Seul cet appel, avec nos clés, fait foi. */
async function settle(payId: string) {
  const { data: pay } = await admin.from('subscription_payments').select('*').eq('id', payId).maybeSingle();
  if (!pay) throw new HttpError(404, 'Paiement introuvable.');
  if (pay.status !== 'en_attente' || !pay.provider_ref) return pay;
  let o: Outcome;
  if (pay.provider === 'bictorys') o = await bictorysCheck(pay.provider_ref);
  else if (pay.provider === 'paydunya') o = await paydunyaCheck(pay.provider_ref);
  else return pay;
  if (o.state === 'completed') {
    if (o.reference && o.reference !== pay.id) throw new HttpError(409, 'Paiement incohérent.');
    if (o.amount !== null && o.amount < pay.amount_ttc) {
      await admin.from('subscription_payments').update({ status: 'echouee', raw: o.raw }).eq('id', pay.id);
      throw new HttpError(409, 'Montant reçu différent du montant attendu. Contactez Yoon Fleet.');
    }
    const { data: done, error } = await admin.rpc('activate_subscription', { p_id: pay.id, p_raw: o.raw });
    if (error) throw new HttpError(500, 'Paiement reçu, mais l’activation a échoué. Contactez Yoon Fleet.');
    return done;
  }
  if (o.state === 'cancelled' || o.state === 'failed') {
    const { data } = await admin.from('subscription_payments').update({ status: o.state === 'cancelled' ? 'annulee' : 'echouee', raw: o.raw }).eq('id', pay.id).select('*').single();
    return data ?? pay;
  }
  await admin.from('subscription_payments').update({ raw: o.raw }).eq('id', pay.id); // pour le diagnostic
  return pay; // en cours : le client n'a pas encore validé sur son téléphone
}

async function confirm(req: Request, body: Record<string, unknown>) {
  const who = await caller(req);
  const id = String(body.paymentId ?? '');
  const { data: pay } = await admin.from('subscription_payments').select('org_id').eq('id', id).maybeSingle();
  if (!pay || pay.org_id !== who.orgId) throw new HttpError(404, 'Paiement introuvable.');
  return publicRow(await settle(id));
}

/** IPN PayDunya : formulaire « data[invoice][token]=… » ou JSON. On ne garde que le jeton, puis on revérifie. */
async function paydunyaWebhook(text: string) {
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

/** Webhook Bictorys : authentifié, puis revérifié auprès de l'API. */
async function bictorysWebhook(req: Request, text: string) {
  if (!(await bictorysAuthentic(req, text))) return;
  let j: { id?: string; paymentReference?: string } = {};
  try {
    j = JSON.parse(text);
  } catch {
    return;
  }
  const q = admin.from('subscription_payments').select('id').eq('provider', 'bictorys');
  const { data: pay } = j.id ? await q.eq('provider_ref', j.id).maybeSingle() : await q.eq('id', j.paymentReference ?? '').maybeSingle();
  if (pay) await settle(pay.id as string);
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'Méthode non permise' }, 405, origin);
  try {
    const ipn = new URL(req.url).searchParams.get('ipn');
    if (ipn) {
      const text = await req.text();
      // Toujours 200 : le prestataire n'a rien à apprendre de nos erreurs internes.
      try {
        if (ipn === 'bictorys') await bictorysWebhook(req, text);
        else await paydunyaWebhook(text);
      } catch (e) {
        console.error(e);
      }
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
