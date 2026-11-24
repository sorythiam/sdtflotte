import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { money } from '../domain/format';
import { VTC_MODULE, vtcModuleActive } from '../domain/saas';
import { useData } from '../state/DataContext';

/** Le module Chauffeurs VTC est une option payante : sans elle, on présente le module. */
export function VtcGate({ children }: { children: ReactNode }) {
  const { session, now, can, data } = useData();
  const org = session!.org;
  if (vtcModuleActive(org, now)) return <>{children}</>;
  const kept = data.vtc_contracts.length;
  return (
    <section className="card" style={{ maxWidth: 640, margin: '24px auto' }}>
      <span className="badge badge-muted" style={{ alignSelf: 'flex-start' }}>Module en option</span>
      <h1 style={{ margin: 0 }}>Chauffeurs VTC</h1>
      <p style={{ margin: 0 }}>
        Confiez vos véhicules à des chauffeurs Yango, Heetch ou Uber contre un versement chaque jour travaillé, en location simple ou en location-vente.
        Yoon Fleet suit les versements, calcule les retards, prépare les relances WhatsApp et répartit les dépenses entre vous et le chauffeur.
      </p>
      <p style={{ margin: 0 }}>
        <strong style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--atlantique)' }}>{money(VTC_MODULE.monthlyHt)} HT</strong> par mois, quel que soit le nombre de chauffeurs.
      </p>
      {kept > 0 && <p className="small muted" style={{ margin: 0 }}>Vos {kept} contrat(s) VTC sont conservés : ils réapparaissent dès l’activation.</p>}
      {can() ? (
        <Link className="btn btn-primary" style={{ alignSelf: 'flex-start' }} to="/abonnement#modules">Activer le module</Link>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>Demandez à l’administrateur du compte d’activer le module dans Paramètres › Abonnement.</p>
      )}
    </section>
  );
}
