// Abonnement Yoon Fleet en libre-service : état du compte, montant à payer (avec avoir
// au prorata du temps restant) et période couverte. Le même code tourne dans le navigateur
// (affichage) et dans la fonction serveur qui crée le paiement (montant qui fait foi).

import { PLAN_INFO, priceFor, type Billing } from './pricing';
import type { Organization, Plan } from './types';

const DAY = 86400000;

/** Jours accordés après l'échéance avant que le compte passe en lecture seule. */
export const GRACE_DAYS = 7;
/** Rappel de renouvellement : annuel 30 jours avant, mensuel 5 jours avant. */
export const NOTICE_DAYS: Record<Billing, number> = { annuel: 30, mensuel: 5 };
/** Montant minimum d'un paiement en ligne (FCFA). */
export const MIN_PAYMENT = 200;

export type SubState = 'essai' | 'actif' | 'a_renouveler' | 'grace' | 'bloque' | 'offert';

export interface SubStatus {
  state: SubState;
  until: string | null; // fin de l'essai ou de la période payée
  daysLeft: number | null; // négatif après l'échéance
  graceEnds: string | null;
}

export type SubPaymentStatus = 'en_attente' | 'payee' | 'echouee' | 'annulee';

/** Paiement d'abonnement par le loueur à Yoon Fleet. */
export interface SubscriptionPayment {
  id: string;
  plan: Plan;
  vehicles: number; // véhicules facturés (minimum de la formule compris)
  billing: Billing;
  baseHt: number; // prix de la période, avant avoir
  creditHt: number; // avoir sur la période en cours
  amountHt: number;
  vatRate: number;
  vat: number;
  amountTtc: number;
  provider: string; // paydunya, simulation
  status: SubPaymentStatus;
  periodStart: string | null; // fixée au paiement
  periodEnd: string | null;
  invoiceNumber: string | null; // YF-2026-0001, attribué au paiement
  paidAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** Où en est l'abonnement d'une entreprise. */
export function subscriptionStatus(org: Pick<Organization, 'trialEndsAt' | 'paidUntil' | 'billingCycle'>, now: Date): SubStatus {
  const end = org.paidUntil ?? org.trialEndsAt ?? null;
  if (!end) return { state: 'offert', until: null, daysLeft: null, graceEnds: null };
  const ms = Date.parse(end) - now.getTime();
  const daysLeft = Math.ceil(ms / DAY);
  const graceEnds = new Date(Date.parse(end) + GRACE_DAYS * DAY).toISOString();
  let state: SubState;
  if (ms >= 0) {
    if (!org.paidUntil) state = 'essai';
    else state = daysLeft <= NOTICE_DAYS[org.billingCycle ?? 'annuel'] ? 'a_renouveler' : 'actif';
  } else state = now.getTime() < Date.parse(graceEnds) ? 'grace' : 'bloque';
  return { state, until: end, daysLeft, graceEnds };
}

/** Ajoute une période (1 an ou 1 mois) à une date, en restant sur le même jour du mois quand il existe. */
export function addPeriod(fromIso: string, billing: Billing): string {
  const d = new Date(fromIso);
  const day = d.getUTCDate();
  if (billing === 'annuel') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  if (d.getUTCDate() !== day) d.setUTCDate(0); // 31 janvier + 1 mois = 28 ou 29 février
  return d.toISOString();
}

export interface CheckoutQuote {
  plan: Plan;
  billing: Billing;
  vehicles: number; // facturés
  baseHt: number;
  creditHt: number;
  amountHt: number;
  vatRate: number;
  vat: number;
  amountTtc: number;
  periodStart: string;
  periodEnd: string;
  error: string | null; // raison pour laquelle on ne peut pas payer
}

/**
 * Montant à payer pour une formule. La nouvelle période commence le jour du paiement ;
 * le temps déjà payé et non consommé est déduit (avoir au prorata). Ainsi un renouvellement
 * anticipé, un passage à Pro ou l'ajout de véhicules ne font jamais payer deux fois.
 */
export function checkoutQuote(
  input: { plan: Plan; vehicles: number; billing: Billing },
  current: { paidUntil: string | null; last: Pick<SubscriptionPayment, 'amountHt' | 'creditHt' | 'periodStart' | 'periodEnd'> | null },
  now: Date,
  vatRate = 0,
): CheckoutQuote {
  const q = priceFor(input.plan, input.vehicles, input.billing);
  const baseHt = input.billing === 'annuel' ? q.yearly : q.perMonth;
  let creditHt = 0;
  const last = current.last;
  if (current.paidUntil && last?.periodStart && last.periodEnd && Date.parse(current.paidUntil) > now.getTime()) {
    const span = Date.parse(last.periodEnd) - Date.parse(last.periodStart);
    const left = Math.min(span, Date.parse(current.paidUntil) - now.getTime());
    // Valeur payée de la période en cours (avoir compris), au prorata du temps restant.
    const paidValue = last.amountHt + last.creditHt;
    if (span > 0 && left > 0) creditHt = Math.round((paidValue * left) / span / 100) * 100;
  }
  creditHt = Math.min(creditHt, baseHt);
  const amountHt = baseHt - creditHt;
  const vat = Math.round((amountHt * vatRate) / 100);
  const start = now.toISOString();
  let error: string | null = null;
  if (q.onQuote) error = 'Au-delà de 300 véhicules, le prix se fait sur devis.';
  else if (!(input.vehicles >= 1)) error = 'Indiquez votre nombre de véhicules.';
  else if (amountHt + vat < MIN_PAYMENT)
    error = 'Votre abonnement en cours couvre déjà cette formule. Choisissez plus de véhicules ou une formule supérieure, ou renouvelez à l’échéance.';
  return {
    plan: input.plan,
    billing: input.billing,
    vehicles: q.billedVehicles,
    baseHt,
    creditHt,
    amountHt,
    vatRate,
    vat,
    amountTtc: amountHt + vat,
    periodStart: start,
    periodEnd: addPeriod(start, input.billing),
    error,
  };
}

export const subStateLabel: Record<SubState, [string, string]> = {
  essai: ['Essai gratuit', ''],
  actif: ['Abonnement actif', 'badge-success'],
  a_renouveler: ['À renouveler', 'badge-warning'],
  grace: ['Échéance dépassée', 'badge-danger'],
  bloque: ['Accès suspendu', 'badge-danger'],
  offert: ['Accès offert', 'badge-success'],
};

export const paymentStatusLabel: Record<SubPaymentStatus, [string, string]> = {
  en_attente: ['En attente', 'badge-muted'],
  payee: ['Payé', 'badge-success'],
  echouee: ['Échoué', 'badge-danger'],
  annulee: ['Annulé', 'badge-muted'],
};

/** Émetteur des factures d'abonnement. À compléter avec les mentions légales de la société qui exploite Yoon Fleet. */
export const SAAS_ISSUER = {
  name: 'Yoon Fleet',
  legalName: 'Yoon Fleet',
  address: 'Dakar, Sénégal',
  registration: '', // RCCM et NINEA de la société éditrice
  email: 'contact@yoonfleet.com',
};

export function planLabel(p: Plan): string {
  return PLAN_INFO[p].label;
}
