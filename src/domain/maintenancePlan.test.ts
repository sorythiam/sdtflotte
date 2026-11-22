import { describe, expect, it } from 'vitest';
import { planDue } from './maintenancePlan';
import type { MaintenancePlan } from './types';

const now = new Date('2026-11-22T10:00:00Z');
const plan = (p: Partial<MaintenancePlan>): MaintenancePlan => ({
  id: 'p', vehicleId: 'v', label: 'Vidange', everyKm: 10000, everyMonths: 6, lastKm: 50000, lastDate: '2026-08-01', active: true, createdAt: '2026-01-01T00:00:00Z', ...p,
});

describe('entretien périodique', () => {
  it('à jour, bientôt ou dépassé, au premier des deux seuils', () => {
    expect(planDue(plan({}), { mileage: 55000 }, now)).toMatchObject({ state: 'ok', nextKm: 60000, nextDate: '2027-02-01', kmLeft: 5000 });
    expect(planDue(plan({}), { mileage: 59200 }, now).state).toBe('bientot');
    expect(planDue(plan({}), { mileage: 61200 }, now)).toMatchObject({ state: 'depasse', text: expect.stringContaining('dépassé de 1') });
    expect(planDue(plan({ lastDate: '2026-05-10' }), { mileage: 51000 }, now).state).toBe('depasse');
    expect(planDue(plan({ lastDate: '2026-06-01' }), { mileage: 51000 }, now).state).toBe('bientot');
  });
  it('fonctionne avec un seul rythme, et gère les fins de mois', () => {
    expect(planDue(plan({ everyKm: null, lastDate: '2026-08-31' }), { mileage: 0 }, now).nextDate).toBe('2027-02-28');
    expect(planDue(plan({ everyMonths: null }), { mileage: 52000 }, now)).toMatchObject({ nextDate: null, state: 'ok' });
  });
});
