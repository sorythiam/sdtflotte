import { BillingSettingsForm } from '../components/BillingSettingsForm';
import { BookingSettingsForm } from '../components/BookingSettingsForm';
import { ContractSettingsForm } from '../components/ContractSettingsForm';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { subscriptionStatus, subStateLabel } from '../domain/saas';
import { ErrorBox, roleLabel } from '../components/ui';
import { dateLong } from '../domain/format';
import { PLAN_INFO } from '../domain/pricing';
import { useData } from '../state/DataContext';

const countries: [string, string][] = [
  ['SN', 'Sénégal'], ['CI', 'Côte d’Ivoire'], ['GN', 'Guinée'], ['MR', 'Mauritanie'], ['ML', 'Mali'],
  ['BF', 'Burkina Faso'], ['BJ', 'Bénin'], ['TG', 'Togo'], ['NE', 'Niger'], ['CM', 'Cameroun'], ['GA', 'Gabon'], ['CG', 'Congo'], ['MA', 'Maroc'],
];


export function Settings() {
  const { session, store, setSession, toast, data, now, can } = useData();
  const admin = can();
  const org = session!.org;

  // ---- entreprise
  const [name, setName] = useState(org.name);
  const [country, setCountry] = useState(org.country);
  const [orgError, setOrgError] = useState<string | null>(null);
  async function saveOrg(e: FormEvent) {
    e.preventDefault();
    setOrgError(null);
    try {
      await store.updateOrganization({ name, country });
      setSession(await store.session());
      toast('Entreprise mise à jour');
    } catch (err) {
      setOrgError((err as Error).message);
    }
  }

  // ---- abonnement
  const activeVehicles = data.vehicles.filter((v) => !v.outOfService).length;
  const sub = subscriptionStatus(org, now);
  const trialDays = sub.state === 'essai' ? sub.daysLeft : null;

  // ---- mot de passe
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  async function changePw(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (pw !== pw2) return setPwError('Les deux mots de passe ne correspondent pas.');
    try {
      await store.changePassword(pw);
      setPw('');
      setPw2('');
      toast('Mot de passe modifié');
    } catch (err) {
      setPwError((err as Error).message);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Paramètres</h1>
          <p className="muted small">{org.name}</p>
        </div>
      </header>

      <div className="cols">
        <div className="col-2 stack" style={{ gap: 'var(--space-6)' }}>
          <section className="card" aria-labelledby="abonnement">
            <h2 id="abonnement">Abonnement</h2>
            <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              <div>
                <div className="kpi-label">Formule</div>
                <div className="kpi-value" style={{ fontSize: 24, lineHeight: '32px' }}>{PLAN_INFO[org.plan].label}</div>
                <div className="small muted">
                  {trialDays !== null ? `Essai gratuit, ${trialDays} jour(s) restant(s)` : subStateLabel[sub.state][0]}
                  {sub.until && org.paidUntil ? `, jusqu’au ${dateLong(sub.until)}` : ''}
                </div>
              </div>
              <div>
                <div className="kpi-label">Véhicules</div>
                <div className="kpi-value" style={{ fontSize: 24, lineHeight: '32px' }}>
                  {activeVehicles} / {org.vehicleQuota}
                </div>
                <div style={{ height: 8, background: 'var(--sable)', borderRadius: 4, marginTop: 6 }} aria-hidden="true">
                  <div
                    style={{
                      height: 8,
                      borderRadius: 4,
                      width: `${Math.min(100, (activeVehicles / Math.max(1, org.vehicleQuota)) * 100)}%`,
                      background: activeVehicles >= org.vehicleQuota ? 'var(--danger)' : 'var(--atlantique)',
                    }}
                  />
                </div>
              </div>
              {trialDays !== null && org.trialEndsAt && !org.paidUntil && (
                <div>
                  <div className="kpi-label">Fin de l’essai</div>
                  <div className="kpi-value" style={{ fontSize: 20, lineHeight: '32px' }}>{dateLong(org.trialEndsAt)}</div>
                </div>
              )}
            </div>
            {can('direction') && (
              <Link className={`btn${admin ? ' btn-primary' : ''}`} to="/abonnement" style={{ alignSelf: 'flex-start' }}>
                {admin ? (org.paidUntil ? 'Renouveler ou changer de formule' : 'Choisir ma formule et payer en ligne') : 'Voir l’abonnement et les factures'}
              </Link>
            )}
          </section>

        </div>

        <div className="col-1 stack" style={{ gap: 'var(--space-6)' }}>
          <section className="card" aria-labelledby="entreprise">
            <h2 id="entreprise">Entreprise</h2>
            <form className="stack" onSubmit={saveOrg}>
              <label className="field">
                Nom affiché sur les contrats
                <input required minLength={2} maxLength={120} value={name} disabled={!admin} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">
                Pays
                <select value={country} disabled={!admin} onChange={(e) => setCountry(e.target.value)}>
                  {countries.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                </select>
              </label>
              <ErrorBox error={orgError} />
              {admin ? (
                <button className="btn btn-dark" disabled={name.trim() === org.name && country === org.country}>Enregistrer</button>
              ) : (
                <span className="hint">Seul un administrateur peut modifier l’entreprise.</span>
              )}
            </form>
          </section>

          <BillingSettingsForm editable={admin} />

          <ContractSettingsForm editable={admin} />

          <BookingSettingsForm editable={admin} />

          <section className="card" aria-labelledby="notifications">
            <h2 id="notifications">Notifications</h2>
            <label className="row" style={{ alignItems: 'flex-start', gap: 'var(--space-3)', flexWrap: 'nowrap' }}>
              <input
                type="checkbox"
                checked={session!.dailyDigest}
                onChange={async (e) => {
                  const on = e.target.checked;
                  try {
                    await store.setDailyDigest(on);
                    setSession(await store.session());
                    toast(on ? 'Récapitulatif du matin activé' : 'Récapitulatif du matin désactivé');
                  } catch (err) {
                    toast((err as Error).message);
                  }
                }}
                style={{ width: 18, height: 18, marginTop: 2, flex: 'none' }}
              />
              <span>
                <strong>Recevoir le récapitulatif des alertes par email</strong>
                <br />
                <span className="small muted">
                  Chaque matin à 7 h, à {session!.userEmail}, seulement s’il y a quelque chose à signaler pour votre profil :
                  retards, départs et retours du jour, documents à renouveler, soldes impayés, cautions à rendre.
                </span>
              </span>
            </label>
          </section>

          <section className="card" aria-labelledby="compte">
            <h2 id="compte">Mon compte</h2>
            <p className="small" style={{ margin: 0 }}>
              {session!.userEmail}
              <br />
              <span className="muted">Profil : {roleLabel[session!.role]}</span>
            </p>
            {store.mode === 'demo' ? (
              <p className="hint" style={{ margin: 0 }}>Le changement de mot de passe n’existe pas en mode démo.</p>
            ) : (
              <form className="stack" onSubmit={changePw}>
                <label className="field">
                  Nouveau mot de passe
                  <input type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} />
                </label>
                <label className="field">
                  Confirmer
                  <input type="password" autoComplete="new-password" minLength={8} required value={pw2} onChange={(e) => setPw2(e.target.value)} />
                </label>
                <ErrorBox error={pwError} />
                <button className="btn">Changer le mot de passe</button>
              </form>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
