// Devis : proposition chiffrée envoyée à un client (agence, ONG, particulier).
// Un devis ne bloque aucun véhicule ; accepté, il devient une ou plusieurs réservations au prix convenu.

import { billTo, type BillingSettings, type BillTo, type InvoiceLine } from './billing';
import { dealFor, formulaLabel, priceFor } from './tariff';
import type { Client, Formula, Package, Quote, QuoteDetail, QuoteExtra, QuoteStatus, Rate, Season } from './types';

export const QUOTE_VALIDITY_DAYS = 15;

export function nextQuoteNumber(existing: string[], year: number): string {
  const prefix = `DV-${year}-`;
  const max = existing
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return prefix + String(max + 1).padStart(4, '0');
}

export type QuoteState = QuoteStatus | 'expire';

/** Statut affiché : un devis envoyé dont la validité est passée est expiré. */
export function quoteState(q: Pick<Quote, 'status' | 'validUntil'>, now: Date): QuoteState {
  if (q.status === 'envoye' && q.validUntil < now.toISOString().slice(0, 10)) return 'expire';
  return q.status;
}

export const quoteStateLabel: Record<QuoteState, [string, string]> = {
  envoye: ['Envoyé', ''],
  accepte: ['Accepté', 'badge-success'],
  refuse: ['Refusé', 'badge-muted'],
  converti: ['Réservé', 'badge-success'],
  expire: ['Expiré', 'badge-warning'],
};

export interface QuoteInput {
  clientId: string;
  category: string;
  quantity: number;
  formula: Formula;
  packageId?: string | null;
  start: string;
  end: string;
  withDriver: boolean;
  passengers?: number | null;
  missionFees?: number;
  fuelIncluded?: boolean;
  itinerary?: string | null;
  crossBorder?: string | null;
  validUntil?: string | null;
  notes?: string | null;
  driverRequired?: boolean; // la catégorie ne se loue qu'avec chauffeur (bus, minibus)
  extras?: { category: string; quantity: number; driverRequired?: boolean }[]; // autres catégories
}

export interface QuoteContext {
  clients: Client[];
  rates: Rate[];
  packages: Package[];
  seasons: Season[];
  quotes: Pick<Quote, 'number'>[];
}

/** Calcule un devis complet, prêt à enregistrer. Lève une erreur lisible si quelque chose manque. */
export function buildQuote(i: QuoteInput, ctx: QuoteContext, now: Date, by: string | null): Omit<Quote, 'id'> {
  const client = ctx.clients.find((c) => c.id === i.clientId);
  if (!client) throw new Error('Choisissez un client.');
  if (client.score === 'blacklist') throw new Error('Ce client est blacklisté : pas de devis possible.');
  if (!i.category) throw new Error('Choisissez une catégorie de véhicule.');
  const quantity = Math.round(i.quantity);
  if (!(quantity >= 1 && quantity <= 50)) throw new Error('Nombre de véhicules : de 1 à 50.');
  const rate = ctx.rates.find((r) => r.category === i.category);
  const pkg = i.formula === 'forfait' ? ctx.packages.find((k) => k.id === i.packageId) : undefined;
  const withDriver = i.withDriver || !!i.driverRequired || i.formula === 'forfait';
  const deal = dealFor(client, i.category, i.start);
  const p = priceFor({ formula: i.formula, rate, pkg, start: i.start, end: i.end, withDriver, missionFees: i.missionFees, deal, seasons: ctx.seasons });
  const extras: QuoteExtra[] = [];
  for (const x of i.extras ?? []) {
    const qn = Math.round(x.quantity);
    if (!x.category) throw new Error('Choisissez la catégorie de chaque ligne.');
    if (!(qn >= 1 && qn <= 50)) throw new Error('Nombre de véhicules : de 1 à 50 par ligne.');
    if (i.formula === 'forfait') throw new Error('Un forfait concerne une seule catégorie : faites un devis par forfait.');
    const xr = ctx.rates.find((r) => r.category === x.category);
    const xd = i.withDriver || !!x.driverRequired;
    const xp = priceFor({ formula: i.formula, rate: xr, start: i.start, end: i.end, withDriver: xd, missionFees: i.missionFees, deal: dealFor(client, x.category, i.start), seasons: ctx.seasons });
    extras.push({
      category: x.category, quantity: qn, withDriver: xd, unitTotal: xp.total, caution: xp.caution, missionFees: xp.missionFees,
      detail: { days: xp.days, rental: xp.rental, driver: xp.driver, kmIncluded: xp.kmIncluded, seasonNote: xp.seasonNote, dealNote: xp.dealNote },
    });
  }
  if (quantity + extras.reduce((n, x) => n + x.quantity, 0) > 50) throw new Error('50 véhicules au plus par devis.');
  const today = now.toISOString().slice(0, 10);
  const validUntil = i.validUntil || new Date(now.getTime() + QUOTE_VALIDITY_DAYS * 86400000).toISOString().slice(0, 10);
  if (validUntil < today) throw new Error('La date de validité est déjà passée.');
  return {
    number: nextQuoteNumber(ctx.quotes.map((q) => q.number), now.getFullYear()),
    clientId: client.id,
    category: i.category,
    quantity,
    formula: i.formula,
    packageId: pkg?.id ?? null,
    packageLabel: p.label,
    start: i.start,
    end: i.end,
    withDriver,
    passengers: i.passengers || null,
    missionFees: p.missionFees,
    fuelIncluded: !!i.fuelIncluded,
    itinerary: i.itinerary?.trim() || null,
    crossBorder: i.crossBorder?.trim() || null,
    unitTotal: p.total,
    total: p.total * quantity + extras.reduce((t, x) => t + x.unitTotal * x.quantity, 0),
    caution: p.caution,
    detail: { days: p.days, rental: p.rental, driver: p.driver, kmIncluded: p.kmIncluded, seasonNote: p.seasonNote, dealNote: p.dealNote },
    validUntil,
    status: 'envoye',
    reservationIds: [],
    notes: i.notes?.trim() || null,
    createdBy: by,
    createdAt: now.toISOString(),
    extras,
  };
}

/** Les lignes d'un devis : la catégorie principale puis les autres. */
export function quoteParts(q: Quote): QuoteExtra[] {
  return [
    { category: q.category, quantity: q.quantity, withDriver: q.withDriver, unitTotal: q.unitTotal, caution: q.caution, missionFees: q.missionFees, detail: q.detail },
    ...(q.extras ?? []),
  ];
}

/** Un emplacement par véhicule à fournir, dans l'ordre des lignes. */
export function quoteSlots(q: Quote): QuoteExtra[] {
  return quoteParts(q).flatMap((p) => Array.from({ length: p.quantity }, () => p));
}

export const quoteVehicleCount = (q: Quote) => quoteParts(q).reduce((n, p) => n + p.quantity, 0);

/** « 2 × 4x4, 1 × Minibus » */
export function quoteSummary(q: Quote): string {
  return quoteParts(q).map((p) => `${p.quantity > 1 || (q.extras ?? []).length ? `${p.quantity} × ` : ''}${p.category}`).join(', ');
}

/** Lignes du devis imprimé, au même format que la facture. */
export function quoteLines(q: Quote): InvoiceLine[] {
  const parts = quoteParts(q);
  const several = parts.length > 1;
  return parts.flatMap((p) => partLines(q, p, several));
}

function partLines(q: Quote, part: { category: string; quantity: number; missionFees: number; detail: QuoteDetail }, several: boolean): InvoiceLine[] {
  const n = part.quantity;
  const what = `${part.category}${n > 1 ? ` × ${n}` : ''}`;
  const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const lines: InvoiceLine[] = [];
  const unitLabel = q.formula === 'demi_journee' ? 'demi-journée' : q.formula === 'forfait' ? 'forfait' : 'jour';
  const qty = q.formula === 'jour' ? part.detail.days * n : n;
  const add = (label: string, total: number) => {
    if (total <= 0) return;
    lines.push({ label, quantity: qty, unit: unitLabel, unitPrice: Math.round(total / qty), amount: total });
  };
  if (q.formula === 'forfait') {
    add(`Forfait ${q.packageLabel ?? ''} avec chauffeur, ${what}, le ${day(q.start)}`.replace('  ', ' '), part.detail.rental * n);
  } else {
    const period = q.formula === 'demi_journee' ? `demi-journée du ${day(q.start)}` : `du ${day(q.start)} au ${day(q.end)}`;
    add(`Location ${what}, ${period}`, part.detail.rental * n);
    add(`Chauffeur${n > 1 ? `s (${n})` : ''}${several ? ` pour ${part.category}` : ''}, ${period}`, part.detail.driver * n);
  }
  if (part.missionFees > 0) lines.push({ label: `Frais de mission du chauffeur${several ? ` (${part.category})` : ''} (hébergement, repas)`, quantity: n, unit: 'forfait', unitPrice: part.missionFees, amount: part.missionFees * n });
  return lines;
}

export function quoteTotals(q: Quote, s: BillingSettings) {
  const totalHt = q.total;
  const vatRate = s.vatEnabled ? s.vatRate : 0;
  const vat = Math.round((totalHt * vatRate) / 100);
  return { totalHt, vatRate, vat, totalTtc: totalHt + vat };
}

export function quoteBillTo(c: Client): BillTo {
  return billTo(c);
}

/** Texte prêt à envoyer par WhatsApp ou email. */
export function quoteMessage(q: Quote, client: Client, orgName: string, s: BillingSettings): string {
  const t = quoteTotals(q, s);
  const fmt = (n: number) => `${new Intl.NumberFormat('fr-FR').format(n)} FCFA`;
  const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const what = `${quoteSummary(q)}${q.withDriver ? ' avec chauffeur' : ''}`;
  const when = q.formula === 'jour' ? `du ${day(q.start)} au ${day(q.end)}` : `le ${day(q.start)}`;
  return [
    `Bonjour ${client.contactName || client.name},`,
    `Voici notre devis ${q.number} : ${what}, ${formulaLabel(q.formula).toLowerCase()} ${when}${q.packageLabel ? ` (${q.packageLabel})` : ''}.`,
    `Montant : ${fmt(t.totalTtc)}${t.vatRate ? ' TTC' : ''}${q.caution ? ((q.extras ?? []).length ? `, caution de ${fmt(quoteSlots(q).reduce((n, x) => n + x.caution, 0))} au total` : `, caution de ${fmt(q.caution)} par véhicule`) : ''}.`,
    `Ce devis est valable jusqu'au ${new Date(q.validUntil + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
    `Cordialement, ${orgName}`,
  ].join('\n');
}
