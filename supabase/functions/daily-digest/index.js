// supabase/functions/daily-digest/source.ts
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// src/domain/rules.ts
var DAY_MS = 24 * 60 * 60 * 1e3;
function isLate(r, now) {
  return r.status === "en_cours" && Date.parse(r.end) < now.getTime();
}
function lateDays(r, now) {
  if (!isLate(r, now)) return 0;
  return Math.ceil((now.getTime() - Date.parse(r.end)) / DAY_MS);
}
function balanceDue(r, payments) {
  const paid = payments.filter(
    (p) => p.reservationId === r.id && p.status === "paye" && (p.kind === "acompte" || p.kind === "solde" || p.kind === "frais")
  ).reduce((s, p) => s + p.amount, 0);
  return Math.max(0, r.total + (r.fees ?? 0) - paid);
}
function cautionHeld(reservationId, payments) {
  const mine = payments.filter((p) => p.reservationId === reservationId && p.status === "paye");
  const inn = mine.filter((p) => p.kind === "caution").reduce((s, p) => s + p.amount, 0);
  const out = mine.filter((p) => p.kind === "remboursement_caution").reduce((s, p) => s + p.amount, 0);
  return Math.max(0, inn - out);
}
function expiryAlerts(vehicles, now, withinDays = 30) {
  const out = [];
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  for (const v of vehicles) {
    const docs = [
      ["assurance", v.insuranceExpiry],
      ["visite technique", v.inspectionExpiry],
      ["vignette", v.vignetteExpiry]
    ];
    for (const [document, date] of docs) {
      if (!date) continue;
      const daysLeft = Math.round((Date.parse(date + "T00:00:00Z") - today) / DAY_MS);
      if (daysLeft <= withinDays) out.push({ vehicleId: v.id, document, date, daysLeft });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

// src/domain/alerts.ts
var DAY = 864e5;
var OPS = ["direction", "agent"];
var FIN = ["direction", "comptable"];
var FLEET = ["direction", "agent", "mecanicien"];
var fcfa = (n) => `${new Intl.NumberFormat("fr-FR").format(Math.round(n)).replace(/ | /g, " ")} FCFA`;
var COUNTRY_UTC_OFFSET = {
  SN: 0,
  CI: 0,
  GN: 0,
  MR: 0,
  ML: 0,
  BF: 0,
  TG: 0,
  GM: 0,
  GW: 0,
  SL: 0,
  LR: 0,
  GH: 0,
  BJ: 60,
  NE: 60,
  CM: 60,
  GA: 60,
  CG: 60,
  TD: 60,
  CF: 60,
  GQ: 60,
  NG: 60,
  MA: 60,
  TN: 60,
  DZ: 60,
  CD: 60
};
function localDay(now, offsetMin) {
  const local = now.getTime() + offsetMin * 6e4;
  const start = Math.floor(local / DAY) * DAY - offsetMin * 6e4;
  return { start, end: start + DAY };
}
function hhmm(iso, offsetMin) {
  const d = new Date(Date.parse(iso) + offsetMin * 6e4);
  return `${String(d.getUTCHours()).padStart(2, "0")}h${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
function dmy(isoDate) {
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
var rank = { urgent: 0, attention: 1, info: 2 };
function buildAlerts(input, now, offsetMin = -now.getTimezoneOffset()) {
  const out = [];
  const { start: today, end: tomorrow } = localDay(now, offsetMin);
  const t = now.getTime();
  const vehicle = (id) => input.vehicles.find((v) => v.id === id);
  const client = (id) => input.clients.find((c) => c.id === id);
  const vLabel = (id) => {
    const v = vehicle(id);
    return v ? `${v.brand} ${v.model} (${v.plate})` : "V\xE9hicule";
  };
  const cName = (id) => client(id)?.name ?? "Client";
  for (const r of input.reservations) {
    const s = Date.parse(r.start);
    const e = Date.parse(r.end);
    const link = `/reservations/${r.id}`;
    if (r.status === "en_cours") {
      if (e < t) {
        const d = lateDays(r, now);
        out.push({
          id: `retard:${r.id}`,
          kind: "retard",
          level: "urgent",
          link,
          roles: OPS,
          title: `Retour en retard : ${vLabel(r.vehicleId)}`,
          detail: `${cName(r.clientId)} \xB7 contrat ${r.number} \xB7 pr\xE9vu le ${dmy(r.end)} \xE0 ${hhmm(r.end, offsetMin)}, ${d} jour${d > 1 ? "s" : ""} de retard`
        });
      } else if (e < tomorrow) {
        out.push({
          id: `retour:${r.id}`,
          kind: "retour_jour",
          level: "info",
          link,
          roles: OPS,
          title: `Retour aujourd\u2019hui \xE0 ${hhmm(r.end, offsetMin)} : ${vLabel(r.vehicleId)}`,
          detail: `${cName(r.clientId)} \xB7 contrat ${r.number}`
        });
      }
    }
    if (r.status === "reservee") {
      if (s < today) {
        out.push({
          id: `depart:${r.id}`,
          kind: "depart_non_fait",
          level: "urgent",
          link,
          roles: OPS,
          title: `D\xE9part non enregistr\xE9 : ${vLabel(r.vehicleId)}`,
          detail: `${cName(r.clientId)} \xB7 contrat ${r.number} \xB7 d\xE9part pr\xE9vu le ${dmy(r.start)}. Enregistrez le d\xE9part ou annulez la r\xE9servation.`
        });
      } else if (s < tomorrow) {
        out.push({
          id: `depart:${r.id}`,
          kind: "depart_jour",
          level: "info",
          link,
          roles: OPS,
          title: `D\xE9part aujourd\u2019hui \xE0 ${hhmm(r.start, offsetMin)} : ${vLabel(r.vehicleId)}`,
          detail: `${cName(r.clientId)} \xB7 contrat ${r.number}`
        });
      }
    }
    if (r.status === "reservee" && s < t + 7 * DAY || r.status === "en_cours") {
      const c = client(r.clientId);
      if (c && !r.withDriver && c.licenseExpiry && Date.parse(c.licenseExpiry + "T23:59:59Z") < e) {
        const expired = Date.parse(c.licenseExpiry + "T23:59:59Z") < t;
        out.push({
          id: `permis:${r.id}`,
          kind: "permis",
          level: "urgent",
          link: `/clients`,
          roles: OPS,
          title: `Permis ${expired ? "expir\xE9" : "expirant pendant la location"} : ${c.name}`,
          detail: `Permis valable jusqu\u2019au ${dmy(c.licenseExpiry)} \xB7 contrat ${r.number} jusqu\u2019au ${dmy(r.end)}`
        });
      }
      if (c?.score === "blacklist" && r.status === "reservee") {
        out.push({
          id: `noire:${r.id}`,
          kind: "liste_noire",
          level: "urgent",
          link,
          roles: OPS,
          title: `Client sur liste noire : ${c.name}`,
          detail: `R\xE9servation ${r.number} pr\xE9vue le ${dmy(r.start)}.`
        });
      }
    }
    if (r.status === "terminee") {
      const due = balanceDue(r, input.payments);
      if (due > 0) {
        out.push({
          id: `impaye:${r.id}`,
          kind: "impaye",
          level: "attention",
          link,
          roles: FIN,
          title: `Solde impay\xE9 : ${fcfa(due)}`,
          detail: `${cName(r.clientId)} \xB7 contrat ${r.number} termin\xE9 le ${dmy(r.end)}`
        });
      }
      const held = cautionHeld(r.id, input.payments);
      if (held > 0 && due <= 0) {
        out.push({
          id: `caution:${r.id}`,
          kind: "caution_a_rendre",
          level: "attention",
          link,
          roles: ["direction", "agent", "comptable"],
          title: `Caution \xE0 rendre : ${fcfa(held)}`,
          detail: `${cName(r.clientId)} \xB7 contrat ${r.number} termin\xE9 le ${dmy(r.end)}`
        });
      }
    }
  }
  for (const a of expiryAlerts(input.vehicles.filter((v) => !v.outOfService), now, 30)) {
    const what = a.document === "assurance" ? "Assurance" : a.document === "vignette" ? "Vignette" : "Visite technique";
    out.push({
      id: `doc:${a.vehicleId}:${a.document}`,
      kind: "document",
      level: a.daysLeft <= 7 ? "urgent" : "attention",
      link: "/vehicules",
      roles: FLEET,
      title: a.daysLeft < 0 ? `${what} expir\xE9e : ${vLabel(a.vehicleId)}` : `${what} \xE0 renouveler : ${vLabel(a.vehicleId)}`,
      detail: a.daysLeft < 0 ? `Expir\xE9e depuis le ${dmy(a.date)}. Ne pas louer ce v\xE9hicule avant renouvellement.` : a.daysLeft === 0 ? `Expire aujourd\u2019hui (${dmy(a.date)}).` : `Expire le ${dmy(a.date)}, dans ${a.daysLeft} jour${a.daysLeft > 1 ? "s" : ""}.`
    });
  }
  for (const m of input.maintenances) {
    const s = Date.parse(m.start);
    if (s >= today && s < tomorrow) {
      out.push({
        id: `entretien:${m.id}`,
        kind: "entretien_jour",
        level: "info",
        link: "/maintenance",
        roles: ["direction", "mecanicien"],
        title: `Entretien aujourd\u2019hui : ${vLabel(m.vehicleId)}`,
        detail: `${m.label} \xE0 ${hhmm(m.start, offsetMin)}`
      });
    }
  }
  for (const b of input.bookingRequests ?? []) {
    if (b.status !== "nouvelle") continue;
    const soon = Date.parse(b.start) - t < 2 * DAY;
    out.push({
      id: `demande:${b.id}`,
      kind: "demande_en_ligne",
      level: soon ? "urgent" : "attention",
      link: "/demandes",
      roles: OPS,
      title: `Demande en ligne \xE0 traiter : ${b.name}`,
      detail: `${b.category} du ${dmy(b.start)} au ${dmy(b.end)}${soon ? " \xB7 d\xE9part dans moins de 48 h" : ""}`
    });
  }
  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.title.localeCompare(b.title, "fr"));
}
function defaultDailyDigest(role) {
  return role === "admin" || role === "direction" || role === "agent";
}
function alertsFor(alerts, role) {
  return role === "admin" ? alerts : alerts.filter((a) => a.roles.includes(role));
}
var esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
var sectionTitle = {
  urgent: "\xC0 traiter en priorit\xE9",
  attention: "\xC0 suivre",
  info: "Au programme aujourd\u2019hui"
};
var sectionColor = { urgent: "#B42318", attention: "#B54708", info: "#0B3954" };
function digestEmail(orgName, alerts, appUrl, dateLabel) {
  if (alerts.length === 0) return null;
  const urgent = alerts.filter((a) => a.level === "urgent").length;
  const subject = urgent ? `${urgent} alerte${urgent > 1 ? "s" : ""} urgente${urgent > 1 ? "s" : ""} \xB7 ${orgName} \xB7 ${dateLabel}` : `Votre journ\xE9e \xB7 ${orgName} \xB7 ${dateLabel}`;
  const base = appUrl.replace(/\/$/, "");
  const levels = ["urgent", "attention", "info"];
  const text = [
    `Yoon Fleet \xB7 ${orgName} \xB7 ${dateLabel}`,
    "",
    ...levels.flatMap((l) => {
      const list = alerts.filter((a) => a.level === l);
      if (!list.length) return [];
      return [sectionTitle[l].toUpperCase(), ...list.map((a) => `- ${a.title}
  ${a.detail}
  ${base}${a.link}`), ""];
    }),
    `Ouvrir Yoon Fleet : ${base}/alertes`,
    "Pour ne plus recevoir ce r\xE9capitulatif : Param\xE8tres > Notifications."
  ].join("\n");
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#F5F0E6;font-family:Arial,Helvetica,sans-serif;color:#1D2939">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px">
<tr><td style="padding:24px 28px;background:#0B3954;border-radius:12px 12px 0 0;color:#ffffff">
<div style="font-size:20px;font-weight:bold">yoon <span style="color:#E07B2E">fleet</span></div>
<div style="font-size:14px;opacity:.85;margin-top:4px">${esc(orgName)} \xB7 ${esc(dateLabel)}</div></td></tr>
${levels.map((l) => {
    const list = alerts.filter((a) => a.level === l);
    if (!list.length) return "";
    return `<tr><td style="padding:20px 28px 4px"><div style="font-size:13px;font-weight:bold;letter-spacing:.04em;text-transform:uppercase;color:${sectionColor[l]}">${sectionTitle[l]} (${list.length})</div></td></tr>
${list.map(
      (a) => `<tr><td style="padding:8px 28px"><a href="${esc(base + a.link)}" style="text-decoration:none;color:#1D2939;display:block;border-left:3px solid ${sectionColor[l]};padding:4px 0 4px 12px">
<div style="font-size:15px;font-weight:bold">${esc(a.title)}</div><div style="font-size:13px;color:#475467;margin-top:2px">${esc(a.detail)}</div></a></td></tr>`
    ).join("\n")}`;
  }).join("\n")}
<tr><td style="padding:24px 28px"><a href="${esc(base)}/alertes" style="display:inline-block;background:#0B3954;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Ouvrir Yoon Fleet</a></td></tr>
<tr><td style="padding:0 28px 24px;font-size:12px;color:#667085">Vous recevez ce r\xE9capitulatif car il est activ\xE9 dans votre compte. Pour l\u2019arr\xEAter : Param\xE8tres, puis Notifications.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

// supabase/functions/daily-digest/source.ts
var camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
var toApp = (rows) => (rows ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v])));
var json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST attendu" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: ok } = await sb.rpc("daily_digest_secret_ok", { p: req.headers.get("x-cron-secret") ?? "" });
  if (ok !== true) return json({ error: "Non autoris\xE9" }, 401);
  const body = await req.json().catch(() => ({}));
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const dryRun = body.dryRun === true || !apiKey;
  const from = Deno.env.get("ALERTS_FROM") ?? "Yoon Fleet <onboarding@resend.dev>";
  const appUrl = Deno.env.get("APP_URL") ?? "https://yoonfleet.vercel.app";
  const now = /* @__PURE__ */ new Date();
  let q = sb.from("organizations").select("id, name, country");
  if (body.orgId) q = q.eq("id", body.orgId);
  const { data: orgs, error } = await q;
  if (error) return json({ error: error.message }, 500);
  const report = [];
  for (const org of orgs ?? []) {
    const { data: members } = await sb.from("memberships").select("user_id, email, role, daily_digest").eq("org_id", org.id);
    const recipients = (members ?? []).filter((m) => m.email && (m.daily_digest ?? defaultDailyDigest(m.role)));
    if (recipients.length === 0) continue;
    const since = new Date(now.getTime() - 180 * 864e5).toISOString();
    const [vehicles, clients, reservations, payments, maintenances, requests] = await Promise.all([
      sb.from("vehicles").select("*").eq("org_id", org.id),
      sb.from("clients").select("*").eq("org_id", org.id),
      sb.from("reservations").select("*").eq("org_id", org.id).or(`status.in.(reservee,en_cours),and(status.eq.terminee,end.gte.${since})`),
      sb.from("payments").select("*").eq("org_id", org.id),
      sb.from("maintenances").select("*").eq("org_id", org.id).gte("start", new Date(now.getTime() - 2 * 864e5).toISOString()),
      sb.from("booking_requests").select("id, status, name, category, start, end, created_at").eq("org_id", org.id).eq("status", "nouvelle")
    ]);
    const failed = [vehicles, clients, reservations, payments, maintenances, requests].find((r) => r.error);
    if (failed) {
      report.push({ org: org.name, error: failed.error.message });
      continue;
    }
    const offset = COUNTRY_UTC_OFFSET[org.country] ?? 0;
    const all = buildAlerts(
      {
        vehicles: toApp(vehicles.data),
        clients: toApp(clients.data),
        reservations: toApp(reservations.data),
        payments: toApp(payments.data),
        maintenances: toApp(maintenances.data),
        bookingRequests: toApp(requests.data)
      },
      now,
      offset
    );
    const day = new Date(localDay(now, offset).start + offset * 6e4).toISOString().slice(0, 10);
    const dateLabel = day.split("-").reverse().join("/");
    for (const m of recipients) {
      const mail = digestEmail(org.name, alertsFor(all, m.role), appUrl, dateLabel);
      if (!mail) {
        report.push({ org: org.name, to: m.email, skipped: "rien \xE0 signaler" });
        continue;
      }
      if (dryRun) {
        report.push({ org: org.name, to: m.email, subject: mail.subject, simulated: true });
        continue;
      }
      const { data: claimed } = await sb.from("digest_log").upsert({ org_id: org.id, user_id: m.user_id, sent_on: day, alerts: alertsFor(all, m.role).length }, { onConflict: "org_id,user_id,sent_on", ignoreDuplicates: true }).select("user_id");
      if (!claimed?.length) {
        report.push({ org: org.name, to: m.email, skipped: "d\xE9j\xE0 envoy\xE9 aujourd\u2019hui" });
        continue;
      }
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [m.email], subject: mail.subject, html: mail.html, text: mail.text })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        await sb.from("digest_log").delete().match({ org_id: org.id, user_id: m.user_id, sent_on: day });
        report.push({ org: org.name, to: m.email, error: out.message ?? `HTTP ${res.status}` });
        continue;
      }
      await sb.from("digest_log").update({ provider_id: out.id ?? null }).match({ org_id: org.id, user_id: m.user_id, sent_on: day });
      report.push({ org: org.name, to: m.email, subject: mail.subject, sent: true });
    }
  }
  return json({ dryRun, at: now.toISOString(), results: report });
});
