// Vérification du client avant de lui confier un véhicule, et historique de son comportement.

import type { Inspection } from './inspection';
import type { Client, ClientScore, DocSlot, Incident, IncidentKind, IdType, Reservation } from './types';

export const ID_TYPES: [IdType, string][] = [
  ['cni', 'Carte nationale d’identité'],
  ['carte_cedeao', 'Carte d’identité CEDEAO'],
  ['passeport', 'Passeport'],
  ['carte_sejour', 'Carte de séjour'],
  ['autre', 'Autre pièce'],
];
export const DOC_SLOTS: { slot: DocSlot; label: string; hint: string; selfie?: boolean }[] = [
  { slot: 'idFront', label: 'Pièce d’identité (recto)', hint: 'Toute la carte, lisible, sans reflet' },
  { slot: 'idBack', label: 'Pièce d’identité (verso)', hint: 'Inutile pour un passeport' },
  { slot: 'license', label: 'Permis de conduire', hint: 'Face avec la photo et les catégories' },
  { slot: 'selfie', label: 'Photo du client', hint: 'Visage du client au comptoir, pour comparer avec la pièce', selfie: true },
];
export const INCIDENT_KINDS: [IncidentKind, string][] = [
  ['retard', 'Retour en retard'],
  ['dommage', 'Dégâts sur le véhicule'],
  ['impaye', 'Impayé'],
  ['accident', 'Accident'],
  ['amende', 'Amende, contravention'],
  ['comportement', 'Comportement'],
  ['autre', 'Autre'],
];
export const incidentLabel = (k: IncidentKind) => INCIDENT_KINDS.find(([v]) => v === k)?.[1] ?? k;

export type VerificationState = 'verifie' | 'a_revoir' | 'incomplet';
export interface Verification {
  state: VerificationState;
  /** Ce qui manque ou bloque, en clair. */
  issues: string[];
  /** Le dossier est complet : l'agent peut le valider. */
  ready: boolean;
}

const day = (iso: string) => Date.parse(iso.slice(0, 10) + 'T00:00:00Z');
function age(birth: string, now: Date): number {
  const b = new Date(birth + 'T00:00:00Z');
  let a = now.getUTCFullYear() - b.getUTCFullYear();
  if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

/**
 * État du dossier d'un client (pour une entreprise : celui du conducteur habituel).
 * Vérifié = pièces complètes, en cours de validité, contrôlées par un agent sur les originaux.
 */
export function verificationOf(c: Client, now: Date, minAge = 0): Verification {
  const issues: string[] = [];
  const docs = c.documents ?? {};
  const today = day(now.toISOString());
  if (!c.idNumber) issues.push('Numéro de la pièce d’identité');
  if (!docs.idFront) issues.push('Photo de la pièce d’identité');
  if (!c.licenseNumber) issues.push('Numéro du permis');
  if (!c.licenseExpiry) issues.push('Date de validité du permis');
  if (!docs.license) issues.push('Photo du permis');
  const expired: string[] = [];
  if (c.idExpiry && day(c.idExpiry) < today) expired.push('Pièce d’identité expirée');
  if (c.licenseExpiry && day(c.licenseExpiry) < today) expired.push('Permis expiré');
  const young = minAge > 0 && c.birthDate && age(c.birthDate, now) < minAge ? [`Conducteur de moins de ${minAge} ans`] : [];
  const blocking = [...expired, ...young];
  const ready = issues.length === 0 && blocking.length === 0;
  if (c.verifiedAt) return { state: blocking.length ? 'a_revoir' : 'verifie', issues: blocking, ready };
  return { state: blocking.length ? 'a_revoir' : 'incomplet', issues: [...blocking, ...issues.map((i) => `Manque : ${i.charAt(0).toLowerCase()}${i.slice(1)}`)], ready };
}

export const verificationLabel: Record<VerificationState, [string, string]> = {
  verifie: ['Vérifié', 'badge-success'],
  a_revoir: ['À revoir', 'badge-danger'],
  incomplet: ['Non vérifié', 'badge-warning'],
};

export interface ClientHistory {
  rentals: number; // locations terminées
  late: number; // retours constatés après l'heure prévue (marge de 2 h)
  fees: number; // frais facturés au retour (km, carburant, dégâts, retard)
  incidents: Incident[];
  graves: number;
  /** Proposition de scoring tirée de l'historique ; null si rien à signaler. */
  suggestion: { score: ClientScore; reason: string } | null;
}

const LATE_MARGIN = 2 * 3600 * 1000;

/** Historique d'un client : locations, retards constatés à l'état des lieux, frais, incidents saisis. */
export function historyOf(clientId: string, reservations: Reservation[], inspections: Inspection[], incidents: Incident[]): ClientHistory {
  const done = reservations.filter((r) => r.clientId === clientId && r.status === 'terminee');
  const returns = new Map(inspections.filter((i) => i.kind === 'retour').map((i) => [i.reservationId, i]));
  const late = done.filter((r) => {
    const ret = returns.get(r.id);
    return ret ? Date.parse(ret.doneAt) - Date.parse(r.end) > LATE_MARGIN : false;
  }).length;
  const fees = done.reduce((s, r) => s + r.fees, 0);
  const mine = incidents.filter((i) => i.clientId === clientId).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt));
  const graves = mine.filter((i) => i.severity === 'grave').length;
  let suggestion: ClientHistory['suggestion'] = null;
  const unpaid = mine.filter((i) => i.kind === 'impaye' && i.severity === 'grave').length;
  if (unpaid > 0 || graves >= 2) suggestion = { score: 'blacklist', reason: unpaid ? 'Impayé grave enregistré' : `${graves} incidents graves` };
  else if (graves === 1 || late >= 3 || mine.length >= 3) {
    suggestion = { score: 'surveiller', reason: graves ? 'Un incident grave' : late >= 3 ? `${late} retours en retard` : `${mine.length} incidents` };
  }
  return { rentals: done.length, late, fees, incidents: mine, graves, suggestion };
}

/** Peut-on remettre les clés ? Bloque si le loueur exige un client vérifié et que ce n'est pas le cas. */
export function departureCheck(c: Client | undefined, now: Date, requireVerified: boolean, minAge = 0, withDriver = false): { ok: boolean; message: string | null } {
  if (!c) return { ok: true, message: null };
  if (c.score === 'blacklist') return { ok: false, message: `Client blacklisté${c.scoreReason ? ` : ${c.scoreReason}` : ''}. Départ impossible.` };
  if (withDriver) return { ok: true, message: null }; // c'est votre chauffeur qui conduit
  const v = verificationOf(c, now, minAge);
  if (v.state === 'verifie') return { ok: true, message: null };
  const what = v.state === 'a_revoir' ? v.issues.join(', ') : 'dossier client non vérifié';
  return requireVerified
    ? { ok: false, message: `Départ impossible : ${what}. Complétez et validez la fiche du client.` }
    : { ok: true, message: `Attention : ${what}.` };
}
