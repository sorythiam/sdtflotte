import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, Modal } from '../components/ui';
import { dateLong, dateShort } from '../domain/format';
import { isActive } from '../domain/rules';
import { ABSENCE_LABEL, driverDay, weekDays, type AbsenceKind } from '../domain/drivers';
import type { Driver } from '../domain/types';
import { useData } from '../state/DataContext';

const wdFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' });

/** Chauffeurs de l'entreprise : coordonnées, permis, missions en cours et à venir. */
export function Drivers() {
  const { data, now, can } = useData();
  const [editing, setEditing] = useState<string | null>(null);
  const editable = can('direction', 'agent');
  const today = now.toISOString().slice(0, 10);
  const list = data.drivers.slice().sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const [params, setParams] = useSearchParams();
  const view = params.get('vue') === 'planning' ? 'planning' : 'liste';

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Chauffeurs</h1>
          <p className="muted small">Affectés aux locations avec chauffeur, aux bus et aux forfaits. Un chauffeur ne peut pas avoir deux missions en même temps.</p>
        </div>
        {editable && <button className="btn btn-primary" onClick={() => setEditing('nouveau')}>Ajouter un chauffeur</button>}
      </header>
      <div className="tabs" role="tablist" aria-label="Affichage" style={{ alignSelf: 'flex-start' }}>
        <button type="button" role="tab" aria-selected={view === 'liste'} onClick={() => setParams({}, { replace: true })}>Liste</button>
        <button type="button" role="tab" aria-selected={view === 'planning'} onClick={() => setParams({ vue: 'planning' }, { replace: true })}>Planning de la semaine</button>
      </div>
      {view === 'planning' ? <DriverWeek onOpen={(id) => editable && setEditing(id)} /> : <section className="card">
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
                  const away = data.driver_absences.filter((a) => a.driverId === d.id && a.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
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
                      <td>
                        {!d.active ? <span className="badge badge-muted">Inactif</span>
                          : away && away.startDate <= today ? <span className="badge badge-warning">{ABSENCE_LABEL[away.kind]} jusqu’au {dateShort(away.endDate)}</span>
                          : <span className="badge badge-success">Actif</span>}
                        {away && away.startDate > today && <><br /><span className="small muted">{ABSENCE_LABEL[away.kind]} du {dateShort(away.startDate)} au {dateShort(away.endDate)}</span></>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>}
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
        <span className="hint">Catégories séparées par des virgules. Au-delà de 9 places (chauffeur compris), il faut D1 (jusqu’à 17 places) ou D : un chauffeur sans la bonne catégorie ne peut pas être affecté.</span>
        {existing && <Absences driverId={existing.id} />}
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy}>{existing ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Absences d'un chauffeur : il ne peut pas être affecté sur ces dates. */
function Absences({ driverId }: { driverId: string }) {
  const { data, store, refresh, toast, now } = useData();
  const today = now.toISOString().slice(0, 10);
  const mine = data.driver_absences.filter((a) => a.driverId === driverId && a.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const [f, setF] = useState<{ kind: AbsenceKind; startDate: string; endDate: string; note: string }>({ kind: 'conge', startDate: today, endDate: today, note: '' });
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    if (!f.startDate || !f.endDate || f.endDate < f.startDate) return setError('La date de fin doit être après la date de début.');
    const clash = data.reservations.find((r) => r.driverId === driverId && isActive(r) && r.start.slice(0, 10) <= f.endDate && r.end.slice(0, 10) >= f.startDate);
    try {
      await store.insert('driver_absences', { driverId, kind: f.kind, startDate: f.startDate, endDate: f.endDate, note: f.note.trim() || null, createdAt: new Date().toISOString() });
      await refresh();
      toast(clash ? `Absence enregistrée. Attention : il a la mission ${clash.number} sur ces dates, changez de chauffeur.` : 'Absence enregistrée');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove(id: string) {
    await store.remove('driver_absences', id);
    await refresh();
  }

  return (
    <fieldset className="stack form-group">
      <legend>Absences (congé, repos, maladie)</legend>
      {mine.length === 0 ? <span className="small muted">Aucune absence prévue.</span> : (
        <ul className="alert-list">
          {mine.map((a) => (
            <li key={a.id} className="alert-item" style={{ borderLeftColor: 'var(--ocre)' }}>
              <strong>{ABSENCE_LABEL[a.kind]} du {dateShort(a.startDate)} au {dateShort(a.endDate)}</strong>
              {a.note && <span className="small muted">{a.note}</span>}
              <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => remove(a.id)}>Supprimer</button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid-2">
        <label className="field">Motif
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AbsenceKind })}>
            {(Object.keys(ABSENCE_LABEL) as AbsenceKind[]).map((k) => <option key={k} value={k}>{ABSENCE_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="field">Note (facultatif)<input value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <label className="field">Du<input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
        <label className="field">Au<input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
      </div>
      <ErrorBox error={error} />
      <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={add}>Ajouter l’absence</button>
    </fieldset>
  );
}

/** Planning de la semaine : une ligne par chauffeur, une case par jour (mission, absence ou libre). */
function DriverWeek({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, now } = useData();
  const [offset, setOffset] = useState(0);
  const ref = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset * 7);
  const days = weekDays(ref);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const drivers = data.drivers.filter((d) => d.active).sort((a, b) => a.name.localeCompare(b.name));
  const plate = (id: string) => data.vehicles.find((v) => v.id === id)?.plate ?? '';
  const grid = `minmax(150px, 1.4fr) repeat(7, minmax(92px, 1fr))`;

  return (
    <section className="card stack" aria-label="Planning des chauffeurs">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>Semaine du {dateShort(days[0])} au {dateShort(days[6])}</strong>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <button type="button" className="btn btn-sm" aria-label="Semaine précédente" onClick={() => setOffset(offset - 1)}>←</button>
          <button type="button" className="btn btn-sm" onClick={() => setOffset(0)}>Cette semaine</button>
          <button type="button" className="btn btn-sm" aria-label="Semaine suivante" onClick={() => setOffset(offset + 1)}>→</button>
        </div>
      </div>
      {drivers.length === 0 ? <Empty>Aucun chauffeur actif.</Empty> : (
        <div className="table-wrap">
          <div className="gantt" style={{ minWidth: 820 }}>
            <div className="gantt-row gantt-head" style={{ gridTemplateColumns: grid }}>
              <span />
              {days.map((d) => <span key={d} className={d === today ? 'today' : undefined}>{wdFmt.format(new Date(d + 'T12:00:00'))}</span>)}
            </div>
            {drivers.map((d) => (
              <div key={d.id} className="gantt-row" style={{ gridTemplateColumns: grid }}>
                <button type="button" className="link-btn" style={{ textAlign: 'left', fontWeight: 600 }} onClick={() => onOpen(d.id)}>{d.name}</button>
                {days.map((day) => {
                  const st = driverDay(d.id, day, data.reservations, data.driver_absences, data.vtc_contracts);
                  return st.kind === 'mission' ? (
                    <Link key={day} to={`/reservations/${st.reservation.id}`} className="drv-cell drv-mission" title={`${st.reservation.number} · ${plate(st.reservation.vehicleId)}`}>
                      {st.reservation.number.slice(-4)}<br /><span>{st.reservation.flightNumber ?? plate(st.reservation.vehicleId)}</span>
                    </Link>
                  ) : st.kind === 'vtc' ? (
                    <Link key={day} to={`/vtc/${st.contract.id}`} className="drv-cell drv-vtc">VTC<br /><span>{st.contract.number.slice(-4)}</span></Link>
                  ) : st.kind === 'absence' ? (
                    <span key={day} className="drv-cell drv-absence" title={st.absence.note ?? undefined}>{ABSENCE_LABEL[st.absence.kind]}</span>
                  ) : (
                    <span key={day} className="drv-cell drv-free">Libre</span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>Cliquez sur un chauffeur pour ajouter une absence, sur une mission pour l’ouvrir.</p>
    </section>
  );
}
