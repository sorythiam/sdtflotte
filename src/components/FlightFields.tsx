import { flightTrackUrl, isFlightNumber, normalizeFlight, TRANSFER_LABEL, type TransferKind } from '../domain/flight';

export interface FlightValue {
  transferKind: TransferKind | null;
  flightNumber: string;
  flightAt: string; // valeur d'un champ datetime-local
}

export const NO_FLIGHT: FlightValue = { transferKind: null, flightNumber: '', flightAt: '' };

/**
 * Transfert aéroport : sens, numéro de vol, heure du vol.
 * onFlightTime propose l'heure de prise en charge quand l'heure du vol change.
 */
export function FlightFields({ value, onChange, onFlightTime, compact }: {
  value: FlightValue;
  onChange: (v: FlightValue) => void;
  onFlightTime?: (local: string, kind: TransferKind) => void;
  compact?: boolean;
}) {
  const on = value.transferKind !== null;
  const n = normalizeFlight(value.flightNumber);
  return (
    <fieldset className="stack form-group">
      <legend>Transfert aéroport</legend>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? { ...value, transferKind: 'arrivee' } : NO_FLIGHT)} />
        C’est un trajet vers ou depuis l’aéroport
      </label>
      {on && (
        <>
          <label className="field">
            Sens du trajet
            <select value={value.transferKind!} onChange={(e) => {
              const kind = e.target.value as TransferKind;
              onChange({ ...value, transferKind: kind });
              if (value.flightAt) onFlightTime?.(value.flightAt, kind);
            }}>
              {(Object.keys(TRANSFER_LABEL) as TransferKind[]).map((k) => <option key={k} value={k}>{TRANSFER_LABEL[k]}</option>)}
            </select>
          </label>
          <div className={compact ? 'stack' : 'grid-2'}>
            <label className="field">
              Numéro de vol
              <input required value={value.flightNumber} maxLength={10} autoCapitalize="characters" placeholder="Ex. : AF718, SN205"
                onChange={(e) => onChange({ ...value, flightNumber: e.target.value })} />
              {value.flightNumber && !isFlightNumber(n) && <span className="hint" style={{ color: 'var(--danger)' }}>Format attendu : code de la compagnie puis le numéro, par exemple AF718.</span>}
              {isFlightNumber(n) && <a className="hint" href={flightTrackUrl(n)} target="_blank" rel="noreferrer">Suivre le vol {n} en direct</a>}
            </label>
            <label className="field">
              {value.transferKind === 'arrivee' ? 'Heure d’arrivée du vol' : 'Heure de départ du vol'}
              <input type="datetime-local" required value={value.flightAt}
                onChange={(e) => { onChange({ ...value, flightAt: e.target.value }); if (e.target.value) onFlightTime?.(e.target.value, value.transferKind!); }} />
              <span className="hint">{value.transferKind === 'arrivee' ? 'La prise en charge est calée sur l’atterrissage.' : 'La prise en charge est proposée 3 h avant le décollage.'}</span>
            </label>
          </div>
        </>
      )}
    </fieldset>
  );
}
