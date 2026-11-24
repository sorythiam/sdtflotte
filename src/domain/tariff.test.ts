import { describe, expect, it } from 'vitest';
import { priceFor, seasonCovers, seasonOn } from './tariff';
import type { Rate, Season } from './types';

const rate: Rate = { id: 'r', category: 'SUV', daily: 40000, weekly: 35000, monthly: 30000, driverDaily: 10000, kmPerDay: 250, extraKm: 150, caution: 300000, halfDay: 25000 };
const s = (id: string, startDate: string, endDate: string, percent: number, recurring = true): Season => ({ id, label: id, startDate, endDate, recurring, percent, active: true, createdAt: '' });
const haute = s('Haute saison', '2026-11-15', '2027-04-15', 20);
const fetes = s('Fêtes', '2026-12-20', '2027-01-05', 50);

describe('saisons', () => {
  it('une saison récurrente peut chevaucher le nouvel an', () => {
    expect(seasonCovers(haute, '2030-01-10')).toBe(true);
    expect(seasonCovers(haute, '2030-06-10')).toBe(false);
    expect(seasonCovers(s('Magal', '2027-08-01', '2027-08-03', 30, false), '2028-08-02')).toBe(false);
  });
  it('la saison la plus courte l’emporte', () => {
    expect(seasonOn([haute, fetes], '2026-12-25')?.id).toBe('Fêtes');
    expect(seasonOn([haute, fetes], '2027-02-01')?.id).toBe('Haute saison');
    expect(seasonOn([{ ...fetes, active: false }, haute], '2026-12-25')?.id).toBe('Haute saison');
  });
  it('majore jour par jour la location, pas le chauffeur', () => {
    // 18, 19 décembre : haute saison ; 20 décembre : fêtes
    const p = priceFor({ formula: 'jour', rate, start: '2026-12-18T09:00:00Z', end: '2026-12-21T09:00:00Z', withDriver: true, seasons: [haute, fetes] });
    expect(p.days).toBe(3);
    expect(p.rental).toBe(48000 * 2 + 60000);
    expect(p.driver).toBe(30000);
    expect(p.total).toBe(156000 + 30000);
    expect(p.seasonNote).toContain('Fêtes (+50 %) sur 1 jour');
  });
  it('une remise de basse saison baisse le prix', () => {
    const p = priceFor({ formula: 'jour', rate, start: '2026-08-01T09:00:00Z', end: '2026-08-02T09:00:00Z', withDriver: false, seasons: [s('Basse', '2026-07-01', '2026-09-30', -10)] });
    expect(p.total).toBe(36000);
  });
  it('un prix négocié de contrat cadre ne bouge pas avec la saison', () => {
    const p = priceFor({ formula: 'jour', rate, start: '2026-12-25T09:00:00Z', end: '2026-12-26T09:00:00Z', withDriver: false, deal: { dailyRate: 33000, discount: 0 }, seasons: [fetes] });
    expect(p.total).toBe(33000);
    expect(p.seasonNote).toBeNull();
  });
  it('sans saison, le prix est celui de la grille', () => {
    const p = priceFor({ formula: 'jour', rate, start: '2026-06-01T09:00:00Z', end: '2026-06-03T09:00:00Z', withDriver: false, seasons: [haute] });
    expect(p.total).toBe(80000);
    expect(p.dailyRate).toBe(40000);
  });
});
