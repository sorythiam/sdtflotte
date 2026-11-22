import { useEffect, useState } from 'react';
import { getPhoto, isLocal } from '../offline/outbox';
import { useData } from './DataContext';

/**
 * Adresses affichables des photos d'état des lieux : liens temporaires pour les photos envoyées,
 * images lues dans le téléphone pour celles encore en attente d'envoi.
 */
export function useSignedUrls(paths: string[], bucket: 'inspection' | 'client' = 'inspection'): Record<string, string> {
  const { store } = useData();
  const key = paths.join('|');
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!paths.length) return;
    let live = true;
    const made: string[] = [];
    const local = paths.filter(isLocal);
    const remote = paths.filter((p) => !isLocal(p));
    void Promise.all(
      local.map(async (ref) => {
        const blob = await getPhoto(ref).catch(() => undefined);
        if (!blob) return [ref, ''] as const;
        const u = URL.createObjectURL(blob);
        made.push(u);
        return [ref, u] as const;
      }),
    ).then((pairs) => live && setUrls((prev) => ({ ...prev, ...Object.fromEntries(pairs.filter(([, u]) => u)) })));
    if (remote.length && navigator.onLine !== false) {
      (bucket === 'client' ? store.clientDocumentUrls(remote) : store.inspectionPhotoUrls(remote)).then((u) => live && setUrls((prev) => ({ ...prev, ...u }))).catch(() => undefined);
    }
    return () => {
      live = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, key, bucket]);
  return urls;
}
