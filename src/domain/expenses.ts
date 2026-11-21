// Dépenses par véhicule : libellés et totaux.

import type { Expense, ExpenseKind } from './types';

export const EXPENSE_KINDS: [ExpenseKind, string][] = [
  ['carburant', 'Carburant'],
  ['reparation', 'Réparation'],
  ['pieces', 'Pièces'],
  ['pneus', 'Pneus'],
  ['assurance', 'Assurance'],
  ['taxes', 'Vignette et taxes'],
  ['amende', 'Amende'],
  ['peage', 'Péage'],
  ['lavage', 'Lavage'],
  ['autre', 'Autre'],
];
export const expenseLabel = Object.fromEntries(EXPENSE_KINDS) as Record<ExpenseKind, string>;

const pad = (n: number) => String(n).padStart(2, '0');
/** Date locale AAAA-MM-JJ d'un instant ISO (une date seule est renvoyée telle quelle). */
function localDate(iso: string): string {
  if (iso.length === 10) return iso;
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Dépenses dont la date (jour local) tombe dans la période [from, to[. */
export function expensesIn(expenses: Expense[], from: string, to: string): Expense[] {
  const first = localDate(from);
  let last: string;
  if (to.length === 10) {
    const d = new Date(to + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    last = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } else {
    last = localDate(new Date(Date.parse(to) - 1).toISOString());
  }
  return expenses.filter((e) => e.date >= first && e.date <= last);
}

export interface ExpenseSummary {
  total: number;
  byKind: { kind: ExpenseKind; label: string; amount: number; count: number }[];
  byVehicle: Record<string, number>;
}

export function summarizeExpenses(expenses: Expense[]): ExpenseSummary {
  const kinds = new Map<ExpenseKind, { amount: number; count: number }>();
  const byVehicle: Record<string, number> = {};
  let total = 0;
  for (const e of expenses) {
    total += e.amount;
    byVehicle[e.vehicleId] = (byVehicle[e.vehicleId] ?? 0) + e.amount;
    const k = kinds.get(e.kind) ?? { amount: 0, count: 0 };
    k.amount += e.amount;
    k.count += 1;
    kinds.set(e.kind, k);
  }
  return {
    total,
    byVehicle,
    byKind: [...kinds.entries()].map(([kind, v]) => ({ kind, label: expenseLabel[kind], ...v })).sort((a, b) => b.amount - a.amount),
  };
}

/** Contrôles de saisie ; renvoie le message d'erreur ou null. */
export function validateExpense(e: Omit<Expense, 'id'>, today: string): string | null {
  if (!e.vehicleId) return 'Choisissez un véhicule.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return 'Indiquez la date.';
  if (e.date > today) return 'La date ne peut pas être dans le futur.';
  if (!Number.isInteger(e.amount) || e.amount <= 0) return 'Le montant doit être un nombre entier positif.';
  if (e.amount > 100_000_000) return 'Montant trop élevé.';
  if (e.mileage != null && (!Number.isInteger(e.mileage) || e.mileage < 0)) return 'Kilométrage invalide.';
  if ((e.label ?? '').length > 200) return 'Libellé trop long (200 caractères maximum).';
  return null;
}
