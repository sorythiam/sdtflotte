import { BookingSettingsForm } from '../components/BookingSettingsForm';
import { ContractSettingsForm } from '../components/ContractSettingsForm';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ErrorBox, roleLabel } from '../components/ui';
import { dateLong, money } from '../domain/format';
import { PLAN_INFO, priceFor, type Billing } from '../domain/pricing';
import type { Plan, SubscriptionRequest } from '../domain/types';
import { useData } from '../state/DataContext';

const countries: [string, string][] = [
  ['SN', 'Sénégal'], ['CI', 'Côte d’Ivoire'], ['GN', 'Guinée'], ['MR', 'Mauritanie'], ['ML', 'Mali'],
  ['BF', 'Burkina Faso'], ['BJ', 'Bénin'], ['TG', 'Togo'], ['NE', 'Niger'], ['CM', 'Cameroun'], ['GA', 'Gabon'], ['CG', 'Congo'], ['MA', 'Maroc'],
];

const statusLabel: Record<SubscriptionRequest['status'], [string, string]> = {
  nouvelle: ['Envoyée', 'badge-warning'],
  en_cours: ['En cours de traitement', ''],
  payee: ['Payée et activée', 'badge-success'],
  annulee: ['Annulée', 'badge-muted'],
};

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
  const [plan, setPlan] = useState<Plan>('pro');
  const [vehicles, setVehicles] = useState(Math.max(activeVehicles, PLAN_INFO.pro.minVehicles));
  const [billing, setBilling] = useState<Billing>('annuel');
  const [phone, setPhone] = useState('');
  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);
  const [subError, setSubError] = useState<string | null>(null);
  const q = priceFor(plan, vehicles, billing);
  const trialDays = org.trialEndsAt ? Math.ceil((Date.parse(org.trialEndsAt) - now.getTime()) / 86400000) : null;
  const pending = requests.find((r) => r.status === 'nouvelle' || r.status === 'en_cours');

  const loadRequests = useCallback(async () => {
    if (!admin) return;
    try {
      setRequests(await store.listSubscriptionRequests());
    } catch (err) {
      setSubError((err as Error).message);
    }
  }, [store, admin]);
  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  async function request(e: FormEvent) {
    e.preventDefault();
    setSubError(null);
    try {
      await store.requestSubscription({ plan, vehicles: q.billedVehicles, billing, amount: billing === 'annuel' ? q.yearly : q.perMonth, contactPhone: phone || null });
      await loadRequests();
      toast('Demande envoyée à Yoon Fleet');
    } catch (err) {
      setSubError((err as Error).message);
    }
  }

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
                  {trialDays !== null && trialDays >= 0
                    ? `Essai gratuit, ${trialDays} jour(s) restant(s)`
                    : trialDays !== null
                      ? 'Essai terminé'
                      : 'Abonnement actif'}
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
              {trialDays !== null && org.trialEndsAt && (
                <div>
                  <div className="kpi-label">Fin de l’essai</div>
                  <div className="kpi-value" style={{ fontSize: 20, lineHeight: '32px' }}>{dateLong(org.trialEndsAt)}</div>
                </div>
              )}
            </div>
          </section>

          {admin && (
            <section className="card" aria-labelledby="payant">
              <h2 id="payant">Passer à la version payante</h2>
              <p className="small muted" style={{ margin: 0 }}>
                Licence annuelle par véhicule, support et mises à jour inclus. Choisissez votre formule et votre nombre de véhicules.
              </p>
              <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} role="radiogroup" aria-label="Formule">
                {(Object.keys(PLAN_INFO) as Plan[]).map((p) => {
                  const info = PLAN_INFO[p];
                  const selected = plan === p;
                  return (
                    <label
                      key={p}
                      className="card"
                      style={{
                        cursor: 'pointer',
                        gap: 'var(--space-2)',
                        padding: 'var(--space-4)',
                        border: selected ? '2px solid var(--atlantique)' : '1px solid var(--sable-line)',
                        background: selected ? '#eef4f8' : '#fff',
                      }}
                    >
                      <span className="row" style={{ justifyContent: 'space-between' }}>
                        <strong style={{ fontFamily: 'var(--font-display)', color: 'var(--atlantique)', fontSize: 18 }}>{info.label}</strong>
                        <input
                          type="radio"
                          name="plan"
                          checked={selected}
                          onChange={() => {
                            setPlan(p);
                            setVehicles(Math.max(vehicles, PLAN_INFO[p].minVehicles));
                          }}
                          style={{ width: 20, height: 20, accentColor: 'var(--atlantique)' }}
                        />
                      </span>
                      <span className="num" style={{ fontWeight: 600 }}>{money(info.perVehicleYear)} / véhicule / an</span>
                      <span className="xs muted">
                        {info.users} · minimum {info.minVehicles} véhicules
                        <br />
                        {info.summary}
                      </span>
                    </label>
                  );
                })}
              </div>
              <form className="stack" onSubmit={request}>
                <div className="grid-2">
                  <label className="field">
                    Nombre de véhicules
                    <input type="number" min={1} max={10000} required value={vehicles} onChange={(e) => setVehicles(Number(e.target.value))} />
                    <span className="hint">Vous en avez {activeVehicles} en service aujourd’hui.</span>
                  </label>
                  <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Paiement</legend>
                    <div className="tabs">
                      <button type="button" aria-selected={billing === 'annuel'} onClick={() => setBilling('annuel')}>Annuel</button>
                      <button type="button" aria-selected={billing === 'mensuel'} onClick={() => setBilling('mensuel')}>Mensuel (+20 %)</button>
                    </div>
                  </fieldset>
                </div>
                {q.onQuote ? (
                  <div className="notice">Au-delà de 300 véhicules, le prix se fait sur devis : envoyez la demande, nous vous recontactons.</div>
                ) : (
                  <div className="notice">
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: 'var(--atlantique)' }}>
                      {billing === 'annuel' ? `${money(q.yearly)} / an` : `${money(q.perMonth)} / mois`}
                    </span>
                    <br />
                    <span className="small">
                      {PLAN_INFO[plan].label}, {q.billedVehicles} véhicules
                      {q.billedVehicles > q.vehicles ? ` (minimum de la formule)` : ''} ·{' '}
                      {billing === 'annuel' ? `soit ${money(q.perMonth)} par mois` : `soit ${money(q.perMonth * 12)} sur l’année`} · prix HT
                      {q.billedVehicles > 100 ? ' · −20 % au-delà du 100e véhicule' : ''}
                    </span>
                  </div>
                )}
                <label className="field">
                  Téléphone pour vous recontacter (WhatsApp de préférence)
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+221 77 000 00 00" />
                </label>
                <ErrorBox error={subError} />
                <button className="btn btn-primary" disabled={!!pending}>
                  {pending ? 'Demande déjà envoyée' : 'Demander l’activation'}
                </button>
                <p className="xs muted" style={{ margin: 0 }}>
                  Le paiement en ligne (Wave, Orange Money, carte) arrive bientôt. En attendant, l’équipe Yoon Fleet vous contacte pour
                  finaliser le paiement ; votre formule et votre quota sont mis à jour dès réception.
                </p>
              </form>
              {requests.length > 0 && (
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>Date</th><th>Demande</th><th className="right">Montant HT</th><th>Statut</th></tr></thead>
                    <tbody>
                      {requests.map((r) => (
                        <tr key={r.id}>
                          <td>{dateLong(r.createdAt)}</td>
                          <td>{PLAN_INFO[r.plan].label} · {r.vehicles} véhicules · {r.billing}</td>
                          <td className="right num">{money(r.amount)}{r.billing === 'mensuel' ? ' / mois' : ' / an'}</td>
                          <td><span className={`badge ${statusLabel[r.status][1]}`}>{statusLabel[r.status][0]}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
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
