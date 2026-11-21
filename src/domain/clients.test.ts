import { describe, expect, it } from 'vitest';
import { emptyClient, legalLine, normalizeClient, taxIdLabel, validateClient } from './clients';

describe('fiche client', () => {
  it('demande le minimum pour un particulier', () => {
    const c = { ...emptyClient(), name: 'Awa Ndiaye', phone: '77 123 45 67' };
    expect(validateClient(c)).toBeNull();
    expect(validateClient({ ...c, phone: '12' })).toMatch(/téléphone/);
  });
  it('demande adresse et contact pour une entreprise', () => {
    const c = { ...emptyClient('entreprise'), name: 'Baobab Logistique', phone: '33 800 00 01' };
    expect(validateClient(c)).toMatch(/adresse/);
    expect(validateClient({ ...c, address: 'Zone industrielle' })).toMatch(/personne de contact/);
    expect(validateClient({ ...c, address: 'Zone industrielle', contactName: 'Moussa Sarr' })).toMatch(/téléphone de la personne/);
    expect(validateClient({ ...c, address: 'Zone industrielle', contactName: 'Moussa Sarr', contactPhone: '77 000 11 22' })).toBeNull();
  });
  it('nettoie et vide les champs entreprise d’un particulier', () => {
    const n = normalizeClient({ ...emptyClient(), name: ' Awa ', phone: ' 77 ', email: '  ', taxId: '123', contactName: 'X', city: ' Thiès ' });
    expect(n).toMatchObject({ name: 'Awa', phone: '77', email: null, taxId: null, contactName: null, city: 'Thiès' });
  });
  it('formate les identifiants légaux', () => {
    expect(legalLine({ taxId: '005123456', tradeRegister: 'SN-DKR-2019-B-1234' })).toBe('NINEA 005123456 · RCCM SN-DKR-2019-B-1234');
    expect(legalLine({ taxId: null, tradeRegister: null })).toBe('');
    expect(taxIdLabel('SN')).toBe('NINEA');
    expect(taxIdLabel('CM')).toBe('NIF');
  });
});
