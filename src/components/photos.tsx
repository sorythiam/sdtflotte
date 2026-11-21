import { useEffect, useState } from 'react';
import { fitWithin, MAX_UPLOAD_BYTES } from '../domain/photos';

/** Réduit une photo dans le navigateur (JPEG), pour un envoi léger sur réseau mobile. */
export async function shrinkPhoto(file: File, maxSide = 1600, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error(`« ${file.name} » n’est pas une image.`);
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`« ${file.name} » est trop lourde (15 Mo maximum).`);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => ko(new Error(`« ${file.name} » est illisible.`));
      i.src = url;
    });
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error('Conversion impossible.'))), 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Illustration neutre quand une catégorie n'a pas encore de photo. */
export function CarPlaceholder({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label={`Pas encore de photo pour ${label}`} style={{ width: '100%', height: '100%', display: 'block' }}>
      <rect width="320" height="200" fill="#F6F1E7" />
      <path d="M58 128 L74 96 Q80 84 94 82 L206 80 Q222 80 232 92 L252 116 L266 120 Q276 123 276 134 L276 142 L44 142 L44 136 Q44 128 58 128 Z" fill="none" stroke="#0B3C5D" strokeWidth="5" strokeLinejoin="round" />
      <path d="M96 92 L120 92 L120 116 L82 116 Z M132 92 L196 92 Q208 92 216 102 L226 116 L132 116 Z" fill="#0B3C5D" opacity="0.12" />
      <circle cx="98" cy="144" r="20" fill="#F6F1E7" stroke="#0B3C5D" strokeWidth="5" />
      <circle cx="226" cy="144" r="20" fill="#F6F1E7" stroke="#0B3C5D" strokeWidth="5" />
      <text x="160" y="186" textAnchor="middle" fontSize="13" fill="#5B6B7A" fontFamily="system-ui, sans-serif">Photo bientôt disponible</text>
    </svg>
  );
}

/** Galerie plein écran : flèches, clavier, vignettes. */
export function Lightbox({ photos, start, title, onClose }: { photos: string[]; start: number; title: string; onClose: () => void }) {
  const [i, setI] = useState(start);
  const n = photos.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % n);
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + n) % n);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [n, onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Photos : ${title}`} onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-top">
          <strong>{title}</strong>
          <span className="small">{i + 1} / {n}</span>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Fermer">Fermer</button>
        </div>
        <div className="lightbox-stage">
          {n > 1 && <button type="button" className="lightbox-nav" onClick={() => setI((i - 1 + n) % n)} aria-label="Photo précédente">‹</button>}
          <img src={photos[i]} alt={`${title}, photo ${i + 1} sur ${n}`} />
          {n > 1 && <button type="button" className="lightbox-nav right" onClick={() => setI((i + 1) % n)} aria-label="Photo suivante">›</button>}
        </div>
        {n > 1 && (
          <div className="lightbox-thumbs">
            {photos.map((p, k) => (
              <button key={p} type="button" aria-label={`Photo ${k + 1}`} aria-current={k === i} onClick={() => setI(k)}>
                <img src={p} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
