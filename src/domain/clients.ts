// Fiche client : particulier ou entreprise.

import type { Client, ClientKind } from './types';

export type ClientInput = Omit<Client, 'id'>;

export function emptyClient(kind: ClientKind = 'particulier'): ClientInput {
  return {
    kind, name: '', phone: '', email: null, idNumber: null, licenseExpiry: null, score: 'fiable',
    address: null, city: null, taxId: null, tradeRegister: null,
    contactName: null, contactRole: null, contactPhone: null, contactEmail: null,
    depositPercent: null, dueDays: null,
  };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const phoneOk = (p: string) => {
  const d = p.replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15;
};

/** Contrôles de la fiche ; renvoie le message d'erreur ou null. */
export function validateClient(c: ClientInput): string | null {
  const company = c.kind === 'entreprise';
  if (c.name.trim().length < 2) return company ? 'Indiquez la raison sociale.' : 'Indiquez le nom du client.';
  if (!phoneOk(c.phone)) return company ? 'Indiquez le téléphone de l’entreprise.' : 'Indiquez un numéro de téléphone valide.';
  if (c.email && !EMAIL_RE.test(c.email.trim())) return 'Adresse email invalide.';
  if (company) {
    if (!c.address?.trim()) return 'Indiquez l’adresse de l’entreprise.';
    if (!c.contactName?.trim()) return 'Indiquez la personne de contact.';
    if (!c.contactPhone || !phoneOk(c.contactPhone)) return 'Indiquez le téléphone de la personne de contact.';
    if (c.contactEmail && !EMAIL_RE.test(c.contactEmail.trim())) return 'Email de la personne de contact invalide.';
  }
  return null;
}

/** Nettoie la fiche avant enregistrement : espaces, champs vides, champs sans objet pour un particulier. */
export function normalizeClient(c: ClientInput): ClientInput {
  const t = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const company = c.kind === 'entreprise';
  return {
    ...c,
    name: c.name.trim(),
    phone: c.phone.trim(),
    email: t(c.email),
    idNumber: t(c.idNumber),
    address: t(c.address),
    city: t(c.city),
    taxId: company ? t(c.taxId) : null,
    tradeRegister: company ? t(c.tradeRegister) : null,
    contactName: company ? t(c.contactName) : null,
    contactRole: company ? t(c.contactRole) : null,
    contactPhone: company ? t(c.contactPhone) : null,
    contactEmail: company ? t(c.contactEmail) : null,
    depositPercent: c.depositPercent ?? null,
    dueDays: c.dueDays ?? null,
  };
}

/** Une ligne d'identification légale : « NINEA … · RCCM … ». */
export function legalLine(c: Pick<Client, 'taxId' | 'tradeRegister'>, taxLabel = 'NINEA'): string {
  return [c.taxId && `${taxLabel} ${c.taxId}`, c.tradeRegister && `RCCM ${c.tradeRegister}`].filter(Boolean).join(' · ');
}

/** Nom de l'identifiant fiscal selon le pays de l'entreprise loueuse. */
export function taxIdLabel(country: string): string {
  if (country === 'SN') return 'NINEA';
  if (country === 'CI') return 'NCC';
  if (country === 'BJ' || country === 'BF') return 'IFU';
  if (country === 'CM') return 'NIU';
  return 'NIF';
}
