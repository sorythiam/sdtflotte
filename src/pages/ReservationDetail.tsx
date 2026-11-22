import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorBox, Modal, ReservationBadge, ScoreBadge } from '../components/ui';
import { dateTime, fromLocalInput, money, num, toLocalInput } from '../domain/format';
import { balanceDue, billedDays, cautionHeld, lateDays, returnFees } from '../domain/rules';
import type { Payment, PaymentKind, PaymentMethod } from '../domain/types';
import { useData } from '../state/DataContext';
import { departureCheck } from '../domain/verification';
import { contractSettings } from '../domain/contract';
import { useBilling } from '../state/useBilling';
import { creditReservation, invoiceFees, invoiceReservation } from '../data/services';
import { payeeLines, payState, payStatusLabel, termsFor } from '../domain/billing';
import { COUNTRY_CALLING_CODE, whatsappLink } from '../domain/booking';

export const methodLabel: Record<PaymentMethod, string> = {
  especes: 'Espèces',
  wave: 'Wave',
  orange_money: 'Orange Money',
  free_money: 'Free Money',
  mtn: 'MTN MoMo',
  moov: 'Moov Money',
  carte: 'Carte bancaire',
  virement: 'Virement',
  cheque: 'Chèque',
};
const kindLabel: Record<PaymentKind, string> = {
  acompte: 'Acompte',
  solde: 'Solde',
  caution: 'Caution',
  frais: 'Frais',
  remboursement_caution: 'Remboursement de caution',
  remboursement: 'Remboursement du trop-perçu',
};

type Dialog = null | 'pay' | 'checkout' | 'checkin' | 'refund' | 'cancel' | 'overpaid';

export function ReservationDetail() {
  const { id } = useParams();
  const { data, now, can, session, store, refresh, toast } = useData();
  const billing = useBilling(); // avant tout retour anticipé : l'ordre des hooks doit rester stable
  const [dialog, setDialog] = useState<Dialog>(null);
  const r = data.reservations.find((x) => x.id === id);
  if (!r) {
    return (
      <div className="card">
        <p>Réservation introuvable.</p>
        <Link to="/reservations">Retour aux réservations</Link>
      </div>
    );
  }
  const v = data.vehicles.find((x) => x.id === r.vehicleId);
  const c = data.clients.find((x) => x.id === r.clientId);
  const rate = data.rates.find((x) => x.category === v?.category);
  const pays = data.payments.filter((p) => p.reservationId === r.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ps = payState(r, data.invoices, data.payments, now);
  const invoices = data.invoices.filter((i) => i.reservationId === r.id).sort((a, b) => a.number.localeCompare(b.number));
  const terms = termsFor(billing.settings, c);
  const due = balanceDue(r, data.payments, data.invoices);
  const held = cautionHeld(r.id, data.payments);
  const late = lateDays(r, now);
  const days = billedDays(r.start, r.end);
  const canRent = can('direction', 'agent');
  const canPay = can('direction', 'agent', 'comptable');
  const rules = contractSettings(session!.org.name, session!.org.contract);
  const gate = r.status === 'reservee' ? departureCheck(c, now, rules.requireVerifiedClient, rules.minDriverAge, r.withDriver) : { ok: true, message: null };

  return (
    <>
      <header className="page-head no-print">
        <div>
          <span className="small muted">
            <Link to="/reservations">Réservations et contrats</Link> › {r.number}
          </span>
          <div className="row">
            <h1>Contrat {r.number}</h1>
            <ReservationBadge status={r.status} late={late} />
          </div>
        </div>
        <div className="row">
          {r.status === 'reservee' && canRent && (
            <>
              <button className="btn btn-danger" onClick={() => setDialog('cancel')}>Annuler</button>
              {gate.ok && <button className="btn btn-ghost" onClick={() => setDialog('checkout')} title="Sans photos ni signature">Départ rapide</button>}
              {gate.ok ? (
                <Link className="btn btn-primary" to={`/reservations/${r.id}/depart`}>État des lieux et remise des clés</Link>
              ) : (
                c && <Link className="btn btn-primary" to={`/clients/${c.id}`}>Compléter le dossier client</Link>
              )}
            </>
          )}
          {r.status === 'en_cours' && canRent && (
            <>
              <button className="btn btn-ghost" onClick={() => setDialog('checkin')} title="Sans photos ni signature">Retour rapide</button>
              <Link className="btn btn-primary" to={`/reservations/${r.id}/retour`}>État des lieux de retour</Link>
            </>
          )}
          <Link className="btn" to={`/reservations/${r.id}/contrat`}>Contrat PDF</Link>
        </div>
      </header>

      {gate.message && (
        <div className={`notice no-print${gate.ok ? '' : ' notice-danger'}`} role="status">
          {gate.message} {c && <Link to={`/clients/${c.id}`}>Ouvrir la fiche du client</Link>}
        </div>
      )}

      <div className="cols no-print">
        <div className="col-2 stack" style={{ gap: 'var(--space-6)' }}>
          <section className="grid-2" aria-label="Client et véhicule">
            <div className="card" style={{ gap: 'var(--space-2)' }}>
              <span className="kpi-label" style={{ color: 'var(--ocre-text)' }}>Client</span>
              <h3>{c?.name ?? '—'}</h3>
              <span className="small muted">
                {c?.kind === 'entreprise' ? 'Entreprise' : 'Particulier'} · {c?.phone}
                {c?.licenseExpiry && (
                  <>
                    <br />
                    Permis valide jusqu’au {new Date(c.licenseExpiry).toLocaleDateString('fr-FR')}
                  </>
                )}
              </span>
              {c && <ScoreBadge score={c.score} />}
            </div>
            <div className="card" style={{ gap: 'var(--space-2)' }}>
              <span className="kpi-label" style={{ color: 'var(--ocre-text)' }}>Véhicule</span>
              <h3>{v ? `${v.brand} ${v.model} · ${v.plate}` : '—'}</h3>
              <span className="small muted">
                {v?.category} · {r.withDriver ? 'avec chauffeur' : 'sans chauffeur'}
                {r.mileageOut != null && (
                  <>
                    <br />
                    Départ : {num(r.mileageOut)} km
                  </>
                )}
                {r.mileageIn != null && <> · Retour : {num(r.mileageIn)} km</>}
              </span>
            </div>
          </section>

          <section className="card" aria-labelledby="montant">
            <h2 id="montant">Période et montant</h2>
            <table className="data" style={{ fontSize: 15 }}>
              <tbody>
                <tr><td className="muted">Départ</td><td className="right">{dateTime(r.start)}</td></tr>
                <tr><td className="muted">Retour prévu</td><td className="right">{dateTime(r.end)}</td></tr>
                <tr><td className="muted">{days} jour(s) × {money(r.dailyRate)}</td><td className="right num">{money(r.total)}</td></tr>
                {rate && <tr><td className="muted">Kilométrage inclus</td><td className="right">{rate.kmPerDay} km/jour, puis {money(rate.extraKm)}/km</td></tr>}
                {r.fees > 0 && <tr><td className="muted">Frais constatés au retour</td><td className="right num">{money(r.fees)}</td></tr>}
                <tr>
                  <td><strong>Total</strong></td>
                  <td className="right" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: 'var(--atlantique)' }}>
                    {money(r.total + r.fees)}
                  </td>
                </tr>
              </tbody>
            </table>
            {data.inspections.some((i) => i.reservationId === r.id) && (
              <p className="small" style={{ margin: 0 }}>
                États des lieux :{' '}
                {data.inspections.filter((i) => i.reservationId === r.id).sort((a, b) => a.doneAt.localeCompare(b.doneAt)).map((i, k) => (
                  <span key={i.id}>{k > 0 && ' · '}<Link to={`/reservations/${r.id}/${i.kind}`}>{i.kind === 'depart' ? 'départ' : 'retour'} ({i.items.filter((x) => x.status === 'dommage').length} dommage(s), {i.items.reduce((s, x) => s + x.photos.length, 0)} photos)</Link></span>
                ))}
              </p>
            )}
            <p className="small muted" style={{ margin: 0 }}>
              Caution de {money(r.caution)}, remboursée après le retour, moins les frais éventuels.
              {r.notes && <><br />Notes : {r.notes}</>}
            </p>
          </section>
        </div>

        <section className="card col-1" aria-labelledby="paiements">
          <h2 id="paiements">Paiements</h2>
          <div className="grid-2" style={{ gap: 'var(--space-2)' }}>
            <div>
              <div className="kpi-label">Reste dû</div>
              <div className="num" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: due ? 'var(--ocre-text)' : 'var(--success)' }}>
                {due ? money(due) : 'Soldé'}
              </div>
            </div>
            <div>
              <div className="kpi-label">Caution détenue</div>
              <div className="num" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: 'var(--atlantique)' }}>{money(held)}</div>
            </div>
          </div>
          <ul className="alerts">
            {pays.length === 0 && <li>Aucun paiement enregistré.</li>}
            {pays.map((p) => (
              <li key={p.id} style={p.status !== 'paye' ? { background: '#fff', border: '2px solid var(--ocre)' } : undefined}>
                <span className="grow">
                  <strong>{kindLabel[p.kind]}</strong>
                  <br />
                  <span className="muted">
                    {methodLabel[p.method]}
                    {p.reference ? ` · réf. ${p.reference}` : ''}
                    {p.paidAt ? ` · ${new Date(p.paidAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                  </span>
                </span>
                <span className="right">
                  <strong className="num">{p.kind === 'remboursement_caution' || p.kind === 'remboursement' ? '−' : ''}{num(p.amount)}</strong>
                  <br />
                  <span style={{ fontWeight: 600, color: p.status === 'paye' ? 'var(--success)' : p.status === 'echoue' ? 'var(--danger)' : 'var(--ocre-text)' }}>
                    {p.status === 'paye' ? 'Payé' : p.status === 'echoue' ? 'Échoué' : 'En attente'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="stack" style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="kpi-label">Facturation</span>
              <span className={`badge ${payStatusLabel[ps.status][1]}`}>{payStatusLabel[ps.status][0]}</span>
            </div>
            <span className="small muted">{terms.label}{ps.depositDue > 0 && ps.depositMissing > 0 ? ` · acompte attendu ${money(ps.depositMissing)}` : ''}</span>
            {invoices.map((i) => (
              <Link key={i.id} to={`/factures/${i.id}`} className="row small" style={{ justifyContent: 'space-between', textDecoration: 'none' }}>
                <span>{i.kind === 'avoir' ? 'Avoir' : i.kind === 'complement' ? 'Facture de frais' : 'Facture'} {i.number}</span>
                <span className="num">{money(i.totalTtc)}</span>
              </Link>
            ))}
            {invoices.length === 0 && r.status !== 'annulee' && canPay && (
              <button
                className="btn btn-sm"
                onClick={async () => {
                  try {
                    await invoiceReservation(store, billing, r);
                    await refresh();
                    toast('Facture établie');
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                Établir la facture
              </button>
            )}
          </div>
          {canPay && (r.status !== 'annulee' || ps.status === 'trop_percu' || held > 0) && (
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              {r.status !== 'annulee' && <button className="btn btn-dark" onClick={() => setDialog('pay')}>Encaisser un paiement</button>}
              {ps.status === 'trop_percu' && (
                <button className="btn" onClick={() => setDialog('overpaid')}>Rembourser le trop-perçu ({money(ps.paid - ps.owed)})</button>
              )}
              {(r.status === 'terminee' || r.status === 'annulee') && held > 0 && (
                <button className="btn" onClick={() => setDialog('refund')}>Rembourser la caution</button>
              )}
              {c && ps.remaining > 0 && (
                <a
                  className="btn"
                  target="_blank"
                  rel="noreferrer"
                  href={whatsappLink(
                    c.contactPhone || c.phone,
                    [
                      `Bonjour ${(c.contactName || c.name).split(' ')[0]}, voici les modalités de paiement pour votre location ${r.number} (${session?.org.name}).`,
                      ps.depositMissing > 0 ? `Acompte à régler : ${money(ps.depositMissing)}.` : `Reste à régler : ${money(ps.remaining)}${ps.dueDate ? `, avant le ${new Date(ps.dueDate + 'T12:00:00').toLocaleDateString('fr-FR')}` : ''}.`,
                      ...payeeLines(billing.settings.payees),
                      `Merci d'indiquer la référence ${r.number} avec votre paiement.`,
                    ].join('\n'),
                    COUNTRY_CALLING_CODE[session?.org.country ?? 'SN'],
                  )}
                >
                  Envoyer les moyens de paiement (WhatsApp)
                </a>
              )}
            </div>
          )}
        </section>
      </div>


      {dialog === 'pay' && <PayDialog onClose={() => setDialog(null)} />}
      {dialog === 'refund' && <PayDialog refund onClose={() => setDialog(null)} />}
      {dialog === 'overpaid' && <PayDialog overpaid onClose={() => setDialog(null)} />}
      {dialog === 'checkout' && <CheckoutDialog onClose={() => setDialog(null)} />}
      {dialog === 'checkin' && <CheckinDialog onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <CancelDialog onClose={() => setDialog(null)} />}
    </>
  );
}

function useCurrent() {
  const { id } = useParams();
  const ctx = useData();
  const r = ctx.data.reservations.find((x) => x.id === id)!;
  const v = ctx.data.vehicles.find((x) => x.id === r.vehicleId);
  return { ...ctx, r, v };
}

const REF_LABEL: Partial<Record<PaymentMethod, string>> = {
  wave: 'N° de transaction Wave',
  orange_money: 'N° de transaction Orange Money',
  free_money: 'N° de transaction Free Money',
  mtn: 'N° de transaction MTN',
  moov: 'N° de transaction Moov',
  carte: 'N° d’autorisation de la carte',
  virement: 'Référence du virement',
  cheque: 'N° du chèque et banque',
};

function PayDialog({ onClose, refund, overpaid }: { onClose: () => void; refund?: boolean; overpaid?: boolean }) {
  const { r, data, store, refresh, toast, now } = useCurrent();
  const billing = useBilling();
  const ps = payState(r, data.invoices, data.payments, now);
  const held = cautionHeld(r.id, data.payments);
  const hasCaution = data.payments.some((p) => p.reservationId === r.id && p.kind === 'caution' && p.status === 'paye');
  const paidSomething = ps.paid > 0;
  // Proposition selon les modalités : acompte d'abord, puis solde, puis frais ; la caution au départ.
  const defKind: PaymentKind = overpaid
    ? 'remboursement'
    : refund
    ? 'remboursement_caution'
    : ps.depositMissing > 0 && r.status === 'reservee'
      ? 'acompte'
      : ps.remaining > 0
        ? r.fees > 0 && r.status === 'terminee' && paidSomething ? 'frais' : 'solde'
        : !hasCaution && r.status !== 'terminee' ? 'caution' : 'solde';
  const suggested = (k: PaymentKind) =>
    k === 'remboursement' ? Math.max(0, ps.paid - ps.owed) : k === 'remboursement_caution' ? held : k === 'caution' ? r.caution : k === 'acompte' ? (ps.depositMissing || ps.remaining) : ps.remaining;
  const [kind, setKind] = useState<PaymentKind>(defKind);
  const [amount, setAmount] = useState(String(suggested(defKind)));
  const [method, setMethod] = useState<PaymentMethod>('wave');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const needsRef = method === 'cheque' || method === 'virement';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const a = Math.round(Number(amount));
    if (!(a > 0)) return setError('Montant invalide.');
    if (kind === 'remboursement_caution' && a > held) return setError(`La caution détenue est de ${money(held)}.`);
    if (kind === 'remboursement' && a > ps.paid - ps.owed) return setError(`Le trop-perçu est de ${money(ps.paid - ps.owed)}.`);
    if (needsRef && !reference.trim()) return setError(method === 'cheque' ? 'Indiquez le numéro du chèque.' : 'Indiquez la référence du virement.');
    try {
      const at = new Date().toISOString();
      const p: Omit<Payment, 'id'> = {
        reservationId: r.id, kind, amount: a, method, status: 'paye', paidAt: at, createdAt: at,
        reference: method === 'especes' ? null : reference.trim() || null,
      };
      await store.insert('payments', p);
      await refresh();
      toast(refund || overpaid ? 'Remboursement enregistré' : `${kindLabel[kind]} de ${money(a)} enregistré`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={overpaid ? 'Rembourser le trop-perçu' : refund ? 'Rembourser la caution' : 'Encaisser un paiement'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {!refund && !overpaid && (
          <div className="notice" style={{ margin: 0 }}>
            {termsFor(billing.settings, data.clients.find((x) => x.id === r.clientId)).label}.{' '}
            Facturé {money(ps.owed)} · déjà payé {money(ps.paid)} · <strong>reste {money(ps.remaining)}</strong>
            {ps.depositMissing > 0 && <> · acompte attendu {money(ps.depositMissing)}</>}
          </div>
        )}
        {!refund && !overpaid && (
          <label className="field">
            Nature
            <select value={kind} onChange={(e) => { const k = e.target.value as PaymentKind; setKind(k); setAmount(String(suggested(k))); }}>
              <option value="acompte">Acompte</option>
              <option value="solde">Solde de la location</option>
              <option value="frais">Frais au retour</option>
              <option value="caution">Caution</option>
            </select>
          </label>
        )}
        <div className="grid-2">
          <label className="field">
            Montant (FCFA)
            <input type="number" min={1} step={1} required value={amount} onChange={(e) => setAmount(e.target.value)} />
            {refund && <span className="hint">Caution détenue : {money(held)}</span>}
            {overpaid && <span className="hint">Trop-perçu : {money(ps.paid - ps.owed)}</span>}
          </label>
          <label className="field">
            Moyen de paiement
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {Object.entries(methodLabel).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </label>
        </div>
        {method !== 'especes' && (
          <label className="field">
            {REF_LABEL[method] ?? 'Référence'}{needsRef ? '' : ' (recommandé)'}
            <input value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} placeholder={method === 'cheque' ? '0012345 · CBAO' : ''} />
            <span className="hint">Permet de retrouver le paiement en cas de contestation ou de rapprochement bancaire.</span>
          </label>
        )}
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

function CheckoutDialog({ onClose }: { onClose: () => void }) {
  const { r, v, store, refresh, toast, data } = useCurrent();
  const [mileage, setMileage] = useState(String(v?.mileage ?? 0));
  const [error, setError] = useState<string | null>(null);
  const cautionPaid = data.payments.some((p) => p.reservationId === r.id && p.kind === 'caution' && p.status === 'paye');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const m = Math.round(Number(mileage));
    if (v && m < v.mileage) return setError(`Le compteur ne peut pas être inférieur à ${num(v.mileage)} km.`);
    try {
      await store.update('reservations', r.id, { status: 'en_cours', mileageOut: m });
      if (v) await store.update('vehicles', v.id, { mileage: m });
      await refresh();
      toast('Véhicule remis au client');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title="Remise des clés" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {!cautionPaid && <div className="notice">La caution de {money(r.caution)} n’est pas encore encaissée.</div>}
        <label className="field">
          Kilométrage au départ
          <input type="number" inputMode="numeric" required value={mileage} onChange={(e) => setMileage(e.target.value)} />
        </label>
        <p className="small muted" style={{ margin: 0 }}>Départ sans photos ni signature. Pour un état des lieux complet, utilisez « État des lieux et remise des clés ».</p>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary">Confirmer le départ</button>
        </div>
      </form>
    </Modal>
  );
}

function CheckinDialog({ onClose }: { onClose: () => void }) {
  const { r, v, data, store, refresh, toast } = useCurrent();
  const billing = useBilling();
  const rate = data.rates.find((x) => x.category === v?.category);
  const [mileage, setMileage] = useState(String(r.mileageOut ?? v?.mileage ?? 0));
  const [returnedAt, setReturnedAt] = useState(toLocalInput(new Date().toISOString()));
  const [fuel, setFuel] = useState(0);
  const [fuelPrice, setFuelPrice] = useState('15000');
  const [damages, setDamages] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const fees = returnFees(r, rate, {
    mileageIn: Number(mileage) || 0,
    fuelQuartersMissing: fuel,
    fuelQuarterPrice: Number(fuelPrice) || 0,
    damages: Number(damages) || 0,
    returnedAt: returnedAt ? fromLocalInput(returnedAt) : new Date().toISOString(),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const m = Math.round(Number(mileage));
    if (r.mileageOut != null && m < r.mileageOut) return setError(`Le compteur ne peut pas être inférieur au départ (${num(r.mileageOut)} km).`);
    try {
      const end = fees.lateDays > 0 ? fromLocalInput(returnedAt) : r.end;
      await store.update('reservations', r.id, { status: 'terminee', mileageIn: m, fees: fees.total, end });
      if (v) await store.update('vehicles', v.id, { mileage: m });
      // Les frais font l'objet d'une facture complémentaire : la facture initiale ne se modifie pas.
      const detail = [
        fees.kmExtra ? `${fees.kmExtra} km supplémentaires` : '',
        fees.fuelFee ? 'carburant' : '',
        fees.lateDays ? `retard de ${fees.lateDays} jour(s)` : '',
        fees.damages ? 'dégâts' : '',
      ].filter(Boolean).join(', ');
      if (fees.total > 0) await invoiceFees(store, billing, { ...r, fees: fees.total, end }, detail);
      await refresh();
      toast(fees.total ? `Retour enregistré · ${money(fees.total)} de frais` : 'Retour enregistré, sans frais');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title="Retour du véhicule" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">
            Kilométrage au retour
            <input type="number" inputMode="numeric" required value={mileage} onChange={(e) => setMileage(e.target.value)} />
            <span className="hint">Départ : {r.mileageOut != null ? `${num(r.mileageOut)} km` : 'non relevé'}</span>
          </label>
          <label className="field">
            Date et heure du retour
            <input type="datetime-local" required value={returnedAt} onChange={(e) => setReturnedAt(e.target.value)} />
          </label>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Carburant manquant</legend>
          <div className="tabs">
            {[0, 1, 2, 3, 4].map((q) => (
              <button key={q} type="button" aria-selected={fuel === q} onClick={() => setFuel(q)}>
                {q === 0 ? 'Aucun' : `${q}/4`}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid-2">
          <label className="field">
            Prix d’un quart de réservoir
            <input type="number" min={0} value={fuelPrice} onChange={(e) => setFuelPrice(e.target.value)} />
          </label>
          <label className="field">
            Dégâts constatés (FCFA)
            <input type="number" min={0} value={damages} onChange={(e) => setDamages(e.target.value)} />
          </label>
        </div>
        <div className="notice">
          <strong>Frais : {money(fees.total)}</strong>
          <br />
          {fees.kmDriven} km parcourus{fees.kmExtra ? `, ${fees.kmExtra} km en plus (${money(fees.kmFee)})` : ', dans le forfait'}
          {fees.fuelFee ? ` · carburant ${money(fees.fuelFee)}` : ''}
          {fees.lateDays ? ` · retard ${fees.lateDays} j (${money(fees.lateFee)})` : ''}
          {fees.damages ? ` · dégâts ${money(fees.damages)}` : ''}
        </div>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary">Clôturer la location</button>
        </div>
      </form>
    </Modal>
  );
}

function CancelDialog({ onClose }: { onClose: () => void }) {
  const { r, store, refresh, toast, data } = useCurrent();
  const hasInvoice = data.invoices.some((i) => i.reservationId === r.id && i.kind !== 'avoir');
  async function confirm() {
    await store.update('reservations', r.id, { status: 'annulee' });
    // Une facture émise ne se supprime pas : un avoir l'annule.
    await creditReservation(store, data.invoices, r.id);
    await refresh();
    toast('Réservation annulée, le véhicule est libéré');
    onClose();
  }
  return (
    <Modal title={`Annuler ${r.number} ?`} onClose={onClose}>
      <p style={{ margin: 0 }}>Le véhicule redevient disponible sur cette période. Les paiements déjà reçus restent à rembourser à part.{hasInvoice ? ' Un avoir est établi pour annuler la facture.' : ''}</p>
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Garder la réservation</button>
        <button type="button" className="btn btn-danger" onClick={confirm}>Annuler la réservation</button>
      </div>
    </Modal>
  );
}
