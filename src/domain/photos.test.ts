import { describe, expect, it } from 'vitest';
import { categoryPhotos, fitWithin, storagePath } from './photos';

describe('photos', () => {
  it('met les couvertures en premier, sans doublon ni véhicule hors service', () => {
    const vs = [
      { category: '4x4', outOfService: false, photos: ['a1', 'a2'] },
      { category: '4x4', outOfService: false, photos: ['b1', 'a2'] },
      { category: '4x4', outOfService: true, photos: ['c1'] },
      { category: 'SUV', outOfService: false, photos: ['d1'] },
      { category: '4x4', outOfService: false },
    ];
    expect(categoryPhotos(vs, '4x4')).toEqual(['a1', 'b1', 'a2']);
    expect(categoryPhotos(vs, 'Berline')).toEqual([]);
    expect(categoryPhotos(vs, '4x4', 2)).toEqual(['a1', 'b1']);
  });
  it('réduit sans déformer', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
  it('retrouve le chemin de stockage', () => {
    expect(storagePath('https://x.supabase.co/storage/v1/object/public/vehicle-photos/org%201/abc.jpg', 'vehicle-photos')).toBe('org 1/abc.jpg');
    expect(storagePath('data:image/jpeg;base64,xx', 'vehicle-photos')).toBeNull();
  });
});
