import { defaultDailyDigest } from '../domain/alerts';
import type { Invitation, Member, Organization, Role, SubscriptionRequest, TableName, Tables } from '../domain/types';
import { seed } from './seed';
import type { NewRow, Row, SessionInfo, Store } from './store';

const KEY = 'yoonfleet-demo-v1';

type Db = { [K in keyof Tables]: Tables[K][] };
interface DemoState {
  db: Db;
  session: { email: string; role: Role; dailyDigest?: boolean } | null;
  org: Organization;
  members?: Member[];
  invitations?: Invitation[];
  subscriptionRequests?: SubscriptionRequest[];
}

const SELF = 'u-moi';

function demoTeam(): Member[] {
  return [
    { userId: 'u-agent', email: 'awa.agent@sdt.sn', role: 'agent' },
    { userId: 'u-compta', email: 'moussa.compta@sdt.sn', role: 'comptable' },
    { userId: 'u-meca', email: 'ibou.garage@sdt.sn', role: 'mecanicien' },
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
    org: {
      id: 'org-demo',
      name: 'Sénégal Découverte Touristique',
      country: 'SN',
      currency: 'FCFA',
      plan: 'pro',
      vehicleQuota: 40,
      trialEndsAt: trial.toISOString(),
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
    const full = { ...row, id: uid() } as Row<T>;
    (this.state.db[table] as Row<T>[]).push(full);
    this.save();
    return structuredClone(full);
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<NewRow<T>>): Promise<Row<T>> {
    const list = this.state.db[table] as Row<T>[];
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) throw new Error('Élément introuvable');
    list[i] = { ...list[i], ...patch };
    this.save();
    return structuredClone(list[i]);
  }

  async remove(table: TableName, id: string): Promise<void> {
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
  async updateOrganization(patch: { name?: string; country?: string }): Promise<void> {
    const name = patch.name?.trim();
    if (name !== undefined && (name.length < 2 || name.length > 120)) throw new Error('Le nom doit faire entre 2 et 120 caractères.');
    this.state.org = { ...this.state.org, ...(name ? { name } : {}), ...(patch.country ? { country: patch.country } : {}) };
    this.save();
  }

  async changePassword(password: string): Promise<void> {
    if (password.length < 8) throw new Error('8 caractères minimum.');
  }

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
