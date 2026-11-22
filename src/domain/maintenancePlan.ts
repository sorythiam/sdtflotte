// Entretien périodique : prochaine échéance en kilomètres et en date, la première atteinte compte.

import type { MaintenancePlan, Vehicle } from './types';

export const PLAN_TEMPLATES: { label: string; everyKm: number | null; everyMonths: number | null }[] = [
  { label: 'Vidange moteur et filtre', everyKm: 10000, everyMonths: 6 },
  { label: 'Révision complète', everyKm: 30000, everyMonths: 12 },
  { label: 'Plaquettes de frein', everyKm: 30000, everyMonths: null },
  { label: 'Pneus', everyKm: 50000, everyMonths: null },
  { label: 'Climatisation', everyKm: null, everyMonths: 12 },
  { label: 'Courroie de distribution', everyKm: 90000, everyMonths: 60 },
];

export type PlanState = 'ok' | 'bientot' | 'depasse';

export interface PlanDue {
  plan: MaintenancePlan;
  nextKm: number | null;
  nextDate: string | null;
  kmLeft: number | null;
  daysLeft: number | null;
  state: PlanState;
  text: string; // « dans 800 km » / « dépassé de 1 200 km » / « le 3 janv. »
}

export const SOON_KM = 1000;
export const SOON_DAYS = 15;

function addMonths(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** Échéance d'un plan pour un véhicule, à la date donnée. Sans point de départ, on part de la création du plan. */
export function planDue(plan: MaintenancePlan, vehicle: Pick<Vehicle, 'mileage'>, now: Date): PlanDue {
  const nextKm = plan.everyKm ? (plan.lastKm ?? 0) + plan.everyKm : null;
  const base = plan.lastDate ?? plan.createdAt.slice(0, 10);
  const nextDate = plan.everyMonths ? addMonths(base, plan.everyMonths) : null;
  const kmLeft = nextKm !== null ? nextKm - vehicle.mileage : null;
  const today = Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00Z');
  const daysLeft = nextDate ? Math.round((Date.parse(nextDate + 'T00:00:00Z') - today) / 86400000) : null;
  const over = (kmLeft !== null && kmLeft < 0) || (daysLeft !== null && daysLeft < 0);
  const soon = !over && ((kmLeft !== null && kmLeft <= SOON_KM) || (daysLeft !== null && daysLeft <= SOON_DAYS));
  const fmt = (n: number) => n.toLocaleString('fr-FR');
  const parts: string[] = [];
  if (kmLeft !== null) parts.push(kmLeft < 0 ? `dépassé de ${fmt(-kmLeft)} km` : `dans ${fmt(kmLeft)} km`);
  if (daysLeft !== null) parts.push(daysLeft < 0 ? `en retard de ${-daysLeft} jour(s)` : daysLeft === 0 ? 'aujourd’hui' : `dans ${daysLeft} jour(s)`);
  return { plan, nextKm, nextDate, kmLeft, daysLeft, state: over ? 'depasse' : soon ? 'bientot' : 'ok', text: parts.join(' ou ') };
}
