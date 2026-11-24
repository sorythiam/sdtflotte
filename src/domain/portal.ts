// Espace client d'une réservation : le client remplit son dossier, signe les conditions et
// déclare son acompte depuis son téléphone, avant de venir chercher le véhicule.
//
// Yoon Fleet n'encaisse rien : le client paie le loueur avec le code marchand Wave ou
// Orange Money du loueur, puis déclare la référence ; le loueur confirme la réception.

import type { Client, DocSlot, IdType, Reservation, Vehicle } from './types';
import type { Invoice } from './billing';

export type DepositMethod = 'wave' | 'orange_money';
export type DeclarationStatus = 'declare' | 'confirme' | 'rejete';

/** Lien unique envoyé au client (une ligne par réservation). */
export interface ReservationPortal {
  id: string;
  reservationId: string;
  token: string;
  createdAt: string;
  createdBy?: string | null;
  openedAt?: string | null;
  submittedAt?: string | null;
  signerName?: string | null;
  signature?: string | null; // PNG en data URL
  signedAt?: string | null;
}

/** Acompte déclaré par le client ; le loueur le confirme après avoir vu l'argent sur son compte. */
export interface DepositDeclaration {
  id: string;
  reservationId: string;
  amount: number;
  method: DepositMethod;
  reference: string;
  declaredAt: string;
  status: DeclarationStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  paymentId?: string | null;
}

/** Ce que voit le client en ouvrant son lien (rien d'autre ne sort de la base). */
export interface PortalInfo {
  org: { name: string; phone: string; logo: string | null; terms: string; country: string; wave: string; orangeMoney: string };
  reservation: {
    number: string; status: Reservation['status']; start: string; end: string; withDriver: boolean; vehicle: string;
    total: number; caution: number; depositDue: number; paid: number;
    declared: Pick<DepositDeclaration, 'amount' | 'method' | 'reference' | 'declaredAt' | 'status'>[];
  };
  client: PortalClient & { kind: Client['kind']; docs: Partial<Record<DocSlot, boolean>> };
  portal: { submittedAt: string | null; signedAt: string | null; signerName: string | null; uploadPrefix?: string };
}

export interface PortalClient {
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  city: string | null;
  idType: IdType | null;
  idNumber: string | null;
  idExpiry: string | null;
  birthDate: string | null;
  licenseNumber: string | null;
  licenseCategory: string | null;
  licenseExpiry: string | null;
}

export const METHOD_LABEL: Record<DepositMethod, string> = { wave: 'Wave', orange_money: 'Orange Money' };
export const PORTAL_DOCS: DocSlot[] = ['idFront', 'idBack', 'license'];

/** Acompte demandé : celui des factures s'il y en a, sinon le pourcentage appliqué au montant. */
export function depositTarget(r: Pick<Reservation, 'id' | 'total'>, invoices: Pick<Invoice, 'reservationId' | 'kind' | 'depositDue'>[], percent: number): number {
  const mine = invoices.filter((i) => i.reservationId === r.id && i.kind === 'facture');
  if (mine.length) return mine.reduce((s, i) => s + i.depositDue, 0);
  return Math.round((r.total * Math.min(100, Math.max(0, percent))) / 100);
}

/** Reste à payer sur l'acompte, après les paiements déjà reçus. */
export function depositLeft(info: Pick<PortalInfo['reservation'], 'depositDue' | 'paid'>): number {
  return Math.max(0, info.depositDue - info.paid);
}

export type DepositState = 'aucun' | 'recu' | 'declare' | 'attendu' | 'en_retard';

/** Où en est l'acompte d'une réservation à venir. delayHours : délai laissé au client après la réservation. */
export function depositState(
  r: Pick<Reservation, 'id' | 'status' | 'createdAt'>,
  due: number,
  paid: number,
  declarations: Pick<DepositDeclaration, 'reservationId' | 'status'>[],
  now: Date,
  delayHours: number,
): DepositState {
  if (due <= 0 || r.status !== 'reservee') return 'aucun';
  if (paid >= due) return 'recu';
  if (declarations.some((d) => d.reservationId === r.id && d.status === 'declare')) return 'declare';
  const created = Date.parse(r.createdAt);
  if (delayHours > 0 && Number.isFinite(created) && now.getTime() - created > delayHours * 3600000) return 'en_retard';
  return 'attendu';
}

export const DEPOSIT_STATE_LABEL: Record<DepositState, [string, string]> = {
  aucun: ['', ''],
  recu: ['Acompte reçu', 'badge-success'],
  declare: ['Acompte déclaré, à vérifier', 'badge-warning'],
  attendu: ['Acompte attendu', 'badge-muted'],
  en_retard: ['Acompte non reçu', 'badge-danger'],
};

/** Contrôle du formulaire rempli par le client. Renvoie un message ou null. */
export function validatePortalForm(c: PortalClient, signerName: string, signature: string | null, accepted: boolean, now: Date): string | null {
  if (c.name.trim().length < 2 || c.name.length > 120) return 'Indiquez votre nom complet.';
  const digits = c.phone.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return 'Indiquez un numéro de téléphone valide.';
  if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) return 'Adresse email invalide.';
  if (!c.idNumber?.trim()) return 'Indiquez le numéro de votre pièce d’identité.';
  if ((c.idNumber ?? '').length > 40 || (c.licenseNumber ?? '').length > 40) return 'Numéro trop long.';
  const today = now.toISOString().slice(0, 10);
  if (c.idExpiry && c.idExpiry < today) return 'Votre pièce d’identité est expirée.';
  if (c.licenseExpiry && c.licenseExpiry < today) return 'Votre permis est expiré.';
  if (c.birthDate && c.birthDate > today) return 'Date de naissance invalide.';
  if ((c.address ?? '').length > 200 || (c.city ?? '').length > 80) return 'Adresse trop longue.';
  if (!accepted) return 'Acceptez les conditions de location pour continuer.';
  if (signerName.trim().length < 2) return 'Écrivez votre nom sous la signature.';
  if (!signature) return 'Signez dans le cadre.';
  return null;
}

/** Contrôle de l'acompte déclaré. */
export function validateDeclaration(amount: number, reference: string, left: number): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return 'Indiquez le montant payé.';
  if (left > 0 && amount > left * 2) return 'Montant trop élevé, vérifiez.';
  const ref = reference.trim();
  if (ref.length < 4 || ref.length > 60) return 'Indiquez la référence de la transaction (reçue par SMS ou dans l’application).';
  return null;
}

export function portalUrl(token: string, origin = typeof window !== 'undefined' ? window.location.origin : 'https://yoonfleet.com'): string {
  return `${origin}/c/${token}`;
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? '';
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const hourLabel = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmt = (n: number) => `${n.toLocaleString('fr-FR').replace(/ /g, ' ')} FCFA`;

/** Message WhatsApp qui envoie le lien au client. */
export function portalMessage(clientName: string, orgName: string, r: Pick<Reservation, 'number' | 'start'>, url: string, depositLeftAmount: number): string {
  return [
    `Bonjour ${firstName(clientName)}, merci pour votre réservation ${r.number} chez ${orgName} (départ le ${dayLabel(r.start)}).`,
    `Pour gagner du temps à la remise des clés, complétez votre dossier et signez le contrat ici :`,
    url,
    depositLeftAmount > 0 ? `Vous y trouverez aussi comment régler l’acompte de ${fmt(depositLeftAmount)} pour confirmer la réservation.` : '',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- suivi pendant la location

export type FollowKind = 'depart' | 'retour' | 'retard';

export interface FollowItem {
  kind: FollowKind;
  when: 'aujourdhui' | 'demain' | 'passe';
  reservation: Reservation;
  at: string; // départ ou retour prévu
}

const isoDay = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const localDay = (iso: string) => isoDay(new Date(iso));

/** Départs et retours d'aujourd'hui et de demain, et véhicules pas rentrés à l'heure. */
export function followUps(reservations: Reservation[], now: Date): FollowItem[] {
  const today = isoDay(now);
  const tomorrow = isoDay(new Date(now.getTime() + 86400000));
  const out: FollowItem[] = [];
  for (const r of reservations) {
    if (r.status === 'reservee') {
      const d = localDay(r.start);
      if (d === today || d === tomorrow) out.push({ kind: 'depart', when: d === today ? 'aujourdhui' : 'demain', reservation: r, at: r.start });
    } else if (r.status === 'en_cours') {
      if (Date.parse(r.end) < now.getTime()) out.push({ kind: 'retard', when: 'passe', reservation: r, at: r.end });
      else {
        const d = localDay(r.end);
        if (d === today || d === tomorrow) out.push({ kind: 'retour', when: d === today ? 'aujourdhui' : 'demain', reservation: r, at: r.end });
      }
    }
  }
  const rank: Record<FollowKind, number> = { retard: 0, retour: 1, depart: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.at.localeCompare(b.at));
}

/** Messages WhatsApp prêts à envoyer, polis et factuels. */
export function followMessage(
  kind: 'rappel_depart' | 'rappel_retour' | 'prolongation' | 'retard',
  clientName: string,
  orgName: string,
  r: Pick<Reservation, 'number' | 'start' | 'end' | 'dailyRate'>,
  vehicle: Pick<Vehicle, 'brand' | 'model' | 'plate'> | undefined,
  now: Date,
): string {
  const hello = `Bonjour ${firstName(clientName)},`;
  const car = vehicle ? `${vehicle.brand} ${vehicle.model} (${vehicle.plate})` : 'le véhicule';
  const sign = `\n${orgName}`;
  switch (kind) {
    case 'rappel_depart':
      return `${hello} nous vous attendons ${isoDay(now) === localDay(r.start) ? 'aujourd’hui' : 'demain'} à ${hourLabel(r.start)} pour la remise de ${car} (réservation ${r.number}). Pensez à votre pièce d’identité et à votre permis.${sign}`;
    case 'rappel_retour':
      return `${hello} petit rappel : le retour de ${car} est prévu ${isoDay(now) === localDay(r.end) ? 'aujourd’hui' : 'demain'} à ${hourLabel(r.end)} (réservation ${r.number}). Merci de le rendre avec le même niveau de carburant. Si vous souhaitez le garder plus longtemps, dites-le-nous.${sign}`;
    case 'prolongation':
      return `${hello} vous souhaitez garder ${car} un peu plus longtemps ? Nous pouvons prolonger votre location ${r.number} à ${fmt(r.dailyRate)} par jour supplémentaire, sous réserve de disponibilité. Répondez simplement avec la nouvelle date de retour.${sign}`;
    case 'retard': {
      const hours = Math.max(1, Math.round((now.getTime() - Date.parse(r.end)) / 3600000));
      return `${hello} le retour de ${car} était prévu le ${dayLabel(r.end)} à ${hourLabel(r.end)} (réservation ${r.number}), soit il y a environ ${hours} h. Pouvez-vous nous dire quand vous le ramenez ? Les jours supplémentaires seront facturés selon le contrat.${sign}`;
    }
  }
}

