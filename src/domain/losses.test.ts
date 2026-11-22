import { describe, expect, it } from 'vitest';
import { byCategory, computeLosses } from './reports';
import type { Reservation, Vehicle } from './types';

const p = { from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' };
const v = (id: string, category: string, extra: Partial<Vehicle> = {}): Vehicle => ({
  id, plate: id, brand: 'B', model: 'M', year: 2020, category, fuel: 'diesel', mileage: 0, outOfService: false,
  insuranceExpiry: null, inspectionExpiry: null, vignetteExpiry: null, ...extra,
});
const r = (id: string, x: Partial<Reservation>): Reservation => ({
  id, number: id, vehicleId: 'a', clientId: 'c', start: '2026-11-10T08:00:00Z', end: '2026-11-12T08:00:00Z', withDriver: false,
  status: 'terminee', dailyRate: 30000, total: 60000, caution: 0, fees: 0, mileageOut: null, mileageIn: null, notes: null, createdAt: '', ...x,
});

describe('pertes', () => {
  it('chiffre immobilisation, retards non facturés, impayés et annulations', () => {
    const l = computeLosses({
      vehicles: [v('a', 'Berline')],
      rates: [{ category: 'Berline', daily: 35000 }],
      maintenances: [{ id: 'm', vehicleId: 'a', label: 'Vidange', start: '2026-11-20T08:00:00Z', end: '2026-11-22T08:00:00Z', cost: 1 }],
      reservations: [r('1', {}), r('2', { fees: 5000 }), r('3', { status: 'annulee', total: 90000 })],
      inspections: [
        { reservationId: '1', kind: 'retour', doneAt: '2026-11-13T12:00:00Z', items: [{ zone: 'avant', status: 'dommage' }] },
        { reservationId: '1', kind: 'depart', doneAt: '2026-11-10T08:00:00Z', items: [{ zone: 'avant', status: 'ok' }] },
        { reservationId: '2', kind: 'retour', doneAt: '2026-11-12T20:00:00Z', items: [] },
      ],
      remaining: (x) => (x.id === '1' ? 20000 : 0),
    }, p);
    expect(l).toMatchObject({ downtimeDays: 2, downtimeValue: 70000, lateDays: 3, lateUnbilled: 60000, damagesUnbilled: 1, unpaid: 20000, cancelled: 90000 });
    expect(l.total).toBe(70000 + 60000 + 20000 + 90000);
  });
  it('occupation par catégorie', () => {
    const cats = byCategory({ days: 10, vehicles: [
      { vehicleId: 'a', label: '', plate: '', category: 'Bus', rentedDays: 8, occupancy: 0.8, revenue: 800, maintenance: 0, expenses: 0, margin: 0 },
      { vehicleId: 'b', label: '', plate: '', category: 'Bus', rentedDays: 2, occupancy: 0.2, revenue: 200, maintenance: 0, expenses: 0, margin: 0 },
    ] }, [v('a', 'Bus'), v('b', 'Bus')]);
    expect(cats[0]).toMatchObject({ category: 'Bus', vehicles: 2, occupancy: 0.5, revenuePerVehicle: 500 });
  });
});
