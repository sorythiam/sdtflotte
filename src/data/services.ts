import { findConflicts, nextContractNumber, quote } from '../domain/rules';
import type { Maintenance, Rate, Reservation } from '../domain/types';
import type { Store } from './store';

export interface ReservationInput {
  vehicleId: string;
  clientId: string;
  start: string;
  end: string;
  withDriver: boolean;
  notes: string | null;
}

export interface DataSnapshot {
  reservations: Reservation[];
  maintenances: Maintenance[];
  rates: Rate[];
  vehicles: { id: string; category: string }[];
}

/**
 * Crée une réservation après contrôle de disponibilité et calcul du prix.
 * En mode Supabase, la base refait le contrôle (contrainte d'exclusion) : deux agents
 * qui réservent le même véhicule au même instant ne peuvent pas passer tous les deux.
 */
export async function createReservation(
  store: Store,
  snap: DataSnapshot,
  input: ReservationInput,
  now = new Date(),
): Promise<Reservation> {
  if (!input.vehicleId || !input.clientId) throw new Error('Choisissez un véhicule et un client.');
  if (!(Date.parse(input.end) > Date.parse(input.start))) {
    throw new Error('La date de retour doit être après la date de départ.');
  }
  const conflicts = findConflicts(input.vehicleId, input.start, input.end, snap.reservations, snap.maintenances);
  if (conflicts.length) {
    const c = conflicts[0];
    throw new Error(
      c.kind === 'maintenance'
        ? `Véhicule en entretien sur cette période (${c.label}).`
        : `Véhicule déjà réservé sur cette période (${c.label}).`,
    );
  }
  const vehicle = snap.vehicles.find((v) => v.id === input.vehicleId);
  const rate = snap.rates.find((r) => r.category === vehicle?.category);
  if (!rate) throw new Error(`Aucun tarif pour la catégorie ${vehicle?.category ?? '?'}. Ajoutez-le dans Tarifs.`);
  const q = quote(rate, input.start, input.end, input.withDriver);
  const number = nextContractNumber(snap.reservations.map((r) => r.number), new Date(input.start).getFullYear());
  return store.insert('reservations', {
    number,
    vehicleId: input.vehicleId,
    clientId: input.clientId,
    start: input.start,
    end: input.end,
    withDriver: input.withDriver,
    status: 'reservee',
    dailyRate: q.dailyRate,
    total: q.total,
    caution: q.caution,
    fees: 0,
    mileageOut: null,
    mileageIn: null,
    notes: input.notes,
    createdAt: now.toISOString(),
  });
}
