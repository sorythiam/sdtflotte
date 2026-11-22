import { findConflicts, isActive, nextContractNumber, overlaps } from '../domain/rules';
import { buildAdjustment, buildCancellationFeeInvoice, buildCreditNote, buildFeesInvoice, buildInvoice, type BillingSettings, type Invoice, type NewInvoice } from '../domain/billing';
import { vtcOverlap } from '../domain/vtc';
import { dealFor, fitsPassengers, passengerSeats, priceFor } from '../domain/tariff';
import type { VtcContract } from '../domain/types';
import type { Client, Driver, Formula, Maintenance, Package, Rate, Reservation, Vehicle } from '../domain/types';
import type { Store } from './store';

export interface ReservationInput {
  vehicleId: string;
  clientId: string;
  start: string;
  end: string;
  withDriver: boolean;
  notes: string | null;
  formula?: Formula;
  packageId?: string | null;
  passengers?: number | null;
  driverId?: string | null;
  missionFees?: number;
  fuelIncluded?: boolean;
  itinerary?: string | null;
  crossBorder?: string | null;
}

export interface DataSnapshot {
  reservations: Reservation[];
  maintenances: Maintenance[];
  rates: Rate[];
  vehicles: (Pick<Vehicle, 'id' | 'category'> & Partial<Vehicle>)[];
  drivers?: Driver[];
  packages?: Package[];
  clients?: Client[];
  vtc_contracts?: VtcContract[];
}

/** Le chauffeur est-il déjà pris sur cette période ? */
export function driverConflict(driverId: string, start: string, end: string, reservations: Reservation[], ignoreId?: string): Reservation | undefined {
  return reservations.find((r) => r.driverId === driverId && r.id !== ignoreId && isActive(r) && overlaps(start, end, r.start, r.end));
}

/** Contrôles communs à la création et à la modification : capacité, chauffeur. */
function checkCrew(snap: DataSnapshot, vehicle: DataSnapshot['vehicles'][number] | undefined, input: { start: string; end: string; withDriver: boolean; passengers?: number | null; driverId?: string | null }, ignoreId?: string) {
  if (vehicle && input.passengers && !fitsPassengers(vehicle, input.passengers, input.withDriver)) {
    throw new Error(`Ce véhicule offre ${passengerSeats({ seats: vehicle.seats ?? null, driverRequired: vehicle.driverRequired }, input.withDriver)} places passagers pour ${input.passengers} passagers. Choisissez un véhicule plus grand.`);
  }
  if (input.driverId) {
    const d = snap.drivers?.find((x) => x.id === input.driverId);
    if (!d || !d.active) throw new Error('Chauffeur introuvable ou inactif.');
    if (!input.withDriver) throw new Error('Un chauffeur est choisi mais la location est sans chauffeur.');
    const busy = driverConflict(input.driverId, input.start, input.end, snap.reservations, ignoreId);
    if (busy) throw new Error(`${d.name} conduit déjà sur cette période (contrat ${busy.number}).`);
  }
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

/**
 * Annulation : avoirs sur les factures encore actives (avoirs partiels déjà émis déduits).
 * `keepTtc` = frais d'annulation conservés (TTC), par exemple l'acompte versé : ils restent dus,
 * et l'avoir ne porte que sur le reste. Sans facture, des frais d'annulation font l'objet d'une facture.
 */
export async function creditReservation(
  store: Store, invoices: Invoice[], reservationId: string, now = new Date(), keepTtc = 0,
  billing?: { r: Reservation; client?: Client; settings: BillingSettings },
): Promise<Invoice[]> {
  const mine = invoices.filter((i) => i.reservationId === reservationId);
  const active = mine.filter((i) => i.kind !== 'avoir').sort((x, y) => (x.kind === 'facture' ? -1 : 1) - (y.kind === 'facture' ? -1 : 1));
  const out: Invoice[] = [];
  if (active.length === 0) {
    if (keepTtc > 0 && billing?.client) out.push(await issueInvoice(store, buildCancellationFeeInvoice(billing.r, billing.client, billing.settings, now, keepTtc)));
    return out;
  }
  const vatRate = active[0].vatRate;
  const leftOf = (inv: Invoice) => inv.totalHt + mine.filter((x) => x.kind === 'avoir' && x.relatedInvoiceId === inv.id).reduce((sum, x) => sum + x.totalHt, 0);
  const totalLeft = active.reduce((sum, inv) => sum + Math.max(0, leftOf(inv)), 0);
  let keepHt = Math.min(totalLeft, Math.max(0, Math.round((keepTtc * 100) / (100 + vatRate))));
  const fee = keepHt > 0 ? `, frais d’annulation de ${new Intl.NumberFormat('fr-FR').format(Math.round(keepTtc))} FCFA TTC conservés` : '';
  for (const inv of active) {
    const left = leftOf(inv);
    if (left <= 0) continue;
    const retain = Math.min(keepHt, left);
    keepHt -= retain;
    const creditHt = left - retain;
    if (creditHt <= 0) continue;
    if (retain === 0 && left === inv.totalHt) {
      out.push(await issueInvoice(store, buildCreditNote(inv, now)));
      continue;
    }
    const full = buildCreditNote(inv, now);
    const vat = Math.round((creditHt * inv.vatRate) / 100);
    out.push(await issueInvoice(store, {
      ...full,
      lines: [{ label: `Annulation de la réservation${fee} : facture ${inv.number}`, quantity: 1, unit: 'forfait', unitPrice: -creditHt, amount: -creditHt }],
      totalHt: -creditHt, vat: -vat, totalTtc: -(creditHt + vat),
    }));
  }
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
  const formula = input.formula ?? 'jour';
  const vtc = vtcOverlap(input.vehicleId, input.start, input.end, snap.vtc_contracts);
  if (vtc) throw new Error(`Ce véhicule est confié à un chauffeur VTC (contrat ${vtc.number}).`);
  const pkg = formula === 'forfait' ? snap.packages?.find((k) => k.id === input.packageId) : undefined;
  if (formula !== 'forfait' && !rate) throw new Error(`Aucun tarif pour la catégorie ${vehicle?.category ?? '?'}. Ajoutez-le dans Tarifs.`);
  // Bus, minibus et forfaits : toujours avec chauffeur.
  const withDriver = input.withDriver || !!vehicle?.driverRequired || formula === 'forfait';
  const deal = dealFor(snap.clients?.find((c) => c.id === input.clientId), vehicle?.category, input.start);
  const q = priceFor({ formula, rate, pkg, start: input.start, end: input.end, withDriver, missionFees: input.missionFees, deal });
  checkCrew(snap, vehicle, { ...input, withDriver });
  const number = nextContractNumber(snap.reservations.map((r) => r.number), new Date(input.start).getFullYear());
  const created = await store.insert('reservations', {
    number,
    vehicleId: input.vehicleId,
    clientId: input.clientId,
    start: input.start,
    end: input.end,
    withDriver,
    status: 'reservee',
    dailyRate: q.dailyRate,
    total: q.total,
    caution: q.caution,
    fees: 0,
    mileageOut: null,
    mileageIn: null,
    notes: input.notes,
    createdAt: now.toISOString(),
    formula,
    packageLabel: q.label,
    passengers: input.passengers || null,
    driverId: input.driverId || null,
    missionFees: q.missionFees,
    fuelIncluded: !!input.fuelIncluded,
    itinerary: input.itinerary?.trim() || null,
    crossBorder: input.crossBorder?.trim() || null,
  });
  // La réservation validée est facturée tout de suite, aux modalités du client.
  if (billing) await invoiceReservation(store, billing, created, now);
  return created;
}

export interface AmendInput {
  start: string;
  end: string;
  total: number; // nouveau montant de la location, frais de mission compris
  reason: string | null;
  by: string | null;
  driverId?: string | null;
}

/**
 * Prolonge ou modifie un contrat : contrôle de disponibilité, avenant tracé,
 * facture complémentaire si le prix monte, avoir partiel s'il baisse.
 */
export async function amendReservation(store: Store, snap: DataSnapshot, b: BillingContext, r: Reservation, input: AmendInput, now = new Date()): Promise<Reservation> {
  if (r.status !== 'reservee' && r.status !== 'en_cours') throw new Error('Seul un contrat réservé ou en cours peut être modifié.');
  if (r.status === 'en_cours' && input.start !== r.start) throw new Error('Le véhicule est déjà parti : seule la date de retour peut changer.');
  if (!(Date.parse(input.end) > Date.parse(input.start))) throw new Error('La date de retour doit être après la date de départ.');
  const total = Math.round(input.total);
  if (!(total >= 0)) throw new Error('Montant invalide.');
  const conflicts = findConflicts(r.vehicleId, input.start, input.end, snap.reservations, snap.maintenances, r.id);
  if (conflicts.length) {
    const c = conflicts[0];
    throw new Error(c.kind === 'maintenance' ? `Véhicule en entretien sur la nouvelle période (${c.label}).` : `Véhicule déjà réservé sur la nouvelle période (contrat ${c.label}). Proposez un autre véhicule.`);
  }
  const driverId = input.driverId === undefined ? (r.driverId ?? null) : input.driverId;
  checkCrew(snap, snap.vehicles.find((v) => v.id === r.vehicleId), { start: input.start, end: input.end, withDriver: r.withDriver, passengers: r.passengers, driverId }, r.id);
  const dates = input.start !== r.start || input.end !== r.end;
  if (!dates && total === r.total && driverId === (r.driverId ?? null)) throw new Error('Rien n’a changé.');
  const updated = await store.update('reservations', r.id, { start: input.start, end: input.end, total, driverId });
  if (dates || total !== r.total) {
    await store.insert('reservation_changes', {
      reservationId: r.id, oldStart: r.start, oldEnd: r.end, newStart: input.start, newEnd: input.end,
      oldTotal: r.total, newTotal: total, reason: input.reason?.trim() || null, changedBy: input.by, createdAt: now.toISOString(),
    });
  }
  const delta = total - r.total;
  const mine = b.invoices.filter((i) => i.reservationId === r.id);
  const client = b.clients.find((c) => c.id === r.clientId);
  if (delta !== 0 && mine.length && client) {
    const first = mine.find((i) => i.kind === 'facture') ?? mine[0];
    await issueInvoice(store, buildAdjustment({ ...r, ...updated }, client, b.settings, now, delta, first, input.reason));
  }
  return { ...r, ...updated };
}
