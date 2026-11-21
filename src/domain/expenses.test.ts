import { describe, expect, it } from 'vitest';
import { expensesIn, summarizeExpenses, validateExpense } from './expenses';
import type { Expense } from './types';

const e = (id: string, p: Partial<Expense>): Expense => ({
  id, vehicleId: 'v1', date: '2026-11-10', kind: 'carburant', amount: 10000, label: null, mileage: null, reservationId: null, ...p,
});

describe('dépenses', () => {
  const list = [
    e('1', {}),
    e('2', { kind: 'pneus', amount: 120000, vehicleId: 'v2', date: '2026-11-30' }),
    e('3', { amount: 15000, date: '2026-12-01' }),
    e('4', { kind: 'amende', amount: 6000, date: '2026-10-31' }),
  ];
  it('filtre sur la période', () => {
    expect(expensesIn(list, new Date(2026, 10, 1).toISOString(), new Date(2026, 11, 1).toISOString()).map((x) => x.id)).toEqual(['1', '2']);
    expect(expensesIn(list, '2026-11-01', '2026-12-01').map((x) => x.id)).toEqual(['1', '2']);
    expect(expensesIn(list, '0000-01-01', '9999-12-31')).toHaveLength(4);
  });
  it('totalise par type et par véhicule', () => {
    const s = summarizeExpenses(list);
    expect(s.total).toBe(151000);
    expect(s.byVehicle).toEqual({ v1: 31000, v2: 120000 });
    expect(s.byKind[0]).toEqual({ kind: 'pneus', label: 'Pneus', amount: 120000, count: 1 });
    expect(s.byKind.find((k) => k.kind === 'carburant')).toMatchObject({ amount: 25000, count: 2 });
  });
  it('valide la saisie', () => {
    const base = { vehicleId: 'v1', date: '2026-11-20', kind: 'carburant' as const, amount: 30000, label: null, mileage: null, reservationId: null };
    expect(validateExpense(base, '2026-11-21')).toBeNull();
    expect(validateExpense({ ...base, date: '2026-11-22' }, '2026-11-21')).toMatch(/futur/);
    expect(validateExpense({ ...base, amount: 0 }, '2026-11-21')).toMatch(/positif/);
    expect(validateExpense({ ...base, amount: 12.5 }, '2026-11-21')).toMatch(/entier/);
    expect(validateExpense({ ...base, vehicleId: '' }, '2026-11-21')).toMatch(/véhicule/);
  });
});
