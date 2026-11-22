import { billingSettings, buildInvoice, nextInvoiceNumber, type Invoice } from '../domain/billing';
import type { Client, Expense, Incident, Maintenance, Payment, Rate, Reservation, Tables, Vehicle } from '../domain/types';

// Données d'exemple, recalées sur la date du jour pour que la démo soit toujours parlante.

type Db = { [K in keyof Tables]: Tables[K][] };

function at(base: Date, dayOffset: number, hour: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function day(base: Date, dayOffset: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

export function seed(now = new Date()): Db {
  const rates: Rate[] = [
    { id: 'rt-cit', category: 'Citadine', daily: 25000, weekly: 22000, monthly: 18000, driverDaily: 10000, kmPerDay: 250, extraKm: 100, caution: 150000 },
    { id: 'rt-ber', category: 'Berline', daily: 35000, weekly: 31000, monthly: 25000, driverDaily: 12000, kmPerDay: 250, extraKm: 120, caution: 200000 },
    { id: 'rt-suv', category: 'SUV', daily: 45000, weekly: 40000, monthly: 32000, driverDaily: 15000, kmPerDay: 250, extraKm: 150, caution: 300000 },
    { id: 'rt-4x4', category: '4x4', daily: 60000, weekly: 54000, monthly: 45000, driverDaily: 15000, kmPerDay: 250, extraKm: 200, caution: 400000 },
    { id: 'rt-mini', category: 'Minibus', daily: 75000, weekly: 68000, monthly: 55000, driverDaily: 20000, kmPerDay: 300, extraKm: 200, caution: 400000 },
  ];

  const v = (id: string, plate: string, brand: string, model: string, category: string, mileage: number, extra: Partial<Vehicle> = {}): Vehicle => ({
    id, plate, brand, model, category, mileage, year: 2022, fuel: 'diesel', outOfService: false,
    insuranceExpiry: day(now, 200), inspectionExpiry: day(now, 150), vignetteExpiry: day(now, 300), ...extra,
  });
  const vehicles: Vehicle[] = [
    v('v-hilux', 'DK-2210-AB', 'Toyota', 'Hilux', '4x4', 61200),
    v('v-tucson', 'DK-4521-BC', 'Hyundai', 'Tucson', 'SUV', 44210),
    v('v-prado', 'DK-7788-AF', 'Toyota', 'Prado', '4x4', 52800, { insuranceExpiry: day(now, 7) }),
    v('v-dzire', 'DK-3305-BD', 'Suzuki', 'Dzire', 'Berline', 23900, { fuel: 'essence' }),
    v('v-hiace', 'DK-9012-AE', 'Toyota', 'Hiace', 'Minibus', 88100),
    v('v-lc', 'DK-6610-AA', 'Toyota', 'Land Cruiser', '4x4', 97400, { inspectionExpiry: day(now, -3) }),
    v('v-picanto', 'DK-1188-BE', 'Kia', 'Picanto', 'Citadine', 15300, { fuel: 'essence' }),
  ];

  const c = (id: string, name: string, phone: string, extra: Partial<Client> = {}): Client => ({
    id, name, phone, kind: 'particulier', email: null, idNumber: null, licenseExpiry: day(now, 900), score: 'fiable', ...extra,
  });
  const clients: Client[] = [
    c('c-baobab', 'Baobab Logistique', '+221 33 800 00 01', { kind: 'entreprise', licenseExpiry: null, email: 'compta@baobab-logistique.sn', address: 'Zone industrielle, km 4,5 Bd du Centenaire', city: 'Dakar', taxId: '005871234 2G3', tradeRegister: 'SN-DKR-2016-B-11234', contactName: 'Moussa Sarr', contactRole: 'Responsable logistique', contactPhone: '+221 77 640 12 12', contactEmail: 'm.sarr@baobab-logistique.sn' }),
    c('c-diop', 'Aïssatou Diop', '+221 77 000 00 02', {
      idType: 'cni', idNumber: '1 754 1992 01234', idExpiry: day(now, 1400), birthDate: '1992-04-17', licenseNumber: 'SN-DK-2014-08812', licenseCategory: 'B',
      documents: { idFront: demoDoc('CNI recto'), idBack: demoDoc('CNI verso'), license: demoDoc('Permis'), selfie: demoDoc('Photo') },
      verifiedAt: at(now, -40, 10), verifiedBy: 'agent@sdt.sn',
    }),
    c('c-teranga', 'Mission Teranga Tours', '+221 33 800 00 03', { kind: 'entreprise', licenseExpiry: null, address: 'Avenue Cheikh Anta Diop', city: 'Dakar', taxId: '006120987 2V2', tradeRegister: 'SN-DKR-2019-B-04521', contactName: 'Fatou Diallo', contactRole: 'Directrice des opérations', contactPhone: '+221 78 110 45 45' }),
    c('c-ndiaye', 'Moussa Ndiaye', '+221 76 000 00 04'),
    c('c-fall', 'Ousmane Fall', '+221 78 000 00 05', { score: 'surveiller', scoreReason: 'Deux retours en retard et une rayure non signalée', idType: 'cni', idNumber: '1 761 1988 04411', licenseNumber: 'SN-TH-2010-02231', licenseExpiry: day(now, -12) }),
    c('c-sante', 'ONG Santé Plus', '+221 33 800 00 06', { kind: 'entreprise', licenseExpiry: null, address: 'Sacré-Cœur 3, villa 9012', city: 'Dakar', contactName: 'Dr Aminata Kane', contactRole: 'Coordinatrice', contactPhone: '+221 76 300 88 21' }),
  ];

  const year = now.getFullYear();
  let n = 0;
  const r = (vehicleId: string, clientId: string, s: [number, number], e: [number, number], status: Reservation['status'], dailyRate: number, caution: number): Reservation => {
    const start = at(now, s[0], s[1]);
    const end = at(now, e[0], e[1]);
    const days = Math.max(1, Math.ceil((Date.parse(end) - Date.parse(start)) / 86400000));
    n += 1;
    return {
      id: `r-${n}`, number: `CT-${year}-${String(400 + n).padStart(4, '0')}`, vehicleId, clientId, start, end,
      withDriver: false, status, dailyRate, total: days * dailyRate, caution, fees: 0, mileageOut: status === 'en_cours' ? (vehicles.find((x) => x.id === vehicleId)?.mileage ?? null) : null, mileageIn: null, notes: null, createdAt: at(now, s[0] - 2, 9),
    };
  };
  const reservations: Reservation[] = [
    r('v-hilux', 'c-baobab', [-6, 9], [-1, 18], 'en_cours', 60000, 400000),
    r('v-tucson', 'c-diop', [-3, 12], [0, 12], 'en_cours', 45000, 300000),
    r('v-prado', 'c-teranga', [-4, 8], [0, 17], 'en_cours', 60000, 400000),
    r('v-dzire', 'c-ndiaye', [-2, 10], [2, 10], 'en_cours', 35000, 200000),
    r('v-hiace', 'c-baobab', [-1, 8], [3, 8], 'en_cours', 75000, 400000),
    r('v-tucson', 'c-fall', [4, 9], [7, 18], 'reservee', 45000, 300000),
    r('v-hiace', 'c-sante', [5, 8], [9, 18], 'reservee', 75000, 400000),
    r('v-lc', 'c-diop', [3, 9], [6, 18], 'reservee', 60000, 400000),
    r('v-picanto', 'c-ndiaye', [1, 9], [2, 18], 'reservee', 25000, 150000),
  ];

  const p = (reservationId: string, kind: Payment['kind'], amount: number, method: Payment['method'], status: Payment['status'] = 'paye'): Payment => ({
    id: `p-${reservationId}-${kind}`, reservationId, kind, amount, method, status,
    paidAt: status === 'paye' ? at(now, -3, 11) : null, createdAt: at(now, -3, 11),
  });
  const payments: Payment[] = [];
  for (const res of reservations) {
    payments.push(p(res.id, 'acompte', Math.round(res.total / 2), res.id === 'r-1' ? 'virement' : 'wave'));
    if (res.status === 'en_cours') payments.push(p(res.id, 'caution', res.caution, 'orange_money'));
  }
  payments.push(p('r-2', 'solde', reservations[1].total - Math.round(reservations[1].total / 2), 'wave', 'en_attente'));

  const maintenances: Maintenance[] = [
    { id: 'm-1', vehicleId: 'v-lc', label: 'Freins · garage', start: at(now, -4, 8), end: at(now, -1, 18), cost: 185000 },
    { id: 'm-2', vehicleId: 'v-tucson', label: 'Vidange', start: at(now, 1, 8), end: at(now, 1, 18), cost: 45000 },
  ];

  return { rates, vehicles, clients, reservations, payments, maintenances, expenses: seedExpenses(now), invoices: seedInvoices({ rates, vehicles, clients, reservations }, now), inspections: [], incidents: seedIncidents(now) };
}

/** Factures des réservations d'exemple, numérotées dans l'ordre de création. */
export function seedInvoices(db: { rates: Rate[]; vehicles: Vehicle[]; clients: Client[]; reservations: Reservation[] }, now = new Date()): Invoice[] {
  const s = billingSettings('Sénégal Découverte Touristique', null);
  const out: Invoice[] = [];
  for (const r of [...db.reservations].sort((a, b) => a.start.localeCompare(b.start))) {
    const c = db.clients.find((x) => x.id === r.clientId);
    if (!c) continue;
    const v = db.vehicles.find((x) => x.id === r.vehicleId);
    const issueAt = new Date(Math.min(Date.parse(r.start) - 2 * 86400000, now.getTime()));
    const inv = buildInvoice(r, c, v, db.rates.find((x) => x.category === v?.category), s, issueAt);
    out.push({ ...inv, id: `inv-${r.id}`, number: nextInvoiceNumber(out.map((i) => i.number), 'FA', issueAt.getFullYear()) });
  }
  return out;
}

/** Quelques dépenses sur les trois derniers mois, pour des rapports parlants. */
export function seedExpenses(now = new Date()): Expense[] {
  const e = (id: string, vehicleId: string, d: number, kind: Expense['kind'], amount: number, label: string | null, mileage: number | null = null): Expense => ({
    id, vehicleId, date: day(now, d), kind, amount, label, mileage, reservationId: null,
  });
  return [
    e('e-1', 'v-hilux', -5, 'carburant', 52000, 'Plein gasoil, Total Ngor', 61050),
    e('e-2', 'v-hiace', -2, 'carburant', 68000, 'Plein gasoil', 88020),
    e('e-3', 'v-prado', -9, 'pneus', 340000, '4 pneus Bridgestone', 52400),
    e('e-4', 'v-dzire', -12, 'lavage', 5000, null),
    e('e-5', 'v-lc', -20, 'reparation', 95000, 'Alternateur', 97100),
    e('e-6', 'v-tucson', -15, 'amende', 15000, 'Stationnement Plateau'),
    e('e-7', 'v-hilux', -33, 'pieces', 48000, 'Plaquettes avant'),
    e('e-8', 'v-picanto', -40, 'carburant', 25000, 'Plein super', 15100),
    e('e-9', 'v-hiace', -45, 'peage', 7000, 'Autoroute Dakar-AIBD aller-retour'),
    e('e-10', 'v-prado', -60, 'taxes', 60000, 'Vignette'),
  ];
}

/** Image d'exemple pour les pièces des clients en démo. */
function demoDoc(label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" rx="24" fill="#e2dacb"/><rect x="32" y="32" width="150" height="190" rx="12" fill="#0b3c5d" opacity=".25"/><rect x="210" y="60" width="360" height="22" rx="6" fill="#0b3c5d" opacity=".3"/><rect x="210" y="110" width="280" height="22" rx="6" fill="#0b3c5d" opacity=".2"/><rect x="210" y="160" width="320" height="22" rx="6" fill="#0b3c5d" opacity=".2"/><text x="32" y="340" font-family="sans-serif" font-size="40" font-weight="700" fill="#0b3c5d">${label} · exemple</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function seedIncidents(now = new Date()): Incident[] {
  const d = (n: number) => day(now, n);
  return [
    { id: 'inc-1', clientId: 'c-fall', reservationId: null, kind: 'retard', severity: 'mineur', occurredOn: d(-95), amount: 25000, note: 'Retour avec 5 heures de retard, sans prévenir.', createdBy: 'agent@sdt.sn', createdAt: at(now, -95, 18) },
    { id: 'inc-2', clientId: 'c-fall', reservationId: null, kind: 'dommage', severity: 'mineur', occurredOn: d(-60), amount: 40000, note: 'Rayure portière arrière droite, non signalée au retour.', createdBy: 'agent@sdt.sn', createdAt: at(now, -60, 17) },
  ];
}
