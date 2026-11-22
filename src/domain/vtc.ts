// Chauffeurs VTC : versement journalier, solde du chauffeur, location-vente, régularité.

import type { Expense, VtcCharge, VtcContract, VtcPayment } from './types';

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

export interface VtcBalance {
  expectedDays: number;
  expected: number; // versements attendus à ce jour
  charges: number; // dépenses à la charge du chauffeur
  paid: number;
  balance: number; // > 0 : le chauffeur doit ; < 0 : il a de l'avance
  daysBehind: number; // retard exprimé en jours de versement
  todayDue: number; // attendu aujourd'hui (0 si jour de repos ou contrat inactif)
  paidToday: number;
  lastPaidOn: string | null;
  regularity: number; // part des 30 derniers jours travaillés couverte par les versements (0 à 1)
  progress: number | null; // location-vente : part du véhicule payée (0 à 1)
  remainingPrice: number | null;
  estimatedEnd: string | null; // location-vente : date de fin estimée au rythme du contrat
}

/** Situation d'un contrat à une date donnée. */
export function vtcBalance(c: VtcContract, payments: VtcPayment[], expenses: Expense[], now: Date): VtcBalance {
  const today = isoDay(now);
  const active = c.status === 'actif' || c.status === 'suspendu';
  const until = active ? today : (c.endDate ?? today);
  const expectedDays = workingDays(c, until);
  const expected = expectedDays * c.dailyAmount;
  const mine = payments.filter((p) => p.contractId === c.id);
  const paid = mine.reduce((s, p) => s + p.amount, 0);
  const charges = expenses.filter((e) => e.vtcContractId === c.id && e.chargedTo === 'chauffeur').reduce((s, e) => s + e.amount, 0);
  const balance = expected + charges - paid;
  const todayDue = c.status === 'actif' && today >= c.startDate && (!c.endDate || today <= c.endDate) && !isRestDay(c, today) ? c.dailyAmount : 0;
  const paidToday = mine.filter((p) => p.paidOn === today).reduce((s, p) => s + p.amount, 0);
  const dates = mine.map((p) => p.paidOn).sort();
  const lastPaidOn = dates.length ? dates[dates.length - 1] : null;
  // Régularité : versements des 30 derniers jours rapportés à l'attendu sur la même fenêtre.
  const from = isoDay(new Date(Math.max(parse(c.startDate), parse(today) - 29 * DAY)));
  const windowDays = workingDays({ ...c, startDate: from }, until);
  const windowPaid = mine.filter((p) => p.paidOn >= from && p.paidOn <= today).reduce((s, p) => s + p.amount, 0);
  const regularity = windowDays ? Math.min(1, windowPaid / (windowDays * c.dailyAmount)) : 1;
  // Location-vente : les versements couvrent d'abord les dépenses à la charge du chauffeur, puis le véhicule.
  let progress: number | null = null;
  let remainingPrice: number | null = null;
  let estimatedEnd: string | null = null;
  if (c.formula === 'location_vente' && c.totalPrice) {
    const towardVehicle = Math.max(0, paid - charges);
    progress = Math.min(1, towardVehicle / c.totalPrice);
    remainingPrice = Math.max(0, c.totalPrice - towardVehicle);
    const perWeek = c.dailyAmount * (7 - new Set(c.restDays).size);
    if (perWeek > 0) estimatedEnd = isoDay(new Date(parse(today) + Math.ceil((remainingPrice / perWeek) * 7) * DAY));
  }
  return {
    expectedDays, expected, charges, paid, balance, daysBehind: balance > 0 ? Math.ceil(balance / c.dailyAmount) : 0,
    todayDue, paidToday, lastPaidOn, regularity, progress, remainingPrice, estimatedEnd,
  };
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
