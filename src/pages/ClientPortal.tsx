import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { shrinkPhoto } from '../components/photos';
import { SignaturePad } from '../components/SignaturePad';
import { dateTime, money } from '../domain/format';
import {
  depositLeft, METHOD_LABEL, validateDeclaration, validatePortalForm,
  type DepositMethod, type PortalClient, type PortalInfo,
} from '../domain/portal';
import { DOC_SLOTS, ID_TYPES } from '../domain/verification';
import type { IdType } from '../domain/types';
import { useData } from '../state/DataContext';

type Slot = 'idFront' | 'idBack' | 'license';
const SLOTS = DOC_SLOTS.filter((d) => d.slot !== 'selfie') as { slot: Slot; label: string; hint: string }[];

const STATUS_DECL: Record<string, [string, string]> = {
  declare: ['En cours de vérification', 'badge-warning'],
  confirme: ['Reçu par l’agence', 'badge-success'],
  rejete: ['Non retrouvé : contactez l’agence', 'badge-danger'],
};

function blankForm(c: PortalInfo['client']): PortalClient {
  return {
    name: c.name ?? '', phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '', city: c.city ?? '',
    idType: c.idType ?? 'cni', idNumber: c.idNumber ?? '', idExpiry: c.idExpiry ?? '', birthDate: c.birthDate ?? '',
    licenseNumber: c.licenseNumber ?? '', licenseCategory: c.licenseCategory ?? '', licenseExpiry: c.licenseExpiry ?? '',
  };
}

/** Espace client : ouvert par le lien reçu sur WhatsApp, sans compte. */
export function ClientPortal({ token }: { token: string }) {
  const { store } = useData();
  const [info, setInfo] = useState<PortalInfo | null | undefined>(undefined);

  const load = useCallback(() => store.portalInfo(token).then(setInfo).catch(() => setInfo(null)), [store, token]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (info?.org.name) document.title = `Votre location · ${info.org.name}`;
  }, [info?.org.name]);

  if (info === undefined) return <div className="pub"><p className="muted">Chargement…</p></div>;
  if (info === null) {
    return (
      <div className="pub">
        <div className="card" style={{ maxWidth: 520, margin: '15vh auto' }}>
          <h1 style={{ fontSize: 22 }}>Lien expiré</h1>
          <p className="muted" style={{ margin: 0 }}>Ce lien n’est plus valable (réservation terminée, annulée ou lien remplacé). Contactez l’agence pour en recevoir un nouveau.</p>
        </div>
      </div>
    );
  }

  const r = info.reservation;
  const open = r.status === 'reservee';
  const signed = !!info.portal.signedAt;
  const docsOk = info.client.docs.idFront && info.client.docs.license;
  const left = depositLeft(r);
  const steps: [string, boolean][] = [
    ['Dossier et pièces', !!info.portal.submittedAt && !!docsOk],
    ['Contrat signé', signed],
    ['Acompte', left <= 0 || r.declared.some((d) => d.status !== 'rejete')],
  ];

  return (
    <div className="pub">
      <header className="pub-head">
        <div className="row" style={{ gap: 14, flexWrap: 'nowrap' }}>
          {info.org.logo && <img src={info.org.logo} alt="" style={{ maxHeight: 52, maxWidth: 130, objectFit: 'contain' }} />}
          <div>
            <h1 style={{ margin: 0, fontSize: 24 }}>{info.org.name}</h1>
            {info.org.phone && <div className="small muted">Une question ? {info.org.phone}</div>}
          </div>
        </div>
      </header>

      <section className="card" aria-labelledby="resa">
        <h2 id="resa">Votre réservation {r.number}</h2>
        <dl className="facts">
          <div><dt>Véhicule</dt><dd>{r.vehicle}{r.withDriver ? ', avec chauffeur' : ''}</dd></div>
          <div><dt>Départ</dt><dd>{dateTime(r.start)}</dd></div>
          <div><dt>Retour</dt><dd>{dateTime(r.end)}</dd></div>
          <div><dt>Montant</dt><dd>{money(r.total)}{r.caution ? `, caution ${money(r.caution)} à la remise des clés` : ''}</dd></div>
        </dl>
        <ol className="portal-steps" aria-label="Étapes">
          {steps.map(([label, done]) => <li key={label} className={done ? 'done' : ''}>{done ? '✓ ' : ''}{label}</li>)}
        </ol>
        {!open && <p className="small muted" style={{ margin: 0 }}>Le véhicule a été remis : votre dossier ne peut plus être modifié en ligne.</p>}
      </section>

      {open && <DossierSection token={token} info={info} onDone={load} />}
      {(left > 0 || r.declared.length > 0) && r.status !== 'terminee' && <DepositSection token={token} info={info} onDone={load} />}
    </div>
  );
}

function DossierSection({ token, info, onDone }: { token: string; info: PortalInfo; onDone: () => Promise<unknown> }) {
  const { store } = useData();
  const signed = !!info.portal.signedAt;
  const [editing, setEditing] = useState(!signed);
  const [f, setF] = useState<PortalClient>(() => blankForm(info.client));
  const [signer, setSigner] = useState(info.client.kind === 'particulier' ? info.client.name : '');
  const [signature, setSignature] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState<Slot | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const company = info.client.kind === 'entreprise';
  const set = (k: keyof PortalClient) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function onPhoto(slot: Slot, file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(slot);
    try {
      await store.portalUpload(token, info, slot, await shrinkPhoto(file, 1600, 0.85));
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const t = (v: string | null) => (v && v.trim() ? v.trim() : null);
    const clean: PortalClient = { ...f, email: t(f.email), address: t(f.address), city: t(f.city), idNumber: t(f.idNumber), idExpiry: t(f.idExpiry), birthDate: t(f.birthDate), licenseNumber: t(f.licenseNumber), licenseCategory: t(f.licenseCategory), licenseExpiry: t(f.licenseExpiry) };
    const err = validatePortalForm(clean, signer, signature, accepted, new Date());
    if (err) return setError(err);
    setBusy('save');
    try {
      await store.portalSubmit(token, clean, signer.trim(), signature!);
      setEditing(false);
      await onDone();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="card stack" aria-labelledby="pieces">
        <h2 id="pieces">1. Photos de vos pièces</h2>
        <p className="small muted" style={{ margin: 0 }}>Prises avec votre téléphone, lisibles et sans reflet. Elles sont gardées dans un espace privé, visible seulement par l’agence.</p>
        <div className="portal-docs">
          {SLOTS.map((d) => {
            const has = info.client.docs[d.slot];
            return (
              <label key={d.slot} className={`portal-doc${has ? ' done' : ''}`}>
                <strong>{d.label}</strong>
                <span className="small muted">{d.hint}</span>
                <span className={`badge ${has ? 'badge-success' : 'badge-muted'}`}>{busy === d.slot ? 'Envoi…' : has ? 'Reçue · remplacer' : 'Prendre la photo'}</span>
                <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={!!busy} aria-label={d.label}
                  onChange={(e) => { void onPhoto(d.slot, e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            );
          })}
        </div>
        {error && busy !== 'save' && !editing && <p className="error-text" role="alert">{error}</p>}
      </section>

      <section className="card" aria-labelledby="dossier">
        <h2 id="dossier">2. Vos informations et la signature du contrat</h2>
        {!editing ? (
          <div className="stack">
            <p style={{ margin: 0 }}>✓ Contrat signé le {dateTime(info.portal.signedAt!)} par <strong>{info.portal.signerName}</strong>. Merci, il ne reste qu’à présenter vos pièces originales à la remise des clés.</p>
            <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing(true)}>Corriger mes informations</button>
          </div>
        ) : (
          <form className="stack" onSubmit={submit} noValidate>
            {company ? (
              <p className="small" style={{ margin: 0 }}>Location au nom de <strong>{info.client.name}</strong>. Renseignez la pièce d’identité et le permis du conducteur.</p>
            ) : (
              <div className="grid-2">
                <label className="field">Nom complet<input required autoComplete="name" value={f.name} onChange={set('name')} /></label>
                <label className="field">Téléphone<input required inputMode="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} /></label>
                <label className="field">Email (facultatif)<input type="email" autoComplete="email" value={f.email ?? ''} onChange={set('email')} /></label>
                <label className="field">Date de naissance<input type="date" value={f.birthDate ?? ''} onChange={set('birthDate')} /></label>
                <label className="field">Adresse<input autoComplete="street-address" value={f.address ?? ''} onChange={set('address')} /></label>
                <label className="field">Ville<input autoComplete="address-level2" value={f.city ?? ''} onChange={set('city')} /></label>
              </div>
            )}
            <div className="grid-2">
              <label className="field">Pièce d’identité
                <select value={f.idType ?? 'cni'} onChange={(e) => setF({ ...f, idType: e.target.value as IdType })}>{ID_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
              <label className="field">Numéro de la pièce<input required value={f.idNumber ?? ''} onChange={set('idNumber')} /></label>
              <label className="field">Pièce valable jusqu’au<input type="date" value={f.idExpiry ?? ''} onChange={set('idExpiry')} /></label>
              <label className="field">Numéro du permis<input value={f.licenseNumber ?? ''} onChange={set('licenseNumber')} /></label>
              <label className="field">Catégorie du permis<input value={f.licenseCategory ?? ''} placeholder="B" onChange={set('licenseCategory')} /></label>
              <label className="field">Permis valable jusqu’au<input type="date" value={f.licenseExpiry ?? ''} onChange={set('licenseExpiry')} /></label>
            </div>

            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <strong>Conditions de location</strong>
              <div className="portal-terms" tabIndex={0} aria-label="Conditions de location">
                {info.org.terms.trim()
                  ? info.org.terms.split(/\n+/).map((p, i) => <p key={i}>{p}</p>)
                  : <p>Les conditions générales de location de {info.org.name} s’appliquent. Elles vous seront remises avec le contrat.</p>}
              </div>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} style={{ width: 18, height: 18 }} />
                J’ai lu et j’accepte les conditions de location
              </label>
            </div>
            <label className="field" style={{ maxWidth: 360 }}>Nom du signataire<input value={signer} onChange={(e) => setSigner(e.target.value)} /></label>
            <SignaturePad label="Votre signature" onChange={setSignature} />
            {error && <p className="error-text" role="alert">{error}</p>}
            <button className="btn btn-dark" disabled={busy === 'save'} style={{ alignSelf: 'flex-start' }}>{busy === 'save' ? 'Envoi…' : 'Signer et envoyer'}</button>
          </form>
        )}
      </section>
    </>
  );
}

function DepositSection({ token, info, onDone }: { token: string; info: PortalInfo; onDone: () => Promise<unknown> }) {
  const { store } = useData();
  const r = info.reservation;
  const left = depositLeft(r);
  const methods = (['wave', 'orange_money'] as DepositMethod[]).filter((m) => (m === 'wave' ? info.org.wave : info.org.orangeMoney).trim());
  const [method, setMethod] = useState<DepositMethod>(methods[0] ?? 'wave');
  const [amount, setAmount] = useState(String(Math.max(0, left - r.declared.filter((d) => d.status === 'declare').reduce((s, d) => s + d.amount, 0)) || ''));
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const pending = r.declared.filter((d) => d.status === 'declare').reduce((s, d) => s + d.amount, 0);
  const toPay = Math.max(0, left - pending); // ce qui reste à payer une fois les déclarations vérifiées

  async function copy(v: string) {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(v);
    } catch {
      /* copie refusée : le code reste affiché */
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Math.round(Number(amount.replace(/\s/g, '')));
    const err = validateDeclaration(n, reference, toPay);
    if (err) return setError(err);
    setBusy(true);
    try {
      await store.portalDeclare(token, method, reference.trim(), n);
      setReference('');
      setAmount('');
      await onDone();
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="acompte">
      <h2 id="acompte">3. L’acompte</h2>
      {left > 0 && toPay <= 0 ? (
        <p style={{ margin: 0 }}>Merci ! Votre paiement est en cours de vérification par l’agence. Vous serez prévenu dès qu’il est confirmé.</p>
      ) : left > 0 ? (
        <p style={{ margin: 0 }}>
          Pour confirmer la réservation, réglez <strong>{money(toPay)}</strong> directement à {info.org.name}
          {pending > 0 ? ` (en plus des ${money(pending)} déjà déclarés, en cours de vérification)` : ''}.
        </p>
      ) : (
        <p style={{ margin: 0 }}>✓ Acompte reçu par l’agence. Merci !</p>
      )}

      {toPay > 0 && methods.length === 0 && <p className="small muted" style={{ margin: 0 }}>L’agence vous indiquera comment payer{info.org.phone ? ` (${info.org.phone})` : ''}.</p>}

      {toPay > 0 && methods.length > 0 && (
        <>
          <div className="portal-pay">
            {methods.map((m) => {
              const code = m === 'wave' ? info.org.wave : info.org.orangeMoney;
              return (
                <div key={m} className={`portal-pay-card portal-${m}`}>
                  <strong>{METHOD_LABEL[m]}</strong>
                  <span className="small">Dans l’application {METHOD_LABEL[m]}, choisissez « Payer » (marchand) ou « Envoyer », puis saisissez :</span>
                  <span className="portal-code">{code}</span>
                  <span className="small">Montant : <strong>{money(toPay)}</strong></span>
                  <button type="button" className="btn btn-sm" onClick={() => copy(code)}>{copied === code ? 'Copié ✓' : 'Copier le code'}</button>
                </div>
              );
            })}
          </div>
          <form className="stack" onSubmit={submit} noValidate>
            <strong>Vous avez payé ? Indiquez-le ici</strong>
            <div className="grid-2">
              {methods.length > 1 && (
                <label className="field">Payé avec
                  <select value={method} onChange={(e) => setMethod(e.target.value as DepositMethod)}>{methods.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select>
                </label>
              )}
              <label className="field">Montant payé (FCFA)<input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              <label className="field">Référence de la transaction
                <input value={reference} maxLength={60} autoCapitalize="characters" onChange={(e) => setReference(e.target.value)} />
                <span className="hint">Dans le SMS de confirmation ou l’historique de l’application.</span>
              </label>
            </div>
            {error && <p className="error-text" role="alert">{error}</p>}
            <button className="btn btn-dark" disabled={busy} style={{ alignSelf: 'flex-start' }}>{busy ? 'Envoi…' : 'J’ai payé l’acompte'}</button>
          </form>
        </>
      )}

      {r.declared.length > 0 && (
        <ul className="alert-list">
          {r.declared.map((d) => (
            <li key={d.reference} className="alert-item">
              <strong>{money(d.amount)} par {METHOD_LABEL[d.method]}</strong>
              <span className="small muted">Réf. {d.reference} · {dateTime(d.declaredAt)}</span>
              <span className={`badge ${STATUS_DECL[d.status][1]}`} style={{ alignSelf: 'flex-start' }}>{STATUS_DECL[d.status][0]}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted" style={{ margin: 0 }}>Vous payez directement l’agence. Yoon Fleet ne reçoit et ne garde aucun argent.</p>
    </section>
  );
}
