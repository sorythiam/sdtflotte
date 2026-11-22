import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox } from '../components/ui';
import { dateTime } from '../domain/format';
import type { AuditEntry } from '../domain/types';
import { useData } from '../state/DataContext';

const tableLabel: Record<string, string> = {
  reservations: 'Réservation', payments: 'Paiement', invoices: 'Facture', clients: 'Client', vehicles: 'Véhicule',
  rates: 'Tarif', maintenances: 'Entretien', expenses: 'Dépense', drivers: 'Chauffeur', packages: 'Forfait',
  incidents: 'Incident', maintenance_plans: 'Plan d’entretien', reservation_changes: 'Avenant', inspections: 'État des lieux',
};
const actionLabel: Record<AuditEntry['action'], [string, string]> = {
  creation: ['Création', 'badge-success'],
  modification: ['Modification', ''],
  suppression: ['Suppression', 'badge-danger'],
};
// Champs techniques traduits pour la lecture.
const fieldLabel: Record<string, string> = {
  status: 'statut', start: 'départ', end: 'retour', total: 'montant', fees: 'frais', daily_rate: 'prix jour', driver_id: 'chauffeur',
  mileage: 'kilométrage', mileage_in: 'km retour', mileage_out: 'km départ', score: 'scoring', score_reason: 'motif', verified_at: 'validation',
  verified_by: 'validé par', documents: 'pièces', phone: 'téléphone', name: 'nom', email: 'email', out_of_service: 'hors service',
  insurance_expiry: 'assurance', inspection_expiry: 'visite technique', vignette_expiry: 'vignette', photos: 'photos', seats: 'places',
  deal_discount: 'remise', deal_rates: 'prix négociés', deal_until: 'fin du contrat cadre', active: 'actif', last_km: 'dernier km',
  last_date: 'dernière date', amount: 'montant', paid_at: 'date de paiement', reference: 'référence', caution: 'caution', notes: 'notes',
};
const linkFor = (e: AuditEntry): string | null => {
  if (!e.rowId || e.action === 'suppression') return null;
  if (e.tableName === 'reservations') return `/reservations/${e.rowId}`;
  if (e.tableName === 'clients') return `/clients/${e.rowId}`;
  if (e.tableName === 'vehicles') return `/vehicules/${e.rowId}`;
  if (e.tableName === 'invoices') return `/factures/${e.rowId}`;
  return null;
};

/** Journal des actions : qui a créé, modifié ou supprimé quoi, et quand. */
export function AuditLog() {
  const { store, data } = useData();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState('');
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    store.listAudit(500).then(setEntries).catch((e: Error) => setError(e.message));
  }, [store, data]);

  const users = useMemo(() => [...new Set((entries ?? []).map((e) => e.userEmail).filter(Boolean) as string[])].sort(), [entries]);
  const list = (entries ?? []).filter(
    (e) => (!table || e.tableName === table) && (!who || e.userEmail === who) && (!q || `${e.label ?? ''} ${e.changes ?? ''}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Journal des actions</h1>
          <p className="muted small">Qui a créé, modifié ou supprimé quoi, et quand. Tenu par le système : personne ne peut le modifier. 500 dernières actions.</p>
        </div>
      </header>
      <ErrorBox error={error} />
      <div className="grid-3">
        <label className="field">Élément
          <select value={table} onChange={(e) => setTable(e.target.value)}>
            <option value="">Tous</option>
            {Object.entries(tableLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="field">Personne
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Toute l’équipe</option>
            {users.map((u) => <option key={u}>{u}</option>)}
          </select>
        </label>
        <label className="field">Rechercher<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="N° de contrat, plaque, nom…" /></label>
      </div>
      <section className="card">
        {entries === null && !error ? (
          <span className="muted">Chargement…</span>
        ) : list.length === 0 ? (
          <Empty>Aucune action enregistrée{table || who || q ? ' pour ces filtres' : ''}.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Quand</th><th>Qui</th><th>Action</th><th>Élément</th><th>Champs modifiés</th></tr></thead>
              <tbody>
                {list.map((e) => {
                  const href = linkFor(e);
                  return (
                    <tr key={String(e.id)}>
                      <td className="small">{dateTime(e.at)}</td>
                      <td className="small">{e.userEmail ?? 'Système'}</td>
                      <td><span className={`badge ${actionLabel[e.action][1]}`}>{actionLabel[e.action][0]}</span></td>
                      <td>
                        {tableLabel[e.tableName] ?? e.tableName}
                        {e.label && <> · {href ? <Link to={href}>{e.label}</Link> : <strong>{e.label}</strong>}</>}
                      </td>
                      <td className="small muted">{e.changes ? e.changes.split(', ').map((f) => fieldLabel[f] ?? f.replace(/_/g, ' ')).join(', ') : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
