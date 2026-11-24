// supabase/functions/daily-digest/source.ts
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// src/domain/verification.ts
var day = (iso) => Date.parse(iso.slice(0, 10) + "T00:00:00Z");
function age(birth, now) {
  const b = /* @__PURE__ */ new Date(birth + "T00:00:00Z");
  let a = now.getUTCFullYear() - b.getUTCFullYear();
  if (now.getUTCMonth() < b.getUTCMonth() || now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate()) a--;
  return a;
}
function verificationOf(c, now, minAge = 0) {
  const issues = [];
  const docs = c.documents ?? {};
  const today = day(now.toISOString());
  if (!c.idNumber) issues.push("Num\xE9ro de la pi\xE8ce d\u2019identit\xE9");
  if (!docs.idFront) issues.push("Photo de la pi\xE8ce d\u2019identit\xE9");
  if (!c.licenseNumber) issues.push("Num\xE9ro du permis");
  if (!c.licenseExpiry) issues.push("Date de validit\xE9 du permis");
  if (!docs.license) issues.push("Photo du permis");
  const expired = [];
  if (c.idExpiry && day(c.idExpiry) < today) expired.push("Pi\xE8ce d\u2019identit\xE9 expir\xE9e");
  if (c.licenseExpiry && day(c.licenseExpiry) < today) expired.push("Permis expir\xE9");
  const young = minAge > 0 && c.birthDate && age(c.birthDate, now) < minAge ? [`Conducteur de moins de ${minAge} ans`] : [];
  const blocking = [...expired, ...young];
  const ready = issues.length === 0 && blocking.length === 0;
  if (c.verifiedAt) return { state: blocking.length ? "a_revoir" : "verifie", issues: blocking, ready };
  return { state: blocking.length ? "a_revoir" : "incomplet", issues: [...blocking, ...issues.map((i) => `Manque : ${i.charAt(0).toLowerCase()}${i.slice(1)}`)], ready };
}
var LATE_MARGIN = 2 * 3600 * 1e3;

// src/domain/rules.ts
var DAY_MS = 24 * 60 * 60 * 1e3;
function isLate(r, now) {
  return r.status === "en_cours" && Date.parse(r.end) < now.getTime();
}
function lateDays(r, now) {
  if (!isLate(r, now)) return 0;
  return Math.ceil((now.getTime() - Date.parse(r.end)) / DAY_MS);
}
function balanceDue(r, payments, invoices = []) {
  const mine = payments.filter((p) => p.reservationId === r.id && p.status === "paye");
  const paid = mine.filter((p) => p.kind === "acompte" || p.kind === "solde" || p.kind === "frais").reduce((s, p) => s + p.amount, 0) - mine.filter((p) => p.kind === "remboursement").reduce((s, p) => s + p.amount, 0);
  const inv = invoices.filter((i) => i.reservationId === r.id);
  const owed = inv.length ? inv.reduce((s, i) => s + i.totalTtc, 0) : r.total + (r.fees ?? 0);
  return Math.max(0, owed - paid);
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

// src/domain/maintenancePlan.ts
var SOON_KM = 1e3;
var SOON_DAYS = 15;
function addMonths(iso, months) {
  const d = /* @__PURE__ */ new Date(iso + "T00:00:00Z");
  const day2 = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day2, last));
  return d.toISOString().slice(0, 10);
}
function planDue(plan, vehicle, now) {
  const nextKm = plan.everyKm ? (plan.lastKm ?? 0) + plan.everyKm : null;
  const base = plan.lastDate ?? plan.createdAt.slice(0, 10);
  const nextDate = plan.everyMonths ? addMonths(base, plan.everyMonths) : null;
  const kmLeft = nextKm !== null ? nextKm - vehicle.mileage : null;
  const today = Date.parse(now.toISOString().slice(0, 10) + "T00:00:00Z");
  const daysLeft = nextDate ? Math.round((Date.parse(nextDate + "T00:00:00Z") - today) / 864e5) : null;
  const over = kmLeft !== null && kmLeft < 0 || daysLeft !== null && daysLeft < 0;
  const soon = !over && (kmLeft !== null && kmLeft <= SOON_KM || daysLeft !== null && daysLeft <= SOON_DAYS);
  const fmt = (n) => n.toLocaleString("fr-FR");
  const parts = [];
  if (kmLeft !== null) parts.push(kmLeft < 0 ? `d\xE9pass\xE9 de ${fmt(-kmLeft)} km` : `dans ${fmt(kmLeft)} km`);
  if (daysLeft !== null) parts.push(daysLeft < 0 ? `en retard de ${-daysLeft} jour(s)` : daysLeft === 0 ? "aujourd\u2019hui" : `dans ${daysLeft} jour(s)`);
  return { plan, nextKm, nextDate, kmLeft, daysLeft, state: over ? "depasse" : soon ? "bientot" : "ok", text: parts.join(" ou ") };
}

// src/domain/vtc.ts
var DAY = 864e5;
var isoDay = (d) => d.toISOString().slice(0, 10);
var parse = (iso) => Date.parse(iso.slice(0, 10) + "T00:00:00Z");
function workingDays(c, until) {
  const end = c.endDate && c.endDate < until ? c.endDate : until;
  const a = parse(c.startDate);
  const b = parse(end);
  if (b < a) return 0;
  const total = Math.round((b - a) / DAY) + 1;
  const rest = new Set(c.restDays);
  if (rest.size === 0) return total;
  const weeks = Math.floor(total / 7);
  let n = weeks * (7 - rest.size);
  const startDow = new Date(a).getUTCDay();
  for (let i = weeks * 7; i < total; i++) if (!rest.has((startDow + i) % 7)) n++;
  return n;
}
var isRestDay = (c, day2) => c.restDays.includes(new Date(parse(day2)).getUTCDay());
function vtcBalance(c, payments, expenses, now) {
  const today = isoDay(now);
  const active = c.status === "actif" || c.status === "suspendu";
  const until = active ? today : c.endDate ?? today;
  const expectedDays = workingDays(c, until);
  const expected = expectedDays * c.dailyAmount;
  const mine = payments.filter((p) => p.contractId === c.id);
  const paid = mine.reduce((s, p) => s + p.amount, 0);
  const charges = expenses.filter((e) => e.vtcContractId === c.id && e.chargedTo === "chauffeur").reduce((s, e) => s + e.amount, 0);
  const balance = expected + charges - paid;
  const todayDue = c.status === "actif" && today >= c.startDate && (!c.endDate || today <= c.endDate) && !isRestDay(c, today) ? c.dailyAmount : 0;
  const paidToday = mine.filter((p) => p.paidOn === today).reduce((s, p) => s + p.amount, 0);
  const dates = mine.map((p) => p.paidOn).sort();
  const lastPaidOn = dates.length ? dates[dates.length - 1] : null;
  const from = isoDay(new Date(Math.max(parse(c.startDate), parse(today) - 29 * DAY)));
  const windowDays = workingDays({ ...c, startDate: from }, until);
  const windowPaid = mine.filter((p) => p.paidOn >= from && p.paidOn <= today).reduce((s, p) => s + p.amount, 0);
  const regularity = windowDays ? Math.min(1, windowPaid / (windowDays * c.dailyAmount)) : 1;
  let progress = null;
  let remainingPrice = null;
  let estimatedEnd = null;
  if (c.formula === "location_vente" && c.totalPrice) {
    const towardVehicle = Math.max(0, paid - charges);
    progress = Math.min(1, towardVehicle / c.totalPrice);
    remainingPrice = Math.max(0, c.totalPrice - towardVehicle);
    const perWeek = c.dailyAmount * (7 - new Set(c.restDays).size);
    if (perWeek > 0) estimatedEnd = isoDay(new Date(parse(today) + Math.ceil(remainingPrice / perWeek * 7) * DAY));
  }
  return {
    expectedDays,
    expected,
    charges,
    paid,
    balance,
    daysBehind: balance > 0 ? Math.ceil(balance / c.dailyAmount) : 0,
    todayDue,
    paidToday,
    lastPaidOn,
    regularity,
    progress,
    remainingPrice,
    estimatedEnd
  };
}

// src/domain/alerts.ts
var DAY2 = 864e5;
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
  const start = Math.floor(local / DAY2) * DAY2 - offsetMin * 6e4;
  return { start, end: start + DAY2 };
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
      } else if (e < tomorrow + DAY2) {
        out.push({
          id: `retour-demain:${r.id}`,
          kind: "retour_demain",
          level: "info",
          link,
          roles: OPS,
          title: `Retour demain \xE0 ${hhmm(r.end, offsetMin)} : ${vLabel(r.vehicleId)}`,
          detail: `${cName(r.clientId)} \xB7 contrat ${r.number} \xB7 rappelez le client ou proposez une prolongation`
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
    if (r.status === "reservee" && s < t + 7 * DAY2 || r.status === "en_cours") {
      const c = client(r.clientId);
      if (c && !r.withDriver && c.licenseExpiry && Date.parse(c.licenseExpiry + "T23:59:59Z") < e) {
        const expired = Date.parse(c.licenseExpiry + "T23:59:59Z") < t;
        out.push({
          id: `permis:${r.id}`,
          kind: "permis",
          level: "urgent",
          link: `/clients/${c.id}`,
          roles: OPS,
          title: `Permis ${expired ? "expir\xE9" : "expirant pendant la location"} : ${c.name}`,
          detail: `Permis valable jusqu\u2019au ${dmy(c.licenseExpiry)} \xB7 contrat ${r.number} jusqu\u2019au ${dmy(r.end)}`
        });
      }
      if (c && c.score !== "blacklist" && r.status === "reservee" && !r.withDriver && s < t + 2 * DAY2) {
        const v = verificationOf(c, now);
        if (v.state !== "verifie") {
          out.push({
            id: `dossier:${r.id}`,
            kind: "dossier_client",
            level: s < t + DAY2 ? "urgent" : "attention",
            link: `/clients/${c.id}`,
            roles: OPS,
            title: `Dossier client ${v.state === "a_revoir" ? "\xE0 revoir" : "non v\xE9rifi\xE9"} : ${c.name}`,
            detail: `D\xE9part ${r.number} le ${dmy(r.start)} \xB7 ${v.issues[0] ?? "pi\xE8ces \xE0 contr\xF4ler"}`
          });
        }
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
      const due = balanceDue(r, input.payments, input.invoices);
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
  for (const p of input.plans ?? []) {
    if (!p.active) continue;
    const v = vehicle(p.vehicleId);
    if (!v || v.outOfService) continue;
    const d = planDue(p, v, now);
    if (d.state === "ok") continue;
    out.push({
      id: `plan:${p.id}`,
      kind: "entretien_a_prevoir",
      level: d.state === "depasse" ? "attention" : "info",
      link: `/maintenance`,
      roles: ["direction", "mecanicien"],
      title: `${p.label} ${d.state === "depasse" ? "\xE0 faire" : "\xE0 pr\xE9voir"} : ${vLabel(p.vehicleId)}`,
      detail: `\xC9ch\xE9ance ${d.text}`
    });
  }
  if (input.vtc) {
    for (const c of input.vtc.contracts) {
      if (c.status !== "actif") continue;
      const b = vtcBalance(c, input.vtc.payments, input.vtc.expenses, now);
      if (b.daysBehind < 2) continue;
      const name = input.vtc.drivers.find((d) => d.id === c.driverId)?.name ?? "Chauffeur";
      out.push({
        id: `vtc:${c.id}`,
        kind: "vtc_retard",
        level: b.daysBehind >= 5 ? "urgent" : "attention",
        link: `/vtc/${c.id}`,
        roles: ["direction", "agent", "comptable"],
        title: `Versements VTC en retard : ${name}`,
        detail: `${fcfa(b.balance)} dus (${b.daysBehind} jours) \xB7 ${vLabel(c.vehicleId)}${b.lastPaidOn ? ` \xB7 dernier versement le ${dmy(b.lastPaidOn)}` : ""}`
      });
    }
  }
  for (const b of input.bookingRequests ?? []) {
    if (b.status !== "nouvelle") continue;
    const soon = Date.parse(b.start) - t < 2 * DAY2;
    out.push({
      id: `demande:${b.id}`,
      kind: "demande_en_ligne",
      level: soon ? "urgent" : "attention",
      link: "/demandes",
      roles: OPS,
      title: `Demande en ligne \xE0 traiter : ${b.companyName ? `${b.companyName} (${b.name})` : b.name}`,
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
    const [vehicles, clients, reservations, payments, maintenances, requests, plans, invoices] = await Promise.all([
      sb.from("vehicles").select("*").eq("org_id", org.id),
      sb.from("clients").select("*").eq("org_id", org.id),
      sb.from("reservations").select("*").eq("org_id", org.id).or(`status.in.(reservee,en_cours),and(status.eq.terminee,end.gte.${since})`),
      sb.from("payments").select("*").eq("org_id", org.id),
      sb.from("maintenances").select("*").eq("org_id", org.id).gte("start", new Date(now.getTime() - 2 * 864e5).toISOString()),
      sb.from("booking_requests").select("id, status, name, category, start, end, created_at").eq("org_id", org.id).eq("status", "nouvelle"),
      sb.from("maintenance_plans").select("*").eq("org_id", org.id).eq("active", true),
      sb.from("invoices").select("reservation_id, total_ttc").eq("org_id", org.id)
    ]);
    const failed = [vehicles, clients, reservations, payments, maintenances, requests, plans, invoices].find((r) => r.error);
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
        bookingRequests: toApp(requests.data),
        plans: toApp(plans.data),
        invoices: toApp(invoices.data)
      },
      now,
      offset
    );
    const day2 = new Date(localDay(now, offset).start + offset * 6e4).toISOString().slice(0, 10);
    const dateLabel = day2.split("-").reverse().join("/");
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
      const { data: claimed } = await sb.from("digest_log").upsert({ org_id: org.id, user_id: m.user_id, sent_on: day2, alerts: alertsFor(all, m.role).length }, { onConflict: "org_id,user_id,sent_on", ignoreDuplicates: true }).select("user_id");
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
        await sb.from("digest_log").delete().match({ org_id: org.id, user_id: m.user_id, sent_on: day2 });
        report.push({ org: org.name, to: m.email, error: out.message ?? `HTTP ${res.status}` });
        continue;
      }
      await sb.from("digest_log").update({ provider_id: out.id ?? null }).match({ org_id: org.id, user_id: m.user_id, sent_on: day2 });
      report.push({ org: org.name, to: m.email, subject: mail.subject, sent: true });
    }
  }
  return json({ dryRun, at: now.toISOString(), results: report });
});
