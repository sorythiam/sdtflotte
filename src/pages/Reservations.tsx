import { useBilling } from '../state/useBilling';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, Modal, ReservationBadge } from '../components/ui';
import { createReservation, driverConflict } from '../data/services';
import { vtcOverlap } from '../domain/vtc';
import { dealFor, FORMULAS, fitsPassengers, priceFor, type Price } from '../domain/tariff';
import { dateShort, fromLocalInput, money, time, toLocalInput } from '../domain/format';
import { balanceDue, findConflicts, lateDays } from '../domain/rules';
import type { Formula, ReservationStatus } from '../domain/types';
import { useData } from '../state/DataContext';
import { FlightFields, NO_FLIGHT, type FlightValue } from '../components/FlightFields';
import { flightWarning, suggestedPickup } from '../domain/flight';
import { driverBlocker, driverWarning } from '../domain/drivers';
import { followUps } from '../domain/portal';
import { FollowUp } from './FollowUp';

const filters: [ReservationStatus | 'actives' | 'toutes' | 'suivi', string][] = [
  ['actives', 'En cours et à venir'],
  ['suivi', 'Suivi du jour'],
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
  const [filter, setFilterState] = useState<(typeof filters)[number][0]>(params.get('vue') === 'suivi' ? 'suivi' : 'actives');
  const setFilter = (k: (typeof filters)[number][0]) => {
    setFilterState(k);
    setParams(k === 'suivi' ? { vue: 'suivi' } : {}, { replace: true });
  };
  const todo = followUps(data.reservations, now).length;
  const [q, setQ] = useState('');
  const creating = params.get('nouvelle') === '1';
  const veh = new Map(data.vehicles.map((v) => [v.id, v]));
  const cli = new Map(data.clients.map((c) => [c.id, c]));

  const list = data.reservations
    .filter((r) =>
      filter === 'toutes' || filter === 'suivi' ? true : filter === 'actives' ? r.status === 'en_cours' || r.status === 'reservee' : r.status === filter,
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
          {filter !== 'suivi' && <p className="muted small">{list.length} résultat(s)</p>}
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
              {label}{k === 'suivi' && todo ? ` (${todo})` : ''}
            </button>
          ))}
        </div>
        {filter !== 'suivi' && <label className="field grow" style={{ minWidth: 220 }}>
          <span className="sr-only">Rechercher</span>
          <input type="search" placeholder="Rechercher un contrat, un client, une plaque…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>}
      </div>
      {filter === 'suivi' ? <FollowUp /> : <section className="card">
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
                  const due = r.status === 'annulee' ? 0 : balanceDue(r, data.payments, data.invoices);
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
      </section>}
      {creating && <NewReservation onClose={() => setParams({})} />}
    </>
  );
}

function NewReservation({ onClose }: { onClose: () => void }) {
  const { data, store, refresh, toast, now } = useData();
  const billing = useBilling();
  const nav = useNavigate();
  const defStart = new Date(now);
  defStart.setHours(defStart.getHours() + 1, 0, 0, 0);
  const defEnd = new Date(defStart.getTime() + 3 * 86400000);
  const [formula, setFormula] = useState<Formula>('jour');
  const [start, setStart] = useState(toLocalInput(defStart.toISOString()));
  const [end, setEnd] = useState(toLocalInput(defEnd.toISOString()));
  const [passengers, setPassengers] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [clientId, setClientId] = useState('');
  const [withDriver, setWithDriver] = useState(false);
  const [driverId, setDriverId] = useState('');
  const [missionFees, setMissionFees] = useState('');
  const [fuelIncluded, setFuelIncluded] = useState(false);
  const [itinerary, setItinerary] = useState('');
  const [crossBorder, setCrossBorder] = useState('');
  const [notes, setNotes] = useState('');
  const [flight, setFlight] = useState<FlightValue>(NO_FLIGHT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pkg = data.packages.find((k) => k.id === packageId);
  // Forfait : la fin se déduit de la durée du forfait.
  const sIso = start ? fromLocalInput(start) : '';
  const eIso = formula === 'forfait' ? (sIso && pkg ? new Date(Date.parse(sIso) + pkg.hours * 3600000).toISOString() : '') : end ? fromLocalInput(end) : '';
  const validPeriod = !!sIso && !!eIso && Date.parse(eIso) > Date.parse(sIso);
  const pax = Number(passengers) || 0;
  const vehicle = data.vehicles.find((v) => v.id === vehicleId);
  const driverOn = withDriver || !!vehicle?.driverRequired || formula === 'forfait' || !!flight.transferKind;

  // Véhicules libres sur la période et assez grands pour le groupe.
  const free = useMemo(
    () =>
      data.vehicles
        .filter((v) => !v.outOfService && (formula !== 'forfait' || !pkg || v.category === pkg.category))
        .map((v) => ({
          v,
          busy: validPeriod ? findConflicts(v.id, sIso, eIso, data.reservations, data.maintenances).length > 0 || !!vtcOverlap(v.id, sIso, eIso, data.vtc_contracts) : false,
          small: !fitsPassengers(v, pax, withDriver || !!v.driverRequired || formula === 'forfait'),
        }))
        .sort((a, b) => Number(a.busy || a.small) - Number(b.busy || b.small) || (a.v.seats ?? 0) - (b.v.seats ?? 0) || a.v.category.localeCompare(b.v.category)),
    [data, sIso, eIso, validPeriod, pax, withDriver, formula, pkg],
  );
  const rate = data.rates.find((r) => r.category === vehicle?.category);
  let qt: Price | null = null;
  let priceError: string | null = null;
  const client0 = data.clients.find((c) => c.id === clientId);
  const deal = dealFor(client0, vehicle?.category, sIso || now);
  if (vehicle && validPeriod) {
    try {
      qt = priceFor({ formula, rate, pkg, start: sIso, end: eIso, withDriver: driverOn, missionFees: Number(missionFees) || 0, deal, seasons: data.seasons });
    } catch (e) {
      priceError = (e as Error).message;
    }
  }
  const client = data.clients.find((c) => c.id === clientId);
  const drivers = data.drivers.filter((d) => d.active);
  const driverBusy = (id: string) => (validPeriod ? driverConflict(id, sIso, eIso, data.reservations) : undefined);
  const packages = data.packages.filter((k) => k.active).sort((a, b) => a.label.localeCompare(b.label) || a.price - b.price);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await createReservation(
        store, data,
        {
          vehicleId, clientId, start: sIso, end: eIso, withDriver: driverOn, notes: notes || null, formula, packageId: packageId || null,
          passengers: pax || null, driverId: driverOn ? driverId || null : null, missionFees: Number(missionFees) || 0, fuelIncluded,
          itinerary, crossBorder,
          transferKind: flight.transferKind, flightNumber: flight.flightNumber, flightAt: flight.flightAt ? fromLocalInput(flight.flightAt) : null,
        },
        new Date(), billing,
      );
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
            Formule
            <select value={formula} onChange={(e) => { setFormula(e.target.value as Formula); setVehicleId(''); }}>
              {FORMULAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="field">
            Passagers
            <input type="number" min={1} max={99} inputMode="numeric" value={passengers} onChange={(e) => setPassengers(e.target.value)} placeholder="Nombre de personnes" />
          </label>
        </div>
        {formula === 'forfait' && (
          <label className="field">
            Forfait
            <select required value={packageId} onChange={(e) => { setPackageId(e.target.value); setVehicleId(''); }}>
              <option value="">Choisir un forfait</option>
              {packages.map((k) => <option key={k.id} value={k.id}>{k.label} · {k.category} · {money(k.price)}</option>)}
            </select>
            {packages.length === 0 && <span className="hint">Aucun forfait : créez-les dans Flotte › Tarifs.</span>}
          </label>
        )}
        <FlightFields value={flight} onChange={setFlight}
          onFlightTime={(local, kind) => setStart(toLocalInput(suggestedPickup(kind, fromLocalInput(local))))} />
        <div className="grid-2">
          <label className="field">
            {flight.transferKind ? 'Prise en charge' : 'Départ'}
            <input type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} />
            {sIso && flight.flightAt && flightWarning({ transferKind: flight.transferKind, flightAt: fromLocalInput(flight.flightAt) }, sIso) && (
              <span className="hint" style={{ color: 'var(--ocre-text)' }}>{flightWarning({ transferKind: flight.transferKind, flightAt: fromLocalInput(flight.flightAt) }, sIso)}</span>
            )}
          </label>
          {formula === 'forfait' ? (
            <div className="field">
              Fin prévue
              <span className="small" style={{ padding: '10px 0' }}>{eIso ? `${dateShort(eIso)} à ${time(eIso)} (${pkg?.hours} h)` : '—'}</span>
            </div>
          ) : (
            <label className="field">
              Retour prévu
              <input type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          )}
        </div>
        <label className="field">
          Véhicule
          <select required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Choisir un véhicule disponible</option>
            {free.map(({ v, busy: b, small }) => (
              <option key={v.id} value={v.id} disabled={b || small}>
                {v.category} · {v.brand} {v.model} · {v.plate}
                {v.seats ? ` · ${v.seats} places` : ''}
                {b ? ' — indisponible' : small ? ' — trop petit' : ''}
              </option>
            ))}
          </select>
          <span className="hint">
            {free.filter((f) => !f.busy && !f.small).length} véhicule(s) libre(s){pax ? ` pour ${pax} passager(s)` : ''} sur la période
            {vehicle?.luggage != null ? ` · ${vehicle.luggage} bagages` : ''}
          </span>
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
          {!driverOn && client?.licenseExpiry && validPeriod && Date.parse(client.licenseExpiry) < Date.parse(eIso) && (
            <span className="hint" style={{ color: 'var(--danger)' }}>Le permis expire avant la fin de la location.</span>
          )}
        </label>
        <fieldset className="stack form-group">
          <legend>Chauffeur et voyage</legend>
          <label className="check">
            <input type="checkbox" checked={driverOn} disabled={!!vehicle?.driverRequired || formula === 'forfait' || !!flight.transferKind} onChange={(e) => setWithDriver(e.target.checked)} />
            Avec chauffeur{vehicle?.driverRequired ? ' (obligatoire pour ce véhicule)' : formula === 'forfait' ? ' (inclus dans le forfait)' : ''}
          </label>
          {driverOn && (
            <div className="grid-2">
              <label className="field">
                Chauffeur
                <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                  <option value="">À désigner plus tard</option>
                  {drivers.map((d) => {
                    const b = driverBusy(d.id);
                    const block = validPeriod ? driverBlocker(d, vehicle, sIso, eIso, data.driver_absences, data.vtc_contracts) : null;
                    return (
                      <option key={d.id} value={d.id} disabled={!!b || !!block}>
                        {d.name}{d.licenseCategory ? ` · permis ${d.licenseCategory}` : ''}{b ? ` — pris (${b.number})` : block ? ' — indisponible' : ''}
                      </option>
                    );
                  })}
                </select>
                {(() => {
                  const d = drivers.find((x) => x.id === driverId);
                  const msg = d && validPeriod ? driverBlocker(d, vehicle, sIso, eIso, data.driver_absences, data.vtc_contracts) ?? driverWarning(d, vehicle) : null;
                  return msg ? <span className="hint" style={{ color: 'var(--ocre-text)' }}>{msg}</span> : (
                    <span className="hint">Les chauffeurs pris, absents ou sans le bon permis{vehicle?.seats && vehicle.seats > 9 ? ' (D1 ou D pour ce véhicule)' : ''} sont grisés.</span>
                  );
                })()}
              </label>
              <label className="field">
                Frais de mission (FCFA)
                <input type="number" min={0} inputMode="numeric" value={missionFees} onChange={(e) => setMissionFees(e.target.value)} placeholder="Hébergement, repas hors de la ville" />
              </label>
            </div>
          )}
          <label className="field">
            Itinéraire (facultatif)
            <input value={itinerary} maxLength={500} onChange={(e) => setItinerary(e.target.value)} placeholder="Ex. : Dakar, Lac Rose, Saly, Joal" />
          </label>
          <div className="grid-2">
            <label className="field">
              Sortie du territoire
              <input value={crossBorder} maxLength={120} onChange={(e) => setCrossBorder(e.target.value)} placeholder="Non autorisée (sinon : Gambie, Mali…)" />
            </label>
            <label className="check" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={fuelIncluded} onChange={(e) => setFuelIncluded(e.target.checked)} />
              Carburant inclus dans le prix
            </label>
          </div>
        </fieldset>
        <label className="field">
          Notes (facultatif)
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {qt && (
          <div className="notice">
            <strong>{money(qt.total)}</strong>{' '}
            {formula === 'forfait' ? `forfait ${qt.label}` : formula === 'demi_journee' ? 'pour une demi-journée' : `pour ${qt.days} jour(s) à ${money(qt.dailyRate)}/jour`}
            {qt.missionFees ? `, dont ${money(qt.missionFees)} de frais de mission` : ''} · caution {money(qt.caution)}
            {qt.kmIncluded !== null ? ` · ${qt.kmIncluded} km inclus` : ' · kilométrage non compté'}
            {qt.dealNote && <><br /><span className="small" style={{ color: 'var(--success)', fontWeight: 600 }}>{qt.dealNote}</span></>}
            {qt.seasonNote && <><br /><span className="small" style={{ color: 'var(--ocre-text)', fontWeight: 600 }}>Saison : {qt.seasonNote}</span></>}
          </div>
        )}
        {priceError && <div className="error">{priceError}</div>}
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
