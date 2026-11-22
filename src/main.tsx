import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Clients } from './pages/Clients';
import { VehicleDetail } from './pages/VehicleDetail';
import { Drivers } from './pages/Drivers';
import { AuditLog } from './pages/AuditLog';
import { ClientDetail } from './pages/ClientDetail';
import { Dashboard } from './pages/Dashboard';
import { Team } from './pages/Team';
import { Settings } from './pages/Settings';
import { Reports } from './pages/Reports';
import { Contract } from './pages/Contract';
import { PublicBooking } from './pages/PublicBooking';
import { BookingRequests } from './pages/BookingRequests';
import { Expenses } from './pages/Expenses';
import { Invoices } from './pages/Invoices';
import { InvoicePage } from './pages/Invoice';
import { InspectionPage } from './pages/InspectionPage';
import { Login } from './pages/Login';
import { Maintenance } from './pages/Maintenance';
import { Planning } from './pages/Planning';
import { Rates } from './pages/Rates';
import { ReservationDetail } from './pages/ReservationDetail';
import { Reservations } from './pages/Reservations';
import { Vehicles } from './pages/Vehicles';
import { DataProvider, useData } from './state/DataContext';
import './styles/app.css';

function App() {
  const { session } = useData();
  const { pathname } = useLocation();
  // Page publique de réservation : accessible sans compte.
  const pub = pathname.match(/^\/r\/([a-z0-9-]+)\/?$/i);
  if (pub) return <PublicBooking slug={pub[1].toLowerCase()} />;
  if (!session) return <Login />;
  return (
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
