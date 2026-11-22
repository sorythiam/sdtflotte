import { Link, useNavigate } from 'react-router-dom';
import { VerificationBadge } from '../components/VerificationBadge';
import { termsFor } from '../domain/billing';
import { useBilling } from '../state/useBilling';
import { useState, type FormEvent } from 'react';
import { ImportDialog } from '../components/ImportDialog';
import { Empty, ErrorBox, Modal, ScoreBadge } from '../components/ui';
import { money } from '../domain/format';
import { emptyClient, legalLine, normalizeClient, taxIdLabel, validateClient, type ClientInput } from '../domain/clients';
import type { ClientKind, ClientScore } from '../domain/types';
import { useData } from '../state/DataContext';

export function Clients() {
  const { data, can, session } = useData();
  const taxLabel = taxIdLabel(session!.org.country);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const editable = can('direction', 'agent');
  const go = useNavigate();
  const stats = (id: string) => {
    const rs = data.reservations.filter((r) => r.clientId === id && r.status !== 'annulee');
    return { count: rs.length, revenue: rs.reduce((s, r) => s + r.total + r.fees, 0) };
  };
  const list = data.clients
    .filter((c) => `${c.name} ${c.phone} ${c.email ?? ''} ${c.contactName ?? ''} ${c.contactPhone ?? ''} ${c.taxId ?? ''}`.toLowerCase().includes(q.toLowerCase()))
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
        <input type="search" aria-label="Rechercher un client" placeholder="Rechercher un nom, un téléphone, un contact, un NINEA…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <section className="card">
        {list.length === 0 ? (
          <Empty>Aucun client.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Client</th><th>Contact</th><th className="right">Locations</th><th className="right">Chiffre d’affaires</th><th>Dossier</th><th>Scoring</th></tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const s = stats(c.id);
                  return (
                    <tr key={c.id} className="clickable" onClick={() => go(`/clients/${c.id}`)}>
                      <td>
                        <Link to={`/clients/${c.id}`} onClick={(e) => e.stopPropagation()}><strong>{c.name}</strong></Link>
                        <br />
                        <span className="muted">
                          {c.kind === 'entreprise' ? ['Entreprise', legalLine(c, taxLabel)].filter(Boolean).join(' · ') : 'Particulier'}
                        </span>
                      </td>
                      <td>
                        {c.kind === 'entreprise' && c.contactName ? (
                          <>
                            {c.contactName}{c.contactRole ? `, ${c.contactRole}` : ''}
                            <br />
                            <span className="muted">{c.contactPhone ?? c.phone}{c.contactEmail ? ` · ${c.contactEmail}` : ''}</span>
                          </>
                        ) : (
                          <>{c.phone}{c.email && <><br /><span className="muted">{c.email}</span></>}</>
                        )}
                      </td>
                      <td className="right num">{s.count}</td>
                      <td className="right num">{money(s.revenue)}</td>
                      <td><VerificationBadge client={c} /></td>
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

export function ClientForm({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, store, refresh, toast, session } = useData();
  const existing = data.clients.find((c) => c.id === id);
  const [f, setF] = useState<ClientInput>(() => ({ ...emptyClient(), ...(existing ?? {}) }));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ClientInput>(k: K, v: ClientInput[K]) => setF({ ...f, [k]: v });
  const txt = (k: keyof ClientInput) => ({
    value: (f[k] as string | null | undefined) ?? '',
    onChange: (e: { target: { value: string } }) => set(k, (e.target.value || null) as never),
  });
  const company = f.kind === 'entreprise';
  const billing = useBilling().settings;
  const taxLabel = taxIdLabel(session!.org.country);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const err = validateClient(f);
    if (err) return setError(err);
    try {
      const row = normalizeClient(f);
      if (row.score === 'fiable') row.scoreReason = null;
      // Une pièce modifiée après validation doit être revérifiée.
      if (existing?.verifiedAt && (row.idNumber !== existing.idNumber || row.licenseExpiry !== existing.licenseExpiry)) {
        row.verifiedAt = null;
        row.verifiedBy = null;
      }
      if (existing) await store.update('clients', id, row);
      else await store.insert('clients', row);
      await refresh();
      toast(existing ? 'Client mis à jour' : 'Client ajouté');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={existing ? existing.name : 'Nouveau client'} onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="tabs" role="radiogroup" aria-label="Type de client">
          {(['particulier', 'entreprise'] as ClientKind[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={f.kind === k} aria-selected={f.kind === k} onClick={() => set('kind', k)}>
              {k === 'particulier' ? 'Particulier' : 'Entreprise'}
            </button>
          ))}
        </div>

        {company ? (
          <>
            <fieldset className="stack form-group">
              <legend>Entreprise</legend>
              <div className="grid-2">
                <label className="field">Raison sociale<input required value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="organization" /></label>
                <label className="field">{taxLabel}<input {...txt('taxId')} /></label>
                <label className="field">RCCM<input {...txt('tradeRegister')} placeholder="SN-DKR-2020-B-12345" /></label>
                <label className="field">Téléphone (standard)<input type="tel" required value={f.phone} onChange={(e) => set('phone', e.target.value)} /></label>
                <label className="field">Email de l’entreprise (factures)<input type="email" {...txt('email')} /></label>
                <label className="field">Adresse<input required {...txt('address')} autoComplete="street-address" /></label>
                <label className="field">Ville<input {...txt('city')} autoComplete="address-level2" /></label>
              </div>
            </fieldset>
            <fieldset className="stack form-group">
              <legend>Personne de contact</legend>
              <div className="grid-2">
                <label className="field">Nom et prénom<input required {...txt('contactName')} /></label>
                <label className="field">Fonction<input {...txt('contactRole')} placeholder="Responsable logistique" /></label>
                <label className="field">Téléphone<input type="tel" required {...txt('contactPhone')} /></label>
                <label className="field">Email<input type="email" {...txt('contactEmail')} /></label>
                <label className="field">N° de pièce d’identité<input {...txt('idNumber')} /></label>
                <label className="field">Permis du conducteur valide jusqu’au<input type="date" {...txt('licenseExpiry')} /></label>
              </div>
              <span className="hint">Pièce et permis : ceux de la personne qui signe le contrat ou conduit, pour les locations sans chauffeur.</span>
            </fieldset>
          </>
        ) : (
          <div className="grid-2">
            <label className="field">Nom et prénom<input required value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" /></label>
            <label className="field">Téléphone<input type="tel" required value={f.phone} onChange={(e) => set('phone', e.target.value)} /></label>
            <label className="field">Email<input type="email" {...txt('email')} /></label>
            <label className="field">N° de pièce d’identité<input {...txt('idNumber')} /></label>
            <label className="field">Permis valide jusqu’au<input type="date" {...txt('licenseExpiry')} /></label>
            <label className="field">Adresse<input {...txt('address')} autoComplete="street-address" /></label>
            <label className="field">Ville<input {...txt('city')} autoComplete="address-level2" /></label>
          </div>
        )}

        <fieldset className="form-group stack">
          <legend>Modalités de paiement de ce client (facultatif)</legend>
          <div className="grid-2">
            <label className="field">
              Acompte (%)
              <input type="number" min={0} max={100} placeholder={`${billing.depositPercent} (par défaut)`} value={f.depositPercent ?? ''}
                onChange={(e) => set('depositPercent', e.target.value === '' ? null : Math.min(100, Math.max(0, Math.round(Number(e.target.value)))))} />
            </label>
            <label className="field">
              Délai de paiement (jours)
              <input type="number" min={0} max={180} placeholder={`${company ? billing.companyDueDays : 0} (par défaut)`} value={f.dueDays ?? ''}
                onChange={(e) => set('dueDays', e.target.value === '' ? null : Math.min(180, Math.max(0, Math.round(Number(e.target.value)))))} />
            </label>
          </div>
          <span className="hint">Appliqué aux prochaines factures : {termsFor(billing, f).label.toLowerCase()}.</span>
        </fieldset>
        <label className="field">
          Scoring
          <select value={f.score} onChange={(e) => set('score', e.target.value as ClientScore)}>
            <option value="fiable">Fiable</option><option value="surveiller">À surveiller</option><option value="blacklist">Blacklisté (réservation impossible)</option>
          </select>
        </label>
        {f.score !== 'fiable' && (
          <label className="field">
            Motif
            <input {...txt('scoreReason')} maxLength={500} placeholder="Ex. : impayé de mars, véhicule rendu endommagé" />
            <span className="hint">Visible par l’équipe sur la fiche et au moment du départ.</span>
          </label>
        )}
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary">{existing ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </form>
    </Modal>
  );
}
