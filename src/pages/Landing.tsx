import { useEffect } from 'react';
import { Logo } from '../components/ui';
import { utmFrom } from '../domain/platform';
import { PLAN_INFO } from '../domain/pricing';
import { startAdTracking } from '../lib/tracking';

const SUPPORT = (import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined)?.replace(/\D/g, '') || null;
const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n);

const PAINS: { pain: string; answer: string }[] = [
  { pain: 'Le client réserve et ne vient pas', answer: 'Il paie l’acompte sur votre Wave ou votre Orange Money avant d’arriver. Le véhicule n’est plus bloqué pour rien.' },
  { pain: 'Un véhicule rentre en retard', answer: 'Chaque matin, la liste des retours et des retards, avec le message WhatsApp de relance déjà écrit.' },
  { pain: 'Le client attend 20 minutes au comptoir', answer: 'Il envoie ses pièces et signe le contrat depuis un lien WhatsApp, avant de venir chercher les clés.' },
  { pain: 'Des dégâts contestés au retour', answer: 'État des lieux en photos, kilométrage et carburant, signé par le client au départ et au retour.' },
  { pain: 'Deux clients pour la même voiture', answer: 'Un planning unique : l’application refuse un véhicule déjà loué sur ces dates.' },
  { pain: 'Aucune idée de ce que rapporte chaque véhicule', answer: 'Revenus, dépenses, marge et taux d’occupation, véhicule par véhicule.' },
];

const FAQ: { q: string; a: string }[] = [
  { q: 'Est-ce que Yoon Fleet encaisse l’argent de mes clients ?', a: 'Jamais. Vos clients paient directement sur votre Wave, votre Orange Money ou votre compte. Vous confirmez vous-même la réception.' },
  { q: 'Faut-il un ordinateur ?', a: 'Non. Yoon Fleet fonctionne sur téléphone, tablette et ordinateur. Les états des lieux se font même sans réseau et partent dès que la connexion revient.' },
  { q: 'Je n’ai pas le temps de tout saisir.', a: 'Un conseiller vous appelle après l’inscription et saisit vos véhicules avec vous, à partir de votre Excel ou de votre cahier. Comptez vingt minutes.' },
  { q: 'Mes données m’appartiennent-elles ?', a: 'Oui. Vous les exportez à tout moment : clients, contrats, factures et journal comptable SYSCOHADA, pour Sage ou Odoo.' },
  { q: 'Et après l’essai ?', a: 'Vous choisissez une formule et payez par Wave, Orange Money ou carte. Sans abonnement, l’accès est suspendu mais vos données sont conservées : elles réapparaissent dès le paiement. Aucune carte bancaire n’est demandée pour l’essai.' },
  { q: 'Dans quels pays ?', a: 'Toute la zone franc CFA : Sénégal, Côte d’Ivoire, Mali, Burkina Faso, Bénin, Togo, Niger, Guinée-Bissau, Cameroun, Gabon, Congo, Tchad, Centrafrique et Guinée équatoriale, ainsi que la Guinée et la Mauritanie. Les montants sont affichés en FCFA.' },
];

/** Page d'accueil publique de yoonfleet.com : là où arrivent les publicités. */
export function Landing() {
  useEffect(() => {
    document.title = 'Yoon Fleet · Logiciel de location de voitures et de gestion de flotte';
    const utm = utmFrom(window.location.search);
    try {
      if (utm) sessionStorage.setItem('yoonfleet-utm', utm);
    } catch {
      /* navigation privée */
    }
    startAdTracking();
  }, []);

  const trial = '/?essai=1';
  const login = '/?connexion=1';
  const wa = SUPPORT ? `https://wa.me/${SUPPORT}?text=${encodeURIComponent('Bonjour, je voudrais en savoir plus sur Yoon Fleet pour mon agence de location.')}` : null;

  return (
    <div className="lp">
      <header className="lp-nav">
        <a href="/" className="lp-brand" aria-label="Yoon Fleet, accueil">
          <Logo inverse={false} size={34} />
          <span className="lp-word">yoon <span>fleet</span></span>
        </a>
        <nav aria-label="Sections">
          <a href="#fonctions">Fonctions</a>
          <a href="#tarifs">Tarifs</a>
          <a href="#questions">Questions</a>
        </nav>
        <div className="lp-nav-cta">
          <a href={login} className="lp-link">Se connecter</a>
          <a href={trial} className="btn btn-primary btn-sm">Essai gratuit</a>
        </div>
      </header>

      <main id="contenu">
        <section className="lp-hero">
          <div className="lp-hero-text">
            <p className="lp-kicker">Logiciel de location de voitures et de gestion de flotte</p>
            <h1>Votre flotte, sur la bonne route.</h1>
            <p className="lp-lead">
              Réservations, contrats, états des lieux, paiements Wave et Orange Money, chauffeurs et rentabilité : toute votre agence de location dans votre téléphone.
            </p>
            <div className="lp-cta">
              <a href={trial} className="btn btn-primary">Essai gratuit 30 jours</a>
              {wa && <a href={wa} className="btn" target="_blank" rel="noreferrer">Nous écrire sur WhatsApp</a>}
            </div>
            <p className="lp-small">Sans carte bancaire. Un conseiller vous appelle pour configurer votre espace avec vous.</p>
          </div>
          <figure className="lp-shots">
            <img className="lp-shot-desk" src="/landing/tableau-de-bord.jpg" alt="Tableau de bord Yoon Fleet : véhicules disponibles, en location, retours du jour et encaissements" width="1280" height="800" />
            <img className="lp-shot-phone" src="/landing/suivi-du-jour.jpg" alt="Suivi du jour sur téléphone : départs, retours et relances WhatsApp" width="390" height="780" />
          </figure>
        </section>

        <section className="lp-proof" aria-label="Référence">
          <p><strong>Pensé pour les loueurs en Afrique :</strong> paiements par mobile money, location avec chauffeur, tout depuis le téléphone.</p>
        </section>

        <section id="fonctions" className="lp-section">
          <h2>Ce qui vous fait perdre de l’argent, et comment Yoon Fleet le règle</h2>
          <div className="lp-grid">
            {PAINS.map((p) => (
              <article key={p.pain} className="lp-card">
                <h3>{p.pain}</h3>
                <p>{p.answer}</p>
              </article>
            ))}
          </div>
          <p className="lp-more">
            Aussi : location avec chauffeur et feuilles de mission, transferts aéroport avec numéro de vol, groupes de plusieurs véhicules, devis, réservation en ligne pour vos clients, entretiens, gestion des chauffeurs VTC, factures et journal comptable SYSCOHADA.
          </p>
        </section>

        <section className="lp-section lp-steps-wrap">
          <h2>Démarrer prend une journée, pas un mois</h2>
          <ol className="lp-steps">
            <li><strong>Vous créez votre espace</strong><span>En deux minutes, avec le nom de votre agence et votre numéro WhatsApp.</span></li>
            <li><strong>Un conseiller vous appelle</strong><span>Dans l’heure, aux heures ouvrables : on saisit vos véhicules et vos tarifs ensemble.</span></li>
            <li><strong>Votre première location</strong><span>Réservation, contrat et lien client envoyés par WhatsApp, pendant l’appel.</span></li>
          </ol>
        </section>

        <section id="tarifs" className="lp-section">
          <h2>Un prix par véhicule, en FCFA</h2>
          <p className="lp-sub">Licence annuelle hors taxes. Paiement mensuel possible par mobile money (+20 %).</p>
          <div className="lp-plans">
            {(['essentiel', 'pro', 'entreprise'] as const).map((k) => {
              const p = PLAN_INFO[k];
              return (
                <article key={k} className={`lp-plan${k === 'pro' ? ' lp-plan-main' : ''}`}>
                  {k === 'pro' && <span className="lp-badge">Recommandé</span>}
                  <h3>{p.label}</h3>
                  <p className="lp-price"><strong>{fmt(p.perVehicleYear)} FCFA</strong> par véhicule et par an</p>
                  <p className="lp-small">soit {fmt(Math.round(p.perVehicleYear / 12))} FCFA par mois · dès {p.minVehicles} véhicules</p>
                  <p>{p.summary}</p>
                  <p className="lp-small">{p.users}</p>
                </article>
              );
            })}
          </div>
          <p className="lp-offer">
            <strong>Offre de lancement :</strong> mise en service et formation de votre équipe offertes aux 10 premiers loueurs (valeur 100 000 FCFA HT). Option chauffeurs VTC : 25 000 FCFA HT par mois.
          </p>
          <div className="lp-cta lp-center">
            <a href={trial} className="btn btn-primary">Commencer l’essai gratuit</a>
          </div>
        </section>

        <section id="questions" className="lp-section">
          <h2>Questions fréquentes</h2>
          <div className="lp-faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-final">
          <h2>Essayez Yoon Fleet sur vos vrais véhicules</h2>
          <p>30 jours gratuits, accompagnés par un conseiller.</p>
          <div className="lp-cta lp-center">
            <a href={trial} className="btn btn-primary">Créer mon espace</a>
            {wa && <a href={wa} className="btn btn-on-dark" target="_blank" rel="noreferrer">WhatsApp</a>}
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <span>© {new Date().getFullYear()} Tabibou Business Group · Yoon Fleet</span>
        <span>Cette page mesure l’efficacité de nos publicités (Meta, LinkedIn). Aucune donnée de vos clients n’est concernée.</span>
      </footer>
    </div>
  );
}
