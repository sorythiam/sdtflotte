// Prix d'une location (tarifs du loueur) selon la formule : à la journée, à la demi-journée ou au forfait (transfert, excursion).

import { billedDays, dailyRateFor } from './rules';
import type { Formula, Package, Rate, Reservation, Vehicle } from './types';

export const FORMULAS: [Formula, string][] = [
  ['jour', 'À la journée'],
  ['demi_journee', 'Demi-journée (6 h au plus)'],
  ['forfait', 'Forfait (transfert, excursion)'],
];
export const HALF_DAY_MAX_HOURS = 6;

export interface PriceInput {
  formula: Formula;
  rate?: Rate;
  pkg?: Package;
  start: string;
  end: string;
  withDriver: boolean;
  missionFees?: number;
}

export interface Price {
  days: number; // jours facturés (1 pour une demi-journée ou un forfait)
  dailyRate: number; // prix d'une journée ou d'une unité, sert aussi au retard
  rental: number; // location seule
  driver: number; // part chauffeur
  missionFees: number;
  total: number; // tout compris, hors caution
  caution: number;
  kmIncluded: number | null; // null = kilométrage non compté (forfait)
  withDriver: boolean;
  label: string | null; // libellé du forfait
}

/** Calcule le prix ; lève une erreur lisible si la formule ne s'applique pas. */
export function priceFor(i: PriceInput): Price {
  const missionFees = Math.max(0, Math.round(i.missionFees ?? 0));
  const ms = Date.parse(i.end) - Date.parse(i.start);
  if (!(ms > 0)) throw new Error('La date de retour doit être après la date de départ.');
  if (i.formula === 'forfait') {
    if (!i.pkg) throw new Error('Choisissez un forfait.');
    if (i.rate && i.pkg.category !== i.rate.category) throw new Error('Ce forfait ne correspond pas à la catégorie du véhicule.');
    return {
      days: 1, dailyRate: i.pkg.price, rental: i.pkg.price, driver: 0, missionFees, total: i.pkg.price + missionFees,
      caution: i.rate?.caution ?? 0, kmIncluded: null, withDriver: true, label: i.pkg.label,
    };
  }
  if (!i.rate) throw new Error('Aucun tarif pour cette catégorie. Ajoutez-le dans Tarifs.');
  if (i.formula === 'demi_journee') {
    if (!i.rate.halfDay) throw new Error(`Pas de tarif demi-journée pour la catégorie ${i.rate.category}. Ajoutez-le dans Tarifs.`);
    if (ms > HALF_DAY_MAX_HOURS * 3600 * 1000) throw new Error(`Une demi-journée dure ${HALF_DAY_MAX_HOURS} heures au plus.`);
    const driver = i.withDriver ? Math.round(i.rate.driverDaily / 2) : 0;
    return {
      days: 1, dailyRate: i.rate.halfDay + driver, rental: i.rate.halfDay, driver, missionFees, total: i.rate.halfDay + driver + missionFees,
      caution: i.rate.caution, kmIncluded: Math.round(i.rate.kmPerDay / 2), withDriver: i.withDriver, label: null,
    };
  }
  const days = billedDays(i.start, i.end);
  const base = dailyRateFor(i.rate, days, false);
  const driver = i.withDriver ? i.rate.driverDaily * days : 0;
  return {
    days, dailyRate: base + (i.withDriver ? i.rate.driverDaily : 0), rental: base * days, driver, missionFees,
    total: base * days + driver + missionFees, caution: i.rate.caution, kmIncluded: days * i.rate.kmPerDay, withDriver: i.withDriver, label: null,
  };
}

/** Kilomètres inclus dans un contrat ; null = non comptés. */
export function kmIncludedFor(r: Pick<Reservation, 'start' | 'end' | 'formula'>, rate: Rate | undefined): number | null {
  if (r.formula === 'forfait') return null;
  if (!rate) return 0;
  if (r.formula === 'demi_journee') return Math.round(rate.kmPerDay / 2);
  return billedDays(r.start, r.end) * rate.kmPerDay;
}

/** Le véhicule peut-il transporter ce groupe ? Places inconnues = on laisse l'agent juger. */
export function fitsPassengers(v: Pick<Vehicle, 'seats'>, passengers: number | null | undefined, withDriver: boolean): boolean {
  if (!passengers || !v.seats) return true;
  return passengers <= v.seats - (withDriver ? 1 : 0);
}

/** Places offertes aux passagers (le chauffeur occupe une place). */
export function passengerSeats(v: Pick<Vehicle, 'seats' | 'driverRequired'>, withDriver: boolean): number | null {
  if (!v.seats) return null;
  return Math.max(0, v.seats - (withDriver || v.driverRequired ? 1 : 0));
}

export const formulaLabel = (f: Formula | undefined) => FORMULAS.find(([k]) => k === (f ?? 'jour'))?.[1] ?? 'À la journée';
