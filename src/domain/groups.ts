// Dossiers de groupe : un client loue plusieurs véhicules pour la même mission.
// Chaque véhicule garde son contrat, sa facture et son état des lieux (règles fiscales et
// suivi par véhicule) ; le dossier les réunit pour le client : un relevé, un paiement global.

import { payState, type Invoice } from './billing';
import type { Payment, Reservation } from './types';

export interface ReservationGroup {
  id: string;
  number: string; // DO-2026-0001
  clientId: string;
  label: string | null; // ex. « Circuit Casamance, groupe Voyageurs du Monde »
  notes: string | null;
  createdAt: string;
}

export function nextGroupNumber(existing: string[], year: number): string {
  const prefix = `DO-${year}-`;
  const max = existing
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return prefix + String(max + 1).padStart(4, '0');
}

/**
 * Répartit les passagers d'un groupe entre les véhicules, dans l'ordre, sans dépasser
 * les places de chacun (null = places inconnues, prend le reste à parts égales).
 * Renvoie null pour un véhicule qui ne transporte personne.
 */
export function splitPassengers(total: number | null | undefined, capacities: (number | null)[]): (number | null)[] {
  const n = capacities.length;
  if (!total || total <= 0 || n === 0) return capacities.map(() => null);
  const out: number[] = capacities.map(() => 0);
  let left = total;
  // Tant qu'il reste du monde : on remplit à tour de rôle, une personne à la fois,
  // pour un partage équilibré (deux 4x4 à 5 places et 6 passagers : 3 + 3).
  let moved = true;
  while (left > 0 && moved) {
    moved = false;
    for (let i = 0; i < n && left > 0; i++) {
      const cap = capacities[i];
      if (cap === null || out[i] < cap) {
        out[i]++;
        left--;
        moved = true;
      }
    }
  }
  if (left > 0) out[n - 1] += left; // trop de monde : le contrôle de capacité le signalera
  return out.map((x) => (x > 0 ? x : null));
}

/** Places totales offertes par une sélection de véhicules (null si une capacité est inconnue). */
export function groupCapacity(capacities: (number | null)[]): number | null {
  return capacities.some((c) => c === null) ? null : capacities.reduce<number>((s, c) => s + (c ?? 0), 0);
}

export interface GroupSummary {
  reservations: Reservation[];
  active: Reservation[]; // hors annulées
  owed: number; // total TTC facturé, avoirs déduits
  paid: number;
  remaining: number;
  depositMissing: number;
  overdue: boolean;
  caution: number; // cautions demandées (contrats actifs)
}

export function groupSummary(groupId: string, reservations: Reservation[], invoices: Invoice[], payments: Payment[], now: Date): GroupSummary {
  const mine = reservations.filter((r) => r.groupId === groupId).sort((a, b) => a.start.localeCompare(b.start) || a.number.localeCompare(b.number));
  const active = mine.filter((r) => r.status !== 'annulee');
  let owed = 0, paid = 0, remaining = 0, depositMissing = 0, overdue = false;
  for (const r of mine) {
    const ps = payState(r, invoices, payments, now);
    owed += ps.owed;
    paid += ps.paid;
    remaining += ps.remaining;
    if (r.status === 'reservee') depositMissing += ps.depositMissing;
    if (ps.status === 'en_retard') overdue = true;
  }
  return { reservations: mine, active, owed, paid, remaining, depositMissing, overdue, caution: active.reduce((s, r) => s + r.caution, 0) };
}

export interface Allocation {
  reservationId: string;
  kind: 'acompte' | 'solde';
  amount: number;
}

/**
 * Répartit un paiement global du client entre les contrats du dossier :
 * d'abord les acomptes manquants, puis les soldes, dans l'ordre des départs.
 * Refuse un montant supérieur au reste dû (un trop-perçu se traite contrat par contrat).
 */
export function allocatePayment(
  amount: number,
  items: { reservationId: string; remaining: number; depositMissing: number; reserved: boolean }[],
): Allocation[] {
  const a = Math.round(amount);
  if (!(a > 0)) throw new Error('Montant invalide.');
  const due = items.reduce((s, i) => s + Math.max(0, i.remaining), 0);
  if (a > due) throw new Error(`Le reste dû sur le dossier est de ${new Intl.NumberFormat('fr-FR').format(due)} FCFA.`);
  const left = new Map(items.map((i) => [i.reservationId, Math.max(0, i.remaining)]));
  const out = new Map<string, Allocation>();
  let rest = a;
  const take = (id: string, kind: Allocation['kind'], max: number) => {
    const n = Math.min(rest, max, left.get(id) ?? 0);
    if (n <= 0) return;
    rest -= n;
    left.set(id, (left.get(id) ?? 0) - n);
    const prev = out.get(id);
    // Un même versement sur un contrat : acompte s'il en reste à couvrir, sinon solde.
    out.set(id, { reservationId: id, kind: prev?.kind ?? kind, amount: (prev?.amount ?? 0) + n });
  };
  for (const i of items) if (i.reserved && i.depositMissing > 0) take(i.reservationId, 'acompte', i.depositMissing);
  for (const i of items) take(i.reservationId, 'solde', Infinity);
  return [...out.values()];
}

/** Récapitulatif du dossier à envoyer au client par WhatsApp. */
export function groupMessage(
  g: Pick<ReservationGroup, 'number' | 'label'>,
  contact: string,
  sum: Pick<GroupSummary, 'active' | 'owed' | 'paid' | 'remaining' | 'depositMissing'>,
  vehicleLabel: (r: Reservation) => string,
  orgName: string,
  payees: string[],
): string {
  const fmt = (n: number) => `${new Intl.NumberFormat('fr-FR').format(n)} FCFA`;
  const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const lines = sum.active.map((r) => `- ${vehicleLabel(r)}, du ${day(r.start)} au ${day(r.end)} (contrat ${r.number})`);
  return [
    `Bonjour ${contact},`,
    `Voici le récapitulatif de votre dossier ${g.number}${g.label ? ` « ${g.label} »` : ''} : ${sum.active.length} véhicule${sum.active.length > 1 ? 's' : ''}.`,
    ...lines,
    `Total facturé : ${fmt(sum.owed)}. Déjà réglé : ${fmt(sum.paid)}. Reste à payer : ${fmt(sum.remaining)}${sum.depositMissing > 0 ? `, dont ${fmt(sum.depositMissing)} d'acompte pour confirmer` : ''}.`,
    ...(payees.length && sum.remaining > 0 ? [`Paiement : ${payees.join(' · ')}. Indiquez la référence ${g.number}.`] : []),
    `Cordialement, ${orgName}`,
  ].join('\n');
}
