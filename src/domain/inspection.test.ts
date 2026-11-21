import { describe, expect, it } from 'vitest';
import { compareInspections, emptyItems, inspectionProblems, ZONES } from './inspection';

const withPhotos = () => emptyItems().map((x) => ({ ...x, photos: ['p'] }));

describe('état des lieux', () => {
  it('liste ce qui manque avant de valider', () => {
    const p = inspectionProblems({ mileage: 1000, fuelQuarters: 4, items: emptyItems(), signature: null, signerName: '' }, { minMileage: 1200 });
    expect(p[0]).toMatch(/inférieur à 1200/);
    expect(p.join(' ')).toMatch(/Photo manquante : avant, côté droit, arrière, côté gauche, intérieur/);
    expect(p.join(' ')).toMatch(/nom/);
    expect(p.join(' ')).toMatch(/signer/);
  });
  it('accepte un état des lieux complet ; un dommage doit être décrit', () => {
    const items = withPhotos();
    expect(inspectionProblems({ mileage: 1300, fuelQuarters: 3, items, signature: 'sig', signerName: 'Awa' }, { minMileage: 1200 })).toEqual([]);
    items[0] = { ...items[0], status: 'dommage' };
    expect(inspectionProblems({ mileage: 1300, fuelQuarters: 3, items, signature: 'sig', signerName: 'Awa' })).toEqual(['Décrivez le dommage : avant.']);
  });
  it('photos facultatives en départ rapide', () => {
    expect(inspectionProblems({ mileage: 10, fuelQuarters: 4, items: emptyItems(), signature: 's', signerName: 'A' }, { requirePhotos: false })).toEqual([]);
  });
  it('distingue les nouveaux dégâts de ceux déjà notés au départ', () => {
    const dep = { mileage: 1000, fuelQuarters: 4, items: emptyItems().map((x) => (x.zone === 'avant' ? { ...x, status: 'dommage' as const, note: 'Rayure' } : x)) };
    const ret = {
      mileage: 1450, fuelQuarters: 2,
      items: emptyItems().map((x) => (x.zone === 'avant' || x.zone === 'gauche' ? { ...x, status: 'dommage' as const, note: x.zone === 'gauche' ? 'Portière enfoncée' : 'Rayure' } : x)),
    };
    const c = compareInspections(dep, ret);
    expect(c.newDamages).toEqual([{ zone: 'gauche', label: 'Côté gauche', note: 'Portière enfoncée' }]);
    expect(c.knownDamages.map((d) => d.zone)).toEqual(['avant']);
    expect([c.fuelMissing, c.kmDriven]).toEqual([2, 450]);
  });
  it('a un parcours de 8 zones dont 5 photos obligatoires', () => {
    expect(ZONES).toHaveLength(8);
    expect(ZONES.filter((z) => z.photoRequired)).toHaveLength(5);
  });
});
