import { describe, expect, it } from 'vitest';
import type { Expense, VtcAdjustment, VtcContract, VtcPayment } from './types';
import { cashToHandOver, cautionSettlement, inVtc, nextVtcNumber, receiptText, reminderText, vtcBalance, vtcDay, workingDays } from './vtc';

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


const adj = (kind: VtcAdjustment['kind'], day: string, amount = 0): VtcAdjustment => ({ id: kind + day + amount, contractId: 'c', kind, day, amount, note: null, createdBy: null, createdAt: '' });

describe('VTC, lot 1', () => {
  it('un jour non dû ne compte ni dans l’attendu ni dans le retard', () => {
    const b = vtcBalance(c(), [], [], now, [adj('jour_offert', '2026-11-10'), adj('jour_offert', '2026-11-15')]); // le 15 est un dimanche : déjà repos
    expect(b.expectedDays).toBe(17);
    expect(b.daysOff).toBe(1);
    expect(vtcDay(c(), [], [adj('jour_offert', '2026-11-10')], '2026-11-10').state).toBe('non_du');
    expect(vtcBalance(c(), [], [], new Date('2026-11-10T09:00:00Z'), [adj('jour_offert', '2026-11-10')]).todayDue).toBe(0);
  });
  it('pénalité chaque jour dû au-delà de la tolérance', () => {
    // Rien payé : le retard de la veille dépasse 2 jours à partir du 4e jour dû.
    const b = vtcBalance(c({ lateFee: 1000, graceDays: 2, startDate: '2026-11-16' }), [], [], now);
    // Du lundi 16 au samedi 21 : 6 jours dus ; pénalité les jours 4 à 6.
    expect(b.penalties).toBe(3000);
    expect(b.balance).toBe(6 * 15000 + 3000);
    // Payer tout le solde aujourd’hui ne fait pas disparaître la pénalité du jour.
    const settled = vtcBalance(c({ lateFee: 1000, graceDays: 2, startDate: '2026-11-16' }), [pay('2026-11-21', 93000)], [], now);
    expect(settled.balance).toBe(0);
    // À jour chaque jour : aucune pénalité.
    const paid = ['16', '17', '18', '19', '20', '21'].map((d) => pay(`2026-11-${d}`));
    expect(vtcBalance(c({ lateFee: 1000, startDate: '2026-11-16' }), paid, [], now).penalties).toBe(0);
  });
  it('avances, remises et retenue sur caution', () => {
    const b = vtcBalance(c({ caution: 100000, startDate: '2026-11-16' }), [], [], now, [adj('avance', '2026-11-17', 20000), adj('remise', '2026-11-18', 5000)]);
    expect(b.balance).toBe(90000 + 20000 - 5000);
    const s = cautionSettlement(b);
    expect(s).toEqual({ retain: 100000, refund: 0, stillOwed: 5000 });
    const after = vtcBalance(c({ caution: 100000, startDate: '2026-11-16' }), [], [], now, [adj('avance', '2026-11-17', 20000), adj('remise', '2026-11-18', 5000), adj('retenue_caution', '2026-11-21', 100000)]);
    expect(after.balance).toBe(5000);
    expect(after.cautionLeft).toBe(0);
  });
  it('caisse : espèces non remises, par encaisseur', () => {
    const p = (id: string, who: string, method: VtcPayment['method'], handedAt: string | null = null): VtcPayment => ({ ...pay('2026-11-20'), id, collectedBy: who, method, handedAt });
    const g = cashToHandOver([p('1', 'Ibou', 'especes'), p('2', 'Ibou', 'especes'), p('3', 'Awa', 'especes', '2026-11-20'), p('4', 'Awa', 'wave'), p('5', 'Awa', 'especes')]);
    expect(g.map((x) => [x.collector, x.total])).toEqual([['Ibou', 30000], ['Awa', 15000]]);
  });
  it('reçu WhatsApp clair', () => {
    const t = receiptText('Modou Faye', 'DK-1', { amount: 15000, paidOn: '2026-11-20', method: 'wave', reference: 'W1' }, { balance: 0 }, 'SDT', 'Wave');
    expect(t).toContain('confirme avoir reçu 15');
    expect(t).toContain('réf. W1');
    expect(t).toContain('Vous êtes à jour.');
  });
});
