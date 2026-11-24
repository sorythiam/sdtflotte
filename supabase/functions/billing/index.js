// supabase/functions/billing/source.ts
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// src/domain/pricing.ts
var PLAN_INFO = {
  essentiel: {
    label: "Essentiel",
    perVehicleYear: 24e3,
    minVehicles: 5,
    users: "3 utilisateurs",
    summary: "Flotte, clients, r\xE9servations, contrats, planning, paiements"
  },
  pro: {
    label: "Pro",
    perVehicleYear: 36e3,
    minVehicles: 10,
    users: "Utilisateurs illimit\xE9s",
    summary: "Essentiel + maintenance, frais au retour. \xC0 venir : \xE9tat des lieux mobile, mobile money, export SYSCOHADA"
  },
  entreprise: {
    label: "Entreprise",
    perVehicleYear: 48e3,
    minVehicles: 30,
    users: "Utilisateurs illimit\xE9s",
    summary: "Pro + support prioritaire. \xC0 venir : multi-agences et multi-pays, portail client"
  }
};
var MONTHLY_SURCHARGE = 0.2;
var VOLUME_THRESHOLD = 100;
var VOLUME_DISCOUNT = 0.2;
var QUOTE_LIMIT = 300;
function priceFor(plan, vehicles, billing = "annuel") {
  const info = PLAN_INFO[plan];
  const n = Math.max(0, Math.floor(vehicles));
  const billedVehicles = Math.max(n, info.minVehicles);
  const full = Math.min(billedVehicles, VOLUME_THRESHOLD);
  const extra = Math.max(0, billedVehicles - VOLUME_THRESHOLD);
  const yearly = Math.round(full * info.perVehicleYear + extra * info.perVehicleYear * (1 - VOLUME_DISCOUNT));
  const perMonth = billing === "mensuel" ? Math.round(yearly * (1 + MONTHLY_SURCHARGE) / 12) : Math.round(yearly / 12);
  return { plan, vehicles: n, billedVehicles, yearly, perMonth, billing, onQuote: billedVehicles > QUOTE_LIMIT };
}

// src/domain/saas.ts
var MIN_PAYMENT = 200;
function addPeriod(fromIso, billing) {
  const d = new Date(fromIso);
  const day = d.getUTCDate();
  if (billing === "annuel") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString();
}
function checkoutQuote(input, current, now, vatRate = 0) {
  const q = priceFor(input.plan, input.vehicles, input.billing);
  const baseHt = input.billing === "annuel" ? q.yearly : q.perMonth;
  let creditHt = 0;
  const last = current.last;
  if (current.paidUntil && last?.periodStart && last.periodEnd && Date.parse(current.paidUntil) > now.getTime()) {
    const span = Date.parse(last.periodEnd) - Date.parse(last.periodStart);
    const left = Math.min(span, Date.parse(current.paidUntil) - now.getTime());
    const paidValue = last.amountHt + last.creditHt;
    if (span > 0 && left > 0) creditHt = Math.round(paidValue * left / span / 100) * 100;
  }
  creditHt = Math.min(creditHt, baseHt);
  const amountHt = baseHt - creditHt;
  const vat = Math.round(amountHt * vatRate / 100);
  const start = now.toISOString();
  let error = null;
  if (q.onQuote) error = "Au-del\xE0 de 300 v\xE9hicules, le prix se fait sur devis.";
  else if (!(input.vehicles >= 1)) error = "Indiquez votre nombre de v\xE9hicules.";
  else if (amountHt + vat < MIN_PAYMENT)
    error = "Votre abonnement en cours couvre d\xE9j\xE0 cette formule. Choisissez plus de v\xE9hicules ou une formule sup\xE9rieure, ou renouvelez \xE0 l\u2019\xE9ch\xE9ance.";
  return {
    plan: input.plan,
    billing: input.billing,
    vehicles: q.billedVehicles,
    baseHt,
    creditHt,
    amountHt,
    vatRate,
    vat,
    amountTtc: amountHt + vat,
    periodStart: start,
    periodEnd: addPeriod(start, input.billing),
    error
  };
}

// supabase/functions/billing/source.ts
var env = (k) => Deno.env.get(k) ?? "";
var admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
var PD_KEYS = { master: env("PAYDUNYA_MASTER_KEY"), private: env("PAYDUNYA_PRIVATE_KEY"), token: env("PAYDUNYA_TOKEN") };
var PD_LIVE = env("PAYDUNYA_MODE") === "live";
var PD_BASE = PD_LIVE ? "https://app.paydunya.com/api/v1" : "https://app.paydunya.com/sandbox-api/v1";
var APP_URL = (env("APP_URL") || "https://yoonfleet.vercel.app").replace(/\/$/, "");
var VAT_RATE = Number(env("SAAS_VAT_RATE") || "0");
var ALLOWED_ORIGINS = [APP_URL, "http://localhost:5173", "http://localhost:4173"];
var cors = (origin) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : APP_URL,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin"
});
var json = (body, status, origin) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(origin) } });
var pdHeaders = () => ({
  "Content-Type": "application/json",
  "PAYDUNYA-MASTER-KEY": PD_KEYS.master,
  "PAYDUNYA-PRIVATE-KEY": PD_KEYS.private,
  "PAYDUNYA-TOKEN": PD_KEYS.token
});
var pdReady = () => !!(PD_KEYS.master && PD_KEYS.private && PD_KEYS.token);
async function caller(req) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, "Session expir\xE9e, reconnectez-vous.");
  const { data: m } = await admin.from("memberships").select("org_id, role").eq("user_id", data.user.id).limit(1).maybeSingle();
  if (!m) throw new HttpError(403, "Aucune entreprise rattach\xE9e \xE0 ce compte.");
  return { userId: data.user.id, email: data.user.email ?? "", orgId: m.org_id, role: m.role };
}
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
var toApp = (r) => ({
  id: r.id,
  plan: r.plan,
  vehicles: r.vehicles,
  billing: r.billing,
  baseHt: r.base_ht,
  creditHt: r.credit_ht,
  amountHt: r.amount_ht,
  vatRate: Number(r.vat_rate),
  vat: r.vat,
  amountTtc: r.amount_ttc,
  provider: r.provider,
  status: r.status,
  periodStart: r.period_start ?? null,
  periodEnd: r.period_end ?? null,
  invoiceNumber: r.invoice_number ?? null,
  paidAt: r.paid_at ?? null,
  createdBy: r.created_by ?? null,
  createdAt: r.created_at
});
var publicRow = (r) => {
  const { provider_ref: _ref, raw: _raw, org_id: _org, ...rest } = r;
  return rest;
};
async function lastPaid(orgId) {
  const { data } = await admin.from("subscription_payments").select("*").eq("org_id", orgId).eq("status", "payee").order("paid_at", { ascending: false }).limit(1).maybeSingle();
  return data ? toApp(data) : null;
}
async function checkout(req, body) {
  const who = await caller(req);
  if (who.role !== "admin") throw new HttpError(403, "Seul l\u2019administrateur du compte peut payer l\u2019abonnement.");
  if (!pdReady()) throw new HttpError(503, "Le paiement en ligne n\u2019est pas encore activ\xE9. Envoyez une demande d\u2019activation, nous vous recontactons.");
  const plan = body.plan;
  if (!PLAN_INFO[plan]) throw new HttpError(400, "Formule inconnue.");
  const billing = body.billing === "mensuel" ? "mensuel" : "annuel";
  const vehicles = Math.floor(Number(body.vehicles));
  const { data: org } = await admin.from("organizations").select("id, name, paid_until").eq("id", who.orgId).single();
  const q = checkoutQuote({ plan, vehicles, billing }, { paidUntil: org?.paid_until ?? null, last: await lastPaid(who.orgId) }, /* @__PURE__ */ new Date(), VAT_RATE);
  if (q.error) throw new HttpError(400, q.error);
  const { data: pay, error } = await admin.from("subscription_payments").insert({
    org_id: who.orgId,
    plan,
    vehicles: q.vehicles,
    billing,
    base_ht: q.baseHt,
    credit_ht: q.creditHt,
    amount_ht: q.amountHt,
    vat_rate: q.vatRate,
    vat: q.vat,
    amount_ttc: q.amountTtc,
    provider: "paydunya",
    status: "en_attente",
    created_by: who.email
  }).select("*").single();
  if (error || !pay) throw new HttpError(500, "Impossible de pr\xE9parer le paiement.");
  const label = `Yoon Fleet ${PLAN_INFO[plan].label}, ${q.vehicles} v\xE9hicules, ${billing === "annuel" ? "1 an" : "1 mois"}`;
  const back = `${APP_URL}/abonnement/retour?paiement=${pay.id}`;
  const res = await fetch(`${PD_BASE}/checkout-invoice/create`, {
    method: "POST",
    headers: pdHeaders(),
    body: JSON.stringify({
      invoice: {
        total_amount: q.amountTtc,
        description: `${label} \u2014 ${org?.name ?? ""}`.slice(0, 200),
        items: { item_0: { name: label, quantity: 1, unit_price: String(q.amountTtc), total_price: String(q.amountTtc) } }
      },
      store: { name: "Yoon Fleet", website_url: APP_URL },
      custom_data: { payment_id: pay.id, org_id: who.orgId },
      actions: { return_url: back, cancel_url: `${back}&annule=1`, callback_url: `${env("SUPABASE_URL")}/functions/v1/billing?ipn=1` }
    })
  });
  const pd = await res.json().catch(() => ({}));
  if (pd.response_code !== "00" || !pd.token || !pd.response_text?.startsWith("http")) {
    await admin.from("subscription_payments").update({ status: "echouee", raw: pd }).eq("id", pay.id);
    throw new HttpError(502, "Le service de paiement a refus\xE9 la demande. R\xE9essayez dans un instant.");
  }
  await admin.from("subscription_payments").update({ provider_ref: pd.token }).eq("id", pay.id);
  return { paymentId: pay.id, url: pd.response_text };
}
async function settle(payId) {
  const { data: pay } = await admin.from("subscription_payments").select("*").eq("id", payId).maybeSingle();
  if (!pay) throw new HttpError(404, "Paiement introuvable.");
  if (pay.status !== "en_attente" || !pay.provider_ref || pay.provider !== "paydunya") return pay;
  const res = await fetch(`${PD_BASE}/checkout-invoice/confirm/${encodeURIComponent(pay.provider_ref)}`, { headers: pdHeaders() });
  const pd = await res.json().catch(() => ({}));
  const status = String(pd.status ?? "").toLowerCase();
  if (status === "completed") {
    const paid = Number(pd.invoice?.total_amount);
    if (pd.custom_data?.payment_id && pd.custom_data.payment_id !== pay.id) throw new HttpError(409, "Paiement incoh\xE9rent.");
    if (Number.isFinite(paid) && paid < pay.amount_ttc) {
      await admin.from("subscription_payments").update({ status: "echouee", raw: pd }).eq("id", pay.id);
      throw new HttpError(409, "Montant re\xE7u diff\xE9rent du montant attendu. Contactez Yoon Fleet.");
    }
    const { data: done, error } = await admin.rpc("activate_subscription", { p_id: pay.id, p_raw: pd });
    if (error) throw new HttpError(500, "Paiement re\xE7u, mais l\u2019activation a \xE9chou\xE9. Contactez Yoon Fleet.");
    return done;
  }
  if (status === "cancelled" || status === "failed") {
    const { data } = await admin.from("subscription_payments").update({ status: status === "cancelled" ? "annulee" : "echouee", raw: pd }).eq("id", pay.id).select("*").single();
    return data ?? pay;
  }
  return pay;
}
async function confirm(req, body) {
  const who = await caller(req);
  const id = String(body.paymentId ?? "");
  const { data: pay } = await admin.from("subscription_payments").select("org_id").eq("id", id).maybeSingle();
  if (!pay || pay.org_id !== who.orgId) throw new HttpError(404, "Paiement introuvable.");
  return publicRow(await settle(id));
}
async function webhook(req) {
  const text = await req.text();
  let token = "";
  try {
    const j = JSON.parse(text);
    token = j?.data?.invoice?.token ?? j?.invoice?.token ?? j?.token ?? "";
  } catch {
    const f = new URLSearchParams(text);
    token = f.get("data[invoice][token]") ?? f.get("invoice_token") ?? f.get("token") ?? "";
  }
  if (!token) return;
  const { data: pay } = await admin.from("subscription_payments").select("id").eq("provider", "paydunya").eq("provider_ref", token).maybeSingle();
  if (pay) await settle(pay.id);
}
Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "M\xE9thode non permise" }, 405, origin);
  try {
    if (new URL(req.url).searchParams.get("ipn") === "1") {
      await webhook(req);
      return json({ ok: true }, 200, origin);
    }
    const body = await req.json().catch(() => ({}));
    if (body.action === "checkout") return json(await checkout(req, body), 200, origin);
    if (body.action === "confirm") return json(await confirm(req, body), 200, origin);
    return json({ error: "Action inconnue" }, 400, origin);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : "Erreur" }, status, origin);
  }
});
