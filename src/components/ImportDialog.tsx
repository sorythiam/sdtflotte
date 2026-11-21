import { useState, type ChangeEvent } from 'react';
import {
  CLIENT_FIELDS,
  parseClients,
  parseCsv,
  parseVehicles,
  VEHICLE_FIELDS,
  type Cell,
  type ImportResult,
  type NewClient,
  type NewVehicle,
} from '../domain/importer';
import { useData } from '../state/DataContext';
import { ErrorBox, Modal } from './ui';

type Kind = 'vehicles' | 'clients';

const labels = {
  vehicles: { title: 'Importer des véhicules', one: 'véhicule', many: 'véhicules', file: 'modele_vehicules_yoonfleet.xlsx', fields: VEHICLE_FIELDS },
  clients: { title: 'Importer des clients', one: 'client', many: 'clients', file: 'modele_clients_yoonfleet.xlsx', fields: CLIENT_FIELDS },
};

async function readFile(file: File): Promise<Cell[][]> {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return parseCsv(await file.text());
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Format non reconnu : utilisez un fichier Excel (.xlsx) ou CSV.');
  const { readSheet } = await import('read-excel-file/browser');
  return (await readSheet(file)) as Cell[][];
}

export function ImportDialog({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const { data, store, refresh, toast, session } = useData();
  const L = labels[kind];
  const [result, setResult] = useState<ImportResult<NewVehicle | NewClient> | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  async function downloadTemplate() {
    const writeXlsxFile = (await import('write-excel-file/browser')).default;
    const header = L.fields.map((f) => ({ value: f.title + (f.required ? ' *' : ''), fontWeight: 'bold' as const }));
    const example = L.fields.map((f) => ({ value: String(f.example) }));
    const sheets: { data: { value: string; fontWeight?: 'bold' }[][]; sheet: string; columns: { width: number }[] }[] = [
      { data: [header, example], sheet: kind === 'vehicles' ? 'Véhicules' : 'Clients', columns: L.fields.map(() => ({ width: 26 })) },
    ];
    if (kind === 'vehicles') {
      sheets.push({
        data: [[{ value: 'Catégories acceptées', fontWeight: 'bold' as const }], ...data.rates.map((r) => [{ value: r.category }])],
        sheet: 'Catégories',
        columns: [{ width: 30 }],
      });
    }
    await writeXlsxFile(sheets as never).toFile(L.file);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(null);
    setResult(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const sheet = await readFile(file);
      const r =
        kind === 'vehicles'
          ? parseVehicles(sheet, {
              categories: data.rates.map((x) => x.category),
              existingPlates: data.vehicles.map((v) => v.plate),
              quota: session?.org.vehicleQuota ?? 0,
              activeCount: data.vehicles.filter((v) => !v.outOfService).length,
            })
          : parseClients(sheet, { existingPhones: data.clients.map((c) => c.phone) });
      setResult(r);
    } catch (err) {
      setError((err as Error).message || 'Fichier illisible.');
    }
  }

  async function run() {
    if (!result) return;
    setError(null);
    let done = 0;
    setProgress(0);
    try {
      for (const row of result.rows) {
        if (kind === 'vehicles') await store.insert('vehicles', row as NewVehicle);
        else await store.insert('clients', row as NewClient);
        done += 1;
        setProgress(done);
      }
      await refresh();
      toast(`${done} ${done > 1 ? L.many : L.one} importé(s)`);
      onClose();
    } catch (err) {
      await refresh();
      setError(`${done} importé(s), puis arrêt : ${(err as Error).message}`);
      setProgress(null);
    }
  }

  const n = result?.rows.length ?? 0;

  return (
    <Modal title={L.title} onClose={onClose}>
      <ol className="stack small" style={{ margin: 0, paddingLeft: 20, gap: 'var(--space-2)' }}>
        <li>
          Téléchargez le modèle et remplissez une ligne par {L.one}. Les colonnes marquées * sont obligatoires.{' '}
          {kind === 'vehicles' && 'La catégorie doit exister dans vos tarifs (liste dans le 2e onglet).'}
        </li>
        <li>Votre propre fichier marche aussi s’il a des colonnes équivalentes (Immat, Km, Tel…).</li>
        <li>Rien n’est enregistré avant que vous confirmiez le bilan.</li>
      </ol>
      <div className="row">
        <button type="button" className="btn" onClick={downloadTemplate}>
          Télécharger le modèle Excel
        </button>
        <label className="btn btn-dark" style={{ cursor: 'pointer' }}>
          Choisir un fichier (.xlsx ou .csv)
          <input type="file" accept=".xlsx,.csv" onChange={onFile} className="sr-only" />
        </label>
        {fileName && <span className="small muted">{fileName}</span>}
      </div>

      {result && result.missingColumns.length > 0 && (
        <div className="error" role="alert">
          Colonnes obligatoires introuvables : {result.missingColumns.join(', ')}. Partez du modèle, ou renommez vos colonnes.
        </div>
      )}

      {result && result.missingColumns.length === 0 && (
        <div className="stack" style={{ gap: 'var(--space-3)' }}>
          <div className="notice">
            <strong>{n}</strong> {n > 1 ? L.many : L.one} prêt(s) à importer
            {result.skipped.length > 0 && <> · {result.skipped.length} déjà présent(s), ignoré(s)</>}
            {result.errors.length > 0 && <> · <strong style={{ color: 'var(--danger)' }}>{result.errors.length} ligne(s) à corriger</strong></>}
          </div>
          {result.errors.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
              <table className="data">
                <thead><tr><th>Ligne</th><th>À corriger</th></tr></thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i}><td className="num">{e.line || '—'}</td><td>{e.message}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.skipped.length > 0 && (
            <details className="small">
              <summary>Voir les lignes ignorées</summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {result.skipped.map((s, i) => <li key={i}>Ligne {s.line} : {s.message}</li>)}
              </ul>
            </details>
          )}
          {n > 0 && (
            <div className="table-wrap" style={{ maxHeight: 200, overflowY: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>{kind === 'vehicles' ? <><th>Immatriculation</th><th>Véhicule</th><th>Catégorie</th></> : <><th>Nom</th><th>Téléphone</th><th>Type</th></>}</tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 50).map((r, i) => {
                    if (kind === 'vehicles') {
                      const v = r as NewVehicle;
                      return <tr key={i}><td>{v.plate}</td><td>{v.brand} {v.model}</td><td>{v.category}</td></tr>;
                    }
                    const c = r as NewClient;
                    return <tr key={i}><td>{c.name}</td><td>{c.phone}</td><td>{c.kind}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ErrorBox error={error} />
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Fermer</button>
        <button type="button" className="btn btn-primary" disabled={!n || progress !== null} onClick={run}>
          {progress !== null ? `Import… ${progress}/${n}` : `Importer ${n} ${n > 1 ? L.many : L.one}`}
        </button>
      </div>
    </Modal>
  );
}
