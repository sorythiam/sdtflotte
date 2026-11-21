import { useState, type FormEvent } from 'react';
import { slugify, SLUG_RE } from '../domain/booking';
import { useData } from '../state/DataContext';
import { ErrorBox } from './ui';

export function BookingSettingsForm({ editable }: { editable: boolean }) {
  const { session, store, setSession, toast } = useData();
  const org = session!.org;
  const [slug, setSlug] = useState(org.bookingSlug ?? slugify(org.name));
  const [enabled, setEnabled] = useState(!!org.bookingEnabled);
  const [error, setError] = useState<string | null>(null);
  const url = `${window.location.origin}/r/${org.bookingSlug ?? slug}`;
  const dirty = slug !== (org.bookingSlug ?? '') || enabled !== !!org.bookingEnabled;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!SLUG_RE.test(slug)) return setError('Adresse invalide : 3 à 40 caractères, lettres minuscules, chiffres et tirets.');
    try {
      await store.updateOrganization({ booking: { slug, enabled } });
      setSession(await store.session());
      toast(enabled ? 'Page de réservation en ligne ouverte' : 'Page de réservation en ligne fermée');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast('Lien copié');
    } catch {
      toast(url);
    }
  }

  return (
    <section className="card" aria-labelledby="enligne">
      <h2 id="enligne">Réservation en ligne</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Une page publique, sans compte, où vos clients voient vos catégories, vos prix et les disponibilités, puis envoient une demande. Les
        demandes arrivent dans « Demandes en ligne » ; un agent les accepte ou les refuse. Le numéro de plaque et vos autres données ne sont
        jamais affichés.
      </p>
      <form className="stack" onSubmit={save}>
        <fieldset disabled={!editable} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
            <strong>Page ouverte au public</strong>
          </label>
          <label className="field">
            Adresse de la page
            <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
              <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{window.location.host}/r/</span>
              <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={40} aria-describedby="slughint" />
            </div>
            <span className="hint" id="slughint">Lettres minuscules, chiffres et tirets. Changer l’adresse casse les liens déjà partagés.</span>
          </label>
        </fieldset>
        <ErrorBox error={error} />
        <div className="row">
          {editable && <button className="btn btn-dark" disabled={!dirty}>Enregistrer</button>}
          {org.bookingEnabled && org.bookingSlug && (
            <>
              <button type="button" className="btn" onClick={copy}>Copier le lien</button>
              <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">Voir la page</a>
            </>
          )}
        </div>
        {!editable && <span className="hint">Seul un administrateur peut ouvrir ou fermer la page.</span>}
        {org.bookingEnabled && (
          <p className="small muted" style={{ margin: 0 }}>
            À partager sur WhatsApp, Facebook, Google Maps et votre site. Les coordonnées et le logo affichés viennent de la rubrique Contrat.
          </p>
        )}
      </form>
    </section>
  );
}
