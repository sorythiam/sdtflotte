import type { Organization, Role, TableName, Tables } from '../domain/types';
import { seed } from './seed';
import type { NewRow, Row, SessionInfo, Store } from './store';

const KEY = 'yoonfleet-demo-v1';

type Db = { [K in keyof Tables]: Tables[K][] };
interface DemoState {
  db: Db;
  session: { email: string; role: Role } | null;
  org: Organization;
}

function freshState(): DemoState {
  const trial = new Date();
  trial.setDate(trial.getDate() + 30);
  return {
    db: seed(),
    session: null,
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
      if (raw) return JSON.parse(raw) as DemoState;
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
    return s ? { userEmail: s.email, role: s.role, org: this.state.org } : null;
  }

  /** En démo, le mot de passe sert à choisir le profil : direction, agent, comptable, mecanicien. */
  async signIn(email: string, password: string): Promise<void> {
    const roles: Role[] = ['admin', 'direction', 'agent', 'comptable', 'mecanicien'];
    const role = (roles.find((r) => r === password.trim().toLowerCase()) ?? 'direction') as Role;
    this.state.session = { email: email || 'demo@yoonfleet.com', role };
    this.save();
  }

  async signUp(email: string, _password: string, orgName: string, country: string): Promise<void> {
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
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
