// Rentabilité par véhicule : ce qu'il rapporte (locations, versements VTC), ce qu'il coûte
// (entretiens, dépenses à la charge du propriétaire), son occupation, et un avis clair :
// garder, surveiller ou vendre. Calculs purs, testés.

import { revenueInPeriod, type Period } from './reports';
import type { Expense, Maintenance, Reservation, Vehicle, VtcContract, VtcPayment } from './types';

const DAY = 86400000;

export type Verdict = 'star' | 'rentable' | 'sous_utilise' | 'fin_de_vie' | 'perte' | 'nouveau';

export const verdictLabel: Record<Verdict, [string, string, string]> = {
  star: ['Très rentable', 'badge-success', 'À garder ; un modèle à racheter.'],
  rentable: ['Rentable', '', 'À garder.'],
  sous_utilise: ['Sous-utilisé', 'badge-warning', 'Trop souvent au parking : baissez le prix, proposez-le en VTC ou en forfait.'],
  fin_de_vie: ['Fin de vie', 'badge-warning', 'L’entretien mange la marge : prévoyez de le vendre ou de le remplacer.'],
  perte: ['À perte', 'badge-danger', 'Il coûte plus qu’il ne rapporte : à vendre ou à remettre en état.'],
  nouveau: ['Trop récent', 'badge-muted', 'Moins de 30 jours dans la flotte sur la période : pas encore d’avis.'],
};

export interface ProfitLine {
  vehicleId: string;
  label: string; // marque modèle
  plate: string;
  category: string;
  year: number | null;
  mileage: number;
  daysInFleet: number; // jours de la période où le véhicule était disponible pour travailler
  rentalRevenue: number;
  vtcRevenue: number;
  revenue: number;
  maintenance: number;
  expenses: number; // dépenses à la charge du propriétaire
  costs: number;
  margin: number;
  marginRate: number | null; // marge / revenus
  marginPerMonth: number; // marge ramenée à 30 jours
  rentedDays: number;
  vtcDays: number;
  downtimeDays: number; // immobilisé en entretien
  occupancy: number; // 0 à 1 : jours loués ou en VTC / jours dans la flotte
  verdict: Verdict;
}

function overlapDays(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / DAY;
}

const counted = (r: Reservation) => r.status === 'en_cours' || r.status === 'terminee' || r.status === 'reservee';

export interface ProfitInput {
  vehicles: Vehicle[];
  reservations: Reservation[];
  maintenances: Maintenance[];
  expenses: Expense[];
  vtc_contracts: VtcContract[];
  vtc_payments: VtcPayment[];
}

/** Seuils de l'avis : occupation minimale et part de la marge mangée par l'entretien. */
export const THRESHOLDS = { lowOccupancy: 0.35, star: 0.55, wornCostShare: 0.45, wornKm: 200000, wornAge: 8 };

export function verdictFor(l: Pick<ProfitLine, 'daysInFleet' | 'margin' | 'marginRate' | 'occupancy' | 'costs' | 'revenue' | 'mileage' | 'year'>, now: Date): Verdict {
  if (l.daysInFleet < 30) return 'nouveau';
  if (l.margin < 0) return 'perte';
  const costShare = l.revenue > 0 ? l.costs / l.revenue : 1;
  const old = l.mileage >= THRESHOLDS.wornKm || (l.year !== null && now.getFullYear() - l.year >= THRESHOLDS.wornAge);
  if (old && costShare >= THRESHOLDS.wornCostShare) return 'fin_de_vie';
  if (l.occupancy < THRESHOLDS.lowOccupancy) return 'sous_utilise';
  if ((l.marginRate ?? 0) >= THRESHOLDS.star && l.occupancy >= 0.5) return 'star';
  return 'rentable';
}

export function computeProfitability(input: ProfitInput, p: Period, now: Date): ProfitLine[] {
  const ps = Date.parse(p.from);
  const pe = Math.min(Date.parse(p.to), now.getTime());
  const firstDay = p.from.slice(0, 10);
  const lastDay = new Date(pe - 1).toISOString().slice(0, 10);
  const contractOf = new Map(input.vtc_contracts.map((c) => [c.id, c]));

  return input.vehicles.map((v) => {
    // Jours dans la flotte : depuis l'entrée du véhicule s'il est arrivé pendant la période.
    const added = v.createdAt ? Date.parse(v.createdAt) : NaN;
    const from = Number.isFinite(added) && added > ps ? added : ps;
    const daysInFleet = Math.max(0, (pe - from) / DAY);

    const mine = input.reservations.filter((r) => r.vehicleId === v.id && counted(r));
    const rentalRevenue = mine.reduce((s, r) => s + revenueInPeriod(r, { from: p.from, to: new Date(pe).toISOString() }), 0);
    const rentedDays = mine.reduce((s, r) => s + overlapDays(Date.parse(r.start), Date.parse(r.end), ps, pe), 0);

    const contracts = input.vtc_contracts.filter((c) => c.vehicleId === v.id);
    const vtcRevenue = input.vtc_payments
      .filter((x) => contractOf.get(x.contractId)?.vehicleId === v.id && x.paidOn >= firstDay && x.paidOn <= lastDay)
      .reduce((s, x) => s + x.amount, 0);
    const vtcDays = contracts
      .filter((c) => c.status !== 'transfere' || c.endDate)
      .reduce((s, c) => s + overlapDays(Date.parse(c.startDate), c.endDate ? Date.parse(c.endDate) + DAY : pe, ps, pe), 0);

    const maint = input.maintenances.filter((m) => m.vehicleId === v.id);
    const maintenance = maint.filter((m) => Date.parse(m.start) >= ps && Date.parse(m.start) < pe).reduce((s, m) => s + m.cost, 0);
    const downtimeDays = maint.reduce((s, m) => s + overlapDays(Date.parse(m.start), Date.parse(m.end), ps, pe), 0);
    const expenses = input.expenses
      .filter((e) => e.vehicleId === v.id && e.chargedTo !== 'chauffeur' && e.date >= firstDay && e.date <= lastDay)
      .reduce((s, e) => s + e.amount, 0);

    const revenue = Math.round(rentalRevenue + vtcRevenue);
    const costs = maintenance + expenses;
    const margin = revenue - costs;
    const workable = Math.max(0, daysInFleet - Math.min(daysInFleet, downtimeDays));
    const occupancy = workable > 0 ? Math.min(1, (rentedDays + vtcDays) / workable) : 0;
    const base = {
      vehicleId: v.id,
      label: `${v.brand} ${v.model}`,
      plate: v.plate,
      category: v.category,
      year: v.year,
      mileage: v.mileage,
      daysInFleet: Math.round(daysInFleet),
      rentalRevenue: Math.round(rentalRevenue),
      vtcRevenue,
      revenue,
      maintenance,
      expenses,
      costs,
      margin,
      marginRate: revenue > 0 ? margin / revenue : null,
      marginPerMonth: daysInFleet > 0 ? Math.round((margin * 30) / daysInFleet) : 0,
      rentedDays,
      vtcDays,
      downtimeDays,
      occupancy,
    };
    return { ...base, verdict: verdictFor(base, now) };
  });
}

export interface ModelLine {
  label: string; // marque modèle, ou catégorie
  vehicles: number;
  marginPerMonth: number; // moyenne par véhicule
  occupancy: number;
}

/** Quel modèle rapporte le plus par véhicule et par mois : la réponse à « que racheter ? ». */
export function byModel(lines: ProfitLine[]): ModelLine[] {
  const m = new Map<string, ProfitLine[]>();
  for (const l of lines) if (l.daysInFleet >= 30) m.set(`${l.label} (${l.category})`, [...(m.get(`${l.label} (${l.category})`) ?? []), l]);
  return [...m.entries()]
    .map(([label, ls]) => ({
      label,
      vehicles: ls.length,
      marginPerMonth: Math.round(ls.reduce((s, l) => s + l.marginPerMonth, 0) / ls.length),
      occupancy: ls.reduce((s, l) => s + l.occupancy, 0) / ls.length,
    }))
    .sort((a, b) => b.marginPerMonth - a.marginPerMonth);
}
