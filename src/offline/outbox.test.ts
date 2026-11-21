import { describe, expect, it } from 'vitest';
import { emptyItems } from '../domain/inspection';
import { isLocal, localRefs, replaceLocalRefs } from './outbox';

describe('file d’envoi hors connexion', () => {
  const items = emptyItems().map((x, k) => (k === 0 ? { ...x, photos: ['org/r/a.jpg', 'local:1'] } : k === 1 ? { ...x, photos: ['local:2'] } : x));

  it('repère les photos gardées sur le téléphone', () => {
    expect(isLocal('local:1')).toBe(true);
    expect(localRefs(items)).toEqual(['local:1', 'local:2']);
  });
  it('remplace les références envoyées et signale les manquantes', () => {
    const all = replaceLocalRefs(items, { 'local:1': 'org/r/b.jpg', 'local:2': 'org/r/c.jpg' });
    expect(all.missing).toEqual([]);
    expect(all.items[0].photos).toEqual(['org/r/a.jpg', 'org/r/b.jpg']);
    expect(all.items[1].photos).toEqual(['org/r/c.jpg']);
    const part = replaceLocalRefs(items, { 'local:1': 'x' });
    expect(part.missing).toEqual(['local:2']);
  });
});
