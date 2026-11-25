import { describe, expect, it } from 'vitest';
import { sectionOf, SECTIONS, visibleTabs } from './nav';

describe('menu', () => {
  it('rattache chaque adresse à sa section', () => {
    expect(sectionOf('/').key).toBe('home');
    expect(sectionOf('/alertes').key).toBe('home');
    expect(sectionOf('/reservations/r-1/contrat').key).toBe('reservations');
    expect(sectionOf('/demandes').key).toBe('reservations');
    expect(sectionOf('/depenses').key).toBe('fleet');
    expect(sectionOf('/factures/abc').key).toBe('finances');
    expect(sectionOf('/equipe').key).toBe('settings');
    expect(sectionOf('/inconnue').key).toBe('home');
  });
  it('montre les onglets selon le profil', () => {
    const fin = SECTIONS.find((s) => s.key === 'finances')!;
    expect(visibleTabs(fin, 'agent').map((t) => t.label)).toEqual(['Factures']);
    expect(visibleTabs(fin, 'comptable').map((t) => t.label)).toEqual(['Factures', 'Rapports', 'Rentabilité']);
    expect(visibleTabs(fin, 'mecanicien')).toEqual([]);
    expect(visibleTabs(fin, 'admin')).toHaveLength(3);
  });
  it('garde huit sections', () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(['Accueil', 'Planning', 'Réservations', 'Flotte', 'Clients', 'Finances', 'Chauffeurs VTC', 'Paramètres']);
    expect(sectionOf('/vtc/abc').key).toBe('vtc');
  });
});
