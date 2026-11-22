import { describe, expect, it } from 'vitest';
import type { Expense, VtcContract, VtcPayment } from './types';
import { inVtc, nextVtcNumber, reminderText, vtcBalance, workingDays } from './vtc';

const c = (x: Partial<VtcContract> = {}): VtcContract => ({
  id: 'c', number: 'VTC-2026-0001', vehicleId: 'v', driverId: 'd', formula: 'versement', platform: 'Yango', dailyAmount: 15000,
  restDays: [0], startDate: '2026-11-02', endDate: null, caution: 0, totalPrice: null, charges: {}, status: 'actif', notes: null, createdAt: '', ...x,
});
const pay = (paidOn: string, amount = 15000): VtcPayment => ({ id: paidOn + amount, contractId: 'c', paidOn, amount, method: 'wave', reference: null, note: null, createdBy: null, createdAt: '' });
const now = new Date('2026-11-21T18:00:00Z'); // samedi

describe('VTC', () => {
  it('compte les jours travaillés sans les dimanches', () => {
    expect(workingDays(c(), '2026-11-21')).toBe(18); // 20 jours du lundi 2 au samedi 21, moins 2 dimanches
    expect(workingDays(c({ restDays: [] }), '2026-11-21')).toBe(20);
    expect(workingDays(c({ endDate: '2026-11-07' }), '2026-11-21')).toBe(6);
    expect(workingDays(c(), '2026-11-01')).toBe(0);
  });
  it('calcule le solde, les jours de retard et les charges du chauffeur', () => {
    const pays = ['2026-11-02', '2026-11-03', '2026-11-04'].map((d) => pay(d));
    const amende = { id: 'e', vehicleId: 'v', date: '2026-11-10', kind: 'amende', amount: 10000, label: null, mileage: null, reservationId: null, chargedTo: 'chauffeur', vtcContractId: 'c' } as Expense;
    const b = vtcBalance(c(), pays, [amende], now);
    expect(b).toMatchObject({ expectedDays: 18, expected: 270000, paid: 45000, charges: 10000, balance: 235000, daysBehind: 16, todayDue: 15000, paidToday: 0, lastPaidOn: '2026-11-04' });
  });
  it('rien à verser un jour de repos', () => {
    expect(vtcBalance(c(), [], [], new Date('2026-11-22T10:00:00Z')).todayDue).toBe(0);
  });
  it('location-vente : progression et fin estimée', () => {
    const b = vtcBalance(c({ formula: 'location_vente', totalPrice: 900000 }), [pay('2026-11-05', 270000)], [], now);
    expect(b.progress).toBeCloseTo(0.3);
    expect(b.remainingPrice).toBe(630000);
    expect(b.balance).toBe(0);
    expect(b.estimatedEnd).toBe('2027-01-09'); // 630 000 / (15 000 × 6) = 7 semaines après le 21 novembre
  });
  it('numéros, relance, véhicule confié', () => {
    expect(nextVtcNumber(['VTC-2026-0004', 'VTC-2025-0009'], 2026)).toBe('VTC-2026-0005');
    const b = vtcBalance(c(), [], [], now);
    expect(reminderText('Modou Faye', 'DK-1', b, 'SDT')).toContain('Bonjour Modou');
    expect(inVtc('v', [c()], '2026-11-21')?.id).toBe('c');
    expect(inVtc('v', [c({ status: 'termine' })], '2026-11-21')).toBeUndefined();
  });
});
