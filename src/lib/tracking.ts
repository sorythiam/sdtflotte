// Mesure des publicités (Meta et LinkedIn), uniquement sur la page d'inscription de Yoon Fleet.
// Jamais sur les pages publiques des loueurs (réservation en ligne, portail client) :
// leurs clients ne sont pas les nôtres.
// Activé seulement si VITE_META_PIXEL_ID / VITE_LINKEDIN_PARTNER_ID sont renseignés sur Vercel.

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };
declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
    _linkedin_partner_id?: string;
    _linkedin_data_partner_ids?: string[];
    lintrk?: ((...a: unknown[]) => void) & { q?: unknown[] };
  }
}

const META = (import.meta.env.VITE_META_PIXEL_ID as string | undefined)?.trim();
const LINKEDIN = (import.meta.env.VITE_LINKEDIN_PARTNER_ID as string | undefined)?.trim();
const LINKEDIN_SIGNUP = (import.meta.env.VITE_LINKEDIN_SIGNUP_CONVERSION_ID as string | undefined)?.trim();
let started = false;

function script(src: string) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

/** Charge les balises (une seule fois) et compte la visite de la page d'inscription. */
export function startAdTracking() {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (META && /^\d{6,20}$/.test(META)) {
    const f: Fbq = function (...args: unknown[]) {
      if (f.callMethod) f.callMethod(...args);
      else (f.queue ??= []).push(args);
    } as Fbq;
    f.loaded = true;
    f.version = '2.0';
    f.queue = [];
    window.fbq = window._fbq = f;
    script('https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', META);
    window.fbq('track', 'PageView');
  }
  if (LINKEDIN && /^\d{3,12}$/.test(LINKEDIN)) {
    window._linkedin_partner_id = LINKEDIN;
    window._linkedin_data_partner_ids = [...(window._linkedin_data_partner_ids ?? []), LINKEDIN];
    if (!window.lintrk) {
      const l = ((...a: unknown[]) => { (l.q ??= []).push(a); }) as NonNullable<Window['lintrk']>;
      l.q = [];
      window.lintrk = l;
    }
    script('https://snap.licdn.com/li.lms-analytics/insight.min.js');
  }
}

/** Inscription réussie : la conversion que les publicités doivent optimiser. */
export function trackSignup() {
  try {
    window.fbq?.('track', 'CompleteRegistration');
    if (LINKEDIN_SIGNUP) window.lintrk?.('track', { conversion_id: Number(LINKEDIN_SIGNUP) });
  } catch {
    /* une balise bloquée ne doit jamais gêner l'inscription */
  }
}

export const adTrackingConfigured = () => !!(META || LINKEDIN);
