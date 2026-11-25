import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { contractSettings, DEFAULT_TERMS, type ContractSettings } from '../domain/contract';
import { useData } from '../state/DataContext';
import { ErrorBox } from './ui';

export function ContractSettingsForm({ editable }: { editable: boolean }) {
  const { session, store, setSession, toast } = useData();
  const org = session!.org;
  const [s, setS] = useState<ContractSettings>(() => contractSettings(org.name, org.contract));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ContractSettings) => (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // On n'enregistre pas les CG si elles sont restées celles du modèle : les mises à jour du modèle s'appliqueront.
      const contract: Partial<ContractSettings> = {
        ...s,
        logo: org.contract?.logo ?? null, // le logo se gère dans sa propre carte
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
          <p className="small muted" style={{ margin: 0 }}>Le logo se règle dans la carte « Logo » de cette page.</p>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 'var(--space-2)' }}>
            <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Vérification du client</legend>
            <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={s.requireVerifiedClient} onChange={(e) => setS({ ...s, requireVerifiedClient: e.target.checked })} style={{ marginTop: 3 }} />
              <span>Exiger un dossier client vérifié (pièce, permis valide, photos) avant la remise des clés</span>
            </label>
            <label className="field" style={{ maxWidth: 260 }}>
              Âge minimum du conducteur
              <select value={s.minDriverAge} onChange={(e) => setS({ ...s, minDriverAge: Number(e.target.value) })}>
                <option value={0}>Pas d’âge minimum</option>
                {[18, 21, 23, 25].map((a) => <option key={a} value={a}>{a} ans</option>)}
              </select>
            </label>
          </fieldset>
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
