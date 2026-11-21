import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { DemoStore } from '../data/demoStore';
import { useData } from '../state/DataContext';
import { Logo, roleLabel, Wordmark } from './ui';

const planLabel = { essentiel: 'Essentiel', pro: 'Pro', entreprise: 'Entreprise' };

export function Layout() {
  const { session, store, setSession, data, now, refresh, toast, can } = useData();
  const nav = useNavigate();
  if (!session) return null;
  const { org } = session;
  const trialDays = org.trialEndsAt ? Math.ceil((Date.parse(org.trialEndsAt) - now.getTime()) / 86400000) : null;

  const links: [string, string][] = [
    ['/', 'Tableau de bord'],
    ['/planning', 'Planning'],
    ['/reservations', 'Réservations et contrats'],
    ['/vehicules', 'Véhicules'],
    ['/clients', 'Clients'],
    ['/maintenance', 'Maintenance'],
    ['/tarifs', 'Tarifs'],
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
