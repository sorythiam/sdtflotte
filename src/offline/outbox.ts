// File d'envoi des états des lieux faits sans réseau.
//
// Les photos prises hors connexion sont gardées dans le téléphone sous une référence « local:<id> ».
// À la synchronisation : envoi des photos, remplacement des références, enregistrement de l'état
// des lieux, puis effets sur la réservation. Chaque étape peut être rejouée sans doublon :
// l'état des lieux est unique par réservation et par sens, la facture de frais n'est créée
// que si elle n'existe pas déjà.

import type { InspectionItem, NewInspection } from '../domain/inspection';
import { idbAll, idbDel, idbGet, idbSet } from './idb';

export const LOCAL_PREFIX = 'local:';
export const isLocal = (ref: string) => ref.startsWith(LOCAL_PREFIX);

export interface PendingEffects {
  kind: 'depart' | 'retour';
  vehicleId: string | null;
  mileage: number;
  fees: number; // retour : total des frais
  end: string | null; // retour : nouvelle fin si retard
  detail: string; // retour : libellé de la facture de frais
}

export interface PendingInspection {
  id: string;
  orgId: string;
  createdAt: string;
  inspection: NewInspection;
  effects: PendingEffects;
  attempts: number;
  lastError: string | null;
}

/** Remplace les références locales par les chemins envoyés ; signale celles encore manquantes. */
export function replaceLocalRefs(items: InspectionItem[], sent: Record<string, string>): { items: InspectionItem[]; missing: string[] } {
  const missing: string[] = [];
  const out = items.map((it) => ({
    ...it,
    photos: it.photos.map((p) => {
      if (!isLocal(p)) return p;
      if (sent[p]) return sent[p];
      missing.push(p);
      return p;
    }),
  }));
  return { items: out, missing };
}

/** Références locales d'un état des lieux (photos à envoyer). */
export function localRefs(items: InspectionItem[]): string[] {
  return items.flatMap((i) => i.photos.filter(isLocal));
}

/** Une erreur de réseau, à réessayer plus tard (par opposition à un refus définitif). */
export function isNetworkError(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e).toLowerCase();
  return (typeof navigator !== 'undefined' && navigator.onLine === false) || /failed to fetch|network|load failed|fetch|timeout|connexion/.test(m);
}

// ---------------------------------------------------------------- stockage

export async function keepPhoto(blob: Blob): Promise<string> {
  const ref = `${LOCAL_PREFIX}${crypto.randomUUID()}`;
  await idbSet('blobs', ref, blob);
  return ref;
}

export const getPhoto = (ref: string) => idbGet<Blob>('blobs', ref);
export const dropPhoto = (ref: string) => idbDel('blobs', ref);

export async function enqueue(p: Omit<PendingInspection, 'id' | 'attempts' | 'lastError' | 'createdAt'>): Promise<PendingInspection> {
  const entry: PendingInspection = { ...p, id: crypto.randomUUID(), createdAt: new Date().toISOString(), attempts: 0, lastError: null };
  await idbSet('outbox', entry.id, entry);
  notify();
  return entry;
}

export async function pending(orgId?: string): Promise<PendingInspection[]> {
  try {
    const all = await idbAll<PendingInspection>('outbox');
    return all.filter((p) => !orgId || p.orgId === orgId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

export const saveEntry = (p: PendingInspection) => idbSet('outbox', p.id, p).then(notify);
export const removeEntry = (id: string) => idbDel('outbox', id).then(notify);

// Prévenir les écrans (bandeau, compteur) qu'une entrée a changé.
const listeners = new Set<() => void>();
export function onOutboxChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  listeners.forEach((fn) => fn());
}
