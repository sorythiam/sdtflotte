import { describe, expect, it } from 'vitest';
import { DemoStore } from './demoStore';
import { creditReservation, createReservation } from './services';

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

describe('loueurs touristiques (mode démo)', () => {
  async function full(store: DemoStore) {
    return { ...(await snapshot(store)), drivers: await store.list('drivers'), packages: await store.list('packages') };
  }
  const day = (offset: number, hour = 9) => {
    const d = new Date(Date.now() + offset * 86400000);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  it('refuse un groupe trop grand et force le chauffeur sur un bus', async () => {
    const store = new DemoStore(memory());
    const snap = await full(store);
    await expect(
      createReservation(store, snap, { vehicleId: 'v-dzire', clientId: 'c-diop', start: day(40), end: day(41), withDriver: true, notes: null, passengers: 6 }),
    ).rejects.toThrow(/4 places passagers pour 6/);
    await expect(
      createReservation(store, snap, { vehicleId: 'v-coaster', clientId: 'c-sante', start: day(40), end: day(41), withDriver: false, notes: null, passengers: 25, driverId: 'd-3' }),
    ).rejects.toThrow(/permis D ; Cheikh Ndour a : B/);
    const r = await createReservation(store, snap, { vehicleId: 'v-coaster', clientId: 'c-sante', start: day(40), end: day(41), withDriver: false, notes: null, passengers: 25, driverId: 'd-1' });
    expect(r.withDriver).toBe(true);
    expect(r.passengers).toBe(25);
    expect(r.total).toBe(180000 + 25000);
  });

  it('refuse un chauffeur déjà pris', async () => {
    const store = new DemoStore(memory());
    const snap = await full(store);
    const busy = snap.reservations.find((r) => r.driverId === 'd-1')!;
    await expect(
      createReservation(store, snap, { vehicleId: 'v-coaster', clientId: 'c-diop', start: busy.start, end: busy.end, withDriver: true, notes: null, driverId: 'd-1' }),
    ).rejects.toThrow(/Mamadou Sarr conduit déjà/);
  });

  it('forfait et demi-journée', async () => {
    const store = new DemoStore(memory());
    const snap = await full(store);
    const f = await createReservation(store, snap, { vehicleId: 'v-dzire', clientId: 'c-diop', start: day(50, 10), end: day(50, 13), withDriver: false, notes: null, formula: 'forfait', packageId: 'k-1' });
    expect(f).toMatchObject({ total: 30000, withDriver: true, formula: 'forfait', packageLabel: 'Transfert aéroport AIBD ↔ Dakar' });
    const h = await createReservation(store, await full(store), { vehicleId: 'v-hiace', clientId: 'c-diop', start: day(52, 8), end: day(52, 13), withDriver: true, notes: null, formula: 'demi_journee', missionFees: 5000 });
    expect(h.total).toBe(50000 + 10000 + 5000);
    await expect(
      createReservation(store, await full(store), { vehicleId: 'v-hiace', clientId: 'c-diop', start: day(54, 8), end: day(54, 18), withDriver: true, notes: null, formula: 'demi_journee' }),
    ).rejects.toThrow(/6 heures au plus/);
  });

  it('prolonge un contrat : avenant, facture complémentaire, puis annulation nette à zéro', async () => {
    const { billingSettings } = await import('../domain/billing');
    const { amendReservation, creditReservation } = await import('./services');
    const store = new DemoStore(memory());
    const ctx = async () => ({ settings: billingSettings('SDT', { vatEnabled: true }), clients: await store.list('clients'), vehicles: await store.list('vehicles'), rates: await store.list('rates'), invoices: await store.list('invoices') });
    const r = await createReservation(store, await full(store), { vehicleId: 'v-picanto', clientId: 'c-diop', start: day(60), end: day(62), withDriver: false, notes: null }, new Date(), await ctx());
    const longer = await amendReservation(store, await full(store), await ctx(), r, { start: r.start, end: day(64), total: 4 * 25000, reason: 'Prolongation', by: 'agent@sdt.sn' });
    expect(longer.total).toBe(100000);
    expect(await store.list('reservation_changes')).toHaveLength(1);
    let inv = (await store.list('invoices')).filter((i) => i.reservationId === r.id);
    expect(inv.map((i) => i.kind)).toEqual(['facture', 'complement']);
    const shorter = await amendReservation(store, await full(store), await ctx(), longer, { start: r.start, end: day(63), total: 75000, reason: 'Retour anticipé', by: null });
    inv = (await store.list('invoices')).filter((i) => i.reservationId === r.id);
    expect(inv.map((i) => i.kind)).toEqual(['facture', 'complement', 'avoir']);
    expect(inv.reduce((s, i) => s + i.totalHt, 0)).toBe(shorter.total);
    await creditReservation(store, inv, r.id);
    const net = (await store.list('invoices')).filter((i) => i.reservationId === r.id).reduce((s, i) => s + i.totalTtc, 0);
    expect(Math.abs(net)).toBeLessThanOrEqual(1);
  });

  it('refuse de prolonger sur une autre location', async () => {
    const { amendReservation } = await import('./services');
    const store = new DemoStore(memory());
    const snap = await full(store);
    const r = snap.reservations.find((x) => x.id === 'r-2')!; // Tucson en cours, le r-6 suit
    const next = snap.reservations.find((x) => x.id === 'r-6')!;
    await expect(
      amendReservation(store, snap, { settings: (await import('../domain/billing')).billingSettings('SDT', {}), clients: [], vehicles: [], rates: [], invoices: [] }, r, { start: r.start, end: next.end, total: r.total, reason: null, by: null }),
    ).rejects.toThrow(/déjà réservé/);
  });
});

describe('contrat cadre (mode démo)', () => {
  it('applique le prix négocié ou la remise, pas après la date de fin', async () => {
    const store = new DemoStore(memory());
    const snap = { ...(await snapshot(store)), clients: await store.list('clients'), drivers: await store.list('drivers'), packages: await store.list('packages') };
    const at = (d: number, h: number) => { const x = new Date(Date.now() + d * 86400000); x.setHours(h, 0, 0, 0); return x.toISOString(); };
    const mini = await createReservation(store, snap, { vehicleId: 'v-hiace', clientId: 'c-sante', start: at(70, 8), end: at(72, 8), withDriver: true, notes: null });
    expect(mini.total).toBe(2 * (85000 + 20000)); // prix négocié minibus + chauffeur au tarif normal
    const berline = await createReservation(store, snap, { vehicleId: 'v-dzire', clientId: 'c-sante', start: at(74, 8), end: at(76, 8), withDriver: false, notes: null });
    expect(berline.total).toBe(2 * 31500); // 35 000 − 10 %
    const later = await createReservation(store, snap, { vehicleId: 'v-dzire', clientId: 'c-sante', start: at(300, 8), end: at(302, 8), withDriver: false, notes: null });
    expect(later.total).toBe(2 * 35000); // contrat expiré
  });
});

describe('annulation avec acompte (mode démo)', () => {
  async function setup(vat: boolean) {
    const { billingSettings, payState } = await import('../domain/billing');
    const store = new DemoStore(memory());
    const settings = billingSettings('SDT', { vatEnabled: vat });
    const ctx = async () => ({ settings, clients: await store.list('clients'), vehicles: await store.list('vehicles'), rates: await store.list('rates'), invoices: await store.list('invoices') });
    const at = (d: number) => { const x = new Date(Date.now() + d * 86400000); x.setHours(9, 0, 0, 0); return x.toISOString(); };
    const r = await createReservation(store, await snapshot(store), { vehicleId: 'v-picanto', clientId: 'c-diop', start: at(80), end: at(84), withDriver: false, notes: null }, new Date(), await ctx());
    const inv = (await store.list('invoices')).find((i) => i.reservationId === r.id)!;
    const deposit = Math.round(inv.totalTtc * 0.3);
    await store.insert('payments', { reservationId: r.id, kind: 'acompte', amount: deposit, method: 'wave', status: 'paye', paidAt: new Date().toISOString(), reference: 'W1', dueAt: null } as never);
    const state = async () => payState({ ...r, status: 'annulee' }, await store.list('invoices'), await store.list('payments'), new Date());
    return { store, r, inv, deposit, settings, state };
  }

  it('garde l’acompte : rien à rembourser, rien à payer', async () => {
    const { store, r, inv, deposit, state } = await setup(true);
    await creditReservation(store, await store.list('invoices'), r.id, new Date(), deposit);
    const st = await state();
    expect(Math.abs(st.owed - deposit)).toBeLessThanOrEqual(1);
    expect(st.remaining).toBeLessThanOrEqual(1);
    expect(st.status === 'payee' || st.status === 'acompte').toBe(true);
    const av = (await store.list('invoices')).find((i) => i.kind === 'avoir')!;
    expect(av.relatedInvoiceId).toBe(inv.id);
    expect(av.lines[0].label).toContain('frais d’annulation');
  });

  it('frais d’annulation supérieurs à l’acompte : le client doit le reste', async () => {
    const { store, r, inv, deposit, state } = await setup(true);
    const fee = Math.round(inv.totalTtc * 0.5);
    await creditReservation(store, await store.list('invoices'), r.id, new Date(), fee);
    const st = await state();
    expect(Math.abs(st.remaining - (fee - deposit))).toBeLessThanOrEqual(1);
    expect(st.status).not.toBe('annulee');
  });

  it('sans frais : tout l’acompte est à rembourser', async () => {
    const { store, r, deposit, state } = await setup(false);
    await creditReservation(store, await store.list('invoices'), r.id, new Date(), 0);
    const st = await state();
    expect(st).toMatchObject({ owed: 0, status: 'trop_percu' });
    expect(st.paid).toBe(deposit);
  });

  it('sans facture émise : les frais d’annulation sont facturés', async () => {
    const { billingSettings, payState } = await import('../domain/billing');
    const store = new DemoStore(memory());
    const at = (d: number) => { const x = new Date(Date.now() + d * 86400000); x.setHours(9, 0, 0, 0); return x.toISOString(); };
    const r = await createReservation(store, await snapshot(store), { vehicleId: 'v-picanto', clientId: 'c-diop', start: at(90), end: at(92), withDriver: false, notes: null });
    expect((await store.list('invoices')).some((i) => i.reservationId === r.id)).toBe(false);
    const client = (await store.list('clients')).find((c) => c.id === r.clientId);
    await creditReservation(store, [], r.id, new Date(), 20000, { r, client, settings: billingSettings('SDT', {}) });
    const st = payState({ ...r, status: 'annulee' }, await store.list('invoices'), await store.list('payments'), new Date());
    expect(st).toMatchObject({ owed: 20000, remaining: 20000 });
  });
});

describe('convertQuote (mode démo)', () => {
  it('crée une réservation par véhicule au prix du devis et clôt le devis', async () => {
    const { buildQuote } = await import('../domain/quotes');
    const { convertQuote } = await import('./services');
    const store = new DemoStore(memory());
    const data = { ...(await snapshot(store)), clients: await store.list('clients'), packages: await store.list('packages'), seasons: await store.list('seasons'), quotes: [] };
    const start = new Date(Date.now() + 40 * 86400000);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 2 * 86400000);
    const draft = buildQuote({ clientId: 'c-teranga', category: '4x4', quantity: 2, formula: 'jour', start: start.toISOString(), end: end.toISOString(), withDriver: true }, data, new Date(), null);
    const q = await store.insert('quotes', { ...draft, unitTotal: 123000, total: 246000 });
    await expect(convertQuote(store, data, q, ['v-hilux'])).rejects.toThrow(/2 véhicules/);
    const made = await convertQuote(store, data, q, ['v-hilux', 'v-prado']);
    expect(made).toHaveLength(2);
    expect(made.every((r) => r.total === 123000 && r.clientId === 'c-teranga')).toBe(true);
    const after = (await store.list('quotes')).find((x) => x.id === q.id)!;
    expect(after.status).toBe('converti');
    expect(after.reservationIds).toEqual(made.map((r) => r.id));
    await expect(convertQuote(store, data, after, ['v-hilux', 'v-prado'])).rejects.toThrow(/clos/);
  });
});
