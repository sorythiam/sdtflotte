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
  /** Fin de la période payée ; null tant qu'aucun paiement n'a été fait. */
  paidUntil?: string | null;
  billingCycle?: 'annuel' | 'mensuel' | null;
  /** Module Chauffeurs VTC payé jusqu'à cette date ; null = jamais acheté. */
  vtcUntil?: string | null;
  /** Coordonnées, logo et conditions générales du contrat. */
  contract?: Partial<import('./contract').ContractSettings> | null;
  /** Modalités de paiement, TVA et moyens d'encaissement. */
  billing?: Partial<import('./billing').BillingSettings> | null;
  /** Page publique de réservation : /r/<bookingSlug>. */
  bookingSlug?: string | null;
  bookingEnabled?: boolean;
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
  /** Adresses des photos, la première sert de couverture (8 au plus). */
  photos?: string[];
  seats?: number | null; // places assises, chauffeur compris
  luggage?: number | null; // bagages
  driverRequired?: boolean; // bus, minibus : toujours loué avec chauffeur
  vin?: string | null; // numéro de châssis
  documents?: VehicleDocuments; // scans dans l'espace privé
  createdAt?: string; // entrée dans la flotte (rempli par la base)
}

export type VehicleDocSlot = 'carteGrise' | 'assurance' | 'visiteTechnique' | 'autre';
export type VehicleDocuments = Partial<Record<VehicleDocSlot, string>>;

export interface Driver {
  id: string;
  name: string;
  phone: string;
  licenseNumber: string | null;
  licenseCategory: string | null;
  licenseExpiry: string | null;
  active: boolean;
  notes: string | null;
  createdAt: string;
}

/** Forfait à prix fixe (transfert, excursion), toujours avec chauffeur. */
export interface Package {
  id: string;
  label: string;
  category: string;
  price: number;
  hours: number;
  active: boolean;
  createdAt: string;
}

/** Avenant : changement de dates ou de prix d'un contrat. */
export interface ReservationChange {
  id: string;
  reservationId: string;
  oldStart: string;
  oldEnd: string;
  newStart: string;
  newEnd: string;
  oldTotal: number;
  newTotal: number;
  reason: string | null;
  changedBy: string | null;
  createdAt: string;
}

/** Saison tarifaire : majoration (haute saison, fêtes) ou remise (basse saison) en % sur la location. */
export interface Season {
  id: string;
  label: string;
  startDate: string; // AAAA-MM-JJ
  endDate: string; // AAAA-MM-JJ, incluse
  recurring: boolean; // se répète chaque année aux mêmes jours
  percent: number; // +20 = majoration de 20 %, -10 = remise de 10 %
  active: boolean;
  createdAt: string;
}

export type QuoteStatus = 'envoye' | 'accepte' | 'refuse' | 'converti';

/** Devis : une proposition chiffrée, sans bloquer de véhicule tant qu'elle n'est pas transformée. */
export interface Quote {
  id: string;
  number: string; // DV-2026-0001
  clientId: string;
  category: string;
  quantity: number; // nombre de véhicules identiques
  formula: Formula;
  packageId: string | null;
  packageLabel: string | null;
  start: string;
  end: string;
  withDriver: boolean;
  passengers: number | null;
  missionFees: number; // par véhicule
  fuelIncluded: boolean;
  itinerary: string | null;
  crossBorder: string | null;
  unitTotal: number; // prix d'un véhicule, hors taxes
  total: number; // unitTotal × quantité, hors taxes
  caution: number; // par véhicule
  detail: QuoteDetail;
  validUntil: string; // AAAA-MM-JJ
  status: QuoteStatus;
  reservationIds: string[];
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface QuoteDetail {
  days: number;
  rental: number;
  driver: number;
  kmIncluded: number | null;
  seasonNote: string | null;
  dealNote: string | null;
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
  halfDay?: number; // prix de la demi-journée, 0 = non proposé
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
  licenseExpiry: string | null; // permis du client, ou du conducteur pour une entreprise
  score: ClientScore;
  // Adresse (tous les clients)
  address?: string | null;
  city?: string | null;
  // Entreprise : identifiants légaux et personne de contact
  taxId?: string | null; // NINEA, IFU, NIF… selon le pays
  tradeRegister?: string | null; // RCCM
  contactName?: string | null;
  contactRole?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  // Modalités propres à ce client (vide = celles de l'entreprise)
  depositPercent?: number | null;
  dueDays?: number | null;
  // Vérification : pièce d'identité, permis, photos (espace privé), validation par un agent
  idType?: IdType | null;
  idExpiry?: string | null;
  birthDate?: string | null;
  licenseNumber?: string | null;
  licenseCategory?: string | null;
  documents?: ClientDocuments;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  scoreReason?: string | null; // motif d'un client à surveiller ou blacklisté
  // Contrat cadre (entreprises surtout) : remise en %, ou prix par jour négociés par catégorie
  dealDiscount?: number;
  dealRates?: Record<string, number>;
  dealTerms?: string | null;
  dealUntil?: string | null;
}

export type IdType = 'cni' | 'passeport' | 'carte_cedeao' | 'carte_sejour' | 'autre';
export type DocSlot = 'idFront' | 'idBack' | 'license' | 'selfie';
export type ClientDocuments = Partial<Record<DocSlot, string>>; // chemins dans l'espace privé

export type IncidentKind = 'retard' | 'dommage' | 'impaye' | 'accident' | 'amende' | 'comportement' | 'autre';
export interface Incident {
  id: string;
  clientId: string;
  reservationId: string | null;
  kind: IncidentKind;
  severity: 'mineur' | 'grave';
  occurredOn: string; // AAAA-MM-JJ
  amount: number;
  note: string;
  createdBy: string | null;
  createdAt: string;
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
  passengers?: number | null;
  driverId?: string | null;
  formula?: Formula;
  packageLabel?: string | null;
  missionFees?: number; // frais de mission du chauffeur (hébergement, repas hors de la ville), inclus dans total
  fuelIncluded?: boolean;
  itinerary?: string | null;
  crossBorder?: string | null; // pays où le véhicule peut aller ; null = territoire national seulement
}

export type Formula = 'jour' | 'demi_journee' | 'forfait';

export type PaymentKind = 'acompte' | 'solde' | 'caution' | 'frais' | 'remboursement_caution' | 'remboursement';
export type PaymentMethod =
  | 'especes'
  | 'wave'
  | 'orange_money'
  | 'free_money'
  | 'mtn'
  | 'moov'
  | 'carte'
  | 'virement'
  | 'cheque';
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
  reference?: string | null; // n° de transaction Wave/Orange Money, n° de chèque, référence du virement
}

export interface Maintenance {
  id: string;
  vehicleId: string;
  label: string;
  start: string;
  end: string;
  cost: number;
  provider?: string | null; // garage ou prestataire
  parts?: string | null; // pièces changées
  mileage?: number | null; // kilométrage à l'intervention
  planId?: string | null; // plan d'entretien concerné
}

/** Plan d'entretien périodique : tous les X km et/ou tous les X mois. */
export interface MaintenancePlan {
  id: string;
  vehicleId: string;
  label: string;
  everyKm: number | null;
  everyMonths: number | null;
  lastKm: number | null;
  lastDate: string | null; // AAAA-MM-JJ
  active: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: string | number;
  at: string;
  userEmail: string | null;
  tableName: string;
  rowId: string | null;
  action: 'creation' | 'modification' | 'suppression';
  label: string | null;
  changes: string | null;
}

export type ExpenseKind = 'carburant' | 'pneus' | 'reparation' | 'pieces' | 'amende' | 'assurance' | 'taxes' | 'peage' | 'lavage' | 'autre';

/** Dépense rattachée à un véhicule (hors entretiens planifiés, suivis dans Maintenance). */
export interface Expense {
  id: string;
  vehicleId: string;
  date: string; // AAAA-MM-JJ
  kind: ExpenseKind;
  amount: number;
  label: string | null;
  mileage: number | null;
  reservationId: string | null; // contrat concerné, utile pour une amende ou un plein refacturé
  chargedTo?: 'proprietaire' | 'chauffeur'; // VTC : qui paie cette dépense
  vtcContractId?: string | null;
}

export type VtcFormula = 'versement' | 'location_vente';
export type VtcStatus = 'actif' | 'suspendu' | 'termine' | 'transfere';
export type VtcCharge = 'vidange' | 'pneus' | 'reparation' | 'assurance' | 'carburant' | 'amende' | 'degats' | 'lavage';

/** Contrat VTC : un véhicule confié à un chauffeur contre un versement chaque jour travaillé. */
export interface VtcContract {
  id: string;
  number: string;
  vehicleId: string;
  driverId: string;
  formula: VtcFormula;
  platform: string | null; // Yango, Heetch, Uber…
  dailyAmount: number;
  restDays: number[]; // jours sans versement : 0 = dimanche … 6 = samedi
  startDate: string; // AAAA-MM-JJ
  endDate: string | null;
  caution: number;
  totalPrice: number | null; // location-vente : prix du véhicule à atteindre
  charges: Partial<Record<VtcCharge, 'proprietaire' | 'chauffeur'>>;
  status: VtcStatus;
  notes: string | null;
  createdAt: string;
  lateFee?: number; // pénalité par jour de retard au-delà de la tolérance, 0 = aucune
  graceDays?: number; // jours de retard tolérés avant pénalité
}

export type VtcAdjustmentKind = 'jour_offert' | 'avance' | 'remise' | 'retenue_caution';

/** Ajustement du compte d'un chauffeur : jour non dû, avance, remise, retenue sur la caution. */
export interface VtcAdjustment {
  id: string;
  contractId: string;
  kind: VtcAdjustmentKind;
  day: string; // AAAA-MM-JJ
  amount: number; // 0 pour un jour non dû
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface VtcPayment {
  id: string;
  contractId: string;
  paidOn: string; // AAAA-MM-JJ
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  collectedBy?: string | null; // qui a reçu l'argent (caisse de l'encaisseur)
  handedAt?: string | null; // remis au propriétaire (espèces)
  handedBy?: string | null;
}

export interface Tables {
  vehicles: Vehicle;
  clients: Client;
  rates: Rate;
  reservations: Reservation;
  payments: Payment;
  maintenances: Maintenance;
  expenses: Expense;
  invoices: import('./billing').Invoice;
  inspections: import('./inspection').Inspection;
  incidents: Incident;
  drivers: Driver;
  packages: Package;
  reservation_changes: ReservationChange;
  maintenance_plans: MaintenancePlan;
  vtc_contracts: VtcContract;
  vtc_payments: VtcPayment;
  vtc_adjustments: VtcAdjustment;
  seasons: Season;
  quotes: Quote;
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

export interface SubscriptionRequest {
  id: string;
  plan: Plan;
  vehicles: number;
  billing: 'annuel' | 'mensuel';
  amount: number;
  contactPhone: string | null;
  status: 'nouvelle' | 'en_cours' | 'payee' | 'annulee';
  createdAt: string;
}
