import { categoryPhotos } from '../domain/photos';
import { defaultDailyDigest } from '../domain/alerts';
import type { AuditEntry, Invitation, Member, Organization, Plan, Role, SubscriptionRequest, TableName, Tables } from '../domain/types';
import { addPeriod, checkoutQuote, SAAS_VAT_RATE, vtcQuote, type BillingItem, type SubscriptionPayment } from '../domain/saas';
import { seed, seedExpenses, seedDrivers, seedIncidents, seedInvoices, seedPackages, seedPlans, seedPortals, seedSeasons, seedVtc, seedAbsences } from './seed';
import { depositTarget, validateDeclaration, validatePortalForm, type DepositMethod, type PortalClient, type PortalInfo } from '../domain/portal';
import { billingSettings as orgBilling, paidOn } from '../domain/billing';
import { normalizeFlight } from '../domain/flight';
import { invoicePrefix, nextInvoiceNumber, type Invoice } from '../domain/billing';
import type { NewRow, OrgPatch, Row, SessionInfo, SignupContact, Store } from './store';
import type { FollowStatus, SignupRow } from '../domain/platform';
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
  subscriptionPayments?: SubscriptionPayment[];
  bookingRequests?: BookingRequest[];
  audit?: AuditEntry[];
  signups?: SignupRow[];
}

/** Démo : quelques inscriptions fictives pour montrer la console de l'équipe Yoon Fleet. */
function seedSignups(now = new Date()): SignupRow[] {
  const ago = (h: number) => new Date(now.getTime() - h * 3600000).toISOString();
  const inDays = (d: number) => new Date(now.getTime() + d * 86400000).toISOString();
  const base = { country: 'SN', plan: 'essai', paidUntil: null, members: 1, lastActivity: null, note: null, nextCall: null, followupAt: null, clients: 0 };
  return [
    { ...base, orgId: 'o-1', name: 'Dakar Auto Location', createdAt: ago(2), trialEndsAt: inDays(30), contactName: 'Ousmane Fall', contactPhone: '77 451 22 10', adminEmail: 'ousmane@dakarauto.sn', signupSource: 'facebook|lancement-dec', vehicles: 0, reservations: 0, status: 'a_appeler' },
    { ...base, orgId: 'o-2', name: 'Teranga Cars', createdAt: ago(30), trialEndsAt: inDays(29), contactName: 'Awa Ndiaye', contactPhone: '78 220 14 55', adminEmail: 'awa@terangacars.sn', signupSource: 'linkedin|agences-tourisme', vehicles: 6, reservations: 0, status: 'rappeler', note: 'Rappeler demain 10h, veut saisir ses véhicules avec nous.', nextCall: now.toISOString().slice(0, 10) },
    { ...base, orgId: 'o-3', name: 'Saly Rent', createdAt: ago(24 * 9), trialEndsAt: inDays(21), contactName: 'Pape Sow', contactPhone: '76 900 33 21', adminEmail: 'pape@salyrent.sn', signupSource: 'facebook|lancement-dec', vehicles: 12, clients: 8, reservations: 5, lastActivity: ago(5), status: 'onboarde', note: 'Formé le 3e jour, très actif.' },
    { ...base, orgId: 'o-4', name: 'Abidjan Mobility', country: 'CI', createdAt: ago(24 * 25), trialEndsAt: inDays(5), contactName: 'Koffi Yao', contactPhone: '07 08 12 34 56', adminEmail: 'koffi@abjmobility.ci', signupSource: null, vehicles: 3, reservations: 0, status: 'injoignable' },
    { ...base, orgId: 'o-5', name: 'Thiès Location', createdAt: ago(24 * 40), trialEndsAt: inDays(-10), paidUntil: inDays(355), plan: 'pro', contactName: 'Mariama Diop', contactPhone: '77 100 20 30', adminEmail: 'mariama@thiesloc.sn', signupSource: 'facebook|lancement-dec', vehicles: 15, clients: 40, reservations: 62, lastActivity: ago(3), status: 'onboarde' },
  ];
}

/** Libellé lisible d'une ligne pour le journal. */
function rowLabel(row: Record<string, unknown> | undefined): string | null {
  if (!row) return null;
  for (const k of ['number', 'plate', 'name', 'label', 'category', 'kind']) if (typeof row[k] === 'string' && row[k]) return String(row[k]);
  return null;
}
const snake = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());

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
      billing: { payees: { wave: '77 820 00 00', orangeMoney: '512 345', freeMoney: '', mtn: '', moov: '', bankName: '', iban: '', chequeOrder: '' } },
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
        st.db.maintenance_plans ??= seedPlans();
        st.db.seasons ??= seedSeasons();
        st.db.quotes ??= [];
        if (!st.db.vtc_contracts) {
          // Anciennes démos : pas de véhicules VTC d'exemple, on part de zéro.
          const ok = st.db.vehicles.some((v) => v.id === 'v-celerio') && st.db.drivers.some((d) => d.id === 'd-4');
          Object.assign(st.db, ok ? seedVtc() : { vtc_contracts: [], vtc_payments: [], vtc_adjustments: [] });
        }
        st.db.vtc_adjustments ??= [];
        if (!st.db.reservation_portals) Object.assign(st.db, seedPortals(st.db.reservations.filter((r) => r.id === 'r-9' && !st.db.payments.some((p) => p.reservationId === 'r-9' && p.kind === 'acompte'))));
        st.db.deposit_declarations ??= [];
        st.db.driver_absences ??= seedAbsences();
        st.db.reservation_groups ??= [];
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

  async signUp(email: string, _password: string, orgName: string, country: string, _contact?: SignupContact): Promise<void> {
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

  private log(table: string, action: AuditEntry['action'], row: Record<string, unknown> | undefined, changes: string | null = null) {
    const entry: AuditEntry = {
      id: uid(), at: new Date().toISOString(), userEmail: this.state.session?.email ?? null, tableName: table,
      rowId: (row?.id as string) ?? null, action, label: rowLabel(row), changes,
    };
    this.state.audit = [entry, ...(this.state.audit ?? [])].slice(0, 500);
  }

  /** Démo : l'adresse tbg@yoonfleet.com ouvre la console de l'équipe Yoon Fleet. */
  async isPlatformStaff(): Promise<boolean> {
    return this.state.session?.email === 'tbg@yoonfleet.com';
  }

  async listSignups(): Promise<SignupRow[]> {
    if (!(await this.isPlatformStaff())) throw new Error('Réservé à l’équipe Yoon Fleet.');
    this.state.signups ??= seedSignups();
    return structuredClone(this.state.signups);
  }

  async setFollowup(orgId: string, status: FollowStatus, note: string | null, nextCall: string | null): Promise<void> {
    if (!(await this.isPlatformStaff())) throw new Error('Réservé à l’équipe Yoon Fleet.');
    this.state.signups ??= seedSignups();
    this.state.signups = this.state.signups.map((r) => (r.orgId === orgId ? { ...r, status, note: note?.trim() || null, nextCall, followupAt: new Date().toISOString() } : r));
    this.save();
  }

  async listAudit(limit = 200): Promise<AuditEntry[]> {
    return structuredClone((this.state.audit ?? []).slice(0, limit));
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
      this.log(table, 'creation', created as unknown as Record<string, unknown>);
      this.save();
      return structuredClone(created) as unknown as Row<T>;
    }
    const full = { ...row, id: uid() } as Row<T>;
    (this.state.db[table] as Row<T>[]).push(full);
    this.log(table, 'creation', full as unknown as Record<string, unknown>);
    this.save();
    return structuredClone(full);
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<NewRow<T>>): Promise<Row<T>> {
    if (table === 'invoices') throw new Error('Une facture émise ne se modifie pas : établissez un avoir.');
    const list = this.state.db[table] as Row<T>[];
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) throw new Error('Élément introuvable');
    const before = list[i] as unknown as Record<string, unknown>;
    const changed = Object.keys(patch).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify((patch as Record<string, unknown>)[k] ?? null));
    list[i] = { ...list[i], ...patch };
    if (changed.length) this.log(table, 'modification', list[i] as unknown as Record<string, unknown>, changed.map(snake).sort().join(', '));
    this.save();
    return structuredClone(list[i]);
  }

  async remove(table: TableName, id: string): Promise<void> {
    if (table === 'invoices') throw new Error('Une facture émise ne se supprime pas : établissez un avoir.');
    const list = this.state.db[table] as { id: string }[];
    this.log(table, 'suppression', list.find((r) => r.id === id) as unknown as Record<string, unknown>);
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

  async requestPasswordReset(): Promise<void> {}

  async hasRecoverySession(): Promise<boolean> {
    return true;
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
    return availableByCategory(this.state.db.vehicles, this.state.db.reservations, this.state.db.maintenances, start, end, passengers, this.state.db.vtc_contracts);
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
        ...req, withDriver: req.withDriver || mustDrive || !!req.transferKind, passengers: req.passengers ?? null, id: uid(), name: req.name.trim(), phone: req.phone.trim(), email: req.email?.trim() || null,
        message: req.message?.trim() || null, companyName: req.companyName?.trim() || null, companyTaxId: req.companyTaxId?.trim() || null,
        transferKind: req.transferKind ?? null, flightNumber: req.transferKind ? normalizeFlight(req.flightNumber ?? '') : null, flightAt: req.transferKind ? req.flightAt ?? null : null, quantity: req.quantity ?? 1, status: 'nouvelle', reservationId: null, declineReason: null, createdAt: new Date().toISOString(),
      },
      ...(this.state.bookingRequests ?? []),
    ];
    this.save();
  }

  // ---------------------------------------------------------------- espace client (démo : même navigateur)
  private portalRow(token: string) {
    const pt = this.state.db.reservation_portals.find((p) => p.token === token);
    const r = pt && this.state.db.reservations.find((x) => x.id === pt.reservationId);
    if (!pt || !r || r.status === 'annulee' || Date.parse(r.end) < Date.now() - 7 * 86400000) return null;
    const c = this.state.db.clients.find((x) => x.id === r.clientId);
    return c ? { pt, r, c } : null;
  }

  async portalInfo(token: string): Promise<PortalInfo | null> {
    const x = this.portalRow(token);
    if (!x) return null;
    const { pt, r, c } = x;
    pt.openedAt ??= new Date().toISOString();
    this.save();
    const o = this.state.org;
    const b = orgBilling(o.name, o.billing);
    const v = this.state.db.vehicles.find((y) => y.id === r.vehicleId);
    return structuredClone({
      org: { name: o.contract?.legalName || o.name, phone: o.contract?.phone ?? '', logo: o.contract?.logo ?? null, terms: o.contract?.terms ?? '', country: o.country, wave: b.payees.wave, orangeMoney: b.payees.orangeMoney },
      reservation: {
        number: r.number, status: r.status, start: r.start, end: r.end, withDriver: r.withDriver, vehicle: v ? `${v.brand} ${v.model}` : '',
        total: r.total, caution: r.caution, depositDue: depositTarget(r, this.state.db.invoices, c.depositPercent ?? b.depositPercent), paid: paidOn(r.id, this.state.db.payments),
        declared: this.state.db.deposit_declarations.filter((d) => d.reservationId === r.id).map(({ amount, method, reference, declaredAt, status }) => ({ amount, method, reference, declaredAt, status })),
      },
      client: {
        kind: c.kind, name: c.name, phone: c.phone, email: c.email, address: c.address ?? null, city: c.city ?? null, idType: c.idType ?? null, idNumber: c.idNumber,
        idExpiry: c.idExpiry ?? null, birthDate: c.birthDate ?? null, licenseNumber: c.licenseNumber ?? null, licenseCategory: c.licenseCategory ?? null, licenseExpiry: c.licenseExpiry,
        docs: { idFront: !!c.documents?.idFront, idBack: !!c.documents?.idBack, license: !!c.documents?.license },
      },
      portal: { submittedAt: pt.submittedAt ?? null, signedAt: pt.signedAt ?? null, signerName: pt.signerName ?? null, uploadPrefix: 'demo' },
    });
  }

  async portalSubmit(token: string, client: PortalClient, signerName: string, signature: string): Promise<void> {
    const x = this.portalRow(token);
    if (!x) throw new Error('Lien expiré ou invalide');
    if (x.r.status !== 'reservee') throw new Error('Le véhicule a déjà été remis : voyez l’agence');
    const err = validatePortalForm(client, signerName, signature, true, new Date());
    if (err) throw new Error(err);
    const t = (v: string | null) => (v && v.trim() ? v.trim() : null);
    const c = x.c;
    const before = JSON.stringify([c.idNumber, c.licenseNumber, c.idExpiry, c.licenseExpiry]);
    if (c.kind === 'particulier') Object.assign(c, { name: client.name.trim(), phone: client.phone.trim(), email: t(client.email) ?? c.email });
    Object.assign(c, {
      address: t(client.address) ?? c.address ?? null, city: t(client.city) ?? c.city ?? null, idType: client.idType ?? c.idType ?? null,
      idNumber: t(client.idNumber) ?? c.idNumber, idExpiry: t(client.idExpiry) ?? c.idExpiry ?? null, birthDate: t(client.birthDate) ?? c.birthDate ?? null,
      licenseNumber: t(client.licenseNumber) ?? c.licenseNumber ?? null, licenseCategory: t(client.licenseCategory) ?? c.licenseCategory ?? null, licenseExpiry: t(client.licenseExpiry) ?? c.licenseExpiry,
    });
    if (c.verifiedAt && before !== JSON.stringify([c.idNumber, c.licenseNumber, c.idExpiry, c.licenseExpiry])) Object.assign(c, { verifiedAt: null, verifiedBy: null });
    Object.assign(x.pt, { submittedAt: new Date().toISOString(), signerName: signerName.trim(), signature, signedAt: new Date().toISOString() });
    this.save();
  }

  async portalUpload(token: string, _info: PortalInfo, slot: 'idFront' | 'idBack' | 'license', image: Blob): Promise<void> {
    const x = this.portalRow(token);
    if (!x || x.r.status !== 'reservee') throw new Error('Lien expiré ou invalide');
    const url = await this.uploadVehiclePhoto(image);
    x.c.documents = { ...(x.c.documents ?? {}), [slot]: url };
    Object.assign(x.c, { verifiedAt: null, verifiedBy: null });
    this.save();
  }

  async portalDeclare(token: string, method: DepositMethod, reference: string, amount: number): Promise<void> {
    const x = this.portalRow(token);
    if (!x || (x.r.status !== 'reservee' && x.r.status !== 'en_cours')) throw new Error('Lien expiré ou invalide');
    const err = validateDeclaration(amount, reference, x.r.total);
    if (err) throw new Error(err);
    const mine = this.state.db.deposit_declarations.filter((d) => d.reservationId === x.r.id);
    if (mine.filter((d) => d.status === 'declare').length >= 3) throw new Error('Déjà trois paiements en attente de vérification : contactez l’agence');
    if (mine.some((d) => d.reference.toLowerCase() === reference.trim().toLowerCase())) throw new Error('Cette référence a déjà été déclarée');
    this.state.db.deposit_declarations.push({ id: uid(), reservationId: x.r.id, amount, method, reference: reference.trim(), declaredAt: new Date().toISOString(), status: 'declare' });
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

  // ---------------------------------------------------------------- abonnement (simulé)
  private lastPaid(): SubscriptionPayment | null {
    return (this.state.subscriptionPayments ?? []).find((p) => p.status === 'payee' && (p.item ?? 'abonnement') === 'abonnement') ?? null;
  }

  async startCheckout(input: { plan: Plan; vehicles: number; billing: 'annuel' | 'mensuel'; item?: BillingItem }): Promise<{ paymentId: string; url: string }> {
    if (this.state.session?.role !== 'admin') throw new Error('Seul l’administrateur peut payer l’abonnement.');
    const item = input.item ?? 'abonnement';
    const q = item === 'vtc'
      ? vtcQuote(input.billing, this.state.org.vtcUntil, new Date(), SAAS_VAT_RATE)
      : checkoutQuote(input, { paidUntil: this.state.org.paidUntil ?? null, last: this.lastPaid() }, new Date(), SAAS_VAT_RATE);
    if (q.error) throw new Error(q.error);
    const p: SubscriptionPayment = {
      id: uid(), item, plan: item === 'vtc' ? this.state.org.plan : q.plan, vehicles: q.vehicles, billing: q.billing, baseHt: q.baseHt, creditHt: q.creditHt, amountHt: q.amountHt,
      vatRate: q.vatRate, vat: q.vat, amountTtc: q.amountTtc, provider: 'simulation', status: 'en_attente', periodStart: null, periodEnd: null,
      invoiceNumber: null, paidAt: null, createdBy: this.state.session?.email ?? null, createdAt: new Date().toISOString(),
    };
    (this.state.subscriptionPayments ??= []).unshift(p);
    this.save();
    return { paymentId: p.id, url: `/abonnement/paiement-test?paiement=${p.id}` };
  }

  async simulatePayment(paymentId: string, paid: boolean): Promise<void> {
    const list = this.state.subscriptionPayments ?? [];
    const p = list.find((x) => x.id === paymentId);
    if (!p || p.status !== 'en_attente') return;
    if (!paid) {
      p.status = 'annulee';
      this.save();
      return;
    }
    const now = new Date();
    const year = now.getFullYear();
    const n = list.filter((x) => x.invoiceNumber?.startsWith(`YF-${year}-`)).length + 1;
    const vtcUntil = this.state.org.vtcUntil;
    const start = p.item === 'vtc' && vtcUntil && Date.parse(vtcUntil) > now.getTime() ? vtcUntil : now.toISOString();
    const end = addPeriod(start, p.billing);
    Object.assign(p, { status: 'payee', paidAt: now.toISOString(), periodStart: start, periodEnd: end, invoiceNumber: `YF-${year}-${String(n).padStart(4, '0')}` });
    if (p.item === 'vtc') this.state.org.vtcUntil = end;
    else Object.assign(this.state.org, { plan: p.plan, vehicleQuota: p.vehicles, paidUntil: end, billingCycle: p.billing, trialEndsAt: null });
    this.save();
  }

  async confirmPayment(paymentId: string): Promise<SubscriptionPayment> {
    const p = (this.state.subscriptionPayments ?? []).find((x) => x.id === paymentId);
    if (!p) throw new Error('Paiement introuvable.');
    return structuredClone(p);
  }

  async vtcHandOver(paymentIds: string[]): Promise<number> {
    const role = this.state.session?.role;
    if (role !== 'admin' && role !== 'direction') throw new Error('Seule la direction confirme la remise des espèces.');
    const at = new Date().toISOString();
    let n = 0;
    for (const p of this.state.db.vtc_payments) {
      if (paymentIds.includes(p.id) && !p.handedAt) {
        p.handedAt = at;
        p.handedBy = this.state.session?.email ?? null;
        n++;
      }
    }
    this.save();
    return n;
  }

  async listSubscriptionPayments(): Promise<SubscriptionPayment[]> {
    return structuredClone(this.state.subscriptionPayments ?? []);
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
