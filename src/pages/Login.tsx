import { useEffect, useState, type FormEvent } from 'react';
import { utmFrom } from '../domain/platform';
import { startAdTracking, trackSignup } from '../lib/tracking';
import { ErrorBox, Logo, Wordmark } from '../components/ui';
import { useData } from '../state/DataContext';

export function Login() {
  const { store, setSession } = useData();
  const params = new URLSearchParams(window.location.search);
  const invited = params.has('invitation');
  // Arrivée depuis une publicité ou le site : on ouvre directement l'inscription.
  const fromAd = params.has('essai') || !!utmFrom(window.location.search);
  const [tab, setTab] = useState<'login' | 'signup' | 'join'>(invited ? 'join' : fromAd ? 'signup' : 'login');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [country, setCountry] = useState('SN');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const demo = store.mode === 'demo';

  useEffect(() => {
    // Publicité d'origine, gardée le temps de la visite pour l'attacher à l'inscription.
    const utm = utmFrom(window.location.search);
    try {
      if (utm) sessionStorage.setItem('yoonfleet-utm', utm);
    } catch {
      /* navigation privée */
    }
    if (!invited) startAdTracking();
  }, [invited]);

  async function sendReset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await store.requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (forgot) {
    return (
      <div className="auth">
        <div className="card">
          <h1 style={{ fontSize: 22, margin: 0 }}>Mot de passe oublié</h1>
          {sent ? (
            <>
              <p style={{ margin: 0 }}>
                Si un compte existe pour <strong>{email}</strong>, un email vient d’être envoyé avec un lien pour choisir un nouveau mot de passe. Le lien est valable une heure.
              </p>
              <p className="small muted" style={{ margin: 0 }}>Rien reçu après quelques minutes ? Regardez dans les courriers indésirables, ou demandez à votre administrateur de vous réinviter.</p>
            </>
          ) : (
            <form className="stack" onSubmit={sendReset}>
              <p className="small muted" style={{ margin: 0 }}>Indiquez l’email de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
              <label className="field">
                Email
                <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <ErrorBox error={error} />
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Un instant…' : 'Recevoir le lien'}</button>
            </form>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => { setForgot(false); setSent(false); setError(null); }}>Retour à la connexion</button>
        </div>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (tab === 'login') await store.signIn(email, password);
      else {
        if (tab === 'signup' && !demo && contactPhone.replace(/\D/g, '').length < 8) throw new Error('Indiquez votre numéro WhatsApp : notre équipe vous appelle pour vous aider à démarrer.');
        let source: string | null = null;
        try {
          source = sessionStorage.getItem('yoonfleet-utm');
        } catch {
          /* navigation privée */
        }
        await store.signUp(email, password, tab === 'join' ? '' : orgName, country, tab === 'signup' ? { contactName: contactName.trim(), contactPhone: contactPhone.trim(), source } : undefined);
        if (tab === 'signup') trackSignup();
      }
      const s = await store.session();
      if (!s) {
        await store.signOut();
        throw new Error(
          tab === 'join'
            ? 'Compte créé, mais aucune invitation valide pour cette adresse. Demandez à votre administrateur de vous inviter avec cet email.'
            : 'Votre compte n’est rattaché à aucune entreprise. Demandez une invitation à votre administrateur, ou créez votre entreprise avec « Essai gratuit ».',
        );
      }
      if (invited) window.history.replaceState(null, '', '/');
      setSession(s);
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
          {invited ? (
            <button type="button" role="tab" aria-selected={tab === 'join'} onClick={() => setTab('join')}>
              Rejoindre mon équipe
            </button>
          ) : (
            <button type="button" role="tab" aria-selected={tab === 'signup'} onClick={() => setTab('signup')}>
              Essai gratuit 30 jours
            </button>
          )}
        </div>
        {demo && (
          <div className="notice">
            <strong>Démo :</strong> n’importe quel email. Le mot de passe choisit le profil :{' '}
            <code>admin</code>, <code>direction</code>, <code>agent</code>, <code>comptable</code> ou <code>mecanicien</code>.
          </div>
        )}
        {tab === 'join' && (
          <p className="small" style={{ margin: 0 }}>
            Vous avez été invité(e) sur Yoon Fleet. Créez votre mot de passe avec l’adresse qui a reçu l’invitation, puis
            confirmez-la depuis l’email reçu.
          </p>
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
              <label className="field">
                Votre nom
                <input required={!demo} minLength={2} autoComplete="name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </label>
              <label className="field">
                Numéro WhatsApp
                <input type="tel" required={!demo} inputMode="tel" autoComplete="tel" placeholder="77 123 45 67" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
              </label>
              <p className="hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
                Un conseiller Yoon Fleet vous appelle pour configurer votre espace avec vous. Gratuit, sans engagement.
              </p>
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
            {tab !== 'login' && !demo && <span className="hint">8 caractères minimum</span>}
          </label>
          {tab === 'login' && !demo && (
            <button type="button" className="link-button small" style={{ alignSelf: 'flex-start' }} onClick={() => { setForgot(true); setError(null); }}>
              Mot de passe oublié ?
            </button>
          )}
          <ErrorBox error={error} />
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Un instant…' : tab === 'login' ? 'Se connecter' : tab === 'join' ? 'Créer mon compte' : 'Créer mon espace'}
          </button>
        </form>
        <p className="xs muted" style={{ margin: 0, textAlign: 'center' }}>
          <Wordmark />
        </p>
        <p className="xs muted" style={{ margin: 0, textAlign: 'center' }}>© {new Date().getFullYear()} TBG. Tous droits réservés.</p>
      </div>
    </div>
  );
}
