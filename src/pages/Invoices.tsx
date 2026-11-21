import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty } from '../components/ui';
import { payState, payStatusLabel, type PayStatus } from '../domain/billing';
import { money } from '../domain/format';
import { useData } from '../state/DataContext';

type Filter = 'toutes' | 'a_encaisser' | 'en_retard' | 'payees' | 'avoirs';
const filters: [Filter, string][] = [
  ['a_encaisser', 'À encaisser'],
  ['en_retard', 'En retard'],
  ['payees', 'Payées'],
  ['avoirs', 'Avoirs'],
  ['toutes', 'Toutes'],
];

export function Invoices() {
  const { data, now } = useData();
  const [filter, setFilter] = useState<Filter>('a_encaisser');
  const [q, setQ] = useState('');

  // Le statut de paiement se suit par contrat : une facture et sa facture de frais partagent les encaissements.
  const states = useMemo(() => {
    const m = new Map<string, PayStatus>();
    for (const r of data.reservations) m.set(r.id, payState(r, data.invoices, data.payments, now).status);
    return m;
  }, [data, now]);
  const remaining = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data.reservations) m.set(r.id, payState(r, data.invoices, data.payments, now).remaining);
    return m;
  }, [data, now]);

  const list = data.invoices
    .filter((i) => {
      const st = states.get(i.reservationId);
      if (filter === 'avoirs') return i.kind === 'avoir';
      if (i.kind === 'avoir' && filter !== 'toutes') return false;
      if (filter === 'a_encaisser') return st === 'non_payee' || st === 'acompte' || st === 'en_retard';
      if (filter === 'en_retard') return st === 'en_retard';
      if (filter === 'payees') return st === 'payee';
      return true;
    })
    .filter((i) => `${i.number} ${i.billTo.name}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.number.localeCompare(a.number));

  const toCollect = [...new Set(data.invoices.filter((i) => i.kind !== 'avoir').map((i) => i.reservationId))]
    .reduce((s, rid) => s + (remaining.get(rid) ?? 0), 0);
  const late = [...states.values()].filter((s) => s === 'en_retard').length;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Factures</h1>
          <p className="small muted" style={{ margin: 0 }}>
            Établies automatiquement à la validation des réservations. Reste à encaisser : <strong>{money(toCollect)}</strong>
            {late > 0 && <> · <span style={{ color: 'var(--danger)' }}>{late} contrat(s) en retard de paiement</span></>}
          </p>
        </div>
      </header>
      <div className="row">
        <div className="tabs" role="group" aria-label="Filtre">
          {filters.map(([k, l]) => (
            <button key={k} type="button" aria-selected={filter === k} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <input type="search" aria-label="Rechercher une facture" placeholder="N° ou client…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} />
      </div>
      <section className="card">
        {list.length === 0 ? (
          <Empty>Aucune facture dans cette vue.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>N°</th><th>Client</th><th>Émise le</th><th>Échéance</th><th className="right">Montant TTC</th><th>Paiement du contrat</th></tr>
              </thead>
              <tbody>
                {list.map((i) => {
                  const st = states.get(i.reservationId) ?? 'non_payee';
                  return (
                    <tr key={i.id}>
                      <td><Link to={`/factures/${i.id}`}><strong>{i.number}</strong></Link>{i.kind === 'complement' && <><br /><span className="muted">frais au retour</span></>}</td>
                      <td>{i.billTo.name}</td>
                      <td>{new Date(i.issueDate + 'T12:00:00').toLocaleDateString('fr-FR')}</td>
                      <td>{i.kind === 'avoir' ? '—' : new Date(i.dueDate + 'T12:00:00').toLocaleDateString('fr-FR')}</td>
                      <td className="right num" style={{ whiteSpace: 'nowrap' }}>{money(i.totalTtc)}</td>
                      <td>
                        {i.kind === 'avoir' ? <span className="badge badge-muted">Avoir</span> : <span className={`badge ${payStatusLabel[st][1]}`}>{payStatusLabel[st][0]}</span>}
                        {i.kind !== 'avoir' && (remaining.get(i.reservationId) ?? 0) > 0 && <span className="small muted"> reste {money(remaining.get(i.reservationId)!)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
