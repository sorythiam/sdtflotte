// Alertes du jour : ce qui demande une action. Calcul pur, partagé entre l'application
// (centre d'alertes) et la fonction serveur qui envoie le récapitulatif du matin.

import { verificationOf } from './verification';
import { balanceDue, cautionHeld, expiryAlerts, lateDays } from './rules';
import { planDue } from './maintenancePlan';
import { vtcBalance } from './vtc';
import type { Client, Expense, Maintenance, MaintenancePlan, VtcContract, VtcPayment, Payment, Reservation, Role, Vehicle, VtcAdjustment } from './types';

export type AlertLevel = 'urgent' | 'attention' | 'info';
export type AlertKind =
  | 'retard'
  | 'depart_non_fait'
  | 'depart_jour'
  | 'retour_jour'
  | 'retour_demain'
  | 'document'
  | 'permis'
  | 'liste_noire'
  | 'dossier_client'
  | 'impaye'
  | 'caution_a_rendre'
  | 'entretien_jour'
  | 'entretien_a_prevoir'
  | 'vtc_retard'
  | 'demande_en_ligne'
  | 'acompte_declare';

export interface Alert {
  id: string; // stable : sert de clé et de repère dans l'email
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  detail: string;
  link: string; // chemin dans l'application
  roles: Role[]; // profils concernés (l'administrateur voit tout)
}

export interface AlertInput {
  vehicles: Vehicle[];
  clients: Client[];
  reservations: Reservation[];
  payments: Payment[];
  maintenances: Maintenance[];
  invoices?: { reservationId: string; totalTtc: number }[];
  plans?: MaintenancePlan[];
  vtc?: { contracts: VtcContract[]; payments: VtcPayment[]; expenses: Expense[]; drivers: { id: string; name: string }[]; adjustments?: VtcAdjustment[] };
  /** Acomptes déclarés par les clients depuis leur espace, à vérifier. */
  declarations?: { id: string; reservationId: string; status: string; amount: number; method: string; reference: string }[];
  bookingRequests?: { id: string; status: string; name: string; companyName?: string | null; category: string; start: string; end: string; createdAt: string }[];
}

const DAY = 86400000;
const OPS: Role[] = ['direction', 'agent'];
const FIN: Role[] = ['direction', 'comptable'];
const FLEET: Role[] = ['direction', 'agent', 'mecanicien'];

const fcfa = (n: number) => `${new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/ | /g, ' ')} FCFA`;

/** Fuseau en minutes par pays (heure locale sans changement d'heure en Afrique de l'Ouest et centrale). */
export const COUNTRY_UTC_OFFSET: Record<string, number> = {
  SN: 0, CI: 0, GN: 0, MR: 0, ML: 0, BF: 0, TG: 0, GM: 0, GW: 0, SL: 0, LR: 0, GH: 0,
  BJ: 60, NE: 60, CM: 60, GA: 60, CG: 60, TD: 60, CF: 60, GQ: 60, NG: 60, MA: 60, TN: 60, DZ: 60, CD: 60,
};

/** Bornes de la journée locale qui contient `now`. */
export function localDay(now: Date, offsetMin: number): { start: number; end: number } {
  const local = now.getTime() + offsetMin * 60000;
  const start = Math.floor(local / DAY) * DAY - offsetMin * 60000;
  return { start, end: start + DAY };
}

function hhmm(iso: string, offsetMin: number): string {
  const d = new Date(Date.parse(iso) + offsetMin * 60000);
  return `${String(d.getUTCHours()).padStart(2, '0')}h${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function dmy(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const rank: Record<AlertLevel, number> = { urgent: 0, attention: 1, info: 2 };

export function buildAlerts(input: AlertInput, now: Date, offsetMin = -now.getTimezoneOffset()): Alert[] {
  const out: Alert[] = [];
  const { start: today, end: tomorrow } = localDay(now, offsetMin);
  const t = now.getTime();
  const vehicle = (id: string) => input.vehicles.find((v) => v.id === id);
  const client = (id: string) => input.clients.find((c) => c.id === id);
  const vLabel = (id: string) => {
    const v = vehicle(id);
    return v ? `${v.brand} ${v.model} (${v.plate})` : 'Véhicule';
  };
  const cName = (id: string) => client(id)?.name ?? 'Client';

  for (const r of input.reservations) {
    const s = Date.parse(r.start);
    const e = Date.parse(r.end);
    const link = `/reservations/${r.id}`;

    if (r.status === 'en_cours') {
      if (e < t) {
        const d = lateDays(r, now);
        out.push({
          id: `retard:${r.id}`, kind: 'retard', level: 'urgent', link, roles: OPS,
          title: `Retour en retard : ${vLabel(r.vehicleId)}`,
          detail: `${cName(r.clientId)} · contrat ${r.number} · prévu le ${dmy(r.end)} à ${hhmm(r.end, offsetMin)}, ${d} jour${d > 1 ? 's' : ''} de retard`,
        });
      } else if (e < tomorrow) {
        out.push({
          id: `retour:${r.id}`, kind: 'retour_jour', level: 'info', link, roles: OPS,
          title: `Retour aujourd’hui à ${hhmm(r.end, offsetMin)} : ${vLabel(r.vehicleId)}`,
          detail: `${cName(r.clientId)} · contrat ${r.number}`,
        });
      } else if (e < tomorrow + DAY) {
        // La veille : le temps de rappeler le client ou de proposer une prolongation.
        out.push({
          id: `retour-demain:${r.id}`, kind: 'retour_demain', level: 'info', link, roles: OPS,
          title: `Retour demain à ${hhmm(r.end, offsetMin)} : ${vLabel(r.vehicleId)}`,
          detail: `${cName(r.clientId)} · contrat ${r.number} · rappelez le client ou proposez une prolongation`,
        });
      }
    }

    if (r.status === 'reservee') {
      if (s < today) {
        out.push({
          id: `depart:${r.id}`, kind: 'depart_non_fait', level: 'urgent', link, roles: OPS,
          title: `Départ non enregistré : ${vLabel(r.vehicleId)}`,
          detail: `${cName(r.clientId)} · contrat ${r.number} · départ prévu le ${dmy(r.start)}. Enregistrez le départ ou annulez la réservation.`,
        });
      } else if (s < tomorrow) {
        out.push({
          id: `depart:${r.id}`, kind: 'depart_jour', level: 'info', link, roles: OPS,
          title: `Départ aujourd’hui à ${hhmm(r.start, offsetMin)} : ${vLabel(r.vehicleId)}`,
          detail: `${cName(r.clientId)} · contrat ${r.number}`,
        });
      }
    }

    // Client : permis et liste noire, pour les locations qui démarrent dans les 7 jours ou sont en cours.
    if ((r.status === 'reservee' && s < t + 7 * DAY) || r.status === 'en_cours') {
      const c = client(r.clientId);
      if (c && !r.withDriver && c.licenseExpiry && Date.parse(c.licenseExpiry + 'T23:59:59Z') < e) {
        const expired = Date.parse(c.licenseExpiry + 'T23:59:59Z') < t;
        out.push({
          id: `permis:${r.id}`, kind: 'permis', level: 'urgent', link: `/clients/${c.id}`, roles: OPS,
          title: `Permis ${expired ? 'expiré' : 'expirant pendant la location'} : ${c.name}`,
          detail: `Permis valable jusqu’au ${dmy(c.licenseExpiry)} · contrat ${r.number} jusqu’au ${dmy(r.end)}`,
        });
      }
      if (c && c.score !== 'blacklist' && r.status === 'reservee' && !r.withDriver && s < t + 2 * DAY) {
        const v = verificationOf(c, now);
        if (v.state !== 'verifie') {
          out.push({
            id: `dossier:${r.id}`, kind: 'dossier_client', level: s < t + DAY ? 'urgent' : 'attention', link: `/clients/${c.id}`, roles: OPS,
            title: `Dossier client ${v.state === 'a_revoir' ? 'à revoir' : 'non vérifié'} : ${c.name}`,
            detail: `Départ ${r.number} le ${dmy(r.start)} · ${v.issues[0] ?? 'pièces à contrôler'}`,
          });
        }
      }
      if (c?.score === 'blacklist' && r.status === 'reservee') {
        out.push({
          id: `noire:${r.id}`, kind: 'liste_noire', level: 'urgent', link, roles: OPS,
          title: `Client sur liste noire : ${c.name}`,
          detail: `Réservation ${r.number} prévue le ${dmy(r.start)}.`,
        });
      }
    }

    if (r.status === 'terminee') {
      const due = balanceDue(r, input.payments, input.invoices);
      if (due > 0) {
        out.push({
          id: `impaye:${r.id}`, kind: 'impaye', level: 'attention', link, roles: FIN,
          title: `Solde impayé : ${fcfa(due)}`,
          detail: `${cName(r.clientId)} · contrat ${r.number} terminé le ${dmy(r.end)}`,
        });
      }
      const held = cautionHeld(r.id, input.payments);
      if (held > 0 && due <= 0) {
        out.push({
          id: `caution:${r.id}`, kind: 'caution_a_rendre', level: 'attention', link, roles: ['direction', 'agent', 'comptable'],
          title: `Caution à rendre : ${fcfa(held)}`,
          detail: `${cName(r.clientId)} · contrat ${r.number} terminé le ${dmy(r.end)}`,
        });
      }
    }
  }

  for (const a of expiryAlerts(input.vehicles.filter((v) => !v.outOfService), now, 30)) {
    const what = a.document === 'assurance' ? 'Assurance' : a.document === 'vignette' ? 'Vignette' : 'Visite technique';
    out.push({
      id: `doc:${a.vehicleId}:${a.document}`, kind: 'document',
      level: a.daysLeft <= 7 ? 'urgent' : 'attention', link: '/vehicules', roles: FLEET,
      title: a.daysLeft < 0 ? `${what} expirée : ${vLabel(a.vehicleId)}` : `${what} à renouveler : ${vLabel(a.vehicleId)}`,
      detail: a.daysLeft < 0
        ? `Expirée depuis le ${dmy(a.date)}. Ne pas louer ce véhicule avant renouvellement.`
        : a.daysLeft === 0 ? `Expire aujourd’hui (${dmy(a.date)}).` : `Expire le ${dmy(a.date)}, dans ${a.daysLeft} jour${a.daysLeft > 1 ? 's' : ''}.`,
    });
  }

  for (const m of input.maintenances) {
    const s = Date.parse(m.start);
    if (s >= today && s < tomorrow) {
      out.push({
        id: `entretien:${m.id}`, kind: 'entretien_jour', level: 'info', link: '/maintenance', roles: ['direction', 'mecanicien'],
        title: `Entretien aujourd’hui : ${vLabel(m.vehicleId)}`,
        detail: `${m.label} à ${hhmm(m.start, offsetMin)}`,
      });
    }
  }

  // Entretiens périodiques : échéance dépassée ou proche (1 000 km ou 15 jours).
  for (const p of input.plans ?? []) {
    if (!p.active) continue;
    const v = vehicle(p.vehicleId);
    if (!v || v.outOfService) continue;
    const d = planDue(p, v, now);
    if (d.state === 'ok') continue;
    out.push({
      id: `plan:${p.id}`, kind: 'entretien_a_prevoir', level: d.state === 'depasse' ? 'attention' : 'info', link: `/maintenance`, roles: ['direction', 'mecanicien'],
      title: `${p.label} ${d.state === 'depasse' ? 'à faire' : 'à prévoir'} : ${vLabel(p.vehicleId)}`,
      detail: `Échéance ${d.text}`,
    });
  }

  // Chauffeurs VTC en retard de versement (2 jours ou plus).
  if (input.vtc) {
    for (const c of input.vtc.contracts) {
      if (c.status !== 'actif') continue;
      const b = vtcBalance(c, input.vtc.payments, input.vtc.expenses, now, input.vtc.adjustments);
      if (b.daysBehind < 2) continue;
      const name = input.vtc.drivers.find((d) => d.id === c.driverId)?.name ?? 'Chauffeur';
      out.push({
        id: `vtc:${c.id}`, kind: 'vtc_retard', level: b.daysBehind >= 5 ? 'urgent' : 'attention', link: `/vtc/${c.id}`, roles: ['direction', 'agent', 'comptable'],
        title: `Versements VTC en retard : ${name}`,
        detail: `${fcfa(b.balance)} dus (${b.daysBehind} jours) · ${vLabel(c.vehicleId)}${b.lastPaidOn ? ` · dernier versement le ${dmy(b.lastPaidOn)}` : ''}`,
      });
    }
  }

  for (const b of input.bookingRequests ?? []) {
    if (b.status !== 'nouvelle') continue;
    const soon = Date.parse(b.start) - t < 2 * DAY;
    out.push({
      id: `demande:${b.id}`, kind: 'demande_en_ligne', level: soon ? 'urgent' : 'attention', link: '/demandes', roles: OPS,
      title: `Demande en ligne à traiter : ${b.companyName ? `${b.companyName} (${b.name})` : b.name}`,
      detail: `${b.category} du ${dmy(b.start)} au ${dmy(b.end)}${soon ? ' · départ dans moins de 48 h' : ''}`,
    });
  }

  for (const d of input.declarations ?? []) {
    const r = input.reservations.find((x) => x.id === d.reservationId);
    if (d.status !== 'declare' || !r || r.status === 'annulee') continue;
    out.push({
      id: `acompte:${d.id}`, kind: 'acompte_declare', level: Date.parse(r.start) - t < DAY ? 'urgent' : 'attention', link: `/reservations/${r.id}`, roles: ['direction', 'agent', 'comptable'],
      title: `Acompte déclaré à vérifier : ${fcfa(d.amount)}`,
      detail: `${cName(r.clientId)} · ${d.method === 'wave' ? 'Wave' : 'Orange Money'} réf. ${d.reference} · contrat ${r.number}`,
    });
  }

  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.title.localeCompare(b.title, 'fr'));
}

/** Récapitulatif du matin activé par défaut pour ces profils ; chacun peut changer dans Paramètres. */
export function defaultDailyDigest(role: Role): boolean {
  return role === 'admin' || role === 'direction' || role === 'agent';
}

/** Les alertes qu'un profil doit voir. */
export function alertsFor(alerts: Alert[], role: Role): Alert[] {
  return role === 'admin' ? alerts : alerts.filter((a) => a.roles.includes(role));
}

// ---------------------------------------------------------------- récapitulatif email

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const sectionTitle: Record<AlertLevel, string> = {
  urgent: 'À traiter en priorité',
  attention: 'À suivre',
  info: 'Au programme aujourd’hui',
};
const sectionColor: Record<AlertLevel, string> = { urgent: '#B42318', attention: '#B54708', info: '#0B3954' };

/** Contenu de l'email du matin. Renvoie null s'il n'y a rien à signaler. */
export function digestEmail(orgName: string, alerts: Alert[], appUrl: string, dateLabel: string): { subject: string; text: string; html: string } | null {
  if (alerts.length === 0) return null;
  const urgent = alerts.filter((a) => a.level === 'urgent').length;
  const subject = urgent
    ? `${urgent} alerte${urgent > 1 ? 's' : ''} urgente${urgent > 1 ? 's' : ''} · ${orgName} · ${dateLabel}`
    : `Votre journée · ${orgName} · ${dateLabel}`;
  const base = appUrl.replace(/\/$/, '');
  const levels: AlertLevel[] = ['urgent', 'attention', 'info'];

  const text = [
    `Yoon Fleet · ${orgName} · ${dateLabel}`,
    '',
    ...levels.flatMap((l) => {
      const list = alerts.filter((a) => a.level === l);
      if (!list.length) return [];
      return [sectionTitle[l].toUpperCase(), ...list.map((a) => `- ${a.title}\n  ${a.detail}\n  ${base}${a.link}`), ''];
    }),
    `Ouvrir Yoon Fleet : ${base}/alertes`,
    'Pour ne plus recevoir ce récapitulatif : Paramètres > Notifications.',
  ].join('\n');

  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#F5F0E6;font-family:Arial,Helvetica,sans-serif;color:#1D2939">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px">
<tr><td style="padding:24px 28px;background:#0B3954;border-radius:12px 12px 0 0;color:#ffffff">
<div style="font-size:20px;font-weight:bold">yoon <span style="color:#E07B2E">fleet</span></div>
<div style="font-size:14px;opacity:.85;margin-top:4px">${esc(orgName)} · ${esc(dateLabel)}</div></td></tr>
${levels
  .map((l) => {
    const list = alerts.filter((a) => a.level === l);
    if (!list.length) return '';
    return `<tr><td style="padding:20px 28px 4px"><div style="font-size:13px;font-weight:bold;letter-spacing:.04em;text-transform:uppercase;color:${sectionColor[l]}">${sectionTitle[l]} (${list.length})</div></td></tr>
${list
  .map(
    (a) => `<tr><td style="padding:8px 28px"><a href="${esc(base + a.link)}" style="text-decoration:none;color:#1D2939;display:block;border-left:3px solid ${sectionColor[l]};padding:4px 0 4px 12px">
<div style="font-size:15px;font-weight:bold">${esc(a.title)}</div><div style="font-size:13px;color:#475467;margin-top:2px">${esc(a.detail)}</div></a></td></tr>`,
  )
  .join('\n')}`;
  })
  .join('\n')}
<tr><td style="padding:24px 28px"><a href="${esc(base)}/alertes" style="display:inline-block;background:#0B3954;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Ouvrir Yoon Fleet</a></td></tr>
<tr><td style="padding:0 28px 24px;font-size:12px;color:#667085">Vous recevez ce récapitulatif car il est activé dans votre compte. Pour l’arrêter : Paramètres, puis Notifications.</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
