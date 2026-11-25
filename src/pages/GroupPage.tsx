import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorBox, Modal, ReservationBadge } from '../components/ui';
import { payGroup } from '../data/services';
import { COUNTRY_CALLING_CODE, whatsappLink } from '../domain/booking';
import { payeeLines, payState, payStatusLabel, termsFor } from '../domain/billing';
import { legalLine, taxIdLabel } from '../domain/clients';
import { contractSettings } from '../domain/contract';
import { missionSheet } from '../domain/drivers';
import { dateLong, dateShort, money, time } from '../domain/format';
import { allocatePayment, groupMessage, groupSummary } from '../domain/groups';
import { lateDays } from '../domain/rules';
import type { PaymentMethod } from '../domain/types';
import { useData } from '../state/DataContext';
import { useBilling } from '../state/useBilling';
import { methodLabel } from './ReservationDetail';

export function GroupPage() {
  const { id } = useParams();
  const { data, session, now, can, store, refresh, toast } = useData();
  const billing = useBilling();
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const g = data.reservation_groups.find((x) => x.id === id);
  if (!g) {
    return (
      <div className="card">
        <p>Dossier introuvable.</p>
        <Link to="/reservations">Retour aux réservations</Link>
      </div>
    );
  }
  const client = data.clients.find((c) => c.id === g.clientId);
  const org = session!.org;
  const s = contractSettings(org.name, org.contract);
  const sum = groupSummary(g.id, data.reservations, data.invoices, data.payments, now);
  const veh = new Map(data.vehicles.map((v) => [v.id, v]));
  const drv = new Map(data.drivers.map((d) => [d.id, d]));
  const vLabel = (vid: string) => {
    const v = veh.get(vid);
    return v ? `${v.category} · ${v.brand} ${v.model} · ${v.plate}` : '—';
  };
  const payees = payeeLines(billing.settings.payees);
  const terms = termsFor(billing.settings, client);
  const ids = new Set(sum.reservations.map((r) => r.id));
  const invoices = data.invoices.filter((i) => ids.has(i.reservationId)).sort((a, b) => a.number.localeCompare(b.number));
  const pays = data.payments
    .filter((p) => ids.has(p.reservationId) && p.status === 'paye' && (p.kind === 'acompte' || p.kind === 'solde' || p.kind === 'frais'))
    .sort((a, b) => (a.paidAt ?? '').localeCompare(b.paidAt ?? ''));
  const number = new Map(sum.reservations.map((r) => [r.id, r.number]));
  const contact = client?.contactName || client?.name || '';
  const msg = groupMessage(g, contact, sum, (r) => { const v = veh.get(r.vehicleId); return v ? `${v.category} ${v.brand} ${v.model}` : r.number; }, s.legalName, payees);
  const cc = COUNTRY_CALLING_CODE[org.country] ?? '221';
  const starts = sum.active.map((r) => r.start).sort();
  const ends = sum.active.map((r) => r.end).sort();
  const b = client;

  async function copy() {
    try {
      await navigator.clipboard.writeText(msg);
      toast('Message copié');
    } catch {
      toast('Copie impossible sur cet appareil');
    }
  }

  return (
    <>
      <header className="page-head no-print">
        <div>
          <span className="small muted">
            <Link to="/reservations">Réservations et contrats</Link> › dossier
            {client && <> · <Link to={`/clients/${client.id}`}>{client.name}</Link></>}
          </span>
          <div className="row">
            <h1>Dossier {g.number}</h1>
            {sum.remaining === 0 && sum.owed > 0 ? <span className="badge badge-success">Soldé</span> : sum.overdue ? <span className="badge badge-danger">Paiement en retard</span> : null}
          </div>
          {g.label && <p className="muted small" style={{ margin: 0 }}>{g.label}</p>}
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {can('direction', 'agent', 'comptable') && sum.remaining > 0 && <button className="btn btn-primary" onClick={() => setPaying(true)}>Encaisser pour le dossier</button>}
          {client && <a className="btn" target="_blank" rel="noreferrer" href={whatsappLink(client.contactPhone || client.phone, msg, cc)}>Envoyer le récapitulatif</a>}
          <button className="btn btn-ghost" onClick={copy}>Copier le message</button>
          {can('direction', 'agent') && <button className="btn btn-ghost" onClick={() => setEditing(true)}>Renommer</button>}
          <button className="btn btn-dark" onClick={() => window.print()}>Imprimer le relevé</button>
        </div>
      </header>

      <section className="kpis no-print">
        <div className="card kpi"><span className="kpi-label">Véhicules</span><strong className="kpi-value">{sum.active.length}</strong></div>
        <div className="card kpi"><span className="kpi-label">Facturé</span><strong className="kpi-value">{money(sum.owed)}</strong></div>
        <div className="card kpi"><span className="kpi-label">Déjà réglé</span><strong className="kpi-value">{money(sum.paid)}</strong></div>
        <div className="card kpi">
          <span className="kpi-label">Reste à payer</span>
          <strong className="kpi-value" style={{ color: sum.remaining ? 'var(--ocre-text)' : undefined }}>{money(sum.remaining)}</strong>
          {sum.depositMissing > 0 && <span className="small muted">dont acompte attendu {money(sum.depositMissing)}</span>}
        </div>
      </section>

      <section className="card no-print">
        <h2>Véhicules du dossier</h2>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Contrat</th><th>Véhicule</th><th>Chauffeur</th><th>Période</th><th className="right">Facturé</th><th className="right">Reste</th><th>Statut</th></tr></thead>
            <tbody>
              {sum.reservations.map((r) => {
                const ps = payState(r, data.invoices, data.payments, now);
                const d = r.driverId ? drv.get(r.driverId) : undefined;
                const v = veh.get(r.vehicleId);
                return (
                  <tr key={r.id}>
                    <td className="num"><Link to={`/reservations/${r.id}`}><strong>{r.number}</strong></Link></td>
                    <td>{vLabel(r.vehicleId)}{r.passengers ? <><br /><span className="muted small">{r.passengers} passager(s)</span></> : null}</td>
                    <td>
                      {r.withDriver ? (d ? d.name : <span style={{ color: 'var(--ocre-text)' }}>À désigner</span>) : <span className="muted">Sans chauffeur</span>}
                      {d && (r.status === 'reservee' || r.status === 'en_cours') && (
                        <><br /><a className="small" target="_blank" rel="noreferrer" href={whatsappLink(d.phone, missionSheet(r, client, v, d, org.name), cc)}>Feuille de mission</a></>
                      )}
                    </td>
                    <td>{dateShort(r.start)} {time(r.start)} → {dateShort(r.end)} {time(r.end)}</td>
                    <td className="right num">{money(ps.owed)}</td>
                    <td className="right num">{ps.remaining ? money(ps.remaining) : <span className="badge badge-success">{payStatusLabel[ps.status][0]}</span>}</td>
                    <td><ReservationBadge status={r.status} late={lateDays(r, now)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          Chaque véhicule a son contrat, son état des lieux et sa facture ; ce dossier les réunit. Pour ajouter un véhicule, créez une réservation pour {client?.name ?? 'ce client'} puis rattachez-la ici.
        </p>
        {can('direction', 'agent') && <AttachReservation groupId={g.id} clientId={g.clientId} />}
      </section>

      <article className="paper">
        <header className="ct-head">
          <div className="ct-brand">
            {s.logo && <img src={s.logo} alt="" className="ct-logo" />}
            <div>
              <div className="ct-org">{s.legalName}</div>
              <div className="ct-small">
                {[s.address, s.city].filter(Boolean).join(', ')}
                {(s.phone || s.email) && <br />}
                {[s.phone, s.email].filter(Boolean).join(' · ')}
                {s.registration && <br />}
                {s.registration}
              </div>
            </div>
          </div>
          <div className="ct-title">
            <div>Relevé de dossier</div>
            <strong>N° {g.number}</strong>
            <div className="ct-small">Au {dateLong(now.toISOString())}</div>
          </div>
        </header>

        <div className="ct-grid">
          <section>
            <h3>Client</h3>
            {b && (
              <>
                <div style={{ fontWeight: 600 }}>{b.name}</div>
                <div className="ct-small">
                  {[b.address, b.city].filter(Boolean).join(', ')}
                  {b.kind === 'entreprise' && legalLine(b, taxIdLabel(org.country)) && <><br />{legalLine(b, taxIdLabel(org.country))}</>}
                  {b.contactName && <><br />À l’attention de {b.contactName}</>}
                  <br />{[b.phone, b.email].filter(Boolean).join(' · ')}
                </div>
              </>
            )}
          </section>
          <section>
            <h3>Dossier</h3>
            <dl className="ct-dl">
              {g.label && <><dt>Objet</dt><dd>{g.label}</dd></>}
              <dt>Véhicules</dt><dd>{sum.active.length}</dd>
              {starts.length > 0 && <><dt>Période</dt><dd>du {dateLong(starts[0])} au {dateLong(ends[ends.length - 1])}</dd></>}
              <dt>Modalités</dt><dd style={{ fontWeight: 400 }}>{terms.label}</dd>
            </dl>
          </section>
        </div>

        <table className="ct-table">
          <thead><tr><th>Contrat</th><th>Véhicule</th><th>Période</th><th>Factures</th><th className="right">Montant</th></tr></thead>
          <tbody>
            {sum.reservations.map((r) => {
              const ps = payState(r, data.invoices, data.payments, now);
              const nums = invoices.filter((i) => i.reservationId === r.id).map((i) => i.number).join(', ');
              return (
                <tr key={r.id}>
                  <td>{r.number}{r.status === 'annulee' ? ' (annulé)' : ''}</td>
                  <td>{vLabel(r.vehicleId)}{r.withDriver ? ', avec chauffeur' : ''}</td>
                  <td>{dateShort(r.start)} → {dateShort(r.end)}</td>
                  <td>{nums || '—'}</td>
                  <td className="right">{money(ps.owed)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <table className="ct-table ct-money" style={{ width: '55%', marginLeft: 'auto' }}>
          <tbody>
            <tr><td>Total facturé{billing.settings.vatEnabled ? ' TTC' : ''}</td><td>{money(sum.owed)}</td></tr>
            <tr><td>Déjà réglé</td><td>{money(sum.paid)}</td></tr>
            <tr className="ct-total"><td>Reste à payer</td><td>{money(sum.remaining)}</td></tr>
            {sum.depositMissing > 0 && <tr><td>Dont acompte attendu pour confirmer</td><td>{money(sum.depositMissing)}</td></tr>}
            {sum.caution > 0 && <tr><td>Cautions remboursables, au départ</td><td>{money(sum.caution)}</td></tr>}
          </tbody>
        </table>

        {pays.length > 0 && (
          <section className="ct-avoid-break">
            <h3>Paiements reçus</h3>
            <table className="ct-table">
              <thead><tr><th>Date</th><th>Contrat</th><th>Moyen</th><th>Référence</th><th className="right">Montant</th></tr></thead>
              <tbody>
                {pays.map((p) => (
                  <tr key={p.id}>
                    <td>{p.paidAt ? dateLong(p.paidAt) : ''}</td>
                    <td>{number.get(p.reservationId)}</td>
                    <td>{methodLabel[p.method]}</td>
                    <td>{p.reference ?? ''}</td>
                    <td className="right">{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {sum.remaining > 0 && payees.length > 0 && (
          <section className="ct-avoid-break">
            <h3>Comment payer</h3>
            <p className="ct-small" style={{ margin: 0 }}>{payees.join(' · ')}. Un seul paiement pour tout le dossier : indiquez la référence {g.number}.</p>
          </section>
        )}

        <p className="ct-small" style={{ marginTop: 'auto' }}>
          Ce relevé récapitule les factures du dossier ; il ne remplace pas les factures, qui font foi.
          {' '}{billing.settings.invoiceFooter || `${s.legalName}${s.registration ? ` · ${s.registration}` : ''}`}
        </p>
      </article>

      {paying && <PayGroupDialog groupId={g.id} onClose={() => setPaying(false)} />}
      {editing && (
        <RenameDialog
          label={g.label ?? ''}
          onClose={() => setEditing(false)}
          onSave={async (label) => {
            await store.update('reservation_groups', g.id, { label: label.trim() || null });
            await refresh();
            toast('Dossier renommé');
            setEditing(false);
          }}
        />
      )}
    </>
  );
}

function RenameDialog({ label, onClose, onSave }: { label: string; onClose: () => void; onSave: (l: string) => Promise<void> }) {
  const [v, setV] = useState(label);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Nom du dossier" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); onSave(v).catch((err) => setError((err as Error).message)); }}>
        <label className="field">Nom<input value={v} maxLength={120} onChange={(e) => setV(e.target.value)} placeholder="Ex. : Circuit Casamance" /></label>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

/** Rattache au dossier une réservation existante du même client. */
function AttachReservation({ groupId, clientId }: { groupId: string; clientId: string }) {
  const { data, store, refresh, toast } = useData();
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);
  const loose = data.reservations.filter((r) => r.clientId === clientId && !r.groupId && (r.status === 'reservee' || r.status === 'en_cours'));
  if (loose.length === 0) return null;
  return (
    <form className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={async (e) => {
      e.preventDefault();
      if (!pick) return;
      try {
        await store.update('reservations', pick, { groupId });
        await refresh();
        toast('Réservation rattachée au dossier');
        setPick('');
      } catch (err) {
        setError((err as Error).message);
      }
    }}>
      <label className="field grow">
        Rattacher une autre réservation de ce client
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Choisir</option>
          {loose.map((r) => {
            const v = data.vehicles.find((x) => x.id === r.vehicleId);
            return <option key={r.id} value={r.id}>{r.number} · {v ? `${v.brand} ${v.model}` : ''} · {dateShort(r.start)}</option>;
          })}
        </select>
      </label>
      <button className="btn" disabled={!pick}>Rattacher</button>
      <ErrorBox error={error} />
    </form>
  );
}

function PayGroupDialog({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const { data, store, refresh, toast, now } = useData();
  const sum = groupSummary(groupId, data.reservations, data.invoices, data.payments, now);
  const [amount, setAmount] = useState(String(sum.depositMissing || sum.remaining));
  const [method, setMethod] = useState<PaymentMethod>('wave');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsRef = method === 'cheque' || method === 'virement';
  const items = sum.active.map((r) => {
    const ps = payState(r, data.invoices, data.payments, now);
    return { reservationId: r.id, remaining: ps.remaining, depositMissing: ps.depositMissing, reserved: r.status === 'reservee' };
  });
  let preview: ReturnType<typeof allocatePayment> = [];
  let previewError: string | null = null;
  try {
    preview = Number(amount) > 0 ? allocatePayment(Number(amount), items) : [];
  } catch (e) {
    previewError = (e as Error).message;
  }
  const num = new Map(sum.reservations.map((r) => [r.id, r.number]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (needsRef && !reference.trim()) return setError(method === 'cheque' ? 'Indiquez le numéro du chèque.' : 'Indiquez la référence du virement.');
    setBusy(true);
    try {
      const out = await payGroup(store, groupId, data, Number(amount), method, reference);
      await refresh();
      toast(`${money(out.reduce((s, p) => s + p.amount, 0))} encaissés sur ${out.length} contrat(s)`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Encaisser pour le dossier" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="notice" style={{ margin: 0 }}>
          Facturé {money(sum.owed)} · déjà payé {money(sum.paid)} · <strong>reste {money(sum.remaining)}</strong>
          {sum.depositMissing > 0 && <> · acompte attendu {money(sum.depositMissing)}</>}
        </div>
        <div className="grid-2">
          <label className="field">
            Montant reçu (FCFA)
            <input type="number" min={1} step={1} required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="field">
            Moyen de paiement
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {Object.entries(methodLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
        {method !== 'especes' && (
          <label className="field">
            Référence{needsRef ? '' : ' (recommandé)'}
            <input value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
          </label>
        )}
        {preview.length > 0 && (
          <div className="small">
            Répartition : {preview.map((p, i) => <span key={p.reservationId}>{i > 0 && ' · '}{num.get(p.reservationId)} {p.kind === 'acompte' ? 'acompte' : 'solde'} {money(p.amount)}</span>)}
          </div>
        )}
        {previewError && <div className="error">{previewError}</div>}
        <p className="hint" style={{ margin: 0 }}>Les acomptes manquants sont couverts d’abord, puis les soldes, dans l’ordre des départs. Les cautions s’encaissent véhicule par véhicule, au départ.</p>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || !preview.length}>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
