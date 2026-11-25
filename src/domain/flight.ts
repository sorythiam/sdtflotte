// Transferts aéroport : le vol du client (arrivée ou départ), pour que le chauffeur soit là au bon moment.

export type TransferKind = 'arrivee' | 'depart';

export interface FlightInfo {
  transferKind?: TransferKind | null;
  flightNumber?: string | null; // AF718, SN205, HC404…
  flightAt?: string | null; // heure prévue du vol (atterrissage ou décollage), ISO
}

export const TRANSFER_LABEL: Record<TransferKind, string> = {
  arrivee: 'Accueil à l’arrivée (aéroport → destination)',
  depart: 'Dépôt pour un départ (lieu de prise en charge → aéroport)',
};

/** « af 718 » → « AF718 ». */
export function normalizeFlight(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

/** Code compagnie (2 caractères, ou 3 lettres) suivi de 1 à 4 chiffres et d’une lettre facultative. */
export const isFlightNumber = (n: string) => /^([A-Z][A-Z0-9]|[0-9][A-Z]|[A-Z]{3})\d{1,4}[A-Z]?$/.test(n);

/** Heure de prise en charge conseillée : à l’atterrissage, ou 3 h avant un vol international. */
export function suggestedPickup(kind: TransferKind, flightAt: string, leadHours = 3): string {
  const t = Date.parse(flightAt);
  return new Date(kind === 'arrivee' ? t : t - leadHours * 3600000).toISOString();
}

/** Contrôle du vol saisi. Renvoie un message ou null ; rien à contrôler si ce n'est pas un transfert. */
export function validateFlight(f: FlightInfo, start: string): string | null {
  if (!f.transferKind) return null;
  const n = normalizeFlight(f.flightNumber ?? '');
  if (!isFlightNumber(n)) return 'Indiquez le numéro de vol (par exemple AF718 ou SN205).';
  const at = Date.parse(f.flightAt ?? '');
  if (!Number.isFinite(at)) return f.transferKind === 'arrivee' ? 'Indiquez l’heure d’arrivée du vol.' : 'Indiquez l’heure de départ du vol.';
  const s = Date.parse(start);
  if (Number.isFinite(s) && Math.abs(at - s) > 24 * 3600000) return 'L’heure du vol et celle de la prise en charge sont à plus de 24 h d’écart : vérifiez les dates.';
  if (f.transferKind === 'depart' && Number.isFinite(s) && s > at) return 'La prise en charge doit avoir lieu avant le décollage.';
  return null;
}

/** Remarque utile au chauffeur : prise en charge trop tard ou trop juste. */
export function flightWarning(f: FlightInfo, start: string): string | null {
  if (!f.transferKind || !f.flightAt) return null;
  const gap = (Date.parse(f.flightAt) - Date.parse(start)) / 3600000;
  if (f.transferKind === 'depart' && gap < 2.5) return 'Moins de 2 h 30 entre la prise en charge et le décollage : c’est juste pour un vol international.';
  if (f.transferKind === 'arrivee' && gap > 0.25) return 'Le chauffeur arrive après l’atterrissage : le client risque d’attendre.';
  return null;
}

const hm = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dm = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

/** « Vol AF718, arrivée prévue le 26/11 à 14:35 ». */
export function flightLabel(f: FlightInfo): string | null {
  if (!f.transferKind || !f.flightNumber) return null;
  const when = f.flightAt ? ` le ${dm(f.flightAt)} à ${hm(f.flightAt)}` : '';
  return `Vol ${f.flightNumber}, ${f.transferKind === 'arrivee' ? 'arrivée' : 'départ'} prévu${f.transferKind === 'arrivee' ? 'e' : ''}${when}`;
}

/** Lien public pour suivre le vol en temps réel (retard, atterrissage). */
export const flightTrackUrl = (n: string) => `https://www.flightradar24.com/data/flights/${encodeURIComponent(n.toLowerCase())}`;
