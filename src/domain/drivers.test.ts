import { describe, expect, it } from 'vitest';
import { absenceDuring, driverBlocker, driverDay, licenseCategories, missionSheet, requiredCategory, weekDays, type DriverAbsence } from './drivers';
import { buildAlerts } from './alerts';
import type { Driver, Reservation } from './types';

const drv = (x: Partial<Driver> = {}): Driver => ({ id: 'd1', name: 'Mamadou Sarr', phone: '771112233', licenseNumber: null, licenseCategory: 'B', licenseExpiry: '2030-01-01', active: true, notes: null, createdAt: '', ...x });
const abs = (x: Partial<DriverAbsence> = {}): DriverAbsence => ({ id: 'a', driverId: 'd1', kind: 'conge', startDate: '2026-12-01', endDate: '2026-12-05', note: null, createdAt: '', ...x });
const res = (x: Partial<Reservation> = {}): Reservation => ({
  id: 'r1', number: 'CT-2026-0410', vehicleId: 'v', clientId: 'c', start: '2026-11-26T14:30:00', end: '2026-11-26T17:00:00', withDriver: true, status: 'reservee',
  dailyRate: 30000, total: 30000, caution: 0, fees: 0, mileageOut: null, mileageIn: null, notes: null, createdAt: '', driverId: 'd1', ...x,
});

describe('chauffeurs', () => {
  it('lit les catégories et la catégorie exigée', () => {
    expect(licenseCategories('b, d1 / C')).toEqual(['B', 'D1', 'C']);
    expect(requiredCategory({ seats: 5 }).label).toBe('B');
    expect(requiredCategory({ seats: 15 }).label).toBe('D1 ou D');
    expect(requiredCategory({ seats: 30 }).label).toBe('D');
  });
  it('bloque permis expiré, mauvaise catégorie, absence', () => {
    const s = '2026-12-03T08:00:00', e = '2026-12-03T18:00:00';
    expect(driverBlocker(drv(), { seats: 5 }, '2026-11-26T08:00:00', '2026-11-26T18:00:00')).toBeNull();
    expect(driverBlocker(drv({ licenseExpiry: '2026-11-26' }), { seats: 5 }, '2026-11-26T08:00:00', '2026-11-28T18:00:00')).toMatch(/expire avant la fin|expiré/);
    expect(driverBlocker(drv(), { seats: 15 }, s, e)).toMatch(/permis D1 ou D/);
    expect(driverBlocker(drv({ licenseCategory: 'B, D' }), { seats: 15 }, s, e, [abs()])).toMatch(/absent \(congé\)/);
    expect(driverBlocker(drv({ licenseCategory: null }), { seats: 15 }, s, e)).toBeNull(); // non renseigné : on prévient sans bloquer
    expect(driverBlocker(drv({ active: false }), { seats: 5 }, s, e)).toMatch(/inactif/);
    expect(driverBlocker(drv(), { seats: 5 }, s, e, [], [{ driverId: 'd1', status: 'actif', startDate: '2026-11-01', endDate: null, number: 'VTC-2026-0001' }])).toMatch(/conduit en VTC/);
    expect(absenceDuring('d1', '2026-12-05T22:00:00', '2026-12-06T10:00:00', [abs()])).toBeTruthy();
    expect(absenceDuring('d1', '2026-12-06T08:00:00', '2026-12-06T10:00:00', [abs()])).toBeUndefined();
  });
  it('feuille de mission complète, avec le vol', () => {
    const t = missionSheet(res({ transferKind: 'arrivee', flightNumber: 'AF718', flightAt: '2026-11-26T14:30:00', passengers: 3, itinerary: 'AIBD → Radisson' }),
      { name: 'Teranga Tours', phone: '338000000', contactName: 'Awa', contactPhone: '771234567' }, { brand: 'Toyota', model: 'Prado', plate: 'DK-1' }, { name: 'Mamadou Sarr' }, 'SDT');
    expect(t).toContain('Bonjour Mamadou, voici ta mission CT-2026-0410');
    expect(t).toContain('Vol AF718, arrivée prévue le 26/11 à 14:30');
    expect(t).toContain('flightradar24.com/data/flights/af718');
    expect(t).toContain('Client : Awa (Teranga Tours), 771234567');
    expect(t).toContain('Passagers : 3');
  });
  it('semaine et journée du chauffeur', () => {
    expect(weekDays(new Date(2026, 10, 25))).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
    expect(driverDay('d1', '2026-11-26', [res()], []).kind).toBe('mission');
    expect(driverDay('d1', '2026-12-02', [res()], [abs()]).kind).toBe('absence');
    expect(driverDay('d1', '2026-11-27', [res()], []).kind).toBe('libre');
  });
  it('alerte sur le permis du chauffeur', () => {
    const now = new Date('2026-11-25T10:00:00Z');
    const base = { vehicles: [], clients: [], payments: [], maintenances: [] };
    const soon = buildAlerts({ ...base, reservations: [], drivers: [drv({ licenseExpiry: '2026-12-10' })] }, now);
    expect(soon.find((a) => a.kind === 'permis_chauffeur')?.level).toBe('attention');
    const mission = buildAlerts({ ...base, reservations: [res({ end: '2026-12-15T10:00:00' })], drivers: [drv({ licenseExpiry: '2026-12-10' })] }, now);
    expect(mission.find((a) => a.kind === 'permis_chauffeur')?.level).toBe('urgent');
  });
});
