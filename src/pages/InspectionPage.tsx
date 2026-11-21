import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Lightbox, shrinkPhoto } from '../components/photos';
import { SignaturePad } from '../components/SignaturePad';
import { ErrorBox } from '../components/ui';
import { invoiceFees } from '../data/services';
import { dateTime, money, num } from '../domain/format';
import {
  compareInspections, emptyItems, FUEL_LABELS, inspectionProblems, zoneLabel, ZONES,
  type Inspection, type InspectionItem, type InspectionKind, type NewInspection,
} from '../domain/inspection';
import { returnFees } from '../domain/rules';
import { useData } from '../state/DataContext';
import { useBilling } from '../state/useBilling';
import { useSignedUrls } from '../state/useSignedUrls';
import { enqueue, isNetworkError, keepPhoto, localRefs, pending, type PendingInspection } from '../offline/outbox';

export function InspectionPage({ kind }: { kind: InspectionKind }) {
  const { id } = useParams();
  const { data } = useData();
  const r = data.reservations.find((x) => x.id === id);
  if (!r) {
    return (
      <div className="card">
        <p>Réservation introuvable.</p>
        <Link to="/reservations">Retour aux réservations</Link>
      </div>
    );
  }
  const done = data.inspections.find((i) => i.reservationId === r.id && i.kind === kind);
  if (done) return <InspectionView inspection={done} />;
  return <PendingGate reservationId={r.id} kind={kind} />;
}

/** Un état des lieux déjà fait hors connexion attend d'être envoyé : on ne le refait pas. */
function PendingGate({ reservationId, kind }: { reservationId: string; kind: InspectionKind }) {
  const { session, outboxCount, syncNow, offline } = useData();
  const [entry, setEntry] = useState<PendingInspection | null | undefined>(undefined);
  useEffect(() => {
    void pending(session?.org.id).then((l) => setEntry(l.find((p) => p.inspection.reservationId === reservationId && p.inspection.kind === kind) ?? null));
  }, [session, reservationId, kind, outboxCount]);
  if (entry === undefined) return null;
  if (!entry) return <InspectionForm kind={kind} reservationId={reservationId} />;
  return (
    <>
      <InspectionView inspection={{ ...entry.inspection, id: entry.id }} pendingSince={entry.createdAt} />
      <div className="card notice" role="status">
        <strong>Enregistré sur ce téléphone, en attente d’envoi.</strong> Il partira automatiquement dès que le réseau revient.
        {entry.lastError && <> Dernière tentative : {entry.lastError}</>}
        {!offline && <div style={{ marginTop: 8 }}><button className="btn btn-sm btn-dark" onClick={() => void syncNow()}>Envoyer maintenant</button></div>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- saisie

function InspectionForm({ kind, reservationId }: { kind: InspectionKind; reservationId: string }) {
  const { data, store, refresh, toast, can, session, syncNow, offline } = useData();
  const billing = useBilling();
  const nav = useNavigate();
  const r = data.reservations.find((x) => x.id === reservationId)!;
  const v = data.vehicles.find((x) => x.id === r.vehicleId);
  const c = data.clients.find((x) => x.id === r.clientId);
  const rate = data.rates.find((x) => x.category === v?.category);
  const depart = data.inspections.find((i) => i.reservationId === r.id && i.kind === 'depart');
  const isReturn = kind === 'retour';

  const [mileage, setMileage] = useState(String(isReturn ? (r.mileageOut ?? v?.mileage ?? 0) : (v?.mileage ?? 0)));
  const [fuel, setFuel] = useState<number | null>(null);
  const [items, setItems] = useState<InspectionItem[]>(emptyItems);
  const [uploading, setUploading] = useState<string | null>(null);
  const [signerName, setSignerName] = useState(c?.kind === 'entreprise' ? (c.contactName ?? '') : (c?.name ?? ''));
  const [signature, setSignature] = useState<string | null>(null);
  const [agentSignature, setAgentSignature] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [fuelPrice, setFuelPrice] = useState('15000');
  const [damages, setDamages] = useState('0');
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gallery, setGallery] = useState<{ photos: string[]; title: string } | null>(null);

  const departPaths = useMemo(() => depart?.items.flatMap((i) => i.photos) ?? [], [depart]);
  const myPaths = useMemo(() => items.flatMap((i) => i.photos), [items]);
  const urls = useSignedUrls([...departPaths, ...myPaths]);

  const m = Math.round(Number(mileage));
  const cmp = isReturn ? compareInspections(depart, { items, fuelQuarters: fuel ?? 0, mileage: m || 0 }) : null;
  const fees = isReturn
    ? returnFees(r, rate, {
        mileageIn: m || 0,
        fuelQuartersMissing: depart ? Math.max(0, depart.fuelQuarters - (fuel ?? depart.fuelQuarters)) : 0,
        fuelQuarterPrice: Number(fuelPrice) || 0,
        damages: Number(damages) || 0,
        returnedAt: new Date().toISOString(),
      })
    : null;

  const setItem = (zone: string, patch: Partial<InspectionItem>) => setItems((list) => list.map((x) => (x.zone === zone ? { ...x, ...patch } : x)));

  async function addPhotos(zone: string, files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading(zone);
    try {
      for (const f of [...files].slice(0, 4)) {
        const blob = await shrinkPhoto(f, store.mode === 'demo' ? 720 : 1440, store.mode === 'demo' ? 0.65 : 0.78);
        let path: string;
        if (navigator.onLine === false) path = await keepPhoto(blob);
        else {
          try {
            path = await store.uploadInspectionPhoto(blob, r.id);
          } catch (e) {
            // Réseau coupé pendant l'envoi : la photo reste sur le téléphone et partira plus tard.
            if (!isNetworkError(e)) throw e;
            path = await keepPhoto(blob);
          }
        }
        setItems((list) => list.map((x) => (x.zone === zone ? { ...x, photos: [...x.photos, path] } : x)));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(null);
    }
  }

  async function submit() {
    setError(null);
    const draft = { mileage: m, fuelQuarters: fuel ?? -1, items, signature, signerName };
    const minMileage = isReturn ? (depart?.mileage ?? r.mileageOut ?? null) : (v?.mileage ?? null);
    const p = inspectionProblems(draft, { minMileage });
    setProblems(p);
    if (p.length) return window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    setBusy(true);
    const now = new Date().toISOString();
    const ins: NewInspection = {
      reservationId: r.id, kind, mileage: m, fuelQuarters: fuel!, items, signature, signerName: signerName.trim(),
      agentSignature, notes: notes.trim(), doneAt: now,
    };
    const detailText = isReturn
      ? [
          fees!.kmExtra ? `${fees!.kmExtra} km supplémentaires` : '',
          fees!.fuelFee ? 'carburant' : '',
          fees!.lateDays ? `retard de ${fees!.lateDays} jour(s)` : '',
          fees!.damages ? `dégâts : ${cmp!.newDamages.map((d) => d.label.toLowerCase()).join(', ') || 'voir état des lieux'}` : '',
        ].filter(Boolean).join(', ')
      : '';
    const queue = async () => {
      await enqueue({
        orgId: session!.org.id,
        inspection: ins,
        effects: {
          kind, vehicleId: v?.id ?? null, mileage: m,
          fees: isReturn ? fees!.total : 0, end: isReturn && fees!.lateDays > 0 ? now : null, detail: detailText,
        },
      });
      toast('État des lieux enregistré sur le téléphone. Il sera envoyé dès le retour du réseau.');
      if (navigator.onLine !== false) void syncNow();
      nav(`/reservations/${r.id}`);
    };
    // Sans réseau, ou avec des photos encore sur le téléphone : on passe par la file d'envoi.
    if (navigator.onLine === false || localRefs(items).length > 0) {
      try {
        await queue();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      try {
        await store.insert('inspections', ins);
      } catch (e) {
        if (isNetworkError(e)) {
          await queue();
          return;
        }
        throw e;
      }
      if (!isReturn) {
        await store.update('reservations', r.id, { status: 'en_cours', mileageOut: m });
      } else {
        const end = fees!.lateDays > 0 ? now : r.end;
        await store.update('reservations', r.id, { status: 'terminee', mileageIn: m, fees: fees!.total, end });
        if (fees!.total > 0) await invoiceFees(store, billing, { ...r, fees: fees!.total, end }, detailText);
      }
      if (v) await store.update('vehicles', v.id, { mileage: m });
      await refresh();
      toast(isReturn ? (fees!.total ? `Retour enregistré · ${money(fees!.total)} de frais facturés` : 'Retour enregistré, sans frais') : 'Départ enregistré, clés remises');
      nav(`/reservations/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!can('direction', 'agent', 'mecanicien')) return <div className="card">Votre profil ne permet pas de faire un état des lieux.</div>;
  if (isReturn && r.status !== 'en_cours') return <div className="card">Le retour se fait sur une location en cours. <Link to={`/reservations/${r.id}`}>Retour à la réservation</Link></div>;
  if (!isReturn && r.status !== 'reservee') return <div className="card">Le départ se fait sur une réservation confirmée. <Link to={`/reservations/${r.id}`}>Retour à la réservation</Link></div>;

  const doneZones = items.filter((i) => i.photos.length).length;

  return (
    <div className="inspection">
      <header className="page-head">
        <div>
          <span className="small muted"><Link to={`/reservations/${r.id}`}>{r.number}</Link> · {c?.name}</span>
          <h1>{isReturn ? 'État des lieux de retour' : 'État des lieux de départ'}</h1>
          <p className="small muted" style={{ margin: 0 }}>
            {v ? `${v.brand} ${v.model} · ${v.plate}` : ''} · {doneZones}/{ZONES.length} zones photographiées
          </p>
          {offline && <p className="small" style={{ margin: '4px 0 0', color: 'var(--ocre)', fontWeight: 600 }}>Hors connexion : photos et signatures sont gardées sur le téléphone.</p>}
        </div>
      </header>

      <section className="card stack">
        <h2>1. Compteur et carburant</h2>
        <label className="field">
          Kilométrage {isReturn ? 'au retour' : 'au départ'}
          <input type="number" inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value)} className="big-input" />
          {isReturn && depart && <span className="hint">Départ : {num(depart.mileage)} km · parcourus : {num(Math.max(0, (m || 0) - depart.mileage))} km</span>}
        </label>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
            Niveau de carburant{isReturn && depart ? ` (départ : ${FUEL_LABELS[depart.fuelQuarters]})` : ''}
          </legend>
          <div className="fuel-picker" role="radiogroup" aria-label="Niveau de carburant">
            {FUEL_LABELS.map((l, q) => (
              <button key={l} type="button" role="radio" aria-checked={fuel === q} className={fuel === q ? 'on' : undefined} onClick={() => setFuel(q)}>
                <span className="fuel-bar" aria-hidden="true"><span style={{ width: `${q * 25}%` }} /></span>
                {l}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="stack">
        <h2 style={{ margin: '8px 0 0' }}>2. Tour du véhicule</h2>
        {ZONES.map((z, k) => {
          const it = items.find((x) => x.zone === z.id)!;
          const before = depart?.items.find((x) => x.zone === z.id);
          return (
            <div key={z.id} className={`card zone-card${it.status === 'dommage' ? ' damaged' : ''}`}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: 0 }}>{k + 1}. {z.label}{z.photoRequired && <span className="muted small"> · photo obligatoire</span>}</h3>
                  <span className="small muted">{z.hint}</span>
                </div>
                <div className="seg" role="radiogroup" aria-label={`État : ${z.label}`}>
                  <button type="button" role="radio" aria-checked={it.status === 'ok'} className={it.status === 'ok' ? 'on' : undefined} onClick={() => setItem(z.id, { status: 'ok' })}>Bon état</button>
                  <button type="button" role="radio" aria-checked={it.status === 'dommage'} className={it.status === 'dommage' ? 'on bad' : undefined} onClick={() => setItem(z.id, { status: 'dommage' })}>Dommage</button>
                </div>
              </div>
              {isReturn && before && (
                <div className="before">
                  <span className="small"><strong>Au départ :</strong> {before.status === 'dommage' ? `dommage noté (${before.note})` : 'bon état'}</span>
                  <div className="thumbs">
                    {before.photos.map((p, i) => urls[p] && (
                      <button key={p} type="button" onClick={() => setGallery({ photos: before.photos.map((x) => urls[x]).filter(Boolean), title: `${z.label} · départ` })} aria-label={`Photo de départ ${i + 1}`}>
                        <img src={urls[p]} alt="" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="thumbs">
                {it.photos.map((p, i) => (
                  <span key={p} className="thumb-wrap">
                    {urls[p] ? <img src={urls[p]} alt={`${z.label}, photo ${i + 1}`} /> : <span className="thumb-loading" />}
                    <button type="button" aria-label={`Retirer la photo ${i + 1}`} onClick={() => setItem(z.id, { photos: it.photos.filter((x) => x !== p) })}>×</button>
                  </span>
                ))}
                <label className={`photo-add${uploading === z.id ? ' busy' : ''}`}>
                  {uploading === z.id ? 'Envoi…' : it.photos.length ? '+ Photo' : 'Prendre une photo'}
                  <input type="file" accept="image/*" capture="environment" multiple className="sr-only" disabled={!!uploading}
                    onChange={(e) => { void addPhotos(z.id, e.target.files); e.target.value = ''; }} />
                </label>
              </div>
              {it.status === 'dommage' && (
                <label className="field">
                  Description du dommage
                  <input value={it.note} maxLength={200} onChange={(e) => setItem(z.id, { note: e.target.value })} placeholder="Rayure de 10 cm sur la portière arrière…" />
                </label>
              )}
            </div>
          );
        })}
      </section>

      {isReturn && fees && cmp && (
        <section className="card stack">
          <h2>3. Frais au retour</h2>
          {cmp.newDamages.length > 0 ? (
            <div className="notice" style={{ margin: 0, background: '#fde8e7' }}>
              <strong>Nouveaux dégâts par rapport au départ :</strong> {cmp.newDamages.map((d) => `${d.label.toLowerCase()} (${d.note || 'à décrire'})`).join(', ')}.
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>Aucun nouveau dégât par rapport au départ.</p>
          )}
          <div className="grid-2">
            <label className="field">Prix d’un quart de réservoir<input type="number" min={0} value={fuelPrice} onChange={(e) => setFuelPrice(e.target.value)} /></label>
            <label className="field">
              Montant des dégâts (FCFA)
              <input type="number" min={0} value={damages} onChange={(e) => setDamages(e.target.value)} />
              {cmp.newDamages.length > 0 && <span className="hint">Selon devis ou barème ; prélevé sur la caution si non payé.</span>}
            </label>
          </div>
          <div className="notice" style={{ margin: 0 }}>
            <strong>Frais : {money(fees.total)}</strong>
            <br />
            {fees.kmDriven} km parcourus{fees.kmExtra ? `, ${fees.kmExtra} km en plus (${money(fees.kmFee)})` : ', dans le forfait'}
            {fees.fuelFee ? ` · carburant ${money(fees.fuelFee)}` : ''}
            {fees.lateDays ? ` · retard ${fees.lateDays} j (${money(fees.lateFee)})` : ''}
            {fees.damages ? ` · dégâts ${money(fees.damages)}` : ''}
            {fees.total > 0 && <><br />Une facture de frais sera établie automatiquement.</>}
          </div>
        </section>
      )}

      <section className="card stack">
        <h2>{isReturn ? '4' : '3'}. Signatures</h2>
        <label className="field">
          Observations (facultatif)
          <textarea rows={2} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="field">
          Nom de la personne qui signe pour le client
          <input value={signerName} onChange={(e) => setSignerName(e.target.value)} />
        </label>
        <p className="small" style={{ margin: 0 }}>
          {isReturn
            ? 'Le client reconnaît l’état du véhicule constaté au retour et les frais indiqués.'
            : 'Le client reconnaît avoir reçu le véhicule dans l’état décrit et photographié ci-dessus.'}
        </p>
        <SignaturePad label="Signature du client" onChange={setSignature} />
        <SignaturePad label="Signature de l’agent (facultatif)" onChange={setAgentSignature} />
      </section>

      {problems.length > 0 && (
        <div className="card" role="alert" style={{ borderColor: 'var(--danger)' }}>
          <strong>Avant de valider :</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <ErrorBox error={error} />
      <div className="inspection-submit">
        <button className="btn btn-primary" disabled={busy || !!uploading} onClick={() => void submit()}>
          {busy ? 'Enregistrement…' : isReturn ? 'Valider le retour' : 'Valider et remettre les clés'}
        </button>
      </div>
      {gallery && <Lightbox photos={gallery.photos} start={0} title={gallery.title} onClose={() => setGallery(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- consultation

export function InspectionView({ inspection: ins, pendingSince }: { inspection: Inspection; pendingSince?: string }) {
  const { data } = useData();
  const r = data.reservations.find((x) => x.id === ins.reservationId);
  const urls = useSignedUrls(ins.items.flatMap((i) => i.photos));
  const [gallery, setGallery] = useState<{ photos: string[]; title: string; start: number } | null>(null);
  return (
    <>
      <header className="page-head">
        <div>
          <span className="small muted">{r && <Link to={`/reservations/${r.id}`}>{r.number}</Link>}</span>
          <h1>État des lieux de {ins.kind === 'depart' ? 'départ' : 'retour'}{pendingSince ? ' (en attente d’envoi)' : ''}</h1>
          <p className="small muted" style={{ margin: 0 }}>
            {dateTime(ins.doneAt)} · {num(ins.mileage)} km · carburant {FUEL_LABELS[ins.fuelQuarters]} · signé par {ins.signerName}
          </p>
        </div>
      </header>
      <section className="card">
        <div className="zone-grid">
          {ins.items.map((it) => (
            <div key={it.zone} className={`zone-tile${it.status === 'dommage' ? ' damaged' : ''}`}>
              <strong>{zoneLabel(it.zone)}</strong>
              <span className="small">{it.status === 'dommage' ? `Dommage : ${it.note}` : 'Bon état'}</span>
              <div className="thumbs">
                {it.photos.map((p, i) => urls[p] && (
                  <button key={p} type="button" onClick={() => setGallery({ photos: it.photos.map((x) => urls[x]).filter(Boolean), title: zoneLabel(it.zone), start: i })}>
                    <img src={urls[p]} alt={`${zoneLabel(it.zone)}, photo ${i + 1}`} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {ins.notes && <p className="small" style={{ marginBottom: 0 }}>Observations : {ins.notes}</p>}
        <div className="grid-2" style={{ marginTop: 12 }}>
          {ins.signature && <figure className="sig"><img src={ins.signature} alt={`Signature de ${ins.signerName}`} /><figcaption className="small muted">{ins.signerName}, client</figcaption></figure>}
          {ins.agentSignature && <figure className="sig"><img src={ins.agentSignature} alt="Signature de l’agent" /><figcaption className="small muted">Agent</figcaption></figure>}
        </div>
      </section>
      {gallery && <Lightbox photos={gallery.photos} start={gallery.start} title={gallery.title} onClose={() => setGallery(null)} />}
    </>
  );
}
