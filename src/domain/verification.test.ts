import { describe, expect, it } from 'vitest';
import type { Inspection } from './inspection';
import type { Client, Incident, Reservation } from './types';
import { buildAlerts } from './alerts';
import { departureCheck, historyOf, verificationOf } from './verification';

const now = new Date('2026-11-22T10:00:00Z');
const base: Client = { id: 'c1', kind: 'particulier', name: 'Awa', phone: '771234567', email: null, idNumber: null, licenseExpiry: null, score: 'fiable' };
const full: Client = {
  ...base, idType: 'cni', idNumber: '123', idExpiry: '2030-01-01', licenseNumber: 'P1', licenseExpiry: '2029-01-01', birthDate: '2000-01-01',
  documents: { idFront: 'a.jpg', license: 'b.jpg' },
};

describe('vérification du client', () => {
  it('liste ce qui manque à un dossier vide', () => {
    const v = verificationOf(base, now);
    expect(v.state).toBe('incomplet');
    expect(v.ready).toBe(false);
    expect(v.issues.length).toBe(5);
  });
  it('dossier complet : prêt à valider, puis vérifié', () => {
    expect(verificationOf(full, now)).toMatchObject({ state: 'incomplet', ready: true, issues: [] });
    expect(verificationOf({ ...full, verifiedAt: '2026-11-01T00:00:00Z' }, now).state).toBe('verifie');
  });
  it('un permis expiré après validation remet le dossier à revoir', () => {
    const v = verificationOf({ ...full, licenseExpiry: '2026-11-21', verifiedAt: '2026-01-01T00:00:00Z' }, now);
    expect(v.state).toBe('a_revoir');
    expect(v.issues).toContain('Permis expiré');
  });
  it('applique l’âge minimum', () => {
    const v = verificationOf({ ...full, birthDate: '2006-12-01', verifiedAt: '2026-11-01T00:00:00Z' }, now, 21);
    expect(v.state).toBe('a_revoir');
    expect(verificationOf({ ...full, birthDate: '2005-11-22', verifiedAt: 'x' }, now, 21).state).toBe('verifie');
  });
  it('bloque le départ selon la règle du loueur', () => {
    expect(departureCheck(base, now, false).ok).toBe(true);
    expect(departureCheck(base, now, false).message).toMatch(/non vérifié/);
    expect(departureCheck(base, now, true).ok).toBe(false);
    expect(departureCheck({ ...full, verifiedAt: 'x' }, now, true)).toEqual({ ok: true, message: null });
    expect(departureCheck({ ...full, verifiedAt: 'x', score: 'blacklist' }, now, false).ok).toBe(false);
    expect(departureCheck(base, now, true, 0, true).ok).toBe(true); // avec chauffeur
  });
  it('alerte quand un départ approche avec un dossier non vérifié', () => {
    const res = { id: 'r1', number: 'CT-1', vehicleId: 'v', clientId: 'c1', start: '2026-11-23T08:00:00Z', end: '2026-11-25T08:00:00Z', withDriver: false, status: 'reservee', dailyRate: 1, total: 1, caution: 0, fees: 0, mileageOut: null, mileageIn: null, notes: null, createdAt: '' } as Reservation;
    const a = buildAlerts({ vehicles: [], clients: [base], reservations: [res], payments: [], maintenances: [] }, now, 0).filter((x) => x.kind === 'dossier_client');
    expect(a).toHaveLength(1);
    expect(a[0].link).toBe('/clients/c1');
    expect(buildAlerts({ vehicles: [], clients: [{ ...full, verifiedAt: 'x' }], reservations: [res], payments: [], maintenances: [] }, now, 0).some((x) => x.kind === 'dossier_client')).toBe(false);
  });
});

describe('historique du client', () => {
  const r = (id: string, end: string): Reservation => ({
    id, number: id, vehicleId: 'v', clientId: 'c1', start: '2026-10-01T08:00:00Z', end, withDriver: false, status: 'terminee',
    dailyRate: 1, total: 1, caution: 0, fees: 10000, mileageOut: null, mileageIn: null, notes: null, createdAt: '',
  });
  const ret = (reservationId: string, doneAt: string) => ({ id: 'i' + reservationId, reservationId, kind: 'retour', doneAt }) as Inspection;
  const inc = (severity: 'mineur' | 'grave', kind: Incident['kind'] = 'dommage'): Incident => ({
    id: Math.random().toString(), clientId: 'c1', reservationId: null, kind, severity, occurredOn: '2026-10-05', amount: 0, note: 'x', createdBy: null, createdAt: '',
  });
  it('compte les retards constatés au retour (marge de 2 h) et les frais', () => {
    const h = historyOf('c1', [r('a', '2026-10-03T18:00:00Z'), r('b', '2026-10-03T18:00:00Z')], [ret('a', '2026-10-03T21:30:00Z'), ret('b', '2026-10-03T19:00:00Z')], []);
    expect(h).toMatchObject({ rentals: 2, late: 1, fees: 20000, suggestion: null });
  });
  it('propose un scoring à partir des incidents', () => {
    expect(historyOf('c1', [], [], [inc('grave')]).suggestion?.score).toBe('surveiller');
    expect(historyOf('c1', [], [], [inc('grave'), inc('grave')]).suggestion?.score).toBe('blacklist');
    expect(historyOf('c1', [], [], [inc('grave', 'impaye')]).suggestion?.score).toBe('blacklist');
  });
});
