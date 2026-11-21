import { Link, useNavigate } from 'react-router-dom';
import { Empty, ReservationBadge } from '../components/ui';
import { dateShort, dateTime, money, time } from '../domain/format';
import { isLate, lateDays, occupancy, vehicleStatusAt } from '../domain/rules';
import { useData } from '../state/DataContext';
import { AlertList } from './Alerts';

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function Dashboard() {
  const { data, now, session, can } = useData();
  const nav = useNavigate();
  const veh = new Map(data.vehicles.map((v) => [v.id, v]));
  const cli = new Map(data.clients.map((c) => [c.id, c]));
  const statuses = data.vehicles.map((v) => vehicleStatusAt(v, now, data.reservations, data.maintenances));
  const available = statuses.filter((s) => s === 'disponible').length;
  const rented = statuses.filter((s) => s === 'loue').length;
  const current = data.reservations
    .filter((r) => r.status === 'en_cours')
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end));
  const returnsToday = current.filter((r) => sameDay(new Date(r.end), now) || isLate(r, now));
  const lateCount = current.filter((r) => isLate(r, now)).length;
  const departuresToday = data.reservations.filter((r) => r.status === 'reservee' && sameDay(new Date(r.start), now));

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const paidMonth = data.payments.filter(
    (p) => p.status === 'paye' && p.paidAt && Date.parse(p.paidAt) >= monthStart && p.kind !== 'caution' && p.kind !== 'remboursement_caution' && p.kind !== 'remboursement',
  );
  const encaisse = paidMonth.reduce((s, p) => s + p.amount, 0);
  const viaLink = paidMonth.filter((p) => p.method !== 'especes').reduce((s, p) => s + p.amount, 0);


  return (
    <>
      <header className="page-head">
        <div>
          <h1>Tableau de bord</h1>
          <p className="muted small">
            {dateTime(now.toISOString())} · {session?.org.name}
          </p>
        </div>
        {can('direction', 'agent') && (
          <button className="btn btn-primary" onClick={() => nav('/reservations?nouvelle=1')}>
            Nouvelle réservation
          </button>
        )}
      </header>

      <section className="kpis" aria-label="Indicateurs">
        <div className="card kpi">
          <span className="kpi-label">Disponibles</span>
          <span className="kpi-value" style={{ color: 'var(--success)' }}>{available}</span>
          <span className="small muted">sur {data.vehicles.length} véhicules</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">En location</span>
          <span className="kpi-value">{rented}</span>
          <span className="small muted">taux d’occupation {Math.round(occupancy(statuses) * 100)} %</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Retours aujourd’hui</span>
          <span className="kpi-value">{returnsToday.length}</span>
          <span className="small" style={{ color: lateCount ? 'var(--danger)' : 'var(--ink-muted)', fontWeight: 500 }}>
            {lateCount ? `dont ${lateCount} en retard` : `${departuresToday.length} départ(s) prévu(s)`}
          </span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Encaissé ce mois</span>
          <span className="kpi-value num">{money(encaisse, '')}</span>
          <span className="small muted">FCFA{encaisse ? `, dont ${Math.round((viaLink / encaisse) * 100)} % hors espèces` : ''}</span>
        </div>
      </section>

      <div className="cols">
        <section className="card col-2" aria-labelledby="qaq">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 id="qaq">Qui a quoi</h2>
            <span className="small muted">Retour le plus proche en premier</span>
          </div>
          {current.length === 0 ? (
            <Empty>Aucune location en cours.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Véhicule</th>
                    <th>Client</th>
                    <th>Retour prévu</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {current.slice(0, 8).map((r) => {
                    const v = veh.get(r.vehicleId);
                    const today = sameDay(new Date(r.end), now);
                    return (
                      <tr key={r.id} className="clickable" onClick={() => nav(`/reservations/${r.id}`)}>
                        <td>
                          <strong>{v ? `${v.brand} ${v.model}` : '—'}</strong>
                          <br />
                          <span className="muted">{v?.plate}</span>
                        </td>
                        <td>{cli.get(r.clientId)?.name ?? '—'}</td>
                        <td>{today ? `Aujourd’hui, ${time(r.end)}` : `${dateShort(r.end)}, ${time(r.end)}`}</td>
                        <td>
                          {isLate(r, now) ? (
                            <ReservationBadge status={r.status} late={lateDays(r, now)} />
                          ) : today ? (
                            <span className="badge badge-warning">Retour aujourd’hui</span>
                          ) : (
                            <ReservationBadge status={r.status} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Link to="/reservations">Voir toutes les réservations</Link>
        </section>

        <section className="card col-1" aria-labelledby="todo" id="alertes">
          <h2 id="todo">À traiter</h2>
          <AlertList />
        </section>
      </div>
    </>
  );
}
