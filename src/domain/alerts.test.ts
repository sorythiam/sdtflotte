import { describe, expect, it } from 'vitest';
import { alertsFor, buildAlerts, digestEmail, localDay } from './alerts';
import type { Client, Payment, Reservation, Vehicle } from './types';

const NOW = new Date('2026-11-21T08:00:00Z');
const v = (id: string, extra: Partial<Vehicle> = {}): Vehicle => ({
  id, plate: `DK-${id}`, brand: 'Toyota', model: 'Hilux', year: 2022, category: '4x4', fuel: 'diesel', mileage: 0,
  outOfService: false, insuranceExpiry: null, inspectionExpiry: null, vignetteExpiry: null, ...extra,
});
const c = (id: string, extra: Partial<Client> = {}): Client => ({
  id, kind: 'particulier', name: `Client ${id}`, phone: '1', email: null, idNumber: null, licenseExpiry: null, score: 'fiable', ...extra,
});
const r = (id: string, p: Partial<Reservation>): Reservation => ({
  id, number: `CT-2026-${id}`, vehicleId: 'v1', clientId: 'c1', start: '2026-11-10T09:00:00Z', end: '2026-11-12T09:00:00Z',
  withDriver: false, status: 'terminee', dailyRate: 10000, total: 20000, caution: 0, fees: 0, mileageOut: null, mileageIn: null,
  notes: null, createdAt: '', ...p,
});
const paid = (resId: string, kind: Payment['kind'], amount: number): Payment => ({
  id: `${resId}-${kind}`, reservationId: resId, kind, amount, method: 'wave', status: 'paye', paidAt: '2026-11-10T09:00:00Z', createdAt: '',
});

function run(reservations: Reservation[], extra: { vehicles?: Vehicle[]; clients?: Client[]; payments?: Payment[] } = {}) {
  return buildAlerts(
    { vehicles: extra.vehicles ?? [v('v1')], clients: extra.clients ?? [c('c1')], reservations, payments: extra.payments ?? [], maintenances: [] },
    NOW, 0,
  );
}

describe('journée locale', () => {
  it('tient compte du fuseau', () => {
    const d = localDay(new Date('2026-11-21T23:30:00Z'), 60); // 00h30 le 22 à Douala
    expect(new Date(d.start).toISOString()).toBe('2026-11-21T23:00:00.000Z');
  });
});

describe('alertes', () => {
  it('signale retards, départs et retours du jour', () => {
    const a = run([
      r('1', { status: 'en_cours', start: '2026-11-15T09:00:00Z', end: '2026-11-19T09:00:00Z' }),
      r('2', { status: 'en_cours', start: '2026-11-18T09:00:00Z', end: '2026-11-21T17:30:00Z' }),
      r('3', { status: 'reservee', start: '2026-11-21T14:00:00Z', end: '2026-11-23T14:00:00Z' }),
      r('4', { status: 'reservee', start: '2026-11-19T14:00:00Z', end: '2026-11-25T14:00:00Z' }),
      r('5', { status: 'reservee', start: '2026-11-22T14:00:00Z', end: '2026-11-25T14:00:00Z' }),
    ], { payments: [] });
    const kinds = a.map((x) => x.kind);
    expect(kinds).toContain('retard');
    expect(kinds).toContain('retour_jour');
    expect(kinds).toContain('depart_jour');
    expect(kinds).toContain('depart_non_fait');
    expect(a.find((x) => x.kind === 'retard')!.detail).toContain('2 jours de retard');
    expect(a.find((x) => x.kind === 'retour_jour')!.title).toContain('17h30');
    expect(a.filter((x) => x.id === 'depart:5')).toHaveLength(0); // demain : rien
    expect(a[0].level).toBe('urgent');
  });

  it('vérifie le permis sauf location avec chauffeur', () => {
    const clients = [c('c1', { licenseExpiry: '2026-11-22' })];
    const res = r('1', { status: 'reservee', start: '2026-11-21T14:00:00Z', end: '2026-11-24T14:00:00Z' });
    expect(run([res], { clients }).some((x) => x.kind === 'permis')).toBe(true);
    expect(run([{ ...res, withDriver: true }], { clients }).some((x) => x.kind === 'permis')).toBe(false);
  });

  it('signale soldes impayés et cautions à rendre', () => {
    const a = run([r('1', { fees: 5000 }), r('2', {})], {
      payments: [paid('1', 'solde', 20000), paid('2', 'solde', 20000), paid('2', 'caution', 100000)],
    });
    expect(a.find((x) => x.kind === 'impaye')!.title).toBe('Solde impayé : 5 000 FCFA');
    expect(a.find((x) => x.kind === 'caution_a_rendre')!.title).toBe('Caution à rendre : 100 000 FCFA');
  });

  it('classe les documents par urgence et ignore les véhicules hors service', () => {
    const a = run([], {
      vehicles: [
        v('v1', { insuranceExpiry: '2026-11-18' }),
        v('v2', { inspectionExpiry: '2026-12-10' }),
        v('v3', { vignetteExpiry: '2026-11-01', outOfService: true }),
      ],
    });
    expect(a.map((x) => [x.level, x.title])).toEqual([
      ['urgent', 'Assurance expirée : Toyota Hilux (DK-v1)'],
      ['attention', 'Visite technique à renouveler : Toyota Hilux (DK-v2)'],
    ]);
  });

  it('filtre selon le profil', () => {
    const a = run([r('1', { fees: 5000 }), r('2', { status: 'en_cours', start: '2026-11-15T09:00:00Z', end: '2026-11-19T09:00:00Z' })], {
      payments: [paid('1', 'solde', 20000)],
      vehicles: [v('v1', { insuranceExpiry: '2026-11-25' })],
    });
    expect(alertsFor(a, 'comptable').map((x) => x.kind)).toEqual(['impaye']);
    expect(alertsFor(a, 'mecanicien').map((x) => x.kind)).toEqual(['document']);
    expect(alertsFor(a, 'agent').map((x) => x.kind).sort()).toEqual(['document', 'retard']);
    expect(alertsFor(a, 'admin')).toHaveLength(3);
  });
});

describe('récapitulatif email', () => {
  it('ne part pas quand il n’y a rien', () => {
    expect(digestEmail('SDT', [], 'https://x', '21/11/2026')).toBeNull();
  });
  it('met les urgences dans l’objet et échappe le HTML', () => {
    const a = run([r('1', { status: 'en_cours', start: '2026-11-15T09:00:00Z', end: '2026-11-19T09:00:00Z' })], {
      clients: [c('c1', { name: 'Diop <script>' })],
    });
    const e = digestEmail('SDT', a, 'https://yoonfleet.vercel.app/', '21/11/2026')!;
    expect(e.subject).toBe('1 alerte urgente · SDT · 21/11/2026');
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('https://yoonfleet.vercel.app/reservations/1');
    expect(e.text).toContain('Retour en retard');
  });
});
