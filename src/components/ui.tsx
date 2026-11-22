import { createContext, useContext, useState, type ReactNode } from 'react';
import type { SignalState } from '../lib/types';
import { DEFAULT_LOGO } from '../lib/branding';

export function StateChip({ s }: { s: SignalState | string }) {
  if (s === 'RED') return <span className="chip r">● RED</span>;
  if (s === 'CAUTION') return <span className="chip a">● CAUTION</span>;
  if (s === 'GREEN') return <span className="chip g">● GREEN</span>;
  return <span className="chip grey">● UNKNOWN</span>;
}
export const sevDot = (s: string) => (s === 'r' ? 'red' : s === 'a' ? 'amber' : 'green');

export function Logo({ src, size }: { src?: string | null; size: number }) {
  return <img src={src || DEFAULT_LOGO} alt="System logo" width={size} height={size}
    style={{ width: size, height: size, objectFit: 'cover', borderRadius: Math.max(8, Math.round(size * 0.16)), display: 'block', flex: 'none' }} />;
}

export function Bars({ data, color }: { data: { l: string; v: number }[]; color?: string }) {
  const max = Math.max(...data.map((d) => d.v), 1);
  return (
    <div style={{ display: 'grid', gap: '.45rem' }}>
      {data.map((d) => (
        <div key={d.l} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 44px', gap: '.5rem', alignItems: 'center', fontSize: '.82rem' }}>
          <span>{d.l}</span>
          <div style={{ background: 'var(--panel2)', borderRadius: 6, height: 14 }} role="img" aria-label={`${d.l}: ${d.v}`}>
            <div style={{ width: `${Math.round((d.v / max) * 100)}%`, height: 14, borderRadius: 6, background: color || 'var(--lime)' }} />
          </div>
          <strong>{d.v}</strong>
        </div>
      ))}
    </div>
  );
}

export function Donut({ parts }: { parts: [SignalState, number][] }) {
  const colors: Record<string, string> = { RED: '#FF3B30', CAUTION: '#FFB340', GREEN: '#2EFF7A', UNKNOWN: '#777' };
  const tot = parts.reduce((a, p) => a + p[1], 0) || 1;
  let off = 0;
  return (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Signal state distribution">
        {parts.map(([k, v]) => { const f = v / tot; const el = <circle key={k} cx="70" cy="70" r="52" fill="none" stroke={colors[k]} strokeWidth="20" strokeDasharray={`${(f * 326.7).toFixed(1)} 326.7`} transform={`rotate(${-90 + off * 360} 70 70)`} />; off += f; return el; })}
        <text x="70" y="76" textAnchor="middle" fill="var(--text)" fontWeight="800" fontSize="17">{parts.reduce((a, p) => a + p[1], 0)}</text>
      </svg>
      <div style={{ display: 'grid', gap: '.3rem' }}>
        {parts.map(([k, v]) => <span key={k}><StateChip s={k} /> <strong>{v}</strong> ({Math.round((v / tot) * 100)}%)</span>)}
      </div>
    </div>
  );
}

export function Loading({ what = 'data' }: { what?: string }) { return <p className="muted small">Loading {what}…</p>; }
export function ErrorNote({ error }: { error: string | null }) { return error ? <p className="small" style={{ color: '#FF8A84' }}>{error}</p> : null; }

/* ---------- in-page confirm modal (never window.confirm) ---------- */
interface ModalState { title: string; body: ReactNode; ok: string; cb?: () => void; danger?: boolean }
const ModalCtx = createContext<(m: ModalState) => void>(() => {});
export const useModal = () => useContext(ModalCtx);
export function ModalProvider({ children }: { children: ReactNode }) {
  const [m, setM] = useState<ModalState | null>(null);
  return (
    <ModalCtx.Provider value={setM}>
      {children}
      <div className={'modal' + (m ? ' open' : '')} role="dialog" aria-modal="true" aria-labelledby="mTitle">
        {m && <div className="box">
          <h3 id="mTitle">{m.title}</h3>
          <div className="muted">{m.body}</div>
          <div className="pillrow" style={{ justifyContent: 'flex-end', marginTop: '.8rem' }}>
            {m.cb && <button className="btn" onClick={() => setM(null)}>Cancel</button>}
            <button className={'btn ' + (m.cb ? 'danger' : 'primary')} onClick={() => { const cb = m.cb; setM(null); cb?.(); }}>{m.ok}</button>
          </div>
        </div>}
      </div>
    </ModalCtx.Provider>
  );
}
