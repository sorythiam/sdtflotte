// Photos de véhicules : règles communes (le redimensionnement est fait dans le navigateur).

export const MAX_PHOTOS = 8;
export const MAX_UPLOAD_BYTES = 15_000_000; // fichier choisi par l'utilisateur, avant réduction

/** Photos à montrer pour une catégorie : couvertures d'abord, sans doublon, au plus `max`. */
export function categoryPhotos(vehicles: { category: string; outOfService: boolean; photos?: string[] }[], category: string, max = MAX_PHOTOS): string[] {
  const inCat = vehicles.filter((v) => v.category === category && !v.outOfService && v.photos?.length);
  const covers = inCat.map((v) => v.photos![0]);
  const rest = inCat.flatMap((v) => v.photos!.slice(1));
  return [...new Set([...covers, ...rest])].slice(0, max);
}

/** Taille cible en gardant les proportions. */
export function fitWithin(w: number, h: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Chemin de stockage tiré d'une adresse publique Supabase (…/object/public/<bucket>/<chemin>). */
export function storagePath(url: string, bucket: string): string | null {
  const marker = `/object/public/${bucket}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
}
