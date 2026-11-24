import { describe, expect, it } from 'vitest';
import { DEFAULT_BILLING } from './billing';
import { buildQuote, nextQuoteNumber, quoteLines, quoteState, quoteTotals } from './quotes';
import type { Client, Rate } from './types';

const rate: Rate = { id: 'r', category: 'Minibus', daily: 75000, weekly: 68000, monthly: 55000, driverDaily: 20000, kmPerDay: 300, extraKm: 200, caution: 400000 };
const client = { id: 'c1', name: 'Agence Teranga', phone: '770000000', kind: 'entreprise', score: 'fiable' } as Client;
const ctx = { clients: [client], rates: [rate], packages: [], seasons: [], quotes: [{ number: 'DV-2026-0007' }] };
const now = new Date('2026-11-24T10:00:00Z');

describe('devis', () => {
  it('numérote à la suite, par année', () => {
    expect(nextQuoteNumber(['DV-2026-0007', 'DV-2025-0099'], 2026)).toBe('DV-2026-0008');
    expect(nextQuoteNumber([], 2027)).toBe('DV-2027-0001');
  });
  it('chiffre plusieurs véhicules avec chauffeur', () => {
    const q = buildQuote({ clientId: 'c1', category: 'Minibus', quantity: 3, formula: 'jour', start: '2026-12-01T08:00:00Z', end: '2026-12-03T08:00:00Z', withDriver: false, driverRequired: true, missionFees: 15000 }, ctx, now, 'agent@sdt.sn');
    expect(q.number).toBe('DV-2026-0008');
    expect(q.withDriver).toBe(true);
    expect(q.unitTotal).toBe(2 * 75000 + 2 * 20000 + 15000);
    expect(q.total).toBe(q.unitTotal * 3);
    expect(q.validUntil).toBe('2026-12-09');
    const lines = quoteLines({ ...q, id: 'x' });
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(q.total);
    expect(quoteTotals({ ...q, id: 'x' }, { ...DEFAULT_BILLING, vatEnabled: true }).totalTtc).toBe(Math.round(q.total * 1.18));
  });
  it('refuse un client blacklisté et un nombre de véhicules absurde', () => {
    const base = { clientId: 'c1', category: 'Minibus', quantity: 1, formula: 'jour' as const, start: '2026-12-01T08:00:00Z', end: '2026-12-02T08:00:00Z', withDriver: true };
    expect(() => buildQuote(base, { ...ctx, clients: [{ ...client, score: 'blacklist' }] }, now, null)).toThrow(/blacklisté/);
    expect(() => buildQuote({ ...base, quantity: 0 }, ctx, now, null)).toThrow(/1 à 50/);
  });
  it('un devis envoyé dont la validité est passée est expiré', () => {
    expect(quoteState({ status: 'envoye', validUntil: '2026-11-23' }, now)).toBe('expire');
    expect(quoteState({ status: 'converti', validUntil: '2026-11-23' }, now)).toBe('converti');
    expect(quoteState({ status: 'envoye', validUntil: '2026-11-24' }, now)).toBe('envoye');
  });
});
