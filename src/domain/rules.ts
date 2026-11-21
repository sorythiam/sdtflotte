import type {
  Maintenance,
  Payment,
  Rate,
  Reservation,
  Vehicle,
  VehicleStatus,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Les réservations qui bloquent encore le véhicule. */
export const ACTIVE_STATUSES = ['reservee', 'en_cours'] as const;

export function isActive(r: Pick<Reservation, 'status'>): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(r.status);
}

/** Deux intervalles [début, fin[ se chevauchent. Un retour à 12:00 et un départ à 12:00 ne se chevauchent pas. */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}

/** Nombre de jours facturés : toute journée entamée est due, minimum 1. */
export function billedDays(start: string, end: string): number {
  const ms = Date.parse(end) - Date.parse(start);
  if (!(ms > 0)) return 0;
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

/** Prix journalier selon la durée : tarif jour, semaine (7 j et plus) ou mois (30 j et plus). */
export function dailyRateFor(rate: Rate, days: number, withDriver: boolean): number {
  const base = days >= 30 ? rate.monthly : days >= 7 ? rate.weekly : rate.daily;
  return base + (withDriver ? rate.driverDaily : 0);
}

export interface Quote {
  days: number;
  dailyRate: number;
  total: number;
  caution: number;
  kmIncluded: number;
}

export function quote(rate: Rate, start: string, end: string, withDriver: boolean): Quote {
  const days = billedDays(start, end);
  const dailyRate = dailyRateFor(rate, days, withDriver);
  return {
    days,
    dailyRate,
    total: days * dailyRate,
    caution: rate.caution,
    kmIncluded: days * rate.kmPerDay,
  };
}

export interface Conflict {
  kind: 'reservation' | 'maintenance';
  id: string;
  label: string;
  start: string;
  end: string;
}

/** Ce qui empêche de louer ce véhicule sur cette période. */
export function findConflicts(
  vehicleId: string,
  start: string,
  end: string,
  reservations: Reservation[],
  maintenances: Maintenance[],
  ignoreReservationId?: string,
): Conflict[] {
  const out: Conflict[] = [];
  for (const r of reservations) {
    if (r.vehicleId !== vehicleId || r.id === ignoreReservationId || !isActive(r)) continue;
    if (overlaps(start, end, r.start, r.end)) {
      out.push({ kind: 'reservation', id: r.id, label: r.number, start: r.start, end: r.end });
    }
  }
  for (const m of maintenances) {
    if (m.vehicleId !== vehicleId) continue;
    if (overlaps(start, end, m.start, m.end)) {
      out.push({ kind: 'maintenance', id: m.id, label: m.label, start: m.start, end: m.end });
    }
  }
  return out;
}

/** Statut du véhicule à l'instant donné, déduit des locations et entretiens. */
export function vehicleStatusAt(
  v: Vehicle,
  now: Date,
  reservations: Reservation[],
  maintenances: Maintenance[],
): VehicleStatus {
  if (v.outOfService) return 'hors_service';
  const t = now.getTime();
  const inMaintenance = maintenances.some(
    (m) => m.vehicleId === v.id && Date.parse(m.start) <= t && t < Date.parse(m.end),
  );
  if (inMaintenance) return 'maintenance';
  const rented = reservations.some(
    (r) =>
      r.vehicleId === v.id &&
      (r.status === 'en_cours' ||
        (r.status === 'reservee' && Date.parse(r.start) <= t && t < Date.parse(r.end))),
  );
  return rented ? 'loue' : 'disponible';
}

/** Une location en cours dont la date de retour est passée. */
export function isLate(r: Reservation, now: Date): boolean {
  return r.status === 'en_cours' && Date.parse(r.end) < now.getTime();
}

export function lateDays(r: Reservation, now: Date): number {
  if (!isLate(r, now)) return 0;
  return Math.ceil((now.getTime() - Date.parse(r.end)) / DAY_MS);
}

/** Ce qui reste à payer sur la location et les frais (hors caution). */
/**
 * Reste à payer sur la location et les frais (hors caution). Avec les factures, la base est leur
 * total TTC (avoirs déduits) ; sans facture, le montant de la réservation.
 */
export function balanceDue(r: Reservation, payments: Payment[], invoices: { reservationId: string; totalTtc: number }[] = []): number {
  const mine = payments.filter((p) => p.reservationId === r.id && p.status === 'paye');
  const paid =
    mine.filter((p) => p.kind === 'acompte' || p.kind === 'solde' || p.kind === 'frais').reduce((s, p) => s + p.amount, 0) -
    mine.filter((p) => p.kind === 'remboursement').reduce((s, p) => s + p.amount, 0);
  const inv = invoices.filter((i) => i.reservationId === r.id);
  const owed = inv.length ? inv.reduce((s, i) => s + i.totalTtc, 0) : r.total + (r.fees ?? 0);
  return Math.max(0, owed - paid);
}

export function cautionHeld(reservationId: string, payments: Payment[]): number {
  const mine = payments.filter((p) => p.reservationId === reservationId && p.status === 'paye');
  const inn = mine.filter((p) => p.kind === 'caution').reduce((s, p) => s + p.amount, 0);
  const out = mine
    .filter((p) => p.kind === 'remboursement_caution')
    .reduce((s, p) => s + p.amount, 0);
  return Math.max(0, inn - out);
}

export interface ExpiryAlert {
  vehicleId: string;
  document: 'assurance' | 'visite technique' | 'vignette';
  date: string;
  daysLeft: number;
}

/** Documents expirés ou qui expirent dans `withinDays` jours. */
export function expiryAlerts(vehicles: Vehicle[], now: Date, withinDays = 30): ExpiryAlert[] {
  const out: ExpiryAlert[] = [];
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  for (const v of vehicles) {
    const docs: [ExpiryAlert['document'], string | null][] = [
      ['assurance', v.insuranceExpiry],
      ['visite technique', v.inspectionExpiry],
      ['vignette', v.vignetteExpiry],
    ];
    for (const [document, date] of docs) {
      if (!date) continue;
      const daysLeft = Math.round((Date.parse(date + 'T00:00:00Z') - today) / DAY_MS);
      if (daysLeft <= withinDays) out.push({ vehicleId: v.id, document, date, daysLeft });
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Numéro de contrat suivant pour l'année : CT-2026-0001. */
export function nextContractNumber(existing: string[], year: number): string {
  const prefix = `CT-${year}-`;
  const max = existing
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return prefix + String(max + 1).padStart(4, '0');
}

/** Taux d'occupation : véhicules loués / véhicules en service. */
export function occupancy(statuses: VehicleStatus[]): number {
  const inService = statuses.filter((s) => s !== 'hors_service').length;
  if (inService === 0) return 0;
  return statuses.filter((s) => s === 'loue').length / inService;
}

export interface ReturnInput {
  mileageIn: number;
  fuelQuartersMissing: number; // 0 à 4
  fuelQuarterPrice: number;
  damages: number;
  returnedAt: string;
}

export interface ReturnFees {
  kmDriven: number;
  kmExtra: number;
  kmFee: number;
  fuelFee: number;
  lateDays: number;
  lateFee: number;
  damages: number;
  total: number;
}

/** Frais complémentaires au retour : kilomètres en plus, carburant manquant, retard, dégâts. */
export function returnFees(r: Reservation, rate: Rate | undefined, input: ReturnInput): ReturnFees {
  const kmDriven = Math.max(0, input.mileageIn - (r.mileageOut ?? input.mileageIn));
  const included = billedDays(r.start, r.end) * (rate?.kmPerDay ?? 0);
  const kmExtra = rate ? Math.max(0, kmDriven - included) : 0;
  const kmFee = kmExtra * (rate?.extraKm ?? 0);
  const fuelFee = Math.max(0, Math.min(4, input.fuelQuartersMissing)) * input.fuelQuarterPrice;
  // Une heure de tolérance, puis chaque journée entamée de retard est due au tarif du contrat.
  const lateMs = Date.parse(input.returnedAt) - Date.parse(r.end) - 60 * 60 * 1000;
  const late = lateMs > 0 ? Math.ceil(lateMs / DAY_MS) : 0;
  const lateFee = late * r.dailyRate;
  const damages = Math.max(0, input.damages);
  return { kmDriven, kmExtra, kmFee, fuelFee, lateDays: late, lateFee, damages, total: kmFee + fuelFee + lateFee + damages };
}
