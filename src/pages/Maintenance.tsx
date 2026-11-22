import { useState, type FormEvent } from 'react';
import { Empty, ErrorBox, Modal } from '../components/ui';
import { dateShort, fromLocalInput, money, num, toLocalInput } from '../domain/format';
import { PLAN_TEMPLATES, planDue, type PlanDue } from '../domain/maintenancePlan';
import { findConflicts } from '../domain/rules';
import { useData } from '../state/DataContext';

const stateBadge: Record<PlanDue['state'], [string, string]> = {
  depasse: ['À faire', 'badge-danger'],
  bientot: ['Bientôt', 'badge-warning'],
  ok: ['À jour', 'badge-success'],
};

export function Maintenance() {
  const { data, can, now, store, refresh } = useData();
  const [open, setOpen] = useState<null | { planId?: string; vehicleId?: string; label?: string }>(null);
  const [planning, setPlanning] = useState(false);
  const veh = new Map(data.vehicles.map((v) => [v.id, v]));
  const list = data.maintenances.slice().sort((a, b) => b.start.localeCompare(a.start));
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
  const yearCost = data.maintenances.filter((m) => m.start >= yearStart).reduce((s, m) => s + m.cost, 0);
  const order = { depasse: 0, bientot: 1, ok: 2 };
  const dues = data.maintenance_plans
    .filter((p) => p.active && veh.get(p.vehicleId) && !veh.get(p.vehicleId)!.outOfService)
    .map((p) => planDue(p, veh.get(p.vehicleId)!, now))
    .sort((a, b) => order[a.state] - order[b.state] || (a.kmLeft ?? 1e9) - (b.kmLeft ?? 1e9));
  const canPlan = can('direction', 'mecanicien');

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Entretiens</h1>
          <p className="muted small">Coût depuis le 1er janvier : {money(yearCost)}</p>
        </div>
        {canPlan && (
          <div className="row">
            <button className="btn" onClick={() => setPlanning(true)}>Nouveau plan d’entretien</button>
            <button className="btn btn-primary" onClick={() => setOpen({})}>Planifier une intervention</button>
          </div>
        )}
      </header>

      <section className="card" aria-labelledby="plans">
        <h2 id="plans">Entretien périodique</h2>
        <p className="small muted" style={{ margin: 0 }}>Alerte à 1 000 km ou 15 jours de l’échéance. L’échéance repart de la dernière intervention enregistrée sur le plan.</p>
        {dues.length === 0 ? (
          <Empty>Aucun plan. Créez-en un par véhicule : vidange tous les 10 000 km ou 6 mois, révision annuelle…</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Véhicule</th><th>Entretien</th><th>Rythme</th><th>Échéance</th><th>État</th><th /></tr></thead>
              <tbody>
                {dues.map((d) => {
                  const v = veh.get(d.plan.vehicleId)!;
                  return (
                    <tr key={d.plan.id}>
                      <td><strong>{v.brand} {v.model}</strong><br /><span className="muted">{v.plate} · {num(v.mileage)} km</span></td>
                      <td>{d.plan.label}</td>
                      <td className="small">{[d.plan.everyKm ? `${num(d.plan.everyKm)} km` : null, d.plan.everyMonths ? `${d.plan.everyMonths} mois` : null].filter(Boolean).join(' ou ')}</td>
                      <td className="small">
                        {[d.nextKm !== null ? `${num(d.nextKm)} km` : null, d.nextDate ? dateShort(d.nextDate) : null].filter(Boolean).join(' ou ')}
                        <br /><span className="muted">{d.text}</span>
                      </td>
                      <td><span className={`badge ${stateBadge[d.state][1]}`}>{stateBadge[d.state][0]}</span></td>
                      <td className="right">
                        {canPlan && (
                          <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            <button className="btn btn-sm" onClick={() => setOpen({ planId: d.plan.id, vehicleId: v.id, label: d.plan.label })}>Planifier</button>
                            <button className="btn btn-sm btn-ghost" onClick={async () => { await store.update('maintenance_plans', d.plan.id, { active: false }); await refresh(); }}>Arrêter</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="interv">
        <h2 id="interv">Interventions</h2>
        {list.length === 0 ? (
          <Empty>Aucune intervention enregistrée.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Véhicule</th><th>Intervention</th><th>Période</th><th className="right">Coût</th><th>État</th></tr></thead>
              <tbody>
                {list.map((m) => {
                  const v = veh.get(m.vehicleId);
                  const state = Date.parse(m.end) < now.getTime() ? 'Terminé' : Date.parse(m.start) <= now.getTime() ? 'En cours' : 'Planifié';
                  return (
                    <tr key={m.id}>
                      <td><strong>{v ? `${v.brand} ${v.model}` : '—'}</strong><br /><span className="muted">{v?.plate}</span></td>
                      <td>
                        {m.label}
                        {(m.provider || m.parts || m.mileage) && (
                          <><br /><span className="muted small">{[m.provider, m.parts, m.mileage ? `${num(m.mileage)} km` : null].filter(Boolean).join(' · ')}</span></>
                        )}
                      </td>
                      <td>{dateShort(m.start)} → {dateShort(m.end)}</td>
                      <td className="right num">{money(m.cost)}</td>
                      <td><span className={`badge ${state === 'En cours' ? 'badge-muted' : state === 'Planifié' ? 'badge-outline' : 'badge-success'}`}>{state}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {open && <MaintenanceForm init={open} onClose={() => setOpen(null)} />}
      {planning && <PlanForm onClose={() => setPlanning(false)} />}
    </>
  );
}

function MaintenanceForm({ init, onClose }: { init: { planId?: string; vehicleId?: string; label?: string }; onClose: () => void }) {
  const { data, store, refresh, toast, now } = useData();
  const start0 = new Date(now);
  start0.setDate(start0.getDate() + 1);
  start0.setHours(8, 0, 0, 0);
  const [vehicleId, setVehicleId] = useState(init.vehicleId ?? '');
  const [planId, setPlanId] = useState(init.planId ?? '');
  const [label, setLabel] = useState(init.label ?? '');
  const [start, setStart] = useState(toLocalInput(start0.toISOString()));
  const [end, setEnd] = useState(toLocalInput(new Date(start0.getTime() + 10 * 3600000).toISOString()));
  const [cost, setCost] = useState('0');
  const [provider, setProvider] = useState('');
  const [parts, setParts] = useState('');
  const vehicle = data.vehicles.find((v) => v.id === vehicleId);
  const [mileage, setMileage] = useState(vehicle ? String(vehicle.mileage) : '');
  const [error, setError] = useState<string | null>(null);
  const plans = data.maintenance_plans.filter((p) => p.vehicleId === vehicleId && p.active);
  const clash = vehicleId && start && end
    ? findConflicts(vehicleId, fromLocalInput(start), fromLocalInput(end), data.reservations, []).map((c) => c.label)
    : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!(Date.parse(fromLocalInput(end)) > Date.parse(fromLocalInput(start)))) return setError('La fin doit être après le début.');
    const km = mileage ? Math.round(Number(mileage)) : null;
    try {
      await store.insert('maintenances', {
        vehicleId, label, start: fromLocalInput(start), end: fromLocalInput(end), cost: Number(cost) || 0,
        provider: provider.trim() || null, parts: parts.trim() || null, mileage: km, planId: planId || null,
      });
      // L'échéance du plan repart de cette intervention.
      if (km && vehicle && km > vehicle.mileage) await store.update('vehicles', vehicle.id, { mileage: km });
      if (planId) await store.update('maintenance_plans', planId, { lastKm: km ?? vehicle?.mileage ?? null, lastDate: fromLocalInput(start).slice(0, 10) });
      await refresh();
      toast('Intervention planifiée, le véhicule est bloqué sur cette période');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title="Planifier une intervention" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          Véhicule
          <select required value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); setPlanId(''); const v = data.vehicles.find((x) => x.id === e.target.value); setMileage(v ? String(v.mileage) : ''); }}>
            <option value="">Choisir</option>
            {data.vehicles.map((v) => <option key={v.id} value={v.id}>{v.brand} {v.model} · {v.plate}</option>)}
          </select>
        </label>
        {plans.length > 0 && (
          <label className="field">
            Plan d’entretien concerné
            <select value={planId} onChange={(e) => { setPlanId(e.target.value); const p = plans.find((x) => x.id === e.target.value); if (p && !label) setLabel(p.label); }}>
              <option value="">Aucun (intervention ponctuelle)</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
        )}
        <label className="field">Intervention<input required placeholder="Vidange, freins, pneus…" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <div className="grid-2">
          <label className="field">Début<input type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="field">Fin<input type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <label className="field">Coût (FCFA)<input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} /></label>
          <label className="field">Kilométrage<input type="number" min={0} value={mileage} onChange={(e) => setMileage(e.target.value)} /></label>
          <label className="field">Garage ou prestataire<input maxLength={120} value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Ex. : Garage CFAO Motors Dakar" /></label>
        </div>
        <label className="field">Pièces changées<input maxLength={500} value={parts} onChange={(e) => setParts(e.target.value)} placeholder="Filtre à huile, 5 L d’huile 10W40…" /></label>
        {clash.length > 0 && <div className="notice">Attention : ce véhicule est réservé sur cette période ({clash.join(', ')}). Déplacez la réservation ou l’entretien.</div>}
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary">Planifier</button>
        </div>
      </form>
    </Modal>
  );
}

function PlanForm({ onClose }: { onClose: () => void }) {
  const { data, store, refresh, toast, now } = useData();
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [tpl, setTpl] = useState(0);
  const [label, setLabel] = useState(PLAN_TEMPLATES[0].label);
  const [everyKm, setEveryKm] = useState(String(PLAN_TEMPLATES[0].everyKm ?? ''));
  const [everyMonths, setEveryMonths] = useState(String(PLAN_TEMPLATES[0].everyMonths ?? ''));
  const [lastKm, setLastKm] = useState('');
  const [lastDate, setLastDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const vehicles = data.vehicles.filter((v) => !v.outOfService);

  function pick(i: number) {
    setTpl(i);
    const t = PLAN_TEMPLATES[i];
    if (t) {
      setLabel(t.label);
      setEveryKm(String(t.everyKm ?? ''));
      setEveryMonths(String(t.everyMonths ?? ''));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const km = everyKm ? Math.round(Number(everyKm)) : null;
    const months = everyMonths ? Math.round(Number(everyMonths)) : null;
    if (!vehicleIds.length) return setError('Choisissez au moins un véhicule.');
    if (!km && !months) return setError('Indiquez un rythme en kilomètres ou en mois.');
    if (km !== null && (km < 500 || km > 200000)) return setError('Entre 500 et 200 000 km.');
    if (months !== null && (months < 1 || months > 60)) return setError('Entre 1 et 60 mois.');
    try {
      for (const id of vehicleIds) {
        const v = data.vehicles.find((x) => x.id === id)!;
        await store.insert('maintenance_plans', {
          vehicleId: id, label: label.trim(), everyKm: km, everyMonths: months,
          // Sans dernière intervention connue, on part du kilométrage et de la date du jour.
          lastKm: lastKm ? Math.round(Number(lastKm)) : v.mileage, lastDate: lastDate || now.toISOString().slice(0, 10),
          active: true, createdAt: new Date().toISOString(),
        });
      }
      await refresh();
      toast(vehicleIds.length > 1 ? `${vehicleIds.length} plans créés` : 'Plan créé');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title="Nouveau plan d’entretien" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          Modèle
          <select value={tpl} onChange={(e) => pick(Number(e.target.value))}>
            {PLAN_TEMPLATES.map((t, i) => <option key={t.label} value={i}>{t.label}</option>)}
            <option value={-1}>Autre</option>
          </select>
        </label>
        <label className="field">Nom<input required maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <div className="grid-2">
          <label className="field">Tous les (km)<input type="number" min={500} value={everyKm} onChange={(e) => setEveryKm(e.target.value)} /></label>
          <label className="field">Ou tous les (mois)<input type="number" min={1} max={60} value={everyMonths} onChange={(e) => setEveryMonths(e.target.value)} /></label>
          <label className="field">Dernière fois à (km)<input type="number" min={0} value={lastKm} onChange={(e) => setLastKm(e.target.value)} placeholder="Kilométrage actuel" /></label>
          <label className="field">Dernière fois le<input type="date" value={lastDate} onChange={(e) => setLastDate(e.target.value)} /></label>
        </div>
        <fieldset className="form-group stack">
          <legend>Véhicules ({vehicleIds.length})</legend>
          <label className="check"><input type="checkbox" checked={vehicleIds.length === vehicles.length} onChange={(e) => setVehicleIds(e.target.checked ? vehicles.map((v) => v.id) : [])} /> Toute la flotte</label>
          <div className="grid-2">
            {vehicles.map((v) => (
              <label key={v.id} className="check">
                <input type="checkbox" checked={vehicleIds.includes(v.id)} onChange={(e) => setVehicleIds(e.target.checked ? [...vehicleIds, v.id] : vehicleIds.filter((x) => x !== v.id))} />
                {v.brand} {v.model} · {v.plate}
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorBox error={error} />
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary">Créer</button>
        </div>
      </form>
    </Modal>
  );
}
