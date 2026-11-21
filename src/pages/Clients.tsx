import { useState, type FormEvent } from 'react';
import { ImportDialog } from '../components/ImportDialog';
import { Empty, ErrorBox, Modal, ScoreBadge } from '../components/ui';
import { money } from '../domain/format';
import type { Client, ClientKind, ClientScore } from '../domain/types';
import { useData } from '../state/DataContext';

export function Clients() {
  const { data, can } = useData();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const editable = can('direction', 'agent');
  const stats = (id: string) => {
    const rs = data.reservations.filter((r) => r.clientId === id && r.status !== 'annulee');
    return { count: rs.length, revenue: rs.reduce((s, r) => s + r.total + r.fees, 0) };
  };
  const list = data.clients
    .filter((c) => `${c.name} ${c.phone} ${c.email ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Clients</h1>
          <p className="muted small">{data.clients.length} client(s)</p>
        </div>
        {editable && (
          <div className="row">
            <button className="btn" onClick={() => setImporting(true)}>Importer depuis Excel</button>
            <button className="btn btn-primary" onClick={() => setEditing('nouveau')}>Ajouter un client</button>
          </div>
        )}
      </header>
      <label className="field">
        <input type="search" aria-label="Rechercher un client" placeholder="Rechercher un nom, un téléphone…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <section className="card">
        {list.length === 0 ? (
          <Empty>Aucun client.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Client</th><th>Contact</th><th className="right">Locations</th><th className="right">Chiffre d’affaires</th><th>Scoring</th></tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const s = stats(c.id);
                  return (
                    <tr key={c.id} className={editable ? 'clickable' : undefined} onClick={() => editable && setEditing(c.id)}>
                      <td><strong>{c.name}</strong><br /><span className="muted">{c.kind === 'entreprise' ? 'Entreprise' : 'Particulier'}</span></td>
                      <td>{c.phone}{c.email && <><br /><span className="muted">{c.email}</span></>}</td>
                      <td className="right num">{s.count}</td>
                      <td className="right num">{money(s.revenue)}</td>
                      <td><ScoreBadge score={c.score} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing && <ClientForm id={editing} onClose={() => setEditing(null)} />}
      {importing && <ImportDialog kind="clients" onClose={() => setImporting(false)} />}
    </>
  );
}

function ClientForm({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, store, refresh, toast } = useData();
  const existing = data.clients.find((c) => c.id === id);
  const [f, setF] = useState<Omit<Client, 'id'>>(
    existing ?? { kind: 'particulier', name: '', phone: '', email: null, idNumber: null, licenseExpiry: null, score: 'fiable' },
  );
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      if (existing) await store.update('clients', id, f);
      else await store.insert('clients', f);
      await refresh();
      toast(existing ? 'Client mis à jour' : 'Client ajouté');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={existing ? existing.name : 'Nouveau client'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">
            Type
            <select value={f.kind} onChange={(e) => set('kind', e.target.value as ClientKind)}>
              <option value="particulier">Particulier</option><option value="entreprise">Entreprise</option>
            </select>
          </label>
          <label className="field">Nom ou raison sociale<input required value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="field">Téléphone<input type="tel" required value={f.phone} onChange={(e) => set('phone', e.target.value)} /></label>
          <label className="field">Email<input type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value || null)} /></label>
          <label className="field">N° de pièce d’identité<input value={f.idNumber ?? ''} onChange={(e) => set('idNumber', e.target.value || null)} /></label>
          <label className="field">Permis valide jusqu’au<input type="date" value={f.licenseExpiry ?? ''} onChange={(e) => set('licenseExpiry', e.target.value || null)} /></label>
          <label className="field">
            Scoring
            <select value={f.score} onChange={(e) => set('score', e.target.value as ClientScore)}>
              <option value="fiable">Fiable</option><option value="surveiller">À surveiller</option><option value="blacklist">Blacklisté (réservation impossible)</option>
            </select>
          </label>
        </div>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary">{existing ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </form>
    </Modal>
  );
}
