// Réservation en ligne : page publique de l'entreprise, demandes validées par un agent.

import { isActive, overlaps } from './rules';
import type { Client, Maintenance, Reservation, Vehicle } from './types';

export type BookingStatus = 'nouvelle' | 'acceptee' | 'refusee';

export interface BookingRequest {
  id: string;
  category: string;
  start: string;
  end: string;
  withDriver: boolean;
  name: string;
  phone: string;
  email: string | null;
  message: string | null;
  status: BookingStatus;
  reservationId: string | null;
  declineReason: string | null;
  createdAt: string;
}

export type BookingRequestInput = Pick<BookingRequest, 'category' | 'start' | 'end' | 'withDriver' | 'name' | 'phone' | 'email' | 'message'>;

export interface PublicCategory {
  category: string;
  daily: number;
  weekly: number;
  monthly: number;
  driverDaily: number;
  kmPerDay: number;
  extraKm: number;
  caution: number;
  vehicles: number; // véhicules en service dans la catégorie
  models: string[]; // quelques modèles, « ou similaire »
}

export interface PublicBookingInfo {
  name: string;
  logo: string | null;
  phone: string;
  email: string;
  address: string;
  city: string;
  categories: PublicCategory[];
}

/** Adresse de la page : minuscules, chiffres et tirets, 3 à 40 caractères. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;

/** Nombre de véhicules libres par catégorie sur la période. */
export function availableByCategory(
  vehicles: Vehicle[],
  reservations: Reservation[],
  maintenances: Maintenance[],
  start: string,
  end: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of vehicles) {
    if (v.outOfService) continue;
    out[v.category] ??= 0;
    const busy =
      reservations.some((r) => r.vehicleId === v.id && isActive(r) && overlaps(start, end, r.start, r.end)) ||
      maintenances.some((m) => m.vehicleId === v.id && overlaps(start, end, m.start, m.end));
    if (!busy) out[v.category] += 1;
  }
  return out;
}

/** Contrôles de la demande ; renvoie le message d'erreur ou null. Mêmes règles côté base. */
export function validateBookingRequest(r: BookingRequestInput, now: Date): string | null {
  const s = Date.parse(r.start);
  const e = Date.parse(r.end);
  if (!r.category) return 'Choisissez un type de véhicule.';
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 'Indiquez les dates de départ et de retour.';
  if (s < now.getTime() - 3600000) return 'La date de départ est déjà passée.';
  if (e <= s) return 'La date de retour doit être après la date de départ.';
  if (e - s > 180 * 86400000) return 'Pour plus de 6 mois, contactez directement l’agence.';
  const name = r.name.trim();
  if (name.length < 2 || name.length > 120) return 'Indiquez votre nom.';
  const digits = r.phone.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return 'Indiquez un numéro de téléphone valide.';
  if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email.trim())) return 'Adresse email invalide.';
  if ((r.message ?? '').length > 1000) return 'Message trop long (1 000 caractères maximum).';
  return null;
}

/** Retrouve un client existant par téléphone (9 derniers chiffres) ou par email. */
export function matchClient(clients: Client[], phone: string, email: string | null): Client | undefined {
  const tail = phone.replace(/\D/g, '').slice(-9);
  return (
    (tail.length >= 8 ? clients.find((c) => c.phone.replace(/\D/g, '').slice(-9) === tail) : undefined) ??
    (email ? clients.find((c) => c.email && c.email.toLowerCase() === email.trim().toLowerCase()) : undefined)
  );
}

/** Lien WhatsApp avec un message prérempli (numéro au format international sans +). */
export function whatsappLink(phone: string, text: string, defaultCountryCode = '221'): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.length <= 9) d = defaultCountryCode + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

export const COUNTRY_CALLING_CODE: Record<string, string> = {
  SN: '221', CI: '225', GN: '224', MR: '222', ML: '223', BF: '226', BJ: '229', TG: '228', NE: '227', CM: '237', GA: '241', CG: '242', MA: '212',
};
