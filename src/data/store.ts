import type { Organization, Role, TableName, Tables } from '../domain/types';

export type Row<T extends TableName> = Tables[T];
export type NewRow<T extends TableName> = Omit<Tables[T], 'id'>;

export interface SessionInfo {
  userEmail: string;
  role: Role;
  org: Organization;
}

/** Ce que l'application attend d'une source de données : le mode démo ou Supabase. */
export interface Store {
  readonly mode: 'demo' | 'supabase';
  session(): Promise<SessionInfo | null>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, orgName: string, country: string): Promise<void>;
  signOut(): Promise<void>;
  list<T extends TableName>(table: T): Promise<Row<T>[]>;
  insert<T extends TableName>(table: T, row: NewRow<T>): Promise<Row<T>>;
  update<T extends TableName>(table: T, id: string, patch: Partial<NewRow<T>>): Promise<Row<T>>;
  remove(table: TableName, id: string): Promise<void>;
}

export class StoreError extends Error {}
