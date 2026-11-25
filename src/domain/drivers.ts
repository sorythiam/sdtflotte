// Chauffeurs : permis adapté au véhicule, absences, feuille de mission envoyée par WhatsApp.

import { flightLabel, flightTrackUrl } from './flight';
import type { Client, Driver, Reservation, Vehicle, VtcContract } from './types';

export type AbsenceKind = 'conge' | 'repos' | 'maladie' | 'formation' | 'autre';

/** Période où le chauffeur ne peut pas être affecté (dates incluses). */
export interface DriverAbsence {
  id: string;
  driverId: string;
  kind: AbsenceKind;
  startDate: string; // AAAA-MM-JJ
  endDate: string; // AAAA-MM-JJ, incluse
  note: string | null;
  createdAt: string;
}

export const ABSENCE_LABEL: Record<AbsenceKind, string> = { conge: 'Congé', repos: 'Repos', maladie: 'Maladie', formation: 'Formation', autre: 'Absent' };

/** Catégories écrites « B, D1 », « b/d » ou « B D » → ['B', 'D1']. */
export function licenseCategories(raw: string | null | undefined): string[] {
  return (raw ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}

/** Catégorie exigée : D au-delà de 9 places (chauffeur compris), D1 suffit jusqu'à 17 places ; B sinon. */
export function requiredCategory(v: Pick<Vehicle, 'seats'> | undefined): { label: string; accepts: string[] } {
  const seats = v?.seats ?? 0;
  if (seats > 17) return { label: 'D', accepts: ['D'] };
  if (seats > 9) return { label: 'D1 ou D', accepts: ['D1', 'D'] };
  return { label: 'B', accepts: ['B', 'BE', 'C1', 'C', 'D1', 'D'] };
}

const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Absence qui chevauche la mission (dates locales, bornes incluses). */
export function absenceDuring(driverId: string, start: string, end: string, absences: DriverAbsence[]): DriverAbsence | undefined {
  const s = day(start);
  const e = day(end);
  return absences.find((a) => a.driverId === driverId && a.startDate <= e && a.endDate >= s);
}

/** Contrat VTC actif du chauffeur qui chevauche la période. */
export function vtcDuring<T extends Pick<VtcContract, 'driverId' | 'status' | 'startDate' | 'endDate'>>(driverId: string, start: string, end: string, vtc: T[]): T | undefined {
  const s = day(start);
  const e = day(end);
  return vtc.find((k) => k.driverId === driverId && (k.status === 'actif' || k.status === 'suspendu') && k.startDate <= e && (!k.endDate || k.endDate >= s));
}

/**
 * Ce qui empêche d'affecter ce chauffeur à cette mission, ou null.
 * Contrôles : actif, permis valable jusqu'à la fin, catégorie adaptée au véhicule, pas absent.
 */
export function driverBlocker(
  d: Driver, v: Pick<Vehicle, 'seats'> | undefined, start: string, end: string, absences: DriverAbsence[] = [],
  vtc: Pick<VtcContract, 'driverId' | 'status' | 'startDate' | 'endDate' | 'number'>[] = [],
): string | null {
  if (!d.active) return `${d.name} est inactif.`;
  if (d.licenseExpiry && d.licenseExpiry < day(end)) {
    return d.licenseExpiry < day(new Date().toISOString())
      ? `Le permis de ${d.name} est expiré.`
      : `Le permis de ${d.name} expire avant la fin de la mission.`;
  }
  const need = requiredCategory(v);
  const has = licenseCategories(d.licenseCategory);
  if (has.length && !has.some((c) => need.accepts.includes(c))) return `Ce véhicule demande un permis ${need.label} ; ${d.name} a : ${has.join(', ')}.`;
  const a = absenceDuring(d.id, start, end, absences);
  const k = vtcDuring(d.id, start, end, vtc);
  if (k) return `${d.name} conduit en VTC (contrat ${k.number}) sur cette période.`;
  if (a) return `${d.name} est absent (${ABSENCE_LABEL[a.kind].toLowerCase()}) du ${a.startDate.split('-').reverse().join('/')} au ${a.endDate.split('-').reverse().join('/')}.`;
  return null;
}

/** Contrôle à faire sur la catégorie quand elle n'est pas renseignée : on ne bloque pas, on prévient. */
export function driverWarning(d: Driver, v: Pick<Vehicle, 'seats'> | undefined): string | null {
  if (!licenseCategories(d.licenseCategory).length) return `Catégories du permis de ${d.name} non renseignées : vérifiez qu’il peut conduire ce véhicule (${requiredCategory(v).label}).`;
  return null;
}

const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Feuille de mission envoyée au chauffeur par WhatsApp : tout ce qu'il lui faut pour la course. */
export function missionSheet(
  r: Pick<Reservation, 'number' | 'start' | 'end' | 'passengers' | 'itinerary' | 'notes' | 'transferKind' | 'flightNumber' | 'flightAt' | 'packageLabel' | 'crossBorder'>,
  client: Pick<Client, 'name' | 'phone' | 'contactName' | 'contactPhone'> | undefined,
  vehicle: Pick<Vehicle, 'brand' | 'model' | 'plate'> | undefined,
  driver: Pick<Driver, 'name'>,
  orgName: string,
): string {
  const lines = [
    `Bonjour ${driver.name.split(/\s+/)[0]}, voici ta mission ${r.number}${r.packageLabel ? ` (${r.packageLabel})` : ''} :`,
    `• Prise en charge : ${when(r.start)}`,
    `• Fin prévue : ${when(r.end)}`,
  ];
  const f = flightLabel(r);
  if (f) {
    lines.push(`• ${f}`);
    if (r.flightNumber) lines.push(`  Suivre le vol : ${flightTrackUrl(r.flightNumber)}`);
    if (r.transferKind === 'arrivee') lines.push('  Sois au hall des arrivées avant l’atterrissage, avec une pancarte au nom du client.');
  }
  if (vehicle) lines.push(`• Véhicule : ${vehicle.brand} ${vehicle.model}, ${vehicle.plate}`);
  if (client) {
    const name = client.contactName || client.name;
    const phone = client.contactPhone || client.phone;
    lines.push(`• Client : ${name}${client.contactName ? ` (${client.name})` : ''}, ${phone}`);
  }
  if (r.passengers) lines.push(`• Passagers : ${r.passengers}`);
  if (r.itinerary) lines.push(`• Trajet : ${r.itinerary}`);
  if (r.crossBorder) lines.push(`• Sortie autorisée vers : ${r.crossBorder}`);
  if (r.notes) lines.push(`• Notes : ${r.notes}`);
  lines.push('Merci de confirmer la bonne réception.', orgName);
  return lines.join('\n');
}

/** Les 7 jours d'une semaine (lundi en premier) à partir d'une date. */
export function weekDays(ref: Date): string[] {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  });
}

export type DriverDayState =
  | { kind: 'mission'; reservation: Reservation }
  | { kind: 'absence'; absence: DriverAbsence }
  | { kind: 'vtc'; contract: Pick<VtcContract, 'id' | 'number'> }
  | { kind: 'libre' };

/** Ce que fait un chauffeur un jour donné. */
export function driverDay(driverId: string, isoDay: string, reservations: Reservation[], absences: DriverAbsence[], vtc: VtcContract[] = []): DriverDayState {
  const a = absences.find((x) => x.driverId === driverId && x.startDate <= isoDay && x.endDate >= isoDay);
  if (a) return { kind: 'absence', absence: a };
  const k = vtcDuring(driverId, isoDay + 'T12:00:00', isoDay + 'T12:00:00', vtc);
  if (k) return { kind: 'vtc', contract: k };
  const r = reservations.find((x) => x.driverId === driverId && (x.status === 'reservee' || x.status === 'en_cours') && day(x.start) <= isoDay && day(x.end) >= isoDay);
  if (r) return { kind: 'mission', reservation: r };
  return { kind: 'libre' };
}
