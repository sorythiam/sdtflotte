import { Link, useParams } from 'react-router-dom';
import { methodLabel } from './ReservationDetail';
import { taxIdLabel } from '../domain/clients';
import { contractSettings, FUEL_LEVELS, INSPECTION_ZONES, parseTerms } from '../domain/contract';
import { dateLong, dateTime, money, num } from '../domain/format';
import { balanceDue, billedDays, cautionHeld } from '../domain/rules';
import { useData } from '../state/DataContext';

const kindText = { acompte: 'Acompte', solde: 'Solde', caution: 'Caution', frais: 'Frais', remboursement_caution: 'Remboursement de caution' };
const blank = '……………………';

export function Contract() {
  const { id } = useParams();
  const { data, session } = useData();
  const org = session!.org;
  const r = data.reservations.find((x) => x.id === id);
  if (!r) {
    return (
      <div className="card">
        <p>Contrat introuvable.</p>
        <Link to="/reservations">Retour aux réservations</Link>
      </div>
    );
  }
  const s = contractSettings(org.name, org.contract);
  const taxLabel = taxIdLabel(org.country);
  const v = data.vehicles.find((x) => x.id === r.vehicleId);
  const c = data.clients.find((x) => x.id === r.clientId);
  const rate = data.rates.find((x) => x.category === v?.category);
  const days = billedDays(r.start, r.end);
  const pays = data.payments.filter((p) => p.reservationId === r.id && p.status === 'paye').sort((a, b) => (a.paidAt ?? '').localeCompare(b.paidAt ?? ''));
  const due = balanceDue(r, data.payments);
  const held = cautionHeld(r.id, data.payments);
  // Part chauffeur bornée au total, au cas où le tarif aurait changé depuis la réservation.
  const driverTotal = r.withDriver && rate ? Math.min(r.total, rate.driverDaily * days) : 0;
  const articles = parseTerms(s.terms);
  const issued = r.createdAt || r.start;
  const returned = r.status === 'terminee';

  return (
    <>
      <header className="page-head no-print">
        <div>
          <span className="small muted">
            <Link to="/reservations">Réservations et contrats</Link> › <Link to={`/reservations/${r.id}`}>{r.number}</Link> › Contrat
          </span>
          <h1>Contrat {r.number}</h1>
        </div>
        <div className="row">
          <Link className="btn" to={`/reservations/${r.id}`}>Retour à la réservation</Link>
          <button className="btn btn-dark" onClick={() => window.print()}>Imprimer ou enregistrer en PDF</button>
        </div>
      </header>
      <p className="hint no-print" style={{ marginTop: 0 }}>
        Pour un PDF : cliquez sur le bouton puis choisissez « Enregistrer au format PDF » comme imprimante. Coordonnées, logo et
        conditions générales : <Link to="/parametres">Paramètres</Link>, rubrique Contrat.
      </p>

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
            <div>Contrat de location de véhicule</div>
            <strong>N° {r.number}</strong>
            <div className="ct-small">Établi le {dateLong(issued)}</div>
          </div>
        </header>

        <div className="ct-grid">
          <section>
            <h3>Le loueur</h3>
            <dl className="ct-dl">
              <dt>Société</dt><dd>{s.legalName}</dd>
              <dt>Adresse</dt><dd>{[s.address, s.city].filter(Boolean).join(', ') || blank}</dd>
              <dt>Contact</dt><dd>{[s.phone, s.email].filter(Boolean).join(' · ') || blank}</dd>
            </dl>
          </section>
          <section>
            <h3>Le locataire</h3>
            {c?.kind === 'entreprise' ? (
              <dl className="ct-dl">
                <dt>Société</dt><dd>{c.name}</dd>
                <dt>{taxLabel}</dt><dd>{c.taxId || blank}</dd>
                <dt>RCCM</dt><dd>{c.tradeRegister || blank}</dd>
                <dt>Adresse</dt><dd>{[c.address, c.city].filter(Boolean).join(', ') || blank}</dd>
                <dt>Contact société</dt><dd>{[c.phone, c.email].filter(Boolean).join(' · ') || blank}</dd>
                <dt>Représentée par</dt><dd>{c.contactName ? `${c.contactName}${c.contactRole ? `, ${c.contactRole}` : ''}` : blank}</dd>
                <dt>Tél. du représentant</dt><dd>{[c.contactPhone, c.contactEmail].filter(Boolean).join(' · ') || blank}</dd>
                <dt>Pièce d’identité</dt><dd>{c.idNumber || blank}</dd>
                {!r.withDriver && (<><dt>Permis du conducteur jusqu’au</dt><dd>{c.licenseExpiry ? dateLong(c.licenseExpiry) : blank}</dd></>)}
              </dl>
            ) : (
              <dl className="ct-dl">
                <dt>Nom</dt><dd>{c?.name ?? blank}</dd>
                <dt>Adresse</dt><dd>{[c?.address, c?.city].filter(Boolean).join(', ') || blank}</dd>
                <dt>Téléphone</dt><dd>{c?.phone || blank}</dd>
                <dt>Email</dt><dd>{c?.email || blank}</dd>
                <dt>Pièce d’identité</dt><dd>{c?.idNumber || blank}</dd>
                {!r.withDriver && (<><dt>Permis valable jusqu’au</dt><dd>{c?.licenseExpiry ? dateLong(c.licenseExpiry) : blank}</dd></>)}
              </dl>
            )}
          </section>
        </div>

        <section>
          <h3>Véhicule et période</h3>
          <table className="ct-table">
            <tbody>
              <tr><th>Véhicule</th><td>{v ? `${v.brand} ${v.model}${v.year ? ` (${v.year})` : ''}` : blank}</td><th>Immatriculation</th><td>{v?.plate ?? blank}</td></tr>
              <tr><th>Catégorie</th><td>{v?.category ?? blank}</td><th>Formule</th><td>{r.withDriver ? 'Avec chauffeur' : 'Sans chauffeur'}</td></tr>
              <tr><th>Départ</th><td>{dateTime(r.start)}</td><th>Retour prévu</th><td>{dateTime(r.end)}</td></tr>
              <tr><th>Kilométrage départ</th><td>{r.mileageOut != null ? `${num(r.mileageOut)} km` : `${blank} km`}</td><th>Kilométrage retour</th><td>{r.mileageIn != null ? `${num(r.mileageIn)} km` : `${blank} km`}</td></tr>
              {!r.withDriver && (<tr><th>Conducteur additionnel</th><td colSpan={3}>{blank}{blank}  Permis n° {blank}</td></tr>)}
            </tbody>
          </table>
        </section>

        <section>
          <h3>Prix</h3>
          <table className="ct-table ct-money">
            <tbody>
              <tr><td>Location du véhicule : {days} jour{days > 1 ? 's' : ''}</td><td>{money(r.total - driverTotal)}</td></tr>
              {driverTotal > 0 && <tr><td>Chauffeur : {days} jour{days > 1 ? 's' : ''}</td><td>{money(driverTotal)}</td></tr>}
              {r.fees > 0 && <tr><td>Frais constatés au retour</td><td>{money(r.fees)}</td></tr>}
              <tr className="ct-total"><td>Total</td><td>{money(r.total + r.fees)}</td></tr>
              <tr><td>Caution (restituée au retour, déduction faite des sommes dues)</td><td>{money(r.caution)}</td></tr>
            </tbody>
          </table>
          <p className="ct-small">
            Kilométrage inclus : {rate ? `${num(rate.kmPerDay * days)} km (${num(rate.kmPerDay)} km par jour)` : blank}, puis {rate ? money(rate.extraKm) : blank} par km
            supplémentaire. Au-delà d’une heure de retard, chaque journée entamée est facturée au tarif journalier.
          </p>
          {pays.length > 0 && (
            <table className="ct-table">
              <thead><tr><th>Paiements reçus</th><th>Date</th><th>Moyen</th><th className="right">Montant</th></tr></thead>
              <tbody>
                {pays.map((p) => (
                  <tr key={p.id}><td>{kindText[p.kind]}</td><td>{p.paidAt ? dateLong(p.paidAt) : ''}</td><td>{methodLabel[p.method]}</td><td className="right">{money(p.amount)}</td></tr>
                ))}
                <tr><td colSpan={3}><strong>Reste à payer</strong>{held > 0 ? ` · caution détenue : ${money(held)}` : ''}</td><td className="right"><strong>{money(due)}</strong></td></tr>
              </tbody>
            </table>
          )}
        </section>

        <section className="ct-avoid-break">
          <h3>État des lieux</h3>
          <table className="ct-table ct-check">
            <thead>
              <tr><th>Élément</th><th>Départ : OK</th><th>Départ : observations</th><th>Retour : OK</th><th>Retour : observations</th></tr>
            </thead>
            <tbody>
              {INSPECTION_ZONES.map((z) => (
                <tr key={z}><td>{z}</td><td className="ct-box">☐</td><td /><td className="ct-box">☐</td><td /></tr>
              ))}
              <tr>
                <td>Carburant</td>
                <td colSpan={2}>{FUEL_LEVELS.map((l) => `☐ ${l}`).join('   ')}</td>
                <td colSpan={2}>{FUEL_LEVELS.map((l) => `☐ ${l}`).join('   ')}</td>
              </tr>
              <tr><td>Papiers du véhicule remis</td><td className="ct-box">☐</td><td /><td className="ct-box">☐</td><td /></tr>
            </tbody>
          </table>
          {r.notes && <p className="ct-small"><strong>Notes :</strong> {r.notes}</p>}
        </section>

        <section className="ct-avoid-break">
          <p className="ct-small">
            Le locataire déclare avoir pris connaissance des conditions générales ci-après, qui font partie du présent contrat, et les accepter sans réserve.
          </p>
          <p>Fait à {s.city || blank}, le {dateLong(issued)}, en deux exemplaires.</p>
          <div className="ct-sign">
            <div>
              <strong>Le loueur</strong>
              <span className="ct-small">Nom, signature et cachet</span>
            </div>
            <div>
              <strong>Le locataire</strong>
              <span className="ct-small">
                {c?.kind === 'entreprise' ? `Pour ${c.name}${c.contactName ? `, ${c.contactName}` : ''} : signature, cachet et « lu et approuvé »` : 'Signature précédée de « lu et approuvé »'}
              </span>
            </div>
          </div>
          {returned && (
            <div className="ct-sign">
              <div><strong>Retour constaté par le loueur</strong><span className="ct-small">Date et signature</span></div>
              <div><strong>Le locataire</strong><span className="ct-small">Signature</span></div>
            </div>
          )}
        </section>

        <section className="ct-terms">
          <h3>Conditions générales de location</h3>
          <div className="ct-columns">
            {articles.map((a, i) => (
              <p key={i}>
                {a.title && <strong>{a.title}. </strong>}
                {a.body}
              </p>
            ))}
          </div>
          <p className="ct-small" style={{ marginTop: 16 }}>
            Paraphe du locataire : ………… · Contrat {r.number} · {s.legalName}
          </p>
        </section>
      </article>
    </>
  );
}
