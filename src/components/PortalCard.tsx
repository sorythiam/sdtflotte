import { useState } from 'react';
import { COUNTRY_CALLING_CODE, whatsappLink } from '../domain/booking';
import { billingSettings, paidOn } from '../domain/billing';
import { dateTime, money } from '../domain/format';
import {
  depositState, depositTarget, DEPOSIT_STATE_LABEL, METHOD_LABEL, portalMessage, portalUrl, type DepositDeclaration,
} from '../domain/portal';
import type { Reservation } from '../domain/types';
import { useData } from '../state/DataContext';

/** Jeton de 256 bits pour le lien du client. */
export function newPortalToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Espace client d'une réservation, côté agence : lien, avancement du dossier, acomptes déclarés. */
export function PortalCard({ r }: { r: Reservation }) {
  const { data, session, store, refresh, toast, can, now } = useData();
  const [busy, setBusy] = useState<string | null>(null);
  const pt = data.reservation_portals.find((p) => p.reservationId === r.id);
  const c = data.clients.find((x) => x.id === r.clientId);
  const decls = data.deposit_declarations.filter((d) => d.reservationId === r.id).sort((a, b) => b.declaredAt.localeCompare(a.declaredAt));
  const billing = billingSettings(session!.org.name, session!.org.billing);
  const due = depositTarget(r, data.invoices, c?.depositPercent ?? billing.depositPercent);
  const paid = paidOn(r.id, data.payments);
  const state = depositState(r, due, paid, decls, now, billing.depositDelayHours);
  const canSend = can('direction', 'agent');
  const canReview = can('direction', 'agent', 'comptable');
  const url = pt ? portalUrl(pt.token) : '';
  const usable = r.status === 'reservee' || r.status === 'en_cours';
  const payeesOk = !!(billing.payees.wave.trim() || billing.payees.orangeMoney.trim());

  if (!usable && !pt && decls.length === 0) return null;

  async function run(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await fn();
      await refresh();
      toast(done);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const create = () => run('create', () => store.insert('reservation_portals', { reservationId: r.id, token: newPortalToken(), createdAt: new Date().toISOString() }), 'Lien client créé');
  const revoke = () => {
    if (!pt || !window.confirm('Désactiver ce lien ? Le client ne pourra plus l’ouvrir ; vous pourrez en créer un nouveau.')) return;
    void run('revoke', () => store.remove('reservation_portals', pt.id), 'Lien désactivé');
  };
  const confirm = (d: DepositDeclaration) =>
    run(d.id, async () => {
      const p = await store.insert('payments', { reservationId: r.id, kind: 'acompte', amount: d.amount, method: d.method, status: 'paye', paidAt: new Date().toISOString(), createdAt: new Date().toISOString(), reference: d.reference });
      await store.update('deposit_declarations', d.id, { status: 'confirme', paymentId: p.id, reviewedBy: session?.userEmail ?? null, reviewedAt: new Date().toISOString() });
    }, 'Acompte confirmé et enregistré');
  const reject = (d: DepositDeclaration) => {
    if (!window.confirm(`Vous ne trouvez pas ${money(d.amount)} (réf. ${d.reference}) sur votre compte ${METHOD_LABEL[d.method]} ? Le client verra « non retrouvé, contactez l’agence ».`)) return;
    void run(d.id, () => store.update('deposit_declarations', d.id, { status: 'rejete', reviewedBy: session?.userEmail ?? null, reviewedAt: new Date().toISOString() }), 'Acompte marqué non reçu');
  };

  const steps: [string, string | null | undefined][] = pt
    ? [['Lien créé', pt.createdAt], ['Ouvert par le client', pt.openedAt], ['Dossier rempli et contrat signé', pt.signedAt]]
    : [];

  return (
    <section className="card stack" aria-labelledby="espace-client">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="espace-client">Espace client</h2>
        {state !== 'aucun' && <span className={`badge ${DEPOSIT_STATE_LABEL[state][1]}`}>{DEPOSIT_STATE_LABEL[state][0]}</span>}
      </div>

      {!pt ? (
        usable && (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              Envoyez au client un lien pour remplir son dossier, envoyer les photos de ses pièces, signer le contrat et déclarer son acompte depuis son téléphone.
              {!payeesOk && ' Renseignez votre code marchand Wave ou Orange Money dans Paramètres pour l’acompte en ligne.'}
            </p>
            {canSend && <button className="btn btn-dark" style={{ alignSelf: 'flex-start' }} disabled={busy === 'create'} onClick={create}>Créer le lien client</button>}
          </>
        )
      ) : (
        <>
          <ol className="portal-steps" aria-label="Avancement">
            {steps.map(([label, at]) => <li key={label} className={at ? 'done' : ''} title={at ? dateTime(at) : undefined}>{at ? '✓ ' : ''}{label}</li>)}
          </ol>
          {pt.signedAt && (
            <p className="small" style={{ margin: 0 }}>
              Signé en ligne le {dateTime(pt.signedAt)} par <strong>{pt.signerName}</strong>.
              {pt.signature && <img src={pt.signature} alt={`Signature de ${pt.signerName}`} style={{ display: 'block', maxHeight: 60, marginTop: 4 }} />}
            </p>
          )}
          {usable && canSend && (
            <div className="row" style={{ gap: 'var(--space-2)' }}>
              {c && (
                <a className="btn btn-dark" target="_blank" rel="noreferrer"
                  href={whatsappLink(c.contactPhone || c.phone, portalMessage(c.contactName || c.name, session!.org.name, r, url, Math.max(0, due - paid)), COUNTRY_CALLING_CODE[session!.org.country] ?? '221')}>
                  Envoyer le lien (WhatsApp)
                </a>
              )}
              <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(url).then(() => toast('Lien copié'), () => toast(url))}>Copier le lien</button>
              <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">Voir comme le client</a>
              <button type="button" className="btn btn-ghost" disabled={busy === 'revoke'} onClick={revoke}>Désactiver</button>
            </div>
          )}
        </>
      )}

      {decls.length > 0 && (
        <ul className="alert-list">
          {decls.map((d) => (
            <li key={d.id} className="alert-item" style={{ borderLeftColor: d.status === 'declare' ? 'var(--ocre)' : d.status === 'confirme' ? 'var(--success)' : 'var(--danger)' }}>
              <strong>Acompte déclaré : {money(d.amount)} par {METHOD_LABEL[d.method]}</strong>
              <span className="small muted">Réf. {d.reference} · {dateTime(d.declaredAt)}{d.reviewedBy ? ` · ${d.status === 'confirme' ? 'confirmé' : 'non retrouvé'} par ${d.reviewedBy}` : ''}</span>
              {d.status === 'declare' ? (
                canReview ? (
                  <>
                    <span className="small">Vérifiez sur votre téléphone {METHOD_LABEL[d.method]} que la somme est bien arrivée avant de confirmer.</span>
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <button type="button" className="btn btn-sm btn-dark" disabled={busy === d.id} onClick={() => confirm(d)}>Reçu, confirmer</button>
                      <button type="button" className="btn btn-sm btn-ghost" disabled={busy === d.id} onClick={() => reject(d)}>Pas reçu</button>
                    </div>
                  </>
                ) : <span className="badge badge-warning" style={{ alignSelf: 'flex-start' }}>À vérifier</span>
              ) : (
                <span className={`badge ${d.status === 'confirme' ? 'badge-success' : 'badge-danger'}`} style={{ alignSelf: 'flex-start' }}>{d.status === 'confirme' ? 'Reçu' : 'Non retrouvé'}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
