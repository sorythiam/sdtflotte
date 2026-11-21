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

export function Alerts() {
  const { data, now, session } = useData();
  const [all, setAll] = useState(false);
  const built = useMemo(() => buildAlerts(data, now), [data, now]);
  const mine = alertsFor(built, session!.role);
  const list = all ? built : mine;
  const hidden = built.length - mine.length;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Alertes</h1>
          <p className="muted small">
            Ce qui demande une action aujourd’hui.{' '}
            {session!.dailyDigest ? (
              <>Vous recevez aussi ce récapitulatif chaque matin par email.</>
            ) : (
              <>
                Pour le recevoir chaque matin par email : <Link to="/parametres">Paramètres</Link>.
              </>
            )}
          </p>
        </div>
        {session!.role !== 'admin' && hidden > 0 && (
          <label className="row small" style={{ gap: 'var(--space-2)' }}>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Voir aussi les alertes des autres profils ({hidden})
          </label>
        )}
      </header>

      {list.length === 0 ? (
        <section className="card">
          <Empty>Rien à signaler. Toutes les locations sont à jour.</Empty>
        </section>
      ) : (
        sections.map(([level, title, color]) => {
          const items = list.filter((a) => a.level === level);
          if (items.length === 0) return null;
          return (
            <section key={level} className="card" aria-labelledby={`al-${level}`}>
              <h2 id={`al-${level}`} style={{ color }}>
                {title} <span className="muted" style={{ fontWeight: 400 }}>({items.length})</span>
              </h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {items.map((a) => (
                  <li key={a.id}>
                    <Link
                      to={a.link}
                      style={{ display: 'block', borderLeft: `3px solid ${color}`, padding: 'var(--space-2) var(--space-3)', color: 'inherit', textDecoration: 'none', borderRadius: 4 }}
                      className="alert-item"
                    >
                      <strong>{a.title}</strong>
                      <br />
                      <span className="small muted">{a.detail}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </>
  );
}
