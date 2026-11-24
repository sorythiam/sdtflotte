import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ErrorBox } from '../components/ui';
import { dateLong, money } from '../domain/format';
import { PLAN_INFO, type Billing } from '../domain/pricing';
import { checkoutQuote, SAAS_VAT_RATE, paymentStatusLabel, planLabel, SAAS_ISSUER, subscriptionStatus, subStateLabel, type SubscriptionPayment } from '../domain/saas';
import type { Plan } from '../domain/types';
import { useData } from '../state/DataContext';

function usePayments() {
  const { store, can } = useData();
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const load = useCallback(async () => {
    if (!can('direction')) return;
    try {
      setPayments(await store.listSubscriptionPayments());
    } catch {
      setPayments([]);
    }
  }, [store, can]);
  useEffect(() => void load(), [load]);
  return { payments, reload: load };
}

/** Page Abonnement : état, choix de la formule et paiement en ligne, factures. */
export function Subscription() {
  const { session, data, now, store, can } = useData();
  const org = session!.org;
  const admin = can();
  const { payments } = usePayments();
  const status = subscriptionStatus(org, now);
  const active = data.vehicles.filter((v) => !v.outOfService).length;
  const [plan, setPlan] = useState<Plan>(org.plan);
  const [vehicles, setVehicles] = useState(Math.max(active, org.vehicleQuota, PLAN_INFO[org.plan].minVehicles));
  const [billing, setBilling] = useState<Billing>(org.billingCycle ?? 'annuel');
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const last = payments.find((p) => p.status === 'payee') ?? null;
  const q = checkoutQuote({ plan, vehicles, billing }, { paidUntil: org.paidUntil ?? null, last }, now, SAAS_VAT_RATE);

  async function pay(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { url } = await store.startCheckout({ plan, vehicles, billing });
      window.location.assign(url);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      if (/pas encore activé/.test(msg)) setFallback(true);
      setBusy(false);
    }
  }
  async function requestActivation() {
    setError(null);
    try {
      await store.requestSubscription({ plan, vehicles: q.vehicles, billing, amount: q.amountTtc, contactPhone: phone || null });
      setFallback(false);
      setError('Demande envoyée : l’équipe Yoon Fleet vous recontacte rapidement.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <span className="small muted"><Link to="/parametres">Paramètres</Link></span>
          <h1>Abonnement</h1>
        </div>
      </header>

      <section className="card" aria-labelledby="etat">
        <h2 id="etat">Votre abonnement</h2>
        <dl className="facts">
          <div><dt>Formule</dt><dd>{planLabel(org.plan)} <span className={`badge ${subStateLabel[status.state][1]}`}>{subStateLabel[status.state][0]}</span></dd></div>
          <div><dt>Véhicules</dt><dd>{active} en service sur {org.vehicleQuota} prévus</dd></div>
          <div><dt>{org.paidUntil ? 'Payé jusqu’au' : status.state === 'offert' ? 'Échéance' : 'Fin de l’essai'}</dt><dd>{status.until ? dateLong(status.until) : 'Aucune'}</dd></div>
          {org.billingCycle && <div><dt>Paiement</dt><dd>{org.billingCycle === 'annuel' ? 'Annuel' : 'Mensuel'}</dd></div>}
        </dl>
      </section>

      {admin ? (
        <section className="card" aria-labelledby="payer">
          <h2 id="payer">{org.paidUntil ? 'Renouveler ou changer de formule' : 'Choisir ma formule et payer'}</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Paiement sécurisé par Wave, Orange Money ou carte bancaire. La formule s’active dès la confirmation, sans attendre personne.
            Le temps déjà payé et non utilisé est déduit automatiquement.
          </p>
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} role="radiogroup" aria-label="Formule">
            {(Object.keys(PLAN_INFO) as Plan[]).map((p) => {
              const info = PLAN_INFO[p];
              const selected = plan === p;
              return (
                <label key={p} className="card" style={{ cursor: 'pointer', gap: 'var(--space-2)', padding: 'var(--space-4)', border: selected ? '2px solid var(--atlantique)' : '1px solid var(--sable-line)', background: selected ? '#eef4f8' : '#fff' }}>
                  <span className="row" style={{ justifyContent: 'space-between' }}>
                    <strong style={{ fontFamily: 'var(--font-display)', color: 'var(--atlantique)', fontSize: 18 }}>{info.label}</strong>
                    <input type="radio" name="plan" checked={selected} onChange={() => { setPlan(p); setVehicles(Math.max(vehicles, info.minVehicles)); }} style={{ width: 20, height: 20, accentColor: 'var(--atlantique)' }} />
                  </span>
                  <span className="num" style={{ fontWeight: 600 }}>{money(info.perVehicleYear)} HT / véhicule / an</span>
                  <span className="xs muted">{info.users} · minimum {info.minVehicles} véhicules<br />{info.summary}</span>
                </label>
              );
            })}
          </div>
          <form className="stack" onSubmit={pay}>
            <div className="grid-2">
              <label className="field">
                Nombre de véhicules
                <input type="number" min={1} max={10000} required value={vehicles} onChange={(e) => setVehicles(Number(e.target.value))} />
                <span className="hint">Vous en avez {active} en service aujourd’hui.</span>
              </label>
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Paiement</legend>
                <div className="tabs">
                  <button type="button" aria-selected={billing === 'annuel'} onClick={() => setBilling('annuel')}>Annuel</button>
                  <button type="button" aria-selected={billing === 'mensuel'} onClick={() => setBilling('mensuel')}>Mensuel (+20 %)</button>
                </div>
              </fieldset>
            </div>
            <div className="notice">
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: 'var(--atlantique)' }}>{money(q.amountTtc)}</span>
              <span className="small"> à payer maintenant{q.vatRate ? ' TTC' : ''}</span>
              <br />
              <span className="small">
                {planLabel(q.plan)}, {q.vehicles} véhicules{q.vehicles > vehicles ? ' (minimum de la formule)' : ''} · {billing === 'annuel' ? '1 an' : '1 mois'} : {money(q.baseHt)} HT
                {q.creditHt > 0 && <> − {money(q.creditHt)} déjà payés et non utilisés</>}
                {q.vat > 0 && <> + TVA {q.vatRate} % : {money(q.vat)}</>}
                <br />Période couverte : du {dateLong(q.periodStart)} au {dateLong(q.periodEnd)}
                {billing === 'mensuel' && ' · à renouveler chaque mois'}
              </span>
            </div>
            {q.error && <div className="error">{q.error}</div>}
            <ErrorBox error={error} />
            {fallback && (
              <div className="stack">
                <label className="field">
                  Téléphone pour vous recontacter (WhatsApp de préférence)
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+221 77 000 00 00" />
                </label>
                <button type="button" className="btn" onClick={requestActivation}>Envoyer une demande d’activation</button>
              </div>
            )}
            <button className="btn btn-primary" disabled={busy || !!q.error}>{busy ? 'Ouverture du paiement…' : `Payer ${money(q.amountTtc)}`}</button>
            <p className="xs muted" style={{ margin: 0 }}>Vous serez redirigé vers la page de paiement sécurisée, puis ramené ici. La facture est disponible aussitôt.</p>
          </form>
        </section>
      ) : (
        <p className="notice">Seul l’administrateur du compte peut payer ou changer l’abonnement.</p>
      )}

      {payments.length > 0 && (
        <section className="card" aria-labelledby="historique">
          <h2 id="historique">Paiements et factures</h2>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Date</th><th>Formule</th><th className="right">Montant</th><th>Statut</th><th>Facture</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{dateLong(p.paidAt ?? p.createdAt)}</td>
                    <td>{planLabel(p.plan)} · {p.vehicles} véhicules · {p.billing}</td>
                    <td className="right num">{money(p.amountTtc)}</td>
                    <td><span className={`badge ${paymentStatusLabel[p.status][1]}`}>{paymentStatusLabel[p.status][0]}</span></td>
                    <td>{p.invoiceNumber ? <Link to={`/abonnement/facture/${p.id}`}>{p.invoiceNumber}</Link> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

/** Retour de la page de paiement : on vérifie auprès du prestataire jusqu'à la confirmation. */
export function PaymentReturn() {
  const { store, setSession, refresh } = useData();
  const [params] = useSearchParams();
  const id = params.get('paiement') ?? '';
  const cancelled = params.get('annule') === '1';
  const [p, setP] = useState<SubscriptionPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (!id) return;
    let live = true;
    let timer = 0;
    const check = async (n: number) => {
      try {
        const r = await store.confirmPayment(id);
        if (!live) return;
        setP(r);
        setTries(n);
        if (r.status === 'payee') {
          setSession(await store.session());
          await refresh();
        } else if (r.status === 'en_attente' && !cancelled && n < 40) timer = window.setTimeout(() => void check(n + 1), 3000);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    };
    void check(0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [id, cancelled, store, setSession, refresh]);

  return (
    <section className="card" style={{ maxWidth: 560, margin: '24px auto' }}>
      <h1 style={{ margin: 0 }}>Paiement de l’abonnement</h1>
      <ErrorBox error={error} />
      {!p && !error && <p>Vérification du paiement…</p>}
      {p?.status === 'payee' && (
        <>
          <p style={{ margin: 0 }}>
            <strong>Merci, paiement reçu.</strong> La formule {planLabel(p.plan)} est active pour {p.vehicles} véhicules jusqu’au {p.periodEnd ? dateLong(p.periodEnd) : '—'}.
          </p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Link className="btn btn-primary" to="/">Retour à l’accueil</Link>
            <Link className="btn" to={`/abonnement/facture/${p.id}`}>Voir la facture {p.invoiceNumber}</Link>
          </div>
        </>
      )}
      {p?.status === 'en_attente' && (
        <p style={{ margin: 0 }}>
          {cancelled
            ? 'Paiement interrompu. Rien n’a été débité.'
            : tries >= 40
              ? 'Le paiement n’est pas encore confirmé. S’il a été débité, la formule s’activera dès la confirmation : revenez sur cette page dans quelques minutes.'
              : 'En attente de la confirmation du paiement. Si on vous le demande, validez sur votre téléphone (Wave, Orange Money)…'}
        </p>
      )}
      {(p?.status === 'annulee' || p?.status === 'echouee') && <p style={{ margin: 0 }}>Le paiement n’a pas abouti. Rien n’a été débité.</p>}
      {p && p.status !== 'payee' && <Link className="btn" to="/abonnement">Retour à l’abonnement</Link>}
    </section>
  );
}

/** Mode démo : imite la page du prestataire de paiement. */
export function TestCheckout() {
  const { store } = useData();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const id = params.get('paiement') ?? '';
  const [p, setP] = useState<SubscriptionPayment | null>(null);
  useEffect(() => void store.confirmPayment(id).then(setP).catch(() => setP(null)), [store, id]);
  if (!store.simulatePayment) return <p className="notice">Page réservée à la démonstration.</p>;
  const go = async (paid: boolean) => {
    await store.simulatePayment!(id, paid);
    nav(`/abonnement/retour?paiement=${id}${paid ? '' : '&annule=1'}`);
  };
  return (
    <section className="card" style={{ maxWidth: 480, margin: '24px auto' }}>
      <span className="badge badge-muted" style={{ alignSelf: 'flex-start' }}>Démonstration : aucun argent réel</span>
      <h1 style={{ margin: 0 }}>Page de paiement</h1>
      {p && <p style={{ margin: 0 }}>Yoon Fleet {planLabel(p.plan)}, {p.vehicles} véhicules : <strong>{money(p.amountTtc)}</strong></p>}
      <p className="small muted" style={{ margin: 0 }}>En production, c’est ici la page sécurisée du prestataire, avec Wave, Orange Money et carte bancaire.</p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => void go(true)}>Payer avec Wave</button>
        <button className="btn btn-ghost" onClick={() => void go(false)}>Annuler</button>
      </div>
    </section>
  );
}

/** Facture d'abonnement émise par Yoon Fleet au loueur. */
export function SaasInvoicePage() {
  const { id } = useParams();
  const { session } = useData();
  const { payments } = usePayments();
  const p = payments.find((x) => x.id === id);
  const org = session!.org;
  const c = org.contract ?? {};
  if (!p) return <div className="card"><p>Facture introuvable.</p><Link to="/abonnement">Retour à l’abonnement</Link></div>;
  if (!p.invoiceNumber) return <div className="card"><p>Ce paiement n’a pas de facture : il n’a pas abouti.</p><Link to="/abonnement">Retour</Link></div>;
  const label = `Abonnement Yoon Fleet ${planLabel(p.plan)}, ${p.vehicles} véhicules, du ${dateLong(p.periodStart!)} au ${dateLong(p.periodEnd!)}`;
  return (
    <>
      <header className="page-head no-print">
        <div>
          <span className="small muted"><Link to="/abonnement">Abonnement</Link></span>
          <h1>Facture {p.invoiceNumber}</h1>
        </div>
        <button className="btn btn-dark" onClick={() => window.print()}>Imprimer ou enregistrer en PDF</button>
      </header>
      <article className="paper">
        <header className="ct-head">
          <div className="ct-brand">
            <div>
              <div className="ct-org">{SAAS_ISSUER.name}</div>
              <div className="ct-small" style={{ fontWeight: 600 }}>édité par {SAAS_ISSUER.legalName}</div>
              <div className="ct-small">{SAAS_ISSUER.address}{SAAS_ISSUER.registration && <><br />{SAAS_ISSUER.registration}</>}<br />{SAAS_ISSUER.email}</div>
            </div>
          </div>
          <div className="ct-title">
            <div>Facture</div>
            <strong>N° {p.invoiceNumber}</strong>
            <div className="ct-small">Émise le {dateLong(p.paidAt!)}<br />Payée le {dateLong(p.paidAt!)}</div>
          </div>
        </header>
        <div className="ct-grid">
          <section>
            <h3>Facturé à</h3>
            <div style={{ fontWeight: 600 }}>{c.legalName || org.name}</div>
            <div className="ct-small">{[c.address, c.city].filter(Boolean).join(', ')}{c.registration && <><br />{c.registration}</>}{c.email && <><br />{c.email}</>}</div>
          </section>
          <section>
            <h3>Paiement</h3>
            <dl className="ct-dl"><dt>Moyen</dt><dd>En ligne ({({ bictorys: 'Bictorys', paydunya: 'PayDunya', simulation: 'démonstration' } as Record<string, string>)[p.provider] ?? p.provider})</dd><dt>Statut</dt><dd>Payée</dd></dl>
          </section>
        </div>
        <table className="ct-table">
          <thead><tr><th>Désignation</th><th className="right">Montant HT</th></tr></thead>
          <tbody>
            <tr><td>{label}</td><td className="right">{money(p.baseHt)}</td></tr>
            {p.creditHt > 0 && <tr><td>Déduction : période précédente payée et non utilisée</td><td className="right">−{money(p.creditHt)}</td></tr>}
          </tbody>
        </table>
        <table className="ct-table ct-money" style={{ width: '55%', marginLeft: 'auto' }}>
          <tbody>
            <tr><td>Total HT</td><td>{money(p.amountHt)}</td></tr>
            <tr><td>{p.vatRate ? `TVA ${p.vatRate} %` : 'TVA'}</td><td>{p.vatRate ? money(p.vat) : 'Non applicable'}</td></tr>
            <tr className="ct-total"><td>Total payé</td><td>{money(p.amountTtc)}</td></tr>
          </tbody>
        </table>
        <p className="ct-small" style={{ marginTop: 'auto' }}>
          {SAAS_ISSUER.legalName} · {SAAS_ISSUER.registration}{!p.vatRate && ' · TVA non applicable.'}
        </p>
      </article>
    </>
  );
}
