import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorBox, Logo, Modal, ReservationBadge, ScoreBadge } from '../components/ui';
import { dateTime, fromLocalInput, money, num, toLocalInput } from '../domain/format';
import { balanceDue, billedDays, cautionHeld, lateDays, returnFees } from '../domain/rules';
import type { Payment, PaymentKind, PaymentMethod } from '../domain/types';
import { useData } from '../state/DataContext';

export const methodLabel: Record<PaymentMethod, string> = {
  especes: 'Espèces',
  wave: 'Wave',
  orange_money: 'Orange Money',
  free_money: 'Free Money',
  mtn: 'MTN MoMo',
  moov: 'Moov Money',
  carte: 'Carte bancaire',
  virement: 'Virement',
};
const kindLabel: Record<PaymentKind, string> = {
  acompte: 'Acompte',
  solde: 'Solde',
  caution: 'Caution',
  frais: 'Frais',
  remboursement_caution: 'Remboursement de caution',
};

type Dialog = null | 'pay' | 'checkout' | 'checkin' | 'refund' | 'cancel';

export function ReservationDetail() {
  const { id } = useParams();
  const { data, now, can, session } = useData();
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
  const due = balanceDue(r, data.payments);
  const held = cautionHeld(r.id, data.payments);
  const late = lateDays(r, now);
  const days = billedDays(r.start, r.end);
  const canRent = can('direction', 'agent');
  const canPay = can('direction', 'agent', 'comptable');

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
              <button className="btn btn-primary" onClick={() => setDialog('checkout')}>Remise des clés</button>
            </>
          )}
          {r.status === 'en_cours' && canRent && (
            <button className="btn btn-primary" onClick={() => setDialog('checkin')}>Retour du véhicule</button>
          )}
          <button className="btn" onClick={() => window.print()}>Imprimer le contrat</button>
        </div>
      </header>

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
                    {p.paidAt ? ` · ${new Date(p.paidAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                  </span>
                </span>
                <span className="right">
                  <strong className="num">{p.kind === 'remboursement_caution' ? '−' : ''}{num(p.amount)}</strong>
                  <br />
                  <span style={{ fontWeight: 600, color: p.status === 'paye' ? 'var(--success)' : p.status === 'echoue' ? 'var(--danger)' : 'var(--ocre-text)' }}>
                    {p.status === 'paye' ? 'Payé' : p.status === 'echoue' ? 'Échoué' : 'En attente'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {canPay && r.status !== 'annulee' && (
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <button className="btn btn-dark" onClick={() => setDialog('pay')}>Encaisser un paiement</button>
              {r.status === 'terminee' && held > 0 && (
                <button className="btn" onClick={() => setDialog('refund')}>Rembourser la caution</button>
              )}
              <button className="btn" disabled title="Disponible dès qu’un agrégateur est connecté dans les paramètres">
                Envoyer un lien de paiement
              </button>
              <span className="hint">Le lien mobile money arrive avec la connexion à votre agrégateur (InTouch, PayDunya…).</span>
            </div>
          )}
        </section>
      </div>

      <ContractPrint orgName={session?.org.name ?? ''} />

      {dialog === 'pay' && <PayDialog onClose={() => setDialog(null)} />}
      {dialog === 'refund' && <PayDialog refund onClose={() => setDialog(null)} />}
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

function PayDialog({ onClose, refund }: { onClose: () => void; refund?: boolean }) {
  const { r, data, store, refresh, toast } = useCurrent();
  const due = balanceDue(r, data.payments);
  const held = cautionHeld(r.id, data.payments);
  const hasCaution = data.payments.some((p) => p.reservationId === r.id && p.kind === 'caution' && p.status === 'paye');
  const defKind: PaymentKind = refund ? 'remboursement_caution' : !hasCaution && r.status === 'reservee' ? 'caution' : due > 0 ? (r.fees > 0 && r.status === 'terminee' ? 'frais' : 'solde') : 'caution';
  const [kind, setKind] = useState<PaymentKind>(defKind);
  const [amount, setAmount] = useState(String(refund ? held : defKind === 'caution' ? r.caution : due));
  const [method, setMethod] = useState<PaymentMethod>('wave');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const a = Math.round(Number(amount));
    if (!(a > 0)) return setError('Montant invalide.');
    if (kind === 'remboursement_caution' && a > held) return setError(`La caution détenue est de ${money(held)}.`);
    try {
      const now = new Date().toISOString();
      const p: Omit<Payment, 'id'> = { reservationId: r.id, kind, amount: a, method, status: 'paye', paidAt: now, createdAt: now };
      await store.insert('payments', p);
      await refresh();
      toast(refund ? 'Remboursement enregistré' : 'Paiement enregistré');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={refund ? 'Rembourser la caution' : 'Encaisser un paiement'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {!refund && (
          <label className="field">
            Nature
            <select value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)}>
              <option value="acompte">Acompte</option>
              <option value="solde">Solde de la location</option>
              <option value="caution">Caution</option>
              <option value="frais">Frais au retour</option>
            </select>
          </label>
        )}
        <div className="grid-2">
          <label className="field">
            Montant (FCFA)
            <input type="number" min={1} step={1} required value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="hint">{refund ? `Caution détenue : ${money(held)}` : `Reste dû : ${money(due)}`}</span>
          </label>
          <label className="field">
            Moyen
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {Object.entries(methodLabel).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </label>
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
        <p className="small muted" style={{ margin: 0 }}>Les photos et la signature sur mobile arrivent dans la prochaine version.</p>
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
      await store.update('reservations', r.id, { status: 'terminee', mileageIn: m, fees: fees.total, end: fees.lateDays > 0 ? fromLocalInput(returnedAt) : r.end });
      if (v) await store.update('vehicles', v.id, { mileage: m });
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
  const { r, store, refresh, toast } = useCurrent();
  async function confirm() {
    await store.update('reservations', r.id, { status: 'annulee' });
    await refresh();
    toast('Réservation annulée, le véhicule est libéré');
    onClose();
  }
  return (
    <Modal title={`Annuler ${r.number} ?`} onClose={onClose}>
      <p style={{ margin: 0 }}>Le véhicule redevient disponible sur cette période. Les paiements déjà reçus restent à rembourser à part.</p>
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Garder la réservation</button>
        <button type="button" className="btn btn-danger" onClick={confirm}>Annuler la réservation</button>
      </div>
    </Modal>
  );
}

function ContractPrint({ orgName }: { orgName: string }) {
  const { r, v, data } = useCurrent();
  const c = data.clients.find((x) => x.id === r.clientId);
  const rate = data.rates.find((x) => x.category === v?.category);
  return (
    <section className="print-only" style={{ fontSize: 12, lineHeight: '18px' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row"><Logo inverse={false} size={32} /><strong style={{ fontSize: 16 }}>{orgName}</strong></div>
        <strong>Contrat de location {r.number}</strong>
      </div>
      <p>
        Entre <strong>{orgName}</strong> (le loueur) et <strong>{c?.name}</strong>, {c?.phone}
        {c?.idNumber ? `, pièce n° ${c.idNumber}` : ''} (le locataire).
      </p>
      <p>
        Véhicule : {v?.brand} {v?.model}, immatriculé {v?.plate}, {r.withDriver ? 'avec' : 'sans'} chauffeur. Kilométrage au départ :{' '}
        {r.mileageOut != null ? `${num(r.mileageOut)} km` : '__________ km'}.
      </p>
      <p>
        Période : du {dateTime(r.start)} au {dateTime(r.end)}, soit {billedDays(r.start, r.end)} jour(s) à {money(r.dailyRate)}, total {money(r.total)}. Caution :{' '}
        {money(r.caution)}. Kilométrage inclus : {rate?.kmPerDay ?? '—'} km par jour, puis {money(rate?.extraKm ?? 0)} par km. Toute journée de retard entamée au-delà d’une heure est facturée au tarif journalier.
      </p>
      <p>Le carburant manquant et les dégâts constatés à l’état des lieux de retour sont déduits de la caution.</p>
      <div className="grid-2" style={{ marginTop: 40 }}>
        <div>Signature du loueur</div>
        <div>Signature du locataire, précédée de « lu et approuvé »</div>
      </div>
      <p className="xs muted" style={{ marginTop: 40 }}>Contrat généré par Yoon Fleet.</p>
    </section>
  );
}
