import { findConflicts, isActive, nextContractNumber, overlaps } from '../domain/rules';
import { buildAdjustment, buildCancellationFeeInvoice, buildCreditNote, buildFeesInvoice, buildInvoice, type BillingSettings, type Invoice, type NewInvoice } from '../domain/billing';
import { vtcOverlap } from '../domain/vtc';
import { dealFor, fitsPassengers, passengerSeats, priceFor } from '../domain/tariff';
import type { Quote, Season, VtcContract } from '../domain/types';
import type { Client, Driver, Formula, Maintenance, Package, Rate, Reservation, Vehicle } from '../domain/types';
import type { Store } from './store';
import { normalizeFlight, validateFlight, type TransferKind } from '../domain/flight';
import { driverBlocker, type DriverAbsence } from '../domain/drivers';
import { allocatePayment, groupSummary, nextGroupNumber, splitPassengers, type ReservationGroup } from '../domain/groups';
import { payState } from '../domain/billing';
import { quoteSlots } from '../domain/quotes';
import type { Payment, PaymentMethod } from '../domain/types';

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
  transferKind?: TransferKind | null;
  flightNumber?: string | null;
  flightAt?: string | null;
  agreedTotal?: number; // prix convenu (devis accepté) : remplace le calcul de la grille
  groupId?: string | null; // dossier de groupe
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
  seasons?: Season[];
  driver_absences?: DriverAbsence[];
  reservation_groups?: ReservationGroup[];
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
    const blocker = driverBlocker(d, vehicle, input.start, input.end, snap.driver_absences ?? [], snap.vtc_contracts ?? []);
    if (blocker) throw new Error(blocker);
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
  const flightError = validateFlight(input, input.start);
  if (flightError) throw new Error(flightError);
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
  const q = priceFor({ formula, rate, pkg, start: input.start, end: input.end, withDriver, missionFees: input.missionFees, deal, seasons: snap.seasons });
  const total = input.agreedTotal !== undefined ? Math.max(0, Math.round(input.agreedTotal)) : q.total;
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
    total,
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
    ...(input.transferKind
      ? { transferKind: input.transferKind, flightNumber: normalizeFlight(input.flightNumber ?? ''), flightAt: input.flightAt ?? null }
      : {}),
    ...(input.groupId ? { groupId: input.groupId } : {}),
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

/** Ouvre un dossier de groupe pour un client. */
export async function openGroup(store: Store, snap: DataSnapshot, clientId: string, label: string | null, now = new Date()): Promise<ReservationGroup> {
  const number = nextGroupNumber((snap.reservation_groups ?? []).map((g) => g.number), now.getFullYear());
  return store.insert('reservation_groups', { number, clientId, label: label?.trim().slice(0, 120) || null, notes: null, createdAt: now.toISOString() });
}

export interface GroupLine {
  vehicleId: string;
  driverId?: string | null;
  agreedTotal?: number;
  withDriver?: boolean;
  missionFees?: number;
}

/**
 * Réserve plusieurs véhicules d'un coup pour un même client (dossier de groupe).
 * Tout est contrôlé avant de créer quoi que ce soit : véhicules libres, distincts,
 * chauffeurs distincts et disponibles, places suffisantes pour le groupe.
 */
export async function createGroupBooking(
  store: Store, snap: DataSnapshot, base: Omit<ReservationInput, 'vehicleId' | 'driverId' | 'agreedTotal' | 'groupId'>, lines: GroupLine[],
  label: string | null, now = new Date(), billing?: BillingContext, existingGroupId?: string | null,
): Promise<{ group: ReservationGroup | null; reservations: Reservation[] }> {
  const picked = lines.filter((l) => l.vehicleId);
  if (picked.length < 1) throw new Error('Choisissez au moins un véhicule.');
  if (new Set(picked.map((l) => l.vehicleId)).size !== picked.length) throw new Error('Le même véhicule est choisi deux fois.');
  const drivers = picked.map((l) => l.driverId).filter(Boolean);
  if (new Set(drivers).size !== drivers.length) throw new Error('Le même chauffeur est affecté à deux véhicules.');
  if (!base.clientId) throw new Error('Choisissez un client.');
  if (!(Date.parse(base.end) > Date.parse(base.start))) throw new Error('La date de retour doit être après la date de départ.');
  const vehicles = picked.map((l) => {
    const v = snap.vehicles.find((x) => x.id === l.vehicleId);
    if (!v) throw new Error('Véhicule introuvable.');
    return v;
  });
  const driverFor = (l: GroupLine, v: (typeof vehicles)[number]) => !!(l.withDriver ?? base.withDriver) || !!v.driverRequired || base.formula === 'forfait' || !!base.transferKind;
  const caps = vehicles.map((v, i) => (v.seats ? Math.max(0, v.seats - (driverFor(picked[i], v) ? 1 : 0)) : null));
  const pax = splitPassengers(base.passengers, caps);
  if (base.passengers) {
    const known = caps.every((c) => c !== null);
    const total = caps.reduce<number>((t, c) => t + (c ?? 0), 0);
    if (known && total < base.passengers) throw new Error(`Ces véhicules offrent ${total} places passagers pour ${base.passengers} passagers. Ajoutez un véhicule ou choisissez-en de plus grands.`);
  }
  for (let i = 0; i < picked.length; i++) {
    const v = vehicles[i];
    const c = findConflicts(v.id, base.start, base.end, snap.reservations, snap.maintenances)[0];
    if (c) throw new Error(`${v.plate ?? 'Un véhicule'} n’est pas libre sur cette période (${c.label}).`);
    if (vtcOverlap(v.id, base.start, base.end, snap.vtc_contracts)) throw new Error(`${v.plate ?? 'Un véhicule'} est confié à un chauffeur VTC.`);
    checkCrew(snap, v, { start: base.start, end: base.end, withDriver: driverFor(picked[i], v), passengers: pax[i], driverId: picked[i].driverId || null });
  }
  const group = existingGroupId ? null : picked.length > 1 ? await openGroup(store, snap, base.clientId, label, now) : null;
  const groupId = existingGroupId ?? group?.id ?? null;
  const created: Reservation[] = [];
  let reservations = snap.reservations;
  for (let i = 0; i < picked.length; i++) {
    const l = picked[i];
    const r = await createReservation(
      store, { ...snap, reservations },
      {
        ...base, vehicleId: l.vehicleId, driverId: l.driverId || null, passengers: pax[i], groupId,
        withDriver: driverFor(l, vehicles[i]),
        ...(l.missionFees !== undefined ? { missionFees: l.missionFees } : {}),
        ...(l.agreedTotal !== undefined ? { agreedTotal: l.agreedTotal } : {}),
      },
      now, billing,
    );
    created.push(r);
    reservations = [...reservations, r];
  }
  return { group, reservations: created };
}

/**
 * Transforme un devis accepté en réservations, une par véhicule choisi, au prix du devis.
 * Un devis à plusieurs véhicules ouvre un dossier de groupe. Tout est contrôlé avant de créer.
 */
export async function convertQuote(
  store: Store, snap: DataSnapshot, quote: Quote, vehicleIds: string[], now = new Date(), billing?: BillingContext,
): Promise<Reservation[]> {
  if (quote.status === 'converti' || quote.status === 'refuse') throw new Error('Ce devis est déjà clos.');
  const slots = quoteSlots(quote);
  const ids = vehicleIds.filter(Boolean);
  if (ids.length !== slots.length || new Set(ids).size !== ids.length) throw new Error(`Choisissez ${slots.length} véhicule${slots.length > 1 ? 's différents' : ''}.`);
  ids.forEach((id, i) => {
    const v = snap.vehicles.find((x) => x.id === id);
    if (!v) throw new Error('Véhicule introuvable.');
    if (v.category !== slots[i].category) throw new Error(`${v.plate ?? 'Ce véhicule'} n’est pas de la catégorie ${slots[i].category}.`);
  });
  const { reservations } = await createGroupBooking(
    store, snap,
    {
      clientId: quote.clientId, start: quote.start, end: quote.end, withDriver: quote.withDriver,
      notes: [`Devis ${quote.number}`, quote.notes].filter(Boolean).join(' · '), formula: quote.formula, packageId: quote.packageId,
      passengers: quote.passengers, fuelIncluded: quote.fuelIncluded, itinerary: quote.itinerary, crossBorder: quote.crossBorder,
    },
    ids.map((id, i) => ({ vehicleId: id, agreedTotal: slots[i].unitTotal, withDriver: slots[i].withDriver, missionFees: slots[i].missionFees })),
    `Devis ${quote.number}`, now, billing,
  );
  await store.update('quotes', quote.id, { status: 'converti', reservationIds: reservations.map((r) => r.id) });
  return reservations;
}

/**
 * Encaisse un paiement global pour un dossier : réparti entre les contrats
 * (acomptes manquants d'abord, puis soldes), un paiement enregistré par contrat.
 */
export async function payGroup(
  store: Store, groupId: string, data: { reservations: Reservation[]; invoices: Invoice[]; payments: Payment[] },
  amount: number, method: PaymentMethod, reference: string | null, now = new Date(),
): Promise<Payment[]> {
  const sum = groupSummary(groupId, data.reservations, data.invoices, data.payments, now);
  const items = sum.active.map((r) => {
    const ps = payState(r, data.invoices, data.payments, now);
    return { reservationId: r.id, remaining: ps.remaining, depositMissing: ps.depositMissing, reserved: r.status === 'reservee' };
  });
  const parts = allocatePayment(amount, items);
  const at = now.toISOString();
  const out: Payment[] = [];
  for (const p of parts) {
    out.push(await store.insert('payments', {
      reservationId: p.reservationId, kind: p.kind, amount: p.amount, method, status: 'paye', paidAt: at, createdAt: at,
      reference: method === 'especes' ? null : reference?.trim() || null,
    }));
  }
  return out;
}
