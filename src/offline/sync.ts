// Envoi de la file d'attente quand le réseau revient. Chaque étape peut être rejouée sans doublon.

import { invoiceFees, type BillingContext } from '../data/services';
import type { Store } from '../data/store';
import { dropPhoto, getPhoto, isNetworkError, localRefs, pending, removeEntry, replaceLocalRefs, saveEntry, type PendingInspection } from './outbox';

const isDuplicate = (e: unknown) => /doublon|duplicate|23505|unique/i.test(String((e as Error)?.message ?? e));

let running: Promise<SyncResult> | null = null;

export interface SyncResult {
  sent: number;
  left: number;
  error: string | null;
}

/** Envoie tout ce qui attend pour cette entreprise. Un seul envoi à la fois. */
export function syncOutbox(store: Store, orgId: string, billing: () => BillingContext): Promise<SyncResult> {
  running ??= run(store, orgId, billing).finally(() => {
    running = null;
  });
  return running;
}

async function run(store: Store, orgId: string, billing: () => BillingContext): Promise<SyncResult> {
  let sent = 0;
  let error: string | null = null;
  const list = await pending(orgId);
  for (const entry of list) {
    try {
      await sendOne(store, entry, billing);
      sent += 1;
    } catch (e) {
      error = (e as Error).message;
      await saveEntry({ ...entry, attempts: entry.attempts + 1, lastError: error });
      if (isNetworkError(e)) break; // plus de réseau : on réessaiera plus tard
    }
  }
  return { sent, left: (await pending(orgId)).length, error };
}

async function sendOne(store: Store, entry: PendingInspection, billing: () => BillingContext) {
  const ins = entry.inspection;
  const r0 = ins.reservationId;

  // 1. Photos gardées sur le téléphone → espace privé.
  const sentRefs: Record<string, string> = {};
  for (const ref of localRefs(ins.items)) {
    const blob = await getPhoto(ref);
    if (!blob) continue; // photo perdue (stockage vidé) : on garde l'état des lieux sans elle
    sentRefs[ref] = await store.uploadInspectionPhoto(blob, r0);
  }
  const { items } = replaceLocalRefs(ins.items, sentRefs);
  const clean = items.map((it) => ({ ...it, photos: it.photos.filter((p) => !p.startsWith('local:')) }));
  // On mémorise l'avancement : si la suite échoue, les photos ne seront pas renvoyées.
  const progressed: PendingInspection = { ...entry, inspection: { ...ins, items: clean } };
  await saveEntry(progressed);

  // 2. L'état des lieux (unique par réservation et par sens).
  try {
    await store.insert('inspections', progressed.inspection);
  } catch (e) {
    if (!isDuplicate(e)) throw e;
  }

  // 3. Effets sur la réservation et le véhicule, d'après l'état actuel en base.
  const reservations = await store.list('reservations');
  const r = reservations.find((x) => x.id === r0);
  const fx = entry.effects;
  if (r && fx.kind === 'depart' && r.status === 'reservee') {
    await store.update('reservations', r.id, { status: 'en_cours', mileageOut: fx.mileage });
  }
  if (r && fx.kind === 'retour' && (r.status === 'en_cours' || r.status === 'terminee')) {
    if (r.status === 'en_cours') {
      await store.update('reservations', r.id, { status: 'terminee', mileageIn: fx.mileage, fees: fx.fees, end: fx.end ?? r.end });
    }
    // Vérifié même si la location était déjà clôturée : un envoi coupé avant la facture la crée au suivant.
    if (fx.fees > 0) {
      const invoices = await store.list('invoices');
      const already = invoices.some((i) => i.reservationId === r.id && i.kind === 'complement');
      if (!already) await invoiceFees(store, { ...billing(), invoices }, { ...r, fees: fx.fees, end: fx.end ?? r.end }, fx.detail);
    }
  }
  if (fx.vehicleId) await store.update('vehicles', fx.vehicleId, { mileage: fx.mileage }).catch(() => undefined);

  // 4. Ménage.
  for (const ref of Object.keys(sentRefs)) await dropPhoto(ref).catch(() => undefined);
  await removeEntry(entry.id);
}
