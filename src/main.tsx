import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Clients } from './pages/Clients';
import { Dashboard } from './pages/Dashboard';
import { Team } from './pages/Team';
import { Settings } from './pages/Settings';
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
  if (!session) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="planning" element={<Planning />} />
        <Route path="reservations" element={<Reservations />} />
        <Route path="reservations/:id" element={<ReservationDetail />} />
        <Route path="vehicules" element={<Vehicles />} />
        <Route path="clients" element={<Clients />} />
        <Route path="maintenance" element={<Maintenance />} />
        <Route path="tarifs" element={<Rates />} />
        <Route path="equipe" element={<Team />} />
        <Route path="parametres" element={<Settings />} />
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
