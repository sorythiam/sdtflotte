import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty } from '../components/ui';
import { alertsFor, buildAlerts, type AlertLevel } from '../domain/alerts';
import { useData } from '../state/DataContext';

const sections: [AlertLevel, string, string][] = [
  ['urgent', 'À traiter en priorité', 'var(--danger)'],
  ['attention', 'À suivre', 'var(--ocre)'],
  ['info', 'Au programme aujourd’hui', 'var(--atlantique)'],
];

/** Liste des alertes du jour, regroupées par urgence (affichée sur l'accueil). */
export function AlertList() {
  const { data, now, session } = useData();
  const [all, setAll] = useState(false);
  const built = useMemo(() => buildAlerts({ ...data, plans: data.maintenance_plans, vtc: { contracts: data.vtc_contracts, payments: data.vtc_payments, expenses: data.expenses, drivers: data.drivers } }, now), [data, now]);
  const mine = alertsFor(built, session!.role);
  const list = all ? built : mine;
  const hidden = built.length - mine.length;

  return (
    <div className="stack" style={{ gap: 'var(--space-4)' }}>
      {list.length === 0 ? (
        <Empty>Rien à traiter. Bonne journée.</Empty>
      ) : (
        sections.map(([level, title, color]) => {
          const items = list.filter((a) => a.level === level);
          if (items.length === 0) return null;
          return (
            <div key={level} className="stack" style={{ gap: 6 }}>
              <h3 className="alert-group" style={{ color }}>
                {title} <span className="muted" style={{ fontWeight: 400 }}>({items.length})</span>
              </h3>
              <ul className="alert-list">
                {items.map((a) => (
                  <li key={a.id}>
                    <Link to={a.link} className="alert-item" style={{ borderLeftColor: color }}>
                      <strong>{a.title}</strong>
                      <span className="small muted">{a.detail}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
      <div className="small muted">
        {session!.dailyDigest ? 'Vous recevez aussi ce récapitulatif chaque matin par email.' : <>Pour le recevoir chaque matin par email : <Link to="/parametres">Paramètres</Link>.</>}
        {session!.role !== 'admin' && hidden > 0 && (
          <label className="row" style={{ gap: 6, marginTop: 6 }}>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Voir aussi les alertes des autres profils ({hidden})
          </label>
        )}
      </div>
    </div>
  );
}
