import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorBox, Modal } from '../components/ui';
import { convertQuote } from '../data/services';
import { whatsappLink } from '../domain/booking';
import { payeeLines, termsFor } from '../domain/billing';
import { legalLine, taxIdLabel } from '../domain/clients';
import { contractSettings } from '../domain/contract';
import { dateLong, money, num } from '../domain/format';
import { quoteBillTo, quoteLines, quoteMessage, quoteSlots, quoteState, quoteStateLabel, quoteSummary, quoteTotals } from '../domain/quotes';
import { findConflicts } from '../domain/rules';
import { formulaLabel } from '../domain/tariff';
import { vtcOverlap } from '../domain/vtc';
import type { Quote } from '../domain/types';
import { useData } from '../state/DataContext';
import { useBilling } from '../state/useBilling';

export function QuotePage() {
  const { id } = useParams();
  const { data, session, now, store, refresh, toast, can } = useData();
  const billing = useBilling();
  const [converting, setConverting] = useState(false);
  const q = data.quotes.find((x) => x.id === id);
  if (!q) {
    return (
      <div className="card">
        <p>Devis introuvable.</p>
        <Link to="/devis">Retour aux devis</Link>
      </div>
    );
  }
  const client = data.clients.find((c) => c.id === q.clientId);
  const org = session!.org;
  const s = contractSettings(org.name, org.contract);
  const st = quoteState(q, now);
  const t = quoteTotals(q, billing.settings);
  const lines = quoteLines(q);
  const b = client ? quoteBillTo(client) : null;
  const payees = payeeLines(billing.settings.payees);
  const terms = termsFor(billing.settings, client);
  const msg = client ? quoteMessage(q, client, s.legalName, billing.settings) : '';
  const editable = can('direction', 'agent');
  const open = st === 'envoye' || st === 'accepte' || st === 'expire';
  const reservations = data.reservations.filter((r) => q.reservationIds.includes(r.id));
  const d = (iso: string) => dateLong(iso.length === 10 ? iso + 'T12:00:00' : iso);

  async function setStatus(status: Quote['status']) {
    await store.update('quotes', q!.id, { status });
    await refresh();
    toast(status === 'accepte' ? 'Devis accepté' : status === 'refuse' ? 'Devis marqué refusé' : 'Devis remis en attente');
  }
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
          <span className="small muted"><Link to="/devis">Devis</Link>{client && <> · <Link to={`/clients/${client.id}`}>{client.name}</Link></>}</span>
          <div className="row">
            <h1>Devis {q.number}</h1>
            <span className={`badge ${quoteStateLabel[st][1]}`}>{quoteStateLabel[st][0]}</span>
          </div>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {editable && open && <button className="btn btn-primary" onClick={() => setConverting(true)}>Transformer en réservation</button>}
          {editable && st === 'envoye' && <button className="btn" onClick={() => setStatus('accepte')}>Accepté</button>}
          {editable && open && <button className="btn btn-ghost" onClick={() => setStatus('refuse')}>Refusé</button>}
          {editable && st === 'refuse' && <button className="btn btn-ghost" onClick={() => setStatus('envoye')}>Remettre en attente</button>}
          {client && <a className="btn" href={whatsappLink(client.contactPhone || client.phone, msg)} target="_blank" rel="noreferrer">WhatsApp</a>}
          {client && <button className="btn btn-ghost" onClick={copy}>Copier le message</button>}
          <button className="btn btn-dark" onClick={() => window.print()}>Imprimer ou PDF</button>
        </div>
      </header>

      {st === 'expire' && <p className="notice no-print">Ce devis a expiré le {d(q.validUntil)}. Vous pouvez encore le transformer si le client confirme ; vérifiez d’abord les prix.</p>}
      {reservations.length > 0 && (
        <p className="notice no-print">
          Réservé : {reservations.map((r, i) => <span key={r.id}>{i > 0 && ', '}<Link to={`/reservations/${r.id}`}>{r.number}</Link></span>)}
        </p>
      )}

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
            <div>Devis</div>
            <strong>N° {q.number}</strong>
            <div className="ct-small">Établi le {d(q.createdAt)}<br />Valable jusqu’au {d(q.validUntil)}</div>
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
            <h3>Prestation</h3>
            <dl className="ct-dl">
              <dt>Formule</dt><dd>{formulaLabel(q.formula)}{q.packageLabel ? ` · ${q.packageLabel}` : ''}</dd>
              <dt>Véhicules</dt><dd>{(q.extras ?? []).length ? quoteSummary(q) : `${q.quantity} × ${q.category}`}{q.withDriver ? ', avec chauffeur' : ''}</dd>
              {q.passengers ? <><dt>Passagers</dt><dd>{q.passengers}</dd></> : null}
              <dt>Départ</dt><dd>{d(q.start)}</dd>
              {q.formula === 'jour' && <><dt>Retour</dt><dd>{d(q.end)}</dd></>}
              {q.itinerary && <><dt>Itinéraire</dt><dd>{q.itinerary}</dd></>}
              <dt>Kilométrage</dt><dd>{q.detail.kmIncluded === null ? 'non compté' : `${num(q.detail.kmIncluded)} km inclus par véhicule`}</dd>
              <dt>Carburant</dt><dd>{q.fuelIncluded ? 'inclus' : 'à la charge du client'}</dd>
              <dt>Hors du pays</dt><dd>{q.crossBorder || 'non autorisé'}</dd>
            </dl>
          </section>
        </div>

        <table className="ct-table">
          <thead><tr><th>Désignation</th><th className="right">Qté</th><th className="right">Prix unitaire HT</th><th className="right">Montant HT</th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{l.label}</td>
                <td className="right">{num(l.quantity)} {l.unit}{l.quantity > 1 && l.unit === 'jour' ? 's' : ''}</td>
                <td className="right">{money(l.unitPrice)}</td>
                <td className="right">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="ct-table ct-money" style={{ width: '55%', marginLeft: 'auto' }}>
          <tbody>
            <tr><td>Total HT</td><td>{money(t.totalHt)}</td></tr>
            <tr><td>{t.vatRate ? `TVA ${num(t.vatRate)} %` : 'TVA'}</td><td>{t.vatRate ? money(t.vat) : 'Non applicable'}</td></tr>
            <tr className="ct-total"><td>Total TTC</td><td>{money(t.totalTtc)}</td></tr>
            {(q.extras ?? []).length
              ? quoteSlots(q).some((x) => x.caution > 0) && <tr><td>Cautions remboursables, au total</td><td>{money(quoteSlots(q).reduce((n, x) => n + x.caution, 0))}</td></tr>
              : q.caution > 0 && <tr><td>Caution remboursable, par véhicule</td><td>{money(q.caution)}</td></tr>}
          </tbody>
        </table>

        {(q.detail.dealNote || q.detail.seasonNote) && (
          <p className="ct-small" style={{ margin: 0 }}>{[q.detail.dealNote, q.detail.seasonNote && `Tarif saisonnier : ${q.detail.seasonNote}`].filter(Boolean).join(' · ')}</p>
        )}
        {q.notes && <p className="ct-small" style={{ margin: 0 }}>{q.notes}</p>}

        <section className="ct-avoid-break">
          <h3>Conditions</h3>
          <p className="ct-small" style={{ margin: 0 }}>
            {terms.label}. Prix garantis jusqu’au {d(q.validUntil)}, sous réserve de disponibilité des véhicules à la confirmation.
            {payees.length > 0 && <> Paiement : {payees.join(' · ')}.</>}
          </p>
        </section>

        <div className="ct-grid ct-avoid-break" style={{ marginTop: 'auto' }}>
          <section><h3>Pour {s.legalName}</h3><div style={{ height: 50 }} /></section>
          <section><h3>Bon pour accord, date et signature du client</h3><div style={{ height: 50 }} /></section>
        </div>
      </article>
      {converting && <ConvertDialog q={q} onClose={() => setConverting(false)} />}
    </>
  );
}

function ConvertDialog({ q, onClose }: { q: Quote; onClose: () => void }) {
  const { data, store, refresh, toast } = useData();
  const billing = useBilling();
  const nav = useNavigate();
  const slots = quoteSlots(q);
  const busyOf = (id: string) => findConflicts(id, q.start, q.end, data.reservations, data.maintenances).length > 0 || !!vtcOverlap(id, q.start, q.end, data.vtc_contracts);
  const candidatesOf = (cat: string) => data.vehicles.filter((v) => v.category === cat && !v.outOfService).map((v) => ({ v, busy: busyOf(v.id) }));
  // Pré-remplissage : les premiers véhicules libres de chaque catégorie.
  const [picked, setPicked] = useState<string[]>(() => {
    const used = new Set<string>();
    return slots.map((sl) => {
      const v = candidatesOf(sl.category).find((c) => !c.busy && !used.has(c.v.id));
      if (v) used.add(v.v.id);
      return v?.v.id ?? '';
    });
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const short = [...new Set(slots.map((x) => x.category))]
    .map((cat) => ({ cat, need: slots.filter((x) => x.category === cat).length, free: candidatesOf(cat).filter((c) => !c.busy).length }))
    .filter((x) => x.free < x.need);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await convertQuote(store, data, q, picked, new Date(), billing);
      await refresh();
      toast(created.length > 1 ? `${created.length} réservations créées dans un dossier` : `Réservation ${created[0].number} créée`);
      const gid = created[0]?.groupId;
      nav(created.length === 1 ? `/reservations/${created[0].id}` : gid ? `/dossiers/${gid}` : '/reservations');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Transformer en réservation" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="small" style={{ margin: 0 }}>
          Choisissez {slots.length > 1 ? `les ${slots.length} véhicules` : 'le véhicule'}. Chaque véhicule devient une réservation au prix du devis, facturée aux modalités du client
          {slots.length > 1 ? ', et le tout est réuni dans un dossier de groupe.' : '.'}
        </p>
        {short.map((x) => (
          <div key={x.cat} className="error">Seulement {x.free} {x.cat} libre(s) sur cette période pour {x.need} demandé(s). Libérez un véhicule ou modifiez le devis.</div>
        ))}
        {slots.map((sl, i) => (
          <label key={i} className="field">
            Véhicule {slots.length > 1 ? i + 1 : ''} · {sl.category} ({money(sl.unitTotal)} HT)
            <select required value={picked[i] ?? ''} onChange={(e) => { const p = [...picked]; p[i] = e.target.value; setPicked(p); }}>
              <option value="">Choisir</option>
              {candidatesOf(sl.category).map(({ v, busy: b }) => (
                <option key={v.id} value={v.id} disabled={b || (picked.includes(v.id) && picked[i] !== v.id)}>
                  {v.brand} {v.model} · {v.plate}{v.seats ? ` · ${v.seats} places` : ''}{b ? ' — indisponible' : ''}
                </option>
              ))}
            </select>
          </label>
        ))}
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || picked.filter(Boolean).length !== slots.length}>Créer {slots.length > 1 ? `les ${slots.length} réservations` : 'la réservation'}</button>
        </div>
      </form>
    </Modal>
  );
}
