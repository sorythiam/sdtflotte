import { categoryPhotos } from '../domain/photos';
import { defaultDailyDigest } from '../domain/alerts';
import type { Invitation, Member, Organization, Role, SubscriptionRequest, TableName, Tables } from '../domain/types';
import { seed, seedExpenses, seedDrivers, seedIncidents, seedInvoices, seedPackages } from './seed';
import { invoicePrefix, nextInvoiceNumber, type Invoice } from '../domain/billing';
import type { NewRow, OrgPatch, Row, SessionInfo, Store } from './store';
import {
  availableByCategory, SLUG_RE, validateBookingRequest,
  type BookingRequest, type BookingRequestInput, type BookingStatus, type PublicBookingInfo,
} from '../domain/booking';

const KEY = 'yoonfleet-demo-v1';

type Db = { [K in keyof Tables]: Tables[K][] };
interface DemoState {
  db: Db;
  session: { email: string; role: Role; dailyDigest?: boolean } | null;
  org: Organization;
  members?: Member[];
  invitations?: Invitation[];
  subscriptionRequests?: SubscriptionRequest[];
  bookingRequests?: BookingRequest[];
}

const SELF = 'u-moi';

function demoTeam(): Member[] {
  return [
    { userId: 'u-agent', email: 'awa.agent@sdt.sn', role: 'agent' },
    { userId: 'u-compta', email: 'moussa.compta@sdt.sn', role: 'comptable' },
    { userId: 'u-meca', email: 'ibou.garage@sdt.sn', role: 'mecanicien' },
  ];
}

function demoBookingRequests(now = new Date()): BookingRequest[] {
  const at = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  return [
    {
      id: 'br-1', category: '4x4', start: at(3, 9), end: at(6, 18), withDriver: true, name: 'Khadija Sow', phone: '+221 77 455 12 30',
      companyName: 'Cabinet Sow & Associés', companyTaxId: null,
      email: 'khadija.sow@example.com', message: 'Mission à Saint-Louis pour 3 personnes, départ de l’hôtel Terrou-Bi.', status: 'nouvelle',
      reservationId: null, declineReason: null, createdAt: at(0, 8),
    },
    {
      id: 'br-2', category: 'Citadine', start: at(1, 10), end: at(2, 10), withDriver: false, name: 'Ousmane Fall', phone: '76 220 33 44',
      email: null, message: null, status: 'nouvelle', reservationId: null, declineReason: null, createdAt: at(-1, 19),
    },
  ];
}

function freshState(): DemoState {
  const trial = new Date();
  trial.setDate(trial.getDate() + 30);
  return {
    db: seed(),
    session: null,
    members: demoTeam(),
    invitations: [],
    bookingRequests: demoBookingRequests(),
    org: {
      id: 'org-demo',
      name: 'Sénégal Découverte Touristique',
      country: 'SN',
      currency: 'FCFA',
      plan: 'pro',
      vehicleQuota: 40,
      trialEndsAt: trial.toISOString(),
      bookingSlug: 'sdt-demo',
      bookingEnabled: true,
      contract: {
        legalName: 'Sénégal Découverte Touristique SARL',
        address: 'Route de Ngor, Almadies',
        city: 'Dakar',
        phone: '+221 33 820 00 00',
        email: 'location@sdt.sn',
        registration: 'RCCM SN-DKR-2015-B-0000 · NINEA 000000000',
      },
    },
  };
}

function uid(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

/** Données dans le navigateur. Rien ne quitte l'appareil ; « Réinitialiser » recharge l'exemple. */
export class DemoStore implements Store {
  readonly mode = 'demo' as const;
  private state: DemoState;

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = safeStorage()) {
    this.state = this.load();
  }

  private load(): DemoState {
    try {
      const raw = this.storage?.getItem(KEY);
      if (raw) {
        const st = JSON.parse(raw) as DemoState;
        st.members ??= demoTeam();
        st.invitations ??= [];
        st.bookingRequests ??= demoBookingRequests();
        st.db.expenses ??= seedExpenses();
        st.db.invoices ??= seedInvoices(st.db);
        st.db.inspections ??= [];
        st.db.incidents ??= seedIncidents();
        st.db.drivers ??= seedDrivers();
        st.db.packages ??= seedPackages();
        st.db.reservation_changes ??= [];
        st.org.bookingSlug ??= 'sdt-demo';
        st.org.bookingEnabled ??= true;
        return st;
      }
    } catch {
      /* stockage indisponible ou corrompu : on repart de l'exemple */
    }
    return freshState();
  }

  private save(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* navigation privée : la démo reste en mémoire */
    }
  }

  reset(): void {
    const role = this.state.session;
    this.state = freshState();
    this.state.session = role;
    this.save();
  }

  async session(): Promise<SessionInfo | null> {
    const s = this.state.session;
    return s ? { userId: SELF, userEmail: s.email, role: s.role, org: this.state.org, dailyDigest: s.dailyDigest ?? defaultDailyDigest(s.role) } : null;
  }

  /** En démo, le mot de passe sert à choisir le profil : admin (par défaut), direction, agent, comptable, mecanicien. */
  async signIn(email: string, password: string): Promise<void> {
    const roles: Role[] = ['admin', 'direction', 'agent', 'comptable', 'mecanicien'];
    const role = (roles.find((r) => r === password.trim().toLowerCase()) ?? 'admin') as Role;
    this.state.session = { email: email || 'demo@yoonfleet.com', role };
    this.save();
  }

  async signUp(email: string, _password: string, orgName: string, country: string): Promise<void> {
    if (!orgName) {
      // Démo : rejoindre l'équipe d'exemple avec le profil de l'invitation, agent par défaut.
      const inv = (this.state.invitations ?? []).find((i) => i.email === email.trim().toLowerCase());
      this.state.invitations = (this.state.invitations ?? []).filter((i) => i !== inv);
      this.state.session = { email, role: inv?.role ?? 'agent' };
      this.save();
      return;
    }
    this.state = freshState();
    this.state.org.name = orgName;
    this.state.org.country = country;
    this.state.session = { email, role: 'admin' };
    this.save();
  }

  async signOut(): Promise<void> {
    this.state.session = null;
    this.save();
  }

  async list<T extends TableName>(table: T): Promise<Row<T>[]> {
    return structuredClone(this.state.db[table]) as Row<T>[];
  }

  async insert<T extends TableName>(table: T, row: NewRow<T>): Promise<Row<T>> {
    if (table === 'vehicles') {
      const active = this.state.db.vehicles.filter((v) => !v.outOfService).length;
      if (active >= this.state.org.vehicleQuota) {
        throw new Error(`Quota de ${this.state.org.vehicleQuota} véhicules atteint pour votre formule`);
      }
    }
    if (table === 'invoices') {
      // Numérotation continue, comme le fait la base en production.
      const inv = row as unknown as Omit<Invoice, 'id'>;
      const number = nextInvoiceNumber(this.state.db.invoices.map((i) => i.number), invoicePrefix(inv.kind), Number(inv.issueDate.slice(0, 4)));
      const created = { ...inv, id: uid(), number } as Invoice;
      this.state.db.invoices.push(created);
      this.save();
      return structuredClone(created) as unknown as Row<T>;
    }
    const full = { ...row, id: uid() } as Row<T>;
    (this.state.db[table] as Row<T>[]).push(full);
    this.save();
    return structuredClone(full);
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<NewRow<T>>): Promise<Row<T>> {
    if (table === 'invoices') throw new Error('Une facture émise ne se modifie pas : établissez un avoir.');
    const list = this.state.db[table] as Row<T>[];
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) throw new Error('Élément introuvable');
    list[i] = { ...list[i], ...patch };
    this.save();
    return structuredClone(list[i]);
  }

  async remove(table: TableName, id: string): Promise<void> {
    if (table === 'invoices') throw new Error('Une facture émise ne se supprime pas : établissez un avoir.');
    const list = this.state.db[table] as { id: string }[];
    this.state.db[table] = list.filter((r) => r.id !== id) as never;
    this.save();
  }

  // ---------------------------------------------------------------- équipe
  async listMembers(): Promise<Member[]> {
    const s = this.state.session;
    const me: Member[] = s ? [{ userId: SELF, email: s.email, role: s.role }] : [];
    return [...me, ...(this.state.members ?? [])];
  }

  async listInvitations(): Promise<Invitation[]> {
    return structuredClone(this.state.invitations ?? []);
  }

  async invite(email: string, role: Role): Promise<Invitation> {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Adresse email invalide.');
    if ((await this.listMembers()).some((m) => m.email.toLowerCase() === e)) {
      throw new Error("Cette personne fait déjà partie de l'équipe");
    }
    if ((this.state.invitations ?? []).some((i) => i.email === e)) throw new Error('Une invitation est déjà en attente pour cette adresse.');
    const now = new Date();
    const inv: Invitation = {
      id: uid(), email: e, role, token: uid(), createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 14 * 86400000).toISOString(),
    };
    (this.state.invitations ??= []).push(inv);
    this.save();
    return inv;
  }

  async cancelInvitation(id: string): Promise<void> {
    this.state.invitations = (this.state.invitations ?? []).filter((i) => i.id !== id);
    this.save();
  }

  private assertKeepsAdmin(userId: string, newRole: Role | null): void {
    const all = [{ userId: SELF, role: this.state.session?.role }, ...(this.state.members ?? [])];
    const target = all.find((m) => m.userId === userId);
    if (target?.role === 'admin' && newRole !== 'admin' && !all.some((m) => m.userId !== userId && m.role === 'admin')) {
      throw new Error("L'entreprise doit garder au moins un administrateur");
    }
  }

  async updateMemberRole(userId: string, role: Role): Promise<void> {
    this.assertKeepsAdmin(userId, role);
    if (userId === SELF && this.state.session) this.state.session.role = role;
    else this.state.members = (this.state.members ?? []).map((m) => (m.userId === userId ? { ...m, role } : m));
    this.save();
  }

  async removeMember(userId: string): Promise<void> {
    if (userId === SELF) throw new Error('Vous ne pouvez pas vous retirer vous-même.');
    this.assertKeepsAdmin(userId, null);
    this.state.members = (this.state.members ?? []).filter((m) => m.userId !== userId);
    this.save();
  }

  // ---------------------------------------------------------------- paramètres
  async updateOrganization(patch: OrgPatch): Promise<void> {
    if (patch.booking && !SLUG_RE.test(patch.booking.slug)) {
      throw new Error('Adresse invalide : 3 à 40 caractères, lettres minuscules, chiffres et tirets.');
    }
    const name = patch.name?.trim();
    if (name !== undefined && (name.length < 2 || name.length > 120)) throw new Error('Le nom doit faire entre 2 et 120 caractères.');
    this.state.org = {
      ...this.state.org,
      ...(name ? { name } : {}),
      ...(patch.country ? { country: patch.country } : {}),
      ...(patch.contract ? { contract: patch.contract } : {}),
      ...(patch.billing ? { billing: patch.billing } : {}),
      ...(patch.booking ? { bookingSlug: patch.booking.slug, bookingEnabled: patch.booking.enabled } : {}),
    };
    this.save();
  }

  async changePassword(password: string): Promise<void> {
    if (password.length < 8) throw new Error('8 caractères minimum.');
  }

  // ---------------------------------------------------------------- réservation en ligne
  private publicOrg(slug: string) {
    const o = this.state.org;
    return o.bookingEnabled && o.bookingSlug === slug.toLowerCase() ? o : null;
  }

  async publicBookingInfo(slug: string): Promise<PublicBookingInfo | null> {
    const o = this.publicOrg(slug);
    if (!o) return null;
    const c = o.contract ?? {};
    const vehicles = this.state.db.vehicles.filter((v) => !v.outOfService);
    const categories = [...this.state.db.rates]
      .filter((r) => vehicles.some((v) => v.category === r.category))
      .sort((a, b) => a.daily - b.daily)
      .map((r) => {
        const inCat = vehicles.filter((v) => v.category === r.category);
        return {
          category: r.category, daily: r.daily, weekly: r.weekly, monthly: r.monthly, driverDaily: r.driverDaily,
          kmPerDay: r.kmPerDay, extraKm: r.extraKm, caution: r.caution, vehicles: inCat.length,
          models: [...new Set(inCat.map((v) => `${v.brand} ${v.model}`))].sort().slice(0, 3),
          photos: categoryPhotos(vehicles, r.category),
          seats: inCat.reduce<number | null>((m, v) => (v.seats && (!m || v.seats > m) ? v.seats : m), null),
          luggage: inCat.reduce<number | null>((m, v) => (v.luggage != null && (m === null || v.luggage > m) ? v.luggage : m), null),
          driverRequired: inCat.length > 0 && inCat.every((v) => v.driverRequired),
        };
      });
    return {
      name: c.legalName || o.name, logo: c.logo ?? null, phone: c.phone ?? '', email: c.email ?? '',
      address: c.address ?? '', city: c.city ?? '', categories,
    };
  }

  async publicAvailability(slug: string, start: string, end: string, passengers?: number | null): Promise<Record<string, number>> {
    if (!this.publicOrg(slug) || !(Date.parse(end) > Date.parse(start))) return {};
    return availableByCategory(this.state.db.vehicles, this.state.db.reservations, this.state.db.maintenances, start, end, passengers);
  }

  async submitBookingRequest(slug: string, req: BookingRequestInput): Promise<void> {
    if (!this.publicOrg(slug)) throw new Error('Cette page de réservation n’est pas disponible.');
    const err = validateBookingRequest(req, new Date());
    if (err) throw new Error(err);
    if (!this.state.db.rates.some((r) => r.category === req.category)) throw new Error('Choisissez un type de véhicule.');
    const inCat = this.state.db.vehicles.filter((v) => v.category === req.category && !v.outOfService);
    const mustDrive = inCat.length > 0 && inCat.every((v) => v.driverRequired);
    this.state.bookingRequests = [
      {
        ...req, withDriver: req.withDriver || mustDrive, passengers: req.passengers ?? null, id: uid(), name: req.name.trim(), phone: req.phone.trim(), email: req.email?.trim() || null,
        message: req.message?.trim() || null, companyName: req.companyName?.trim() || null, companyTaxId: req.companyTaxId?.trim() || null, status: 'nouvelle', reservationId: null, declineReason: null, createdAt: new Date().toISOString(),
      },
      ...(this.state.bookingRequests ?? []),
    ];
    this.save();
  }

  async listBookingRequests(): Promise<BookingRequest[]> {
    return structuredClone(this.state.bookingRequests ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateBookingRequest(id: string, patch: { status: BookingStatus; reservationId?: string | null; declineReason?: string | null }): Promise<void> {
    this.state.bookingRequests = (this.state.bookingRequests ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r));
    this.save();
  }

  // En démo, la photo (déjà réduite) est gardée telle quelle dans le navigateur.
  async uploadVehiclePhoto(image: Blob): Promise<string> {
    return new Promise((ok, ko) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => ko(new Error('Photo illisible.'));
      r.readAsDataURL(image);
    });
  }

  async deleteVehiclePhoto(): Promise<void> {}

  async uploadInspectionPhoto(image: Blob): Promise<string> {
    return this.uploadVehiclePhoto(image);
  }

  async inspectionPhotoUrls(paths: string[]): Promise<Record<string, string>> {
    return Object.fromEntries(paths.map((p) => [p, p]));
  }

  async uploadClientDocument(image: Blob): Promise<string> {
    return this.uploadVehiclePhoto(image);
  }

  async clientDocumentUrls(paths: string[]): Promise<Record<string, string>> {
    return Object.fromEntries(paths.map((p) => [p, p]));
  }

  async deleteClientDocument(): Promise<void> {}

  async setDailyDigest(on: boolean): Promise<void> {
    if (!this.state.session) return;
    this.state.session.dailyDigest = on;
    this.save();
  }

  async listSubscriptionRequests(): Promise<SubscriptionRequest[]> {
    return structuredClone(this.state.subscriptionRequests ?? []);
  }

  async requestSubscription(req: Omit<SubscriptionRequest, 'id' | 'status' | 'createdAt'>): Promise<SubscriptionRequest> {
    const full: SubscriptionRequest = { ...req, id: uid(), status: 'nouvelle', createdAt: new Date().toISOString() };
    (this.state.subscriptionRequests ??= []).unshift(full);
    this.save();
    return full;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
