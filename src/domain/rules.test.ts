import { describe, expect, it } from 'vitest';
import {
  returnFees,
  balanceDue,
  billedDays,
  cautionHeld,
  dailyRateFor,
  expiryAlerts,
  findConflicts,
  isLate,
  nextContractNumber,
  occupancy,
  overlaps,
  quote,
  vehicleStatusAt,
} from './rules';
import type { Maintenance, Payment, Rate, Reservation, Vehicle } from './types';

const rate: Rate = {
  id: 'r1',
  category: 'SUV',
  daily: 45000,
  weekly: 40000,
  monthly: 32000,
  driverDaily: 15000,
  kmPerDay: 250,
  extraKm: 150,
  caution: 300000,
};

function res(p: Partial<Reservation>): Reservation {
  return {
    id: 'x',
    number: 'CT-2026-0001',
    vehicleId: 'v1',
    clientId: 'c1',
    start: '2026-11-17T12:00:00Z',
    end: '2026-11-20T12:00:00Z',
    withDriver: false,
    status: 'reservee',
    dailyRate: 45000,
    total: 135000,
    caution: 300000,
    fees: 0,
    mileageOut: 44210,
    mileageIn: null,
    notes: null,
    createdAt: '2026-11-15T09:00:00Z',
    ...p,
  };
}

const vehicle: Vehicle = {
  id: 'v1',
  plate: 'DK-4521-BC',
  brand: 'Hyundai',
  model: 'Tucson',
  year: 2022,
  category: 'SUV',
  fuel: 'diesel',
  mileage: 44210,
  outOfService: false,
  insuranceExpiry: null,
  inspectionExpiry: null,
  vignetteExpiry: null,
};

describe('overlaps', () => {
  it('détecte un chevauchement', () => {
    expect(overlaps('2026-11-17T12:00Z', '2026-11-20T12:00Z', '2026-11-19T08:00Z', '2026-11-22T08:00Z')).toBe(true);
  });
  it('accepte un départ à l’heure exacte du retour', () => {
    expect(overlaps('2026-11-17T12:00Z', '2026-11-20T12:00Z', '2026-11-20T12:00Z', '2026-11-22T12:00Z')).toBe(false);
  });
});

describe('tarification', () => {
  it('facture toute journée entamée', () => {
    expect(billedDays('2026-11-17T12:00Z', '2026-11-20T12:00Z')).toBe(3);
    expect(billedDays('2026-11-17T12:00Z', '2026-11-20T13:00Z')).toBe(4);
    expect(billedDays('2026-11-17T12:00Z', '2026-11-17T15:00Z')).toBe(1);
    expect(billedDays('2026-11-17T12:00Z', '2026-11-17T12:00Z')).toBe(0);
  });
  it('applique le palier semaine et mois', () => {
    expect(dailyRateFor(rate, 6, false)).toBe(45000);
    expect(dailyRateFor(rate, 7, false)).toBe(40000);
    expect(dailyRateFor(rate, 30, false)).toBe(32000);
    expect(dailyRateFor(rate, 3, true)).toBe(60000);
  });
  it('calcule un devis complet', () => {
    expect(quote(rate, '2026-11-17T12:00Z', '2026-11-20T12:00Z', false)).toEqual({
      days: 3,
      dailyRate: 45000,
      total: 135000,
      caution: 300000,
      kmIncluded: 750,
    });
  });
});

describe('findConflicts', () => {
  const maint: Maintenance[] = [
    { id: 'm1', vehicleId: 'v1', label: 'Vidange', start: '2026-11-21T00:00Z', end: '2026-11-22T00:00Z', cost: 0 },
  ];
  it('bloque une réservation active qui chevauche', () => {
    const c = findConflicts('v1', '2026-11-19T00:00Z', '2026-11-20T00:00Z', [res({ id: 'a' })], []);
    expect(c).toHaveLength(1);
    expect(c[0].kind).toBe('reservation');
  });
  it('ignore les réservations annulées ou terminées, et la réservation modifiée', () => {
    const list = [res({ id: 'a', status: 'annulee' }), res({ id: 'b', status: 'terminee' }), res({ id: 'c' })];
    expect(findConflicts('v1', '2026-11-19T00:00Z', '2026-11-20T00:00Z', list, [], 'c')).toHaveLength(0);
  });
  it('bloque un entretien', () => {
    expect(findConflicts('v1', '2026-11-21T10:00Z', '2026-11-23T00:00Z', [], maint)[0].kind).toBe('maintenance');
  });
  it('ne mélange pas les véhicules', () => {
    expect(findConflicts('v2', '2026-11-19T00:00Z', '2026-11-20T00:00Z', [res({})], maint)).toHaveLength(0);
  });
});

describe('statuts', () => {
  const now = new Date('2026-11-20T09:00:00Z');
  it('marque loué, en entretien, hors service', () => {
    expect(vehicleStatusAt(vehicle, now, [res({ status: 'en_cours' })], [])).toBe('loue');
    expect(vehicleStatusAt(vehicle, now, [], [{ id: 'm', vehicleId: 'v1', label: '', start: '2026-11-20T00:00Z', end: '2026-11-21T00:00Z', cost: 0 }])).toBe('maintenance');
    expect(vehicleStatusAt({ ...vehicle, outOfService: true }, now, [], [])).toBe('hors_service');
    expect(vehicleStatusAt(vehicle, now, [], [])).toBe('disponible');
  });
  it('détecte un retard', () => {
    expect(isLate(res({ status: 'en_cours', end: '2026-11-19T18:00Z' }), now)).toBe(true);
    expect(isLate(res({ status: 'en_cours' }), now)).toBe(false);
  });
  it('calcule le taux d’occupation sans les véhicules hors service', () => {
    expect(occupancy(['loue', 'disponible', 'hors_service', 'loue'])).toBeCloseTo(2 / 3);
    expect(occupancy([])).toBe(0);
  });
});

describe('paiements', () => {
  const pay = (p: Partial<Payment>): Payment => ({
    id: 'p',
    reservationId: 'x',
    kind: 'acompte',
    amount: 0,
    method: 'wave',
    status: 'paye',
    paidAt: null,
    createdAt: '',
    ...p,
  });
  it('calcule le solde dû sans compter la caution ni les paiements en attente', () => {
    const list = [
      pay({ amount: 67500 }),
      pay({ kind: 'caution', amount: 300000 }),
      pay({ kind: 'solde', amount: 67500, status: 'en_attente' }),
    ];
    expect(balanceDue(res({}), list)).toBe(67500);
  });
  it('suit la caution détenue', () => {
    const list = [pay({ kind: 'caution', amount: 300000 }), pay({ kind: 'remboursement_caution', amount: 250000 })];
    expect(cautionHeld('x', list)).toBe(50000);
  });
});

describe('divers', () => {
  it('numérote les contrats par année', () => {
    expect(nextContractNumber(['CT-2026-0009', 'CT-2025-0400', 'CT-2026-0012'], 2026)).toBe('CT-2026-0013');
    expect(nextContractNumber([], 2027)).toBe('CT-2027-0001');
  });
  it('signale les documents qui expirent', () => {
    const v = { ...vehicle, insuranceExpiry: '2026-11-27', vignetteExpiry: '2027-06-01', inspectionExpiry: '2026-11-01' };
    const a = expiryAlerts([v], new Date('2026-11-20T10:00:00Z'));
    expect(a.map((x) => [x.document, x.daysLeft])).toEqual([
      ['visite technique', -19],
      ['assurance', 7],
    ]);
  });
});

describe('retour du véhicule', () => {
  it('facture km en plus, carburant, retard au-delà d’une heure et dégâts', () => {
    const f = returnFees(res({}), rate, {
      mileageIn: 44210 + 900, // 750 km inclus sur 3 jours
      fuelQuartersMissing: 1,
      fuelQuarterPrice: 15000,
      damages: 50000,
      returnedAt: '2026-11-20T15:00:00Z', // 3 h de retard
    });
    expect(f).toMatchObject({ kmDriven: 900, kmExtra: 150, kmFee: 22500, fuelFee: 15000, lateDays: 1, lateFee: 45000, damages: 50000 });
    expect(f.total).toBe(132500);
  });
  it('ne facture rien pour un retour propre et à l’heure', () => {
    const f = returnFees(res({}), rate, { mileageIn: 44500, fuelQuartersMissing: 0, fuelQuarterPrice: 15000, damages: 0, returnedAt: '2026-11-20T12:30:00Z' });
    expect(f.total).toBe(0);
  });
  it('inclut les frais dans le solde dû', () => {
    expect(balanceDue(res({ fees: 20000 }), [])).toBe(155000);
  });
});
