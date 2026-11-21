import { useMemo, useState, type FormEvent } from 'react';
import { Empty, ErrorBox, Modal } from '../components/ui';
import { EXPENSE_KINDS, expenseLabel, expensesIn, summarizeExpenses, validateExpense } from '../domain/expenses';
import { dateShort, money, num } from '../domain/format';
import type { Expense, ExpenseKind } from '../domain/types';
import { useData } from '../state/DataContext';

type Range = 'mois' | 'mois-1' | '3mois' | 'annee' | 'tout';
const ranges: [Range, string][] = [
  ['mois', 'Ce mois'],
  ['mois-1', 'Mois dernier'],
  ['3mois', '3 derniers mois'],
  ['annee', 'Cette année'],
  ['tout', 'Tout'],
];

function rangeBounds(r: Range, now: Date): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = (yy: number, mm: number) => {
    const x = new Date(Date.UTC(yy, mm, 1));
    return x.toISOString().slice(0, 10);
  };
  switch (r) {
    case 'mois': return { from: d(y, m), to: d(y, m + 1) };
    case 'mois-1': return { from: d(y, m - 1), to: d(y, m) };
    case '3mois': return { from: d(y, m - 2), to: d(y, m + 1) };
    case 'annee': return { from: d(y, 0), to: d(y + 1, 0) };
    case 'tout': return { from: '0000-01-01', to: '9999-12-31' };
  }
}

export function Expenses() {
  const { data, now, can } = useData();
  const [range, setRange] = useState<Range>('mois');
  const [vehicleId, setVehicleId] = useState('');
  const [kind, setKind] = useState<ExpenseKind | ''>('');
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const canWrite = can('direction', 'agent', 'comptable', 'mecanicien');
  const canDelete = can('direction', 'comptable');

  const { from, to } = rangeBounds(range, now);
  const list = useMemo(
    () =>
      expensesIn(data.expenses, from, to)
        .filter((e) => (!vehicleId || e.vehicleId === vehicleId) && (!kind || e.kind === kind))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [data.expenses, from, to, vehicleId, kind],
  );
  const sum = summarizeExpenses(list);
  const vehicleName = (id: string) => {
    const v = data.vehicles.find((x) => x.id === id);
    return v ? `${v.brand} ${v.model}` : 'Véhicule supprimé';
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Dépenses</h1>
          <p className="small muted" style={{ margin: 0 }}>
            Carburant, pneus, réparations, amendes… Les entretiens planifiés restent dans Maintenance. Tout est déduit de la marge dans les rapports.
          </p>
        </div>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setEditing('new')} disabled={data.vehicles.length === 0}>
            Ajouter une dépense
          </button>
        )}
      </header>

      <div className="row">
        <div className="tabs" role="group" aria-label="Période">
          {ranges.map(([k, l]) => (
            <button key={k} type="button" aria-selected={range === k} onClick={() => setRange(k)}>{l}</button>
          ))}
        </div>
        <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label="Véhicule" style={{ width: 'auto' }}>
          <option value="">Tous les véhicules</option>
          {data.vehicles.map((v) => <option key={v.id} value={v.id}>{v.brand} {v.model} · {v.plate}</option>)}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value as ExpenseKind | '')} aria-label="Type" style={{ width: 'auto' }}>
          <option value="">Tous les types</option>
          {EXPENSE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      <section className="kpis" aria-label="Totaux">
        <div className="card kpi">
          <span className="kpi-label">Total</span>
          <span className="kpi-value num">{money(sum.total, '')}</span>
          <span className="small muted">{list.length} dépense{list.length > 1 ? 's' : ''}</span>
        </div>
        {sum.byKind.slice(0, 3).map((k) => (
          <div key={k.kind} className="card kpi">
            <span className="kpi-label">{k.label}</span>
            <span className="kpi-value num">{money(k.amount, '')}</span>
            <span className="small muted">{sum.total ? Math.round((k.amount / sum.total) * 100) : 0} % du total</span>
          </div>
        ))}
      </section>

      <section className="card" aria-labelledby="liste">
        <h2 id="liste" className="sr-only">Liste des dépenses</h2>
        {list.length === 0 ? (
          <Empty>Aucune dépense sur cette période.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Date</th><th>Véhicule</th><th>Type</th><th>Libellé</th><th className="right">Km</th><th className="right">Montant</th><th /></tr>
              </thead>
              <tbody>
                {list.map((e) => {
                  const v = data.vehicles.find((x) => x.id === e.vehicleId);
                  const res = e.reservationId ? data.reservations.find((r) => r.id === e.reservationId) : undefined;
                  return (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{dateShort(e.date + 'T12:00:00')}</td>
                      <td><strong>{vehicleName(e.vehicleId)}</strong><br /><span className="muted">{v?.plate}</span></td>
                      <td>{expenseLabel[e.kind]}</td>
                      <td>{e.label ?? ''}{res && <><br /><span className="muted">Contrat {res.number}</span></>}</td>
                      <td className="right num">{e.mileage != null ? num(e.mileage) : ''}</td>
                      <td className="right num" style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{money(e.amount)}</td>
                      <td className="right">{canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setEditing(e)}>Modifier</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {sum.byKind.length > 0 && (
        <section className="card" aria-labelledby="partype">
          <h2 id="partype">Par type</h2>
          <div className="stack" style={{ gap: 8 }}>
            {sum.byKind.map((k) => (
              <div key={k.kind} className="row" style={{ flexWrap: 'nowrap', gap: 12 }}>
                <span style={{ width: 150, flex: 'none' }}>{k.label}</span>
                <div style={{ flex: 1, height: 10, background: 'var(--sable)', borderRadius: 5 }} aria-hidden="true">
                  <div style={{ height: 10, borderRadius: 5, background: 'var(--atlantique)', width: `${(k.amount / sum.total) * 100}%` }} />
                </div>
                <span className="num" style={{ width: 130, textAlign: 'right', flex: 'none' }}>{money(k.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {editing && <ExpenseDialog expense={editing === 'new' ? null : editing} canDelete={canDelete} defaultVehicle={vehicleId} onClose={() => setEditing(null)} />}
    </>
  );
}

function ExpenseDialog({ expense, canDelete, defaultVehicle, onClose }: { expense: Expense | null; canDelete: boolean; defaultVehicle: string; onClose: () => void }) {
  const { data, store, refresh, toast, now } = useData();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [f, setF] = useState({
    vehicleId: expense?.vehicleId ?? defaultVehicle ?? '',
    date: expense?.date ?? today,
    kind: expense?.kind ?? ('carburant' as ExpenseKind),
    amount: expense ? String(expense.amount) : '',
    label: expense?.label ?? '',
    mileage: expense?.mileage != null ? String(expense.mileage) : '',
    reservationId: expense?.reservationId ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Contrats du véhicule autour de la date : pour rattacher une amende ou un plein au bon client.
  const contracts = data.reservations
    .filter((r) => r.vehicleId === f.vehicleId && r.status !== 'annulee')
    .filter((r) => Math.abs(Date.parse(r.start) - Date.parse(f.date)) < 120 * 86400000)
    .sort((a, b) => b.start.localeCompare(a.start));

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const row = {
      vehicleId: f.vehicleId,
      date: f.date,
      kind: f.kind,
      amount: Number(f.amount.replace(/\s/g, '')),
      label: f.label.trim() || null,
      mileage: f.mileage.trim() ? Number(f.mileage.replace(/\s/g, '')) : null,
      reservationId: f.reservationId || null,
    };
    const err = validateExpense(row, today);
    if (err) return setError(err);
    try {
      if (expense) await store.update('expenses', expense.id, row);
      else await store.insert('expenses', row);
      await refresh();
      toast(expense ? 'Dépense modifiée' : 'Dépense ajoutée');
      onClose();
    } catch (ex) {
      setError((ex as Error).message);
    }
  }

  async function remove() {
    if (!expense) return;
    try {
      await store.remove('expenses', expense.id);
      await refresh();
      toast('Dépense supprimée');
      onClose();
    } catch (ex) {
      setError((ex as Error).message);
    }
  }

  return (
    <Modal title={expense ? 'Modifier la dépense' : 'Nouvelle dépense'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="grid-2">
          <label className="field">
            Véhicule
            <select required value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value, reservationId: '' })}>
              <option value="">Choisir…</option>
              {data.vehicles.map((v) => <option key={v.id} value={v.id}>{v.brand} {v.model} · {v.plate}</option>)}
            </select>
          </label>
          <label className="field">
            Type
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ExpenseKind })}>
              {EXPENSE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="field">Date<input type="date" required max={today} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label className="field">Montant (FCFA)<input required inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
          <label className="field">Kilométrage (facultatif)<input inputMode="numeric" value={f.mileage} onChange={(e) => setF({ ...f, mileage: e.target.value })} /></label>
          <label className="field">
            Contrat concerné (facultatif)
            <select value={f.reservationId} onChange={(e) => setF({ ...f, reservationId: e.target.value })} disabled={!f.vehicleId}>
              <option value="">Aucun</option>
              {contracts.map((r) => {
                const c = data.clients.find((x) => x.id === r.clientId);
                return <option key={r.id} value={r.id}>{r.number} · {c?.name} · {dateShort(r.start)}</option>;
              })}
            </select>
          </label>
        </div>
        <label className="field">Libellé (facultatif)<input maxLength={200} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Station, garage, n° de facture…" /></label>
        {f.kind === 'amende' && (
          <p className="hint" style={{ margin: 0 }}>
            Amende à la charge du client : rattachez le contrat, puis facturez-la en frais sur la réservation pour qu’elle soit compensée dans la marge.
          </p>
        )}
        <ErrorBox error={error} />
        <div className="modal-foot">
          {expense && canDelete && (
            confirmDelete ? (
              <button type="button" className="btn btn-danger" onClick={remove}>Confirmer la suppression</button>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>Supprimer</button>
            )
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
