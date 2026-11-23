import { useEffect, useState, type FormEvent } from 'react';
import { ErrorBox } from '../components/ui';
import { useData } from '../state/DataContext';

/** Page ouverte par le lien reçu par email : choisir un nouveau mot de passe. */
export function NewPassword() {
  const { store, setSession } = useData();
  const [ready, setReady] = useState<boolean | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Le client Supabase lit le jeton dans l'adresse ; on lui laisse un instant.
    const t = window.setTimeout(() => void store.hasRecoverySession().then(setReady), 600);
    return () => window.clearTimeout(t);
  }, [store]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) return setError('8 caractères minimum.');
    if (pw !== pw2) return setError('Les deux mots de passe ne sont pas identiques.');
    setBusy(true);
    try {
      await store.changePassword(pw);
      window.history.replaceState(null, '', '/');
      setSession(await store.session());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="card">
        <h1 style={{ fontSize: 22, margin: 0 }}>Nouveau mot de passe</h1>
        {ready === null ? (
          <span className="muted">Vérification du lien…</span>
        ) : !ready ? (
          <>
            <p style={{ margin: 0 }}>Ce lien n’est plus valable : il a expiré ou a déjà servi. Demandez-en un nouveau depuis la page de connexion.</p>
            <a className="btn btn-primary" href="/">Retour à la connexion</a>
          </>
        ) : (
          <form className="stack" onSubmit={submit}>
            <label className="field">Nouveau mot de passe<input type="password" required minLength={8} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /><span className="hint">8 caractères minimum</span></label>
            <label className="field">Confirmer<input type="password" required minLength={8} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
            <ErrorBox error={error} />
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Un instant…' : 'Enregistrer et me connecter'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
