import { Link } from 'react-router-dom';
import { Empty } from '../components/ui';
import { COUNTRY_CALLING_CODE, whatsappLink } from '../domain/booking';
import { billingSettings, paidOn } from '../domain/billing';
import { dateShort, money, time } from '../domain/format';
import {
  depositState, depositTarget, DEPOSIT_STATE_LABEL, followMessage, followUps, portalMessage, portalUrl,
  type FollowItem,
} from '../domain/portal';
import type { Reservation } from '../domain/types';
import { useData } from '../state/DataContext';

const KIND: Record<FollowItem['kind'], [string, string]> = {
  retard: ['Pas rentré', 'badge-danger'],
  retour: ['Retour', 'badge-warning'],
  depart: ['Départ', ''],
};

/** Suivi du jour : départs et retours d'aujourd'hui et demain, retards, acomptes à vérifier, avec les messages WhatsApp prêts. */
export function FollowUp() {
  const { data, now, session } = useData();
  const veh = new Map(data.vehicles.map((v) => [v.id, v]));
  const cli = new Map(data.clients.map((c) => [c.id, c]));
  const billing = billingSettings(session!.org.name, session!.org.billing);
  const cc = COUNTRY_CALLING_CODE[session!.org.country] ?? '221';
  const items = followUps(data.reservations, now);
  const org = session!.org.name;

  const deposits = data.reservations
    .filter((r) => r.status === 'reservee')
    .map((r) => {
      const c = cli.get(r.clientId);
      const due = depositTarget(r, data.invoices, c?.depositPercent ?? billing.depositPercent);
      const paid = paidOn(r.id, data.payments);
      return { r, due, paid, state: depositState(r, due, paid, data.deposit_declarations, now, billing.depositDelayHours) };
    })
    .filter((x) => x.state === 'declare' || x.state === 'en_retard')
    .sort((a, b) => a.r.start.localeCompare(b.r.start));

  const wa = (r: Reservation, text: string) => {
    const c = cli.get(r.clientId);
    return c ? whatsappLink(c.contactPhone || c.phone, text, cc) : undefined;
  };
  const who = (r: Reservation) => {
    const c = cli.get(r.clientId);
    return c?.contactName || c?.name || '';
  };

  return (
    <div className="stack" style={{ gap: 'var(--space-6)' }}>
      <section className="card" aria-labelledby="suivi">
        <h2 id="suivi">Aujourd’hui et demain</h2>
        {items.length === 0 ? (
          <Empty>Aucun départ ni retour prévu d’ici demain soir.</Empty>
        ) : (
          <ul className="alert-list">
            {items.map((x) => {
              const r = x.reservation;
              const v = veh.get(r.vehicleId);
              const pt = data.reservation_portals.find((p) => p.reservationId === r.id);
              const msg = (k: Parameters<typeof followMessage>[0]) => wa(r, followMessage(k, who(r), org, r, v, now));
              const when = x.when === 'passe' ? `prévu ${dateShort(x.at)} ${time(x.at)}` : `${x.when === 'aujourdhui' ? 'aujourd’hui' : 'demain'} à ${time(x.at)}`;
              return (
                <li key={`${x.kind}-${r.id}`} className="alert-item" style={{ borderLeftColor: x.kind === 'retard' ? 'var(--danger)' : x.kind === 'retour' ? 'var(--ocre)' : 'var(--atlantique)' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>
                      <span className={`badge ${KIND[x.kind][1]}`}>{KIND[x.kind][0]}</span>{' '}
                      <Link to={`/reservations/${r.id}`}><strong>{cli.get(r.clientId)?.name ?? '—'}</strong></Link>
                    </span>
                    <span className="small muted">{r.number}</span>
                  </div>
                  <span className="small">{v ? `${v.brand} ${v.model} · ${v.plate}` : ''} · {when}</span>
                  <div className="row" style={{ gap: 'var(--space-2)' }}>
                    {x.kind === 'depart' && (
                      <>
                        <a className="btn btn-sm" target="_blank" rel="noreferrer" href={msg('rappel_depart')}>Rappel de départ</a>
                        {pt && !pt.signedAt && (
                          <a className="btn btn-sm btn-ghost" target="_blank" rel="noreferrer"
                            href={wa(r, portalMessage(who(r), org, r, portalUrl(pt.token), 0))}>Renvoyer le lien client</a>
                        )}
                      </>
                    )}
                    {x.kind === 'retour' && <a className="btn btn-sm" target="_blank" rel="noreferrer" href={msg('rappel_retour')}>Rappel de retour</a>}
                    {x.kind === 'retard' && <a className="btn btn-sm btn-dark" target="_blank" rel="noreferrer" href={msg('retard')}>Relancer</a>}
                    {x.kind !== 'depart' && <a className="btn btn-sm btn-ghost" target="_blank" rel="noreferrer" href={msg('prolongation')}>Proposer une prolongation</a>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="small muted" style={{ margin: 0 }}>Chaque bouton ouvre WhatsApp avec le message prêt ; vous le relisez avant d’envoyer.</p>
      </section>

      <section className="card" aria-labelledby="acomptes">
        <h2 id="acomptes">Acomptes à suivre</h2>
        {deposits.length === 0 ? (
          <Empty>Aucun acompte à vérifier ni en retard.</Empty>
        ) : (
          <ul className="alert-list">
            {deposits.map(({ r, due, paid, state }) => (
              <li key={r.id} className="alert-item" style={{ borderLeftColor: state === 'declare' ? 'var(--ocre)' : 'var(--danger)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <Link to={`/reservations/${r.id}`}><strong>{cli.get(r.clientId)?.name ?? '—'}</strong> · {r.number}</Link>
                  <span className={`badge ${DEPOSIT_STATE_LABEL[state][1]}`}>{DEPOSIT_STATE_LABEL[state][0]}</span>
                </div>
                <span className="small">Acompte {money(Math.max(0, due - paid))} · départ {dateShort(r.start)} {time(r.start)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
