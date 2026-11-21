import { describe, expect, it } from 'vitest';
import { availableByCategory, matchClient, slugify, SLUG_RE, validateBookingRequest, whatsappLink } from './booking';
import type { Client, Reservation, Vehicle } from './types';

const v = (id: string, category: string, extra: Partial<Vehicle> = {}): Vehicle => ({
  id, plate: id, brand: 'Toyota', model: 'X', year: 2022, category, fuel: 'diesel', mileage: 0, outOfService: false,
  insuranceExpiry: null, inspectionExpiry: null, vignetteExpiry: null, ...extra,
});
const NOW = new Date('2026-11-21T10:00:00Z');
const ok = { category: '4x4', start: '2026-11-25T09:00:00Z', end: '2026-11-28T09:00:00Z', withDriver: false, name: 'Awa Ndiaye', phone: '77 123 45 67', email: null, message: null };

describe('réservation en ligne', () => {
  it('fabrique une adresse de page propre', () => {
    expect(slugify('Sénégal Découverte Touristique')).toBe('senegal-decouverte-touristique');
    expect(slugify("  L'Auto & Cie  ")).toBe('l-auto-cie');
    expect(SLUG_RE.test('sdt')).toBe(true);
    expect(SLUG_RE.test('-sdt')).toBe(false);
  });

  it('compte les véhicules libres par catégorie', () => {
    const vehicles = [v('a', '4x4'), v('b', '4x4'), v('c', '4x4', { outOfService: true }), v('d', 'Berline')];
    const reservations = [
      { vehicleId: 'a', status: 'reservee', start: '2026-11-26T00:00:00Z', end: '2026-11-27T00:00:00Z' },
      { vehicleId: 'd', status: 'annulee', start: '2026-11-26T00:00:00Z', end: '2026-11-27T00:00:00Z' },
    ] as Reservation[];
    const maintenances = [{ id: 'm', vehicleId: 'b', label: 'Vidange', start: '2026-11-30T00:00:00Z', end: '2026-11-30T10:00:00Z', cost: 0 }];
    expect(availableByCategory(vehicles, reservations, maintenances, ok.start, ok.end)).toEqual({ '4x4': 1, Berline: 1 });
  });

  it('valide la demande', () => {
    expect(validateBookingRequest(ok, NOW)).toBeNull();
    expect(validateBookingRequest({ ...ok, start: '2026-11-20T09:00:00Z' }, NOW)).toMatch(/passée/);
    expect(validateBookingRequest({ ...ok, end: ok.start }, NOW)).toMatch(/après/);
    expect(validateBookingRequest({ ...ok, phone: '12' }, NOW)).toMatch(/téléphone/);
    expect(validateBookingRequest({ ...ok, email: 'pas-un-email' }, NOW)).toMatch(/email/);
    expect(validateBookingRequest({ ...ok, companyName: ' ' }, NOW)).toMatch(/entreprise/);
    expect(validateBookingRequest({ ...ok, companyName: 'Baobab Logistique', companyTaxId: '005871234' }, NOW)).toBeNull();
  });

  it('retrouve un client existant', () => {
    const clients = [{ id: 'c1', phone: '+221 77 123 45 67', email: null }, { id: 'c2', phone: '70 000 00 00', email: 'b@x.sn' }] as Client[];
    expect(matchClient(clients, '771234567', null)?.id).toBe('c1');
    expect(matchClient(clients, '76 999 99 99', 'B@x.sn')?.id).toBe('c2');
    expect(matchClient(clients, '76 999 99 99', null)).toBeUndefined();
  });

  it('prépare le lien WhatsApp', () => {
    expect(whatsappLink('77 123 45 67', 'Bonjour')).toBe('https://wa.me/221771234567?text=Bonjour');
    expect(whatsappLink('+225 07 07 07 07 07', 'a b')).toBe('https://wa.me/2250707070707?text=a%20b');
  });
});
