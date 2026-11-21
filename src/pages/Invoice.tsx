import { Link, useParams } from 'react-router-dom';
import { payeeLines, payState, payStatusLabel } from '../domain/billing';
import { legalLine, taxIdLabel } from '../domain/clients';
import { contractSettings } from '../domain/contract';
import { dateLong, money, num } from '../domain/format';
import { useData } from '../state/DataContext';
import { useBilling } from '../state/useBilling';
import { methodLabel } from './ReservationDetail';

const title = { facture: 'Facture', complement: 'Facture', avoir: 'Avoir' };

export function InvoicePage() {
  const { id } = useParams();
  const { data, session, now } = useData();
  const billing = useBilling();
  const inv = data.invoices.find((i) => i.id === id);
  if (!inv) {
    return (
      <div className="card">
        <p>Facture introuvable.</p>
        <Link to="/factures">Retour aux factures</Link>
      </div>
    );
  }
  const org = session!.org;
  const s = contractSettings(org.name, org.contract);
  const taxLabel = taxIdLabel(org.country);
  const r = data.reservations.find((x) => x.id === inv.reservationId);
  const related = inv.relatedInvoiceId ? data.invoices.find((x) => x.id === inv.relatedInvoiceId) : undefined;
  const ps = r ? payState(r, data.invoices, data.payments, now) : null;
  const pays = data.payments
    .filter((p) => p.reservationId === inv.reservationId && p.status === 'paye' && (p.kind === 'acompte' || p.kind === 'solde' || p.kind === 'frais'))
    .sort((a, b) => (a.paidAt ?? '').localeCompare(b.paidAt ?? ''));
  const b = inv.billTo;
  const vatOn = inv.vatRate > 0;
  const payees = payeeLines(billing.settings.payees);
  const d = (iso: string) => dateLong(iso + 'T12:00:00');

  return (
    <>
      <header className="page-head no-print">
        <div>
          <span className="small muted">
            <Link to="/factures">Factures</Link>
            {r && <> · <Link to={`/reservations/${r.id}`}>contrat {r.number}</Link></>}
          </span>
          <div className="row">
            <h1>{title[inv.kind]} {inv.number}</h1>
            {ps && inv.kind !== 'avoir' && <span className={`badge ${payStatusLabel[ps.status][1]}`}>{payStatusLabel[ps.status][0]}</span>}
          </div>
        </div>
        <button className="btn btn-dark" onClick={() => window.print()}>Imprimer ou enregistrer en PDF</button>
      </header>

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
            <div>{inv.kind === 'avoir' ? 'Facture d’avoir' : inv.kind === 'complement' ? 'Facture complémentaire' : 'Facture'}</div>
            <strong>N° {inv.number}</strong>
            <div className="ct-small">
              Émise le {d(inv.issueDate)}
              {inv.kind !== 'avoir' && <><br />Échéance : {d(inv.dueDate)}</>}
            </div>
          </div>
        </header>

        <div className="ct-grid">
          <section>
            <h3>Facturé à</h3>
            <div style={{ fontWeight: 600 }}>{b.name}</div>
            <div className="ct-small">
              {[b.address, b.city].filter(Boolean).join(', ')}
              {b.kind === 'entreprise' && legalLine(b, taxLabel) && <><br />{legalLine(b, taxLabel)}</>}
              {b.contactName && <><br />À l’attention de {b.contactName}</>}
              <br />
              {[b.phone, b.email].filter(Boolean).join(' · ')}
            </div>
          </section>
          <section>
            <h3>Références</h3>
            <dl className="ct-dl">
              {r && (<><dt>Contrat</dt><dd>{r.number}</dd></>)}
              {related && (<><dt>Annule la facture</dt><dd>{related.number}</dd></>)}
              <dt>Modalités</dt><dd style={{ fontWeight: 400 }}>{inv.terms}</dd>
            </dl>
          </section>
        </div>

        <table className="ct-table">
          <thead>
            <tr><th>Désignation</th><th className="right">Qté</th><th className="right">Prix unitaire HT</th><th className="right">Montant HT</th></tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
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
            <tr><td>Total HT</td><td>{money(inv.totalHt)}</td></tr>
            <tr><td>{vatOn ? `TVA ${num(inv.vatRate)} %` : 'TVA'}</td><td>{vatOn ? money(inv.vat) : 'Non applicable'}</td></tr>
            <tr className="ct-total"><td>{inv.kind === 'avoir' ? 'Total de l’avoir TTC' : 'Net à payer TTC'}</td><td>{money(inv.totalTtc)}</td></tr>
            {inv.depositDue > 0 && <tr><td>Dont acompte demandé à la réservation</td><td>{money(inv.depositDue)}</td></tr>}
          </tbody>
        </table>

        {inv.kind !== 'avoir' && pays.length > 0 && (
          <section className="ct-avoid-break">
            <h3>Paiements reçus sur ce contrat</h3>
            <table className="ct-table">
              <thead><tr><th>Date</th><th>Nature</th><th>Moyen</th><th>Référence</th><th className="right">Montant</th></tr></thead>
              <tbody>
                {pays.map((p) => (
                  <tr key={p.id}>
                    <td>{p.paidAt ? dateLong(p.paidAt) : ''}</td>
                    <td>{p.kind === 'acompte' ? 'Acompte' : p.kind === 'frais' ? 'Frais' : 'Solde'}</td>
                    <td>{methodLabel[p.method]}</td>
                    <td>{p.reference ?? ''}</td>
                    <td className="right">{money(p.amount)}</td>
                  </tr>
                ))}
                {ps && <tr><td colSpan={4}><strong>Reste à payer sur le contrat</strong></td><td className="right"><strong>{money(ps.remaining)}</strong></td></tr>}
              </tbody>
            </table>
          </section>
        )}

        {inv.kind !== 'avoir' && payees.length > 0 && (
          <section className="ct-avoid-break">
            <h3>Comment payer</h3>
            <p className="ct-small" style={{ margin: 0 }}>
              {payees.join(' · ')}. Indiquez la référence {inv.number} avec votre paiement.
            </p>
          </section>
        )}

        <p className="ct-small" style={{ marginTop: 'auto' }}>
          {billing.settings.invoiceFooter || `${s.legalName}${s.registration ? ` · ${s.registration}` : ''}`}
          {!vatOn && ' · TVA non applicable.'}
        </p>
      </article>
    </>
  );
}
