// État des lieux de départ et de retour : zones photographiées, compteur, carburant, signature.

export type InspectionKind = 'depart' | 'retour';
export type ZoneStatus = 'ok' | 'dommage';

export interface InspectionItem {
  zone: string; // identifiant stable de la zone (voir ZONES)
  status: ZoneStatus;
  note: string;
  photos: string[]; // chemins dans l'espace privé, ou images en démo
}

export interface Inspection {
  id: string;
  reservationId: string;
  kind: InspectionKind;
  mileage: number;
  fuelQuarters: number; // 0 (vide) à 4 (plein)
  items: InspectionItem[];
  signature: string | null; // image de la signature du client (PNG réduit)
  signerName: string;
  agentSignature: string | null;
  notes: string;
  doneAt: string;
}

export type NewInspection = Omit<Inspection, 'id'>;

export interface Zone {
  id: string;
  label: string;
  hint: string; // ce qu'il faut cadrer
  photoRequired: boolean;
}

/** Les zones du parcours, dans l'ordre où l'agent fait le tour du véhicule. */
export const ZONES: Zone[] = [
  { id: 'avant', label: 'Avant', hint: 'Pare-chocs, capot, phares, plaque', photoRequired: true },
  { id: 'droit', label: 'Côté droit', hint: 'Portières, rétroviseur, bas de caisse', photoRequired: true },
  { id: 'arriere', label: 'Arrière', hint: 'Pare-chocs, hayon ou coffre, feux, plaque', photoRequired: true },
  { id: 'gauche', label: 'Côté gauche', hint: 'Portières, rétroviseur, bas de caisse', photoRequired: true },
  { id: 'toit', label: 'Toit et pare-brise', hint: 'Impacts, fissures', photoRequired: false },
  { id: 'roues', label: 'Jantes et pneus', hint: 'Rayures de jantes, usure, roue de secours', photoRequired: false },
  { id: 'interieur', label: 'Intérieur', hint: 'Sièges, tableau de bord, propreté', photoRequired: true },
  { id: 'equipements', label: 'Équipements et papiers', hint: 'Cric, triangle, gilet, carte grise, assurance', photoRequired: false },
];

export const FUEL_LABELS = ['Vide', '1/4', '1/2', '3/4', 'Plein'];

export function zoneLabel(id: string): string {
  return ZONES.find((z) => z.id === id)?.label ?? id;
}

export function emptyItems(): InspectionItem[] {
  return ZONES.map((z) => ({ zone: z.id, status: 'ok', note: '', photos: [] }));
}

/** Ce qui empêche de valider l'état des lieux ; une liste vide = prêt. */
export function inspectionProblems(
  i: Pick<NewInspection, 'mileage' | 'fuelQuarters' | 'items' | 'signature' | 'signerName'>,
  opts: { minMileage?: number | null; requirePhotos?: boolean } = {},
): string[] {
  const out: string[] = [];
  if (!Number.isInteger(i.mileage) || i.mileage < 0) out.push('Relevez le compteur.');
  else if (opts.minMileage != null && i.mileage < opts.minMileage) out.push(`Le compteur ne peut pas être inférieur à ${opts.minMileage} km.`);
  if (!(i.fuelQuarters >= 0 && i.fuelQuarters <= 4)) out.push('Indiquez le niveau de carburant.');
  if (opts.requirePhotos !== false) {
    const missing = ZONES.filter((z) => z.photoRequired && !(i.items.find((x) => x.zone === z.id)?.photos.length));
    if (missing.length) out.push(`Photo manquante : ${missing.map((z) => z.label.toLowerCase()).join(', ')}.`);
  }
  const damagedWithoutNote = i.items.filter((x) => x.status === 'dommage' && !x.note.trim());
  if (damagedWithoutNote.length) out.push(`Décrivez le dommage : ${damagedWithoutNote.map((x) => zoneLabel(x.zone).toLowerCase()).join(', ')}.`);
  if (!i.signerName.trim()) out.push('Indiquez le nom de la personne qui signe.');
  if (!i.signature) out.push('Faites signer le client.');
  return out;
}

export interface Comparison {
  newDamages: { zone: string; label: string; note: string }[]; // intacte au départ, abîmée au retour
  knownDamages: { zone: string; label: string; note: string }[]; // déjà notées au départ
  fuelMissing: number; // quarts manquants
  kmDriven: number;
}

/** Ce qui a changé entre le départ et le retour. */
export function compareInspections(depart: Pick<Inspection, 'items' | 'fuelQuarters' | 'mileage'> | undefined, retour: Pick<Inspection, 'items' | 'fuelQuarters' | 'mileage'>): Comparison {
  const before = (zone: string) => depart?.items.find((x) => x.zone === zone);
  const newDamages: Comparison['newDamages'] = [];
  const knownDamages: Comparison['knownDamages'] = [];
  for (const it of retour.items.filter((x) => x.status === 'dommage')) {
    const b = before(it.zone);
    (b?.status === 'dommage' ? knownDamages : newDamages).push({ zone: it.zone, label: zoneLabel(it.zone), note: it.note.trim() });
  }
  return {
    newDamages,
    knownDamages,
    fuelMissing: depart ? Math.max(0, depart.fuelQuarters - retour.fuelQuarters) : 0,
    kmDriven: depart ? Math.max(0, retour.mileage - depart.mileage) : 0,
  };
}
