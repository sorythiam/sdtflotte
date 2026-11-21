import { describe, expect, it } from 'vitest';
import {
  billingSettings, buildCreditNote, buildFeesInvoice, buildInvoice, DEFAULT_BILLING, nextInvoiceNumber, payeeLines, payState, termsFor,
  type Invoice,
} from './billing';
import type { Client, Payment, Rate, Reservation, Vehicle } from './types';

const NOW = new Date('2026-11-21T10:00:00Z');
const client = (p: Partial<Client> = {}): Client => ({
  id: 'c1', kind: 'particulier', name: 'Awa Ndiaye', phone: '77 123 45 67', email: null, idNumber: null, licenseExpiry: null, score: 'fiable', ...p,
});
const res: Reservation = {
  id: 'r1', number: 'CT-2026-0001', vehicleId: 'v1', clientId: 'c1', start: '2026-11-25T09:00:00Z', end: '2026-11-28T09:00:00Z',
  withDriver: true, status: 'reservee', dailyRate: 70000, total: 210000, caution: 300000, fees: 0, mileageOut: null, mileageIn: null, notes: null, createdAt: '',
};
const vehicle = { id: 'v1', brand: 'Toyota', model: 'Hilux', plate: 'DK-1' } as Vehicle;
const rate = { category: '4x4', driverDaily: 10000 } as Rate;
const pay = (kind: Payment['kind'], amount: number, method: Payment['method'] = 'wave'): Payment => ({
  id: kind + amount, reservationId: 'r1', kind, amount, method, status: 'paye', paidAt: NOW.toISOString(), createdAt: '',
});
const issued = (n: ReturnType<typeof buildInvoice>, id: string, number: string): Invoice => ({ ...n, id, number });

describe('modalités', () => {
  const s = billingSettings('SDT', { payees: { wave: '77 000 00 01' } as never });
  it('applique les réglages de l’entreprise ou du client', () => {
    expect(termsFor(s, client()).label).toBe('Acompte de 50 % à la réservation, solde à la remise des clés');
    expect(termsFor(s, client({ kind: 'entreprise' })).label).toBe('Acompte de 50 % à la réservation, solde à 30 jours date de facture');
    expect(termsFor(s, client({ kind: 'entreprise', depositPercent: 0, dueDays: 45 })).label).toBe('Paiement à 45 jours date de facture');
    expect(termsFor({ ...s, balanceWhen: 'retour', depositPercent: 0 }, client()).label).toBe('Paiement au retour du véhicule');
  });
  it('liste les moyens de paiement renseignés, chèque à l’ordre du loueur par défaut', () => {
    expect(payeeLines(s.payees)).toEqual(['Wave : 77 000 00 01', 'Chèque à l’ordre de SDT']);
  });
});

describe('factures', () => {
  it('sépare location et chauffeur, calcule la TVA et l’acompte', () => {
    const inv = buildInvoice(res, client(), vehicle, rate, billingSettings('SDT', { vatEnabled: true }), NOW);
    expect(inv.lines.map((l) => [l.quantity, l.unitPrice, l.amount])).toEqual([[3, 60000, 180000], [3, 10000, 30000]]);
    expect([inv.totalHt, inv.vat, inv.totalTtc, inv.depositDue]).toEqual([210000, 37800, 247800, 123900]);
    expect(inv.dueDate).toBe('2026-11-25');
    expect(inv.billTo.name).toBe('Awa Ndiaye');
  });
  it('sans TVA, le TTC vaut le HT ; une entreprise a son délai', () => {
    const inv = buildInvoice(res, client({ kind: 'entreprise' }), vehicle, rate, DEFAULT_BILLING, NOW);
    expect([inv.vat, inv.totalTtc]).toEqual([0, 210000]);
    expect(inv.dueDate).toBe('2026-12-21');
  });
  it('crée frais complémentaires et avoir', () => {
    const fees = buildFeesInvoice({ ...res, fees: 15000 }, client(), DEFAULT_BILLING, NOW, 'carburant');
    expect([fees.kind, fees.totalTtc, fees.lines[0].label]).toEqual(['complement', 15000, 'Frais constatés au retour, contrat CT-2026-0001 : carburant']);
    const inv = issued(buildInvoice(res, client(), vehicle, rate, DEFAULT_BILLING, NOW), 'i1', 'FA-2026-0001');
    const av = buildCreditNote(inv, NOW);
    expect([av.kind, av.totalTtc, av.relatedInvoiceId, av.terms]).toEqual(['avoir', -210000, 'i1', 'Avoir sur la facture FA-2026-0001']);
  });
  it('numérote sans trou, par préfixe et par année', () => {
    expect(nextInvoiceNumber(['FA-2026-0001', 'FA-2026-0002', 'AV-2026-0001', 'FA-2025-0009'], 'FA', 2026)).toBe('FA-2026-0003');
    expect(nextInvoiceNumber([], 'AV', 2027)).toBe('AV-2027-0001');
  });
});

describe('suivi des paiements', () => {
  const inv = issued(buildInvoice(res, client(), vehicle, rate, DEFAULT_BILLING, NOW), 'i1', 'FA-2026-0001');
  it('passe de non payée à acompte puis payée, la caution ne compte pas', () => {
    expect(payState(res, [inv], [pay('caution', 300000)], NOW)).toMatchObject({ status: 'non_payee', owed: 210000, depositMissing: 105000 });
    expect(payState(res, [inv], [pay('acompte', 105000)], NOW)).toMatchObject({ status: 'acompte', remaining: 105000, depositMissing: 0 });
    expect(payState(res, [inv], [pay('acompte', 105000), pay('solde', 105000, 'cheque')], NOW).status).toBe('payee');
  });
  it('signale le retard après l’échéance et la facture complémentaire', () => {
    const later = new Date('2026-11-26T10:00:00Z');
    const fees = issued(buildFeesInvoice({ ...res, fees: 15000 }, client(), DEFAULT_BILLING, later), 'i2', 'FA-2026-0002');
    const s = payState({ ...res, fees: 15000 }, [inv, fees], [pay('acompte', 105000)], later);
    expect(s).toMatchObject({ status: 'en_retard', owed: 225000, remaining: 120000, dueDate: '2026-11-25' });
  });
  it('annulée par avoir ; trop-perçu si un acompte avait été versé', () => {
    const av = issued(buildCreditNote(inv, NOW), 'a1', 'AV-2026-0001');
    const cancelled = { ...res, status: 'annulee' as const };
    expect(payState(cancelled, [inv, av], [], NOW).status).toBe('annulee');
    expect(payState(cancelled, [inv, av], [pay('acompte', 105000)], NOW).status).toBe('trop_percu');
  });
  it('sans facture (ancienne réservation), le montant de la réservation sert de base', () => {
    expect(payState(res, [], [pay('acompte', 10000)], NOW)).toMatchObject({ owed: 210000, status: 'acompte' });
  });
});

describe('trop-perçu', () => {
  it('le remboursement solde le trop-perçu après un avoir', () => {
    const inv = { ...buildInvoice(res, client(), vehicle, rate, DEFAULT_BILLING, NOW), id: 'i1', number: 'FA-2026-0001' };
    const av = { ...buildCreditNote(inv, NOW), id: 'a1', number: 'AV-2026-0001' };
    const cancelled = { ...res, status: 'annulee' as const };
    const back = { ...pay('acompte', 105000), id: 'back', kind: 'remboursement' as const };
    expect(payState(cancelled, [inv, av], [pay('acompte', 105000), back], NOW).status).toBe('annulee');
  });
});
