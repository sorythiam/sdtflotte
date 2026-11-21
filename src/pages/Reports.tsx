import { useMemo, useState } from 'react';
import { Empty, ErrorBox } from '../components/ui';
import { money, num } from '../domain/format';
import { expenseLabel, expensesIn } from '../domain/expenses';
import { computeReport, DEFAULT_ACCOUNTS, journalEntries, monthlyRevenue, type AccountPlan, type Period } from '../domain/reports';
import { useData } from '../state/DataContext';

type Preset = 'mois' | 'mois-1' | '3mois' | 'annee' | 'perso';

function presetPeriod(p: Preset, now: Date, custom: { from: string; to: string }): Period {
  const y = now.getFullYear();
  const m = now.getMonth();
  const iso = (d: Date) => d.toISOString();
  switch (p) {
    case 'mois':
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 1)) };
    case 'mois-1':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 1)) };
    case '3mois':
      return { from: iso(new Date(y, m - 2, 1)), to: iso(new Date(y, m + 1, 1)) };
    case 'annee':
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y + 1, 0, 1)) };
    case 'perso': {
      const to = new Date(custom.to + 'T00:00:00');
      to.setDate(to.getDate() + 1); // date de fin incluse
      return { from: iso(new Date(custom.from + 'T00:00:00')), to: iso(to) };
    }
  }
}

const monthName = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const pct = (x: number) => `${Math.round(x * 100)} %`;

function loadPlan(orgId: string): AccountPlan {
  try {
    const raw = localStorage.getItem(`yoonfleet-comptes-${orgId}`);
    if (raw) return { ...DEFAULT_ACCOUNTS, ...(JSON.parse(raw) as Partial<AccountPlan>) };
  } catch {
    /* stockage indisponible */
  }
  return DEFAULT_ACCOUNTS;
}

export function Reports() {
  const { data, now, session } = useData();
  const orgId = session!.org.id;
  const [preset, setPreset] = useState<Preset>('mois');
  const today = now.toISOString().slice(0, 10);
  const [custom, setCustom] = useState({ from: today.slice(0, 8) + '01', to: today });
  const [plan, setPlan] = useState<AccountPlan>(() => loadPlan(orgId));
  const [showPlan, setShowPlan] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const period = useMemo(() => {
    const full = presetPeriod(preset, now, custom);
    // Périodes en cours : arrêtées à la fin de la journée, pour ne pas compter des jours à venir.
    if (preset === 'mois' || preset === '3mois' || preset === 'annee') {
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
      return { from: full.from, to: end < full.to ? end : full.to };
    }
    return full;
  }, [preset, now, custom]);
  const r = useMemo(() => computeReport(data, period), [data, period]);
  const months = useMemo(() => monthlyRevenue(data.reservations, now, 6), [data.reservations, now]);
  const maxMonth = Math.max(1, ...months.map((m) => m.revenue));
  const journal = useMemo(() => journalEntries(data.payments, data.reservations, data.clients, period, plan, data.invoices), [data, period, plan]);
  const label = `${new Date(period.from).toLocaleDateString('fr-FR')} – ${new Date(Date.parse(period.to) - 1).toLocaleDateString('fr-FR')}`;
  const fileTag = `${period.from.slice(0, 10)}_${new Date(Date.parse(period.to) - 1).toISOString().slice(0, 10)}`;

  function savePlan(next: AccountPlan) {
    setPlan(next);
    try {
      localStorage.setItem(`yoonfleet-comptes-${orgId}`, JSON.stringify(next));
    } catch {
      /* pas de stockage : le plan reste pour la session */
    }
  }

  async function exportReport() {
    setError(null);
    try {
      const write = (await import('write-excel-file/browser')).default;
      const H = (v: string) => ({ value: v, fontWeight: 'bold' as const });
      const N = (v: number) => ({ value: Math.round(v), type: Number, format: '#,##0' });
      const sheets = [
        {
          sheet: 'Synthèse',
          columns: [{ width: 34 }, { width: 18 }],
          data: [
            [H(`Rapport ${session!.org.name}`), { value: label }],
            [{ value: 'Chiffre d’affaires (FCFA HT)' }, N(r.revenue)],
            [{ value: 'Encaissements (hors cautions)' }, N(r.collected)],
            [{ value: 'Coûts d’entretien' }, N(r.maintenance)],
            [{ value: 'Dépenses (carburant, pneus, réparations…)' }, N(r.expenses)],
            [{ value: 'Marge (CA − entretien − dépenses)' }, N(r.margin)],
            [{ value: 'Frais au retour facturés' }, N(r.fees)],
            [{ value: 'Taux d’occupation' }, { value: pct(r.occupancy) }],
            [{ value: 'Locations sur la période' }, N(r.rentals)],
          ],
        },
        {
          sheet: 'Véhicules',
          columns: [{ width: 22 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }],
          data: [
            [H('Véhicule'), H('Immatriculation'), H('Catégorie'), H('Jours loués'), H('Occupation'), H('CA'), H('Entretien'), H('Dépenses'), H('Marge')],
            ...r.vehicles.map((v) => [
              { value: v.label }, { value: v.plate }, { value: v.category }, N(v.rentedDays), { value: pct(v.occupancy) }, N(v.revenue), N(v.maintenance), N(v.expenses), N(v.margin),
            ]),
          ],
        },
        {
          sheet: 'Dépenses',
          columns: [{ width: 12 }, { width: 24 }, { width: 18 }, { width: 36 }, { width: 12 }, { width: 14 }],
          data: [
            [H('Date'), H('Véhicule'), H('Type'), H('Libellé'), H('Km'), H('Montant')],
            ...expensesIn(data.expenses, period.from, period.to)
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((e) => {
                const v = data.vehicles.find((x) => x.id === e.vehicleId);
                return [
                  { value: new Date(e.date + 'T00:00:00'), type: Date, format: 'dd/mm/yyyy' },
                  { value: v ? `${v.brand} ${v.model} ${v.plate}` : '—' }, { value: expenseLabel[e.kind] }, { value: e.label ?? '' },
                  e.mileage != null ? N(e.mileage) : { value: '' }, N(e.amount),
                ];
              }),
          ],
        },
        {
          sheet: 'Clients',
          columns: [{ width: 30 }, { width: 12 }, { width: 16 }],
          data: [[H('Client'), H('Locations'), H('CA')], ...r.clients.map((c) => [{ value: c.name }, N(c.rentals), N(c.revenue)])],
        },
      ];
      await write(sheets as never).toFile(`rapport_yoonfleet_${fileTag}.xlsx`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function exportJournal() {
    setError(null);
    try {
      const write = (await import('write-excel-file/browser')).default;
      const H = (v: string) => ({ value: v, fontWeight: 'bold' as const });
      const rows = [
        [H('Date'), H('Journal'), H('N° pièce'), H('Compte'), H('Libellé'), H('Débit'), H('Crédit')],
        ...journal.map((l) => [
          { value: new Date(l.date + 'T00:00:00'), type: Date, format: 'dd/mm/yyyy' },
          { value: l.journal }, { value: l.piece }, { value: l.account }, { value: l.label },
          l.debit ? { value: l.debit, type: Number, format: '#,##0' } : { value: '' },
          l.credit ? { value: l.credit, type: Number, format: '#,##0' } : { value: '' },
        ]),
      ];
      await write(rows as never, { sheet: 'Journal', columns: [{ width: 12 }, { width: 9 }, { width: 15 }, { width: 10 }, { width: 46 }, { width: 14 }, { width: 14 }] } as never).toFile(
        `journal_syscohada_${fileTag}.xlsx`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const presets: [Preset, string][] = [
    ['mois', 'Ce mois'],
    ['mois-1', 'Mois dernier'],
    ['3mois', '3 derniers mois'],
    ['annee', 'Cette année'],
    ['perso', 'Personnalisée'],
  ];
  const accountFields: [keyof AccountPlan, string][] = [
    ['cash', 'Caisse (espèces)'],
    ['bank', 'Banque (virement, carte, chèque)'],
    ['mobileMoney', 'Mobile money'],
    ['revenue', 'Produits de location'],
    ['deposits', 'Cautions reçues'],
    ['customers', 'Clients'],
    ['vat', 'TVA facturée'],
  ];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Rapports</h1>
          <p className="muted small">{label}{preset === 'mois' || preset === '3mois' || preset === 'annee' ? ' (à date)' : ''} · montants en FCFA HT</p>
        </div>
        <div className="row">
          <button className="btn" onClick={exportReport}>Exporter le rapport (Excel)</button>
          <button className="btn btn-dark" onClick={exportJournal}>Journal SYSCOHADA (Excel)</button>
        </div>
      </header>
      <div className="row">
        <div className="tabs" role="group" aria-label="Période">
          {presets.map(([k, l]) => (
            <button key={k} type="button" aria-selected={preset === k} onClick={() => setPreset(k)}>{l}</button>
          ))}
        </div>
        {preset === 'perso' && (
          <>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center' }}>
              <span className="muted">Du</span>
              <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} style={{ width: 'auto' }} />
            </label>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center' }}>
              <span className="muted">au</span>
              <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} style={{ width: 'auto' }} />
            </label>
          </>
        )}
      </div>
      <ErrorBox error={error} />

      <section className="kpis" aria-label="Indicateurs de la période">
        <div className="card kpi">
          <span className="kpi-label">Chiffre d’affaires</span>
          <span className="kpi-value num">{money(r.revenue, '')}</span>
          <span className="small muted">{r.rentals} location(s) · dont {money(r.fees)} de frais au retour</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Encaissé</span>
          <span className="kpi-value num">{money(r.collected, '')}</span>
          <span className="small muted">hors cautions</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Marge après coûts</span>
          <span className="kpi-value num" style={{ color: r.margin < 0 ? 'var(--danger)' : 'var(--success)' }}>{money(r.margin, '')}</span>
          <span className="small muted">entretien {money(r.maintenance)} · dépenses {money(r.expenses)}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Taux d’occupation</span>
          <span className="kpi-value">{pct(r.occupancy)}</span>
          <span className="small muted">jours loués / jours disponibles</span>
        </div>
      </section>

      <section className="card" aria-labelledby="parvehicule">
          <h2 id="parvehicule">Rentabilité par véhicule</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Véhicule</th><th className="right">Jours loués</th><th className="right">Occupation</th>
                  <th className="right">CA</th><th className="right">Entretien</th><th className="right">Dépenses</th><th className="right">Marge</th>
                </tr>
              </thead>
              <tbody>
                {r.vehicles.map((v) => (
                  <tr key={v.vehicleId}>
                    <td style={{ whiteSpace: 'nowrap' }}><strong>{v.label}</strong><br /><span className="muted">{v.plate} · {v.category}</span></td>
                    <td className="right num">{num(Math.round(v.rentedDays * 10) / 10)}</td>
                    <td className="right">
                      <span className="num">{pct(v.occupancy)}</span>
                      <div style={{ height: 6, background: 'var(--sable)', borderRadius: 3, marginTop: 4, minWidth: 60 }} aria-hidden="true">
                        <div style={{ height: 6, borderRadius: 3, width: pct(v.occupancy).replace(' ', ''), background: 'var(--atlantique)' }} />
                      </div>
                    </td>
                    <td className="right num" style={{ whiteSpace: 'nowrap' }}>{money(v.revenue)}</td>
                    <td className="right num" style={{ whiteSpace: 'nowrap' }}>{v.maintenance ? money(v.maintenance) : '—'}</td>
                    <td className="right num" style={{ whiteSpace: 'nowrap' }}>{v.expenses ? money(v.expenses) : '—'}</td>
                    <td className="right num" style={{ whiteSpace: 'nowrap', fontWeight: 600, color: v.margin < 0 ? 'var(--danger)' : undefined }}>{money(v.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </section>

      <div className="grid-2" style={{ gap: 'var(--space-6)', alignItems: 'start' }}>
          <section className="card" aria-labelledby="sixmois">
            <h2 id="sixmois">Chiffre d’affaires, 6 derniers mois</h2>
            <div role="img" aria-label={`Chiffre d’affaires mensuel : ${months.map((m) => `${monthName.format(new Date(m.from))} ${money(m.revenue)}`).join(', ')}`}
              style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8, alignItems: 'end', height: 160 }}>
              {months.map((m, i) => (
                <div key={m.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                  <span className="xs muted num">{m.revenue ? `${Math.round(m.revenue / 1000)} k` : ''}</span>
                  <div style={{ width: '100%', borderRadius: '6px 6px 0 0', height: `${(m.revenue / maxMonth) * 110}px`, minHeight: m.revenue ? 2 : 0, background: i === months.length - 1 ? 'var(--ocre)' : 'var(--atlantique)' }} />
                  <span className="xs muted">{monthName.format(new Date(m.from))}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="card" aria-labelledby="topclients">
            <h2 id="topclients">Meilleurs clients</h2>
            {r.clients.length === 0 ? (
              <Empty>Aucune location sur la période.</Empty>
            ) : (
              <table className="data">
                <tbody>
                  {r.clients.slice(0, 8).map((c) => (
                    <tr key={c.clientId}>
                      <td><strong>{c.name}</strong><br /><span className="muted">{c.rentals} location(s)</span></td>
                      <td className="right num">{money(c.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
      </div>

      <section className="card" aria-labelledby="journal">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="journal">Journal des ventes et encaissements (SYSCOHADA)</h2>
          <button type="button" className="btn btn-sm" onClick={() => setShowPlan(!showPlan)}>
            {showPlan ? 'Masquer le plan de comptes' : 'Plan de comptes'}
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Journal des ventes (VT) pour les factures et avoirs émis, et une écriture par paiement reçu : CA caisse, BQ banque et chèques, MM mobile money.
          Les comptes proposés sont à faire valider par votre comptable.
        </p>
        {showPlan && (
          <div className="grid-2">
            {accountFields.map(([k, l]) => (
              <label key={k} className="field">
                {l}
                <input value={plan[k]} inputMode="numeric" onChange={(e) => savePlan({ ...plan, [k]: e.target.value.replace(/\s/g, '') })} />
              </label>
            ))}
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => savePlan(DEFAULT_ACCOUNTS)}>Revenir aux comptes par défaut</button>
            </div>
          </div>
        )}
        {journal.length === 0 ? (
          <Empty>Aucun encaissement sur la période.</Empty>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr><th>Date</th><th>Journal</th><th>Pièce</th><th>Compte</th><th>Libellé</th><th className="right">Débit</th><th className="right">Crédit</th></tr>
              </thead>
              <tbody>
                {journal.map((l, i) => (
                  <tr key={i}>
                    <td>{new Date(l.date + 'T00:00:00').toLocaleDateString('fr-FR')}</td>
                    <td>{l.journal}</td><td className="num">{l.piece}</td><td className="num">{l.account}</td><td>{l.label}</td>
                    <td className="right num">{l.debit ? num(l.debit) : ''}</td>
                    <td className="right num">{l.credit ? num(l.credit) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
