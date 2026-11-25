import { describe, expect, it } from 'vitest';
import { allocatePayment, groupCapacity, groupMessage, nextGroupNumber, splitPassengers } from './groups';

describe('dossiers de groupe', () => {
  it('numérote les dossiers par année', () => {
    expect(nextGroupNumber([], 2026)).toBe('DO-2026-0001');
    expect(nextGroupNumber(['DO-2026-0007', 'DO-2025-0040'], 2026)).toBe('DO-2026-0008');
  });

  it('répartit les passagers sans dépasser les places', () => {
    expect(splitPassengers(6, [4, 4])).toEqual([3, 3]);
    expect(splitPassengers(14, [4, 13])).toEqual([4, 10]);
    expect(splitPassengers(3, [4, 4, 4])).toEqual([1, 1, 1]);
    expect(splitPassengers(null, [4, 4])).toEqual([null, null]);
    expect(splitPassengers(2, [4, 4, 4])).toEqual([1, 1, null]);
    expect(groupCapacity([4, 13])).toBe(17);
    expect(groupCapacity([4, null])).toBeNull();
  });

  it('répartit un paiement : acomptes d’abord, puis soldes', () => {
    const items = [
      { reservationId: 'a', remaining: 100000, depositMissing: 30000, reserved: true },
      { reservationId: 'b', remaining: 200000, depositMissing: 60000, reserved: true },
    ];
    expect(allocatePayment(90000, items)).toEqual([
      { reservationId: 'a', kind: 'acompte', amount: 30000 },
      { reservationId: 'b', kind: 'acompte', amount: 60000 },
    ]);
    expect(allocatePayment(150000, items)).toEqual([
      { reservationId: 'a', kind: 'acompte', amount: 90000 },
      { reservationId: 'b', kind: 'acompte', amount: 60000 },
    ]);
    expect(allocatePayment(300000, items).reduce((s, p) => s + p.amount, 0)).toBe(300000);
    expect(() => allocatePayment(300001, items)).toThrow(/reste dû/);
    expect(() => allocatePayment(0, items)).toThrow(/invalide/);
  });

  it('rédige le récapitulatif WhatsApp', () => {
    const r = { id: 'r1', number: 'CT-2026-0411', start: '2026-12-07T08:00:00Z', end: '2026-12-10T18:00:00Z' } as never;
    const msg = groupMessage({ number: 'DO-2026-0001', label: 'Circuit Lompoul' }, 'Fatou', { active: [r, r], owed: 500000, paid: 100000, remaining: 400000, depositMissing: 50000 }, () => '4x4 Toyota Prado', 'SDT', ['Wave : 77 000 00 00']);
    expect(msg).toContain('DO-2026-0001');
    expect(msg).toContain('2 véhicules');
    expect(msg).toMatch(/Reste à payer : 400\s000 FCFA/);
    expect(msg).toContain('Wave : 77 000 00 00');
  });
});
