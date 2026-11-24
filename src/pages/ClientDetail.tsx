import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lightbox, shrinkPhoto } from '../components/photos';
import { Empty, ErrorBox, Modal, ReservationBadge, ScoreBadge } from '../components/ui';
import { VerificationBadge } from '../components/VerificationBadge';
import { contractSettings } from '../domain/contract';
import { payState } from '../domain/billing';
import { dateLong, dateShort, money } from '../domain/format';
import type { Client, DocSlot, IdType, Incident, IncidentKind } from '../domain/types';
import { DOC_SLOTS, historyOf, ID_TYPES, INCIDENT_KINDS, incidentLabel, verificationOf } from '../domain/verification';
import { useData } from '../state/DataContext';
import { useSignedUrls } from '../state/useSignedUrls';
import { ClientForm } from './Clients';

export function ClientDetail() {
  const { id } = useParams();
  const { data, now, can, session, store, refresh, toast } = useData();
  const [editing, setEditing] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);
  const c = data.clients.find((x) => x.id === id);
  const docPaths = useMemo(() => Object.values(c?.documents ?? {}).filter(Boolean) as string[], [c?.documents]);
  const seeDocs = can('direction', 'agent');
  const urls = useSignedUrls(seeDocs ? docPaths : [], 'client');
  const [viewer, setViewer] = useState<number | null>(null);
  if (!c) {
    return (
      <div className="card">
        <p>Client introuvable.</p>
        <Link to="/clients">Retour aux clients</Link>
      </div>
    );
  }
  const rules = contractSettings(session!.org.name, session!.org.contract);
  const v = verificationOf(c, now, rules.minDriverAge);
  const h = historyOf(c.id, data.reservations, data.inspections, data.incidents);
  const editable = can('direction', 'agent');
  const reservations = data.reservations.filter((r) => r.clientId === c.id).sort((a, b) => b.start.localeCompare(a.start));
  const veh = new Map(data.vehicles.map((x) => [x.id, x]));
  const company = c.kind === 'entreprise';
  const docs = c.documents ?? {};
  const shown = DOC_SLOTS.filter((d) => docs[d.slot]);
  const hasDeal = !!c.dealDiscount || Object.keys(c.dealRates ?? {}).length > 0;
  const dealExpired = !!c.dealUntil && c.dealUntil < now.toISOString().slice(0, 10);
  const clientInvoices = data.invoices.filter((i) => i.clientId === c.id).sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number));
  const fin = reservations.reduce(
    (acc, r) => {
      const st = payState(r, data.invoices, data.payments, now);
      acc.billed += st.owed;
      acc.paid += st.paid;
      acc.due += st.remaining;
      if (st.status === 'en_retard') acc.late += st.remaining;
      return acc;
    },
    { billed: 0, paid: 0, due: 0, late: 0 },
  );

  async function patch(p: Partial<Client>, msg: string) {
    try {
      await store.update('clients', c!.id, p);
      await refresh();
      toast(msg);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function removeIncident(i: Incident) {
    if (!window.confirm('Retirer cet incident du dossier ?')) return;
    try {
      await store.remove('incidents', i.id);
      await refresh();
      toast('Incident retiré');
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <span className="small muted">
            <Link to="/clients">Clients</Link> › {c.name}
          </span>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <h1>{c.name}</h1>
            <VerificationBadge client={c} />
            <ScoreBadge score={c.score} />
          </div>
          <p className="small muted">
            {company ? 'Entreprise' : 'Particulier'} · {c.phone}
            {c.email ? ` · ${c.email}` : ''}
            {company && c.contactName ? ` · contact : ${c.contactName}${c.contactPhone ? ` (${c.contactPhone})` : ''}` : ''}
          </p>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {can('direction', 'agent') && c.score !== 'blacklist' && <Link className="btn" to={`/devis?nouveau=1&client=${c.id}`}>Faire un devis</Link>}
          {editable && <button className="btn" onClick={() => setEditing(true)}>Modifier la fiche</button>}
        </div>
      </header>

      {c.score !== 'fiable' && (
        <div className={`notice${c.score === 'blacklist' ? ' notice-danger' : ''}`} role="status">
          <strong>{c.score === 'blacklist' ? 'Client blacklisté : aucune réservation possible.' : 'Client à surveiller.'}</strong>
          {c.scoreReason ? ` ${c.scoreReason}` : ''}
        </div>
      )}

      <div className="cols">
        <div className="col-2 stack" style={{ gap: 'var(--space-6)' }}>
          <section className="card" aria-labelledby="verif">
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <h2 id="verif">{company ? 'Conducteur et pièces' : 'Pièces et vérification'}</h2>
              {editable && <button className="btn btn-sm" onClick={() => setDocsOpen(true)}>{docPaths.length || c.licenseNumber ? 'Mettre à jour les pièces' : 'Ajouter les pièces'}</button>}
            </div>
            <dl className="facts">
              <div><dt>Pièce d’identité</dt><dd>{c.idNumber ? `${ID_TYPES.find(([k]) => k === c.idType)?.[1] ?? 'Pièce'} n° ${c.idNumber}` : '—'}{c.idExpiry ? `, valide jusqu’au ${dateLong(c.idExpiry)}` : ''}</dd></div>
              <div><dt>Permis</dt><dd>{c.licenseNumber ? `n° ${c.licenseNumber}${c.licenseCategory ? `, catégorie ${c.licenseCategory}` : ''}` : '—'}{c.licenseExpiry ? `, valide jusqu’au ${dateLong(c.licenseExpiry)}` : ''}</dd></div>
              <div><dt>Date de naissance</dt><dd>{c.birthDate ? dateLong(c.birthDate) : '—'}</dd></div>
            </dl>
            {seeDocs ? (
              shown.length > 0 ? (
                <div className="doc-grid">
                  {shown.map((d, i) => (
                    <button key={d.slot} type="button" className="doc-thumb" onClick={() => setViewer(i)}>
                      {urls[docs[d.slot]!] ? <img src={urls[docs[d.slot]!]} alt={d.label} /> : <span className="muted small">Chargement…</span>}
                      <span className="small">{d.label}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty>Aucune photo de pièce.</Empty>
              )
            ) : (
              <span className="small muted">Les photos des pièces sont réservées à l’accueil et à la direction.</span>
            )}
            {v.state === 'verifie' ? (
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span className="small" style={{ color: 'var(--success)', fontWeight: 600 }}>
                  Dossier vérifié le {dateShort(c.verifiedAt!)}{c.verifiedBy ? ` par ${c.verifiedBy}` : ''}, sur présentation des originaux.
                </span>
                {editable && <button className="btn btn-sm btn-ghost" onClick={() => patch({ verifiedAt: null, verifiedBy: null }, 'Validation retirée')}>Retirer la validation</button>}
              </div>
            ) : (
              <div className="stack" style={{ gap: 'var(--space-2)' }}>
                <ul className="issue-list">
                  {v.issues.map((i) => <li key={i}>{i}</li>)}
                </ul>
                {editable && (
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-primary" disabled={!v.ready}
                      onClick={() => patch({ verifiedAt: now.toISOString(), verifiedBy: session!.userEmail }, 'Dossier client validé')}>
                      J’ai vu les originaux : valider le dossier
                    </button>
                    {!v.ready && <span className="hint">Complétez les pièces pour pouvoir valider.</span>}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="hist">
            <h2 id="hist">Locations</h2>
            {reservations.length === 0 ? (
              <Empty>Aucune location pour l’instant.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Contrat</th><th>Véhicule</th><th>Période</th><th className="right">Montant</th><th>Statut</th></tr></thead>
                  <tbody>
                    {reservations.slice(0, 12).map((r) => (
                      <tr key={r.id}>
                        <td><Link to={`/reservations/${r.id}`}>{r.number}</Link></td>
                        <td>{veh.get(r.vehicleId)?.model} <span className="muted">{veh.get(r.vehicleId)?.plate}</span></td>
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
          {(company || c.dealDiscount || Object.keys(c.dealRates ?? {}).length > 0) && (
            <section className="card" aria-labelledby="cadre">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 id="cadre">Contrat cadre</h2>
                {can('direction') && <button className="btn btn-sm" onClick={() => setDealOpen(true)}>{hasDeal ? 'Modifier' : 'Créer'}</button>}
              </div>
              {!hasDeal ? (
                <Empty>Aucune condition négociée : ce client paie la grille standard.</Empty>
              ) : (
                <>
                  {dealExpired && <div className="notice notice-danger">Contrat cadre expiré le {dateLong(c.dealUntil!)} : la grille standard s’applique.</div>}
                  <dl className="facts">
                    {!!c.dealDiscount && <div><dt>Remise</dt><dd>{c.dealDiscount} % sur la location</dd></div>}
                    {Object.entries(c.dealRates ?? {}).map(([cat, price]) => <div key={cat}><dt>{cat}</dt><dd>{money(price)} / jour</dd></div>)}
                    {c.dealUntil && <div><dt>Valable jusqu’au</dt><dd>{dateLong(c.dealUntil)}</dd></div>}
                  </dl>
                  {c.dealTerms && <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{c.dealTerms}</p>}
                  <span className="hint">Appliqué automatiquement aux nouvelles réservations. Chauffeur et frais de mission au tarif normal.</span>
                </>
              )}
            </section>
          )}

          {can('direction', 'agent', 'comptable') && (
            <section className="card" aria-labelledby="fin">
              <h2 id="fin">Factures et paiements</h2>
              <dl className="facts">
                <div><dt>Facturé TTC</dt><dd>{money(fin.billed)}</dd></div>
                <div><dt>Encaissé</dt><dd>{money(fin.paid)}</dd></div>
                <div><dt>Reste dû</dt><dd style={{ color: fin.due > 0 ? 'var(--ocre-text)' : 'var(--success)' }}>{fin.due > 0 ? money(fin.due) : 'Rien'}</dd></div>
                {fin.late > 0 && <div><dt>Dont en retard</dt><dd style={{ color: 'var(--danger)' }}>{money(fin.late)}</dd></div>}
              </dl>
              {clientInvoices.length > 0 && (
                <ul className="alert-list">
                  {clientInvoices.slice(0, 8).map((i) => (
                    <li key={i.id}>
                      <Link to={`/factures/${i.id}`} className="alert-item" style={{ borderLeftColor: i.kind === 'avoir' ? 'var(--ink-muted)' : 'var(--atlantique)' }}>
                        <strong>{i.kind === 'avoir' ? 'Avoir' : 'Facture'} {i.number} · {money(i.totalTtc)}</strong>
                        <span className="small muted">{dateShort(i.issueDate)}{i.kind !== 'avoir' ? ` · échéance ${dateShort(i.dueDate)}` : ''}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="card" aria-labelledby="comp">
            <h2 id="comp">Comportement</h2>
            <dl className="facts">
              <div><dt>Locations terminées</dt><dd>{h.rentals}</dd></div>
              <div><dt>Retours en retard</dt><dd>{h.late}</dd></div>
              <div><dt>Frais facturés au retour</dt><dd>{money(h.fees)}</dd></div>
              <div><dt>Incidents</dt><dd>{h.incidents.length}{h.graves ? ` dont ${h.graves} grave${h.graves > 1 ? 's' : ''}` : ''}</dd></div>
            </dl>
            {h.suggestion && h.suggestion.score !== c.score && !(c.score === 'blacklist') && (
              <div className="notice">
                Proposition : passer en <strong>{h.suggestion.score === 'blacklist' ? 'blacklisté' : 'à surveiller'}</strong> ({h.suggestion.reason.toLowerCase()}).
                {can('direction') && (
                  <div style={{ marginTop: 8 }}>
                    <button className="btn btn-sm" onClick={() => patch({ score: h.suggestion!.score, scoreReason: h.suggestion!.reason }, 'Scoring mis à jour')}>Appliquer</button>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="inc">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 id="inc">Incidents</h2>
              {can('direction', 'agent', 'mecanicien') && <button className="btn btn-sm" onClick={() => setIncidentOpen(true)}>Signaler</button>}
            </div>
            {h.incidents.length === 0 ? (
              <Empty>Aucun incident enregistré.</Empty>
            ) : (
              <ul className="alert-list">
                {h.incidents.map((i) => (
                  <li key={i.id} className="alert-item" style={{ borderLeftColor: i.severity === 'grave' ? 'var(--danger)' : 'var(--ocre)' }}>
                    <strong>{incidentLabel(i.kind)}{i.severity === 'grave' ? ' · grave' : ''}</strong>
                    <span className="small">{i.note}</span>
                    <span className="small muted">
                      {dateShort(i.occurredOn)}
                      {i.amount > 0 ? ` · ${money(i.amount)}` : ''}
                      {i.reservationId && data.reservations.find((r) => r.id === i.reservationId) ? <> · <Link to={`/reservations/${i.reservationId}`}>{data.reservations.find((r) => r.id === i.reservationId)!.number}</Link></> : ''}
                      {i.createdBy ? ` · ${i.createdBy}` : ''}
                    </span>
                    {can('direction') && <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => removeIncident(i)}>Retirer</button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {editing && <ClientForm id={c.id} onClose={() => setEditing(false)} />}
      {docsOpen && <DocumentsForm client={c} onClose={() => setDocsOpen(false)} />}
      {incidentOpen && <IncidentForm client={c} onClose={() => setIncidentOpen(false)} />}
      {dealOpen && <DealForm client={c} onClose={() => setDealOpen(false)} />}
      {viewer !== null && (
        <Lightbox photos={shown.map((d) => urls[docs[d.slot]!]).filter(Boolean)} start={viewer} title={`Pièces de ${c.name}`} onClose={() => setViewer(null)} />
      )}
    </>
  );
}

/** Numéros, dates et photos des pièces. Toute modification remet le dossier « à vérifier ». */
function DocumentsForm({ client, onClose }: { client: Client; onClose: () => void }) {
  const { store, refresh, toast } = useData();
  const [f, setF] = useState({
    idType: client.idType ?? ('cni' as IdType),
    idNumber: client.idNumber ?? '',
    idExpiry: client.idExpiry ?? '',
    birthDate: client.birthDate ?? '',
    licenseNumber: client.licenseNumber ?? '',
    licenseCategory: client.licenseCategory ?? '',
    licenseExpiry: client.licenseExpiry ?? '',
  });
  const [docs, setDocs] = useState(client.documents ?? {});
  const [busy, setBusy] = useState<DocSlot | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urls = useSignedUrls(Object.values(docs).filter(Boolean) as string[], 'client');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function onPhoto(slot: DocSlot, file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(slot);
    try {
      const path = await store.uploadClientDocument(await shrinkPhoto(file, 1600, 0.85), client.id);
      setDocs((d) => ({ ...d, [slot]: path }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const t = (v: string) => (v.trim() ? v.trim() : null);
    const next: Partial<Client> = {
      idType: f.idType, idNumber: t(f.idNumber), idExpiry: t(f.idExpiry), birthDate: t(f.birthDate),
      licenseNumber: t(f.licenseNumber), licenseCategory: t(f.licenseCategory), licenseExpiry: t(f.licenseExpiry), documents: docs,
    };
    if (next.birthDate && next.birthDate > new Date().toISOString().slice(0, 10)) return setError('Date de naissance invalide.');
    const changed = (Object.keys(next) as (keyof Client)[]).some((k) => JSON.stringify(next[k] ?? null) !== JSON.stringify(client[k] ?? (k === 'documents' ? {} : null)));
    if (client.verifiedAt && changed) Object.assign(next, { verifiedAt: null, verifiedBy: null });
    setBusy('save');
    try {
      await store.update('clients', client.id, next);
      // Photos remplacées : on supprime les anciennes de l'espace privé.
      const old = Object.values(client.documents ?? {}).filter((p) => p && !Object.values(docs).includes(p)) as string[];
      await Promise.all(old.map((p) => store.deleteClientDocument(p).catch(() => undefined)));
      await refresh();
      toast(client.verifiedAt && changed ? 'Pièces enregistrées : dossier à revalider' : 'Pièces enregistrées');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title={`Pièces de ${client.name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {client.kind === 'entreprise' && <span className="hint">Pièces du conducteur habituel ou du signataire, pour les locations sans chauffeur.</span>}
        <fieldset className="stack form-group">
          <legend>Pièce d’identité</legend>
          <div className="grid-2">
            <label className="field">Type<select value={f.idType} onChange={set('idType')}>{ID_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="field">Numéro<input value={f.idNumber} onChange={set('idNumber')} maxLength={40} /></label>
            <label className="field">Valide jusqu’au<input type="date" value={f.idExpiry} onChange={set('idExpiry')} /></label>
            <label className="field">Date de naissance<input type="date" value={f.birthDate} onChange={set('birthDate')} /></label>
          </div>
        </fieldset>
        <fieldset className="stack form-group">
          <legend>Permis de conduire</legend>
          <div className="grid-2">
            <label className="field">Numéro<input value={f.licenseNumber} onChange={set('licenseNumber')} maxLength={40} /></label>
            <label className="field">Catégorie(s)<input value={f.licenseCategory} onChange={set('licenseCategory')} maxLength={20} placeholder="B" /></label>
            <label className="field">Valide jusqu’au<input type="date" value={f.licenseExpiry} onChange={set('licenseExpiry')} /></label>
          </div>
        </fieldset>
        <fieldset className="stack form-group">
          <legend>Photos</legend>
          <div className="doc-grid">
            {DOC_SLOTS.map((d) => {
              const p = docs[d.slot];
              return (
                <div key={d.slot} className="doc-slot">
                  {p && urls[p] ? <img src={urls[p]} alt={d.label} /> : <span className="doc-empty muted small">{busy === d.slot ? 'Envoi…' : 'Aucune photo'}</span>}
                  <strong className="small">{d.label}</strong>
                  <span className="hint">{d.hint}</span>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <label className="btn btn-sm">
                      {p ? 'Reprendre' : 'Photographier'}
                      <input type="file" accept="image/*" capture={d.selfie ? 'user' : 'environment'} className="sr-only" disabled={!!busy} onChange={(e) => void onPhoto(d.slot, e.target.files?.[0])} />
                    </label>
                    <label className="btn btn-sm btn-ghost">
                      Choisir un fichier
                      <input type="file" accept="image/*" className="sr-only" disabled={!!busy} onChange={(e) => void onPhoto(d.slot, e.target.files?.[0])} />
                    </label>
                    {p && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDocs((x) => { const n = { ...x }; delete n[d.slot]; return n; })}>Retirer</button>}
                  </div>
                </div>
              );
            })}
          </div>
          <span className="hint">Les photos restent dans un espace privé de votre entreprise, visibles seulement par l’accueil et la direction.</span>
        </fieldset>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!!busy}>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

function IncidentForm({ client, onClose }: { client: Client; onClose: () => void }) {
  const { data, store, refresh, toast, session, now } = useData();
  const rs = data.reservations.filter((r) => r.clientId === client.id && r.status !== 'annulee').sort((a, b) => b.start.localeCompare(a.start));
  const [f, setF] = useState({ kind: 'retard' as IncidentKind, severity: 'mineur' as 'mineur' | 'grave', occurredOn: now.toISOString().slice(0, 10), amount: '', reservationId: rs[0]?.id ?? '', note: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (f.note.trim().length < 3) return setError('Décrivez l’incident en quelques mots.');
    const amount = Math.max(0, Math.round(Number(f.amount || 0)));
    if (!Number.isFinite(amount)) return setError('Montant invalide.');
    setBusy(true);
    try {
      await store.insert('incidents', {
        clientId: client.id, reservationId: f.reservationId || null, kind: f.kind, severity: f.severity, occurredOn: f.occurredOn,
        amount, note: f.note.trim(), createdBy: session!.userEmail, createdAt: new Date().toISOString(),
      });
      await refresh();
      toast('Incident enregistré');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Signaler un incident · ${client.name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">Type<select value={f.kind} onChange={set('kind')}>{INCIDENT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="field">Gravité<select value={f.severity} onChange={set('severity')}><option value="mineur">Mineur</option><option value="grave">Grave</option></select></label>
          <label className="field">Date<input type="date" required value={f.occurredOn} max={now.toISOString().slice(0, 10)} onChange={set('occurredOn')} /></label>
          <label className="field">Montant en jeu (FCFA)<input type="number" min={0} inputMode="numeric" value={f.amount} onChange={set('amount')} placeholder="0" /></label>
        </div>
        <label className="field">
          Location concernée
          <select value={f.reservationId} onChange={set('reservationId')}>
            <option value="">Aucune</option>
            {rs.map((r) => <option key={r.id} value={r.id}>{r.number} · {dateShort(r.start)}</option>)}
          </select>
        </label>
        <label className="field">Ce qui s’est passé<textarea required rows={3} maxLength={1000} value={f.note} onChange={set('note')} /></label>
        <span className="hint">Restez factuel : ce journal peut être montré au client en cas de litige.</span>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy}>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

/** Contrat cadre : remise globale et/ou prix par jour négociés par catégorie, conditions, validité. */
function DealForm({ client, onClose }: { client: Client; onClose: () => void }) {
  const { data, store, refresh, toast } = useData();
  const [discount, setDiscount] = useState(String(client.dealDiscount ?? 0));
  const [rates, setRates] = useState<Record<string, string>>(
    Object.fromEntries(data.rates.map((r) => [r.category, client.dealRates?.[r.category] ? String(client.dealRates[r.category]) : ''])),
  );
  const [terms, setTerms] = useState(client.dealTerms ?? '');
  const [until, setUntil] = useState(client.dealUntil ?? '');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const d = Math.round(Number(discount) || 0);
    if (d < 0 || d > 60) return setError('Remise entre 0 et 60 %.');
    const dealRates: Record<string, number> = {};
    for (const [cat, v] of Object.entries(rates)) {
      if (!v) continue;
      const n = Math.round(Number(v));
      if (!(n > 0)) return setError(`Prix invalide pour ${cat}.`);
      dealRates[cat] = n;
    }
    try {
      await store.update('clients', client.id, { dealDiscount: d, dealRates, dealTerms: terms.trim() || null, dealUntil: until || null });
      await refresh();
      toast('Contrat cadre enregistré');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={`Contrat cadre · ${client.name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">Remise sur la location (%)<input type="number" min={0} max={60} value={discount} onChange={(e) => setDiscount(e.target.value)} /></label>
          <label className="field">Valable jusqu’au<input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
        </div>
        <fieldset className="form-group stack">
          <legend>Prix par jour négociés (facultatif)</legend>
          <span className="hint">Remplace la grille et la remise pour la catégorie. Laissez vide pour appliquer la remise.</span>
          <div className="grid-2">
            {data.rates.map((r) => (
              <label key={r.id} className="field">
                {r.category} <span className="muted small">(grille : {money(r.daily)})</span>
                <input type="number" min={0} value={rates[r.category] ?? ''} onChange={(e) => setRates({ ...rates, [r.category]: e.target.value })} />
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field">Conditions<textarea rows={3} maxLength={2000} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Ex. : facturation mensuelle à 30 jours, véhicule de remplacement sous 24 h…" /></label>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
