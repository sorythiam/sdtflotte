// Contrat de location : réglages de l'entreprise et conditions générales par défaut.

export interface ContractSettings {
  legalName: string; // raison sociale, si différente du nom affiché
  address: string;
  city: string; // pour « Fait à … »
  phone: string;
  email: string;
  registration: string; // RCCM, NINEA, IFU… selon le pays
  logo: string | null; // image en data URL, réduite à l'envoi
  terms: string; // conditions générales, un article par paragraphe
  requireVerifiedClient: boolean; // pas de remise des clés sans dossier client vérifié
  minDriverAge: number; // 0 = pas d'âge minimum
}

export const EMPTY_CONTRACT: ContractSettings = {
  legalName: '',
  address: '',
  city: '',
  phone: '',
  email: '',
  registration: '',
  logo: null,
  terms: '',
  requireVerifiedClient: false,
  minDriverAge: 0,
};

/**
 * Conditions générales proposées par défaut. Modèle de départ, à adapter et à faire
 * valider par le conseil juridique de chaque loueur.
 */
export const DEFAULT_TERMS = `Article 1 – Objet
Le présent contrat a pour objet la location du véhicule désigné ci-dessus, pour la durée et au prix indiqués. Le locataire reconnaît avoir reçu le véhicule en bon état de marche, avec ses papiers et les équipements notés à l'état des lieux de départ.

Article 2 – Conducteurs
Seuls le locataire et les conducteurs déclarés au contrat peuvent conduire le véhicule. Chaque conducteur doit être titulaire d'un permis de conduire valide pendant toute la durée de la location. La sous-location et le prêt du véhicule à un tiers sont interdits.

Article 3 – Usage du véhicule
Le véhicule doit être utilisé en bon père de famille, conformément au Code de la route. Sont notamment interdits : le transport rémunéré de personnes ou de marchandises sans accord écrit du loueur, la participation à des courses ou essais, la conduite sous l'emprise de l'alcool ou de stupéfiants, la surcharge, et la sortie du territoire national sans autorisation écrite.

Article 4 – Durée, retard et prolongation
Le véhicule doit être restitué à la date, à l'heure et au lieu convenus. Au-delà d'une heure de retard, chaque journée entamée est facturée au tarif journalier en vigueur. Toute prolongation doit être demandée au loueur et acceptée par lui avant la fin de la location ; à défaut, le loueur peut considérer le véhicule comme détourné.

Article 5 – Prix, kilométrage et carburant
Le prix comprend le kilométrage inclus indiqué au contrat ; les kilomètres supplémentaires sont facturés au tarif indiqué. Le véhicule est remis avec le niveau de carburant noté au départ et doit être rendu au même niveau ; le carburant manquant est facturé au prix du marché majoré des frais de service.

Article 6 – Caution
La caution versée au départ garantit l'exécution du contrat. Elle est restituée au retour, déduction faite des sommes restant dues : jours supplémentaires, kilomètres, carburant, dégâts, amendes et frais de dossier.

Article 7 – Entretien et pannes
Le locataire vérifie régulièrement les niveaux (huile, eau) et la pression des pneus. En cas de panne ou de voyant allumé, il doit s'arrêter et prévenir le loueur sans délai. Aucune réparation ne peut être engagée sans l'accord du loueur ; les réparations autorisées sont remboursées sur présentation d'une facture.

Article 8 – Accident, vol et assurance
Le véhicule est assuré dans les conditions de la police souscrite par le loueur. En cas d'accident, le locataire doit établir un constat amiable ou faire constater les faits par les forces de l'ordre, et prévenir le loueur dans les 24 heures. En cas de vol, il doit porter plainte et remettre au loueur le récépissé et les clés. Les dommages non couverts par l'assurance, ainsi que la franchise, restent à la charge du locataire, de même que tout dommage résultant d'une faute ou d'une violation du présent contrat.

Article 9 – Amendes et infractions
Le locataire est seul responsable des infractions commises pendant la location. Les amendes, frais de fourrière et de stationnement sont à sa charge, augmentés des frais de traitement du loueur.

Article 10 – Restitution
Le véhicule est restitué propre, avec ses clés, papiers et équipements. Un état des lieux contradictoire est établi au retour. À défaut de présence du locataire, l'état des lieux dressé par le loueur fait foi.

Article 11 – Données personnelles
Les informations recueillies servent à la gestion de la location. Le locataire peut demander à y accéder ou à les faire rectifier auprès du loueur.

Article 12 – Litiges
Le présent contrat est soumis au droit du pays du siège du loueur. À défaut d'accord amiable, tout litige relève des tribunaux compétents du siège du loueur.`;

export interface TermsArticle {
  title: string | null;
  body: string;
}

/** Découpe le texte en articles : un titre « Article … » suivi de son paragraphe. */
export function parseTerms(text: string): TermsArticle[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [first, ...rest] = block.split('\n');
      if (/^(article|art\.)\s/i.test(first) && rest.length) return { title: first.trim(), body: rest.join(' ').trim() };
      return { title: null, body: block.replace(/\n/g, ' ') };
    });
}

/** Réglages complétés par défaut : nom affiché, CG du modèle. */
export function contractSettings(orgName: string, s: Partial<ContractSettings> | null | undefined): ContractSettings {
  const out = { ...EMPTY_CONTRACT, ...(s ?? {}) };
  if (!out.legalName.trim()) out.legalName = orgName;
  if (!out.terms.trim()) out.terms = DEFAULT_TERMS;
  return out;
}

export const FUEL_LEVELS = ['Vide', '1/4', '1/2', '3/4', 'Plein'];
export const INSPECTION_ZONES = [
  'Avant (pare-chocs, phares)',
  'Arrière (pare-chocs, feux)',
  'Côté gauche',
  'Côté droit',
  'Toit et pare-brise',
  'Jantes et pneus',
  'Intérieur et sièges',
  'Roue de secours, cric, triangle',
];
