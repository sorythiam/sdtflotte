// Pays proposés à l'inscription. Tous travaillent en FCFA dans Yoon Fleet pour l'instant ;
// la Guinée (GNF) et la Mauritanie (MRU) restent proposées pour mesurer la demande.
export const COUNTRIES: [string, string][] = [
  // Franc CFA d'Afrique de l'Ouest (XOF)
  ['SN', 'Sénégal'], ['CI', 'Côte d’Ivoire'], ['ML', 'Mali'], ['BF', 'Burkina Faso'], ['BJ', 'Bénin'],
  ['TG', 'Togo'], ['NE', 'Niger'], ['GW', 'Guinée-Bissau'],
  // Franc CFA d'Afrique centrale (XAF), même valeur que le XOF
  ['CM', 'Cameroun'], ['GA', 'Gabon'], ['CG', 'Congo'], ['TD', 'Tchad'], ['CF', 'Centrafrique'], ['GQ', 'Guinée équatoriale'],
  // Hors zone franc
  ['GN', 'Guinée'], ['MR', 'Mauritanie'],
];
