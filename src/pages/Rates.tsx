import { useState } from 'react';
import { ErrorBox } from '../components/ui';
import type { Rate } from '../domain/types';
import { useData } from '../state/DataContext';

const cols: [keyof Omit<Rate, 'id' | 'category'>, string][] = [
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
      await store.insert('rates', { category: name, daily: 0, weekly: 0, monthly: 0, driverDaily: 0, kmPerDay: 250, extraKm: 0, caution: 0 });
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
                        value={r[k]}
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
      </section>
    </>
  );
}
