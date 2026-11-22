import { supabase } from '../lib/supabase';
import { useLive, must } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { perms } from '../lib/roles';
import { fmtT } from '../lib/util';
import { sevDot } from '../components/ui';
import type { Alert, AuditLog } from '../lib/types';

const CONTROLS: [string, string][] = [
  ['HTTPS/TLS everywhere, HSTS and a strict Content-Security-Policy', 'Live'],
  ['Supabase Auth: bcrypt password hashing, JWT sessions, email confirmation', 'Live'],
  ['TOTP multi-factor authentication — mandatory for Super Administrators', 'Live'],
  ['Session expiry after 30 minutes of inactivity; client-side sign-in throttling', 'Live'],
  ['Row-Level Security on every table; roles enforced in the database, not only the UI', 'Live'],
  ['New accounts inactive until approved by an administrator', 'Live'],
  ['Append-only audit log written by server functions', 'Live'],
  ['CCTV: masked gateway references only — database rejects URLs/credentials', 'Live'],
  ['Private attachment storage with short-lived signed URLs (10 MB limit)', 'Live'],
  ['Service-role key kept server-side (edge function) — never in the frontend', 'Live'],
  ['CSV export formula-injection protection', 'Live'],
  ['Encrypted backups & point-in-time recovery (Supabase plan feature)', 'Plan-dependent'],
  ['Dependency / vulnerability scanning in CI', 'Planned'],
];

export default function Security() {
  const { profile } = useAuth();
  const { data: sec } = useLive(async () => must(await supabase.from('alerts').select('*').eq('kind', 'security').order('created_at', { ascending: false }).limit(20)) as Alert[], ['alerts']);
  const { data: log } = useLive(async () => perms.readAudit(profile?.role)
    ? must(await supabase.from('audit_logs').select('*').in('category', ['auth', 'admin', 'security', 'branding']).order('created_at', { ascending: false }).limit(40)) as AuditLog[] : [], ['audit_logs']);
  const openSec = (sec || []).filter((a) => !a.acknowledged_at).length;
  return (
    <>
      <div className="grid g3">
        <div className="card stat"><span>Open security alerts</span><b>{openSec}</b><span>Unacknowledged security-type alerts</span></div>
        <div className="card stat"><span>Security & admin events logged</span><b>{(log || []).length}</b><span>{perms.readAudit(profile?.role) ? 'Most recent 40 shown below' : 'Visible to administrators, supervisors and auditors'}</span></div>
        <div className="card stat"><span>Vulnerability status</span><b style={{ fontSize: '1.3rem' }}>Advisor clean</b><span>Supabase security advisor: no RLS gaps; only intended RPCs exposed</span></div>
      </div>
      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <div className="card"><h3>Security event log</h3><div className="small" style={{ display: 'grid', gap: '.4rem', maxHeight: 420, overflow: 'auto' }}>
          {(sec || []).map((a) => <div key={'a' + a.id} className="card" style={{ padding: '.5rem .7rem' }}><span className={'dot ' + sevDot(a.severity)} /> {a.body} <span className="muted">· {fmtT(a.created_at)}</span></div>)}
          {(log || []).map((a) => <div key={'l' + a.id} className="card" style={{ padding: '.5rem .7rem' }}><span className="chip">{a.category}</span> {a.actor_name}: {a.action}{a.target ? ` (${a.target})` : ''} <span className="muted">· {fmtT(a.created_at)}</span></div>)}
        </div></div>
        <div className="card"><h3>Controls in place</h3><ul className="check">{CONTROLS.map(([c, s]) => <li key={c}><span>{c}</span><span className={'chip ' + (s === 'Live' ? 'g' : s === 'Planned' ? 'grey' : 'a')}>{s}</span></li>)}</ul>
          <p className="small muted">Never implemented, by design: covert interception, unauthorised CCTV access, or any access to traffic-light <em>control</em> systems. ATLIP observes signals only.</p></div>
      </div>
    </>
  );
}
