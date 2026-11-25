import { useState } from 'react';
import { useData } from '../state/DataContext';
import { ErrorBox } from './ui';

/** Réduit une image à 400 × 160 px au plus, en PNG (transparence gardée) sinon JPEG si trop lourde. */
export async function shrinkImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez une image (PNG, JPEG ou WebP).');
  if (file.size > 5_000_000) throw new Error('Image trop lourde (5 Mo maximum).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => ko(new Error('Image illisible.'));
      i.src = url;
    });
    const scale = Math.min(1, 400 / img.width, 160 / img.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    return png.length < 150_000 ? png : canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Logo de l'entreprise : enregistré dès l'envoi, affiché dans Yoon Fleet et sur tous les documents. */
export function LogoCard({ editable }: { editable: boolean }) {
  const { session, store, setSession, toast } = useData();
  const org = session!.org;
  const logo = org.contract?.logo ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string | null) {
    setError(null);
    setBusy(true);
    try {
      await store.updateOrganization({ contract: { ...(org.contract ?? {}), logo: next } });
      setSession(await store.session());
      toast(next ? 'Logo enregistré' : 'Logo retiré');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      await save(await shrinkImage(file));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="card stack" aria-labelledby="logo">
      <h2 id="logo">Logo</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Votre logo s’affiche dans Yoon Fleet pour toute l’équipe, et sur les contrats, devis, factures, la page de réservation en ligne et l’espace client.
      </p>
      <div className="logo-preview">
        {logo ? <img src={logo} alt={`Logo de ${org.name}`} /> : <span className="small muted">Aucun logo pour l’instant</span>}
      </div>
      {editable ? (
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <label className={`btn ${logo ? '' : 'btn-dark'}`} aria-disabled={busy}>
            {busy ? 'Envoi…' : logo ? 'Changer le logo' : 'Importer mon logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy}
              onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {logo && (
            <button type="button" className="btn btn-ghost" disabled={busy}
              onClick={() => window.confirm('Retirer le logo de Yoon Fleet et de vos documents ?') && void save(null)}>
              Retirer
            </button>
          )}
        </div>
      ) : (
        <span className="hint">Seul un administrateur peut changer le logo.</span>
      )}
      <span className="hint">PNG avec fond transparent de préférence, 5 Mo au plus. L’image est réduite automatiquement.</span>
      <ErrorBox error={error} />
    </section>
  );
}
