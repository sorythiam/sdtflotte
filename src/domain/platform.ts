// Console de l'équipe Yoon Fleet (TBG) : inscriptions, essais et appels d'onboarding.
// Lancement 100 % digital : chaque loueur inscrit est rappelé pour l'aider à démarrer.

export type FollowStatus = 'a_appeler' | 'injoignable' | 'rappeler' | 'onboarde' | 'perdu';

export const FOLLOW_LABEL: Record<FollowStatus, string> = {
  a_appeler: 'À appeler',
  injoignable: 'Injoignable',
  rappeler: 'À rappeler',
  onboarde: 'Accompagné',
  perdu: 'Perdu',
};

export interface SignupRow {
  orgId: string;
  name: string;
  country: string;
  createdAt: string | null;
  plan: string;
  trialEndsAt: string | null;
  paidUntil: string | null;
  contactName: string | null;
  contactPhone: string | null;
  adminEmail: string | null;
  signupSource: string | null;
  vehicles: number;
  clients: number;
  reservations: number;
  members: number;
  lastActivity: string | null;
  status: FollowStatus;
  note: string | null;
  nextCall: string | null;
  followupAt: string | null;
}

/** Où en est le loueur : du simple compte créé jusqu'à l'abonnement payé. */
export type Stage = 'inscrit' | 'flotte' | 'location' | 'payant';

export const STAGE_LABEL: Record<Stage, string> = {
  inscrit: 'Inscrit',
  flotte: 'Flotte saisie',
  location: 'Première location',
  payant: 'Payant',
};

export function stageOf(r: Pick<SignupRow, 'vehicles' | 'reservations' | 'paidUntil'>, now: Date): Stage {
  if (r.paidUntil && Date.parse(r.paidUntil) > now.getTime()) return 'payant';
  if (r.reservations > 0) return 'location';
  if (r.vehicles > 0) return 'flotte';
  return 'inscrit';
}

/** Heures écoulées depuis l'inscription (null si inconnue). */
export function hoursSince(iso: string | null, now: Date): number | null {
  return iso ? Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 3600000)) : null;
}

/** Jours d'essai restants (négatif = essai terminé). */
export function trialDaysLeft(r: Pick<SignupRow, 'trialEndsAt'>, now: Date): number | null {
  return r.trialEndsAt ? Math.ceil((Date.parse(r.trialEndsAt) - now.getTime()) / 86400000) : null;
}

/**
 * Qui appeler en premier : les nouveaux inscrits pas encore appelés (le plus récent d'abord,
 * l'idéal est dans l'heure), puis les rappels du jour, puis les essais qui finissent bientôt
 * sans première location.
 */
export function callPriority(r: SignupRow, now: Date): number {
  const stage = stageOf(r, now);
  if (stage === 'payant' || r.status === 'perdu') return 0;
  const today = now.toISOString().slice(0, 10);
  if (r.status === 'a_appeler') return 300 - Math.min(200, hoursSince(r.createdAt, now) ?? 200);
  if ((r.status === 'rappeler' || r.status === 'injoignable') && (!r.nextCall || r.nextCall <= today)) return 150;
  const left = trialDaysLeft(r, now);
  if (left !== null && left >= 0 && left <= 7 && stage !== 'location') return 120 - left;
  return 10;
}

export interface Funnel {
  signups: number;
  called: number; // joints au moins une fois (accompagné)
  fleet: number; // au moins un véhicule
  firstRental: number; // au moins une réservation
  paying: number;
}

/** Entonnoir sur les inscriptions des `days` derniers jours. */
export function funnel(rows: SignupRow[], now: Date, days = 30): Funnel {
  const since = now.getTime() - days * 86400000;
  const recent = rows.filter((r) => r.createdAt && Date.parse(r.createdAt) >= since);
  const st = recent.map((r) => stageOf(r, now));
  return {
    signups: recent.length,
    called: recent.filter((r) => r.status === 'onboarde').length,
    fleet: st.filter((s) => s !== 'inscrit').length,
    firstRental: st.filter((s) => s === 'location' || s === 'payant').length,
    paying: st.filter((s) => s === 'payant').length,
  };
}

export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

/** Premier message WhatsApp au gérant, avant ou après l'appel. */
export function welcomeMessage(r: Pick<SignupRow, 'contactName' | 'name'>, agent: string): string {
  const first = (r.contactName ?? '').trim().split(/\s+/)[0];
  return [
    `Bonjour${first ? ` ${first}` : ''}, ici ${agent} de Yoon Fleet.`,
    `Merci d'avoir créé l'espace ${r.name}. Je vous accompagne pour démarrer : en 20 minutes au téléphone, on saisit vos véhicules et on fait votre première réservation ensemble.`,
    `Quel moment vous arrange aujourd'hui ou demain ?`,
  ].join('\n');
}

/** Source publicitaire lisible : « facebook / lancement-dec ». */
export function sourceLabel(s: string | null): string {
  return s ? s.replace(/\|/g, ' / ') : 'Directe';
}

/** Lit utm_source et utm_campaign de l'adresse (publicité d'origine), au format « source|campagne ». */
export function utmFrom(search: string): string | null {
  const p = new URLSearchParams(search);
  const src = (p.get('utm_source') ?? '').trim().slice(0, 40);
  const camp = (p.get('utm_campaign') ?? '').trim().slice(0, 60);
  if (!src && !camp) return null;
  return [src || 'inconnu', camp].filter(Boolean).join('|');
}
