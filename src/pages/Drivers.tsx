import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Modal } from '../components/ui';
import { dateLong, dateShort } from '../domain/format';
import { isActive } from '../domain/rules';
import type { Driver } from '../domain/types';
import { useData } from '../state/DataContext';

/** Chauffeurs de l'entreprise : coordonnées, permis, missions en cours et à venir. */
export function Drivers() {
  const { data, now, can } = useData();
  const [editing, setEditing] = useState<string | null>(null);
  const editable = can('direction', 'agent');
  const today = now.toISOString().slice(0, 10);
  const list = data.drivers.slice().sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Chauffeurs</h1>
          <p className="muted small">Affectés aux locations avec chauffeur, aux bus et aux forfaits. Un chauffeur ne peut pas avoir deux missions en même temps.</p>
        </div>
        {editable && <button className="btn btn-primary" onClick={() => setEditing('nouveau')}>Ajouter un chauffeur</button>}
      </header>
      <section className="card">
        {list.length === 0 ? (
          <Empty>Aucun chauffeur. Ajoutez-les pour les affecter aux réservations.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Chauffeur</th><th>Permis</th><th>Mission en cours ou prochaine</th><th>État</th></tr></thead>
              <tbody>
                {list.map((d) => {
                  const next = data.reservations
                    .filter((r) => r.driverId === d.id && isActive(r) && Date.parse(r.end) > now.getTime())
                    .sort((a, b) => a.start.localeCompare(b.start))[0];
                  const expired = d.licenseExpiry && d.licenseExpiry < today;
                  const soon = d.licenseExpiry && !expired && Date.parse(d.licenseExpiry) - now.getTime() < 30 * 86400000;
                  return (
                    <tr key={d.id} className={editable ? 'clickable' : undefined} onClick={() => editable && setEditing(d.id)} style={d.active ? undefined : { opacity: 0.55 }}>
                      <td><strong>{d.name}</strong><br /><span className="muted">{d.phone}</span></td>
                      <td>
                        {d.licenseCategory ? `Catégorie ${d.licenseCategory}` : '—'}
                        {d.licenseExpiry && (
                          <><br /><span style={{ color: expired ? 'var(--danger)' : soon ? 'var(--ocre-text)' : undefined, fontWeight: expired || soon ? 600 : 400 }}>
                            {expired ? 'Expiré le ' : 'Valide jusqu’au '}{dateLong(d.licenseExpiry)}
                          </span></>
                        )}
                      </td>
                      <td>
                        {next ? (
                          <Link to={`/reservations/${next.id}`} onClick={(e) => e.stopPropagation()}>
                            {next.number} · {dateShort(next.start)} → {dateShort(next.end)}
                          </Link>
                        ) : <span className="muted">Libre</span>}
                      </td>
                      <td>{d.active ? <span className="badge badge-success">Actif</span> : <span className="badge badge-muted">Inactif</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && <DriverForm id={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function DriverForm({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, store, refresh, toast } = useData();
  const existing = data.drivers.find((d) => d.id === id);
  const [f, setF] = useState<Omit<Driver, 'id' | 'createdAt'>>(
    existing ?? { name: '', phone: '', licenseNumber: null, licenseCategory: null, licenseExpiry: null, active: true, notes: null },
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const txt = (k: 'name' | 'phone' | 'licenseNumber' | 'licenseCategory' | 'notes') => ({
    value: f[k] ?? '',
    onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value || (k === 'name' || k === 'phone' ? '' : null) }),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.name.trim().length < 2) return setError('Indiquez le nom du chauffeur.');
    if (f.phone.replace(/\D/g, '').length < 8) return setError('Indiquez un téléphone valide.');
    setBusy(true);
    try {
      const row = { ...f, name: f.name.trim(), phone: f.phone.trim() };
      if (existing) await store.update('drivers', id, row);
      else await store.insert('drivers', { ...row, createdAt: new Date().toISOString() });
      await refresh();
      toast(existing ? 'Chauffeur mis à jour' : 'Chauffeur ajouté');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={existing ? existing.name : 'Nouveau chauffeur'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">Nom<input required maxLength={120} {...txt('name')} /></label>
          <label className="field">Téléphone<input required type="tel" maxLength={30} {...txt('phone')} /></label>
          <label className="field">Numéro de permis<input maxLength={40} {...txt('licenseNumber')} /></label>
          <label className="field">Catégories du permis<input maxLength={20} placeholder="B, D" {...txt('licenseCategory')} /></label>
          <label className="field">Permis valide jusqu’au<input type="date" value={f.licenseExpiry ?? ''} onChange={(e) => setF({ ...f, licenseExpiry: e.target.value || null })} /></label>
        </div>
        <label className="field">Notes<textarea rows={2} maxLength={500} {...txt('notes')} placeholder="Langues parlées, zones connues…" /></label>
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          Actif (peut être affecté à une réservation)
        </label>
        <span className="hint">Pour un bus ou un minibus, le permis doit couvrir la catégorie D.</span>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy}>{existing ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </form>
    </Modal>
  );
}
