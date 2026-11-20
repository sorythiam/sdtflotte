import { useState, type FormEvent } from 'react';
import { Empty, ErrorBox, Modal } from '../components/ui';
import { dateShort, fromLocalInput, money, toLocalInput } from '../domain/format';
import { findConflicts } from '../domain/rules';
import { useData } from '../state/DataContext';

export function Maintenance() {
  const { data, can, now } = useData();
  const [open, setOpen] = useState(false);
  const veh = new Map(data.vehicles.map((v) => [v.id, v]));
  const list = data.maintenances.slice().sort((a, b) => b.start.localeCompare(a.start));
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
  const yearCost = data.maintenances.filter((m) => m.start >= yearStart).reduce((s, m) => s + m.cost, 0);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Maintenance</h1>
          <p className="muted small">Coût depuis le 1er janvier : {money(yearCost)}</p>
        </div>
        {can('direction', 'mecanicien') && <button className="btn btn-primary" onClick={() => setOpen(true)}>Planifier un entretien</button>}
      </header>
      <section className="card">
        {list.length === 0 ? (
          <Empty>Aucun entretien enregistré.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Véhicule</th><th>Intervention</th><th>Période</th><th className="right">Coût</th><th>État</th></tr></thead>
              <tbody>
                {list.map((m) => {
                  const v = veh.get(m.vehicleId);
                  const state = Date.parse(m.end) < now.getTime() ? 'Terminé' : Date.parse(m.start) <= now.getTime() ? 'En cours' : 'Planifié';
                  return (
                    <tr key={m.id}>
                      <td><strong>{v ? `${v.brand} ${v.model}` : '—'}</strong><br /><span className="muted">{v?.plate}</span></td>
                      <td>{m.label}</td>
                      <td>{dateShort(m.start)} → {dateShort(m.end)}</td>
                      <td className="right num">{money(m.cost)}</td>
                      <td><span className={`badge ${state === 'En cours' ? 'badge-muted' : state === 'Planifié' ? 'badge-outline' : 'badge-success'}`}>{state}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {open && <MaintenanceForm onClose={() => setOpen(false)} />}
    </>
  );
}

function MaintenanceForm({ onClose }: { onClose: () => void }) {
  const { data, store, refresh, toast, now } = useData();
  const start0 = new Date(now);
  start0.setDate(start0.getDate() + 1);
  start0.setHours(8, 0, 0, 0);
  const [vehicleId, setVehicleId] = useState('');
  const [label, setLabel] = useState('');
  const [start, setStart] = useState(toLocalInput(start0.toISOString()));
  const [end, setEnd] = useState(toLocalInput(new Date(start0.getTime() + 10 * 3600000).toISOString()));
  const [cost, setCost] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const clash = vehicleId && start && end
    ? findConflicts(vehicleId, fromLocalInput(start), fromLocalInput(end), data.reservations, []).map((c) => c.label)
    : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!(Date.parse(fromLocalInput(end)) > Date.parse(fromLocalInput(start)))) return setError('La fin doit être après le début.');
    try {
      await store.insert('maintenances', { vehicleId, label, start: fromLocalInput(start), end: fromLocalInput(end), cost: Number(cost) || 0 });
      await refresh();
      toast('Entretien planifié, le véhicule est bloqué sur cette période');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title="Planifier un entretien" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          Véhicule
          <select required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Choisir</option>
            {data.vehicles.map((v) => <option key={v.id} value={v.id}>{v.brand} {v.model} · {v.plate}</option>)}
          </select>
        </label>
        <label className="field">Intervention<input required placeholder="Vidange, freins, pneus…" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <div className="grid-2">
          <label className="field">Début<input type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="field">Fin<input type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <label className="field">Coût estimé (FCFA)<input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} /></label>
        </div>
        {clash.length > 0 && <div className="notice">Attention : ce véhicule est réservé sur cette période ({clash.join(', ')}). Déplacez la réservation ou l’entretien.</div>}
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary">Planifier</button>
        </div>
      </form>
    </Modal>
  );
}
