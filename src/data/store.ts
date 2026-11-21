import type { Invitation, Member, Organization, Role, SubscriptionRequest, TableName, Tables } from '../domain/types';

export type Row<T extends TableName> = Tables[T];
export type NewRow<T extends TableName> = Omit<Tables[T], 'id'>;

export interface SessionInfo {
  userId: string;
  userEmail: string;
  role: Role;
  org: Organization;
}

/** Ce que l'application attend d'une source de données : le mode démo ou Supabase. */
export interface Store {
  readonly mode: 'demo' | 'supabase';
  session(): Promise<SessionInfo | null>;
  signIn(email: string, password: string): Promise<void>;
  /** orgName vide : la personne rejoint une entreprise qui l'a invitée. */
  signUp(email: string, password: string, orgName: string, country: string): Promise<void>;
  signOut(): Promise<void>;
  list<T extends TableName>(table: T): Promise<Row<T>[]>;
  insert<T extends TableName>(table: T, row: NewRow<T>): Promise<Row<T>>;
  update<T extends TableName>(table: T, id: string, patch: Partial<NewRow<T>>): Promise<Row<T>>;
  remove(table: TableName, id: string): Promise<void>;
  // Équipe
  listMembers(): Promise<Member[]>;
  listInvitations(): Promise<Invitation[]>;
  invite(email: string, role: Role): Promise<Invitation>;
  cancelInvitation(id: string): Promise<void>;
  updateMemberRole(userId: string, role: Role): Promise<void>;
  removeMember(userId: string): Promise<void>;
  // Paramètres
  updateOrganization(patch: { name?: string; country?: string }): Promise<void>;
  changePassword(password: string): Promise<void>;
  listSubscriptionRequests(): Promise<SubscriptionRequest[]>;
  requestSubscription(req: Omit<SubscriptionRequest, 'id' | 'status' | 'createdAt'>): Promise<SubscriptionRequest>;
}

export class StoreError extends Error {}
