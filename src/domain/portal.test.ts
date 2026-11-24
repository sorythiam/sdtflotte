import { describe, expect, it } from 'vitest';
import type { Reservation } from './types';
import { depositState, depositTarget, followMessage, followUps, portalMessage, validateDeclaration, validatePortalForm, type PortalClient } from './portal';

const now = new Date('2026-11-24T10:00:00');
const res = (x: Partial<Reservation>): Reservation => ({
  id: 'r', number: 'CT-2026-0001', vehicleId: 'v', clientId: 'c', start: '2026-11-25T09:00:00', end: '2026-11-28T18:00:00', withDriver: false,
  status: 'reservee', dailyRate: 30000, total: 120000, caution: 200000, fees: 0, mileageOut: null, mileageIn: null, notes: null, createdAt: '2026-11-23T08:00:00', ...x,
});
const client: PortalClient = {
  name: 'Awa Ndiaye', phone: '77 123 45 67', email: null, address: null, city: null, idType: 'cni', idNumber: '1 234 5678',
  idExpiry: '2030-01-01', birthDate: '1990-05-01', licenseNumber: 'SN-1', licenseCategory: 'B', licenseExpiry: '2029-01-01',
};

describe('Espace client', () => {
  it('acompte : facture si elle existe, sinon le pourcentage', () => {
    expect(depositTarget(res({}), [], 30)).toBe(36000);
    expect(depositTarget(res({}), [{ reservationId: 'r', kind: 'facture', depositDue: 50000 }, { reservationId: 'r', kind: 'avoir', depositDue: 0 }], 30)).toBe(50000);
  });
  it('état de l’acompte : reçu, déclaré, attendu, en retard', () => {
    const r = res({});
    expect(depositState(r, 36000, 36000, [], now, 24)).toBe('recu');
    expect(depositState(r, 36000, 0, [{ reservationId: 'r', status: 'declare' }], now, 24)).toBe('declare');
    expect(depositState(r, 36000, 0, [{ reservationId: 'r', status: 'rejete' }], now, 24)).toBe('en_retard'); // réservé il y a 26 h
    expect(depositState(r, 36000, 0, [], now, 48)).toBe('attendu');
    expect(depositState(r, 36000, 0, [], now, 0)).toBe('attendu');
    expect(depositState(res({ status: 'en_cours' }), 36000, 0, [], now, 24)).toBe('aucun');
    expect(depositState(r, 0, 0, [], now, 24)).toBe('aucun');
  });
  it('formulaire du client', () => {
    expect(validatePortalForm(client, 'Awa Ndiaye', 'data:image/png;base64,x', true, now)).toBeNull();
    expect(validatePortalForm({ ...client, idNumber: '' }, 'Awa', 'x', true, now)).toMatch(/pièce/);
    expect(validatePortalForm({ ...client, licenseExpiry: '2026-01-01' }, 'Awa', 'x', true, now)).toMatch(/permis est expiré/);
    expect(validatePortalForm(client, 'Awa', 'x', false, now)).toMatch(/conditions/);
    expect(validatePortalForm(client, 'Awa', null, true, now)).toMatch(/Signez/);
  });
  it('acompte déclaré', () => {
    expect(validateDeclaration(36000, 'T_8F2KQ7WX', 36000)).toBeNull();
    expect(validateDeclaration(0, 'T_8F2KQ7WX', 36000)).toMatch(/montant/);
    expect(validateDeclaration(36000, 'ab', 36000)).toMatch(/référence/);
    expect(validateDeclaration(100000, 'T_8F2KQ7WX', 36000)).toMatch(/trop élevé/);
  });
  it('suivi : retards d’abord, puis retours et départs d’aujourd’hui et demain', () => {
    const list = followUps([
      res({ id: 'a', status: 'reservee', start: '2026-11-25T09:00:00' }),
      res({ id: 'b', status: 'en_cours', end: '2026-11-24T18:00:00' }),
      res({ id: 'c', status: 'en_cours', end: '2026-11-23T18:00:00' }),
      res({ id: 'd', status: 'reservee', start: '2026-11-30T09:00:00' }),
      res({ id: 'e', status: 'en_cours', end: '2026-12-02T18:00:00' }),
    ], now);
    expect(list.map((x) => [x.reservation.id, x.kind, x.when])).toEqual([['c', 'retard', 'passe'], ['b', 'retour', 'aujourdhui'], ['a', 'depart', 'demain']]);
  });
  it('messages WhatsApp', () => {
    const v = { brand: 'Kia', model: 'Picanto', plate: 'DK-1' };
    expect(followMessage('rappel_retour', 'Awa Ndiaye', 'SDT', res({ end: '2026-11-24T18:00:00' }), v, now)).toContain('prévu aujourd’hui à 18:00');
    expect(followMessage('prolongation', 'Awa Ndiaye', 'SDT', res({}), v, now)).toContain('30 000 FCFA par jour');
    expect(followMessage('retard', 'Awa Ndiaye', 'SDT', res({ end: '2026-11-24T06:00:00' }), v, now)).toContain('environ 4 h');
    const m = portalMessage('Awa Ndiaye', 'SDT', res({}), 'https://x/c/abc', 36000);
    expect(m).toContain('Bonjour Awa');
    expect(m).toContain('https://x/c/abc');
    expect(m).toContain('36 000 FCFA');
  });
});
