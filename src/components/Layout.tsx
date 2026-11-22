import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { alertsFor, buildAlerts } from '../domain/alerts';
import type { DemoStore } from '../data/demoStore';
import { useData } from '../state/DataContext';
import { icons, SECTIONS, sectionOf, visibleTabs, type Section } from './nav';
import { Logo, roleLabel, Wordmark } from './ui';

const planLabel = { essentiel: 'Essentiel', pro: 'Pro', entreprise: 'Entreprise' };
/** Sections de la barre du bas sur téléphone ; les autres vont dans « Plus ». */
const BOTTOM: Section['key'][] = ['home', 'planning', 'reservations', 'fleet'];

export function Layout() {
  const { session, store, setSession, data, now, refresh, toast, offline, outboxCount, syncNow } = useData();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [sheet, setSheet] = useState(false);
  const alerts = useMemo(() => (session ? alertsFor(buildAlerts({ ...data, plans: data.maintenance_plans, vtc: { contracts: data.vtc_contracts, payments: data.vtc_payments, expenses: data.expenses, drivers: data.drivers } }, now), session.role) : []), [data, now, session]);
  useEffect(() => setSheet(false), [pathname]);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSheet(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);
  if (!session) return null;

  const role = session.role;
  const urgent = alerts.filter((a) => a.level === 'urgent').length;
  const pendingRequests = role === 'admin' || role === 'direction' || role === 'agent' ? data.bookingRequests.filter((r) => r.status === 'nouvelle').length : 0;
  const { org } = session;
  const trialDays = org.trialEndsAt ? Math.ceil((Date.parse(org.trialEndsAt) - now.getTime()) / 86400000) : null;

  const sections = SECTIONS.filter((s) => visibleTabs(s, role).length > 0);
  const current = sectionOf(pathname);
  const tabs = visibleTabs(current, role);
  const bottom = sections.filter((s) => BOTTOM.includes(s.key));
  const more = sections.filter((s) => !BOTTOM.includes(s.key));
  const moreActive = more.some((s) => s.key === current.key);

  const badge = (kind?: 'alerts' | 'requests') => {
    if (kind === 'alerts' && alerts.length > 0)
      return (
        <span className={`nav-count${urgent ? ' urgent' : ''}`} aria-label={`${alerts.length} alerte(s), dont ${urgent} urgente(s)`}>
          {urgent || alerts.length}
        </span>
      );
    if (kind === 'requests' && pendingRequests > 0)
      return <span className="nav-count" aria-label={`${pendingRequests} demande(s) en ligne à traiter`}>{pendingRequests}</span>;
    return null;
  };
  const isActive = (s: Section) => s.key === current.key;
  const first = (s: Section) => visibleTabs(s, role)[0].to;

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

  const account = (
    <div className="side-foot">
      <span>
        <strong className="org-name">{org.name}</strong>
        <br />
        Formule {planLabel[org.plan]} · {data.vehicles.length}/{org.vehicleQuota} véhicules
        {trialDays !== null && trialDays >= 0 && (
          <>
            <br />
            Essai : {trialDays} jour{trialDays > 1 ? 's' : ''} restant{trialDays > 1 ? 's' : ''}
          </>
        )}
      </span>
      <span className="side-user">
        {session.userEmail} · {roleLabel[role]}
      </span>
      <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {store.mode === 'demo' && (
          <button type="button" className="btn btn-sm" onClick={resetDemo}>
            Réinitialiser la démo
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={logout}>
          Se déconnecter
        </button>
      </div>
    </div>
  );

  return (
    <div className="shell">
      <a className="skip" href="#contenu">Aller au contenu</a>

      {/* Ordinateur : barre latérale fixe */}
      <aside className="side no-print">
        <div className="brand">
          <Logo />
          <Wordmark />
        </div>
        <nav className="nav" aria-label="Navigation principale">
          {sections.map((s) => (
            <NavLink key={s.key} to={first(s)} className={isActive(s) ? 'active' : undefined} aria-current={isActive(s) ? 'page' : undefined} title={s.label}>
              <span className="nav-label">
                {s.icon}
                {s.label}
              </span>
              {badge(s.badge)}
            </NavLink>
          ))}
        </nav>
        {account}
      </aside>

      <div className="main-col">
        {/* Téléphone : barre du haut fixe */}
        <header className="topbar no-print">
          <NavLink to="/" className="topbar-brand" aria-label="Accueil">
            <Logo />
          </NavLink>
          <span className="topbar-title">{current.label}</span>
          {badge(current.key === 'home' ? undefined : 'alerts') && (
            <NavLink to="/" className="topbar-alert" aria-label="Voir les alertes">
              {badge('alerts')}
            </NavLink>
          )}
        </header>

        {/* Onglets de la section, fixes en haut au défilement */}
        {tabs.length > 1 && (
          <nav className="subnav no-print" aria-label={`Rubriques ${current.label}`}>
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                {t.label}
                {badge(t.badge)}
              </NavLink>
            ))}
          </nav>
        )}

        <main className="main" id="contenu">
          {store.mode === 'demo' && (
            <div className="notice no-print">
              <strong>Mode démo.</strong> Les données sont fictives et restent dans ce navigateur.
            </div>
          )}
          {(offline || outboxCount > 0) && (
            <div className={`sync-banner no-print${offline ? ' off' : ''}`} role="status">
              <span>
                {offline ? <strong>Hors connexion.</strong> : null}{' '}
                {offline && 'Vous voyez les données de la dernière synchronisation. Les états des lieux restent possibles et sont gardés sur le téléphone. '}
                {outboxCount > 0 && <>{outboxCount} état{outboxCount > 1 ? 's' : ''} des lieux en attente d’envoi.</>}
              </span>
              {!offline && outboxCount > 0 && <button className="btn btn-sm" onClick={() => void syncNow()}>Envoyer maintenant</button>}
            </div>
          )}
          <Outlet />
        </main>
      </div>

      {/* Téléphone : barre du bas */}
      <nav className="bottombar no-print" aria-label="Navigation principale">
        {bottom.map((s) => (
          <NavLink key={s.key} to={first(s)} className={isActive(s) ? 'active' : undefined} aria-current={isActive(s) ? 'page' : undefined}>
            <span className="bb-icon">
              {s.icon}
              {badge(s.badge)}
            </span>
            <span>{s.label}</span>
          </NavLink>
        ))}
        <button type="button" className={moreActive || sheet ? 'active' : undefined} aria-expanded={sheet} aria-controls="plus" onClick={() => setSheet((v) => !v)}>
          <span className="bb-icon">{icons.more}</span>
          <span>Plus</span>
        </button>
      </nav>

      {sheet && (
        <div className="sheet-backdrop no-print" onClick={() => setSheet(false)}>
          <div className="sheet" id="plus" role="dialog" aria-label="Plus" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" aria-hidden="true" />
            <nav className="sheet-nav" aria-label="Autres rubriques">
              {more.map((s) => (
                <NavLink key={s.key} to={first(s)} className={isActive(s) ? 'active' : undefined}>
                  {s.icon}
                  <span>{s.label}</span>
                  {badge(s.badge)}
                </NavLink>
              ))}
            </nav>
            {account}
          </div>
        </div>
      )}
    </div>
  );
}
