import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lightbox, shrinkPhoto } from '../components/photos';
import { Empty, ReservationBadge, VehicleBadge } from '../components/ui';
import { dateLong, dateShort, money, num } from '../domain/format';
import { expiryAlerts, vehicleStatusAt } from '../domain/rules';
import type { VehicleDocSlot } from '../domain/types';
import { useData } from '../state/DataContext';
import { inVtc } from '../domain/vtc';
import { useSignedUrls } from '../state/useSignedUrls';
import { VehicleForm } from './Vehicles';

const DOCS: { slot: VehicleDocSlot; label: string }[] = [
  { slot: 'carteGrise', label: 'Carte grise' },
  { slot: 'assurance', label: 'Attestation d’assurance' },
  { slot: 'visiteTechnique', label: 'Visite technique' },
  { slot: 'autre', label: 'Autre document' },
];
const fuelText = { diesel: 'Diesel', essence: 'Essence', hybride: 'Hybride', electrique: 'Électrique' } as const;

/** Fiche véhicule : identité, documents scannés, historique des locations, entretiens et dépenses. */
export function VehicleDetail() {
  const { id } = useParams();
  const { data, now, can, store, refresh, toast } = useData();
  const v = data.vehicles.find((x) => x.id === id);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<VehicleDocSlot | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const seeDocs = can('direction', 'agent');
  const docPaths = useMemo(() => Object.values(v?.documents ?? {}).filter(Boolean) as string[], [v?.documents]);
  const urls = useSignedUrls(seeDocs ? docPaths : [], 'client');
  if (!v) {
    return (
      <div className="card">
        <p>Véhicule introuvable.</p>
        <Link to="/vehicules">Retour aux véhicules</Link>
      </div>
    );
  }
  const editable = can('direction', 'agent', 'mecanicien');
  const rentals = data.reservations.filter((r) => r.vehicleId === v.id).sort((a, b) => b.start.localeCompare(a.start));
  const maint = data.maintenances.filter((m) => m.vehicleId === v.id).sort((a, b) => b.start.localeCompare(a.start));
  const expenses = data.expenses.filter((e) => e.vehicleId === v.id).sort((a, b) => b.date.localeCompare(a.date));
  const clients = new Map(data.clients.map((c) => [c.id, c.name]));
  const revenue = rentals.filter((r) => r.status === 'terminee' || r.status === 'en_cours').reduce((s, r) => s + r.total + r.fees, 0);
  const costs = maint.reduce((s, m) => s + m.cost, 0) + expenses.reduce((s, e) => s + e.amount, 0);
  const alerts = expiryAlerts([v], now, 30);
  const docs = v.documents ?? {};
  const shown = DOCS.filter((d) => docs[d.slot]);

  async function upload(slot: VehicleDocSlot, file: File | undefined) {
    if (!file) return;
    setBusy(slot);
    try {
      const path = await store.uploadClientDocument(await shrinkPhoto(file, 1800, 0.85), `vehicule-${v!.id}`);
      const old = docs[slot];
      await store.update('vehicles', v!.id, { documents: { ...docs, [slot]: path } });
      if (old) await store.deleteClientDocument(old).catch(() => undefined);
      await refresh();
      toast('Document enregistré');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <span className="small muted"><Link to="/vehicules">Véhicules</Link> › {v.plate}</span>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <h1>{v.brand} {v.model}</h1>
            {inVtc(v.id, data.vtc_contracts, now.toISOString().slice(0, 10)) ? <Link className="badge" to={`/vtc/${inVtc(v.id, data.vtc_contracts, now.toISOString().slice(0, 10))!.id}`} onClick={(e) => e.stopPropagation()}>En VTC</Link> : <VehicleBadge status={vehicleStatusAt(v, now, data.reservations, data.maintenances)} />}
          </div>
          <p className="small muted">
            {v.plate} · {v.category}{v.year ? ` · ${v.year}` : ''} · {fuelText[v.fuel]} · {num(v.mileage)} km
          </p>
        </div>
        {editable && <button className="btn" onClick={() => setEditing(true)}>Modifier la fiche</button>}
      </header>

      <div className="cols">
        <div className="col-2 stack" style={{ gap: 'var(--space-6)' }}>
          <section className="card" aria-labelledby="ident">
            <h2 id="ident">Identité et capacité</h2>
            <dl className="facts">
              <div><dt>Numéro de châssis</dt><dd>{v.vin ?? '—'}</dd></div>
              <div><dt>Places assises</dt><dd>{v.seats ? `${v.seats}, chauffeur compris` : '—'}</dd></div>
              <div><dt>Bagages</dt><dd>{v.luggage ?? '—'}</dd></div>
              <div><dt>Chauffeur</dt><dd>{v.driverRequired ? 'Toujours avec chauffeur' : 'Avec ou sans chauffeur'}</dd></div>
              <div><dt>Assurance</dt><dd>{v.insuranceExpiry ? `jusqu’au ${dateLong(v.insuranceExpiry)}` : '—'}</dd></div>
              <div><dt>Visite technique</dt><dd>{v.inspectionExpiry ? `jusqu’au ${dateLong(v.inspectionExpiry)}` : '—'}</dd></div>
              <div><dt>Vignette</dt><dd>{v.vignetteExpiry ? `jusqu’au ${dateLong(v.vignetteExpiry)}` : '—'}</dd></div>
            </dl>
            {alerts.length > 0 && (
              <ul className="issue-list">
                {alerts.map((a) => <li key={a.document}>{a.document} {a.daysLeft < 0 ? 'expirée' : `expire dans ${a.daysLeft} jour(s)`}</li>)}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="docs">
            <h2 id="docs">Documents</h2>
            {!seeDocs ? (
              <span className="small muted">Les scans sont réservés à l’accueil et à la direction.</span>
            ) : (
              <div className="doc-grid">
                {DOCS.map((d) => {
                  const p = docs[d.slot];
                  const k = shown.findIndex((x) => x.slot === d.slot);
                  return (
                    <div key={d.slot} className="doc-slot">
                      {p && urls[p] ? (
                        <button type="button" className="doc-thumb" style={{ padding: 0, border: 0 }} onClick={() => setViewer(k)}>
                          <img src={urls[p]} alt={d.label} />
                        </button>
                      ) : (
                        <span className="doc-empty muted small">{busy === d.slot ? 'Envoi…' : 'Aucun scan'}</span>
                      )}
                      <strong className="small">{d.label}</strong>
                      {editable && (
                        <label className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>
                          {p ? 'Remplacer' : 'Photographier ou choisir'}
                          <input type="file" accept="image/*" className="sr-only" disabled={!!busy} onChange={(e) => { void upload(d.slot, e.target.files?.[0]); e.target.value = ''; }} />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="locs">
            <h2 id="locs">Locations ({rentals.length})</h2>
            {rentals.length === 0 ? (
              <Empty>Aucune location.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Contrat</th><th>Client</th><th>Période</th><th className="right">Montant</th><th>Statut</th></tr></thead>
                  <tbody>
                    {rentals.slice(0, 15).map((r) => (
                      <tr key={r.id}>
                        <td><Link to={`/reservations/${r.id}`}>{r.number}</Link></td>
                        <td>{clients.get(r.clientId) ?? '—'}</td>
                        <td>{dateShort(r.start)} → {dateShort(r.end)}</td>
                        <td className="right num">{money(r.total + r.fees)}</td>
                        <td><ReservationBadge status={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="col-1 stack" style={{ gap: 'var(--space-6)' }}>
          <section className="card" aria-labelledby="renta">
            <h2 id="renta">Rentabilité</h2>
            <dl className="facts">
              <div><dt>Chiffre d’affaires</dt><dd>{money(revenue)}</dd></div>
              <div><dt>Entretiens et dépenses</dt><dd>{money(costs)}</dd></div>
              <div><dt>Marge</dt><dd style={{ color: revenue - costs >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(revenue - costs)}</dd></div>
            </dl>
            <span className="hint">Locations en cours et terminées, frais au retour compris.</span>
          </section>

          <section className="card" aria-labelledby="entr">
            <h2 id="entr">Entretiens</h2>
            {maint.length === 0 ? <Empty>Aucun entretien.</Empty> : (
              <ul className="alert-list">
                {maint.slice(0, 10).map((m) => (
                  <li key={m.id} className="alert-item" style={{ borderLeftColor: 'var(--atlantique)' }}>
                    <strong>{m.label}</strong>
                    <span className="small muted">{dateShort(m.start)} → {dateShort(m.end)} · {money(m.cost)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="dep">
            <h2 id="dep">Dépenses</h2>
            {expenses.length === 0 ? <Empty>Aucune dépense.</Empty> : (
              <ul className="alert-list">
                {expenses.slice(0, 10).map((e) => (
                  <li key={e.id} className="alert-item" style={{ borderLeftColor: 'var(--ocre)' }}>
                    <strong>{e.label ?? e.kind}</strong>
                    <span className="small muted">{dateShort(e.date)} · {money(e.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {editing && <VehicleForm id={v.id} onClose={() => setEditing(false)} />}
      {viewer !== null && viewer >= 0 && (
        <Lightbox photos={shown.map((d) => urls[docs[d.slot]!]).filter(Boolean)} start={viewer} title={`Documents ${v.plate}`} onClose={() => setViewer(null)} />
      )}
    </>
  );
}
