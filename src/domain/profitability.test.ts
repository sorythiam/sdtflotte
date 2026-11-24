import { describe, expect, it } from 'vitest';
import { byModel, computeProfitability, verdictFor } from './profitability';
import type { Expense, Reservation, Vehicle, VtcContract, VtcPayment } from './types';

const now = new Date('2026-07-01T00:00:00Z');
const period = { from: '2026-01-01T00:00:00Z', to: '2026-07-01T00:00:00Z' };
const veh = (id: string, extra: Partial<Vehicle> = {}): Vehicle => ({ id, plate: id, brand: 'Toyota', model: 'Hilux', category: '4x4', year: 2023, fuel: 'diesel', mileage: 50000, outOfService: false, insuranceExpiry: null, inspectionExpiry: null, vignetteExpiry: null, ...extra });
const res = (vehicleId: string, start: string, end: string, total: number): Reservation => ({ id: start + vehicleId, number: 'CT', vehicleId, clientId: 'c', start, end, withDriver: false, status: 'terminee', dailyRate: 0, total, caution: 0, fees: 0, mileageOut: null, mileageIn: null, notes: null, createdAt: start });

describe('rentabilité par véhicule', () => {
  it('additionne locations et versements VTC, retire les coûts du propriétaire seulement', () => {
    const vtc: VtcContract = { id: 'k', number: 'VTC', vehicleId: 'b', driverId: 'd', formula: 'versement', platform: null, dailyAmount: 15000, restDays: [0], startDate: '2026-03-01', endDate: null, caution: 0, totalPrice: null, charges: {}, status: 'actif', notes: null, createdAt: '' };
    const pays: VtcPayment[] = [{ id: 'p', contractId: 'k', paidOn: '2026-03-10', amount: 900000, method: 'wave', reference: null, note: null, createdBy: null, createdAt: '' }];
    const exp = (vehicleId: string, amount: number, chargedTo?: 'chauffeur'): Expense => ({ id: vehicleId + amount, vehicleId, date: '2026-04-01', kind: 'pneus', amount, label: null, mileage: null, reservationId: null, chargedTo });
    const lines = computeProfitability({
      vehicles: [veh('a'), veh('b', { brand: 'Suzuki', model: 'Celerio', category: 'Citadine' })],
      reservations: [res('a', '2026-02-01T00:00:00Z', '2026-05-01T00:00:00Z', 4000000)],
      maintenances: [{ id: 'm', vehicleId: 'a', label: 'Vidange', start: '2026-05-10T08:00:00Z', end: '2026-05-12T08:00:00Z', cost: 200000 }],
      expenses: [exp('a', 100000), exp('b', 50000, 'chauffeur')],
      vtc_contracts: [vtc],
      vtc_payments: pays,
    }, period, now);
    const a = lines.find((l) => l.vehicleId === 'a')!;
    expect(a.revenue).toBe(4000000);
    expect(a.costs).toBe(300000);
    expect(a.margin).toBe(3700000);
    expect(a.downtimeDays).toBe(2);
    expect(a.occupancy).toBeCloseTo(89 / (181 - 2), 2);
    const b = lines.find((l) => l.vehicleId === 'b')!;
    expect(b.vtcRevenue).toBe(900000);
    expect(b.expenses).toBe(0);
    expect(b.occupancy).toBeCloseTo(122 / 181, 2);
    expect(byModel(lines)[0].label).toContain('Hilux');
  });
  it('donne un avis lisible', () => {
    const base = { daysInFleet: 180, revenue: 1000000, costs: 200000, margin: 800000, marginRate: 0.8, occupancy: 0.7, mileage: 40000, year: 2024 };
    expect(verdictFor(base, now)).toBe('star');
    expect(verdictFor({ ...base, margin: -10, marginRate: -0.01 }, now)).toBe('perte');
    expect(verdictFor({ ...base, occupancy: 0.2 }, now)).toBe('sous_utilise');
    expect(verdictFor({ ...base, mileage: 260000, costs: 600000, margin: 400000, marginRate: 0.4 }, now)).toBe('fin_de_vie');
    expect(verdictFor({ ...base, daysInFleet: 10 }, now)).toBe('nouveau');
    expect(verdictFor({ ...base, marginRate: 0.4 }, now)).toBe('rentable');
  });
  it('un véhicule arrivé en cours de période n’est compté que depuis son arrivée', () => {
    const [l] = computeProfitability({ vehicles: [veh('n', { createdAt: '2026-06-11T00:00:00Z' })], reservations: [], maintenances: [], expenses: [], vtc_contracts: [], vtc_payments: [] }, period, now);
    expect(l.daysInFleet).toBe(20);
    expect(l.verdict).toBe('nouveau');
  });
});
