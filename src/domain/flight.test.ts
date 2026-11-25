import { describe, expect, it } from 'vitest';
import { flightLabel, flightWarning, isFlightNumber, normalizeFlight, suggestedPickup, validateFlight } from './flight';
import { followMessage } from './portal';

describe('transferts aéroport', () => {
  it('normalise et reconnaît les numéros de vol', () => {
    expect(normalizeFlight(' af 718 ')).toBe('AF718');
    expect(['AF718', 'SN205', 'HC404', 'ET908', 'RAM201', 'U23411'].map(isFlightNumber)).toEqual([true, true, true, true, true, true]);
    expect(['AF', 'AF12345', '718', '1234'].map(isFlightNumber)).toEqual([false, false, false, false]);
  });
  it('propose la prise en charge : à l’atterrissage, ou 3 h avant le décollage', () => {
    expect(suggestedPickup('arrivee', '2026-11-26T14:30:00Z')).toBe('2026-11-26T14:30:00.000Z');
    expect(suggestedPickup('depart', '2026-11-26T23:55:00Z')).toBe('2026-11-26T20:55:00.000Z');
  });
  it('contrôle le vol saisi', () => {
    const start = '2026-11-26T14:30:00Z';
    expect(validateFlight({}, start)).toBeNull();
    expect(validateFlight({ transferKind: 'arrivee', flightNumber: 'af718', flightAt: start }, start)).toBeNull();
    expect(validateFlight({ transferKind: 'arrivee', flightNumber: 'X', flightAt: start }, start)).toMatch(/numéro de vol/);
    expect(validateFlight({ transferKind: 'arrivee', flightNumber: 'AF718', flightAt: null }, start)).toMatch(/arrivée du vol/);
    expect(validateFlight({ transferKind: 'arrivee', flightNumber: 'AF718', flightAt: '2026-11-28T14:30:00Z' }, start)).toMatch(/24 h/);
    expect(validateFlight({ transferKind: 'depart', flightNumber: 'AF718', flightAt: '2026-11-26T12:00:00Z' }, start)).toMatch(/avant le décollage/);
  });
  it('prévient quand c’est juste', () => {
    expect(flightWarning({ transferKind: 'depart', flightAt: '2026-11-26T16:00:00Z' }, '2026-11-26T14:30:00Z')).toMatch(/2 h 30/);
    expect(flightWarning({ transferKind: 'arrivee', flightAt: '2026-11-26T14:00:00Z' }, '2026-11-26T14:30:00Z')).toBeNull();
    expect(flightWarning({ transferKind: 'arrivee', flightAt: '2026-11-26T15:00:00Z' }, '2026-11-26T14:00:00Z')).toMatch(/attendre/);
  });
  it('libellé et message de rappel', () => {
    const r = { number: 'CT-1', start: '2026-11-26T14:30:00', end: '2026-11-26T17:00:00', dailyRate: 30000, transferKind: 'arrivee' as const, flightNumber: 'AF718', flightAt: '2026-11-26T14:30:00' };
    expect(flightLabel(r)).toBe('Vol AF718, arrivée prévue le 26/11 à 14:30');
    const m = followMessage('rappel_depart', 'Awa Ndiaye', 'SDT', r, undefined, new Date('2026-11-25T10:00:00'));
    expect(m).toContain('à l’arrivée de votre vol AF718, prévue à 14:30');
    expect(m).toContain('demain');
  });
});
