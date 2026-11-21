// Modèle métier de Yoon Fleet. Les noms suivent le vocabulaire des loueurs.

export type Plan = 'essentiel' | 'pro' | 'entreprise';
export type Role = 'admin' | 'direction' | 'agent' | 'comptable' | 'mecanicien';

export interface Organization {
  id: string;
  name: string;
  country: string; // code ISO, ex. SN
  currency: string; // ex. XOF
  plan: Plan;
  vehicleQuota: number;
  trialEndsAt: string | null; // ISO
}

export type VehicleStatus = 'disponible' | 'loue' | 'maintenance' | 'hors_service';
export type Fuel = 'essence' | 'diesel' | 'hybride' | 'electrique';

export interface Vehicle {
  id: string;
  plate: string;
  brand: string;
  model: string;
  year: number | null;
  category: string;
  fuel: Fuel;
  mileage: number;
  outOfService: boolean;
  insuranceExpiry: string | null; // AAAA-MM-JJ
  inspectionExpiry: string | null;
  vignetteExpiry: string | null;
}

export interface Rate {
  id: string;
  category: string;
  daily: number; // 1 à 6 jours
  weekly: number; // prix par jour, 7 à 29 jours
  monthly: number; // prix par jour, 30 jours et plus
  driverDaily: number; // supplément chauffeur par jour
  kmPerDay: number; // kilomètres inclus par jour
  extraKm: number; // prix du km supplémentaire
  caution: number;
}

export type ClientKind = 'particulier' | 'entreprise';
export type ClientScore = 'fiable' | 'surveiller' | 'blacklist';

export interface Client {
  id: string;
  kind: ClientKind;
  name: string;
  phone: string;
  email: string | null;
  idNumber: string | null;
  licenseExpiry: string | null;
  score: ClientScore;
}

export type ReservationStatus = 'reservee' | 'en_cours' | 'terminee' | 'annulee';

export interface Reservation {
  id: string;
  number: string; // CT-2026-0001
  vehicleId: string;
  clientId: string;
  start: string; // ISO date-heure
  end: string;
  withDriver: boolean;
  status: ReservationStatus;
  dailyRate: number;
  total: number;
  caution: number;
  fees: number; // frais constatés au retour : km, carburant, dégâts, retard
  mileageOut: number | null;
  mileageIn: number | null;
  notes: string | null;
  createdAt: string;
}

export type PaymentKind = 'acompte' | 'solde' | 'caution' | 'frais' | 'remboursement_caution';
export type PaymentMethod =
  | 'especes'
  | 'wave'
  | 'orange_money'
  | 'free_money'
  | 'mtn'
  | 'moov'
  | 'carte'
  | 'virement';
export type PaymentStatus = 'paye' | 'en_attente' | 'echoue';

export interface Payment {
  id: string;
  reservationId: string;
  kind: PaymentKind;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: string | null;
  createdAt: string;
}

export interface Maintenance {
  id: string;
  vehicleId: string;
  label: string;
  start: string;
  end: string;
  cost: number;
}

export interface Tables {
  vehicles: Vehicle;
  clients: Client;
  rates: Rate;
  reservations: Reservation;
  payments: Payment;
  maintenances: Maintenance;
}
export type TableName = keyof Tables;

export interface Member {
  userId: string;
  email: string;
  role: Role;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  token: string;
  createdAt: string;
  expiresAt: string;
}
