// Prix d'une location (tarifs du loueur) selon la formule : à la journée, à la demi-journée ou au forfait (transfert, excursion).

import { billedDays, dailyRateFor } from './rules';
import type { Client, Formula, Package, Rate, Reservation, Vehicle } from './types';

/** Conditions négociées d'un contrat cadre, pour une catégorie donnée. */
export interface Deal {
  dailyRate?: number; // prix par jour négocié pour la catégorie (remplace la grille)
  discount: number; // remise en % sur la location (pas sur le chauffeur ni les frais de mission)
}

/** Le contrat cadre du client s'applique-t-il à cette catégorie, à cette date ? */
export function dealFor(c: Pick<Client, 'dealDiscount' | 'dealRates' | 'dealUntil'> | undefined, category: string | undefined, at: string | Date): Deal | null {
  if (!c) return null;
  const day = (typeof at === 'string' ? at : at.toISOString()).slice(0, 10);
  if (c.dealUntil && c.dealUntil < day) return null;
  const dailyRate = category ? c.dealRates?.[category] : undefined;
  const discount = Math.max(0, Math.min(60, c.dealDiscount ?? 0));
  if (!dailyRate && !discount) return null;
  return { dailyRate: dailyRate && dailyRate > 0 ? dailyRate : undefined, discount };
}

export function dealLabel(d: Deal | null | undefined): string | null {
  if (!d) return null;
  return d.dailyRate ? `prix négocié de ${d.dailyRate.toLocaleString('fr-FR')} FCFA par jour` : `remise de ${d.discount} %`;
}

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
  deal?: Deal | null; // contrat cadre du client
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
  dealNote: string | null; // « contrat cadre : remise de 10 % »
}

/** Calcule le prix ; lève une erreur lisible si la formule ne s'applique pas. */
export function priceFor(i: PriceInput): Price {
  const missionFees = Math.max(0, Math.round(i.missionFees ?? 0));
  const off = (n: number) => Math.round((n * (100 - (i.deal?.discount ?? 0))) / 100);
  const dealNote = i.deal ? `Contrat cadre : ${dealLabel(i.deal)}` : null;
  const ms = Date.parse(i.end) - Date.parse(i.start);
  if (!(ms > 0)) throw new Error('La date de retour doit être après la date de départ.');
  if (i.formula === 'forfait') {
    if (!i.pkg) throw new Error('Choisissez un forfait.');
    if (i.rate && i.pkg.category !== i.rate.category) throw new Error('Ce forfait ne correspond pas à la catégorie du véhicule.');
    const price = off(i.pkg.price);
    return {
      days: 1, dailyRate: price, rental: price, driver: 0, missionFees, total: price + missionFees,
      caution: i.rate?.caution ?? 0, kmIncluded: null, withDriver: true, label: i.pkg.label, dealNote: i.deal?.discount ? `Contrat cadre : remise de ${i.deal.discount} %` : null,
    };
  }
  if (!i.rate) throw new Error('Aucun tarif pour cette catégorie. Ajoutez-le dans Tarifs.');
  if (i.formula === 'demi_journee') {
    if (!i.rate.halfDay) throw new Error(`Pas de tarif demi-journée pour la catégorie ${i.rate.category}. Ajoutez-le dans Tarifs.`);
    if (ms > HALF_DAY_MAX_HOURS * 3600 * 1000) throw new Error(`Une demi-journée dure ${HALF_DAY_MAX_HOURS} heures au plus.`);
    const driver = i.withDriver ? Math.round(i.rate.driverDaily / 2) : 0;
    const half = i.deal?.dailyRate ? Math.round(i.deal.dailyRate / 2) : off(i.rate.halfDay);
    return {
      days: 1, dailyRate: half + driver, rental: half, driver, missionFees, total: half + driver + missionFees,
      caution: i.rate.caution, kmIncluded: Math.round(i.rate.kmPerDay / 2), withDriver: i.withDriver, label: null, dealNote,
    };
  }
  const days = billedDays(i.start, i.end);
  const base = i.deal?.dailyRate ?? off(dailyRateFor(i.rate, days, false));
  const driver = i.withDriver ? i.rate.driverDaily * days : 0;
  return {
    days, dailyRate: base + (i.withDriver ? i.rate.driverDaily : 0), rental: base * days, driver, missionFees,
    total: base * days + driver + missionFees, caution: i.rate.caution, kmIncluded: days * i.rate.kmPerDay, withDriver: i.withDriver, label: null, dealNote,
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
