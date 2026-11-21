import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { contractSettings, DEFAULT_TERMS, type ContractSettings } from '../domain/contract';
import { useData } from '../state/DataContext';
import { ErrorBox } from './ui';

/** Réduit une image à 400 px de large au plus, en PNG si transparente sinon JPEG. */
async function shrinkImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez une image (PNG ou JPEG).');
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

export function ContractSettingsForm({ editable }: { editable: boolean }) {
  const { session, store, setSession, toast } = useData();
  const org = session!.org;
  const [s, setS] = useState<ContractSettings>(() => contractSettings(org.name, org.contract));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ContractSettings) => (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value });

  async function onLogo(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setS({ ...s, logo: await shrinkImage(file) });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // On n'enregistre pas les CG si elles sont restées celles du modèle : les mises à jour du modèle s'appliqueront.
      const contract: Partial<ContractSettings> = {
        ...s,
        legalName: s.legalName.trim() === org.name ? '' : s.legalName.trim(),
        terms: s.terms.trim() === DEFAULT_TERMS.trim() ? '' : s.terms,
      };
      await store.updateOrganization({ contract });
      setSession(await store.session());
      toast('Réglages du contrat enregistrés');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="contrat">
      <h2 id="contrat">Contrat de location</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Ces informations apparaissent sur chaque contrat (bouton « Contrat PDF » d’une réservation).
      </p>
      <form className="stack" onSubmit={save}>
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
          <div className="grid-2">
            <label className="field">Raison sociale<input value={s.legalName} onChange={set('legalName')} maxLength={160} /></label>
            <label className="field">RCCM, NINEA ou autre identifiant<input value={s.registration} onChange={set('registration')} maxLength={200} /></label>
            <label className="field">Adresse<input value={s.address} onChange={set('address')} maxLength={200} /></label>
            <label className="field">Ville (pour « Fait à … »)<input value={s.city} onChange={set('city')} maxLength={80} /></label>
            <label className="field">Téléphone<input value={s.phone} onChange={set('phone')} maxLength={40} inputMode="tel" /></label>
            <label className="field">Email<input value={s.email} onChange={set('email')} maxLength={120} type="email" /></label>
          </div>
          <div className="row" style={{ alignItems: 'center' }}>
            {s.logo ? (
              <img src={s.logo} alt="Logo actuel" style={{ maxHeight: 56, maxWidth: 160, objectFit: 'contain', border: '1px solid var(--sable-line)', borderRadius: 6, padding: 4, background: '#fff' }} />
            ) : (
              <span className="small muted">Aucun logo</span>
            )}
            <label className="btn btn-sm">
              {s.logo ? 'Changer le logo' : 'Ajouter un logo'}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => onLogo(e.target.files?.[0])} />
            </label>
            {s.logo && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setS({ ...s, logo: null })}>Retirer</button>}
          </div>
          <label className="field">
            Conditions générales
            <textarea value={s.terms} onChange={set('terms')} rows={12} style={{ fontSize: 13, lineHeight: 1.45 }} />
            <span className="hint">
              Un article par paragraphe, séparés par une ligne vide ; une première ligne commençant par « Article » sert de titre. Le texte
              proposé est un modèle de départ : faites-le valider par votre conseil juridique.
            </span>
          </label>
        </fieldset>
        <ErrorBox error={error} />
        {editable ? (
          <div className="row">
            <button className="btn btn-dark" disabled={busy}>Enregistrer</button>
            {s.terms.trim() !== DEFAULT_TERMS.trim() && (
              <button type="button" className="btn btn-ghost" onClick={() => setS({ ...s, terms: DEFAULT_TERMS })}>Revenir au modèle de conditions</button>
            )}
          </div>
        ) : (
          <span className="hint">Seul un administrateur peut modifier le contrat.</span>
        )}
      </form>
      <p className="small muted" style={{ margin: 0 }}>
        Aperçu : ouvrez une réservation dans <Link to="/reservations">Réservations et contrats</Link>, puis « Contrat PDF ».
      </p>
    </section>
  );
}
