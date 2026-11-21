import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DemoStore } from '../data/demoStore';
import type { SessionInfo, Store } from '../data/store';
import { SupabaseStore } from '../data/supabaseStore';
import type { BookingRequest } from '../domain/booking';
import type { Invoice } from '../domain/billing';
import type { Inspection } from '../domain/inspection';
import type { Client, Expense, Maintenance, Payment, Rate, Reservation, Role, Vehicle } from '../domain/types';

export interface Data {
  vehicles: Vehicle[];
  clients: Client[];
  rates: Rate[];
  reservations: Reservation[];
  payments: Payment[];
  maintenances: Maintenance[];
  expenses: Expense[];
  invoices: Invoice[];
  inspections: Inspection[];
  bookingRequests: BookingRequest[];
}

const empty: Data = { vehicles: [], clients: [], rates: [], reservations: [], payments: [], maintenances: [], expenses: [], invoices: [], inspections: [], bookingRequests: [] };

interface Ctx {
  store: Store;
  session: SessionInfo | null;
  data: Data;
  loading: boolean;
  now: Date;
  refresh: () => Promise<void>;
  setSession: (s: SessionInfo | null) => void;
  can: (...roles: Role[]) => boolean;
  toast: (msg: string) => void;
}

const DataCtx = createContext<Ctx | null>(null);

function makeStore(): Store {
  const env = import.meta.env;
  const url = (env.VITE_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL) as string | undefined;
  const key = (env.VITE_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string | undefined;
  return url && key ? new SupabaseStore(url, key) : new DemoStore();
}

export function DataProvider({ children }: { children: ReactNode }) {
  const store = useMemo(makeStore, []);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [booting, setBooting] = useState(true);
  const [data, setData] = useState<Data>(empty);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [vehicles, clients, rates, reservations, payments, maintenances, expenses, invoices, inspections, bookingRequests] = await Promise.all([
        store.list('vehicles'),
        store.list('clients'),
        store.list('rates'),
        store.list('reservations'),
        store.list('payments'),
        store.list('maintenances'),
        store.list('expenses'),
        store.list('invoices'),
        store.list('inspections'),
        // Réservées à la direction et aux agents : les autres profils reçoivent une liste vide.
        store.listBookingRequests().catch(() => [] as BookingRequest[]),
      ]);
      setData({ vehicles, clients, rates, reservations, payments, maintenances, expenses, invoices, inspections, bookingRequests });
      setNow(new Date());
    } finally {
      setLoading(false);
    }
  }, [store]);

  useEffect(() => {
    store
      .session()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setBooting(false));
  }, [store]);

  useEffect(() => {
    if (session) void refresh();
    else setData(empty);
  }, [session, refresh]);

  // L'heure avance : retards et retours du jour restent justes sans recharger.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 3500);
  }, []);

  const can = useCallback(
    (...roles: Role[]) => !!session && (session.role === 'admin' || roles.includes(session.role)),
    [session],
  );

  if (booting) return null;

  return (
    <DataCtx.Provider value={{ store, session, data, loading, now, refresh, setSession, can, toast }}>
      {children}
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </DataCtx.Provider>
  );
}

export function useData(): Ctx {
  const c = useContext(DataCtx);
  if (!c) throw new Error('useData hors de DataProvider');
  return c;
}
