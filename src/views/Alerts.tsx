import { useState } from 'react';
import { supabase, audit } from '../lib/supabase';
import { useLive, must } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { perms } from '../lib/roles';
import { fmtT, relMin } from '../lib/util';
import { sevDot } from '../components/ui';
import type { Alert } from '../lib/types';

const TYPES = ['Signal-state alerts', 'Camera disconnection', 'Low-confidence warnings', 'Obstructed camera', 'AI service failure', 'Security / admin alerts'];

export default function Alerts() {
  const { profile, refreshProfile } = useAuth();
  const { directory } = useData();
  const { data: alerts } = useLive(async () => must(await supabase.from('alerts').select('*').order('created_at', { ascending: false }).limit(100)) as Alert[], ['alerts']);
  const saved = ((profile?.prefs as { alerts?: Record<string, boolean> })?.alerts) || {};
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => Object.fromEntries(TYPES.map((t) => [t, saved[t] !== false])));
  const [msg, setMsg] = useState('');
  const [kind, setKind] = useState('signal'); const [sev, setSev] = useState('a'); const [body, setBody] = useState(''); const [err, setErr] = useState('');

  async function save() {
    const { error } = await supabase.from('profiles').update({ prefs: { ...(profile!.prefs || {}), alerts: prefs } }).eq('id', profile!.id);
    if (error) return setMsg(error.message);
    setMsg('Preferences saved to your account.'); await audit('Notification preferences updated', null, 'system'); refreshProfile();
  }
  async function ack(a: Alert) {
    const { error } = await supabase.from('alerts').update({ acknowledged_by: profile!.id, acknowledged_at: new Date().toISOString() }).eq('id', a.id);
    if (!error) await audit('Alert acknowledged', a.body.slice(0, 80), 'system');
  }
  async function raise() {
    setErr(''); if (!body.trim()) return setErr('Describe the alert.');
    const { error } = await supabase.from('alerts').insert({ kind, severity: sev, body: body.trim(), created_by: profile!.id });
    if (error) return setErr(error.message);
    await audit('Alert raised', body.trim().slice(0, 80), 'system'); setBody('');
  }
  const who = (id: string | null) => directory.find((d) => d.id === id)?.full_name || 'user';

  return (
    <>
      <div className="notice warn">Alerts report <strong>observed</strong> signal states and system events. They are not guaranteed driving instructions — always obey the physical signal and road rules.</div>
      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <div className="card"><h3>Alert centre</h3><div style={{ display: 'grid', gap: '.5rem' }}>
          {(alerts || []).map((a) => (
            <div key={a.id} className="card" style={{ padding: '.6rem .8rem' }}>
              <span className={'dot ' + sevDot(a.severity)} /> <strong>{a.kind}</strong> — {a.body}<br />
              <span className="muted small">{relMin(a.created_at)} · {a.acknowledged_at ? `acknowledged by ${who(a.acknowledged_by)} ${fmtT(a.acknowledged_at)}` : 'unacknowledged'}</span>
              {!a.acknowledged_at && perms.ackAlert(profile?.role) && <> <button className="btn small" onClick={() => ack(a)}>Acknowledge</button></>}
            </div>))}
        </div></div>
        <div>
          <div className="card"><h3>Notification preferences</h3>
            {TYPES.map((t) => <label key={t} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', color: 'var(--text)', fontWeight: 600 }}><input type="checkbox" style={{ width: 'auto' }} checked={prefs[t]} onChange={(e) => setPrefs({ ...prefs, [t]: e.target.checked })} /> {t}</label>)}
            <button className="btn primary" onClick={save} style={{ marginTop: '.6rem' }}>Save preferences</button>
            <p className="small muted">{msg || 'Saved per account, so they follow you across devices.'}</p>
          </div>
          {perms.ackAlert(profile?.role) && <div className="card" style={{ marginTop: '1rem' }}><h3>Raise an alert</h3>
            <label>Type</label><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="signal">Signal state</option><option value="camera">Camera</option><option value="lowconf">Low confidence</option><option value="obstructed">Obstructed camera</option><option value="ai">AI service</option><option value="security">Security</option></select>
            <label>Severity</label><select value={sev} onChange={(e) => setSev(e.target.value)}><option value="r">Critical (red)</option><option value="a">Warning (amber)</option><option value="g">Information (green)</option></select>
            <label>Details</label><textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} />
            {err && <p className="small" style={{ color: '#FF8A84' }}>{err}</p>}
            <button className="btn primary small" style={{ marginTop: '.5rem' }} onClick={raise}>Raise alert</button>
          </div>}
        </div>
      </div>
    </>
  );
}
