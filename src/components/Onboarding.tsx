import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../state/DataContext';

interface Step {
  key: string;
  title: string;
  why: string;
  done: boolean;
  actions: { label: string; to: string; primary?: boolean }[];
}

const storeKey = (org: string) => `yoonfleet-onboarding:${org}`;
function readState(org: string): { visited: string[]; hidden: boolean } {
  try {
    return { visited: [], hidden: false, ...JSON.parse(localStorage.getItem(storeKey(org)) ?? '{}') };
  } catch {
    return { visited: [], hidden: false };
  }
}
function writeState(org: string, s: { visited: string[]; hidden: boolean }) {
  try {
    localStorage.setItem(storeKey(org), JSON.stringify(s));
  } catch {
    /* navigation privée : l'assistant réapparaîtra, sans gravité */
  }
}

/** Assistant de démarrage : les six étapes pour qu'un nouveau loueur fasse sa première location. */
export function Onboarding() {
  const { data, session, store, can } = useData();
  const org = session!.org;
  const [st, setSt] = useState(() => readState(org.id));
  const [team, setTeam] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const manager = can('direction');

  useEffect(() => {
    if (!manager) return;
    let live = true;
    Promise.all([store.listMembers().catch(() => []), store.listInvitations().catch(() => [])]).then(([m, i]) => {
      if (live) setTeam(m.length > 1 || i.length > 0);
    });
    return () => {
      live = false;
    };
  }, [store, manager]);

  if (!manager || st.hidden) return null;
  const c = org.contract ?? {};
  const payees = Object.values(org.billing?.payees ?? {}).some((v) => typeof v === 'string' && v.trim() !== '');
  const visit = (k: string) => {
    if (st.visited.includes(k)) return;
    const next = { ...st, visited: [...st.visited, k] };
    setSt(next);
    writeState(org.id, next);
  };
  const steps: Step[] = [
    {
      key: 'entreprise', title: 'Votre entreprise', why: 'Raison sociale, adresse, téléphone et logo : ils figurent sur vos contrats, devis et factures.',
      done: !!(c.phone && c.address), actions: [{ label: 'Compléter', to: '/parametres', primary: true }],
    },
    {
      key: 'tarifs', title: 'Vos tarifs', why: 'Une grille type est déjà en place : ajustez vos prix, vos catégories et vos saisons.',
      done: st.visited.includes('tarifs'), actions: [{ label: 'Vérifier les tarifs', to: '/tarifs', primary: true }],
    },
    {
      key: 'vehicules', title: 'Votre flotte', why: 'Importez tous vos véhicules d’un coup depuis Excel, ou ajoutez-les un par un.',
      done: data.vehicles.length > 0,
      actions: [{ label: 'Importer depuis Excel', to: '/vehicules?importer=1', primary: true }, { label: 'Ajouter un véhicule', to: '/vehicules?v=nouveau' }],
    },
    {
      key: 'paiement', title: 'Vos moyens de paiement', why: 'Numéros Wave, Orange Money, RIB : ils s’affichent sur les factures pour être payé plus vite.',
      done: payees, actions: [{ label: 'Renseigner', to: '/parametres', primary: true }],
    },
    {
      key: 'equipe', title: 'Votre équipe', why: 'Invitez vos agents, votre comptable et votre mécanicien, chacun avec ses droits.',
      done: !!team || st.visited.includes('equipe'), actions: [{ label: 'Inviter', to: '/equipe', primary: true }],
    },
    {
      key: 'reservation', title: 'Votre première location', why: 'Créez un client et une réservation : contrat, facture et état des lieux suivent.',
      done: data.reservations.length > 0, actions: [{ label: 'Nouvelle réservation', to: '/reservations?nouvelle=1', primary: true }],
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const next = steps.find((s) => !s.done)!;
  const hide = () => {
    const n = { ...st, hidden: true };
    setSt(n);
    writeState(org.id, n);
  };

  // Une fois la moitié du chemin faite, l'assistant tient sur une ligne : il ne cache plus le tableau de bord.
  if (doneCount >= steps.length / 2 && !open) {
    const left = steps.length - doneCount;
    return (
      <section className="card onboarding onboarding-compact" aria-labelledby="demarrer">
        <div className="onb-compact">
          <div className="grow">
            <h2 id="demarrer" className="onb-compact-title">Bien démarrer avec Yoon Fleet</h2>
            <span className="small muted">
              Encore {left} étape{left > 1 ? 's' : ''} : <strong style={{ color: 'var(--ink)' }}>{next.title.toLowerCase()}</strong>
            </span>
          </div>
          <Link to={next.actions[0].to} className="btn btn-sm btn-primary" onClick={() => visit(next.key)}>{next.actions[0].label}</Link>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>Tout voir</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={hide}>Masquer</button>
        </div>
        <div className="onb-bar" aria-hidden="true"><span style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
      </section>
    );
  }

  return (
    <section className="card onboarding" aria-labelledby="demarrer">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h2 id="demarrer" style={{ margin: 0 }}>Bien démarrer avec Yoon Fleet</h2>
          <p className="small muted" style={{ margin: 0 }}>{doneCount} étape{doneCount > 1 ? 's' : ''} sur {steps.length} · comptez une demi-heure en tout</p>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={hide}>Masquer</button>
      </div>
      <div className="onb-bar" aria-hidden="true"><span style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
      <ol className="onb-steps">
        {steps.map((s, i) => (
          <li key={s.key} className={s.done ? 'done' : s === next ? 'current' : undefined}>
            <span className="onb-num" aria-hidden="true">{s.done ? '✓' : i + 1}</span>
            <div className="grow">
              <strong>{s.title}</strong>
              {s.done && <span className="sr-only"> (fait)</span>}
              {!s.done && <div className="small muted">{s.why}</div>}
              {!s.done && s === next && (
                <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                  {s.actions.map((a) => (
                    <Link key={a.to} to={a.to} className={`btn btn-sm${a.primary ? ' btn-primary' : ''}`} onClick={() => visit(s.key)}>{a.label}</Link>
                  ))}
                </div>
              )}
            </div>
            {!s.done && s !== next && <Link to={s.actions[0].to} className="small" onClick={() => visit(s.key)}>{s.actions[0].label}</Link>}
          </li>
        ))}
      </ol>
    </section>
  );
}
