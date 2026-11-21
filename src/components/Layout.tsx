import { useMemo } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { alertsFor, buildAlerts } from '../domain/alerts';
import type { DemoStore } from '../data/demoStore';
import { useData } from '../state/DataContext';
import { Logo, roleLabel, Wordmark } from './ui';

const planLabel = { essentiel: 'Essentiel', pro: 'Pro', entreprise: 'Entreprise' };

export function Layout() {
  const { session, store, setSession, data, now, refresh, toast, can } = useData();
  const nav = useNavigate();
  const alerts = useMemo(() => (session ? alertsFor(buildAlerts(data, now), session.role) : []), [data, now, session]);
  if (!session) return null;
  const urgent = alerts.filter((a) => a.level === 'urgent').length;
  const pendingRequests = data.bookingRequests.filter((r) => r.status === 'nouvelle').length;
  const { org } = session;
  const trialDays = org.trialEndsAt ? Math.ceil((Date.parse(org.trialEndsAt) - now.getTime()) / 86400000) : null;

  const links: [string, string][] = [
    ['/', 'Tableau de bord'],
    ['/alertes', 'Alertes'],
    ['/planning', 'Planning'],
    ['/reservations', 'Réservations et contrats'],
    ...(can('direction', 'agent') ? ([['/demandes', 'Demandes en ligne']] as [string, string][]) : []),
    ['/vehicules', 'Véhicules'],
    ['/clients', 'Clients'],
    ...(can('direction', 'agent', 'comptable') ? ([['/factures', 'Factures']] as [string, string][]) : []),
    ['/maintenance', 'Maintenance'],
    ['/depenses', 'Dépenses'],
    ['/tarifs', 'Tarifs'],
    ...(can('direction', 'comptable') ? ([['/rapports', 'Rapports']] as [string, string][]) : []),
    ...(can('direction') ? ([['/equipe', 'Équipe']] as [string, string][]) : []),
    ['/parametres', 'Paramètres'],
  ];

  async function logout() {
    await store.signOut();
    setSession(null);
    nav('/');
  }

  async function resetDemo() {
    (store as DemoStore).reset();
    await refresh();
    toast('Données d’exemple rechargées');
  }

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <Logo />
          <Wordmark />
        </div>
        <nav className="nav" aria-label="Navigation principale">
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : undefined)}>
              {label}
              {to === '/demandes' && pendingRequests > 0 && (
                <span className="nav-count" aria-label={`${pendingRequests} demande(s) à traiter`}>{pendingRequests}</span>
              )}
              {to === '/alertes' && alerts.length > 0 && (
                <span className={`nav-count${urgent ? ' urgent' : ''}`} aria-label={`${alerts.length} alerte(s), dont ${urgent} urgente(s)`}>
                  {urgent || alerts.length}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <span>
            {org.name}
            <br />
            Formule {planLabel[org.plan]} · {data.vehicles.length}/{org.vehicleQuota} véhicules
            {trialDays !== null && trialDays >= 0 && (
              <>
                <br />
                Essai : {trialDays} jour{trialDays > 1 ? 's' : ''} restant{trialDays > 1 ? 's' : ''}
              </>
            )}
          </span>
          <span>
            {session.userEmail} · {roleLabel[session.role]}
          </span>
          {store.mode === 'demo' && (
            <button type="button" className="btn btn-sm" onClick={resetDemo}>
              Réinitialiser la démo
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={logout}>
            Se déconnecter
          </button>
        </div>
      </aside>
      <main className="main" id="contenu">
        {store.mode === 'demo' && (
          <div className="notice no-print">
            <strong>Mode démo.</strong> Les données sont fictives et restent dans ce navigateur.
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
