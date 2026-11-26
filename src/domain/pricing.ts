// Grille de l'offre SaaS Yoon Fleet (licence annuelle par véhicule, FCFA HT).
import type { Plan } from './types';

export const PLAN_INFO: Record<Plan, { label: string; perVehicleYear: number; minVehicles: number; users: string; summary: string }> = {
  essentiel: {
    label: 'Essentiel',
    perVehicleYear: 24000,
    minVehicles: 5,
    users: '3 utilisateurs',
    summary: 'Flotte, clients, réservations, contrats, planning, paiements',
  },
  pro: {
    label: 'Pro',
    perVehicleYear: 36000,
    minVehicles: 10,
    users: 'Utilisateurs illimités',
    summary: 'Essentiel + maintenance, frais au retour',
  },
  entreprise: {
    label: 'Entreprise',
    perVehicleYear: 48000,
    minVehicles: 30,
    users: 'Utilisateurs illimités',
    summary: 'Pro + support prioritaire',
  },
};

export const MONTHLY_SURCHARGE = 0.2; // paiement mensuel par mobile money : +20 %
export const VOLUME_THRESHOLD = 100; // -20 % sur chaque véhicule au-delà du 100e
export const VOLUME_DISCOUNT = 0.2;
export const QUOTE_LIMIT = 100; // au-delà : sur devis (grands comptes, négociés par l'équipe)

export type Billing = 'annuel' | 'mensuel';

export interface PriceQuote {
  plan: Plan;
  vehicles: number; // nombre demandé
  billedVehicles: number; // après minimum de la formule
  yearly: number; // licence annuelle, FCFA HT
  perMonth: number; // équivalent mensuel (annuel) ou mensualité (mensuel)
  billing: Billing;
  onQuote: boolean; // au-delà de 100 véhicules
}

export function priceFor(plan: Plan, vehicles: number, billing: Billing = 'annuel'): PriceQuote {
  const info = PLAN_INFO[plan];
  const n = Math.max(0, Math.floor(vehicles));
  const billedVehicles = Math.max(n, info.minVehicles);
  const full = Math.min(billedVehicles, VOLUME_THRESHOLD);
  const extra = Math.max(0, billedVehicles - VOLUME_THRESHOLD);
  const yearly = Math.round(full * info.perVehicleYear + extra * info.perVehicleYear * (1 - VOLUME_DISCOUNT));
  const perMonth = billing === 'mensuel' ? Math.round((yearly * (1 + MONTHLY_SURCHARGE)) / 12) : Math.round(yearly / 12);
  return { plan, vehicles: n, billedVehicles, yearly, perMonth, billing, onQuote: billedVehicles > QUOTE_LIMIT };
}
