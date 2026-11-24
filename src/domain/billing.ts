// Facturation : modalités de paiement, factures, avoirs et suivi des encaissements.
//
// Principes : une facture émise ne se modifie plus (obligation fiscale). Les frais constatés
// au retour font l'objet d'une facture complémentaire, une annulation d'un avoir. Le loueur
// encaisse avec ses propres moyens (Wave, Orange Money, chèque, virement, espèces) et
// enregistre le paiement ; Yoon Fleet ne touche jamais l'argent des locations.

import type { Client, Payment, Rate, Reservation, Vehicle } from './types';

const DAY = 86400000;

// ---------------------------------------------------------------- modalités

export interface Payees {
  wave: string;
  orangeMoney: string;
  freeMoney: string;
  mtn: string;
  moov: string;
  bankName: string;
  iban: string; // RIB ou IBAN
  chequeOrder: string; // ordre des chèques
}

export interface BillingSettings {
  vatEnabled: boolean; // assujetti à la TVA
  vatRate: number; // en %, 18 au Sénégal
  depositPercent: number; // acompte demandé à la réservation, 0 à 100
  depositDelayHours: number; // délai laissé au client pour payer l'acompte, 0 = pas de suivi
  balanceWhen: 'depart' | 'retour'; // échéance du solde pour un particulier
  companyDueDays: number; // délai accordé aux entreprises, 0 = mêmes règles
  payees: Payees;
  invoiceFooter: string; // mention libre en bas de facture
}

export const EMPTY_PAYEES: Payees = { wave: '', orangeMoney: '', freeMoney: '', mtn: '', moov: '', bankName: '', iban: '', chequeOrder: '' };

export const DEFAULT_BILLING: BillingSettings = {
  vatEnabled: false,
  vatRate: 18,
  depositPercent: 50,
  depositDelayHours: 24,
  balanceWhen: 'depart',
  companyDueDays: 30,
  payees: EMPTY_PAYEES,
  invoiceFooter: '',
};

export function billingSettings(orgName: string, s: Partial<BillingSettings> | null | undefined): BillingSettings {
  const out: BillingSettings = { ...DEFAULT_BILLING, ...(s ?? {}), payees: { ...EMPTY_PAYEES, ...(s?.payees ?? {}) } };
  if (!out.payees.chequeOrder.trim()) out.payees.chequeOrder = orgName;
  return out;
}

export interface Terms {
  depositPercent: number;
  dueDays: number; // 0 = solde au départ ou au retour selon balanceWhen
  balanceWhen: 'depart' | 'retour';
  label: string;
}

/** Modalités applicables à un client : celles de sa fiche, sinon celles de l'entreprise. */
export function termsFor(s: BillingSettings, client: Pick<Client, 'kind' | 'depositPercent' | 'dueDays'> | undefined): Terms {
  const company = client?.kind === 'entreprise';
  const depositPercent = clamp(client?.depositPercent ?? s.depositPercent, 0, 100);
  const dueDays = Math.max(0, client?.dueDays ?? (company ? s.companyDueDays : 0));
  const parts: string[] = [];
  if (depositPercent > 0) parts.push(`acompte de ${depositPercent} % à la réservation`);
  if (dueDays > 0) parts.push(`${depositPercent > 0 ? 'solde' : 'paiement'} à ${dueDays} jours date de facture`);
  else parts.push(`${depositPercent > 0 ? 'solde' : 'paiement'} ${s.balanceWhen === 'depart' ? 'à la remise des clés' : 'au retour du véhicule'}`);
  const label = parts.join(', ');
  return { depositPercent, dueDays, balanceWhen: s.balanceWhen, label: label.charAt(0).toUpperCase() + label.slice(1) };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** Moyens de paiement renseignés, prêts à afficher (contrat, facture, WhatsApp). */
export function payeeLines(p: Payees): string[] {
  return [
    p.wave && `Wave : ${p.wave}`,
    p.orangeMoney && `Orange Money : ${p.orangeMoney}`,
    p.freeMoney && `Free Money : ${p.freeMoney}`,
    p.mtn && `MTN MoMo : ${p.mtn}`,
    p.moov && `Moov Money : ${p.moov}`,
    (p.bankName || p.iban) && `Virement : ${[p.bankName, p.iban].filter(Boolean).join(', ')}`,
    p.chequeOrder && `Chèque à l’ordre de ${p.chequeOrder}`,
  ].filter(Boolean) as string[];
}

// ---------------------------------------------------------------- factures

export type InvoiceKind = 'facture' | 'complement' | 'avoir';

export interface InvoiceLine {
  label: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number; // HT
}

export interface BillTo {
  name: string;
  kind: Client['kind'];
  address: string | null;
  city: string | null;
  taxId: string | null;
  tradeRegister: string | null;
  phone: string;
  email: string | null;
  contactName: string | null;
}

export interface Invoice {
  id: string;
  number: string; // attribué par la base : FA-2026-0001, AV-2026-0001
  reservationId: string;
  clientId: string;
  kind: InvoiceKind;
  issueDate: string; // AAAA-MM-JJ
  dueDate: string;
  lines: InvoiceLine[];
  totalHt: number; // négatif pour un avoir
  vatRate: number;
  vat: number;
  totalTtc: number;
  depositDue: number; // acompte demandé (facture initiale seulement)
  terms: string;
  billTo: BillTo;
  relatedInvoiceId: string | null; // facture annulée par un avoir
  createdAt: string;
}

export type NewInvoice = Omit<Invoice, 'id' | 'number'>;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const frDay = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

export function billTo(c: Client): BillTo {
  return {
    name: c.name, kind: c.kind, address: c.address ?? null, city: c.city ?? null, taxId: c.taxId ?? null,
    tradeRegister: c.tradeRegister ?? null, phone: c.phone, email: c.email ?? c.contactEmail ?? null, contactName: c.contactName ?? null,
  };
}

function totals(lines: InvoiceLine[], s: BillingSettings) {
  const totalHt = lines.reduce((sum, l) => sum + l.amount, 0);
  const vatRate = s.vatEnabled ? s.vatRate : 0;
  const vat = Math.round((totalHt * vatRate) / 100);
  return { totalHt, vatRate, vat, totalTtc: totalHt + vat };
}

/** Facture initiale, à la validation de la réservation. */
export function buildInvoice(
  r: Reservation,
  client: Client,
  vehicle: Vehicle | undefined,
  rate: Rate | undefined,
  s: BillingSettings,
  now: Date,
): NewInvoice {
  const mission = Math.max(0, r.missionFees ?? 0);
  const base = r.total - mission;
  const what = vehicle ? `${vehicle.brand} ${vehicle.model} (${vehicle.plate})` : 'Véhicule';
  const period = `du ${frDay(r.start)} au ${frDay(r.end)}`;
  const lines: InvoiceLine[] = [];
  if (r.formula === 'forfait') {
    lines.push({ label: `Forfait ${r.packageLabel ?? ''} avec chauffeur, ${what}, le ${frDay(r.start)}`.replace('  ', ' '), quantity: 1, unit: 'forfait', unitPrice: base, amount: base });
  } else if (r.formula === 'demi_journee') {
    const driverPart = r.withDriver && rate ? Math.min(base, Math.round(rate.driverDaily / 2)) : 0;
    lines.push({ label: `Location ${what}, demi-journée du ${frDay(r.start)}`, quantity: 1, unit: 'demi-journée', unitPrice: base - driverPart, amount: base - driverPart });
    if (driverPart > 0) lines.push({ label: 'Chauffeur, demi-journée', quantity: 1, unit: 'demi-journée', unitPrice: driverPart, amount: driverPart });
  } else {
    const days = Math.max(1, Math.round((Date.parse(r.end) - Date.parse(r.start)) / DAY) || 1);
    const driverTotal = r.withDriver && rate ? Math.min(base, rate.driverDaily * days) : 0;
    lines.push({ label: `Location ${what}, ${period}`, quantity: days, unit: 'jour', unitPrice: Math.round((base - driverTotal) / days), amount: base - driverTotal });
    if (driverTotal > 0) lines.push({ label: `Chauffeur, ${period}`, quantity: days, unit: 'jour', unitPrice: Math.round(driverTotal / days), amount: driverTotal });
  }
  if (mission > 0) lines.push({ label: 'Frais de mission du chauffeur (hébergement, repas)', quantity: 1, unit: 'forfait', unitPrice: mission, amount: mission });
  const t = totals(lines, s);
  const terms = termsFor(s, client);
  const issue = isoDay(now);
  const due = terms.dueDays > 0 ? isoDay(new Date(now.getTime() + terms.dueDays * DAY)) : (s.balanceWhen === 'depart' ? r.start : r.end).slice(0, 10);
  return {
    reservationId: r.id, clientId: client.id, kind: 'facture', issueDate: issue, dueDate: due < issue ? issue : due, lines, ...t,
    depositDue: Math.round((t.totalTtc * terms.depositPercent) / 100), terms: terms.label, billTo: billTo(client), relatedInvoiceId: null,
    createdAt: now.toISOString(),
  };
}

/** Facture complémentaire des frais constatés au retour. */
export function buildFeesInvoice(r: Reservation, client: Client, s: BillingSettings, now: Date, detail?: string): NewInvoice {
  const lines: InvoiceLine[] = [
    { label: `Frais constatés au retour, contrat ${r.number}${detail ? ` : ${detail}` : ''}`, quantity: 1, unit: 'forfait', unitPrice: r.fees, amount: r.fees },
  ];
  const t = totals(lines, s);
  const terms = termsFor(s, client);
  const issue = isoDay(now);
  return {
    reservationId: r.id, clientId: client.id, kind: 'complement', issueDate: issue,
    dueDate: terms.dueDays > 0 ? isoDay(new Date(now.getTime() + terms.dueDays * DAY)) : issue, lines, ...t, depositDue: 0,
    terms: terms.dueDays > 0 ? `Paiement à ${terms.dueDays} jours date de facture` : 'Paiement au retour du véhicule', billTo: billTo(client),
    relatedInvoiceId: null, createdAt: now.toISOString(),
  };
}

/**
 * Avenant facturé : facture complémentaire si le prix monte, avoir partiel s'il baisse.
 * `delta` est hors taxes, comme le montant de la réservation.
 */
export function buildAdjustment(r: Reservation, client: Client, s: BillingSettings, now: Date, delta: number, related: Invoice, reason?: string | null): NewInvoice {
  const issue = isoDay(now);
  const label = `Avenant au contrat ${r.number} : du ${frDay(r.start)} au ${frDay(r.end)}${reason ? ` (${reason})` : ''}`;
  const lines: InvoiceLine[] = [{ label, quantity: 1, unit: 'forfait', unitPrice: delta, amount: delta }];
  const vatRate = related.vatRate;
  const vat = Math.round((delta * vatRate) / 100);
  const terms = termsFor(s, client);
  return {
    reservationId: r.id, clientId: client.id, kind: delta > 0 ? 'complement' : 'avoir', issueDate: issue,
    dueDate: delta > 0 && terms.dueDays > 0 ? isoDay(new Date(now.getTime() + terms.dueDays * DAY)) : issue,
    lines, totalHt: delta, vatRate, vat, totalTtc: delta + vat, depositDue: 0,
    terms: delta > 0 ? `Complément sur la facture ${related.number}` : `Avoir partiel sur la facture ${related.number}`,
    billTo: billTo(client), relatedInvoiceId: related.id, createdAt: now.toISOString(),
  };
}

/** Frais d'annulation facturés quand aucune facture n'avait été émise. `ttc` = montant toutes taxes comprises. */
export function buildCancellationFeeInvoice(r: Reservation, client: Client, s: BillingSettings, now: Date, ttc: number): NewInvoice {
  const vatRate = s.vatEnabled ? s.vatRate : 0;
  const ht = Math.round((ttc * 100) / (100 + vatRate));
  const lines: InvoiceLine[] = [{ label: `Frais d’annulation, contrat ${r.number}`, quantity: 1, unit: 'forfait', unitPrice: ht, amount: ht }];
  const issue = isoDay(now);
  return {
    reservationId: r.id, clientId: client.id, kind: 'facture', issueDate: issue, dueDate: issue, lines,
    totalHt: ht, vatRate, vat: ttc - ht, totalTtc: ttc, depositDue: 0, terms: 'Payable à réception',
    billTo: billTo(client), relatedInvoiceId: null, createdAt: now.toISOString(),
  };
}

/** Avoir qui annule une facture (montants opposés, mêmes lignes). */
export function buildCreditNote(inv: Invoice, now: Date, reason = 'Annulation de la réservation'): NewInvoice {
  const issue = isoDay(now);
  return {
    reservationId: inv.reservationId, clientId: inv.clientId, kind: 'avoir', issueDate: issue, dueDate: issue,
    lines: inv.lines.map((l) => ({ ...l, label: `${reason} : ${l.label}`, unitPrice: -l.unitPrice, amount: -l.amount })),
    totalHt: -inv.totalHt, vatRate: inv.vatRate, vat: -inv.vat, totalTtc: -inv.totalTtc, depositDue: 0,
    terms: `Avoir sur la facture ${inv.number}`, billTo: inv.billTo, relatedInvoiceId: inv.id, createdAt: now.toISOString(),
  };
}

/** Numéro suivant pour un préfixe et une année : FA-2026-0007 (utilisé en démo ; la base fait de même). */
export function nextInvoiceNumber(existing: string[], prefix: 'FA' | 'AV', year: number): string {
  const head = `${prefix}-${year}-`;
  const max = existing.filter((n) => n.startsWith(head)).map((n) => parseInt(n.slice(head.length), 10)).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);
  return head + String(max + 1).padStart(4, '0');
}

export const invoicePrefix = (k: InvoiceKind): 'FA' | 'AV' => (k === 'avoir' ? 'AV' : 'FA');

// ---------------------------------------------------------------- suivi des encaissements

const RENTAL_KINDS: Payment['kind'][] = ['acompte', 'solde', 'frais'];

/** Payé sur la location et les frais (hors caution). */
export function paidOn(reservationId: string, payments: Payment[]): number {
  const mine = payments.filter((p) => p.reservationId === reservationId && p.status === 'paye');
  const inn = mine.filter((p) => RENTAL_KINDS.includes(p.kind)).reduce((s, p) => s + p.amount, 0);
  const back = mine.filter((p) => p.kind === 'remboursement').reduce((s, p) => s + p.amount, 0); // trop-perçu rendu au client
  return inn - back;
}

/** Montant dû TTC : somme des factures (avoirs déduits), ou à défaut le montant de la réservation. */
export function amountOwed(r: Reservation, invoices: Invoice[]): number {
  const mine = invoices.filter((i) => i.reservationId === r.id);
  return mine.length ? mine.reduce((s, i) => s + i.totalTtc, 0) : r.status === 'annulee' ? 0 : r.total + (r.fees ?? 0);
}

export type PayStatus = 'non_payee' | 'acompte' | 'payee' | 'en_retard' | 'annulee' | 'trop_percu';

export interface PayState {
  owed: number;
  paid: number;
  remaining: number;
  depositDue: number;
  depositMissing: number; // reste à payer sur l'acompte demandé
  dueDate: string | null; // échéance la plus proche non réglée
  status: PayStatus;
}

export function payState(r: Reservation, invoices: Invoice[], payments: Payment[], now: Date): PayState {
  const mine = invoices.filter((i) => i.reservationId === r.id);
  const owed = amountOwed(r, invoices);
  const paid = paidOn(r.id, payments);
  const remaining = Math.max(0, owed - paid);
  const depositDue = mine.filter((i) => i.kind === 'facture').reduce((s, i) => s + i.depositDue, 0);
  const cancelled = mine.some((i) => i.kind === 'avoir') && owed <= 0;
  const open = mine.filter((i) => i.kind !== 'avoir').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const dueDate = remaining > 0 ? (open.find(() => true)?.dueDate ?? null) : null;
  const today = isoDay(now);
  let status: PayStatus;
  if (paid > owed && paid > 0) status = 'trop_percu';
  else if (cancelled || (r.status === 'annulee' && owed <= 0)) status = 'annulee';
  else if (remaining === 0) status = 'payee';
  else if (dueDate && dueDate < today) status = 'en_retard';
  else if (paid > 0) status = 'acompte';
  else status = 'non_payee';
  return { owed, paid, remaining, depositDue, depositMissing: Math.max(0, depositDue - paid), dueDate, status };
}

export const payStatusLabel: Record<PayStatus, [string, string]> = {
  non_payee: ['Non payée', 'badge-warning'],
  acompte: ['Acompte reçu', ''],
  payee: ['Payée', 'badge-success'],
  en_retard: ['En retard', 'badge-danger'],
  annulee: ['Annulée par avoir', 'badge-muted'],
  trop_percu: ['Trop-perçu à rembourser', 'badge-danger'],
};
