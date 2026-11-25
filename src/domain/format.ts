// Formats français : montants FCFA avec espace insécable, dates en clair.

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export function money(amount: number, currency = 'FCFA'): string {
  return `${nf.format(Math.round(amount))} ${currency}`;
}

export function num(n: number): string {
  return nf.format(n);
}

const dShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const dLong = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const tm = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function dateShort(iso: string): string {
  return dShort.format(new Date(iso));
}

export function dateLong(iso: string): string {
  return dLong.format(new Date(iso));
}

export function dateTime(iso: string): string {
  return `${dLong.format(new Date(iso))}, ${tm.format(new Date(iso))}`;
}

export function time(iso: string): string {
  return tm.format(new Date(iso));
}

/** Valeur pour <input type="datetime-local"> à partir d'un ISO. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string {
  return new Date(v).toISOString();
}

/** Période courte sur une ligne : « 19 → 24 nov. », « 28 nov. → 1 déc. », « 26 nov. » si un seul jour. */
export function periodShort(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const month = (d: Date) => d.toLocaleDateString('fr-FR', { month: 'short' });
  const sameDay = s.toDateString() === e.toDateString();
  if (sameDay) return `${s.getDate()} ${month(s)}`;
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  return sameMonth ? `${s.getDate()} → ${e.getDate()} ${month(e)}` : `${s.getDate()} ${month(s)} → ${e.getDate()} ${month(e)}`;
}
