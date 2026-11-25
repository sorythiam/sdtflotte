import { describe, expect, it } from 'vitest';
import { callPriority, funnel, stageOf, utmFrom, welcomeMessage, type SignupRow } from './platform';

const now = new Date('2026-12-01T10:00:00Z');
const row = (p: Partial<SignupRow>): SignupRow => ({
  orgId: 'o', name: 'Dakar Auto', country: 'SN', createdAt: '2026-12-01T09:00:00Z', plan: 'essai', trialEndsAt: '2026-12-31T09:00:00Z', paidUntil: null,
  contactName: 'Ousmane Fall', contactPhone: '771234567', adminEmail: null, signupSource: null, vehicles: 0, clients: 0, reservations: 0, members: 1,
  lastActivity: null, status: 'a_appeler', note: null, nextCall: null, followupAt: null, ...p,
});

describe('console Yoon Fleet', () => {
  it('situe chaque loueur dans le parcours', () => {
    expect(stageOf(row({}), now)).toBe('inscrit');
    expect(stageOf(row({ vehicles: 3 }), now)).toBe('flotte');
    expect(stageOf(row({ vehicles: 3, reservations: 1 }), now)).toBe('location');
    expect(stageOf(row({ paidUntil: '2027-12-01T00:00:00Z' }), now)).toBe('payant');
  });

  it('appelle d’abord les nouveaux inscrits, puis les rappels du jour', () => {
    const fresh = row({});
    const older = row({ createdAt: '2026-11-30T10:00:00Z' });
    const recall = row({ status: 'rappeler', nextCall: '2026-12-01' });
    const later = row({ status: 'rappeler', nextCall: '2026-12-05' });
    const paying = row({ paidUntil: '2027-12-01T00:00:00Z' });
    expect(callPriority(fresh, now)).toBeGreaterThan(callPriority(older, now));
    expect(callPriority(older, now)).toBeGreaterThan(callPriority(recall, now));
    expect(callPriority(recall, now)).toBeGreaterThanOrEqual(100);
    expect(callPriority(later, now)).toBeLessThan(100);
    expect(callPriority(paying, now)).toBe(0);
    // Essai qui finit dans 3 jours sans première location : à relancer.
    expect(callPriority(row({ status: 'onboarde', vehicles: 4, trialEndsAt: '2026-12-04T09:00:00Z' }), now)).toBeGreaterThanOrEqual(100);
  });

  it('mesure l’entonnoir des 30 derniers jours', () => {
    const f = funnel([row({}), row({ vehicles: 2, status: 'onboarde' }), row({ reservations: 1, vehicles: 1, status: 'onboarde' }), row({ createdAt: '2026-09-01T00:00:00Z' })], now);
    expect(f).toEqual({ signups: 3, called: 2, fleet: 2, firstRental: 1, paying: 0 });
  });

  it('lit la publicité d’origine et rédige le premier message', () => {
    expect(utmFrom('?utm_source=facebook&utm_campaign=lancement-dec')).toBe('facebook|lancement-dec');
    expect(utmFrom('?essai=1')).toBeNull();
    const m = welcomeMessage({ contactName: 'Ousmane Fall', name: 'Dakar Auto' }, 'Aminata');
    expect(m).toContain('Bonjour Ousmane, ici Aminata de Yoon Fleet.');
    expect(m).toContain('Dakar Auto');
  });
});
