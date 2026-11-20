import { useState, type FormEvent } from 'react';
import { ErrorBox, Logo, Wordmark } from '../components/ui';
import { useData } from '../state/DataContext';

export function Login() {
  const { store, setSession } = useData();
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [country, setCountry] = useState('SN');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const demo = store.mode === 'demo';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (tab === 'login') await store.signIn(email, password);
      else await store.signUp(email, password, orgName, country);
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
        <h1 className="sr-only">Connexion à Yoon Fleet</h1>
        <div className="brand" style={{ justifyContent: 'center' }}>
          <Logo inverse={false} size={44} />
          <span className="brand-word" style={{ color: 'var(--atlantique)', fontSize: 28 }}>
            yoon <span style={{ color: 'var(--ocre-text)' }}>fleet</span>
          </span>
        </div>
        <p className="muted small" style={{ margin: 0, textAlign: 'center' }}>
          Gestion de flotte et location de véhicules
        </p>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'login'} onClick={() => setTab('login')}>
            Se connecter
          </button>
          <button type="button" role="tab" aria-selected={tab === 'signup'} onClick={() => setTab('signup')}>
            Essai gratuit 30 jours
          </button>
        </div>
        {demo && (
          <div className="notice">
            <strong>Démo :</strong> n’importe quel email. Le mot de passe choisit le profil :{' '}
            <code>direction</code>, <code>agent</code>, <code>comptable</code> ou <code>mecanicien</code>.
          </div>
        )}
        <form className="stack" onSubmit={submit}>
          {tab === 'signup' && (
            <div className="grid-2">
              <label className="field">
                Nom de votre entreprise
                <input required minLength={2} value={orgName} onChange={(e) => setOrgName(e.target.value)} />
              </label>
              <label className="field">
                Pays
                <select value={country} onChange={(e) => setCountry(e.target.value)}>
                  <option value="SN">Sénégal</option>
                  <option value="CI">Côte d’Ivoire</option>
                  <option value="GN">Guinée</option>
                  <option value="MR">Mauritanie</option>
                  <option value="ML">Mali</option>
                  <option value="BF">Burkina Faso</option>
                  <option value="BJ">Bénin</option>
                  <option value="TG">Togo</option>
                  <option value="CM">Cameroun</option>
                </select>
              </label>
            </div>
          )}
          <label className="field">
            Email
            <input type="email" required={!demo} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            Mot de passe
            <input
              type={demo ? 'text' : 'password'}
              required
              minLength={demo ? 1 : 8}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {tab === 'signup' && !demo && <span className="hint">8 caractères minimum</span>}
          </label>
          <ErrorBox error={error} />
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Un instant…' : tab === 'login' ? 'Se connecter' : 'Créer mon espace'}
          </button>
        </form>
        <p className="xs muted" style={{ margin: 0, textAlign: 'center' }}>
          <Wordmark /> · Tabibou Business Group
        </p>
      </div>
    </div>
  );
}
