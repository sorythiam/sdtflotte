import { flightLabel, flightTrackUrl } from '../domain/flight';
import { VerificationBadge } from '../components/VerificationBadge';
import { useBilling } from '../state/useBilling';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, ErrorBox, Modal, ScoreBadge } from '../components/ui';
import { createGroupBooking } from '../data/services';
import { fitsPassengers } from '../domain/tariff';
import { vtcOverlap } from '../domain/vtc';
import { availableByCategory, COUNTRY_CALLING_CODE, matchClient, whatsappLink, type BookingRequest } from '../domain/booking';
import { taxIdLabel } from '../domain/clients';
import { dateTime, money } from '../domain/format';
import { findConflicts, quote } from '../domain/rules';
import { useData } from '../state/DataContext';

type Dialog = null | { kind: 'accept' | 'decline'; req: BookingRequest };

export function BookingRequests() {
  const { data, session, can } = useData();
  const [tab, setTab] = useState<'nouvelle' | 'traitees'>('nouvelle');
  const [dialog, setDialog] = useState<Dialog>(null);
  const org = session!.org;
  const cc = COUNTRY_CALLING_CODE[org.country] ?? '221';
  const taxLabel = taxIdLabel(org.country);
  const canAct = can('direction', 'agent');
  const list = data.bookingRequests.filter((r) => (tab === 'nouvelle' ? r.status === 'nouvelle' : r.status !== 'nouvelle'));
  const pending = data.bookingRequests.filter((r) => r.status === 'nouvelle').length;
  const link = org.bookingSlug ? `${window.location.origin}/r/${org.bookingSlug}` : null;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Demandes en ligne</h1>
          <p className="small muted" style={{ margin: 0 }}>
            {org.bookingEnabled && link ? (
              <>Votre page publique : <a href={link} target="_blank" rel="noreferrer">{link.replace(/^https?:\/\//, '')}</a></>
            ) : (
              <>Votre page de réservation en ligne est fermée. {can() ? <Link to="/parametres">L’ouvrir dans Paramètres</Link> : 'Un administrateur peut l’ouvrir dans Paramètres.'}</>
            )}
          </p>
        </div>
      </header>
      <div className="tabs" role="group" aria-label="Filtre">
        <button type="button" aria-selected={tab === 'nouvelle'} onClick={() => setTab('nouvelle')}>À traiter ({pending})</button>
        <button type="button" aria-selected={tab === 'traitees'} onClick={() => setTab('traitees')}>Traitées</button>
      </div>

      {list.length === 0 ? (
        <section className="card">
          <Empty>{tab === 'nouvelle' ? 'Aucune demande en attente.' : 'Aucune demande traitée pour l’instant.'}</Empty>
        </section>
      ) : (
        list.map((req) => {
          const rate = data.rates.find((r) => r.category === req.category);
          const q = rate ? quote(rate, req.start, req.end, req.withDriver) : null;
          const n = req.quantity ?? 1;
          const free = availableByCategory(data.vehicles, data.reservations, data.maintenances, req.start, req.end, req.passengers ? Math.ceil(req.passengers / n) : null, data.vtc_contracts)[req.category] ?? 0;
          const known = matchClient(data.clients, req.phone, req.email);
          const res = req.reservationId ? data.reservations.find((r) => r.id === req.reservationId) : undefined;
          const first = req.name.split(' ')[0];
          const waText =
            req.status === 'acceptee' && res
              ? `Bonjour ${first}, votre réservation ${n > 1 ? `de ${n} × ` : ''}${req.category}${req.flightNumber ? ` (vol ${req.flightNumber})` : ''} du ${dateTime(req.start)} au ${dateTime(req.end)} est confirmée (${n > 1 && res.groupId ? `dossier ${data.reservation_groups.find((g) => g.id === res.groupId)?.number ?? res.number}` : `contrat ${res.number}, total ${money(res.total)}, caution ${money(res.caution)}`}). ${org.name}`
              : req.status === 'refusee'
                ? `Bonjour ${first}, merci pour votre demande. Malheureusement nous ne pouvons pas y donner suite${req.declineReason ? ` : ${req.declineReason}` : ''}. ${org.name}`
                : `Bonjour ${first}, nous avons bien reçu votre demande de ${req.category} du ${dateTime(req.start)} au ${dateTime(req.end)}. `;
          return (
            <section key={req.id} className="card" aria-label={`Demande de ${req.companyName ?? req.name}`}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ margin: 0 }}>{req.companyName ?? req.name}</h2>
                  {req.companyName && (
                    <div className="small">
                      Entreprise · contact : <strong>{req.name}</strong>{req.companyTaxId ? ` · ${taxLabel} ${req.companyTaxId}` : ''}
                    </div>
                  )}
                  <div className="small muted">
                    Reçue le {dateTime(req.createdAt)}
                    {known && <> · client connu : <Link to={`/clients/${known.id}`}><strong>{known.name}</strong></Link>{' '}<VerificationBadge client={known} /> <ScoreBadge score={known.score} />{known.scoreReason && known.score !== 'fiable' ? ` (${known.scoreReason})` : ''}</>}
                  </div>
                </div>
                {req.status === 'nouvelle' ? (
                  <span className={`badge ${free >= n ? 'badge-success' : free > 0 ? 'badge-warning' : 'badge-danger'}`}>{free > 0 ? `${free} véhicule${free > 1 ? 's' : ''} libre${free > 1 ? 's' : ''}${n > 1 ? ` pour ${n} demandés` : ''}` : 'Aucun véhicule libre'}</span>
                ) : req.status === 'acceptee' ? (
                  <span className="badge badge-success">Acceptée</span>
                ) : (
                  <span className="badge badge-muted">Refusée</span>
                )}
              </div>
              <div className="grid-3 small">
                <div><span className="muted">Demande</span><br /><strong>{n > 1 ? `${n} × ` : ''}{req.category}</strong>{req.withDriver ? ' avec chauffeur' : ''}{req.passengers ? `, ${req.passengers} passager${req.passengers > 1 ? 's' : ''}` : ''}</div>
                <div><span className="muted">Période</span><br />{dateTime(req.start)} → {dateTime(req.end)}</div>
                {flightLabel(req) && (
                  <div style={{ gridColumn: '1 / -1' }}><span className="muted">Transfert aéroport</span><br /><strong>{flightLabel(req)}</strong> · <a href={flightTrackUrl(req.flightNumber!)} target="_blank" rel="noreferrer">suivre le vol</a></div>
                )}
                <div><span className="muted">Prix au tarif actuel</span><br />{q ? <><strong>{money(q.total * n)}</strong> · {q.days} j · caution {money(q.caution)}{n > 1 ? ' par véhicule' : ''}</> : 'Pas de tarif pour cette catégorie'}</div>
              </div>
              {req.message && <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap', background: 'var(--sable)', padding: 'var(--space-3)', borderRadius: 8 }}>{req.message}</p>}
              {req.status === 'refusee' && req.declineReason && <p className="small muted" style={{ margin: 0 }}>Motif du refus : {req.declineReason}</p>}
              <div className="row">
                <a className="btn btn-sm" href={whatsappLink(req.phone, waText, cc)} target="_blank" rel="noreferrer">WhatsApp</a>
                <a className="btn btn-sm" href={`tel:${req.phone.replace(/[^\d+]/g, '')}`}>Appeler {req.phone}</a>
                {req.email && <a className="btn btn-sm" href={`mailto:${req.email}`}>Email</a>}
                {res && (res.groupId && n > 1
                  ? <Link className="btn btn-sm" to={`/dossiers/${res.groupId}`}>Voir le dossier</Link>
                  : <Link className="btn btn-sm" to={`/reservations/${res.id}`}>Voir la réservation {res.number}</Link>)}
                {req.status === 'nouvelle' && canAct && (
                  <>
                    <span style={{ flex: 1 }} />
                    <button className="btn btn-sm btn-ghost" onClick={() => setDialog({ kind: 'decline', req })}>Refuser</button>
                    <button className="btn btn-sm btn-primary" onClick={() => setDialog({ kind: 'accept', req })}>Créer la réservation</button>
                  </>
                )}
              </div>
            </section>
          );
        })
      )}

      {dialog?.kind === 'accept' && <AcceptDialog req={dialog.req} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'decline' && <DeclineDialog req={dialog.req} onClose={() => setDialog(null)} />}
    </>
  );
}

function AcceptDialog({ req, onClose }: { req: BookingRequest; onClose: () => void }) {
  const { data, store, refresh, toast } = useData();
  const billing = useBilling();
  const nav = useNavigate();
  const known = matchClient(data.clients, req.phone, req.email);
  const company = !!req.companyName;
  const n = req.quantity ?? 1;
  const paxPer = req.passengers ? Math.ceil(req.passengers / n) : null;
  const free = useMemo(
    () =>
      data.vehicles
        .filter((v) => !v.outOfService && (n > 1 || fitsPassengers(v, paxPer, req.withDriver || !!v.driverRequired)) && !vtcOverlap(v.id, req.start, req.end, data.vtc_contracts) && findConflicts(v.id, req.start, req.end, data.reservations, data.maintenances).length === 0)
        .sort((a, b) => Number(b.category === req.category) - Number(a.category === req.category) || a.plate.localeCompare(b.plate)),
    [data, req, n, paxPer],
  );
  const [picked, setPicked] = useState<string[]>(() => {
    const same = free.filter((v) => v.category === req.category).map((v) => v.id);
    return Array.from({ length: n }, (_, i) => same[i] ?? '');
  });
  const [notes, setNotes] = useState(req.message ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setError(null);
    setBusy(true);
    try {
      const client =
        known ??
        (await store.insert(
          'clients',
          company
            ? {
                kind: 'entreprise', name: req.companyName!, phone: req.phone, email: req.email, idNumber: null, licenseExpiry: null,
                score: 'fiable', taxId: req.companyTaxId ?? null, contactName: req.name, contactPhone: req.phone, contactEmail: req.email,
              }
            : { kind: 'particulier', name: req.name, phone: req.phone, email: req.email, idNumber: null, licenseExpiry: null, score: 'fiable' },
        ));
      const { group, reservations } = await createGroupBooking(store, { ...data, clients: known ? data.clients : [...data.clients, client] }, {
        clientId: client.id, start: req.start, end: req.end, withDriver: req.withDriver, passengers: req.passengers ?? null,
        transferKind: req.transferKind ?? null, flightNumber: req.flightNumber ?? null, flightAt: req.flightAt ?? null,
        notes: [notes.trim(), 'Demande reçue en ligne.'].filter(Boolean).join('\n'),
      }, picked.map((vehicleId) => ({ vehicleId })), `Demande en ligne de ${req.companyName ?? req.name}`, new Date(), { ...billing, clients: known ? data.clients : [...data.clients, client] });
      const r = reservations[0];
      await store.updateBookingRequest(req.id, { status: 'acceptee', reservationId: r.id });
      await refresh();
      toast(group ? `Dossier ${group.number} créé : ${reservations.length} réservations. Pensez à prévenir le client.` : `Réservation ${r.number} créée. Pensez à prévenir le client.`);
      onClose();
      nav(group ? `/dossiers/${group.id}` : `/reservations/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Réservation pour ${req.companyName ?? req.name}`} onClose={onClose}>
      <p className="small" style={{ margin: 0 }}>
        {n > 1 ? `${n} × ` : ''}{req.category}{req.withDriver ? ' avec chauffeur' : ''}, du {dateTime(req.start)} au {dateTime(req.end)}.{flightLabel(req) ? ` ${flightLabel(req)}.` : ''}{' '}
        {known ? (
          <>Client existant : <strong>{known.name}</strong>.</>
        ) : company ? (
          <>Nouveau client entreprise « {req.companyName} », contact {req.name}. Complétez ensuite son adresse, son RCCM et la pièce du conducteur.</>
        ) : (
          <>Nouveau client créé avec ce nom et ce téléphone ; complétez sa pièce et son permis ensuite.</>
        )}
      </p>
      {picked.map((vid, i) => (
        <label key={i} className="field">
          Véhicule{n > 1 ? ` ${i + 1}` : ''}
          <select value={vid} onChange={(e) => setPicked(picked.map((x, j) => (j === i ? e.target.value : x)))}>
            <option value="">Choisir un véhicule libre…</option>
            {free.map((v) => (
              <option key={v.id} value={v.id} disabled={v.id !== vid && picked.includes(v.id)}>
                {v.brand} {v.model} · {v.plate} · {v.category}{v.seats ? ` · ${v.seats} places` : ''}{v.category !== req.category ? ' (autre catégorie)' : ''}
              </option>
            ))}
          </select>
          {i === 0 && free.length < n && <span className="hint">{free.length ? `Seulement ${free.length} véhicule(s) libre(s) pour ${n} demandés.` : 'Aucun véhicule libre sur ces dates.'} Proposez d’autres dates au client ou refusez la demande.</span>}
        </label>
      ))}
      {n > 1 && <p className="hint" style={{ margin: 0 }}>Les {n} réservations seront réunies dans un dossier de groupe, avec un relevé unique pour le client.</p>}
      <label className="field">
        Notes du contrat
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <ErrorBox error={error} />
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button type="button" className="btn btn-primary" disabled={picked.some((x) => !x) || busy} onClick={confirm}>{n > 1 ? `Créer les ${n} réservations` : 'Créer la réservation'}</button>
      </div>
    </Modal>
  );
}

const REASONS = ['Plus de véhicule disponible sur ces dates', 'Durée ou trajet non accepté', 'Client injoignable', 'Demande en double'];

function DeclineDialog({ req, onClose }: { req: BookingRequest; onClose: () => void }) {
  const { store, refresh, toast } = useData();
  const [reason, setReason] = useState(REASONS[0]);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    try {
      await store.updateBookingRequest(req.id, { status: 'refusee', declineReason: reason.trim() || null });
      await refresh();
      toast('Demande refusée. Vous pouvez prévenir le client par WhatsApp depuis l’onglet Traitées.');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal title={`Refuser la demande de ${req.name} ?`} onClose={onClose}>
      <label className="field">
        Motif (visible dans le message WhatsApp proposé)
        <input list="motifs" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <datalist id="motifs">{REASONS.map((r) => <option key={r} value={r} />)}</datalist>
      </label>
      <ErrorBox error={error} />
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Garder la demande</button>
        <button type="button" className="btn btn-danger" onClick={confirm}>Refuser</button>
      </div>
    </Modal>
  );
}
