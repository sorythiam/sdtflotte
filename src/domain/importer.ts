// Import de véhicules et de clients depuis un tableau (Excel ou CSV).
// Tout est contrôlé ici, sans écrire en base : l'écran montre le bilan avant d'importer.

import type { Client, ClientKind, ClientScore, Fuel, Vehicle } from './types';

export type Cell = string | number | boolean | Date | null | undefined;

export interface ImportIssue {
  line: number; // numéro de ligne dans le fichier (l'en-tête est la ligne 1)
  message: string;
}

export interface ImportResult<T> {
  rows: T[];
  errors: ImportIssue[]; // lignes rejetées, à corriger
  skipped: ImportIssue[]; // lignes ignorées volontairement (déjà présentes)
  missingColumns: string[];
}

/** « Visite technique » → « visitetechnique » : insensible aux accents, à la casse et à la ponctuation. */
export function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

interface FieldSpec {
  key: string;
  title: string; // titre de colonne du modèle
  aliases: string[];
  required?: boolean;
  example: string | number;
}

export const VEHICLE_FIELDS: FieldSpec[] = [
  { key: 'plate', title: 'Immatriculation', aliases: ['immatriculation', 'immat', 'plaque', 'matricule', 'plate'], required: true, example: 'DK-1234-AB' },
  { key: 'brand', title: 'Marque', aliases: ['marque', 'brand', 'constructeur'], required: true, example: 'Toyota' },
  { key: 'model', title: 'Modèle', aliases: ['modele', 'model'], required: true, example: 'Hilux' },
  { key: 'category', title: 'Catégorie', aliases: ['categorie', 'category', 'type', 'gamme'], required: true, example: '4x4' },
  { key: 'year', title: 'Année', aliases: ['annee', 'year', 'anneemodele', 'miseencirculation'], example: 2022 },
  { key: 'fuel', title: 'Carburant', aliases: ['carburant', 'energie', 'fuel'], example: 'Diesel' },
  { key: 'mileage', title: 'Kilométrage', aliases: ['kilometrage', 'km', 'compteur', 'mileage'], example: 45000 },
  { key: 'insuranceExpiry', title: 'Assurance valable jusqu’au', aliases: ['assurance', 'assurancevalablejusquau', 'finassurance', 'expirationassurance'], example: '31/12/2026' },
  { key: 'inspectionExpiry', title: 'Visite technique jusqu’au', aliases: ['visitetechnique', 'visitetechniquejusquau', 'vt', 'controletechnique'], example: '30/06/2026' },
  { key: 'vignetteExpiry', title: 'Vignette jusqu’au', aliases: ['vignette', 'vignettejusquau'], example: '31/12/2026' },
];

export const CLIENT_FIELDS: FieldSpec[] = [
  { key: 'name', title: 'Nom ou raison sociale', aliases: ['nom', 'nomouraisonsociale', 'raisonsociale', 'client', 'name', 'nomcomplet', 'prenometnom', 'nometprenom'], required: true, example: 'Aïssatou Diop' },
  { key: 'phone', title: 'Téléphone', aliases: ['telephone', 'tel', 'phone', 'mobile', 'portable', 'numero'], required: true, example: '+221 77 000 00 00' },
  { key: 'kind', title: 'Type (particulier ou entreprise)', aliases: ['type', 'typeparticulierouentreprise', 'kind', 'categorie'], example: 'Particulier' },
  { key: 'email', title: 'Email', aliases: ['email', 'mail', 'courriel', 'adresseemail'], example: 'aissatou@exemple.sn' },
  { key: 'idNumber', title: 'N° pièce d’identité', aliases: ['npieceidentite', 'pieceidentite', 'cni', 'passeport', 'numerocni', 'idnumber', 'piece'], example: '1 234 1990 01234' },
  { key: 'licenseExpiry', title: 'Permis valable jusqu’au', aliases: ['permisvalablejusquau', 'permis', 'expirationpermis', 'finpermis'], example: '15/03/2029' },
  { key: 'score', title: 'Scoring (fiable, à surveiller, blacklisté)', aliases: ['scoring', 'score', 'statut', 'scoringfiableasurveillerblackliste'], example: 'Fiable' },
  { key: 'address', title: 'Adresse', aliases: ['adresse', 'address', 'adressepostale', 'siege'], example: 'Sacré-Cœur 3, villa 12' },
  { key: 'city', title: 'Ville', aliases: ['ville', 'city', 'localite'], example: 'Dakar' },
  { key: 'taxId', title: 'NINEA (entreprise)', aliases: ['ninea', 'nineaentreprise', 'ifu', 'nif', 'ncc', 'identifiantfiscal', 'numerofiscal'], example: '' },
  { key: 'tradeRegister', title: 'RCCM (entreprise)', aliases: ['rccm', 'rccmentreprise', 'registreducommerce', 'rc'], example: '' },
  { key: 'contactName', title: 'Personne de contact (entreprise)', aliases: ['personnedecontact', 'personnedecontactentreprise', 'contact', 'nomcontact', 'interlocuteur'], example: '' },
  { key: 'contactRole', title: 'Fonction du contact', aliases: ['fonctionducontact', 'fonction', 'poste'], example: '' },
  { key: 'contactPhone', title: 'Téléphone du contact', aliases: ['telephoneducontact', 'telcontact', 'telephonecontact'], example: '' },
  { key: 'contactEmail', title: 'Email du contact', aliases: ['emailducontact', 'emailcontact', 'mailcontact'], example: '' },
];

/** Repère les colonnes du fichier ; la première ligne non vide est l'en-tête. */
function locate(sheet: Cell[][], fields: FieldSpec[]) {
  const headerIndex = sheet.findIndex((r) => r.some((c) => String(c ?? '').trim() !== ''));
  const header = (sheet[headerIndex] ?? []).map(normalizeHeader);
  const col: Record<string, number> = {};
  for (const f of fields) {
    const i = header.findIndex((h) => h === normalizeHeader(f.title) || f.aliases.includes(h));
    if (i >= 0) col[f.key] = i;
  }
  const missingColumns = fields.filter((f) => f.required && col[f.key] === undefined).map((f) => f.title);
  return { headerIndex, col, missingColumns };
}

function text(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/** Accepte une date Excel, « 31/12/2026 », « 31-12-2026 », « 2026-12-31 » ou un numéro de série Excel. */
export function parseDate(v: Cell): string | null | 'invalid' {
  if (v === null || v === undefined || text(v) === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return 'invalid';
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return 'invalid';
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = text(v);
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (match) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return 'invalid';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return 'invalid';
  return dt.toISOString().slice(0, 10);
}

/** « 45 000 », « 45.000 km » → 45000. */
export function parseInteger(v: Cell): number | null | 'invalid' {
  if (v === null || v === undefined || text(v) === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 'invalid';
  const digits = text(v).replace(/[\s  .]/g, '').replace(/km$/i, '').replace(',', '.');
  const n = Number(digits);
  return Number.isFinite(n) ? Math.round(n) : 'invalid';
}

export function normalizePlate(p: string): string {
  return p.toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-');
}

/** Pour comparer des numéros : on garde les 9 derniers chiffres (sans indicatif pays). */
export function phoneKey(p: string): string {
  return p.replace(/\D/g, '').slice(-9);
}

function fuelOf(v: string): Fuel | 'invalid' {
  const n = normalizeHeader(v);
  if (n === '' || n.startsWith('diesel') || n === 'gasoil' || n === 'gazole') return 'diesel';
  if (n.startsWith('essence') || n === 'super' || n === 'sp') return 'essence';
  if (n.startsWith('hybride')) return 'hybride';
  if (n.startsWith('electrique')) return 'electrique';
  return 'invalid';
}

export type NewVehicle = Omit<Vehicle, 'id'>;
export type NewClient = Omit<Client, 'id'>;

export function parseVehicles(
  sheet: Cell[][],
  ctx: { categories: string[]; existingPlates: string[]; quota: number; activeCount: number },
): ImportResult<NewVehicle> {
  const { headerIndex, col, missingColumns } = locate(sheet, VEHICLE_FIELDS);
  const out: ImportResult<NewVehicle> = { rows: [], errors: [], skipped: [], missingColumns };
  if (missingColumns.length) return out;
  const catByKey = new Map(ctx.categories.map((c) => [normalizeHeader(c), c]));
  const seen = new Set(ctx.existingPlates.map(normalizePlate));
  const inFile = new Set<string>();
  const get = (r: Cell[], k: string) => (col[k] === undefined ? undefined : r[col[k]]);

  sheet.slice(headerIndex + 1).forEach((r, i) => {
    const line = headerIndex + 2 + i;
    if (!r.some((c) => text(c) !== '')) return;
    const problems: string[] = [];
    const plate = normalizePlate(text(get(r, 'plate')));
    const brand = text(get(r, 'brand'));
    const model = text(get(r, 'model'));
    const catRaw = text(get(r, 'category'));
    if (!plate) problems.push('immatriculation manquante');
    if (!brand) problems.push('marque manquante');
    if (!model) problems.push('modèle manquant');
    const category = catByKey.get(normalizeHeader(catRaw));
    if (!catRaw) problems.push('catégorie manquante');
    else if (!category) problems.push(`catégorie « ${catRaw} » inconnue (catégories : ${ctx.categories.join(', ')})`);
    const year = parseInteger(get(r, 'year'));
    if (year === 'invalid' || (year !== null && (year < 1980 || year > 2100))) problems.push('année invalide');
    const mileage = parseInteger(get(r, 'mileage'));
    if (mileage === 'invalid' || (mileage !== null && mileage < 0)) problems.push('kilométrage invalide');
    const fuel = fuelOf(text(get(r, 'fuel')));
    if (fuel === 'invalid') problems.push(`carburant « ${text(get(r, 'fuel'))} » inconnu (diesel, essence, hybride, électrique)`);
    const dates: Record<'insuranceExpiry' | 'inspectionExpiry' | 'vignetteExpiry', string | null> = {
      insuranceExpiry: null,
      inspectionExpiry: null,
      vignetteExpiry: null,
    };
    for (const k of Object.keys(dates) as (keyof typeof dates)[]) {
      const d = parseDate(get(r, k));
      if (d === 'invalid') problems.push(`date « ${text(get(r, k))} » illisible (${VEHICLE_FIELDS.find((f) => f.key === k)!.title}), format JJ/MM/AAAA`);
      else dates[k] = d;
    }
    if (problems.length) return void out.errors.push({ line, message: problems.join(' ; ') });
    if (seen.has(plate)) return void out.skipped.push({ line, message: `${plate} existe déjà` });
    if (inFile.has(plate)) return void out.skipped.push({ line, message: `${plate} apparaît deux fois dans le fichier` });
    inFile.add(plate);
    out.rows.push({
      plate,
      brand,
      model,
      category: category!,
      year: year as number | null,
      fuel: fuel as Fuel,
      mileage: (mileage as number | null) ?? 0,
      outOfService: false,
      ...dates,
    });
  });

  const room = Math.max(0, ctx.quota - ctx.activeCount);
  if (out.rows.length > room) {
    const cut = out.rows.splice(room);
    out.errors.push({
      line: 0,
      message: `Quota de votre formule : ${ctx.quota} véhicules. ${cut.length} véhicule(s) en trop ne seront pas importés (${cut
        .map((v) => v.plate)
        .join(', ')}).`,
    });
  }
  return out;
}

function kindOf(v: string): ClientKind | 'invalid' {
  const n = normalizeHeader(v);
  if (n === '' || n.startsWith('part') || n === 'p' || n === 'individu') return 'particulier';
  if (n.startsWith('entr') || n === 'societe' || n === 'e' || n === 'ong' || n === 'pro' || n === 'professionnel') return 'entreprise';
  return 'invalid';
}

function scoreOf(v: string): ClientScore | 'invalid' {
  const n = normalizeHeader(v);
  if (n === '' || n === 'fiable' || n === 'ok' || n === 'bon') return 'fiable';
  if (n.startsWith('asurveiller') || n.startsWith('surveiller') || n === 'moyen') return 'surveiller';
  if (n.startsWith('blacklist') || n.startsWith('listenoire') || n === 'interdit') return 'blacklist';
  return 'invalid';
}

export function parseClients(sheet: Cell[][], ctx: { existingPhones: string[] }): ImportResult<NewClient> {
  const { headerIndex, col, missingColumns } = locate(sheet, CLIENT_FIELDS);
  const out: ImportResult<NewClient> = { rows: [], errors: [], skipped: [], missingColumns };
  if (missingColumns.length) return out;
  const seen = new Set(ctx.existingPhones.map(phoneKey).filter(Boolean));
  const inFile = new Set<string>();
  const get = (r: Cell[], k: string) => (col[k] === undefined ? undefined : r[col[k]]);

  sheet.slice(headerIndex + 1).forEach((r, i) => {
    const line = headerIndex + 2 + i;
    if (!r.some((c) => text(c) !== '')) return;
    const problems: string[] = [];
    const name = text(get(r, 'name'));
    const phone = text(get(r, 'phone'));
    if (!name) problems.push('nom manquant');
    if (!phone) problems.push('téléphone manquant');
    else if (phoneKey(phone).length < 8) problems.push(`téléphone « ${phone} » trop court`);
    const kind = kindOf(text(get(r, 'kind')));
    if (kind === 'invalid') problems.push(`type « ${text(get(r, 'kind'))} » inconnu (particulier ou entreprise)`);
    const email = text(get(r, 'email')).toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push(`email « ${email} » invalide`);
    const license = parseDate(get(r, 'licenseExpiry'));
    if (license === 'invalid') problems.push(`date de permis « ${text(get(r, 'licenseExpiry'))} » illisible, format JJ/MM/AAAA`);
    const score = scoreOf(text(get(r, 'score')));
    if (score === 'invalid') problems.push(`scoring « ${text(get(r, 'score'))} » inconnu (fiable, à surveiller, blacklisté)`);
    if (problems.length) return void out.errors.push({ line, message: problems.join(' ; ') });
    const key = phoneKey(phone);
    if (seen.has(key)) return void out.skipped.push({ line, message: `${name} (${phone}) existe déjà` });
    if (inFile.has(key)) return void out.skipped.push({ line, message: `${phone} apparaît deux fois dans le fichier` });
    inFile.add(key);
    out.rows.push({
      name,
      phone,
      kind: kind as ClientKind,
      email: email || null,
      idNumber: text(get(r, 'idNumber')) || null,
      licenseExpiry: license as string | null,
      score: score as ClientScore,
      address: text(get(r, 'address')) || null,
      city: text(get(r, 'city')) || null,
      ...(kind === 'entreprise'
        ? {
            taxId: text(get(r, 'taxId')) || null,
            tradeRegister: text(get(r, 'tradeRegister')) || null,
            contactName: text(get(r, 'contactName')) || null,
            contactRole: text(get(r, 'contactRole')) || null,
            contactPhone: text(get(r, 'contactPhone')) || null,
            contactEmail: text(get(r, 'contactEmail')).toLowerCase() || null,
          }
        : {}),
    });
  });
  return out;
}

/** CSV exporté par Excel en français : séparateur « ; » ou « , », guillemets possibles. */
export function parseCsv(input: string): Cell[][] {
  const textIn = input.replace(/^﻿/, '');
  const firstLine = textIn.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: Cell[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < textIn.length; i++) {
    const ch = textIn[i];
    if (quoted) {
      if (ch === '"' && textIn[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && textIn[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
