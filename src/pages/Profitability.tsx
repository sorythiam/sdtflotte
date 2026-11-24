import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty } from '../components/ui';
import { money, num } from '../domain/format';
import { byModel, computeProfitability, verdictLabel, type ProfitLine, type Verdict } from '../domain/profitability';
import { useData } from '../state/DataContext';

const SPANS: [number, string][] = [
  [3, '3 mois'],
  [6, '6 mois'],
  [12, '12 mois'],
];
const pct = (x: number) => `${Math.round(x * 100)} %`;

export function Profitability() {
  const { data, now } = useData();
  const [months, setMonths] = useState(3);
  const [sort, setSort] = useState<'margin' | 'occupancy' | 'month'>('month');
  const period = useMemo(() => {
    const from = new Date(now);
    from.setMonth(from.getMonth() - months);
    return { from: from.toISOString(), to: now.toISOString() };
  }, [now, months]);
  const lines = useMemo(() => computeProfitability(data, period, now), [data, period, now]);
  const models = useMemo(() => byModel(lines), [lines]);
  const sorted = lines.slice().sort((a, b) => (sort === 'margin' ? b.margin - a.margin : sort === 'occupancy' ? b.occupancy - a.occupancy : b.marginPerMonth - a.marginPerMonth));
  const total = lines.reduce((s, l) => ({ revenue: s.revenue + l.revenue, costs: s.costs + l.costs, margin: s.margin + l.margin }), { revenue: 0, costs: 0, margin: 0 });
  const count = (v: Verdict) => lines.filter((l) => l.verdict === v).length;
  const toWatch = lines.filter((l) => ['perte', 'fin_de_vie', 'sous_utilise'].includes(l.verdict));

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Rentabilité par véhicule</h1>
          <p className="muted small">Ce que chaque véhicule rapporte (locations et versements VTC), ce qu’il coûte (entretiens et dépenses du propriétaire), et quoi en faire.</p>
        </div>
        <div className="tabs" role="group" aria-label="Période">
          {SPANS.map(([m, l]) => <button key={m} type="button" aria-selected={months === m} onClick={() => setMonths(m)}>{l}</button>)}
        </div>
      </header>

      {lines.length === 0 ? (
        <section className="card"><Empty>Aucun véhicule. Ajoutez votre flotte pour voir sa rentabilité.</Empty></section>
      ) : (
        <>
          <div className="kpis">
            <div className="card kpi"><span className="kpi-label">Revenus</span><span className="kpi-value num">{money(total.revenue, '')}</span><span className="small muted">FCFA</span></div>
            <div className="card kpi"><span className="kpi-label">Coûts</span><span className="kpi-value num">{money(total.costs, '')}</span><span className="small muted">FCFA, entretiens et dépenses</span></div>
            <div className="card kpi"><span className="kpi-label">Marge</span><span className="kpi-value num" style={{ color: total.margin < 0 ? 'var(--danger)' : undefined }}>{money(total.margin, '')}</span><span className="small muted">FCFA{total.revenue > 0 ? `, ${pct(total.margin / total.revenue)} des revenus` : ''}</span></div>
            <div className="card kpi"><span className="kpi-label">À revoir</span><span className="kpi-value" style={{ color: toWatch.length ? 'var(--ocre-text)' : undefined }}>{toWatch.length}</span><span className="small muted">{count('perte')} à perte · {count('fin_de_vie')} en fin de vie · {count('sous_utilise')} sous-utilisé(s)</span></div>
          </div>

          {toWatch.length > 0 && (
            <section className="card" aria-labelledby="arevoir">
              <h2 id="arevoir">Décisions à prendre</h2>
              <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
                {toWatch.sort((a, b) => a.margin - b.margin).map((l) => (
                  <li key={l.vehicleId}>
                    <Link to={`/vehicules/${l.vehicleId}`}><strong>{l.label}</strong> {l.plate}</Link> · <span className={`badge ${verdictLabel[l.verdict][1]}`}>{verdictLabel[l.verdict][0]}</span>{' '}
                    <span className="small">{reason(l)} {verdictLabel[l.verdict][2]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card" aria-labelledby="detail">
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <h2 id="detail">Détail par véhicule <span className="small muted" style={{ fontWeight: 400 }}>(montants en FCFA)</span></h2>
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                Trier par
                <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                  <option value="month">Marge par mois</option>
                  <option value="margin">Marge totale</option>
                  <option value="occupancy">Occupation</option>
                </select>
              </label>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Véhicule</th><th className="right">Revenus</th><th className="right">Coûts</th>
                    <th className="right">Marge</th><th className="right">Par mois</th><th className="right">Occupation</th><th>Avis</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((l) => (
                    <tr key={l.vehicleId}>
                      <td style={{ whiteSpace: 'nowrap' }}><Link to={`/vehicules/${l.vehicleId}`}><strong>{l.label}</strong></Link><br /><span className="muted small">{l.plate} · {l.category}{l.year ? ` · ${l.year}` : ''} · {num(l.mileage)} km</span></td>
                      <td className="right num">{l.revenue ? money(l.revenue, '') : '—'}{l.vtcRevenue > 0 && <><br /><span className="xs muted">{l.rentalRevenue ? `dont VTC ${money(l.vtcRevenue, '')}` : 'versements VTC'}</span></>}</td>
                      <td className="right num">{l.costs ? money(l.costs, '') : '—'}{l.maintenance > 0 && l.expenses > 0 && <><br /><span className="xs muted">dont entretien {money(l.maintenance, '')}</span></>}{l.maintenance > 0 && !l.expenses && <><br /><span className="xs muted">entretien</span></>}</td>
                      <td className="right num" style={{ fontWeight: 600, color: l.margin < 0 ? 'var(--danger)' : undefined }}>{money(l.margin, '')}</td>
                      <td className="right num" style={{ color: l.marginPerMonth < 0 ? 'var(--danger)' : undefined }}>{money(l.marginPerMonth, '')}</td>
                      <td className="right">
                        <span className="num">{pct(l.occupancy)}</span>
                        {l.downtimeDays >= 1 && <><br /><span className="xs muted">{num(Math.round(l.downtimeDays))} j au garage</span></>}
                      </td>
                      <td><span className={`badge ${verdictLabel[l.verdict][1]}`} title={verdictLabel[l.verdict][2]}>{verdictLabel[l.verdict][0]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <span className="hint">
              Occupation : jours loués ou confiés en VTC, sur les jours où le véhicule pouvait travailler (hors garage). Les dépenses à la charge d’un chauffeur VTC ne sont pas comptées.
            </span>
          </section>

          {models.length > 0 && (
            <section className="card" aria-labelledby="racheter">
              <h2 id="racheter">Quel modèle racheter ?</h2>
              <p className="small muted" style={{ margin: 0 }}>Marge moyenne par véhicule et par mois, du plus rentable au moins rentable.</p>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Modèle</th><th className="right">Véhicules</th><th className="right">Marge par mois</th><th className="right">Occupation</th></tr></thead>
                  <tbody>
                    {models.map((m, i) => (
                      <tr key={m.label}>
                        <td>{i === 0 && m.marginPerMonth > 0 ? '★ ' : ''}<strong>{m.label}</strong></td>
                        <td className="right num">{m.vehicles}</td>
                        <td className="right num" style={{ fontWeight: 600, color: m.marginPerMonth < 0 ? 'var(--danger)' : undefined }}>{money(m.marginPerMonth)}</td>
                        <td className="right num">{pct(m.occupancy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

function reason(l: ProfitLine): string {
  switch (l.verdict) {
    case 'perte':
      return `Perte de ${money(-l.margin)} sur la période.`;
    case 'fin_de_vie':
      return `Entretien et dépenses : ${pct(l.revenue ? l.costs / l.revenue : 1)} de ce qu’il rapporte.`;
    case 'sous_utilise':
      return `Occupé ${pct(l.occupancy)} du temps.`;
    default:
      return '';
  }
}
