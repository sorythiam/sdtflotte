import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, Modal } from '../components/ui';
import { buildQuote, quoteState, quoteStateLabel, type QuoteState } from '../domain/quotes';
import { FORMULAS } from '../domain/tariff';
import { dateShort, fromLocalInput, money, toLocalInput } from '../domain/format';
import { findConflicts } from '../domain/rules';
import { vtcOverlap } from '../domain/vtc';
import type { Formula } from '../domain/types';
import { useData } from '../state/DataContext';

const filters: [QuoteState | 'ouverts' | 'tous', string][] = [
  ['ouverts', 'En attente'],
  ['accepte', 'Acceptés'],
  ['converti', 'Réservés'],
  ['refuse', 'Refusés'],
  ['expire', 'Expirés'],
  ['tous', 'Tous'],
];

export function Quotes() {
  const { data, now, can } = useData();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<(typeof filters)[number][0]>('ouverts');
  const creating = params.get('nouveau') === '1';
  const cli = new Map(data.clients.map((c) => [c.id, c]));
  const list = data.quotes
    .map((q) => ({ q, st: quoteState(q, now) }))
    .filter(({ st }) => (filter === 'tous' ? true : filter === 'ouverts' ? st === 'envoye' || st === 'accepte' : st === filter))
    .sort((a, b) => b.q.createdAt.localeCompare(a.q.createdAt));
  const open = data.quotes.filter((q) => ['envoye', 'accepte'].includes(quoteState(q, now)));
  const decided = data.quotes.filter((q) => ['converti', 'refuse', 'expire'].includes(quoteState(q, now)));
  const won = decided.filter((q) => q.status === 'converti').length;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Devis</h1>
          <p className="muted small">
            {open.length} en attente pour {money(open.reduce((s, q) => s + q.total, 0))}
            {decided.length > 0 && ` · taux de transformation ${Math.round((won / decided.length) * 100)} %`}
          </p>
        </div>
        {can('direction', 'agent') && <button className="btn btn-primary" onClick={() => setParams({ nouveau: '1' })}>Nouveau devis</button>}
      </header>
      <div className="tabs" role="group" aria-label="Filtre">
        {filters.map(([k, label]) => (
          <button key={k} type="button" aria-selected={filter === k} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>
      <section className="card">
        {list.length === 0 ? (
          <Empty>Aucun devis pour ce filtre. Un devis ne bloque aucun véhicule : faites-en un dès qu’une agence ou une ONG demande un prix.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Devis</th><th>Client</th><th>Demande</th><th>Période</th><th className="right">Montant HT</th><th>Valable jusqu’au</th><th>Statut</th></tr></thead>
              <tbody>
                {list.map(({ q, st }) => (
                  <tr key={q.id} className="clickable" onClick={() => nav(`/devis/${q.id}`)}>
                    <td className="num"><strong>{q.number}</strong></td>
                    <td>{cli.get(q.clientId)?.name ?? '—'}</td>
                    <td>{q.quantity > 1 ? `${q.quantity} × ` : ''}{q.category}{q.packageLabel ? ` · ${q.packageLabel}` : ''}</td>
                    <td>{dateShort(q.start)}{q.formula === 'jour' ? ` → ${dateShort(q.end)}` : ''}</td>
                    <td className="right num">{money(q.total)}</td>
                    <td>{dateShort(q.validUntil + 'T12:00:00')}</td>
                    <td><span className={`badge ${quoteStateLabel[st][1]}`}>{quoteStateLabel[st][0]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {creating && <NewQuote onClose={() => setParams({})} />}
    </>
  );
}

function NewQuote({ onClose }: { onClose: () => void }) {
  const { data, store, refresh, toast, now, session } = useData();
  const nav = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const defStart = new Date(now.getTime() + 7 * 86400000);
  defStart.setHours(9, 0, 0, 0);
  const [clientId, setClientId] = useState(params.get('client') ?? '');
  const [category, setCategory] = useState(data.rates[0]?.category ?? '');
  const [quantity, setQuantity] = useState('1');
  const [formula, setFormula] = useState<Formula>('jour');
  const [packageId, setPackageId] = useState('');
  const [start, setStart] = useState(toLocalInput(defStart.toISOString()));
  const [end, setEnd] = useState(toLocalInput(new Date(defStart.getTime() + 3 * 86400000).toISOString()));
  const [withDriver, setWithDriver] = useState(false);
  const [passengers, setPassengers] = useState('');
  const [missionFees, setMissionFees] = useState('');
  const [fuelIncluded, setFuelIncluded] = useState(false);
  const [itinerary, setItinerary] = useState('');
  const [crossBorder, setCrossBorder] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pkg = data.packages.find((k) => k.id === packageId);
  const sIso = start ? fromLocalInput(start) : '';
  const eIso = formula === 'forfait' ? (sIso && pkg ? new Date(Date.parse(sIso) + pkg.hours * 3600000).toISOString() : '') : end ? fromLocalInput(end) : '';
  const driverRequired = data.vehicles.some((v) => v.category === category && v.driverRequired) && data.vehicles.filter((v) => v.category === category).every((v) => v.driverRequired);
  const driverOn = withDriver || driverRequired || formula === 'forfait';
  const packages = data.packages.filter((k) => k.active && k.category === category);
  const input = {
    clientId, category, quantity: Number(quantity) || 0, formula, packageId: packageId || null, start: sIso, end: eIso, withDriver: driverOn,
    passengers: Number(passengers) || null, missionFees: Number(missionFees) || 0, fuelIncluded, itinerary, crossBorder,
    validUntil: validUntil || null, notes, driverRequired,
  };
  let preview: ReturnType<typeof buildQuote> | null = null;
  let previewError: string | null = null;
  if (clientId && category && sIso && eIso) {
    try {
      preview = buildQuote(input, data, now, session?.userEmail ?? null);
    } catch (e) {
      previewError = (e as Error).message;
    }
  }
  const freeCount = useMemo(() => {
    if (!sIso || !eIso || Date.parse(eIso) <= Date.parse(sIso)) return null;
    return data.vehicles.filter((v) => v.category === category && !v.outOfService && findConflicts(v.id, sIso, eIso, data.reservations, data.maintenances).length === 0 && !vtcOverlap(v.id, sIso, eIso, data.vtc_contracts)).length;
  }, [data, category, sIso, eIso]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const q = buildQuote(input, data, new Date(), session?.userEmail ?? null);
      const created = await store.insert('quotes', q);
      await refresh();
      toast(`Devis ${created.number} créé`);
      nav(`/devis/${created.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nouveau devis" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          Client
          <select required value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Choisir un client</option>
            {data.clients.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
              <option key={c.id} value={c.id} disabled={c.score === 'blacklist'}>{c.name}{c.score === 'blacklist' ? ' — blacklisté' : ''}</option>
            ))}
          </select>
          <span className="hint">Nouveau prospect ? Créez d’abord sa fiche dans Clients (nom et téléphone suffisent).</span>
        </label>
        <div className="grid-2">
          <label className="field">
            Catégorie
            <select value={category} onChange={(e) => { setCategory(e.target.value); setPackageId(''); }}>
              {data.rates.map((r) => <option key={r.id}>{r.category}</option>)}
            </select>
          </label>
          <label className="field">
            Nombre de véhicules
            <input type="number" min={1} max={50} required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            {freeCount !== null && <span className="hint" style={freeCount < (Number(quantity) || 1) ? { color: 'var(--danger)' } : undefined}>{freeCount} {category} libre(s) sur la période aujourd’hui</span>}
          </label>
        </div>
        <div className="grid-2">
          <label className="field">
            Formule
            <select value={formula} onChange={(e) => setFormula(e.target.value as Formula)}>
              {FORMULAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="field">
            Passagers (au total)
            <input type="number" min={1} max={999} value={passengers} onChange={(e) => setPassengers(e.target.value)} />
          </label>
        </div>
        {formula === 'forfait' && (
          <label className="field">
            Forfait
            <select required value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              <option value="">Choisir un forfait</option>
              {packages.map((k) => <option key={k.id} value={k.id}>{k.label} · {money(k.price)}</option>)}
            </select>
            {packages.length === 0 && <span className="hint">Aucun forfait pour la catégorie {category}.</span>}
          </label>
        )}
        <div className="grid-2">
          <label className="field">Départ<input type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
          {formula !== 'forfait' && <label className="field">Retour<input type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} /></label>}
        </div>
        <fieldset className="stack form-group">
          <legend>Chauffeur et voyage</legend>
          <label className="check">
            <input type="checkbox" checked={driverOn} disabled={driverRequired || formula === 'forfait'} onChange={(e) => setWithDriver(e.target.checked)} />
            Avec chauffeur{driverRequired ? ' (obligatoire pour cette catégorie)' : formula === 'forfait' ? ' (inclus)' : ''}
          </label>
          {driverOn && (
            <label className="field">Frais de mission par véhicule (FCFA)<input type="number" min={0} value={missionFees} onChange={(e) => setMissionFees(e.target.value)} placeholder="Hébergement, repas hors de la ville" /></label>
          )}
          <label className="field">Itinéraire<input value={itinerary} maxLength={500} onChange={(e) => setItinerary(e.target.value)} placeholder="Ex. : Dakar, Lompoul, Saint-Louis" /></label>
          <div className="grid-2">
            <label className="field">Sortie du territoire<input value={crossBorder} maxLength={120} onChange={(e) => setCrossBorder(e.target.value)} placeholder="Non autorisée" /></label>
            <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={fuelIncluded} onChange={(e) => setFuelIncluded(e.target.checked)} />Carburant inclus</label>
          </div>
        </fieldset>
        <div className="grid-2">
          <label className="field">Valable jusqu’au<input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /><span className="hint">Par défaut : 15 jours</span></label>
          <label className="field">Notes pour le client<input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
        {preview && (
          <div className="notice">
            <strong>{money(preview.total)} HT</strong>
            {preview.quantity > 1 && ` (${preview.quantity} × ${money(preview.unitTotal)})`}
            {preview.formula === 'jour' && ` · ${preview.detail.days} jour(s)`} · caution {money(preview.caution)} par véhicule
            {preview.detail.dealNote && <><br /><span className="small" style={{ color: 'var(--success)', fontWeight: 600 }}>{preview.detail.dealNote}</span></>}
            {preview.detail.seasonNote && <><br /><span className="small" style={{ color: 'var(--ocre-text)', fontWeight: 600 }}>Saison : {preview.detail.seasonNote}</span></>}
          </div>
        )}
        {previewError && <div className="error">{previewError}</div>}
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || !preview}>Créer le devis</button>
        </div>
      </form>
    </Modal>
  );
}

