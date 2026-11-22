// Rapports de pilotage et journal comptable. Calculs purs, testés.
//
// Principe : le chiffre d'affaires d'une location est réparti au prorata du temps passé
// dans la période (une location du 28 au 3 compte en partie sur chaque mois). Les frais
// constatés au retour sont rattachés au jour du retour. Les encaissements sont comptés
// à leur date de paiement.

import type { Invoice } from './billing';
import { expensesIn } from './expenses';
import type { Client, Expense, Maintenance, Payment, PaymentMethod, Reservation, Vehicle } from './types';

const DAY = 86400000;

export interface Period {
  from: string; // ISO, inclus
  to: string; // ISO, exclu
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** Locations qui comptent dans le chiffre d'affaires (ni annulées). */
function counted(r: Reservation): boolean {
  return r.status === 'en_cours' || r.status === 'terminee' || r.status === 'reservee';
}

/** Part du montant d'une location qui tombe dans la période. */
export function revenueInPeriod(r: Reservation, p: Period): number {
  if (!counted(r)) return 0;
  const s = Date.parse(r.start);
  const e = Date.parse(r.end);
  const ps = Date.parse(p.from);
  const pe = Date.parse(p.to);
  const span = e - s;
  const base = span > 0 ? (r.total * overlapMs(s, e, ps, pe)) / span : 0;
  const fees = r.fees && e >= ps && e < pe ? r.fees : 0;
  return base + fees;
}

/** Jours loués d'un véhicule dans la période (en jours décimaux). */
function rentedDays(vehicleId: string, reservations: Reservation[], p: Period): number {
  const ps = Date.parse(p.from);
  const pe = Date.parse(p.to);
  return reservations
    .filter((r) => r.vehicleId === vehicleId && counted(r))
    .reduce((sum, r) => sum + overlapMs(Date.parse(r.start), Date.parse(r.end), ps, pe) / DAY, 0);
}

export interface VehicleLine {
  vehicleId: string;
  label: string;
  plate: string;
  category: string;
  rentedDays: number;
  occupancy: number; // 0 à 1
  revenue: number;
  maintenance: number;
  expenses: number; // carburant, pneus, réparations, amendes… (page Dépenses)
  margin: number; // CA − entretien − dépenses
}

export interface ClientLine {
  clientId: string;
  name: string;
  rentals: number;
  revenue: number;
}

export interface Report {
  days: number;
  revenue: number;
  collected: number; // encaissements de location et frais (hors cautions)
  maintenance: number;
  expenses: number;
  margin: number;
  occupancy: number;
  fees: number; // frais au retour : km, carburant, retards, dégâts
  rentals: number; // locations qui touchent la période
  vehicles: VehicleLine[];
  clients: ClientLine[];
}

export function computeReport(
  input: { vehicles: Vehicle[]; clients: Client[]; reservations: Reservation[]; payments: Payment[]; maintenances: Maintenance[]; expenses?: Expense[] },
  p: Period,
): Report {
  const ps = Date.parse(p.from);
  const pe = Date.parse(p.to);
  const days = Math.max(0, (pe - ps) / DAY);
  const periodExpenses = expensesIn(input.expenses ?? [], p.from, p.to);
  const inPeriod = input.reservations.filter((r) => counted(r) && overlapMs(Date.parse(r.start), Date.parse(r.end), ps, pe) > 0);

  const vehicles: VehicleLine[] = input.vehicles.map((v) => {
    const rd = rentedDays(v.id, input.reservations, p);
    const revenue = input.reservations.filter((r) => r.vehicleId === v.id).reduce((s, r) => s + revenueInPeriod(r, p), 0);
    const maintenance = input.maintenances
      .filter((m) => m.vehicleId === v.id && Date.parse(m.start) >= ps && Date.parse(m.start) < pe)
      .reduce((s, m) => s + m.cost, 0);
    const expenses = periodExpenses.filter((e) => e.vehicleId === v.id).reduce((s, e) => s + e.amount, 0);
    return {
      vehicleId: v.id,
      label: `${v.brand} ${v.model}`,
      plate: v.plate,
      category: v.category,
      rentedDays: rd,
      occupancy: days && !v.outOfService ? Math.min(1, rd / days) : 0,
      revenue,
      maintenance,
      expenses,
      margin: revenue - maintenance - expenses,
    };
  });

  const byClient = new Map<string, ClientLine>();
  for (const r of input.reservations) {
    const rev = revenueInPeriod(r, p);
    if (rev <= 0) continue;
    const c = input.clients.find((x) => x.id === r.clientId);
    const line = byClient.get(r.clientId) ?? { clientId: r.clientId, name: c?.name ?? '—', rentals: 0, revenue: 0 };
    line.rentals += 1;
    line.revenue += rev;
    byClient.set(r.clientId, line);
  }

  const collected = input.payments
    .filter((x) => x.status === 'paye' && x.paidAt && Date.parse(x.paidAt) >= ps && Date.parse(x.paidAt) < pe)
    .reduce((s, x) => s + (x.kind === 'acompte' || x.kind === 'solde' || x.kind === 'frais' ? x.amount : x.kind === 'remboursement' ? -x.amount : 0), 0);

  const inService = input.vehicles.filter((v) => !v.outOfService);
  const totalRented = inService.reduce((s, v) => s + rentedDays(v.id, input.reservations, p), 0);
  const revenue = vehicles.reduce((s, v) => s + v.revenue, 0);
  const maintenance = vehicles.reduce((s, v) => s + v.maintenance, 0);
  // Toutes les dépenses de la période, y compris celles d'un véhicule supprimé depuis.
  const expenses = periodExpenses.reduce((s, e) => s + e.amount, 0);

  return {
    days,
    revenue,
    collected,
    maintenance,
    expenses,
    margin: revenue - maintenance - expenses,
    occupancy: days && inService.length ? Math.min(1, totalRented / (days * inService.length)) : 0,
    fees: input.reservations.filter((r) => counted(r) && r.fees && Date.parse(r.end) >= ps && Date.parse(r.end) < pe).reduce((s, r) => s + r.fees, 0),
    rentals: inPeriod.length,
    vehicles: vehicles.sort((a, b) => b.margin - a.margin),
    clients: [...byClient.values()].sort((a, b) => b.revenue - a.revenue),
  };
}

/** Chiffre d'affaires des n derniers mois civils, le plus ancien d'abord. */
export function monthlyRevenue(reservations: Reservation[], now: Date, n = 6): { month: string; from: string; revenue: number }[] {
  const out: { month: string; from: string; revenue: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const p = { from: from.toISOString(), to: to.toISOString() };
    out.push({
      month: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`,
      from: p.from,
      revenue: reservations.reduce((s, r) => s + revenueInPeriod(r, p), 0),
    });
  }
  return out;
}

// ---------------------------------------------------------------- journal SYSCOHADA

export interface AccountPlan {
  cash: string; // espèces
  bank: string; // virement, carte
  mobileMoney: string; // Wave, Orange Money, etc.
  revenue: string; // locations et frais
  deposits: string; // cautions reçues
  customers: string; // clients (factures émises, encaissements)
  vat: string; // TVA facturée
}

/** Comptes proposés par défaut, à valider par le comptable. */
export const DEFAULT_ACCOUNTS: AccountPlan = {
  cash: '571100',
  bank: '521100',
  mobileMoney: '521800',
  revenue: '706100',
  deposits: '165000',
  customers: '411100',
  vat: '443100',
};

export interface JournalLine {
  date: string; // AAAA-MM-JJ
  journal: string; // code journal
  piece: string; // numéro du contrat
  account: string;
  label: string;
  debit: number;
  credit: number;
}

function treasuryAccount(m: PaymentMethod, plan: AccountPlan): { account: string; journal: string } {
  if (m === 'especes') return { account: plan.cash, journal: 'CA' };
  if (m === 'virement' || m === 'carte' || m === 'cheque') return { account: plan.bank, journal: 'BQ' };
  return { account: plan.mobileMoney, journal: 'MM' };
}

const kindText: Record<Payment['kind'], string> = {
  acompte: 'Acompte location',
  solde: 'Solde location',
  frais: 'Frais au retour',
  caution: 'Caution reçue',
  remboursement_caution: 'Remboursement caution',
  remboursement: 'Remboursement trop-perçu',
};

/**
 * Une écriture équilibrée par encaissement payé dans la période :
 * locations et frais → trésorerie au débit, produits au crédit ;
 * caution reçue → trésorerie / dépôts reçus ; remboursement → l'inverse.
 * Montants HT tels que saisis : la TVA éventuelle est à traiter par le comptable.
 */
const pad2 = (n: number) => String(n).padStart(2, '0');
function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function journalEntries(
  payments: Payment[],
  reservations: Reservation[],
  clients: Client[],
  p: Period,
  plan: AccountPlan = DEFAULT_ACCOUNTS,
  invoices: Invoice[] = [],
): JournalLine[] {
  const ps = Date.parse(p.from);
  const pe = Date.parse(p.to);
  const out: JournalLine[] = [];
  const acc = { ...DEFAULT_ACCOUNTS, ...plan };

  // Journal des ventes : chaque facture émise (avoir en sens inverse) au débit du client, HT et TVA au crédit.
  const firstDay = localDate(p.from);
  const lastDay = localDate(new Date(pe - 1).toISOString());
  for (const inv of invoices.filter((i) => i.issueDate >= firstDay && i.issueDate <= lastDay).sort((a, b) => a.number.localeCompare(b.number))) {
    const label = `${inv.kind === 'avoir' ? 'Avoir' : 'Facture'} ${inv.number} ${inv.billTo.name}`;
    const line = (account: string, amount: number, clientSide: boolean) =>
      amount === 0 ? null : {
        date: inv.issueDate, journal: 'VT', piece: inv.number, account, label,
        debit: (clientSide ? amount : -amount) > 0 ? Math.abs(amount) : 0,
        credit: (clientSide ? amount : -amount) < 0 ? Math.abs(amount) : 0,
      };
    for (const l of [line(acc.customers, inv.totalTtc, true), line(acc.revenue, inv.totalHt, false), line(acc.vat, inv.vat, false)]) if (l) out.push(l);
  }
  const invoiced = new Set(invoices.map((i) => i.reservationId));
  const list = payments
    .filter((x) => x.status === 'paye' && x.paidAt && Date.parse(x.paidAt) >= ps && Date.parse(x.paidAt) < pe)
    .sort((a, b) => a.paidAt!.localeCompare(b.paidAt!));
  for (const x of list) {
    const r = reservations.find((y) => y.id === x.reservationId);
    const c = clients.find((y) => y.id === r?.clientId);
    const t = treasuryAccount(x.method, plan);
    const date = new Date(x.paidAt!).toISOString().slice(0, 10);
    const piece = r?.number ?? '';
    const label = `${kindText[x.kind]} ${piece} ${c?.name ?? ''}${x.reference ? ` réf. ${x.reference}` : ''}`.trim();
    // Réservation facturée : l'encaissement solde le compte client ; sinon (ancien fonctionnement) il va en produits.
    const other = x.kind === 'caution' || x.kind === 'remboursement_caution' ? acc.deposits : invoiced.has(x.reservationId) ? acc.customers : acc.revenue;
    if (x.kind === 'remboursement_caution' || x.kind === 'remboursement') {
      out.push({ date, journal: t.journal, piece, account: other, label, debit: x.amount, credit: 0 });
      out.push({ date, journal: t.journal, piece, account: t.account, label, debit: 0, credit: x.amount });
    } else {
      out.push({ date, journal: t.journal, piece, account: t.account, label, debit: x.amount, credit: 0 });
      out.push({ date, journal: t.journal, piece, account: other, label, debit: 0, credit: x.amount });
    }
  }
  return out;
}

// ---------------------------------------------------------------- occupation par catégorie

export interface CategoryLine {
  category: string;
  vehicles: number;
  rentedDays: number;
  occupancy: number; // 0 à 1
  revenue: number;
  revenuePerVehicle: number;
}

/** Occupation et chiffre d'affaires par catégorie, à partir des lignes par véhicule. */
export function byCategory(report: Pick<Report, 'vehicles' | 'days'>, vehicles: Vehicle[]): CategoryLine[] {
  const inService = new Set(vehicles.filter((v) => !v.outOfService).map((v) => v.id));
  const map = new Map<string, CategoryLine>();
  for (const l of report.vehicles) {
    const c = map.get(l.category) ?? { category: l.category, vehicles: 0, rentedDays: 0, occupancy: 0, revenue: 0, revenuePerVehicle: 0 };
    if (inService.has(l.vehicleId)) c.vehicles += 1;
    c.rentedDays += l.rentedDays;
    c.revenue += l.revenue;
    map.set(l.category, c);
  }
  return [...map.values()]
    .map((c) => ({
      ...c,
      occupancy: report.days && c.vehicles ? Math.min(1, c.rentedDays / (report.days * c.vehicles)) : 0,
      revenuePerVehicle: c.vehicles ? Math.round(c.revenue / c.vehicles) : 0,
    }))
    .sort((a, b) => b.occupancy - a.occupancy);
}

// ---------------------------------------------------------------- pertes

export interface Losses {
  downtimeDays: number; // jours d'immobilisation pour entretien
  downtimeValue: number; // manque à gagner estimé au tarif jour de la catégorie
  lateDays: number; // jours de retard constatés à l'état des lieux de retour
  lateUnbilled: number; // retards sans frais facturés, au tarif du contrat
  damagesUnbilled: number; // retours avec dégât nouveau et sans frais facturés
  unpaid: number; // reste dû sur les contrats terminés dans la période
  cancelled: number; // montant des réservations annulées qui devaient démarrer dans la période
  total: number; // pertes chiffrées (hors dégâts, non chiffrés)
}

interface InspectionLike {
  reservationId: string;
  kind: 'depart' | 'retour';
  doneAt: string;
  items: { zone: string; status: 'ok' | 'dommage' }[];
}

export function computeLosses(
  input: {
    vehicles: Vehicle[]; reservations: Reservation[]; maintenances: Maintenance[]; rates: { category: string; daily: number }[];
    inspections?: InspectionLike[]; remaining?: (r: Reservation) => number;
  },
  p: Period,
): Losses {
  const ps = Date.parse(p.from);
  const pe = Date.parse(p.to);
  const rateOf = (vehicleId: string) => {
    const v = input.vehicles.find((x) => x.id === vehicleId);
    return input.rates.find((r) => r.category === v?.category)?.daily ?? 0;
  };
  let downtimeDays = 0;
  let downtimeValue = 0;
  for (const m of input.maintenances) {
    const d = overlapMs(Date.parse(m.start), Date.parse(m.end), ps, pe) / DAY;
    if (d <= 0) continue;
    const days = Math.max(d, 0.5);
    downtimeDays += days;
    downtimeValue += Math.round(days * rateOf(m.vehicleId));
  }
  const insp = input.inspections ?? [];
  let lateDays = 0;
  let lateUnbilled = 0;
  let damagesUnbilled = 0;
  let unpaid = 0;
  for (const r of input.reservations) {
    if (r.status !== 'terminee') continue;
    const ret = insp.find((i) => i.reservationId === r.id && i.kind === 'retour');
    const endInPeriod = Date.parse(r.end) >= ps && Date.parse(r.end) < pe;
    if (ret && Date.parse(ret.doneAt) >= ps && Date.parse(ret.doneAt) < pe) {
      const lateMs = Date.parse(ret.doneAt) - Date.parse(r.end) - 3600000;
      if (lateMs > 0) {
        const d = Math.ceil(lateMs / DAY);
        lateDays += d;
        if (!r.fees) lateUnbilled += d * r.dailyRate;
      }
      const dep = insp.find((i) => i.reservationId === r.id && i.kind === 'depart');
      const newDamage = ret.items.some((it) => it.status === 'dommage' && dep?.items.find((x) => x.zone === it.zone)?.status !== 'dommage');
      if (newDamage && !r.fees) damagesUnbilled += 1;
    }
    if (endInPeriod && input.remaining) unpaid += input.remaining(r);
  }
  const cancelled = input.reservations
    .filter((r) => r.status === 'annulee' && Date.parse(r.start) >= ps && Date.parse(r.start) < pe)
    .reduce((s, r) => s + r.total, 0);
  return {
    downtimeDays: Math.round(downtimeDays * 10) / 10, downtimeValue, lateDays, lateUnbilled, damagesUnbilled, unpaid, cancelled,
    total: downtimeValue + lateUnbilled + unpaid + cancelled,
  };
}
