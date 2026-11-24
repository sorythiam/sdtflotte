import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ReceiptsModal, VtcCash, VtcToday } from './VtcTools';
import { Empty, ErrorBox, Modal } from '../components/ui';
import { whatsappLink } from '../domain/booking';
import { money } from '../domain/format';
import { isActive, overlaps } from '../domain/rules';
import type { PaymentMethod, VtcContract, VtcFormula, VtcPayment } from '../domain/types';
import { DAYS_FR, defaultCharges, nextVtcNumber, PLATFORMS, regularityGrade, reminderText, VTC_CHARGES, vtcBalance } from '../domain/vtc';
import { useData } from '../state/DataContext';
import { methodLabel } from './ReservationDetail';

/** Chauffeurs VTC : l'écran du matin du propriétaire. */
export function Vtc() {
  const { data, now, can, session } = useData();
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [params, setParams] = useSearchParams();
  const view = (params.get('vue') ?? 'jour') as 'jour' | 'contrats' | 'caisse';
  const go = useNavigate();
  const editable = can('direction', 'agent');
  const rows = useMemo(
    () =>
      data.vtc_contracts
        .map((c) => ({ c, b: vtcBalance(c, data.vtc_payments, data.expenses, now, data.vtc_adjustments), v: data.vehicles.find((x) => x.id === c.vehicleId), d: data.drivers.find((x) => x.id === c.driverId) }))
        .sort((x, y) => Number(x.c.status !== 'actif') - Number(y.c.status !== 'actif') || y.b.balance - x.b.balance),
    [data, now],
  );
  const active = rows.filter((r) => r.c.status === 'actif' || r.c.status === 'suspendu');
  const list = showAll ? rows : active;
  const dueToday = active.reduce((s, r) => s + r.b.todayDue, 0);
  const paidToday = active.reduce((s, r) => s + r.b.paidToday, 0);
  const owed = active.reduce((s, r) => s + Math.max(0, r.b.balance), 0);
  const late = active.filter((r) => r.b.daysBehind >= 2).length;
  const owner = session!.org.name;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Chauffeurs VTC</h1>
          <p className="muted small">Véhicules confiés à des chauffeurs contre un versement chaque jour travaillé, en location simple ou en location-vente.</p>
        </div>
        {editable && <button className="btn btn-primary" onClick={() => setCreating(true)}>Nouveau contrat VTC</button>}
      </header>

      <div className="tabs" role="tablist" aria-label="Vues">
        {([['jour', 'Point du jour'], ['contrats', 'Contrats'], ['caisse', 'Caisse']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setParams(k === 'jour' ? {} : { vue: k })}>{l}</button>
        ))}
      </div>

      {view === 'jour' && <VtcToday />}
      {view === 'caisse' && <VtcCash />}
      {view === 'contrats' && (<>

      <div className="kpis">
        <div className="card kpi"><span className="kpi-label">Attendu aujourd’hui</span><span className="kpi-value">{money(dueToday)}</span><span className="small muted">{active.filter((r) => r.b.todayDue > 0).length} chauffeur(s) au travail</span></div>
        <div className="card kpi"><span className="kpi-label">Reçu aujourd’hui</span><span className="kpi-value" style={{ color: paidToday >= dueToday && dueToday > 0 ? 'var(--success)' : undefined }}>{money(paidToday)}</span><span className="small muted">{dueToday ? `${Math.round((paidToday / dueToday) * 100)} % de l’attendu` : 'jour de repos'}</span></div>
        <div className="card kpi"><span className="kpi-label">Reste dû par les chauffeurs</span><span className="kpi-value" style={{ color: owed ? 'var(--ocre-text)' : undefined }}>{money(owed)}</span><span className="small muted">{late} chauffeur(s) en retard de 2 jours ou plus</span></div>
      </div>

      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <h2>Contrats</h2>
          {rows.length > active.length && (
            <label className="check"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Voir aussi les contrats terminés</label>
          )}
        </div>
        {list.length === 0 ? (
          <Empty>Aucun contrat VTC. Confiez un véhicule à un chauffeur pour suivre ses versements jour par jour.</Empty>
        ) : (
          <>
          {/* Téléphone : une carte par chauffeur */}
          <ul className="vtc-cards">
            {list.map(({ c, b, v, d }) => (
              <li key={c.id}>
                <Link to={`/vtc/${c.id}`} className="vtc-card">
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <strong>{d?.name ?? '—'}</strong>
                    <span style={{ color: b.balance > 0 ? 'var(--ocre-text)' : 'var(--success)', fontWeight: 700 }}>{b.balance > 0 ? money(b.balance) : b.balance < 0 ? `+${money(-b.balance)}` : 'À jour'}</span>
                  </div>
                  <span className="small muted">{v ? `${v.model} ${v.plate}` : ''} · {money(c.dailyAmount)}/jour{b.daysBehind > 0 ? ` · ${b.daysBehind} j de retard` : ''}{b.progress !== null ? ` · payé à ${Math.round(b.progress * 100)} %` : ''}</span>
                </Link>
                <div className="row" style={{ gap: 6 }}>
                  {can('direction', 'agent', 'comptable') && c.status !== 'termine' && c.status !== 'transfere' && <button className="btn btn-sm btn-primary" onClick={() => setPaying(c.id)}>Versement</button>}
                  {b.balance > 0 && d && <a className="btn btn-sm" href={whatsappLink(d.phone, reminderText(d.name, v?.plate ?? '', b, owner))} target="_blank" rel="noreferrer">Relancer</a>}
                </div>
              </li>
            ))}
          </ul>
          <div className="table-wrap vtc-table">
            <table className="data">
              <thead><tr><th>Chauffeur</th><th>Véhicule</th><th className="right">Par jour</th><th>Aujourd’hui</th><th className="right">Solde</th><th>Régularité</th><th /></tr></thead>
              <tbody>
                {list.map(({ c, b, v, d }) => {
                  const [grade, cls] = regularityGrade(b.regularity);
                  return (
                    <tr key={c.id} className="clickable" onClick={() => go(`/vtc/${c.id}`)}>
                      <td>
                        <Link to={`/vtc/${c.id}`} onClick={(e) => e.stopPropagation()}><strong>{d?.name ?? '—'}</strong></Link>
                        <br /><span className="muted small">{c.number} · {c.formula === 'location_vente' ? 'location-vente' : 'versement'}{c.platform ? ` · ${c.platform}` : ''}{c.status !== 'actif' ? ` · ${c.status}` : ''}</span>
                      </td>
                      <td>{v ? `${v.brand} ${v.model}` : '—'}<br /><span className="muted small">{v?.plate}</span></td>
                      <td className="right num">{money(c.dailyAmount)}</td>
                      <td>
                        {b.todayDue === 0 ? <span className="muted small">Repos</span> : b.paidToday >= b.todayDue ? <span className="badge badge-success">Reçu</span> : <span className="badge badge-warning">Attendu</span>}
                      </td>
                      <td className="right num" style={{ color: b.balance > 0 ? 'var(--ocre-text)' : 'var(--success)', fontWeight: 600 }}>
                        {b.balance > 0 ? money(b.balance) : b.balance < 0 ? `+${money(-b.balance)}` : 'À jour'}
                        {b.daysBehind > 0 && <><br /><span className="small muted" style={{ fontWeight: 400 }}>{b.daysBehind} jour(s)</span></>}
                        {b.progress !== null && <><br /><span className="small muted" style={{ fontWeight: 400 }}>véhicule payé à {Math.round(b.progress * 100)} %</span></>}
                      </td>
                      <td><span className={`badge ${cls}`}>{grade}</span></td>
                      <td className="right" onClick={(e) => e.stopPropagation()}>
                        <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {can('direction', 'agent', 'comptable') && c.status !== 'termine' && c.status !== 'transfere' && (
                            <button className="btn btn-sm btn-primary" onClick={() => setPaying(c.id)}>Versement</button>
                          )}
                          {b.balance > 0 && d && (
                            <a className="btn btn-sm" href={whatsappLink(d.phone, reminderText(d.name, v?.plate ?? '', b, owner))} target="_blank" rel="noreferrer">Relancer</a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
        <span className="hint">Solde = versements attendus (hors repos et jours non dus) + dépenses à la charge du chauffeur + pénalités + avances − remises − versements reçus. « +X » = le chauffeur a de l’avance.</span>
      </section>
      </>)}

      {creating && <VtcContractForm onClose={() => setCreating(false)} />}
      {paying && <VtcPaymentForm contractId={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

/** Enregistrer un versement reçu (Yoon Fleet ne l'encaisse pas). */
export function VtcPaymentForm({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const { data, store, refresh, toast, now, session } = useData();
  const c = data.vtc_contracts.find((x) => x.id === contractId)!;
  const d = data.drivers.find((x) => x.id === c.driverId);
  const b = vtcBalance(c, data.vtc_payments, data.expenses, now, data.vtc_adjustments);
  const [amount, setAmount] = useState(String(b.balance > 0 && b.balance < c.dailyAmount ? b.balance : c.dailyAmount));
  const [paidOn, setPaidOn] = useState(now.toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>('wave');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<VtcPayment | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Math.round(Number(amount));
    if (!(n > 0)) return setError('Indiquez le montant reçu.');
    if (paidOn > now.toISOString().slice(0, 10)) return setError('La date ne peut pas être dans le futur.');
    if (method !== 'especes' && !reference.trim()) return setError('Indiquez la référence de la transaction.');
    setBusy(true);
    try {
      const p = await store.insert('vtc_payments', {
        contractId, paidOn, amount: n, method, reference: reference.trim() || null, note: note.trim() || null,
        createdBy: session!.userEmail, createdAt: new Date().toISOString(), collectedBy: session!.userEmail, handedAt: null, handedBy: null,
      });
      await refresh();
      toast(`Versement de ${money(n)} enregistré`);
      setSaved(p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (saved) return <ReceiptsModal payments={[saved]} onClose={onClose} />;
  return (
    <Modal title={`Versement · ${d?.name ?? c.number}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="small muted" style={{ margin: 0 }}>
          {money(c.dailyAmount)} par jour · solde actuel {b.balance > 0 ? <strong style={{ color: 'var(--ocre-text)' }}>{money(b.balance)} dû</strong> : b.balance < 0 ? `${money(-b.balance)} d’avance` : 'à jour'}
        </p>
        <div className="grid-2">
          <label className="field">Montant reçu (FCFA)<input type="number" min={1} inputMode="numeric" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="field">Reçu le<input type="date" required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
          <label className="field">Moyen
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {Object.entries(methodLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          {method !== 'especes' && <label className="field">Référence de la transaction<input required maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} /></label>}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {[1, 2, 3].map((k) => <button key={k} type="button" className="btn btn-sm btn-ghost" onClick={() => setAmount(String(c.dailyAmount * k))}>{k} jour{k > 1 ? 's' : ''}</button>)}
          {b.balance > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAmount(String(b.balance))}>Tout le solde</button>}
        </div>
        <label className="field">Note (facultatif)<input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy}>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

/** Nouveau contrat VTC : véhicule, chauffeur, montant, jours de repos, formule, charges. */
export function VtcContractForm({ id, onClose }: { id?: string; onClose: () => void }) {
  const { data, store, refresh, toast, now } = useData();
  const existing = data.vtc_contracts.find((c) => c.id === id);
  const go = useNavigate();
  const today = now.toISOString().slice(0, 10);
  const [f, setF] = useState<Omit<VtcContract, 'id' | 'number' | 'createdAt'>>(
    existing ?? {
      vehicleId: '', driverId: '', formula: 'versement', platform: 'Yango', dailyAmount: 15000, restDays: [0], startDate: today, endDate: null,
      caution: 100000, totalPrice: null, charges: defaultCharges(), status: 'actif', notes: null, lateFee: 0, graceDays: 2,
    },
  );
  const [newDriver, setNewDriver] = useState({ name: '', phone: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const takenVehicle = (vid: string) => data.vtc_contracts.find((c) => c.vehicleId === vid && c.status === 'actif' && c.id !== id);
  const rentalClash = (vid: string) => data.reservations.find((r) => r.vehicleId === vid && isActive(r) && overlaps(f.startDate + 'T00:00:00Z', (f.endDate ?? '2100-01-01') + 'T23:59:59Z', r.start, r.end));
  const busyDriver = (did: string) => data.vtc_contracts.find((c) => c.driverId === did && c.status === 'actif' && c.id !== id);
  const weekly = f.dailyAmount * (7 - f.restDays.length);
  const months = f.formula === 'location_vente' && f.totalPrice && weekly ? Math.ceil((f.totalPrice / weekly) * 7 / 30.4) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.vehicleId) return setError('Choisissez le véhicule.');
    if (takenVehicle(f.vehicleId)) return setError('Ce véhicule a déjà un contrat VTC actif.');
    const clash = rentalClash(f.vehicleId);
    if (clash && !existing) return setError(`Ce véhicule est réservé en location (contrat ${clash.number}). Libérez-le d’abord.`);
    if (!(f.dailyAmount >= 1000)) return setError('Versement journalier trop faible.');
    if (f.restDays.length > 3) return setError('Trois jours de repos par semaine au plus.');
    if (f.formula === 'location_vente' && !(Number(f.totalPrice) > 0)) return setError('Indiquez le prix du véhicule à atteindre.');
    if (f.endDate && f.endDate < f.startDate) return setError('La fin doit être après le début.');
    setBusy(true);
    try {
      let driverId = f.driverId;
      if (!driverId) {
        if (newDriver.name.trim().length < 2 || newDriver.phone.replace(/\D/g, '').length < 8) throw new Error('Choisissez un chauffeur ou indiquez le nom et le téléphone du nouveau.');
        const d = await store.insert('drivers', { name: newDriver.name.trim(), phone: newDriver.phone.trim(), licenseNumber: null, licenseCategory: null, licenseExpiry: null, active: true, notes: 'Chauffeur VTC', createdAt: new Date().toISOString() });
        driverId = d.id;
      } else if (busyDriver(driverId)) {
        throw new Error('Ce chauffeur a déjà un véhicule en VTC.');
      }
      const row = { ...f, driverId, totalPrice: f.formula === 'location_vente' ? Math.round(Number(f.totalPrice)) : null, notes: f.notes?.trim() || null };
      if (existing) {
        await store.update('vtc_contracts', existing.id, row);
        await refresh();
        toast('Contrat mis à jour');
        onClose();
      } else {
        const number = nextVtcNumber(data.vtc_contracts.map((c) => c.number), new Date().getFullYear());
        const created = await store.insert('vtc_contracts', { ...row, number, createdAt: new Date().toISOString() });
        await refresh();
        toast(`Contrat ${number} créé`);
        onClose();
        go(`/vtc/${created.id}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const vehicles = data.vehicles.filter((v) => !v.outOfService);
  return (
    <Modal title={existing ? `Contrat ${existing.number}` : 'Nouveau contrat VTC'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">Formule
            <select value={f.formula} onChange={(e) => set('formula', e.target.value as VtcFormula)}>
              <option value="versement">Versement simple (le véhicule reste au propriétaire)</option>
              <option value="location_vente">Location-vente (le chauffeur devient propriétaire)</option>
            </select>
          </label>
          <label className="field">Plateforme
            <select value={f.platform ?? ''} onChange={(e) => set('platform', e.target.value || null)}>
              {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label className="field">Véhicule
            <select required value={f.vehicleId} disabled={!!existing} onChange={(e) => set('vehicleId', e.target.value)}>
              <option value="">Choisir</option>
              {vehicles.map((v) => {
                const t = takenVehicle(v.id);
                return <option key={v.id} value={v.id} disabled={!!t}>{v.brand} {v.model} · {v.plate}{t ? ' — déjà en VTC' : rentalClash(v.id) ? ' — réservé en location' : ''}</option>;
              })}
            </select>
          </label>
          <label className="field">Chauffeur
            <select value={f.driverId} disabled={!!existing} onChange={(e) => set('driverId', e.target.value)}>
              <option value="">Nouveau chauffeur…</option>
              {data.drivers.filter((d) => d.active).map((d) => <option key={d.id} value={d.id} disabled={!!busyDriver(d.id)}>{d.name}{busyDriver(d.id) ? ' — déjà en VTC' : ''}</option>)}
            </select>
          </label>
        </div>
        {!f.driverId && !existing && (
          <div className="grid-2">
            <label className="field">Nom du chauffeur<input value={newDriver.name} maxLength={120} onChange={(e) => setNewDriver({ ...newDriver, name: e.target.value })} /></label>
            <label className="field">Téléphone<input type="tel" value={newDriver.phone} maxLength={30} onChange={(e) => setNewDriver({ ...newDriver, phone: e.target.value })} /></label>
          </div>
        )}
        <div className="grid-2">
          <label className="field">Versement par jour (FCFA)<input type="number" min={1000} required value={f.dailyAmount} onChange={(e) => set('dailyAmount', Number(e.target.value))} /></label>
          <label className="field">Caution (FCFA)<input type="number" min={0} value={f.caution} onChange={(e) => set('caution', Number(e.target.value))} /></label>
          <label className="field">Début<input type="date" required value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></label>
          <label className="field">Fin (facultatif)<input type="date" value={f.endDate ?? ''} onChange={(e) => set('endDate', e.target.value || null)} /></label>
          <label className="field">Pénalité par jour de retard (FCFA)<input type="number" min={0} max={100000} value={f.lateFee ?? 0} onChange={(e) => set('lateFee', Number(e.target.value))} /><span className="hint">0 = pas de pénalité</span></label>
          <label className="field">Jours de retard tolérés<input type="number" min={0} max={30} value={f.graceDays ?? 2} onChange={(e) => set('graceDays', Number(e.target.value))} /><span className="hint">Pénalité à partir du {(f.graceDays ?? 2) + 1}ᵉ jour de retard</span></label>
          {f.formula === 'location_vente' && (
            <label className="field">Prix du véhicule à payer (FCFA)<input type="number" min={1} required value={f.totalPrice ?? ''} onChange={(e) => set('totalPrice', e.target.value ? Number(e.target.value) : null)} /></label>
          )}
        </div>
        <fieldset className="form-group stack">
          <legend>Jours de repos (sans versement)</legend>
          <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            {[1, 2, 3, 4, 5, 6, 0].map((k) => (
              <label key={k} className="check">
                <input type="checkbox" checked={f.restDays.includes(k)} onChange={(e) => set('restDays', e.target.checked ? [...f.restDays, k] : f.restDays.filter((x) => x !== k))} />
                {DAYS_FR[k]}
              </label>
            ))}
          </div>
          <span className="hint">
            {money(weekly)} par semaine, environ {money(Math.round((weekly * 52) / 12))} par mois.
            {months ? ` Location-vente : véhicule payé en ${months} mois environ.` : ''}
          </span>
        </fieldset>
        <fieldset className="form-group stack">
          <legend>Qui paie quoi</legend>
          <div className="grid-2">
            {VTC_CHARGES.map(([k, label]) => (
              <label key={k} className="field">{label}
                <select value={f.charges[k] ?? 'proprietaire'} onChange={(e) => set('charges', { ...f.charges, [k]: e.target.value as 'proprietaire' | 'chauffeur' })}>
                  <option value="proprietaire">Propriétaire</option>
                  <option value="chauffeur">Chauffeur</option>
                </select>
              </label>
            ))}
          </div>
          <span className="hint">Une dépense à la charge du chauffeur s’ajoute à son solde.</span>
        </fieldset>
        <label className="field">Notes<textarea rows={2} maxLength={1000} value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} placeholder="Conditions particulières, transfert de la carte grise…" /></label>
        <span className="hint">Le contrat écrit avec le chauffeur doit respecter la réglementation des plateformes de transport ; faites-le relire par un juriste.</span>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy}>{existing ? 'Enregistrer' : 'Créer le contrat'}</button>
        </div>
      </form>
    </Modal>
  );
}

export const vtcStatusLabel: Record<VtcContract['status'], [string, string]> = {
  actif: ['Actif', 'badge-success'],
  suspendu: ['Suspendu', 'badge-warning'],
  termine: ['Terminé', 'badge-muted'],
  transfere: ['Véhicule transféré', 'badge-muted'],
};
