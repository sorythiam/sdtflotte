import { describe, expect, it } from 'vitest';
import { parseClients, parseCsv, parseDate, parseInteger, parseVehicles, type Cell } from './importer';

const ctx = { categories: ['Citadine', 'SUV', '4x4'], existingPlates: ['DK-2210-AB'], quota: 10, activeCount: 2 };

describe('dates et nombres', () => {
  it('lit les formats courants', () => {
    expect(parseDate('31/12/2026')).toBe('2026-12-31');
    expect(parseDate('1-2-2027')).toBe('2027-02-01');
    expect(parseDate('2026-06-30')).toBe('2026-06-30');
    expect(parseDate(46387)).toBe('2026-12-31'); // numéro de série Excel
    expect(parseDate(new Date(Date.UTC(2026, 5, 30)))).toBe('2026-06-30');
    expect(parseDate('')).toBeNull();
    expect(parseDate('31/02/2026')).toBe('invalid');
    expect(parseDate('demain')).toBe('invalid');
  });
  it('lit les kilométrages avec espaces et unité', () => {
    expect(parseInteger('45 000 km')).toBe(45000);
    expect(parseInteger('45.000')).toBe(45000);
    expect(parseInteger(12000.4)).toBe(12000);
    expect(parseInteger('beaucoup')).toBe('invalid');
  });
});

describe('import de véhicules', () => {
  const sheet: Cell[][] = [
    ['Immat', 'Marque', 'Modèle', 'Catégorie', 'Année', 'Carburant', 'Km', 'Assurance', 'Visite technique'],
    ['dk 4521 bc', 'Hyundai', 'Tucson', 'suv', 2022, 'Gasoil', '44 210', '31/12/2026', '30/06/2026'],
    ['DK-2210-AB', 'Toyota', 'Hilux', '4x4', 2021, 'diesel', 61000, '', ''],
    ['DK-1188-BE', 'Kia', 'Picanto', 'Citadine', 2023, 'Essence', 15000, '', ''],
    ['DK-1188-BE', 'Kia', 'Picanto', 'Citadine', 2023, 'Essence', 15000, '', ''],
    ['DK-9999-ZZ', 'Toyota', '', 'Camion', 'vieux', 'charbon', -5, '45/13/2026', ''],
    ['', '', '', '', '', '', '', '', ''],
  ];
  const r = parseVehicles(sheet, ctx);
  it('reconnaît des en-têtes variés et normalise les valeurs', () => {
    expect(r.missingColumns).toEqual([]);
    expect(r.rows[0]).toMatchObject({ plate: 'DK-4521-BC', category: 'SUV', fuel: 'diesel', mileage: 44210, insuranceExpiry: '2026-12-31', inspectionExpiry: '2026-06-30' });
    expect(r.rows.map((v) => v.plate)).toEqual(['DK-4521-BC', 'DK-1188-BE']);
  });
  it('ignore les plaques déjà connues ou en double', () => {
    expect(r.skipped.map((s) => s.line)).toEqual([3, 5]);
  });
  it('rejette une ligne fausse avec toutes ses raisons, numéro de ligne Excel', () => {
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(6);
    expect(r.errors[0].message).toMatch(/modèle manquant/);
    expect(r.errors[0].message).toMatch(/catégorie « Camion » inconnue/);
    expect(r.errors[0].message).toMatch(/année invalide/);
    expect(r.errors[0].message).toMatch(/carburant « charbon »/);
    expect(r.errors[0].message).toMatch(/kilométrage invalide/);
    expect(r.errors[0].message).toMatch(/45\/13\/2026/);
  });
  it('signale les colonnes obligatoires absentes', () => {
    expect(parseVehicles([['Marque', 'Modèle']], ctx).missingColumns).toEqual(['Immatriculation', 'Catégorie']);
  });
  it('respecte le quota de la formule', () => {
    const many: Cell[][] = [['Immatriculation', 'Marque', 'Modèle', 'Catégorie']];
    for (let i = 0; i < 6; i++) many.push([`DK-${i}`, 'Kia', 'Rio', 'Citadine']);
    const q = parseVehicles(many, { ...ctx, quota: 5, activeCount: 2 });
    expect(q.rows).toHaveLength(3);
    expect(q.errors[0].message).toMatch(/Quota de votre formule : 5 véhicules. 3 véhicule\(s\) en trop/);
  });
});

describe('import de clients', () => {
  const sheet: Cell[][] = [
    ['Nom', 'Téléphone', 'Type', 'Email', 'CNI', 'Permis', 'Statut'],
    ['Aïssatou Diop', '77 000 00 02', 'Particulier', 'AISSATOU@exemple.sn', '123', '15/03/2029', ''],
    ['Baobab Logistique', '+221 33 800 00 01', 'Société', '', '', '', 'Fiable'],
    ['Doublon fichier', '770000002', '', '', '', '', ''],
    ['Ousmane Fall', '78 000 00 05', 'particulier', 'pas-un-mail', '', '2029', 'peut-être'],
  ];
  const r = parseClients(sheet, { existingPhones: ['+221 33 800 00 01'] });
  it('importe les clients valides', () => {
    expect(r.rows).toEqual([
      { name: 'Aïssatou Diop', phone: '77 000 00 02', kind: 'particulier', email: 'aissatou@exemple.sn', idNumber: '123', licenseExpiry: '2029-03-15', score: 'fiable', address: null, city: null },
    ]);
  });
  it('lit les champs entreprise', () => {
    const sheet = [
      ['Nom ou raison sociale', 'Téléphone', 'Type', 'Adresse', 'Ville', 'NINEA', 'RCCM', 'Personne de contact', 'Téléphone du contact'],
      ['Baobab Logistique', '33 800 00 01', 'Entreprise', 'Zone industrielle', 'Dakar', '005871234', 'SN-DKR-2016-B-1', 'Moussa Sarr', '77 640 12 12'],
    ];
    expect(parseClients(sheet, { existingPhones: [] }).rows[0]).toMatchObject({
      kind: 'entreprise', address: 'Zone industrielle', city: 'Dakar', taxId: '005871234', tradeRegister: 'SN-DKR-2016-B-1',
      contactName: 'Moussa Sarr', contactPhone: '77 640 12 12',
    });
  });
  it('ignore les clients déjà connus par leur numéro, indicatif ou pas', () => {
    expect(r.skipped.map((s) => s.line)).toEqual([3, 4]);
  });
  it('rejette les valeurs invalides', () => {
    expect(r.errors[0].line).toBe(5);
    expect(r.errors[0].message).toMatch(/email « pas-un-mail » invalide/);
    expect(r.errors[0].message).toMatch(/scoring « peut-être » inconnu/);
  });
});

describe('CSV', () => {
  it('lit un CSV Excel français avec point-virgule et guillemets', () => {
    expect(parseCsv('﻿Nom;Téléphone\r\n"Diop; Aïssatou";77 000 00 02\r\n"Dit ""Ablaye""";78\r\n')).toEqual([
      ['Nom', 'Téléphone'],
      ['Diop; Aïssatou', '77 000 00 02'],
      ['Dit "Ablaye"', '78'],
    ]);
  });
});
