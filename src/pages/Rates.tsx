import { useState, type FormEvent } from 'react';
import { money } from '../domain/format';
import { ErrorBox } from '../components/ui';
import type { Rate } from '../domain/types';
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
