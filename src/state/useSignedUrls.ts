import { useEffect, useState } from 'react';
import { useData } from './DataContext';

/** Adresses affichables des photos privées (liens temporaires), rechargées quand la liste change. */
export function useSignedUrls(paths: string[]): Record<string, string> {
  const { store } = useData();
  const key = paths.join('|');
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!paths.length) return;
    let live = true;
    store.inspectionPhotoUrls(paths).then((u) => live && setUrls((prev) => ({ ...prev, ...u }))).catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, key]);
  return urls;
}
