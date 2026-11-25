// Outils du quotidien du module VTC : point du jour, saisie groupée, reçus, relances,
// jours non dus, avances et remises, caisse des encaisseurs, solde de la caution.
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Modal } from '../components/ui';
import { whatsappLink } from '../domain/booking';
import { dateLong, dateShort, money } from '../domain/format';
import type { PaymentMethod, VtcAdjustmentKind, VtcPayment } from '../domain/types';
import { cashToHandOver, cautionSettlement, DAY_OFF_REASONS, isDueDay, receiptText, reminderText, vtcBalance, vtcDay, type DayState } from '../domain/vtc';
import { useData } from '../state/DataContext';
import { methodLabel } from './ReservationDetail';

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const dayStateLabel: Record<DayState, [string, string]> = {
  paye: ['Versé', 'badge-success'],
  partiel: ['Partiel', 'badge-warning'],
  non_paye: ['Pas encore versé', 'badge-danger'],
  repos: ['Repos', 'badge-muted'],
  non_du: ['Non dû', 'badge-muted'],
  hors_contrat: ['Hors contrat', 'badge-muted'],
};

interface Entry { amount: string; method: PaymentMethod; reference: string }

/** Le point du jour : qui a versé, qui doit, saisie rapide de tous les versements. */
export function VtcToday() {
  const { data, now, can, store, refresh, toast, session } = useData();
  const today = iso(now);
  const [day, setDay] = useState(today);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<VtcPayment[] | null>(null);
  const [remind, setRemind] = useState(false);
  const [offFor, setOffFor] = useState<string | null>(null);
  const canPay = can('direction', 'agent', 'comptable');
  const owner = session!.org.name;

  const rows = useMemo(
    () =>
      data.vtc_contracts
        .filter((c) => c.status === 'actif' || c.status === 'suspendu')
        .map((c) => ({
          c,
          d: data.drivers.find((x) => x.id === c.driverId),
          v: data.vehicles.find((x) => x.id === c.vehicleId),
          today: vtcDay(c, data.vtc_payments, data.vtc_adjustments, day),
          b: vtcBalance(c, data.vtc_payments, data.expenses, now, data.vtc_adjustments),
        }))
        .sort((x, y) => Number(x.today.state === 'paye') - Number(y.today.state === 'paye') || y.b.balance - x.b.balance),
    [data, day, now],
  );
  const due = rows.reduce((s, r) => s + r.today.due, 0);
  const got = rows.reduce((s, r) => s + r.today.paid, 0);
  const late = rows.filter((r) => r.b.balance > 0 && r.d);
  const entry = (id: string): Entry => entries[id] ?? { amount: '', method: 'especes', reference: '' };
  const setEntry = (id: string, e: Partial<Entry>) => setEntries({ ...entries, [id]: { ...entry(id), ...e } });
  const filled = rows.filter((r) => Number(entry(r.c.id).amount) > 0);

  async function saveAll(e: FormEvent) {
    e.preventDefault();
    setError(null);
    for (const r of filled) {
      const x = entry(r.c.id);
      if (x.method !== 'especes' && !x.reference.trim()) return setError(`Référence de la transaction manquante pour ${r.d?.name ?? r.c.number}.`);
    }
    setBusy(true);
    const saved: VtcPayment[] = [];
    try {
      for (const r of filled) {
        const x = entry(r.c.id);
        saved.push(await store.insert('vtc_payments', {
          contractId: r.c.id, paidOn: day, amount: Math.round(Number(x.amount)), method: x.method, reference: x.reference.trim() || null, note: null,
          createdBy: session!.userEmail, createdAt: new Date().toISOString(), collectedBy: session!.userEmail, handedAt: null, handedBy: null,
        }));
      }
      await refresh();
      setEntries({});
      toast(`${saved.length} versement(s) enregistré(s)`);
      setReceipts(saved);
    } catch (err) {
      setError(`${(err as Error).message}${saved.length ? ` (${saved.length} versement(s) déjà enregistré(s))` : ''}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          Jour
          <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value || today)} />
        </label>
        {late.length > 0 && <button type="button" className="btn" onClick={() => setRemind(true)}>Relancer les {late.length} retardataire(s)</button>}
      </div>

      <div className="kpis">
        <div className="card kpi"><span className="kpi-label">Attendu {day === today ? 'aujourd’hui' : `le ${dateShort(day)}`}</span><span className="kpi-value num">{money(due, '')}</span><span className="small muted">FCFA · {rows.filter((r) => r.today.due > 0).length} chauffeur(s) au travail</span></div>
        <div className="card kpi"><span className="kpi-label">Reçu</span><span className="kpi-value num" style={{ color: due && got >= due ? 'var(--success)' : undefined }}>{money(got, '')}</span><span className="small muted">FCFA{due ? ` · ${Math.round((got / due) * 100)} % de l’attendu` : ''}</span></div>
        <div className="card kpi"><span className="kpi-label">Pas encore versé</span><span className="kpi-value">{rows.filter((r) => r.today.state === 'non_paye' || r.today.state === 'partiel').length}</span><span className="small muted">chauffeur(s) ce jour</span></div>
        <div className="card kpi"><span className="kpi-label">Reste dû au total</span><span className="kpi-value num" style={{ color: 'var(--ink)' }}>{money(rows.reduce((s, r) => s + Math.max(0, r.b.balance), 0), '')}</span><span className="small muted">FCFA · {late.length} chauffeur(s)</span></div>
      </div>

      <section className="card">
        {rows.length === 0 ? (
          <Empty>Aucun contrat VTC actif.</Empty>
        ) : (
          <form className="stack" onSubmit={saveAll}>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Chauffeur</th><th>Ce jour</th><th className="right">Solde</th>{canPay && <th>Versement reçu</th>}<th /></tr></thead>
                <tbody>
                  {rows.map(({ c, d, v, today: t, b }) => {
                    const x = entry(c.id);
                    const [label, cls] = dayStateLabel[t.state];
                    return (
                      <tr key={c.id}>
                        <td><Link to={`/vtc/${c.id}`}><strong>{d?.name ?? c.number}</strong></Link><br /><span className="muted small">{v?.plate} · {money(c.dailyAmount)}/jour</span></td>
                        <td><span className={`badge ${cls}`}>{label}</span>{t.paid > 0 && <><br /><span className="small muted">{money(t.paid)} reçus</span></>}</td>
                        <td className="right num" style={{ color: b.balance > 0 ? 'var(--ink)' : 'var(--success)', fontWeight: 600 }}>
                          {b.balance > 0 ? money(b.balance) : b.balance < 0 ? `+${money(-b.balance)}` : 'À jour'}
                          {b.daysBehind > 0 && <><br /><span className="small muted" style={{ fontWeight: 400 }}>{b.daysBehind} j</span></>}
                        </td>
                        {canPay && (
                          <td>
                            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                              <input aria-label={`Montant reçu de ${d?.name ?? c.number}`} type="number" min={0} inputMode="numeric" placeholder={String(t.due || c.dailyAmount)} value={x.amount} onChange={(e) => setEntry(c.id, { amount: e.target.value })} style={{ width: 110 }} />
                              <select aria-label="Moyen" value={x.method} onChange={(e) => setEntry(c.id, { method: e.target.value as PaymentMethod })} style={{ width: 130 }}>
                                {(['especes', 'wave', 'orange_money', 'free_money'] as PaymentMethod[]).map((m) => <option key={m} value={m}>{methodLabel[m]}</option>)}
                              </select>
                              {x.method !== 'especes' && Number(x.amount) > 0 && <input aria-label="Référence" placeholder="Référence" value={x.reference} maxLength={80} onChange={(e) => setEntry(c.id, { reference: e.target.value })} style={{ width: 120 }} />}
                              {t.due > t.paid && !x.amount && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEntry(c.id, { amount: String(t.due - t.paid) })}>{money(t.due - t.paid)}</button>}
                            </div>
                          </td>
                        )}
                        <td className="right">
                          <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            {b.balance > 0 && d && <a className="btn btn-sm" href={whatsappLink(d.phone, reminderText(d.name, v?.plate ?? '', b, owner))} target="_blank" rel="noreferrer">Relancer</a>}
                            {can('direction', 'agent') && t.state === 'non_paye' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOffFor(c.id)}>Non dû</button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ErrorBox error={error} />
            {canPay && (
              <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy || filled.length === 0}>
                {busy ? 'Enregistrement…' : filled.length ? `Enregistrer ${filled.length} versement(s) · ${money(filled.reduce((s, r) => s + Number(entry(r.c.id).amount), 0))}` : 'Saisissez les montants reçus'}
              </button>
            )}
            <span className="hint">Chaque versement enregistré peut être confirmé au chauffeur par un reçu WhatsApp : c’est sa preuve, et votre protection.</span>
          </form>
        )}
      </section>

      {receipts && <ReceiptsModal payments={receipts} onClose={() => setReceipts(null)} />}
      {remind && <RemindModal onClose={() => setRemind(false)} />}
      {offFor && <DayOffForm contractId={offFor} defaultDay={day} onClose={() => setOffFor(null)} />}
    </>
  );
}

/** Reçus WhatsApp des versements qui viennent d'être enregistrés. */
export function ReceiptsModal({ payments, onClose }: { payments: VtcPayment[]; onClose: () => void }) {
  const { data, now, session } = useData();
  const [sent, setSent] = useState<string[]>([]);
  return (
    <Modal title="Envoyer les reçus" onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>Un appui par chauffeur : WhatsApp s’ouvre avec le reçu prêt à envoyer.</p>
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {payments.map((p) => {
            const c = data.vtc_contracts.find((x) => x.id === p.contractId);
            const d = data.drivers.find((x) => x.id === c?.driverId);
            const v = data.vehicles.find((x) => x.id === c?.vehicleId);
            if (!c || !d) return null;
            const b = vtcBalance(c, data.vtc_payments, data.expenses, now, data.vtc_adjustments);
            const text = receiptText(d.name, v?.plate ?? '', p, b, session!.org.name, methodLabel[p.method]);
            return (
              <li key={p.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span><strong>{d.name}</strong> · {money(p.amount)}</span>
                <a className={`btn btn-sm${sent.includes(p.id) ? ' btn-ghost' : ' btn-primary'}`} href={whatsappLink(d.phone, text)} target="_blank" rel="noreferrer" onClick={() => setSent([...sent, p.id])}>
                  {sent.includes(p.id) ? 'Reçu ouvert' : 'Envoyer le reçu'}
                </a>
              </li>
            );
          })}
        </ul>
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Terminé</button></div>
      </div>
    </Modal>
  );
}

/** Relance de tous les retardataires, un appui par chauffeur. */
function RemindModal({ onClose }: { onClose: () => void }) {
  const { data, now, session } = useData();
  const [done, setDone] = useState<string[]>([]);
  const late = data.vtc_contracts
    .filter((c) => c.status === 'actif')
    .map((c) => ({ c, d: data.drivers.find((x) => x.id === c.driverId), v: data.vehicles.find((x) => x.id === c.vehicleId), b: vtcBalance(c, data.vtc_payments, data.expenses, now, data.vtc_adjustments) }))
    .filter((r) => r.b.balance > 0 && r.d)
    .sort((x, y) => y.b.balance - x.b.balance);
  return (
    <Modal title={`Relancer ${late.length} chauffeur(s)`} onClose={onClose}>
      <div className="stack">
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {late.map(({ c, d, v, b }) => (
            <li key={c.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span><strong>{d!.name}</strong> · {money(b.balance)} ({b.daysBehind} j)</span>
              <a className={`btn btn-sm${done.includes(c.id) ? ' btn-ghost' : ' btn-primary'}`} href={whatsappLink(d!.phone, reminderText(d!.name, v?.plate ?? '', b, session!.org.name))} target="_blank" rel="noreferrer" onClick={() => setDone([...done, c.id])}>
                {done.includes(c.id) ? 'Relance ouverte' : 'Relancer'}
              </a>
            </li>
          ))}
        </ul>
        <div className="modal-foot"><button type="button" className="btn" onClick={onClose}>Terminé</button></div>
      </div>
    </Modal>
  );
}

/** Déclarer un ou plusieurs jours non dus (garage, accident, fête, maladie). */
export function DayOffForm({ contractId, defaultDay, onClose }: { contractId: string; defaultDay?: string; onClose: () => void }) {
  const { data, store, refresh, toast, now, session } = useData();
  const c = data.vtc_contracts.find((x) => x.id === contractId)!;
  const today = iso(now);
  const [from, setFrom] = useState(defaultDay ?? today);
  const [to, setTo] = useState(defaultDay ?? today);
  const [reason, setReason] = useState(DAY_OFF_REASONS[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const already = new Set(data.vtc_adjustments.filter((a) => a.contractId === c.id && a.kind === 'jour_offert').map((a) => a.day));
  const days: string[] = [];
  if (from && to && to >= from) for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z') && days.length < 62; t += DAY) {
    const d = iso(new Date(t));
    if (isDueDay(c, d, already)) days.push(d);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!days.length) return setError('Aucun jour à déclarer sur cette période (repos, déjà non dus ou hors contrat).');
    setBusy(true);
    try {
      for (const d of days) {
        await store.insert('vtc_adjustments', { contractId: c.id, kind: 'jour_offert', day: d, amount: 0, note: reason, createdBy: session!.userEmail, createdAt: new Date().toISOString() });
      }
      await refresh();
      toast(`${days.length} jour(s) déclaré(s) non dus`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Jours non dus" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="small muted" style={{ margin: 0 }}>Aucun versement n’est attendu ces jours-là : ils ne comptent ni dans le retard ni dans les pénalités.</p>
        <div className="grid-2">
          <label className="field">Du<input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field">Au<input type="date" required value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <label className="field">Motif<select value={reason} onChange={(e) => setReason(e.target.value)}>{DAY_OFF_REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>
        <span className="hint">{days.length} jour(s) de versement concerné(s), soit {money(days.length * c.dailyAmount)} non dus.</span>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || !days.length}>Déclarer</button>
        </div>
      </form>
    </Modal>
  );
}

/** Avance au chauffeur, remise accordée. */
export function AdjustmentForm({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const { store, refresh, toast, now, session, can } = useData();
  const [kind, setKind] = useState<Extract<VtcAdjustmentKind, 'avance' | 'remise'>>('avance');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Math.round(Number(amount));
    if (!(n > 0)) return setError('Indiquez le montant.');
    if (note.trim().length < 3) return setError('Indiquez le motif.');
    try {
      await store.insert('vtc_adjustments', { contractId, kind, day: iso(now), amount: n, note: note.trim(), createdBy: session!.userEmail, createdAt: new Date().toISOString() });
      await refresh();
      toast(kind === 'avance' ? 'Avance ajoutée au solde du chauffeur' : 'Remise déduite du solde');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal title="Avance ou remise" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="tabs" role="group" aria-label="Type">
          <button type="button" aria-selected={kind === 'avance'} onClick={() => setKind('avance')}>Avance au chauffeur</button>
          {can('direction') && <button type="button" aria-selected={kind === 'remise'} onClick={() => setKind('remise')}>Remise accordée</button>}
        </div>
        <span className="small muted">{kind === 'avance' ? 'Argent prêté au chauffeur (réparation, visite technique…) : il s’ajoute à ce qu’il doit.' : 'Geste commercial ou pénalités annulées : le montant est déduit de ce qu’il doit.'}</span>
        <div className="grid-2">
          <label className="field">Montant (FCFA)<input type="number" min={1} required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="field">Motif<input required maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

/** Fin de contrat : retenir sur la caution ce que le chauffeur doit encore. */
export function CautionSettleButton({ contractId }: { contractId: string }) {
  const { data, store, refresh, toast, now, session } = useData();
  const c = data.vtc_contracts.find((x) => x.id === contractId)!;
  const b = vtcBalance(c, data.vtc_payments, data.expenses, now, data.vtc_adjustments);
  const s = cautionSettlement(b);
  if (s.retain <= 0) return null;
  async function settle() {
    if (!window.confirm(`Retenir ${money(s.retain)} sur la caution de ${money(b.cautionLeft)} ? Il restera ${money(s.refund)} à rendre au chauffeur${s.stillOwed ? ` et ${money(s.stillOwed)} qu’il doit encore` : ''}.`)) return;
    await store.insert('vtc_adjustments', { contractId: c.id, kind: 'retenue_caution', day: iso(now), amount: s.retain, note: 'Solde du compte à la fin du contrat', createdBy: session!.userEmail, createdAt: new Date().toISOString() });
    await refresh();
    toast(`${money(s.retain)} retenus sur la caution`);
  }
  return <button type="button" className="btn btn-sm" onClick={settle}>Solder avec la caution ({money(s.retain)})</button>;
}

/** Caisse : espèces reçues par chaque encaisseur, à remettre au propriétaire. */
export function VtcCash() {
  const { data, store, refresh, toast, can } = useData();
  const groups = cashToHandOver(data.vtc_payments);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recent = data.vtc_payments.filter((p) => p.method === 'especes' && p.handedAt).sort((x, y) => (y.handedAt ?? '').localeCompare(x.handedAt ?? '')).slice(0, 8);
  const name = (contractId: string) => data.drivers.find((d) => d.id === data.vtc_contracts.find((c) => c.id === contractId)?.driverId)?.name ?? '—';

  async function handOver(collector: string, ids: string[], total: number) {
    if (!window.confirm(`Confirmer avoir reçu ${money(total)} en espèces de ${collector} ?`)) return;
    setBusy(true);
    try {
      const n = await store.vtcHandOver(ids);
      await refresh();
      toast(`${n} versement(s) remis par ${collector}`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2>Espèces à remettre</h2>
        <p className="small muted" style={{ margin: 0 }}>Chaque versement en espèces reste dans la caisse de celui qui l’a reçu jusqu’à ce que la direction confirme l’avoir récupéré.</p>
        {groups.length === 0 ? (
          <Empty>Toutes les espèces ont été remises.</Empty>
        ) : (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {groups.map((g) => (
              <li key={g.collector} className="card" style={{ padding: 'var(--space-4)' }}>
                <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div>
                    <strong>{g.collector}</strong>
                    <br /><span className="small muted">{g.payments.length} versement(s) depuis le {dateShort(g.payments[0].paidOn)}</span>
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="num" style={{ fontWeight: 700, fontSize: 18 }}>{money(g.total)}</span>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(open === g.collector ? null : g.collector)}>{open === g.collector ? 'Masquer' : 'Détail'}</button>
                    {can('direction') && <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => handOver(g.collector, g.payments.map((p) => p.id), g.total)}>Remise reçue</button>}
                  </div>
                </div>
                {open === g.collector && (
                  <table className="data" style={{ marginTop: 8 }}>
                    <tbody>
                      {g.payments.map((p) => <tr key={p.id}><td>{dateShort(p.paidOn)}</td><td>{name(p.contractId)}</td><td className="right num">{money(p.amount)}</td></tr>)}
                    </tbody>
                  </table>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {recent.length > 0 && (
        <section className="card">
          <h2>Dernières remises</h2>
          <ul className="stack small" style={{ margin: 0, paddingLeft: 18 }}>
            {recent.map((p) => <li key={p.id}>{dateLong(p.handedAt!)} · {name(p.contractId)} · {money(p.amount)} · reçu par {p.handedBy ?? 'la direction'}</li>)}
          </ul>
        </section>
      )}
    </>
  );
}
