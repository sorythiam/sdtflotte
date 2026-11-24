import type { ReactNode } from 'react';
import type { Role } from '../domain/types';

// Icônes au trait, dessinées pour Yoon Fleet (24 × 24, couleur du texte).
const I = ({ d }: { d: ReactNode }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
export const icons = {
  home: <I d={<><path d="M4 11 12 4l8 7" /><path d="M6 10v10h12V10" /><path d="M10 20v-5h4v5" /></>} />,
  planning: <I d={<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M7 14h4M13 14h4M7 17h4" /></>} />,
  reservations: <I d={<><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z" /><path d="M14 3.5V8h4" /><path d="M9 12h6M9 15.5h6" /></>} />,
  fleet: <I d={<><path d="M4 15.5 5.6 10a2 2 0 0 1 1.9-1.5h9a2 2 0 0 1 1.9 1.5l1.6 5.5" /><path d="M3.5 15.5h17V18a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-2.5Z" /><circle cx="7.5" cy="19" r="1.6" /><circle cx="16.5" cy="19" r="1.6" /></>} />,
  clients: <I d={<><circle cx="9" cy="8" r="3.2" /><path d="M3 19.5c.8-3.3 3.2-5 6-5s5.2 1.7 6 5" /><path d="M15.5 5.3a3 3 0 0 1 0 5.6M17.5 14.8c1.7.6 3 2.2 3.5 4.7" /></>} />,
  finances: <I d={<><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M15.5 14.5h2.5" /></>} />,
  settings: <I d={<><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" /></>} />,
  vtc: <I d={<><path d="M4 14.5 5.4 10a2 2 0 0 1 1.9-1.4h6.3" /><path d="M3.5 14.5h11V17a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-2.5Z" /><circle cx="6.5" cy="18" r="1.4" /><circle cx="11.5" cy="18" r="1.4" /><circle cx="18" cy="8" r="3.5" /><path d="M18 6.5v3M17 7.2h1.6" /></>} />,
  more: <I d={<><circle cx="5.5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18.5" cy="12" r="1.4" /></>} />,
};

export interface Tab {
  to: string;
  label: string;
  roles?: Role[]; // profils autorisés en plus de l'administrateur ; absent = tous
  badge?: 'requests';
}

export interface Section {
  key: 'home' | 'planning' | 'reservations' | 'fleet' | 'vtc' | 'clients' | 'finances' | 'settings';
  label: string;
  icon: ReactNode;
  tabs: Tab[]; // la première visible est la page d'arrivée
  also?: string[]; // autres adresses rattachées (fiches, sous-pages)
  badge?: 'alerts' | 'requests';
}

/** Le menu : sept sections, leurs onglets et les profils qui les voient. */
export const SECTIONS: Section[] = [
  { key: 'home', label: 'Accueil', icon: icons.home, tabs: [{ to: '/', label: 'Accueil' }], also: ['/alertes'], badge: 'alerts' },
  { key: 'planning', label: 'Planning', icon: icons.planning, tabs: [{ to: '/planning', label: 'Planning' }] },
  {
    key: 'reservations', label: 'Réservations', icon: icons.reservations, badge: 'requests',
    tabs: [
      { to: '/reservations', label: 'Réservations et contrats' },
      { to: '/devis', label: 'Devis', roles: ['direction', 'agent', 'comptable'] },
      { to: '/demandes', label: 'Demandes en ligne', roles: ['direction', 'agent'], badge: 'requests' },
    ],
  },
  {
    key: 'fleet', label: 'Flotte', icon: icons.fleet,
    tabs: [
      { to: '/vehicules', label: 'Véhicules' },
      { to: '/chauffeurs', label: 'Chauffeurs' },
      { to: '/maintenance', label: 'Entretiens' },
      { to: '/depenses', label: 'Dépenses' },
      { to: '/tarifs', label: 'Tarifs' },
    ],
  },
  { key: 'vtc', label: 'Chauffeurs VTC', icon: icons.vtc, tabs: [{ to: '/vtc', label: 'Chauffeurs VTC', roles: ['direction', 'agent', 'comptable'] }] },
  { key: 'clients', label: 'Clients', icon: icons.clients, tabs: [{ to: '/clients', label: 'Clients' }] },
  {
    key: 'finances', label: 'Finances', icon: icons.finances,
    tabs: [
      { to: '/factures', label: 'Factures', roles: ['direction', 'agent', 'comptable'] },
      { to: '/rapports', label: 'Rapports', roles: ['direction', 'comptable'] },
      { to: '/rentabilite', label: 'Rentabilité', roles: ['direction', 'comptable'] },
    ],
  },
  {
    key: 'settings', label: 'Paramètres', icon: icons.settings,
    tabs: [
      { to: '/parametres', label: 'Entreprise et compte' },
      { to: '/abonnement', label: 'Abonnement', roles: ['direction'] },
      { to: '/equipe', label: 'Équipe', roles: ['direction'] },
      { to: '/journal', label: 'Journal des actions', roles: ['direction'] },
    ],
  },
];

/** Onglets visibles pour un profil. */
export function visibleTabs(s: Section, role: Role): Tab[] {
  return s.tabs.filter((t) => !t.roles || role === 'admin' || t.roles.includes(role));
}

/** La section qui contient une adresse (une fiche /reservations/123 relève de Réservations). */
export function sectionOf(pathname: string): Section {
  const match = (p: string) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(p + '/'));
  return SECTIONS.find((s) => s.tabs.some((t) => match(t.to)) || s.also?.some(match)) ?? SECTIONS[0];
}
