// Chauffeurs VTC : versement journalier, solde du chauffeur, location-vente, régularité.

import type { Expense, VtcAdjustment, VtcAdjustmentKind, VtcCharge, VtcContract, VtcPayment } from './types';

export const VTC_CHARGES: [VtcCharge, string, 'proprietaire' | 'chauffeur'][] = [
  ['vidange', 'Vidange et entretien courant', 'proprietaire'],
  ['pneus', 'Pneus', 'proprietaire'],
  ['reparation', 'Grosses réparations', 'proprietaire'],
  ['assurance', 'Assurance et taxes', 'proprietaire'],
  ['carburant', 'Carburant', 'chauffeur'],
  ['amende', 'Amendes', 'chauffeur'],
  ['degats', 'Dégâts causés par le chauffeur', 'chauffeur'],
  ['lavage', 'Lavage', 'chauffeur'],
];
export const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export const PLATFORMS = ['Yango', 'Heetch', 'Uber', 'Taxi', 'Livraison', 'Autre'];

export const defaultCharges = (): VtcContract['charges'] => Object.fromEntries(VTC_CHARGES.map(([k, , who]) => [k, who]));

const DAY = 86400000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const parse = (iso: string) => Date.parse(iso.slice(0, 10) + 'T00:00:00Z');

/** Jours où un versement est attendu, du début du contrat jusqu'à `until` inclus (jours de repos exclus). */
export function workingDays(c: Pick<VtcContract, 'startDate' | 'endDate' | 'restDays'>, until: string): number {
  const end = c.endDate && c.endDate < until ? c.endDate : until;
  const a = parse(c.startDate);
  const b = parse(end);
  if (b < a) return 0;
  const total = Math.round((b - a) / DAY) + 1;
  const rest = new Set(c.restDays);
  if (rest.size === 0) return total;
  // Semaines entières, puis le reste jour par jour.
  const weeks = Math.floor(total / 7);
  let n = weeks * (7 - rest.size);
  const startDow = new Date(a).getUTCDay();
  for (let i = weeks * 7; i < total; i++) if (!rest.has((startDow + i) % 7)) n++;
  return n;
}

export const isRestDay = (c: Pick<VtcContract, 'restDays'>, day: string) => c.restDays.includes(new Date(parse(day)).getUTCDay());

export const ADJUSTMENT_LABELS: Record<VtcAdjustmentKind, string> = {
  jour_offert: 'Jour non dû',
  avance: 'Avance au chauffeur',
  remise: 'Remise accordée',
  retenue_caution: 'Retenue sur la caution',
};
export const DAY_OFF_REASONS = ['Véhicule au garage', 'Accident', 'Fête (Tabaski, Korité…)', 'Maladie du chauffeur', 'Autre'];

export interface VtcBalance {
  expectedDays: number;
  expected: number; // versements attendus à ce jour
  charges: number; // dépenses à la charge du chauffeur
  penalties: number; // pénalités de retard
  advances: number; // avances faites au chauffeur
  credits: number; // remises et retenues sur caution (réduisent le solde)
  paid: number;
  balance: number; // > 0 : le chauffeur doit ; < 0 : il a de l'avance
  daysBehind: number; // retard exprimé en jours de versement
  todayDue: number; // attendu aujourd'hui (0 si jour de repos, jour non dû ou contrat inactif)
  paidToday: number;
  lastPaidOn: string | null;
  regularity: number; // part des 30 derniers jours travaillés couverte par les versements (0 à 1)
  progress: number | null; // location-vente : part du véhicule payée (0 à 1)
  remainingPrice: number | null;
  estimatedEnd: string | null; // location-vente : date de fin estimée au rythme du contrat
  daysOff: number; // jours déclarés non dus
  cautionLeft: number; // caution moins les retenues déjà faites
}

const mineOf = <T extends { contractId: string }>(rows: T[] | undefined, id: string) => (rows ?? []).filter((r) => r.contractId === id);

/** Ce jour-là, un versement est-il attendu ? */
export function isDueDay(c: Pick<VtcContract, 'restDays' | 'startDate' | 'endDate'>, day: string, offDays: Set<string>): boolean {
  return day >= c.startDate && (!c.endDate || day <= c.endDate) && !isRestDay(c, day) && !offDays.has(day);
}

/** Situation d'un contrat à une date donnée. */
export function vtcBalance(c: VtcContract, payments: VtcPayment[], expenses: Expense[], now: Date, adjustments: VtcAdjustment[] = []): VtcBalance {
  const today = isoDay(now);
  const active = c.status === 'actif' || c.status === 'suspendu';
  const until = active ? today : (c.endDate ?? today);
  const adj = mineOf(adjustments, c.id);
  const offDays = new Set(adj.filter((a) => a.kind === 'jour_offert').map((a) => a.day));
  const mine = mineOf(payments, c.id).slice().sort((x, y) => x.paidOn.localeCompare(y.paidOn));

  // Jour par jour : versements attendus (hors repos et jours non dus) et pénalités de retard.
  let expectedDays = 0;
  let penalties = 0;
  const fee = Math.max(0, c.lateFee ?? 0);
  const grace = Math.max(0, c.graceDays ?? 2);
  let k = 0;
  let paidCum = 0;
  const end = c.endDate && c.endDate < until ? c.endDate : until;
  for (let t = parse(c.startDate); t <= parse(end); t += DAY) {
    const day = isoDay(new Date(t));
    // Pénalité du jour : jugée sur le retard accumulé la veille au soir, pour qu’un versement
    // le jour même ne la fasse pas disparaître (le solde ne bouge pas après coup).
    const arrears = expectedDays * c.dailyAmount - paidCum;
    while (k < mine.length && mine[k].paidOn <= day) paidCum += mine[k++].amount;
    if (!isDueDay(c, day, offDays)) continue;
    if (fee > 0 && arrears > grace * c.dailyAmount) penalties += fee;
    expectedDays++;
  }
  const daysOff = [...offDays].filter((d) => d >= c.startDate && d <= end && !isRestDay(c, d)).length;
  const expected = expectedDays * c.dailyAmount;
  const paid = mine.reduce((s, p) => s + p.amount, 0);
  const charges = expenses.filter((e) => e.vtcContractId === c.id && e.chargedTo === 'chauffeur').reduce((s, e) => s + e.amount, 0);
  const sum = (kind: VtcAdjustmentKind) => adj.filter((a) => a.kind === kind).reduce((s, a) => s + a.amount, 0);
  const advances = sum('avance');
  const retained = sum('retenue_caution');
  const credits = sum('remise') + retained;
  const balance = expected + charges + penalties + advances - credits - paid;
  const todayDue = c.status === 'actif' && isDueDay(c, today, offDays) ? c.dailyAmount : 0;
  const paidToday = mine.filter((p) => p.paidOn === today).reduce((s, p) => s + p.amount, 0);
  const lastPaidOn = mine.length ? mine[mine.length - 1].paidOn : null;
  // Régularité : versements des 30 derniers jours rapportés à l'attendu sur la même fenêtre.
  const from = isoDay(new Date(Math.max(parse(c.startDate), parse(today) - 29 * DAY)));
  let windowDays = 0;
  for (let t = parse(from); t <= parse(end); t += DAY) if (isDueDay(c, isoDay(new Date(t)), offDays)) windowDays++;
  const windowPaid = mine.filter((p) => p.paidOn >= from && p.paidOn <= today).reduce((s, p) => s + p.amount, 0);
  const regularity = windowDays ? Math.min(1, windowPaid / (windowDays * c.dailyAmount)) : 1;
  // Location-vente : les versements couvrent d'abord ce que le chauffeur doit en plus (dépenses, pénalités, avances), puis le véhicule.
  let progress: number | null = null;
  let remainingPrice: number | null = null;
  let estimatedEnd: string | null = null;
  if (c.formula === 'location_vente' && c.totalPrice) {
    const towardVehicle = Math.max(0, paid + credits - charges - penalties - advances);
    progress = Math.min(1, towardVehicle / c.totalPrice);
    remainingPrice = Math.max(0, c.totalPrice - towardVehicle);
    const perWeek = c.dailyAmount * (7 - new Set(c.restDays).size);
    if (perWeek > 0) estimatedEnd = isoDay(new Date(parse(today) + Math.ceil((remainingPrice / perWeek) * 7) * DAY));
  }
  return {
    expectedDays, expected, charges, penalties, advances, credits, paid, balance,
    daysBehind: balance > 0 ? Math.ceil(balance / c.dailyAmount) : 0,
    todayDue, paidToday, lastPaidOn, regularity, progress, remainingPrice, estimatedEnd, daysOff, cautionLeft: Math.max(0, c.caution - retained),
  };
}

export type DayState = 'paye' | 'partiel' | 'non_paye' | 'repos' | 'non_du' | 'hors_contrat';

/** Le point d'un jour pour un contrat : attendu, reçu, état. */
export function vtcDay(c: VtcContract, payments: VtcPayment[], adjustments: VtcAdjustment[], day: string): { due: number; paid: number; state: DayState } {
  const offDays = new Set(mineOf(adjustments, c.id).filter((a) => a.kind === 'jour_offert').map((a) => a.day));
  const paid = mineOf(payments, c.id).filter((p) => p.paidOn === day).reduce((s, p) => s + p.amount, 0);
  if (day < c.startDate || (c.endDate && day > c.endDate) || c.status === 'termine' || c.status === 'transfere') return { due: 0, paid, state: 'hors_contrat' };
  if (offDays.has(day)) return { due: 0, paid, state: 'non_du' };
  if (isRestDay(c, day) || c.status !== 'actif') return { due: 0, paid, state: 'repos' };
  const due = c.dailyAmount;
  return { due, paid, state: paid >= due ? 'paye' : paid > 0 ? 'partiel' : 'non_paye' };
}

/** Fin de contrat : ce que la caution couvre et ce qui revient au chauffeur. */
export function cautionSettlement(b: Pick<VtcBalance, 'balance' | 'cautionLeft'>): { retain: number; refund: number; stillOwed: number } {
  const owed = Math.max(0, b.balance);
  const retain = Math.min(owed, b.cautionLeft);
  return { retain, refund: b.cautionLeft - retain, stillOwed: owed - retain };
}

/** Espèces reçues par chaque encaisseur et pas encore remises au propriétaire. */
export function cashToHandOver(payments: VtcPayment[]): { collector: string; total: number; payments: VtcPayment[] }[] {
  const byWho = new Map<string, VtcPayment[]>();
  for (const p of payments) {
    if (p.method !== 'especes' || p.handedAt) continue;
    const who = p.collectedBy || p.createdBy || 'Inconnu';
    byWho.set(who, [...(byWho.get(who) ?? []), p]);
  }
  return [...byWho.entries()]
    .map(([collector, ps]) => ({ collector, total: ps.reduce((s, p) => s + p.amount, 0), payments: ps.sort((x, y) => x.paidOn.localeCompare(y.paidOn)) }))
    .sort((x, y) => y.total - x.total);
}

export function regularityGrade(r: number): [string, string] {
  if (r >= 0.95) return ['Très régulier', 'badge-success'];
  if (r >= 0.8) return ['Régulier', ''];
  if (r >= 0.6) return ['Irrégulier', 'badge-warning'];
  return ['À risque', 'badge-danger'];
}

/** Numéro suivant : VTC-2026-0001. */
export function nextVtcNumber(existing: string[], year: number): string {
  const head = `VTC-${year}-`;
  const max = existing.filter((n) => n.startsWith(head)).reduce((m, n) => Math.max(m, Number(n.slice(head.length)) || 0), 0);
  return `${head}${String(max + 1).padStart(4, '0')}`;
}

/** Reçu WhatsApp envoyé au chauffeur après chaque versement : sa preuve. */
export function receiptText(driverName: string, plate: string, p: Pick<VtcPayment, 'amount' | 'paidOn' | 'method' | 'reference'>, b: Pick<VtcBalance, 'balance'>, owner: string, methodName: string): string {
  const first = driverName.split(' ')[0];
  const fmt = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;
  const day = new Date(p.paidOn + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const state = b.balance > 0 ? `Reste à verser : ${fmt(b.balance)}.` : b.balance < 0 ? `Vous avez ${fmt(-b.balance)} d’avance.` : 'Vous êtes à jour.';
  return `Bonjour ${first}, ${owner} confirme avoir reçu ${fmt(p.amount)} le ${day} (${methodName}${p.reference ? `, réf. ${p.reference}` : ''}) pour le véhicule ${plate}. ${state} Merci.`;
}

/** Message de relance WhatsApp, poli et factuel. */
export function reminderText(driverName: string, plate: string, b: VtcBalance, owner: string): string {
  const first = driverName.split(' ')[0];
  const fmt = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;
  return `Bonjour ${first}, c’est ${owner}. Pour le véhicule ${plate}, le solde de vos versements est de ${fmt(b.balance)}` +
    `${b.daysBehind > 1 ? ` (${b.daysBehind} jours)` : ''}. Merci de régulariser aujourd’hui par Wave ou Orange Money et de nous envoyer la référence. Bonne route.`;
}

/** Le véhicule est-il confié en VTC à cette date ? (il n'est alors pas proposé à la location) */
export function inVtc(vehicleId: string, contracts: VtcContract[], day: string): VtcContract | undefined {
  return contracts.find((c) => c.vehicleId === vehicleId && c.status === 'actif' && c.startDate <= day && (!c.endDate || c.endDate >= day));
}

/** Contrat VTC actif qui occupe ce véhicule sur la période (le véhicule n'est pas louable). */
export function vtcOverlap(vehicleId: string, start: string, end: string, contracts: VtcContract[] | undefined): VtcContract | undefined {
  const a = start.slice(0, 10);
  const b = end.slice(0, 10);
  return (contracts ?? []).find((c) => c.vehicleId === vehicleId && (c.status === 'actif' || c.status === 'suspendu') && c.startDate <= b && (!c.endDate || c.endDate >= a));
}
