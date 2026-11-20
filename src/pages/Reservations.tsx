import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, Modal, ReservationBadge } from '../components/ui';
import { createReservation } from '../data/services';
import { dateShort, fromLocalInput, money, time, toLocalInput } from '../domain/format';
import { balanceDue, findConflicts, lateDays, quote } from '../domain/rules';
import type { ReservationStatus } from '../domain/types';
import { useData } from '../state/DataContext';

const filters: [ReservationStatus | 'actives' | 'toutes', string][] = [
  ['actives', 'En cours et à venir'],
  ['en_cours', 'En cours'],
  ['reservee', 'À venir'],
  ['terminee', 'Terminées'],
  ['annulee', 'Annulées'],
  ['toutes', 'Toutes'],
];

export function Reservations() {
  const { data, now, can } = useData();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<(typeof filters)[number][0]>('actives');
  const [q, setQ] = useState('');
  const creating = params.get('nouvelle') === '1';
  const veh = new Map(data.vehicles.map((v) => [v.id, v]));
  const cli = new Map(data.clients.map((c) => [c.id, c]));

  const list = data.reservations
    .filter((r) =>
      filter === 'toutes' ? true : filter === 'actives' ? r.status === 'en_cours' || r.status === 'reservee' : r.status === filter,
    )
    .filter((r) => {
      if (!q) return true;
      const s = `${r.number} ${cli.get(r.clientId)?.name} ${veh.get(r.vehicleId)?.plate} ${veh.get(r.vehicleId)?.model}`.toLowerCase();
      return s.includes(q.toLowerCase());
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Réservations et contrats</h1>
          <p className="muted small">{list.length} résultat(s)</p>
        </div>
        {can('direction', 'agent') && (
          <button className="btn btn-primary" onClick={() => setParams({ nouvelle: '1' })}>
            Nouvelle réservation
          </button>
        )}
      </header>
      <div className="row">
        <div className="tabs" role="group" aria-label="Filtre">
          {filters.map(([k, label]) => (
            <button key={k} type="button" aria-selected={filter === k} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        <label className="field grow" style={{ minWidth: 220 }}>
          <span className="sr-only">Rechercher</span>
          <input type="search" placeholder="Rechercher un contrat, un client, une plaque…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <section className="card">
        {list.length === 0 ? (
          <Empty>Aucune réservation pour ce filtre.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Contrat</th>
                  <th>Client</th>
                  <th>Véhicule</th>
                  <th>Période</th>
                  <th className="right">Total</th>
                  <th className="right">Reste dû</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const v = veh.get(r.vehicleId);
                  const due = r.status === 'annulee' ? 0 : balanceDue(r, data.payments);
                  return (
                    <tr key={r.id} className="clickable" onClick={() => nav(`/reservations/${r.id}`)}>
                      <td className="num"><strong>{r.number}</strong></td>
                      <td>{cli.get(r.clientId)?.name ?? '—'}</td>
                      <td>
                        {v ? `${v.brand} ${v.model}` : '—'}
                        <br />
                        <span className="muted">{v?.plate}</span>
                      </td>
                      <td>
                        {dateShort(r.start)} {time(r.start)} → {dateShort(r.end)} {time(r.end)}
                      </td>
                      <td className="right num">{money(r.total)}</td>
                      <td className="right num" style={{ color: due ? 'var(--ocre-text)' : undefined, fontWeight: due ? 600 : 400 }}>
                        {due ? money(due) : 'Soldé'}
                      </td>
                      <td>
                        <ReservationBadge status={r.status} late={lateDays(r, now)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {creating && <NewReservation onClose={() => setParams({})} />}
    </>
  );
}

function NewReservation({ onClose }: { onClose: () => void }) {
  const { data, store, refresh, toast, now } = useData();
  const nav = useNavigate();
  const defStart = new Date(now);
  defStart.setHours(defStart.getHours() + 1, 0, 0, 0);
  const defEnd = new Date(defStart.getTime() + 3 * 86400000);
  const [start, setStart] = useState(toLocalInput(defStart.toISOString()));
  const [end, setEnd] = useState(toLocalInput(defEnd.toISOString()));
  const [vehicleId, setVehicleId] = useState('');
  const [clientId, setClientId] = useState('');
  const [withDriver, setWithDriver] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sIso = start ? fromLocalInput(start) : '';
  const eIso = end ? fromLocalInput(end) : '';
  const validPeriod = sIso && eIso && Date.parse(eIso) > Date.parse(sIso);

  // Seuls les véhicules libres sur toute la période sont proposés.
  const free = useMemo(
    () =>
      data.vehicles
        .filter((v) => !v.outOfService)
        .map((v) => ({ v, busy: validPeriod ? findConflicts(v.id, sIso, eIso, data.reservations, data.maintenances).length > 0 : false }))
        .sort((a, b) => Number(a.busy) - Number(b.busy) || a.v.category.localeCompare(b.v.category)),
    [data, sIso, eIso, validPeriod],
  );
  const vehicle = data.vehicles.find((v) => v.id === vehicleId);
  const rate = data.rates.find((r) => r.category === vehicle?.category);
  const qt = rate && validPeriod ? quote(rate, sIso, eIso, withDriver) : null;
  const client = data.clients.find((c) => c.id === clientId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await createReservation(store, data, { vehicleId, clientId, start: sIso, end: eIso, withDriver, notes: notes || null });
      await refresh();
      toast(`Réservation ${r.number} créée`);
      nav(`/reservations/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nouvelle réservation" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">
            Départ
            <input type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="field">
            Retour prévu
            <input type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <label className="field">
          Véhicule
          <select required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Choisir un véhicule disponible</option>
            {free.map(({ v, busy: b }) => (
              <option key={v.id} value={v.id} disabled={b}>
                {v.category} · {v.brand} {v.model} · {v.plate}
                {b ? ' — indisponible' : ''}
              </option>
            ))}
          </select>
          <span className="hint">{free.filter((f) => !f.busy).length} véhicule(s) libre(s) sur la période</span>
        </label>
        <label className="field">
          Client
          <select required value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Choisir un client</option>
            {data.clients
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.id} value={c.id} disabled={c.score === 'blacklist'}>
                  {c.name}
                  {c.score === 'blacklist' ? ' — blacklisté' : c.score === 'surveiller' ? ' — à surveiller' : ''}
                </option>
              ))}
          </select>
          {client?.score === 'surveiller' && <span className="hint" style={{ color: 'var(--ocre-text)' }}>Client à surveiller : vérifiez la caution avant la remise des clés.</span>}
          {client?.licenseExpiry && validPeriod && Date.parse(client.licenseExpiry) < Date.parse(eIso) && (
            <span className="hint" style={{ color: 'var(--danger)' }}>Le permis expire avant la fin de la location.</span>
          )}
        </label>
        <label className="check">
          <input type="checkbox" checked={withDriver} onChange={(e) => setWithDriver(e.target.checked)} />
          Avec chauffeur
        </label>
        <label className="field">
          Notes (facultatif)
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {qt && (
          <div className="notice">
            <strong>{money(qt.total)}</strong> pour {qt.days} jour(s) à {money(qt.dailyRate)}/jour · caution {money(qt.caution)} ·{' '}
            {qt.kmIncluded} km inclus
          </div>
        )}
        {vehicle && !rate && <div className="error">Aucun tarif pour la catégorie {vehicle.category}. Ajoutez-le dans Tarifs.</div>}
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={busy || !qt}>
            Créer la réservation
          </button>
        </div>
      </form>
    </Modal>
  );
}
