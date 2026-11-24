import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DemoStore } from '../data/demoStore';
import type { SessionInfo, Store } from '../data/store';
import { SupabaseStore } from '../data/supabaseStore';
import type { BookingRequest } from '../domain/booking';
import type { Invoice } from '../domain/billing';
import type { Inspection } from '../domain/inspection';
import type { Client, Driver, Expense, Incident, Maintenance, MaintenancePlan, Package, ReservationChange, VtcContract, VtcPayment, Payment, Rate, Reservation, Role, Vehicle, Season, Quote, VtcAdjustment } from '../domain/types';
import type { DepositDeclaration, ReservationPortal } from '../domain/portal';
import { billingSettings } from '../domain/billing';
import { idbGet, idbSet } from '../offline/idb';
import { isNetworkError, onOutboxChange, pending } from '../offline/outbox';
import { syncOutbox } from '../offline/sync';

// Dernière session et dernières données, pour ouvrir l'application sans réseau.
const SESSION_CACHE = 'yoonfleet-session-cache';
const readSessionCache = (): SessionInfo | null => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_CACHE) ?? 'null') as SessionInfo | null;
  } catch {
    return null;
  }
};
const writeSessionCache = (s: SessionInfo | null) => {
  try {
    if (s) localStorage.setItem(SESSION_CACHE, JSON.stringify(s));
    else localStorage.removeItem(SESSION_CACHE);
  } catch {
    /* stockage plein ou interdit : sans conséquence en ligne */
  }
};
const dataKey = (s: SessionInfo) => `data:${s.org.id}:${s.userId}`;

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
  incidents: Incident[];
  drivers: Driver[];
  packages: Package[];
  reservation_changes: ReservationChange[];
  maintenance_plans: MaintenancePlan[];
  vtc_contracts: VtcContract[];
  vtc_payments: VtcPayment[];
  vtc_adjustments: VtcAdjustment[];
  reservation_portals: ReservationPortal[];
  deposit_declarations: DepositDeclaration[];
  seasons: Season[];
  quotes: Quote[];
  bookingRequests: BookingRequest[];
}

const empty: Data = { vehicles: [], clients: [], rates: [], reservations: [], payments: [], maintenances: [], expenses: [], invoices: [], inspections: [], incidents: [], drivers: [], packages: [], reservation_changes: [], maintenance_plans: [], vtc_contracts: [], vtc_payments: [], vtc_adjustments: [], reservation_portals: [], deposit_declarations: [], seasons: [], quotes: [], bookingRequests: [] };

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
  /** Pas de réseau : données de la dernière synchronisation, en lecture. */
  offline: boolean;
  /** États des lieux enregistrés sur le téléphone, en attente d'envoi. */
  outboxCount: number;
  syncNow: () => Promise<void>;
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
  const [session, setSessionState] = useState<SessionInfo | null>(null);
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [outboxCount, setOutboxCount] = useState(0);
  const setSession = useCallback(
    (s: SessionInfo | null) => {
      setSessionState(s);
      if (store.mode === 'supabase') writeSessionCache(s);
    },
    [store],
  );
  const [booting, setBooting] = useState(true);
  const [data, setData] = useState<Data>(empty);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [vehicles, clients, rates, reservations, payments, maintenances, expenses, invoices, inspections, incidents, drivers, packages, reservation_changes, maintenance_plans, vtc_contracts, vtc_payments, vtc_adjustments, reservation_portals, deposit_declarations, seasons, quotes, bookingRequests] = await Promise.all([
        store.list('vehicles'),
        store.list('clients'),
        store.list('rates'),
        store.list('reservations'),
        store.list('payments'),
        store.list('maintenances'),
        store.list('expenses'),
        store.list('invoices'),
        store.list('inspections'),
        store.list('incidents').catch(() => [] as Incident[]),
        store.list('drivers').catch(() => [] as Driver[]),
        store.list('packages').catch(() => [] as Package[]),
        store.list('reservation_changes').catch(() => [] as ReservationChange[]),
        store.list('maintenance_plans').catch(() => [] as MaintenancePlan[]),
        store.list('vtc_contracts').catch(() => [] as VtcContract[]),
        store.list('vtc_payments').catch(() => [] as VtcPayment[]),
        store.list('vtc_adjustments').catch(() => [] as VtcAdjustment[]),
        store.list('reservation_portals').catch(() => [] as ReservationPortal[]),
        store.list('deposit_declarations').catch(() => [] as DepositDeclaration[]),
        store.list('seasons').catch(() => [] as Season[]),
        store.list('quotes').catch(() => [] as Quote[]),
        // Réservées à la direction et aux agents : les autres profils reçoivent une liste vide.
        store.listBookingRequests().catch(() => [] as BookingRequest[]),
      ]);
      const fresh = { vehicles, clients, rates, reservations, payments, maintenances, expenses, invoices, inspections, incidents, drivers, packages, reservation_changes, maintenance_plans, vtc_contracts, vtc_payments, vtc_adjustments, reservation_portals, deposit_declarations, seasons, quotes, bookingRequests };
      setData(fresh);
      setOffline(navigator.onLine === false);
      setNow(new Date());
      if (session && store.mode === 'supabase') void idbSet('cache', dataKey(session), fresh).catch(() => undefined);
    } catch (e) {
      // Pas de réseau : on affiche la dernière copie gardée sur l'appareil.
      if (session && isNetworkError(e)) {
        const cached = await idbGet<Data>('cache', dataKey(session)).catch(() => undefined);
        if (cached) {
          setData({ ...empty, ...cached });
          setOffline(true);
          return;
        }
      }
      throw e;
    } finally {
      setLoading(false);
    }
  }, [store, session]);

  useEffect(() => {
    const cached = store.mode === 'supabase' ? readSessionCache() : null;
    store
      .session()
      .then((s) => {
        // Sans réseau, la vérification échoue : on reprend la dernière session connue.
        if (!s && cached && !navigator.onLine) {
          setSessionState(cached);
          setOffline(true);
        } else setSession(s);
      })
      .catch(() => {
        if (cached) {
          setSessionState(cached);
          setOffline(true);
        } else setSession(null);
      })
      .finally(() => setBooting(false));
  }, [store, setSession]);

  // File d'envoi : compteur, et envoi automatique dès que le réseau revient.
  const billing = useCallback(
    () => ({ settings: billingSettings(session?.org.name ?? '', session?.org.billing), clients: data.clients, vehicles: data.vehicles, rates: data.rates, invoices: data.invoices }),
    [session, data],
  );
  const countOutbox = useCallback(async () => {
    setOutboxCount(session ? (await pending(session.org.id)).length : 0);
  }, [session]);
  useEffect(() => {
    void countOutbox();
    return onOutboxChange(() => void countOutbox());
  }, [countOutbox]);

  const syncNow = useCallback(async () => {
    if (!session || !navigator.onLine) return;
    // La session est revérifiée en ligne avant d'écrire (elle fixe l'entreprise côté serveur).
    const s = await store.session().catch(() => null);
    if (!s) return;
    if (offline) setSessionState(s);
    if (!(await pending(s.org.id)).length) {
      if (offline) await refresh().catch(() => undefined);
      return;
    }
    const res = await syncOutbox(store, s.org.id, billing);
    await refresh().catch(() => undefined);
    if (res.sent) toast(`${res.sent} état(s) des lieux envoyé(s)`);
    else if (res.error && !isNetworkError(new Error(res.error))) toast(`Envoi impossible : ${res.error}`);
  }, [session, store, offline, refresh, billing]);

  useEffect(() => {
    const goOnline = () => void syncNow();
    const goOffline = () => setOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const t = setInterval(() => {
      if (navigator.onLine && outboxCount > 0) void syncNow();
    }, 30_000);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(t);
    };
  }, [syncNow, outboxCount]);

  useEffect(() => {
    if (session) void refresh().catch(() => undefined);
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
    <DataCtx.Provider value={{ store, session, data, loading, now, refresh, setSession, can, toast, offline, outboxCount, syncNow }}>
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
