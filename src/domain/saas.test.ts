import { describe, expect, it } from 'vitest';
import { addPeriod, checkoutQuote, subscriptionStatus, vtcModuleActive, vtcQuote } from './saas';

const now = new Date('2026-11-24T10:00:00Z');

describe('état de l’abonnement', () => {
  it('essai, renouvellement, délai de grâce puis suspension', () => {
    expect(subscriptionStatus({ trialEndsAt: '2026-12-21T10:00:00Z', paidUntil: null }, now).state).toBe('essai');
    expect(subscriptionStatus({ trialEndsAt: '2026-11-20T10:00:00Z', paidUntil: null }, now).state).toBe('grace');
    expect(subscriptionStatus({ trialEndsAt: '2026-11-10T10:00:00Z', paidUntil: null }, now).state).toBe('bloque');
    expect(subscriptionStatus({ trialEndsAt: null, paidUntil: '2027-06-01T00:00:00Z', billingCycle: 'annuel' }, now).state).toBe('actif');
    expect(subscriptionStatus({ trialEndsAt: null, paidUntil: '2026-12-10T00:00:00Z', billingCycle: 'annuel' }, now).state).toBe('a_renouveler');
    expect(subscriptionStatus({ trialEndsAt: null, paidUntil: '2026-12-10T00:00:00Z', billingCycle: 'mensuel' }, now).state).toBe('actif');
    expect(subscriptionStatus({ trialEndsAt: null, paidUntil: null }, now).state).toBe('offert');
  });
  it('ajoute un an ou un mois, fin de mois comprise', () => {
    expect(addPeriod('2026-01-31T10:00:00.000Z', 'mensuel')).toBe('2026-02-28T10:00:00.000Z');
    expect(addPeriod('2026-11-24T10:00:00.000Z', 'annuel')).toBe('2027-11-24T10:00:00.000Z');
  });
});

describe('montant à payer', () => {
  it('premier paiement : le prix de la grille, minimum de la formule compris', () => {
    const q = checkoutQuote({ plan: 'pro', vehicles: 6, billing: 'annuel' }, { paidUntil: null, last: null }, now);
    expect(q.vehicles).toBe(10);
    expect(q.amountHt).toBe(360000);
    expect(q.creditHt).toBe(0);
    expect(q.periodEnd.slice(0, 10)).toBe('2027-11-24');
    expect(q.error).toBeNull();
  });
  it('passage en cours d’année : le temps restant est déduit', () => {
    const last = { amountHt: 360000, creditHt: 0, periodStart: '2026-05-24T10:00:00Z', periodEnd: '2027-05-24T10:00:00Z' };
    const q = checkoutQuote({ plan: 'pro', vehicles: 20, billing: 'annuel' }, { paidUntil: last.periodEnd, last }, now);
    // moitié de l'année restante environ : 360 000 × 181/365
    expect(q.creditHt).toBeGreaterThan(175000);
    expect(q.creditHt).toBeLessThan(185000);
    expect(q.amountHt).toBe(720000 - q.creditHt);
  });
  it('refuse de payer moins que ce qui est déjà couvert', () => {
    const last = { amountHt: 1440000, creditHt: 0, periodStart: '2026-11-01T10:00:00Z', periodEnd: '2027-11-01T10:00:00Z' };
    const q = checkoutQuote({ plan: 'essentiel', vehicles: 5, billing: 'annuel' }, { paidUntil: last.periodEnd, last }, now);
    expect(q.amountHt).toBe(0);
    expect(q.error).toMatch(/couvre déjà/);
  });
  it('TVA appliquée si l’émetteur y est assujetti', () => {
    const q = checkoutQuote({ plan: 'essentiel', vehicles: 5, billing: 'mensuel' }, { paidUntil: null, last: null }, now, 18);
    expect(q.amountHt).toBe(12000);
    expect(q.amountTtc).toBe(14160);
  });
});


describe('module Chauffeurs VTC', () => {
  it('inclus pendant l’essai et l’accès offert, payant ensuite', () => {
    expect(vtcModuleActive({ trialEndsAt: '2026-12-21T00:00:00Z', paidUntil: null }, now)).toBe(true);
    expect(vtcModuleActive({ trialEndsAt: null, paidUntil: '2027-02-28T00:00:00Z', billingCycle: null }, now)).toBe(true);
    expect(vtcModuleActive({ trialEndsAt: null, paidUntil: '2027-06-01T00:00:00Z', billingCycle: 'annuel' }, now)).toBe(false);
    expect(vtcModuleActive({ trialEndsAt: null, paidUntil: '2027-06-01T00:00:00Z', billingCycle: 'annuel', vtcUntil: '2026-12-24T00:00:00Z' }, now)).toBe(true);
  });
  it('25 000 FCFA HT par mois, la période s’ajoute à celle en cours', () => {
    const q = vtcQuote('mensuel', '2026-12-10T00:00:00.000Z', now, 18);
    expect(q.amountHt).toBe(25000);
    expect(q.amountTtc).toBe(29500);
    expect(q.periodStart).toBe('2026-12-10T00:00:00.000Z');
    expect(q.periodEnd).toBe('2027-01-10T00:00:00.000Z');
    expect(vtcQuote('annuel', null, now).amountHt).toBe(300000);
  });
});
