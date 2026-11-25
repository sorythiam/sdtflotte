import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Empty, ErrorBox, Modal } from '../components/ui';
import { COUNTRY_CALLING_CODE, whatsappLink } from '../domain/booking';
import {
  callPriority, FOLLOW_LABEL, funnel, hoursSince, pct, sourceLabel, STAGE_LABEL, stageOf, trialDaysLeft, welcomeMessage,
  type FollowStatus, type SignupRow,
} from '../domain/platform';
import { useData } from '../state/DataContext';

type View = 'appeler' | 'essais' | 'tous';

/** Console de l'équipe Yoon Fleet : qui s'est inscrit, qui appeler, où en est chacun. */
export function PlatformConsole() {
  const { store, session, now, toast } = useData();
  const [staff, setStaff] = useState<boolean | null>(null);
  const [rows, setRows] = useState<SignupRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('appeler');
  const [editing, setEditing] = useState<SignupRow | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await store.listSignups());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [store]);

  useEffect(() => {
    store.isPlatformStaff().then((ok) => {
      setStaff(ok);
      if (ok) void load();
    });
  }, [store, load]);

  const agent = useMemo(() => {
    const n = (session?.userEmail ?? '').split('@')[0].split(/[._-]/)[0];
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'l’équipe';
  }, [session]);

  if (staff === null) return <div className="page-loading" />;
  if (!staff) {
    return (
      <section className="card">
        <h1>Console Yoon Fleet</h1>
        <p style={{ margin: 0 }}>Cette page est réservée à l’équipe Yoon Fleet.</p>
      </section>
    );
  }

  const all = rows ?? [];
  const f = funnel(all, now, 30);
  const list = all
    .filter((r) => {
      const st = stageOf(r, now);
      if (view === 'appeler') return callPriority(r, now) >= 100;
      if (view === 'essais') return st !== 'payant' && r.status !== 'perdu';
      return true;
    })
    .sort((a, b) => (view === 'appeler' ? callPriority(b, now) - callPriority(a, now) : (b.createdAt ?? '').localeCompare(a.createdAt ?? '')));
  const toCall = all.filter((r) => callPriority(r, now) >= 100).length;

  const ago = (iso: string | null) => {
    const h = hoursSince(iso, now);
    if (h === null) return '—';
    if (h < 1) return 'à l’instant';
    if (h < 24) return `il y a ${h} h`;
    const d = Math.floor(h / 24);
    return `il y a ${d} j`;
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Inscriptions et essais</h1>
          <p className="muted small">Chaque nouveau loueur est appelé dans l’heure : on saisit ses véhicules et on fait sa première réservation ensemble.</p>
        </div>
        <button className="btn" onClick={() => void load()}>Actualiser</button>
      </header>

      <section className="kpis" aria-label="Entonnoir des 30 derniers jours">
        <div className="card kpi"><span className="kpi-label">Inscriptions · 30 j</span><strong className="kpi-value">{f.signups}</strong></div>
        <div className="card kpi"><span className="kpi-label">Accompagnés</span><strong className="kpi-value">{pct(f.called, f.signups)} %</strong><span className="small muted">{f.called} sur {f.signups}</span></div>
        <div className="card kpi"><span className="kpi-label">Première location</span><strong className="kpi-value">{pct(f.firstRental, f.signups)} %</strong><span className="small muted">{f.firstRental} loueur(s) · objectif 60 %</span></div>
        <div className="card kpi"><span className="kpi-label">Devenus payants</span><strong className="kpi-value">{pct(f.paying, f.signups)} %</strong><span className="small muted">{f.paying} loueur(s) · objectif 30 %</span></div>
      </section>

      <div className="tabs" role="group" aria-label="Filtre">
        <button type="button" aria-selected={view === 'appeler'} onClick={() => setView('appeler')}>À appeler maintenant ({toCall})</button>
        <button type="button" aria-selected={view === 'essais'} onClick={() => setView('essais')}>Essais en cours</button>
        <button type="button" aria-selected={view === 'tous'} onClick={() => setView('tous')}>Toutes les inscriptions</button>
      </div>

      <ErrorBox error={error} />
      <section className="card">
        {rows === null ? (
          <div className="page-loading" />
        ) : list.length === 0 ? (
          <Empty>{view === 'appeler' ? 'Personne à appeler pour l’instant.' : 'Aucune inscription.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Entreprise</th><th>Gérant</th><th>Inscrit</th><th>Avancement</th><th>Essai</th><th>Suivi</th><th /></tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const st = stageOf(r, now);
                  const left = trialDaysLeft(r, now);
                  const cc = COUNTRY_CALLING_CODE[r.country] ?? '221';
                  return (
                    <tr key={r.orgId}>
                      <td>
                        <strong>{r.name}</strong>
                        <br />
                        <span className="small muted">{r.country} · {sourceLabel(r.signupSource)}</span>
                      </td>
                      <td>
                        {r.contactName ?? '—'}
                        <br />
                        {r.contactPhone ? (
                          <span className="small">
                            <a href={`tel:${r.contactPhone.replace(/[^\d+]/g, '')}`}>{r.contactPhone}</a>
                            {' · '}
                            <a target="_blank" rel="noreferrer" href={whatsappLink(r.contactPhone, welcomeMessage(r, agent), cc)}>WhatsApp</a>
                          </span>
                        ) : (
                          <span className="small muted">{r.adminEmail ?? 'pas de numéro'}</span>
                        )}
                      </td>
                      <td className="nowrap">{ago(r.createdAt)}</td>
                      <td>
                        <span className={`badge${st === 'payant' ? ' badge-success' : st === 'inscrit' ? ' badge-muted' : ''}`}>{STAGE_LABEL[st]}</span>
                        <br />
                        <span className="small muted">{r.vehicles} véh. · {r.reservations} loc.</span>
                      </td>
                      <td className="nowrap">
                        {st === 'payant' ? <span className="small muted">{r.plan}</span> : left === null ? '—' : left < 0 ? <span style={{ color: 'var(--danger)', fontWeight: 600 }}>terminé</span> : `${left} j`}
                      </td>
                      <td>
                        <strong className="small">{FOLLOW_LABEL[r.status]}</strong>
                        {r.nextCall && (r.status === 'rappeler' || r.status === 'injoignable') && <span className="small muted"> · le {new Date(r.nextCall).toLocaleDateString('fr-FR')}</span>}
                        {r.note && <><br /><span className="small muted">{r.note}</span></>}
                      </td>
                      <td><button className="btn btn-sm" onClick={() => setEditing(r)}>Noter l’appel</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <FollowDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSave={async (status, note, nextCall) => {
            await store.setFollowup(editing.orgId, status, note, nextCall);
            setEditing(null);
            toast('Suivi enregistré');
            await load();
          }}
        />
      )}
    </>
  );
}

function FollowDialog({ row, onClose, onSave }: { row: SignupRow; onClose: () => void; onSave: (s: FollowStatus, note: string | null, next: string | null) => Promise<void> }) {
  const [status, setStatus] = useState<FollowStatus>(row.status === 'a_appeler' ? 'onboarde' : row.status);
  const [note, setNote] = useState(row.note ?? '');
  const [next, setNext] = useState(row.nextCall ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsDate = status === 'rappeler' || status === 'injoignable';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSave(status, note.trim() || null, needsDate && next ? next : null);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Appel : ${row.name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          Résultat
          <select value={status} onChange={(e) => setStatus(e.target.value as FollowStatus)}>
            {(Object.keys(FOLLOW_LABEL) as FollowStatus[]).map((k) => <option key={k} value={k}>{FOLLOW_LABEL[k]}</option>)}
          </select>
        </label>
        {needsDate && (
          <label className="field">
            Rappeler le
            <input type="date" value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
        )}
        <label className="field">
          Note
          <textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Taille de la flotte, besoins, objections, prochaine étape…" />
        </label>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy}>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
