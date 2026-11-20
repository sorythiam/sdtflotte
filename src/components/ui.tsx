import { useEffect, useRef, type ReactNode } from 'react';
import type { ClientScore, ReservationStatus, VehicleStatus } from '../domain/types';

export function Logo({ size = 36, inverse = true }: { size?: number; inverse?: boolean }) {
  const tile = inverse ? '#F6F1E7' : '#0B3C5D';
  const road = inverse ? '#0B3C5D' : '#F6F1E7';
  return (
    <svg aria-hidden="true" viewBox="0 0 160 160" width={size} height={size} style={{ flexShrink: 0 }}>
      <rect width="160" height="160" rx="36" fill={tile} />
      <path d="M42 34 L80 86 L118 34 M80 86 L80 132" fill="none" stroke={road} strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M42 34 L80 86 L118 34 M80 86 L80 132" fill="none" stroke="#E07A2F" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="9 11" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="brand-word">
      yoon <span>fleet</span>
    </span>
  );
}

const vehicleLabels: Record<VehicleStatus, [string, string]> = {
  disponible: ['Disponible', 'badge-success'],
  loue: ['En location', ''],
  maintenance: ['Entretien', 'badge-muted'],
  hors_service: ['Hors service', 'badge-danger'],
};
export function VehicleBadge({ status }: { status: VehicleStatus }) {
  const [label, cls] = vehicleLabels[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

const resLabels: Record<ReservationStatus, [string, string]> = {
  reservee: ['Réservée', 'badge-outline'],
  en_cours: ['En cours', ''],
  terminee: ['Terminée', 'badge-muted'],
  annulee: ['Annulée', 'badge-muted'],
};
export function ReservationBadge({ status, late }: { status: ReservationStatus; late?: number }) {
  if (late && late > 0) return <span className="badge badge-danger">En retard · {late} j</span>;
  const [label, cls] = resLabels[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

const scoreLabels: Record<ClientScore, [string, string]> = {
  fiable: ['Fiable', 'badge-success'],
  surveiller: ['À surveiller', 'badge-warning'],
  blacklist: ['Blacklisté', 'badge-danger'],
};
export function ScoreBadge({ score }: { score: ClientScore }) {
  const [label, cls] = scoreLabels[score];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <h2 id="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? (
    <div className="error" role="alert">
      {error}
    </div>
  ) : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted small" style={{ margin: 0 }}>{children}</p>;
}
