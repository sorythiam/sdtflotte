import { describe, expect, it } from 'vitest';
import { DemoStore } from './demoStore';
import { createReservation } from './services';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

async function snapshot(store: DemoStore) {
  return {
    reservations: await store.list('reservations'),
    maintenances: await store.list('maintenances'),
    rates: await store.list('rates'),
    vehicles: await store.list('vehicles'),
  };
}

describe('createReservation (mode démo)', () => {
  it('crée une réservation libre avec le bon prix et le numéro suivant', async () => {
    const store = new DemoStore(memory());
    const snap = await snapshot(store);
    const start = new Date(Date.now() + 20 * 86400000);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 3 * 86400000);
    const r = await createReservation(store, snap, {
      vehicleId: 'v-dzire', clientId: 'c-diop', start: start.toISOString(), end: end.toISOString(), withDriver: true, notes: null,
    });
    expect(r.total).toBe(3 * (35000 + 12000));
    expect(r.caution).toBe(200000);
    expect(r.number).toMatch(/^CT-\d{4}-\d{4}$/);
    expect((await store.list('reservations')).length).toBe(snap.reservations.length + 1);
  });

  it('refuse un véhicule déjà loué sur la période', async () => {
    const store = new DemoStore(memory());
    const snap = await snapshot(store);
    const busy = snap.reservations.find((r) => r.status === 'en_cours')!;
    await expect(
      createReservation(store, snap, { vehicleId: busy.vehicleId, clientId: 'c-diop', start: busy.start, end: busy.end, withDriver: false, notes: null }),
    ).rejects.toThrow(/déjà réservé/);
  });

  it('refuse un retour avant le départ', async () => {
    const store = new DemoStore(memory());
    const snap = await snapshot(store);
    await expect(
      createReservation(store, snap, { vehicleId: 'v-dzire', clientId: 'c-diop', start: '2027-01-02T10:00:00Z', end: '2027-01-01T10:00:00Z', withDriver: false, notes: null }),
    ).rejects.toThrow(/après la date de départ/);
  });

  it('applique le quota de véhicules', async () => {
    const store = new DemoStore(memory());
    const base = { brand: 'Kia', model: 'Rio', year: 2023, category: 'Citadine', fuel: 'essence' as const, mileage: 0, outOfService: false, insuranceExpiry: null, inspectionExpiry: null, vignetteExpiry: null };
    const existing = (await store.list('vehicles')).length;
    for (let i = existing; i < 40; i++) await store.insert('vehicles', { ...base, plate: `TEST-${i}` });
    await expect(store.insert('vehicles', { ...base, plate: 'TROP' })).rejects.toThrow(/Quota de 40/);
  });
});

describe('facturation (mode démo)', () => {
  it('facture à la validation, puis avoir à l’annulation, numéros continus', async () => {
    const { billingSettings } = await import('../domain/billing');
    const { creditReservation } = await import('./services');
    const store = new DemoStore(memory());
    const snap = await snapshot(store);
    const before = await store.list('invoices');
    const ctx = { settings: billingSettings('SDT', { vatEnabled: true }), clients: await store.list('clients'), vehicles: snap.vehicles, rates: snap.rates, invoices: before };
    const start = new Date(Date.now() + 30 * 86400000);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 2 * 86400000);
    const r = await createReservation(store, snap, {
      vehicleId: 'v-picanto', clientId: 'c-diop', start: start.toISOString(), end: end.toISOString(), withDriver: false, notes: null,
    }, new Date(), ctx);
    const after = await store.list('invoices');
    const inv = after.find((i) => i.reservationId === r.id)!;
    expect(after).toHaveLength(before.length + 1);
    expect(inv.number).toMatch(/^FA-\d{4}-\d{4}$/);
    expect(inv.totalTtc).toBe(Math.round(r.total * 1.18));
    await expect(store.update('invoices', inv.id, { totalTtc: 1 } as never)).rejects.toThrow(/avoir/);
    const [av] = await creditReservation(store, after, r.id);
    expect(av.number).toMatch(/^AV-\d{4}-0001$/);
    expect(av.totalTtc).toBe(-inv.totalTtc);
    expect(await creditReservation(store, await store.list('invoices'), r.id)).toHaveLength(0);
  });
});
