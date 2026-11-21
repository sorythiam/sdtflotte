import { useEffect, useRef, useState } from 'react';

/** Zone de signature au doigt ou à la souris. Renvoie une image PNG légère, ou null si effacée. */
export function SignaturePad({ label, onChange }: { label: string; onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0B3C5D';
  }, []);

  const pos = (e: React.PointerEvent) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };

  function down(e: React.PointerEvent) {
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const p = pos(e);
    const ctx = ref.current!.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(last.current!.x, last.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (empty) setEmpty(false);
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    if (!empty || last.current) onChange(ref.current!.toDataURL('image/png'));
  }
  function clear() {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    setEmpty(true);
    last.current = null;
    onChange(null);
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small" style={{ fontWeight: 600 }}>{label}</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={clear}>Effacer</button>
      </div>
      <canvas
        ref={ref}
        width={600}
        height={200}
        className="signature-pad"
        aria-label={`${label} : signez dans ce cadre`}
        role="img"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
      />
      {empty && <span className="hint">Signez dans le cadre avec le doigt.</span>}
    </div>
  );
}
