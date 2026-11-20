import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isActive, isLate } from '../domain/rules';
import { useData } from '../state/DataContext';

const DAY = 86400000;
const wd = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function Planning() {
  const { data, now, can } = useData();
  const nav = useNavigate();
  const [span, setSpan] = useState<14 | 31>(14);
  const [offset, setOffset] = useState(0);
  const [category, setCategory] = useState('');

  const from = new Date(startOfDay(now).getTime() + (offset - 4) * DAY);
  const days = Array.from({ length: span }, (_, i) => new Date(from.getTime() + i * DAY));
  const to = from.getTime() + span * DAY;
  const col = (iso: string) => Math.max(0, Math.min(span, (Date.parse(iso) - from.getTime()) / DAY));
  const categories = [...new Set(data.vehicles.map((v) => v.category))].sort();
  const vehicles = data.vehicles
    .filter((v) => !category || v.category === category)
    .sort((a, b) => a.category.localeCompare(b.category) || a.model.localeCompare(b.model));
  const cli = new Map(data.clients.map((c) => [c.id, c]));
  const grid = `200px repeat(${span * 4}, minmax(${span === 14 ? 12 : 6}px, 1fr))`;
  // 4 colonnes par jour : une barre commence et finit au quart de journée près.
  const gc = (s: string, e: string) => {
    const a = Math.floor(col(s) * 4) + 2;
    const b = Math.max(a + 1, Math.ceil(col(e) * 4) + 2);
    return `${a} / ${b}`;
  };
  const visible = (s: string, e: string) => Date.parse(s) < to && Date.parse(e) > from.getTime();
  const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Planning</h1>
          <p className="muted small">
            {fmt.format(from)} – {fmt.format(new Date(to - DAY))}
          </p>
        </div>
        <div className="row">
          <div className="tabs" role="group" aria-label="Période">
            <button type="button" aria-selected={span === 14} onClick={() => setSpan(14)}>
              2 semaines
            </button>
            <button type="button" aria-selected={span === 31} onClick={() => setSpan(31)}>
              Mois
            </button>
          </div>
          <button className="btn btn-sm" aria-label="Période précédente" onClick={() => setOffset(offset - 7)}>
            ‹
          </button>
          <button className="btn btn-sm" onClick={() => setOffset(0)}>
            Aujourd’hui
          </button>
          <button className="btn btn-sm" aria-label="Période suivante" onClick={() => setOffset(offset + 7)}>
            ›
          </button>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center' }}>
            <span className="muted">Catégorie</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 'auto' }}>
              <option value="">Toutes</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {can('direction', 'agent') && (
            <button className="btn btn-primary" onClick={() => nav('/reservations?nouvelle=1')}>
              Nouvelle réservation
            </button>
          )}
        </div>
      </header>

      <section className="card table-wrap" aria-label="Planning des véhicules">
        <div className="gantt">
          <div className="gantt-row gantt-head" style={{ gridTemplateColumns: grid }}>
            <span style={{ textAlign: 'left', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Véhicule</span>
            {days.map((d, i) => (
              <span
                key={i}
                className={startOfDay(d).getTime() === startOfDay(now).getTime() ? 'today' : undefined}
                style={{ gridColumn: `${i * 4 + 2} / span 4` }}
              >
                {span === 14 && (
                  <>
                    {wd.format(d)}
                    <br />
                  </>
                )}
                {d.getDate()}
              </span>
            ))}
          </div>
          {vehicles.map((v) => (
            <div key={v.id} className="gantt-row" style={{ gridTemplateColumns: grid }}>
              <span style={{ gridColumn: 1, gridRow: 1 }}>
                <Link to={`/vehicules?v=${v.id}`} style={{ color: 'var(--ink)' }}>
                  {v.brand} {v.model}
                </Link>
                <br />
                <span className="muted">
                  {v.plate} · {v.category}
                </span>
              </span>
              {data.maintenances
                .filter((m) => m.vehicleId === v.id && visible(m.start, m.end))
                .map((m) => (
                  <span key={m.id} className="bar maintenance" style={{ gridColumn: gc(m.start, m.end), gridRow: 1 }} title={m.label}>
                    {m.label}
                  </span>
                ))}
              {data.reservations
                .filter((r) => r.vehicleId === v.id && isActive(r) && visible(r.start, r.end))
                .map((r) => {
                  const late = isLate(r, now);
                  const end = late ? now.toISOString() : r.end;
                  const who = cli.get(r.clientId)?.name ?? '';
                  return (
                    <Link
                      key={r.id}
                      to={`/reservations/${r.id}`}
                      className={`bar ${r.status === 'reservee' ? 'reservee' : ''} ${late ? 'late' : ''}`}
                      style={{ gridColumn: gc(r.start, end), gridRow: 1 }}
                      title={`${r.number} · ${who}`}
                    >
                      {late ? `Retard · ${who}` : who}
                    </Link>
                  );
                })}
            </div>
          ))}
        </div>
      </section>

      <div className="legend">
        <span><i className="sw" style={{ background: 'var(--atlantique)' }} />En location</span>
        <span><i className="sw" style={{ background: 'var(--sable)', border: '2px dashed var(--atlantique)' }} />Réservé</span>
        <span><i className="sw" style={{ background: 'var(--ink-muted)' }} />Entretien</span>
        <span><i className="sw" style={{ background: 'var(--danger)' }} />Retard</span>
      </div>
    </>
  );
}
