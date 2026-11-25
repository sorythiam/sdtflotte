import { describe, expect, it } from 'vitest';
import { computeReport, journalEntries, monthlyRevenue, revenueInPeriod } from './reports';
import type { Client, Maintenance, Payment, Reservation, Vehicle } from './types';

const v = (id: string, extra: Partial<Vehicle> = {}): Vehicle => ({
  id, plate: id.toUpperCase(), brand: 'Toyota', model: 'Hilux', year: 2022, category: '4x4', fuel: 'diesel', mileage: 0,
  outOfService: false, insuranceExpiry: null, inspectionExpiry: null, vignetteExpiry: null, ...extra,
});
const res = (id: string, p: Partial<Reservation>): Reservation => ({
  id, number: `CT-2026-${id}`, vehicleId: 'v1', clientId: 'c1', start: '', end: '', withDriver: false, status: 'terminee',
  dailyRate: 10000, total: 0, caution: 0, fees: 0, mileageOut: null, mileageIn: null, notes: null, createdAt: '', ...p,
});
const clients: Client[] = [
  { id: 'c1', kind: 'particulier', name: 'Aïssatou Diop', phone: '1', email: null, idNumber: null, licenseExpiry: null, score: 'fiable' },
  { id: 'c2', kind: 'entreprise', name: 'Baobab Logistique', phone: '2', email: null, idNumber: null, licenseExpiry: null, score: 'fiable' },
];
const NOV = { from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' };

describe('chiffre d’affaires au prorata', () => {
  it('répartit une location à cheval sur deux mois', () => {
    const r = res('1', { start: '2026-10-29T00:00:00Z', end: '2026-11-03T00:00:00Z', total: 50000 }); // 5 jours, 2 en novembre
    expect(revenueInPeriod(r, NOV)).toBe(20000);
  });
  it('rattache les frais au mois du retour et ignore les annulations', () => {
    expect(revenueInPeriod(res('1', { start: '2026-11-10T00:00:00Z', end: '2026-11-12T00:00:00Z', total: 20000, fees: 5000 }), NOV)).toBe(25000);
    expect(revenueInPeriod(res('2', { start: '2026-11-10T00:00:00Z', end: '2026-11-12T00:00:00Z', total: 20000, status: 'annulee' }), NOV)).toBe(0);
  });
});

describe('rapport de période', () => {
  const vehicles = [v('v1'), v('v2'), v('v3', { outOfService: true })];
  const reservations = [
    res('1', { vehicleId: 'v1', clientId: 'c1', start: '2026-11-01T00:00:00Z', end: '2026-11-16T00:00:00Z', total: 150000 }), // 15 j
    res('2', { vehicleId: 'v2', clientId: 'c2', start: '2026-11-21T00:00:00Z', end: '2026-12-01T00:00:00Z', total: 100000, status: 'en_cours' }), // 9 j en nov... 10 j
    res('3', { vehicleId: 'v2', clientId: 'c2', start: '2026-11-02T00:00:00Z', end: '2026-11-04T00:00:00Z', total: 20000, fees: 7000 }),
  ];
  const maintenances: Maintenance[] = [{ id: 'm', vehicleId: 'v1', label: 'Vidange', start: '2026-11-20T08:00:00Z', end: '2026-11-20T18:00:00Z', cost: 45000 }];
  const payments: Payment[] = [
    { id: 'p1', reservationId: '1', kind: 'acompte', amount: 75000, method: 'wave', status: 'paye', paidAt: '2026-10-30T10:00:00Z', createdAt: '' },
    { id: 'p2', reservationId: '1', kind: 'solde', amount: 75000, method: 'especes', status: 'paye', paidAt: '2026-11-16T10:00:00Z', createdAt: '' },
    { id: 'p3', reservationId: '2', kind: 'caution', amount: 300000, method: 'orange_money', status: 'paye', paidAt: '2026-11-21T09:00:00Z', createdAt: '' },
    { id: 'p4', reservationId: '3', kind: 'solde', amount: 27000, method: 'virement', status: 'paye', paidAt: '2026-11-04T09:00:00Z', createdAt: '' },
    { id: 'p5', reservationId: '3', kind: 'solde', amount: 1, method: 'wave', status: 'en_attente', paidAt: null, createdAt: '' },
  ];
  const r = computeReport({ vehicles, clients, reservations, payments, maintenances }, NOV);

  it('calcule CA, encaissements, entretien et marge', () => {
    expect(r.revenue).toBe(150000 + 100000 + 20000 + 7000);
    expect(r.collected).toBe(75000 + 27000); // ni l'acompte d'octobre, ni la caution, ni l'impayé
    expect(r.maintenance).toBe(45000);
    expect(r.margin).toBe(277000 - 45000);
    expect(r.fees).toBe(7000);
    expect(r.rentals).toBe(3);
  });
  it('déduit les dépenses de la période de la marge', () => {
    const withExp = computeReport(
      {
        vehicles, clients, reservations, payments, maintenances,
        expenses: [
          { id: 'e1', vehicleId: 'v1', date: '2026-11-05', kind: 'carburant', amount: 30000, label: null, mileage: null, reservationId: null },
          { id: 'e2', vehicleId: 'v2', date: '2026-10-28', kind: 'pneus', amount: 99000, label: null, mileage: null, reservationId: null },
        ],
      },
      NOV,
    );
    expect(withExp.expenses).toBe(30000);
    expect(withExp.margin).toBe(277000 - 45000 - 30000);
    expect(withExp.vehicles.find((x) => x.vehicleId === 'v1')!.margin).toBe(150000 - 45000 - 30000);
  });
  it('calcule l’occupation sans les véhicules hors service', () => {
    // v1 : 15 j, v2 : 10 + 2 = 12 j, sur 2 véhicules × 30 j
    expect(r.occupancy).toBeCloseTo(27 / 60);
    expect(r.vehicles.find((x) => x.vehicleId === 'v1')!.occupancy).toBeCloseTo(0.5);
    expect(r.vehicles.find((x) => x.vehicleId === 'v3')!.occupancy).toBe(0);
  });
  it('classe véhicules par marge et clients par CA', () => {
    expect(r.vehicles.map((x) => x.vehicleId)).toEqual(['v2', 'v1', 'v3']);
    expect(r.clients.map((c) => [c.name, c.rentals, c.revenue])).toEqual([
      ['Aïssatou Diop', 1, 150000],
      ['Baobab Logistique', 2, 127000],
    ]);
  });

  it('produit un journal équilibré avec les bons comptes', () => {
    const j = journalEntries(payments, reservations, clients, NOV);
    expect(j).toHaveLength(6);
    const debit = j.reduce((s, l) => s + l.debit, 0);
    const credit = j.reduce((s, l) => s + l.credit, 0);
    expect(debit).toBe(credit);
    expect(j.slice(0, 2).map((l) => [l.journal, l.account, l.debit, l.credit])).toEqual([
      ['BQ', '521100', 27000, 0],
      ['BQ', '706100', 0, 27000],
    ]);
    const caution = j.filter((l) => l.piece === 'CT-2026-2');
    expect(caution.map((l) => [l.journal, l.account, l.debit, l.credit])).toEqual([
      ['MM', '521800', 300000, 0],
      ['MM', '165000', 0, 300000],
    ]);
  });
  it('passe le remboursement de caution dans l’autre sens', () => {
    const refund: Payment[] = [{ id: 'x', reservationId: '1', kind: 'remboursement_caution', amount: 50000, method: 'especes', status: 'paye', paidAt: '2026-11-17T10:00:00Z', createdAt: '' }];
    expect(journalEntries(refund, reservations, clients, NOV).map((l) => [l.account, l.debit, l.credit])).toEqual([
      ['165000', 50000, 0],
      ['571100', 0, 50000],
    ]);
  });
});

describe('6 derniers mois', () => {
  it('liste les mois du plus ancien au plus récent', () => {
    const m = monthlyRevenue([res('1', { start: '2026-11-01T00:00:00Z', end: '2026-11-11T00:00:00Z', total: 100000 })], new Date(2026, 10, 21), 3);
    expect(m.map((x) => x.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(m[2].revenue).toBeGreaterThan(0);
  });
});

describe('journal avec factures et TVA', () => {
  it('passe la facture au journal des ventes et solde le client à l’encaissement', async () => {
    const { buildInvoice, billingSettings } = await import('./billing');
    const r = res('9', { start: '2026-11-10T09:00:00Z', end: '2026-11-12T09:00:00Z', total: 100000, status: 'terminee' });
    const c = { id: 'c1', kind: 'particulier', name: 'Aïssatou Diop', phone: '1', email: null, idNumber: null, licenseExpiry: null, score: 'fiable' } as Client;
    const inv = { ...buildInvoice(r, c, undefined, undefined, billingSettings('SDT', { vatEnabled: true }), new Date('2026-11-05T10:00:00Z')), id: 'i', number: 'FA-2026-0001' };
    const pay: Payment[] = [{ id: 'p', reservationId: '9', kind: 'solde', amount: 118000, method: 'cheque', status: 'paye', paidAt: '2026-11-12T10:00:00Z', createdAt: '', reference: '0012345' }];
    const j = journalEntries(pay, [r], [c], NOV, undefined, [inv]);
    expect(j.map((l) => [l.journal, l.account, l.debit, l.credit])).toEqual([
      ['VT', '411100', 118000, 0],
      ['VT', '706100', 0, 100000],
      ['VT', '443100', 0, 18000],
      ['BQ', '521100', 118000, 0],
      ['BQ', '411100', 0, 118000],
    ]);
    expect(j[j.length - 1].label).toContain('réf. 0012345');
  });
});

describe('journal complet et exports comptables', () => {
  const extras = {
    expenses: [
      { id: 'e1abcdef99', vehicleId: 'v1', date: '2026-11-03', kind: 'carburant' as const, amount: 30000, label: 'Plein', chargedTo: undefined },
      { id: 'e2', vehicleId: 'v1', date: '2026-11-04', kind: 'amende' as const, amount: 5000, label: null, chargedTo: 'chauffeur' as const },
    ],
    maintenance: [{ id: 'm1', vehicleId: 'v1', label: 'Vidange', start: '2026-11-06T08:00:00Z', cost: 45000, provider: 'Garage Diop' }],
    vehicles: [{ id: 'v1', plate: 'DK-1' }],
    vtcPayments: [{ id: 'vp1', contractId: 'k1', paidOn: '2026-11-07', amount: 15000, method: 'wave' as const, reference: 'W9' }],
    vtcContracts: [{ id: 'k1', number: 'VTC-2026-0001', driverId: 'd1' }],
    drivers: [{ id: 'd1', name: 'Modou Faye' }],
  };
  const j = journalEntries([], [], clients, NOV, undefined, [], extras);

  it('reprend versements VTC, dépenses et entretiens du propriétaire', () => {
    expect(j.map((l) => [l.journal, l.account, l.debit, l.credit])).toEqual([
      ['MM', '521800', 15000, 0], ['MM', '706200', 0, 15000],
      ['AC', '605300', 30000, 0], ['AC', '401100', 0, 30000],
      ['AC', '624100', 45000, 0], ['AC', '401100', 0, 45000],
    ]);
    expect(j[4].label).toBe('Entretien Vidange DK-1 (Garage Diop)');
  });

  it('code tiers sur le compte client et pièces équilibrées', async () => {
    const { unbalancedPieces } = await import('./reports');
    const pay: Payment[] = [{ id: 'p', reservationId: '9', kind: 'solde', amount: 1000, method: 'especes', status: 'paye', paidAt: '2026-11-12T10:00:00Z', createdAt: '' }];
    const { buildInvoice, billingSettings } = await import('./billing');
    const r = res('9', { start: '2026-11-10T09:00:00Z', end: '2026-11-11T09:00:00Z', total: 1000 });
    const inv = { ...buildInvoice(r, clients[0], undefined, undefined, billingSettings('SDT', {}), new Date('2026-11-05T10:00:00Z')), id: 'i', number: 'FA-2026-0002' };
    const k = journalEntries(pay, [r], clients, NOV, undefined, [inv]);
    expect(k.filter((l) => l.account === '411100').map((l) => l.thirdParty)).toEqual(['CC1', 'CC1']);
    expect(unbalancedPieces([...k, ...j])).toEqual([]);
  });

  it('CSV Sage 100 : point-virgule, comptes sur 8 chiffres, Windows-1252', async () => {
    const { sageCsv, toWindows1252, padAccount } = await import('./reports');
    const csv = sageCsv(j, { ...(await import('./reports')).DEFAULT_ACCOUNTS, accountLength: '8' });
    expect(csv.split('\r\n')[0]).toBe('Date;Code journal;N° pièce;N° compte général;N° compte tiers;Libellé;Débit;Crédit');
    expect(csv.split('\r\n')[1]).toBe('07/11/2026;MM;VTC-2026-0001;52180000;;Versement VTC VTC-2026-0001 Modou Faye réf. W9;15000;');
    expect(padAccount('411100', '6')).toBe('411100');
    const bytes = toWindows1252('é’€');
    expect([...bytes]).toEqual([0xe9, 0x92, 0x80]);
  });

  it('CSV Odoo : une première ligne par pièce, puis ses lignes', async () => {
    const { odooCsv, DEFAULT_ACCOUNTS } = await import('./reports');
    const rows = odooCsv(j, DEFAULT_ACCOUNTS).trim().split('\n');
    expect(rows[0]).toBe('date,journal_id,ref,line_ids/account_id,line_ids/partner_id,line_ids/name,line_ids/debit,line_ids/credit');
    expect(rows[1].startsWith('2026-11-07,MM,VTC-2026-0001,521800,')).toBe(true);
    expect(rows[2].startsWith(',,,706200,')).toBe(true);
  });
});
