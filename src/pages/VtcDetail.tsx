import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Empty, ErrorBox, Modal } from '../components/ui';
import { whatsappLink } from '../domain/booking';
import { dateLong, dateShort, money } from '../domain/format';
import type { ExpenseKind, VtcStatus } from '../domain/types';
import { DAYS_FR, isRestDay, regularityGrade, reminderText, VTC_CHARGES, vtcBalance } from '../domain/vtc';
import { useData } from '../state/DataContext';
import { methodLabel } from './ReservationDetail';
import { VtcContractForm, VtcPaymentForm, vtcStatusLabel } from './Vtc';

/** Fiche d'un contrat VTC : carnet des versements, solde, charges, location-vente. */
export function VtcDetail() {
  const { id } = useParams();
  const { data, now, can, store, refresh, toast, session } = useData();
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [charging, setCharging] = useState(false);
  const [shown, setShown] = useState(15);
  const c = data.vtc_contracts.find((x) => x.id === id);
  if (!c) {
    return (
      <div className="card">
        <p>Contrat introuvable.</p>
        <Link to="/vtc">Retour aux contrats VTC</Link>
      </div>
    );
  }
  const v = data.vehicles.find((x) => x.id === c.vehicleId);
  const d = data.drivers.find((x) => x.id === c.driverId);
  const b = vtcBalance(c, data.vtc_payments, data.expenses, now);
  const pays = data.vtc_payments.filter((p) => p.contractId === c.id).sort((x, y) => y.paidOn.localeCompare(x.paidOn) || y.createdAt.localeCompare(x.createdAt));
  const charges = data.expenses.filter((e) => e.vtcContractId === c.id).sort((x, y) => y.date.localeCompare(x.date));
  const [grade, gcls] = regularityGrade(b.regularity);
  const editable = can('direction', 'agent');
  const open = c.status === 'actif' || c.status === 'suspendu';

  // Les 28 derniers jours : versé, manqué ou repos.
  const days = Array.from({ length: 28 }, (_, k) => {
    const day = new Date(now.getTime() - (27 - k) * 86400000).toISOString().slice(0, 10);
    const got = pays.filter((p) => p.paidOn === day).reduce((s, p) => s + p.amount, 0);
    const before = day < c.startDate || (c.endDate && day > c.endDate);
    const state = before ? 'hors' : isRestDay(c, day) ? 'repos' : got >= c.dailyAmount ? 'ok' : got > 0 ? 'partiel' : day === now.toISOString().slice(0, 10) ? 'attendu' : 'manque';
    return { day, got, state };
  });

  async function setStatus(status: VtcStatus) {
    const msg = status === 'termine' ? 'Terminer ce contrat ? Le véhicule redevient disponible.' : status === 'transfere' ? 'Confirmer le transfert de propriété au chauffeur ?' : status === 'suspendu' ? 'Suspendre les versements attendus ? (le véhicule reste confié)' : 'Réactiver le contrat ?';
    if (!window.confirm(msg)) return;
    await store.update('vtc_contracts', c!.id, { status, endDate: status === 'termine' || status === 'transfere' ? now.toISOString().slice(0, 10) : c!.endDate });
    await refresh();
    toast('Contrat mis à jour');
  }
  async function removePayment(pid: string) {
    if (!window.confirm('Supprimer ce versement saisi par erreur ? La suppression reste tracée dans le journal.')) return;
    await store.remove('vtc_payments', pid);
    await refresh();
    toast('Versement supprimé');
  }

  return (
    <>
      <header className="page-head">
        <div>
          <span className="small muted"><Link to="/vtc">Chauffeurs VTC</Link> › {c.number}</span>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <h1>{d?.name ?? c.number}</h1>
            <span className={`badge ${vtcStatusLabel[c.status][1]}`}>{vtcStatusLabel[c.status][0]}</span>
            <span className={`badge ${gcls}`}>{grade}</span>
          </div>
          <p className="small muted">
            {d?.phone} · {v ? `${v.brand} ${v.model} ${v.plate}` : ''} · {c.formula === 'location_vente' ? 'location-vente' : 'versement simple'}{c.platform ? ` · ${c.platform}` : ''}
          </p>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {open && can('direction', 'agent', 'comptable') && <button className="btn btn-primary" onClick={() => setPaying(true)}>Enregistrer un versement</button>}
          {b.balance > 0 && d && <a className="btn" href={whatsappLink(d.phone, reminderText(d.name, v?.plate ?? '', b, session!.org.name))} target="_blank" rel="noreferrer">Relancer sur WhatsApp</a>}
          {editable && open && <button className="btn btn-ghost" onClick={() => setEditing(true)}>Modifier</button>}
        </div>
      </header>

      <div className="kpis">
        <div className="card kpi">
          <span className="kpi-label">Solde du chauffeur</span>
          <span className="kpi-value" style={{ color: b.balance > 0 ? 'var(--ocre-text)' : 'var(--success)' }}>{b.balance > 0 ? money(b.balance) : b.balance < 0 ? `+${money(-b.balance)}` : 'À jour'}</span>
          <span className="small muted">{b.balance > 0 ? `${b.daysBehind} jour(s) de retard` : b.balance < 0 ? 'd’avance' : 'rien à réclamer'}</span>
        </div>
        <div className="card kpi">
          <span className="kpi-label">Versé depuis le début</span>
          <span className="kpi-value">{money(b.paid)}</span>
          <span className="small muted">sur {money(b.expected)} attendus ({b.expectedDays} jours){b.charges ? ` + ${money(b.charges)} de charges` : ''}</span>
        </div>
        {b.progress !== null ? (
          <div className="card kpi">
            <span className="kpi-label">Véhicule payé</span>
            <span className="kpi-value">{Math.round(b.progress * 100)} %</span>
            <span className="small muted">reste {money(b.remainingPrice ?? 0)}{b.estimatedEnd ? ` · fin estimée ${dateLong(b.estimatedEnd)}` : ''}</span>
            <div style={{ height: 8, background: 'var(--sable)', borderRadius: 4 }}><div style={{ height: 8, borderRadius: 4, width: `${Math.round(b.progress * 100)}%`, background: 'var(--success)' }} /></div>
          </div>
        ) : (
          <div className="card kpi">
            <span className="kpi-label">Régularité sur 30 jours</span>
            <span className="kpi-value">{Math.round(b.regularity * 100)} %</span>
            <span className="small muted">{b.lastPaidOn ? `dernier versement le ${dateShort(b.lastPaidOn)}` : 'aucun versement'}</span>
          </div>
        )}
      </div>

      <section className="card" aria-labelledby="cal">
        <h2 id="cal">Les 4 dernières semaines</h2>
        <div className="vtc-cal" role="list">
          {days.map((x) => (
            <div key={x.day} role="listitem" className={`vtc-day vtc-${x.state}`} title={`${dateShort(x.day)} : ${x.state === 'ok' ? `${money(x.got)} versés` : x.state === 'partiel' ? `${money(x.got)} sur ${money(c.dailyAmount)}` : x.state === 'repos' ? 'repos' : x.state === 'hors' ? 'hors contrat' : x.state === 'attendu' ? 'attendu aujourd’hui' : 'rien reçu'}`}>
              <span>{new Date(x.day + 'T12:00:00Z').getUTCDate()}</span>
            </div>
          ))}
        </div>
        <div className="row small muted" style={{ gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <span><span className="vtc-dot vtc-ok" /> versé</span><span><span className="vtc-dot vtc-partiel" /> partiel</span>
          <span><span className="vtc-dot vtc-manque" /> rien reçu</span><span><span className="vtc-dot vtc-repos" /> repos ({c.restDays.map((k) => DAYS_FR[k]).join(', ') || 'aucun'})</span>
        </div>
      </section>

      <div className="cols">
        <section className="card col-2" aria-labelledby="carnet">
          <h2 id="carnet">Carnet des versements</h2>
          {pays.length === 0 ? <Empty>Aucun versement enregistré.</Empty> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Date</th><th className="right">Montant</th><th>Moyen</th><th>Saisi par</th><th /></tr></thead>
                <tbody>
                  {pays.slice(0, shown).map((p) => (
                    <tr key={p.id}>
                      <td>{dateShort(p.paidOn)}</td>
                      <td className="right num">{money(p.amount)}</td>
                      <td>{methodLabel[p.method]}{p.reference ? <><br /><span className="muted small">{p.reference}</span></> : null}{p.note ? <><br /><span className="muted small">{p.note}</span></> : null}</td>
                      <td className="small muted">{p.createdBy ?? ''}</td>
                      <td className="right">{can('direction') && <button className="btn btn-sm btn-ghost" onClick={() => removePayment(p.id)}>Supprimer</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pays.length > shown && <button className="btn btn-sm btn-ghost" onClick={() => setShown(shown + 30)}>Voir plus ({pays.length - shown} versements plus anciens)</button>}
        </section>

        <div className="col-1 stack" style={{ gap: 'var(--space-6)' }}>
          <section className="card" aria-labelledby="contrat">
            <h2 id="contrat">Contrat</h2>
            <dl className="facts">
              <div><dt>Versement</dt><dd>{money(c.dailyAmount)} par jour</dd></div>
              <div><dt>Repos</dt><dd>{c.restDays.map((k) => DAYS_FR[k]).join(', ') || 'aucun'}</dd></div>
              <div><dt>Début</dt><dd>{dateLong(c.startDate)}</dd></div>
              {c.endDate && <div><dt>Fin</dt><dd>{dateLong(c.endDate)}</dd></div>}
              <div><dt>Caution</dt><dd>{money(c.caution)}</dd></div>
              {c.totalPrice && <div><dt>Prix du véhicule</dt><dd>{money(c.totalPrice)}</dd></div>}
            </dl>
            <dl className="facts">
              {VTC_CHARGES.map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{(c.charges[k] ?? 'proprietaire') === 'chauffeur' ? 'Chauffeur' : 'Propriétaire'}</dd></div>)}
            </dl>
            {c.notes && <p className="small" style={{ margin: 0 }}>{c.notes}</p>}
            {editable && (
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {c.status === 'actif' && <button className="btn btn-sm" onClick={() => setStatus('suspendu')}>Suspendre</button>}
                {c.status === 'suspendu' && <button className="btn btn-sm" onClick={() => setStatus('actif')}>Réactiver</button>}
                {open && c.formula === 'location_vente' && (b.progress ?? 0) >= 1 && <button className="btn btn-sm btn-primary" onClick={() => setStatus('transfere')}>Transférer le véhicule</button>}
                {open && <button className="btn btn-sm btn-ghost" onClick={() => setStatus('termine')}>Terminer le contrat</button>}
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="charges">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 id="charges">Dépenses du véhicule</h2>
              {editable && <button className="btn btn-sm" onClick={() => setCharging(true)}>Ajouter</button>}
            </div>
            {charges.length === 0 ? <Empty>Aucune dépense liée à ce contrat.</Empty> : (
              <ul className="alert-list">
                {charges.slice(0, 12).map((e) => (
                  <li key={e.id} className="alert-item" style={{ borderLeftColor: e.chargedTo === 'chauffeur' ? 'var(--ocre)' : 'var(--atlantique)' }}>
                    <strong>{e.label ?? e.kind} · {money(e.amount)}</strong>
                    <span className="small muted">{dateShort(e.date)} · à la charge {e.chargedTo === 'chauffeur' ? 'du chauffeur (ajouté au solde)' : 'du propriétaire'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {paying && <VtcPaymentForm contractId={c.id} onClose={() => setPaying(false)} />}
      {editing && <VtcContractForm id={c.id} onClose={() => setEditing(false)} />}
      {charging && <VtcExpenseForm contractId={c.id} onClose={() => setCharging(false)} />}
    </>
  );
}

const KIND_OF: Record<string, ExpenseKind> = { vidange: 'reparation', pneus: 'pneus', reparation: 'reparation', assurance: 'assurance', carburant: 'carburant', amende: 'amende', degats: 'reparation', lavage: 'lavage' };

/** Dépense liée au contrat, imputée selon les règles du contrat (modifiable). */
function VtcExpenseForm({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const { data, store, refresh, toast, now } = useData();
  const c = data.vtc_contracts.find((x) => x.id === contractId)!;
  const [what, setWhat] = useState(VTC_CHARGES[5][0]);
  const [chargedTo, setChargedTo] = useState<'proprietaire' | 'chauffeur'>(c.charges[VTC_CHARGES[5][0]] ?? 'chauffeur');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(now.toISOString().slice(0, 10));
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Math.round(Number(amount));
    if (!(n > 0)) return setError('Indiquez le montant.');
    try {
      const name = VTC_CHARGES.find(([k]) => k === what)?.[1] ?? what;
      await store.insert('expenses', {
        vehicleId: c.vehicleId, date, kind: KIND_OF[what] ?? 'autre', amount: n, label: label.trim() || name, mileage: null, reservationId: null,
        chargedTo, vtcContractId: c.id,
      });
      await refresh();
      toast(chargedTo === 'chauffeur' ? 'Dépense ajoutée au solde du chauffeur' : 'Dépense enregistrée');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title="Dépense du véhicule" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">Nature
            <select value={what} onChange={(e) => { const k = e.target.value as typeof what; setWhat(k); setChargedTo(c.charges[k] ?? 'proprietaire'); }}>
              {VTC_CHARGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="field">À la charge de
            <select value={chargedTo} onChange={(e) => setChargedTo(e.target.value as 'proprietaire' | 'chauffeur')}>
              <option value="proprietaire">Propriétaire</option>
              <option value="chauffeur">Chauffeur (ajouté à son solde)</option>
            </select>
          </label>
          <label className="field">Montant (FCFA)<input type="number" min={1} required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="field">Date<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <label className="field">Détail (facultatif)<input maxLength={200} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. : amende excès de vitesse VDN" /></label>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
