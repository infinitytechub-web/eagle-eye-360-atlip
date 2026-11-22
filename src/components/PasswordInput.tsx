import { useId, useMemo, useState } from 'react';
import { passwordStrength, LABELS, MIN_LENGTH } from '../lib/password';

const COLORS = ['#E5534B', '#E8A33D', '#D4AF37', '#35A852', '#2EFF7A'];

interface Props {
  id?: string; label: string; value: string; onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password'; showStrength?: boolean; personal?: string[];
  required?: boolean; placeholder?: string; disabled?: boolean;
}

/** Password field with show/hide control and (optionally) a live strength meter with guidance. */
export function PasswordInput({ id, label, value, onChange, autoComplete, showStrength, personal = [], required, placeholder, disabled }: Props) {
  const auto = useId(); const fid = id || 'pw-' + auto; const hintId = fid + '-hint';
  const [visible, setVisible] = useState(false);
  const s = useMemo(() => passwordStrength(value, personal), [value, personal]);
  return (
    <div>
      <label htmlFor={fid}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input id={fid} type={visible ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete}
          required={required} placeholder={placeholder} disabled={disabled} spellCheck={false} autoCapitalize="none"
          aria-describedby={showStrength ? hintId : undefined} style={{ paddingRight: '2.9rem' }} />
        <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} aria-controls={fid}
          title={visible ? 'Hide password' : 'Show password'} disabled={disabled}
          style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '.35rem .5rem', lineHeight: 0, borderRadius: 8 }}>
          {visible
            ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
            : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>}
        </button>
      </div>
      {showStrength && <div id={hintId} aria-live="polite" style={{ marginTop: '.4rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }} role="meter" aria-valuemin={0} aria-valuemax={4} aria-valuenow={value ? s.score : 0} aria-valuetext={value ? s.label : 'No password entered'} aria-label="Password strength">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} style={{ height: 6, borderRadius: 3, background: value && i <= s.score ? COLORS[s.score] : 'var(--line)', transition: 'background .2s' }} />)}
        </div>
        <div className="small" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.25rem' }}>
          <strong style={{ color: value ? COLORS[s.score] : 'var(--muted)' }}>{value ? s.label : `Minimum ${MIN_LENGTH} characters, rated “${LABELS[3]}” or better`}</strong>
          {value && <span className="muted">{s.acceptable ? '✓ meets the policy' : 'does not meet the policy yet'}</span>}
        </div>
        {value && (s.warnings.length > 0 || (!s.acceptable && s.tips.length > 0)) && <ul className="small" style={{ margin: '.3rem 0 0', paddingLeft: '1.1rem', color: 'var(--muted)' }}>
          {s.warnings.map((w) => <li key={w} style={{ color: '#FF8A84' }}>{w}</li>)}
          {!s.acceptable && s.tips.slice(0, 2).map((t) => <li key={t}>{t}</li>)}
        </ul>}
      </div>}
    </div>
  );
}
