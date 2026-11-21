import { findConflicts, nextContractNumber, quote } from '../domain/rules';
import { buildCreditNote, buildFeesInvoice, buildInvoice, type BillingSettings, type Invoice, type NewInvoice } from '../domain/billing';
import type { Client, Maintenance, Rate, Reservation, Vehicle } from '../domain/types';
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

/** Ce qu'il faut pour facturer : les réglages de l'entreprise et la fiche client. */
export interface BillingContext {
  settings: BillingSettings;
  clients: Client[];
  vehicles: Vehicle[];
  rates: Rate[];
  invoices: Invoice[];
}

/** Émet une facture : le numéro est attribué par la base (ou par la démo), sans trou. */
export function issueInvoice(store: Store, inv: NewInvoice): Promise<Invoice> {
  return store.insert('invoices', { ...inv, number: '' } as never) as unknown as Promise<Invoice>;
}

/** Facture initiale d'une réservation validée. */
export async function invoiceReservation(store: Store, b: BillingContext, r: Reservation, now = new Date()): Promise<Invoice> {
  const client = b.clients.find((c) => c.id === r.clientId);
  if (!client) throw new Error('Client introuvable pour la facture.');
  const vehicle = b.vehicles.find((v) => v.id === r.vehicleId);
  return issueInvoice(store, buildInvoice(r, client, vehicle, b.rates.find((x) => x.category === vehicle?.category), b.settings, now));
}

/** Facture complémentaire des frais constatés au retour. */
export async function invoiceFees(store: Store, b: BillingContext, r: Reservation, detail: string, now = new Date()): Promise<Invoice | null> {
  if (!(r.fees > 0)) return null;
  const client = b.clients.find((c) => c.id === r.clientId);
  if (!client) return null;
  return issueInvoice(store, buildFeesInvoice(r, client, b.settings, now, detail));
}

/** Avoirs pour toutes les factures encore actives d'une réservation annulée. */
export async function creditReservation(store: Store, invoices: Invoice[], reservationId: string, now = new Date()): Promise<Invoice[]> {
  const mine = invoices.filter((i) => i.reservationId === reservationId);
  const credited = new Set(mine.filter((i) => i.kind === 'avoir').map((i) => i.relatedInvoiceId));
  const out: Invoice[] = [];
  for (const inv of mine.filter((i) => i.kind !== 'avoir' && !credited.has(i.id))) out.push(await issueInvoice(store, buildCreditNote(inv, now)));
  return out;
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
  billing?: BillingContext,
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
  const created = await store.insert('reservations', {
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
  // La réservation validée est facturée tout de suite, aux modalités du client.
  if (billing) await invoiceReservation(store, billing, created, now);
  return created;
}
