import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { NewPassword } from './pages/NewPassword';
import { DataProvider, useData } from './state/DataContext';
// Polices hébergées avec l'application (pas d'appel à Google Fonts) : jeu latin seulement.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/sora/latin-400.css';
import '@fontsource/sora/latin-600.css';
import '@fontsource/sora/latin-700.css';
import '@fontsource/sora/latin-800.css';
import './styles/app.css';
// Pages chargées à la demande : premier affichage plus rapide sur un petit téléphone en 3G.
const pages = {
  Clients: () => import('./pages/Clients'),
  VehicleDetail: () => import('./pages/VehicleDetail'),
  Drivers: () => import('./pages/Drivers'),
  Vtc: () => import('./pages/Vtc'),
  VtcDetail: () => import('./pages/VtcDetail'),
  AuditLog: () => import('./pages/AuditLog'),
  ClientDetail: () => import('./pages/ClientDetail'),
  Team: () => import('./pages/Team'),
  Settings: () => import('./pages/Settings'),
  Reports: () => import('./pages/Reports'),
  Contract: () => import('./pages/Contract'),
  PublicBooking: () => import('./pages/PublicBooking'),
  BookingRequests: () => import('./pages/BookingRequests'),
  Expenses: () => import('./pages/Expenses'),
  Invoices: () => import('./pages/Invoices'),
  InvoicePage: () => import('./pages/Invoice'),
  InspectionPage: () => import('./pages/InspectionPage'),
  Maintenance: () => import('./pages/Maintenance'),
  Planning: () => import('./pages/Planning'),
  Rates: () => import('./pages/Rates'),
  ReservationDetail: () => import('./pages/ReservationDetail'),
  Reservations: () => import('./pages/Reservations'),
  Vehicles: () => import('./pages/Vehicles'),
};
const Clients = lazy(() => pages.Clients().then((m) => ({ default: m.Clients })));
const VehicleDetail = lazy(() => pages.VehicleDetail().then((m) => ({ default: m.VehicleDetail })));
const Drivers = lazy(() => pages.Drivers().then((m) => ({ default: m.Drivers })));
const Vtc = lazy(() => pages.Vtc().then((m) => ({ default: m.Vtc })));
const VtcDetail = lazy(() => pages.VtcDetail().then((m) => ({ default: m.VtcDetail })));
const AuditLog = lazy(() => pages.AuditLog().then((m) => ({ default: m.AuditLog })));
const ClientDetail = lazy(() => pages.ClientDetail().then((m) => ({ default: m.ClientDetail })));
const Team = lazy(() => pages.Team().then((m) => ({ default: m.Team })));
const Settings = lazy(() => pages.Settings().then((m) => ({ default: m.Settings })));
const Reports = lazy(() => pages.Reports().then((m) => ({ default: m.Reports })));
const Contract = lazy(() => pages.Contract().then((m) => ({ default: m.Contract })));
const PublicBooking = lazy(() => pages.PublicBooking().then((m) => ({ default: m.PublicBooking })));
const BookingRequests = lazy(() => pages.BookingRequests().then((m) => ({ default: m.BookingRequests })));
const Expenses = lazy(() => pages.Expenses().then((m) => ({ default: m.Expenses })));
const Invoices = lazy(() => pages.Invoices().then((m) => ({ default: m.Invoices })));
const InvoicePage = lazy(() => pages.InvoicePage().then((m) => ({ default: m.InvoicePage })));
const InspectionPage = lazy(() => pages.InspectionPage().then((m) => ({ default: m.InspectionPage })));
const Maintenance = lazy(() => pages.Maintenance().then((m) => ({ default: m.Maintenance })));
const Planning = lazy(() => pages.Planning().then((m) => ({ default: m.Planning })));
const Rates = lazy(() => pages.Rates().then((m) => ({ default: m.Rates })));
const ReservationDetail = lazy(() => pages.ReservationDetail().then((m) => ({ default: m.ReservationDetail })));
const Reservations = lazy(() => pages.Reservations().then((m) => ({ default: m.Reservations })));
const Vehicles = lazy(() => pages.Vehicles().then((m) => ({ default: m.Vehicles })));

/** Une fois l'application affichée, on charge les autres pages en tâche de fond :
 *  elles s'ouvrent ensuite instantanément et restent disponibles hors connexion. */
function usePrefetchPages() {
  useEffect(() => {
    const go = () => Object.values(pages).forEach((load) => void load().catch(() => undefined));
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const t = w.requestIdleCallback ? w.requestIdleCallback(go) : window.setTimeout(go, 2500);
    return () => { if (!w.requestIdleCallback) window.clearTimeout(t); };
  }, []);
}

const Loading = () => <div className="page-loading" role="status" aria-label="Chargement" />;


function App() {
  const { session } = useData();
  const { pathname } = useLocation();
  // Page publique de réservation : accessible sans compte.
  const pub = pathname.match(/^\/r\/([a-z0-9-]+)\/?$/i);
  usePrefetchPages();
  if (pathname === '/nouveau-mot-de-passe') return <NewPassword />;
  if (pub) return <Suspense fallback={<Loading />}><PublicBooking slug={pub[1].toLowerCase()} /></Suspense>;
  if (!session) return <Login />;
  return (
    <Suspense fallback={<Loading />}>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="planning" element={<Planning />} />
        <Route path="reservations" element={<Reservations />} />
        <Route path="reservations/:id" element={<ReservationDetail />} />
        <Route path="reservations/:id/contrat" element={<Contract />} />
        <Route path="reservations/:id/depart" element={<InspectionPage kind="depart" />} />
        <Route path="reservations/:id/retour" element={<InspectionPage kind="retour" />} />
        <Route path="vehicules" element={<Vehicles />} />
        <Route path="vehicules/:id" element={<VehicleDetail />} />
        <Route path="chauffeurs" element={<Drivers />} />
        <Route path="vtc" element={<Vtc />} />
        <Route path="vtc/:id" element={<VtcDetail />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="maintenance" element={<Maintenance />} />
        <Route path="tarifs" element={<Rates />} />
        <Route path="equipe" element={<Team />} />
        <Route path="journal" element={<AuditLog />} />
        <Route path="parametres" element={<Settings />} />
        <Route path="rapports" element={<Reports />} />
        <Route path="alertes" element={<Navigate to="/" replace />} />
        <Route path="demandes" element={<BookingRequests />} />
        <Route path="depenses" element={<Expenses />} />
        <Route path="factures" element={<Invoices />} />
        <Route path="factures/:id" element={<InvoicePage />} />
        <Route path="*" element={<Dashboard />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <DataProvider>
        <App />
      </DataProvider>
    </BrowserRouter>
  </StrictMode>,
);

// Application installable et utilisable sans réseau (production uniquement).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
