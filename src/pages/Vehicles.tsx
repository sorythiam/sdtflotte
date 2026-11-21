import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ImportDialog } from '../components/ImportDialog';
import { Empty, ErrorBox, Modal, VehicleBadge } from '../components/ui';
import { num } from '../domain/format';
import { expiryAlerts, vehicleStatusAt } from '../domain/rules';
import type { Fuel, Vehicle } from '../domain/types';
import { useData } from '../state/DataContext';

export function Vehicles() {
  const { data, now, can, session } = useData();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [importing, setImporting] = useState(false);
  const editing = params.get('v');
  const alerts = expiryAlerts(data.vehicles, now, 30);
  const list = data.vehicles
    .filter((v) => `${v.plate} ${v.brand} ${v.model} ${v.category}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.category.localeCompare(b.category) || a.plate.localeCompare(b.plate));
  const editable = can('direction', 'agent', 'mecanicien');

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Véhicules</h1>
          <p className="muted small">
            {data.vehicles.length} véhicule(s) · quota de la formule : {session?.org.vehicleQuota}
          </p>
        </div>
        {editable && (
          <div className="row">
            <button className="btn" onClick={() => setImporting(true)}>
              Importer depuis Excel
            </button>
            <button className="btn btn-primary" onClick={() => setParams({ v: 'nouveau' })}>
              Ajouter un véhicule
            </button>
          </div>
        )}
      </header>
      <label className="field">
        <input type="search" aria-label="Rechercher un véhicule" placeholder="Rechercher une plaque, un modèle, une catégorie…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <section className="card">
        {list.length === 0 ? (
          <Empty>Aucun véhicule. Ajoutez le premier, ou importez toute votre flotte depuis Excel.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Véhicule</th>
                  <th>Catégorie</th>
                  <th className="right">Kilométrage</th>
                  <th>Documents</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {list.map((v) => {
                  const a = alerts.filter((x) => x.vehicleId === v.id);
                  return (
                    <tr key={v.id} className={editable ? 'clickable' : undefined} onClick={() => editable && setParams({ v: v.id })}>
                      <td>
                        <strong>{v.brand} {v.model}</strong>
                        <br />
                        <span className="muted">{v.plate}{v.year ? ` · ${v.year}` : ''}</span>
                      </td>
                      <td>{v.category}</td>
                      <td className="right num">{num(v.mileage)} km</td>
                      <td>
                        {a.length === 0 ? (
                          <span className="muted">À jour</span>
                        ) : (
                          a.map((x) => (
                            <div key={x.document} style={{ color: x.daysLeft < 0 ? 'var(--danger)' : 'var(--ocre-text)', fontWeight: 600 }}>
                              {x.document} {x.daysLeft < 0 ? 'expirée' : `J-${x.daysLeft}`}
                            </div>
                          ))
                        )}
                      </td>
                      <td><VehicleBadge status={vehicleStatusAt(v, now, data.reservations, data.maintenances)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && <VehicleForm id={editing} onClose={() => setParams({})} />}
      {importing && <ImportDialog kind="vehicles" onClose={() => setImporting(false)} />}
    </>
  );
}

function VehicleForm({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, store, refresh, toast } = useData();
  const existing = data.vehicles.find((v) => v.id === id);
  const categories = data.rates.map((r) => r.category);
  const [f, setF] = useState<Omit<Vehicle, 'id'>>(
    existing ?? {
      plate: '', brand: '', model: '', year: new Date().getFullYear(), category: categories[0] ?? '', fuel: 'diesel',
      mileage: 0, outOfService: false, insuranceExpiry: null, inspectionExpiry: null, vignetteExpiry: null,
    },
  );
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, val: (typeof f)[K]) => setF({ ...f, [k]: val });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const plate = f.plate.trim().toUpperCase();
    if (data.vehicles.some((v) => v.plate === plate && v.id !== id)) return setError('Cette immatriculation existe déjà.');
    try {
      const row = { ...f, plate };
      if (existing) await store.update('vehicles', id, row);
      else await store.insert('vehicles', row);
      await refresh();
      toast(existing ? 'Véhicule mis à jour' : 'Véhicule ajouté');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={existing ? `${existing.brand} ${existing.model}` : 'Nouveau véhicule'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">Immatriculation<input required value={f.plate} onChange={(e) => set('plate', e.target.value)} /></label>
          <label className="field">
            Catégorie
            <select required value={f.category} onChange={(e) => set('category', e.target.value)}>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="field">Marque<input required value={f.brand} onChange={(e) => set('brand', e.target.value)} /></label>
          <label className="field">Modèle<input required value={f.model} onChange={(e) => set('model', e.target.value)} /></label>
          <label className="field">Année<input type="number" min={1980} max={2100} value={f.year ?? ''} onChange={(e) => set('year', e.target.value ? Number(e.target.value) : null)} /></label>
          <label className="field">
            Carburant
            <select value={f.fuel} onChange={(e) => set('fuel', e.target.value as Fuel)}>
              <option value="diesel">Diesel</option><option value="essence">Essence</option><option value="hybride">Hybride</option><option value="electrique">Électrique</option>
            </select>
          </label>
          <label className="field">Kilométrage<input type="number" min={0} required value={f.mileage} onChange={(e) => set('mileage', Number(e.target.value))} /></label>
          <label className="field">Assurance valable jusqu’au<input type="date" value={f.insuranceExpiry ?? ''} onChange={(e) => set('insuranceExpiry', e.target.value || null)} /></label>
          <label className="field">Visite technique jusqu’au<input type="date" value={f.inspectionExpiry ?? ''} onChange={(e) => set('inspectionExpiry', e.target.value || null)} /></label>
          <label className="field">Vignette jusqu’au<input type="date" value={f.vignetteExpiry ?? ''} onChange={(e) => set('vignetteExpiry', e.target.value || null)} /></label>
        </div>
        <label className="check">
          <input type="checkbox" checked={f.outOfService} onChange={(e) => set('outOfService', e.target.checked)} />
          Hors service (ne peut plus être loué, ne compte pas dans le quota)
        </label>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary">{existing ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </form>
    </Modal>
  );
}
