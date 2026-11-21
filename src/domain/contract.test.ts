import { describe, expect, it } from 'vitest';
import { contractSettings, DEFAULT_TERMS, parseTerms } from './contract';

describe('conditions générales', () => {
  it('découpe le modèle en 12 articles titrés', () => {
    const a = parseTerms(DEFAULT_TERMS);
    expect(a).toHaveLength(12);
    expect(a[0].title).toBe('Article 1 – Objet');
    expect(a[11].body).toContain('tribunaux');
  });
  it('accepte du texte libre sans titres', () => {
    expect(parseTerms('Premier paragraphe\nsuite.\n\n\nSecond.')).toEqual([
      { title: null, body: 'Premier paragraphe suite.' },
      { title: null, body: 'Second.' },
    ]);
  });
  it('complète les réglages manquants', () => {
    const s = contractSettings('SDT', { city: 'Dakar', terms: '  ' });
    expect(s.legalName).toBe('SDT');
    expect(s.city).toBe('Dakar');
    expect(s.terms).toBe(DEFAULT_TERMS);
    expect(contractSettings('SDT', { legalName: 'SDT SARL' }).legalName).toBe('SDT SARL');
  });
});
