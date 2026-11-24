import { Link } from 'react-router-dom';
import { dateLong } from '../domain/format';
import { subscriptionStatus } from '../domain/saas';
import type { Organization, Role } from '../domain/types';

/** Bandeau d'échéance : fin d'essai proche, renouvellement, échéance dépassée. */
export function SubscriptionBanner({ org, role, now }: { org: Organization; role: Role; now: Date }) {
  const s = subscriptionStatus(org, now);
  const admin = role === 'admin';
  const cta = admin ? <Link className="btn btn-sm btn-primary" to="/abonnement">{s.state === 'essai' ? 'Choisir ma formule' : 'Renouveler'}</Link> : null;
  if (s.state === 'essai' && s.daysLeft !== null && s.daysLeft <= 7)
    return (
      <div className="notice no-print row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span>Votre essai gratuit se termine {s.daysLeft <= 0 ? 'aujourd’hui' : `dans ${s.daysLeft} jour${s.daysLeft > 1 ? 's' : ''}`}. {admin ? 'Payez en ligne en deux minutes pour continuer sans interruption.' : 'Prévenez l’administrateur du compte.'}</span>
        {cta}
      </div>
    );
  if (s.state === 'a_renouveler')
    return (
      <div className="notice no-print row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span>Votre abonnement se termine le {dateLong(s.until!)}. {admin ? 'Renouvelez maintenant : le temps restant est déduit.' : 'Prévenez l’administrateur du compte.'}</span>
        {cta}
      </div>
    );
  if (s.state === 'grace')
    return (
      <div className="notice notice-danger no-print row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span><strong>Échéance dépassée.</strong> L’accès sera suspendu le {dateLong(s.graceEnds!)}. {admin ? '' : 'Prévenez l’administrateur du compte.'}</span>
        {cta}
      </div>
    );
  return null;
}

/** Accès suspendu : l'application reste lisible depuis l'abonnement et les paramètres seulement. */
export function LockScreen({ org, role }: { org: Organization; role: Role }) {
  const admin = role === 'admin';
  return (
    <section className="card" style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center', alignItems: 'center' }}>
      <h1 style={{ margin: 0 }}>Accès suspendu</h1>
      <p style={{ margin: 0 }}>
        {org.paidUntil ? 'L’abonnement' : 'L’essai gratuit'} de <strong>{org.name}</strong> est terminé. Vos données sont conservées : elles réapparaissent dès le paiement.
      </p>
      {admin ? (
        <Link className="btn btn-primary" to="/abonnement">Payer et réactiver</Link>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>Demandez à l’administrateur du compte de renouveler l’abonnement.</p>
      )}
    </section>
  );
}
