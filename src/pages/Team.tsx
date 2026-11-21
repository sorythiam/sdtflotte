import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Empty, ErrorBox, roleLabel } from '../components/ui';
import { dateShort } from '../domain/format';
import type { Invitation, Member, Role } from '../domain/types';
import { useData } from '../state/DataContext';

const roleRights: [Role, string][] = [
  ['admin', 'Tout, y compris l’équipe, les tarifs et l’abonnement'],
  ['direction', 'Tout sauf l’équipe : réservations, véhicules, maintenance, tarifs'],
  ['agent', 'Réservations, contrats, remise des clés et retours, encaissements'],
  ['comptable', 'Paiements et remboursements de caution ; consulte le reste'],
  ['mecanicien', 'Véhicules et maintenance ; ne crée ni réservation ni paiement'],
];

export function inviteLink(inv: Pick<Invitation, 'email'>): string {
  return `${window.location.origin}/?invitation=1&email=${encodeURIComponent(inv.email)}`;
}

function inviteMessage(inv: Pick<Invitation, 'email' | 'role'>, orgName: string): string {
  return (
    `Bonjour, vous êtes invité(e) à rejoindre ${orgName} sur Yoon Fleet (profil : ${roleLabel[inv.role]}). ` +
    `Créez votre compte avec l’adresse ${inv.email} : ${inviteLink(inv)}`
  );
}

export function Team() {
  const { store, session, can, toast, setSession } = useData();
  const admin = can();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('agent');
  const [error, setError] = useState<string | null>(null);
  const [justInvited, setJustInvited] = useState<Invitation | null>(null);
  const orgName = session?.org.name ?? '';

  const load = useCallback(async () => {
    try {
      setMembers(await store.listMembers());
      setInvitations(admin ? await store.listInvitations() : []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [store, admin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const inv = await store.invite(email, role);
      setJustInvited(inv);
      setEmail('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function act(fn: () => Promise<void>, ok: string) {
    setError(null);
    try {
      await fn();
      await load();
      setSession(await store.session());
      toast(ok);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function copy(inv: Invitation) {
    try {
      await navigator.clipboard.writeText(inviteMessage(inv, orgName));
      toast('Message d’invitation copié');
    } catch {
      setError('Copie impossible ici : utilisez WhatsApp ou l’email.');
    }
  }

  const share = (inv: Invitation) => (
    <div className="row">
      <a className="btn btn-sm" href={`https://wa.me/?text=${encodeURIComponent(inviteMessage(inv, orgName))}`} target="_blank" rel="noreferrer">
        WhatsApp
      </a>
      <a
        className="btn btn-sm"
        href={`mailto:${inv.email}?subject=${encodeURIComponent(`Invitation Yoon Fleet · ${orgName}`)}&body=${encodeURIComponent(inviteMessage(inv, orgName))}`}
      >
        Email
      </a>
      <button type="button" className="btn btn-sm" onClick={() => copy(inv)}>
        Copier
      </button>
    </div>
  );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Équipe</h1>
          <p className="muted small">
            {members.length} membre(s){invitations.length ? ` · ${invitations.length} invitation(s) en attente` : ''}
          </p>
        </div>
      </header>
      <ErrorBox error={error} />

      <div className="cols">
        <div className="col-2 stack" style={{ gap: 'var(--space-6)' }}>
          <section className="card" aria-labelledby="membres">
            <h2 id="membres">Membres</h2>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Email</th><th>Profil</th>{admin && <th className="right">Action</th>}</tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const self = m.userId === session?.userId;
                    return (
                      <tr key={m.userId}>
                        <td>
                          <strong>{m.email || '—'}</strong>
                          {self && <span className="muted"> (vous)</span>}
                        </td>
                        <td>
                          {admin ? (
                            <label className="field" style={{ minWidth: 190 }}>
                              <span className="sr-only">Profil de {m.email}</span>
                              <select
                                value={m.role}
                                onChange={(e) =>
                                  act(() => store.updateMemberRole(m.userId, e.target.value as Role), `Profil de ${m.email} modifié`)
                                }
                              >
                                {roleRights.map(([r]) => (
                                  <option key={r} value={r}>{roleLabel[r]}</option>
                                ))}
                              </select>
                            </label>
                          ) : (
                            roleLabel[m.role]
                          )}
                        </td>
                        {admin && (
                          <td className="right">
                            {!self && (
                              <button
                                type="button"
                                className="btn btn-sm btn-danger"
                                onClick={() => act(() => store.removeMember(m.userId), `${m.email} a été retiré de l’équipe`)}
                              >
                                Retirer
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {admin && (
            <section className="card" aria-labelledby="attente">
              <h2 id="attente">Invitations en attente</h2>
              {invitations.length === 0 ? (
                <Empty>Aucune invitation en attente.</Empty>
              ) : (
                <ul className="alerts">
                  {invitations.map((inv) => (
                    <li key={inv.id} style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="grow">
                        <strong>{inv.email}</strong> · {roleLabel[inv.role]}
                        <br />
                        <span className="muted">Valable jusqu’au {dateShort(inv.expiresAt)}</span>
                      </span>
                      {share(inv)}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => act(() => store.cancelInvitation(inv.id), 'Invitation annulée')}>
                        Annuler
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <div className="col-1 stack" style={{ gap: 'var(--space-6)' }}>
          {admin && (
            <section className="card" aria-labelledby="inviter">
              <h2 id="inviter">Inviter une personne</h2>
              <form className="stack" onSubmit={submit}>
                <label className="field">
                  Email
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom@entreprise.sn" />
                </label>
                <label className="field">
                  Profil
                  <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                    {roleRights.map(([r]) => (
                      <option key={r} value={r}>{roleLabel[r]}</option>
                    ))}
                  </select>
                </label>
                <button className="btn btn-primary">Créer l’invitation</button>
              </form>
              {justInvited && (
                <div className="notice stack" style={{ gap: 'var(--space-2)' }}>
                  <span>
                    Invitation créée pour <strong>{justInvited.email}</strong>. Envoyez-lui le lien : elle crée son compte avec
                    cette adresse et rejoint l’équipe dès son email confirmé.
                  </span>
                  {share(justInvited)}
                </div>
              )}
            </section>
          )}
          <section className="card" aria-labelledby="droits">
            <h2 id="droits">Ce que chaque profil peut faire</h2>
            <ul className="alerts">
              {roleRights.map(([r, d]) => (
                <li key={r}>
                  <span>
                    <strong>{roleLabel[r]}</strong>
                    <br />
                    <span className="muted">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
