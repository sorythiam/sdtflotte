// Petit accès à IndexedDB (stockage du téléphone) : photos en attente, file d'envoi, dernière copie des données.

const DB = 'yoonfleet-offline';
const VERSION = 1;
export type StoreName = 'blobs' | 'outbox' | 'cache';

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Stockage hors connexion indisponible sur cet appareil.'));
  opening ??= new Promise((ok, ko) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['blobs', 'outbox', 'cache']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => {
      opening = null;
      ko(req.error ?? new Error('IndexedDB inaccessible'));
    };
  });
  return opening;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((ok, ko) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => ok(req.result as T);
        tx.onerror = () => ko(tx.error ?? req.error);
        tx.onabort = () => ko(tx.error ?? new Error('Écriture annulée (espace plein ?)'));
      }),
  );
}

export const idbGet = <T>(store: StoreName, key: string) => run<T | undefined>(store, 'readonly', (s) => s.get(key));
export const idbSet = (store: StoreName, key: string, value: unknown) => run<IDBValidKey>(store, 'readwrite', (s) => s.put(value, key)).then(() => undefined);
export const idbDel = (store: StoreName, key: string) => run<undefined>(store, 'readwrite', (s) => s.delete(key)).then(() => undefined);
export const idbAll = <T>(store: StoreName) => run<T[]>(store, 'readonly', (s) => s.getAll());
