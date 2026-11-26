import { describe, expect, it } from 'vitest';
import { priceFor } from './pricing';

// Montants repris des exemples du document d'offre.
describe('grille tarifaire', () => {
  it('reproduit les exemples de l’offre', () => {
    expect(priceFor('essentiel', 8).yearly).toBe(192000);
    expect(priceFor('pro', 15).yearly).toBe(540000);
    expect(priceFor('pro', 25).yearly).toBe(900000);
    expect(priceFor('entreprise', 60).yearly).toBe(2880000);
    expect(priceFor('entreprise', 140).yearly).toBe(6336000);
  });
  it('applique le minimum de véhicules de chaque formule', () => {
    expect(priceFor('essentiel', 2)).toMatchObject({ billedVehicles: 5, yearly: 120000 });
    expect(priceFor('pro', 4)).toMatchObject({ billedVehicles: 10, yearly: 360000 });
    expect(priceFor('entreprise', 10)).toMatchObject({ billedVehicles: 30, yearly: 1440000 });
  });
  it('majore le paiement mensuel de 20 %', () => {
    expect(priceFor('pro', 15, 'annuel').perMonth).toBe(45000);
    expect(priceFor('pro', 15, 'mensuel').perMonth).toBe(54000);
  });
  it('passe sur devis au-delà de 100 véhicules', () => {
    expect(priceFor('entreprise', 100).onQuote).toBe(false);
    expect(priceFor('entreprise', 101).onQuote).toBe(true);
  });
});
