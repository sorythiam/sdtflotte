import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Invitation, Member, Organization, Role, TableName } from '../domain/types';
import type { NewRow, Row, SessionInfo, Store } from './store';

// Colonnes dont le nom diffère entre l'application (camelCase) et la base (snake_case).
const toSnake = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function rowToApp<T>(r: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'org_id' || k === 'provider_ref') continue;
    out[toCamel(k)] = v;
  }
  return out as T;
}

function appToRow(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'id') continue;
    out[toSnake(k)] = v;
  }
  return out;
}

/** Messages d'erreur Postgres traduits pour l'utilisateur. */
function friendly(e: { message?: string; code?: string } | null): Error {
  const msg = e?.message ?? 'Erreur inconnue';
  if (msg.includes('reservations_no_overlap')) {
    return new Error('Ce véhicule est déjà réservé sur cette période.');
  }
  if (e?.code === '23505') return new Error('Cet élément existe déjà (doublon).');
  if (msg.includes('row-level security')) return new Error("Votre profil n'a pas le droit de faire cette action.");
  return new Error(msg);
}

export class SupabaseStore implements Store {
  readonly mode = 'supabase' as const;
  private sb: SupabaseClient;
  private orgId: string | null = null;
  private creatingOrg = false;

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey);
  }

  async session(): Promise<SessionInfo | null> {
    const { data } = await this.sb.auth.getUser();
    const user = data.user;
    if (!user) return null;
    const { data: m, error } = await this.sb
      .from('memberships')
      .select('role, organizations(*)')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();
    if (error) throw friendly(error);
    if (!m) {
      // Première connexion : on rejoint d'abord l'entreprise qui a invité cette adresse,
      // sinon on crée l'entreprise demandée à l'inscription.
      if (this.creatingOrg) return null;
      this.creatingOrg = true;
      try {
        const { data: joined, error: e1 } = await this.sb.rpc('accept_invitations');
        if (e1) throw friendly(e1);
        if (!joined) {
          const meta = user.user_metadata as { org_name?: string; country?: string };
          if (!meta?.org_name) return null;
          const { error: e2 } = await this.sb.rpc('create_organization', { p_name: meta.org_name, p_country: meta.country ?? 'SN' });
          if (e2) throw friendly(e2);
        }
      } finally {
        this.creatingOrg = false;
      }
      return this.session();
    }
    const o = (m as unknown as { organizations: Record<string, unknown> }).organizations;
    this.orgId = o.id as string;
    const org: Organization = {
      id: o.id as string,
      name: o.name as string,
      country: o.country as string,
      currency: (o.currency as string) === 'XOF' ? 'FCFA' : (o.currency as string),
      plan: o.plan as Organization['plan'],
      vehicleQuota: o.vehicle_quota as number,
      trialEndsAt: (o.trial_ends_at as string) ?? null,
    };
    return { userId: user.id, userEmail: user.email ?? '', role: (m as { role: Role }).role, org };
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Email ou mot de passe incorrect.');
  }

  async signUp(email: string, password: string, orgName: string, country: string): Promise<void> {
    const { data, error } = await this.sb.auth.signUp({
      email,
      password,
      options: { data: orgName ? { org_name: orgName, country } : {}, emailRedirectTo: window.location.origin },
    });
    if (error) throw friendly(error);
    if (!data.session) {
      throw new Error('Compte créé. Ouvrez le lien reçu par email, puis connectez-vous : votre espace sera prêt.');
    }
    // Sans confirmation par email, session() crée l'entreprise à partir des métadonnées.
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut();
    this.orgId = null;
  }

  async list<T extends TableName>(table: T): Promise<Row<T>[]> {
    const { data, error } = await this.sb.from(table).select('*');
    if (error) throw friendly(error);
    return (data ?? []).map((r) => rowToApp<Row<T>>(r));
  }

  async insert<T extends TableName>(table: T, row: NewRow<T>): Promise<Row<T>> {
    if (!this.orgId) throw new Error('Session expirée, reconnectez-vous.');
    const payload = { ...appToRow(row as Record<string, unknown>), org_id: this.orgId };
    const { data, error } = await this.sb.from(table).insert(payload).select('*').single();
    if (error) throw friendly(error);
    return rowToApp<Row<T>>(data);
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<NewRow<T>>): Promise<Row<T>> {
    const { data, error } = await this.sb
      .from(table)
      .update(appToRow(patch as Record<string, unknown>))
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw friendly(error);
    return rowToApp<Row<T>>(data);
  }

  async remove(table: TableName, id: string): Promise<void> {
    const { error } = await this.sb.from(table).delete().eq('id', id);
    if (error) throw friendly(error);
  }

  // ---------------------------------------------------------------- équipe
  async listMembers(): Promise<Member[]> {
    const { data, error } = await this.sb.from('memberships').select('user_id, email, role').eq('org_id', this.orgId);
    if (error) throw friendly(error);
    return (data ?? []).map((r) => ({ userId: r.user_id as string, email: (r.email as string) ?? '', role: r.role as Role }));
  }

  async listInvitations(): Promise<Invitation[]> {
    const { data, error } = await this.sb
      .from('invitations')
      .select('*')
      .eq('org_id', this.orgId)
      .is('accepted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw friendly(error);
    return (data ?? []).map((r) => rowToApp<Invitation>(r));
  }

  async invite(email: string, role: Role): Promise<Invitation> {
    if (!this.orgId) throw new Error('Session expirée, reconnectez-vous.');
    const { data, error } = await this.sb
      .from('invitations')
      .insert({ org_id: this.orgId, email: email.trim().toLowerCase(), role })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') throw new Error('Une invitation est déjà en attente pour cette adresse.');
      throw friendly(error);
    }
    return rowToApp<Invitation>(data);
  }

  async cancelInvitation(id: string): Promise<void> {
    const { error } = await this.sb.from('invitations').delete().eq('id', id);
    if (error) throw friendly(error);
  }

  async updateMemberRole(userId: string, role: Role): Promise<void> {
    const { error } = await this.sb.from('memberships').update({ role }).eq('org_id', this.orgId).eq('user_id', userId);
    if (error) throw friendly(error);
  }

  async removeMember(userId: string): Promise<void> {
    const { error } = await this.sb.from('memberships').delete().eq('org_id', this.orgId).eq('user_id', userId);
    if (error) throw friendly(error);
  }
}
