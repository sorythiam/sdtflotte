import { useState, type FormEvent } from 'react';
import { money } from '../domain/format';
import { ErrorBox } from '../components/ui';
import type { Rate } from '../domain/types';
import { seasonLabel, seasonOn } from '../domain/tariff';
import { useData } from '../state/DataContext';

const cols: [Exclude<keyof Rate, 'id' | 'category'>, string][] = [
  ['halfDay', 'Demi-journée'],
  ['daily', 'Jour (1–6 j)'],
  ['weekly', 'Jour (7–29 j)'],
  ['monthly', 'Jour (30 j et +)'],
  ['driverDaily', 'Chauffeur / jour'],
  ['kmPerDay', 'Km inclus / jour'],
  ['extraKm', 'Km en plus'],
  ['caution', 'Caution'],
];

export function Rates() {
  const { data, store, refresh, toast, can } = useData();
  const editable = can('direction');
  const [draft, setDraft] = useState<Record<string, Rate>>({});
  const [error, setError] = useState<string | null>(null);
  const [newCat, setNewCat] = useState('');
  const rows = data.rates.map((r) => draft[r.id] ?? r).sort((a, b) => a.daily - b.daily);
  const dirty = Object.keys(draft).length > 0;

  async function save() {
    setError(null);
    try {
      for (const r of Object.values(draft)) {
        const { id, ...rest } = r;
        await store.update('rates', id, rest);
      }
      setDraft({});
      await refresh();
      toast('Tarifs enregistrés. Ils s’appliquent aux nouvelles réservations.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function add() {
    const name = newCat.trim();
    if (!name) return;
    if (data.rates.some((r) => r.category.toLowerCase() === name.toLowerCase())) return setError('Cette catégorie existe déjà.');
    try {
      await store.insert('rates', { category: name, halfDay: 0, daily: 0, weekly: 0, monthly: 0, driverDaily: 0, kmPerDay: 250, extraKm: 0, caution: 0 });
      setNewCat('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Tarifs</h1>
          <p className="muted small">Prix en FCFA. Une modification ne change pas les contrats déjà créés.</p>
        </div>
        {editable && <button className="btn btn-primary" disabled={!dirty} onClick={save}>Enregistrer les tarifs</button>}
      </header>
      <ErrorBox error={error} />
      <section className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Catégorie</th>
                {cols.map(([, l]) => <th key={l} className="right">{l}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.category}</strong></td>
                  {cols.map(([k, l]) => (
                    <td key={k} className="right">
                      <input
                        type="number"
                        min={0}
                        aria-label={`${r.category}, ${l}`}
                        disabled={!editable}
                        value={r[k] ?? 0}
                        onChange={(e) => setDraft({ ...draft, [r.id]: { ...r, [k]: Number(e.target.value) } })}
                        style={{ width: 110, textAlign: 'right', fontFamily: 'var(--font-sans)', fontSize: 15, padding: '8px 10px', minHeight: 40, border: '1px solid var(--sable-line)', borderRadius: 'var(--radius-sm)' }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="row">
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center' }}>
              <input placeholder="Nouvelle catégorie" value={newCat} onChange={(e) => setNewCat(e.target.value)} style={{ width: 240 }} />
            </label>
            <button className="btn" onClick={add}>Ajouter la catégorie</button>
          </div>
        )}
        <span className="hint">Demi-journée : 6 heures au plus ; 0 = non proposée. Le chauffeur est compté pour moitié.</span>
      </section>
      <Seasons />
      <Packages />
    </>
  );
}

/** Forfaits : transferts et excursions à prix fixe, chauffeur compris. */
function Packages() {
  const { data, store, refresh, toast, can } = useData();
  const editable = can('direction');
  const [f, setF] = useState({ label: '', category: data.rates[0]?.category ?? '', price: '', hours: '4' });
  const [error, setError] = useState<string | null>(null);
  const list = data.packages.slice().sort((a, b) => a.label.localeCompare(b.label) || a.price - b.price);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const price = Math.round(Number(f.price));
    const hours = Math.round(Number(f.hours));
    if (f.label.trim().length < 2) return setError('Donnez un nom au forfait.');
    if (!(price > 0)) return setError('Indiquez le prix.');
    if (!(hours >= 1 && hours <= 72)) return setError('Durée entre 1 et 72 heures.');
    try {
      await store.insert('packages', { label: f.label.trim(), category: f.category, price, hours, active: true, createdAt: new Date().toISOString() });
      setF({ ...f, label: '', price: '' });
      await refresh();
      toast('Forfait ajouté');
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function toggle(id: string, active: boolean) {
    await store.update('packages', id, { active });
    await refresh();
  }

  return (
    <section className="card" aria-labelledby="forfaits">
      <h2 id="forfaits">Forfaits : transferts et excursions</h2>
      <p className="small muted" style={{ margin: 0 }}>Prix fixe chauffeur compris, kilométrage non compté. Ex. : transfert aéroport AIBD, excursion au Lac Rose.</p>
      {list.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Forfait</th><th>Catégorie</th><th className="right">Durée</th><th className="right">Prix</th><th>État</th></tr></thead>
            <tbody>
              {list.map((k) => (
                <tr key={k.id} style={k.active ? undefined : { opacity: 0.55 }}>
                  <td><strong>{k.label}</strong></td>
                  <td>{k.category}</td>
                  <td className="right">{k.hours} h</td>
                  <td className="right num">{money(k.price)}</td>
                  <td>{editable ? <button className="btn btn-sm btn-ghost" onClick={() => toggle(k.id, !k.active)}>{k.active ? 'Retirer' : 'Remettre'}</button> : k.active ? 'Proposé' : 'Retiré'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editable && (
        <form className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={add}>
          <label className="field" style={{ flex: '2 1 220px' }}>Nom<input value={f.label} maxLength={120} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Transfert AIBD ↔ Dakar" /></label>
          <label className="field" style={{ flex: '1 1 140px' }}>Catégorie
            <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{data.rates.map((r) => <option key={r.id}>{r.category}</option>)}</select>
          </label>
          <label className="field" style={{ flex: '1 1 110px' }}>Prix (FCFA)<input type="number" min={1} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
          <label className="field" style={{ flex: '1 1 90px' }}>Durée (h)<input type="number" min={1} max={72} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></label>
          <button className="btn">Ajouter le forfait</button>
        </form>
      )}
      <ErrorBox error={error} />
    </section>
  );
}

const frShort = (d: string, recurring: boolean) =>
  new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', recurring ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' });

/** Saisons : majoration ou remise en % sur la location (pas sur le chauffeur ni sur un prix négocié). */
function Seasons() {
  const { data, store, refresh, toast, can, now } = useData();
  const editable = can('direction');
  const y = now.getFullYear();
  const [f, setF] = useState({ label: '', start: '', end: '', percent: '', recurring: true });
  const [error, setError] = useState<string | null>(null);
  const list = data.seasons.slice().sort((a, b) => a.startDate.slice(5).localeCompare(b.startDate.slice(5)));
  const today = now.toISOString().slice(0, 10);
  const current = seasonOn(data.seasons, today);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const percent = Math.round(Number(f.percent));
    if (f.label.trim().length < 2) return setError('Donnez un nom à la saison.');
    if (!f.start || !f.end) return setError('Indiquez le début et la fin.');
    if (!f.recurring && f.end < f.start) return setError('La fin doit être après le début.');
    if (!percent || percent < -50 || percent > 200) return setError('Pourcentage entre −50 et +200, différent de 0.');
    try {
      await store.insert('seasons', { label: f.label.trim(), startDate: f.start, endDate: f.end, recurring: f.recurring, percent, active: true, createdAt: new Date().toISOString() });
      setF({ label: '', start: '', end: '', percent: '', recurring: true });
      await refresh();
      toast('Saison ajoutée');
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function toggle(id: string, active: boolean) {
    await store.update('seasons', id, { active });
    await refresh();
  }

  return (
    <section className="card" aria-labelledby="saisons">
      <h2 id="saisons">Saisons tarifaires</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Majoration (haute saison, fêtes, Magal) ou remise (basse saison) sur le prix de la location, appliquée jour par jour.
        Le chauffeur, les frais de mission et les prix négociés d’un contrat cadre ne changent pas. Si deux saisons se chevauchent, la plus courte l’emporte.
      </p>
      <p className="small" style={{ margin: 0 }}>
        Aujourd’hui : <strong>{current ? seasonLabel(current) : 'tarif normal'}</strong>
      </p>
      {list.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Saison</th><th>Période</th><th className="right">Variation</th><th>État</th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} style={s.active ? undefined : { opacity: 0.55 }}>
                  <td><strong>{s.label}</strong></td>
                  <td>du {frShort(s.startDate, s.recurring)} au {frShort(s.endDate, s.recurring)}{s.recurring ? ', chaque année' : ''}</td>
                  <td className="right num" style={{ color: s.percent > 0 ? 'var(--ocre-text)' : 'var(--success)', fontWeight: 600 }}>{s.percent > 0 ? '+' : '−'}{Math.abs(s.percent)} %</td>
                  <td>{editable ? <button className="btn btn-sm btn-ghost" onClick={() => toggle(s.id, !s.active)}>{s.active ? 'Désactiver' : 'Réactiver'}</button> : s.active ? 'Active' : 'Inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editable && (
        <form className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={add}>
          <label className="field" style={{ flex: '2 1 200px' }}>Nom<input value={f.label} maxLength={80} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder={`Grand Magal ${y + 1}`} /></label>
          <label className="field" style={{ flex: '1 1 150px' }}>Début<input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
          <label className="field" style={{ flex: '1 1 150px' }}>Fin (incluse)<input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
          <label className="field" style={{ flex: '1 1 110px' }}>Variation (%)<input type="number" min={-50} max={200} value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} placeholder="+20 ou -10" /></label>
          <label className="check" style={{ flex: '1 1 160px' }}><input type="checkbox" checked={f.recurring} onChange={(e) => setF({ ...f, recurring: e.target.checked })} />Chaque année</label>
          <button className="btn">Ajouter la saison</button>
        </form>
      )}
      {editable && <span className="hint">Fête à date mobile (Magal, Tabaski) : décochez « Chaque année » et saisissez les dates de l’année.</span>}
      <ErrorBox error={error} />
    </section>
  );
}
