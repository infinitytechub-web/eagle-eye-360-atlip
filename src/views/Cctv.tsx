import { useState } from 'react';
import { supabase, audit } from '../lib/supabase';
import { useLive, must } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { perms } from '../lib/roles';
import { fmtT } from '../lib/util';
import type { AuditLog } from '../lib/types';

export default function Cctv() {
  const { profile } = useAuth();
  const { cameras, intersections } = useData();
  const { data: log } = useLive(async () => must(await supabase.from('audit_logs').select('*').eq('category', 'camera').order('created_at', { ascending: false }).limit(40)) as AuditLog[], ['cameras', 'audit_logs']);
  const [name, setName] = useState(''); const [ix, setIx] = useState('IX-01'); const [ref, setRef] = useState(''); const [ret, setRet] = useState(14);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const can = perms.registerCamera(profile?.role);
  const ixOf = (id: string) => intersections.find((i) => i.id === id);

  async function add() {
    setErr('');
    if (!can) return setErr('Your role cannot register cameras.');
    if (!name.trim() || !ref.trim()) return setErr('Name and masked gateway reference are required. Never paste a real RTSP URL or password here.');
    if (/(rtsp|rtmp|https?:\/\/|password|passwd|@)/i.test(ref)) return setErr('Blocked: that looks like a raw stream URL or credential. Use a masked gateway reference only.');
    setBusy(true);
    const { data, error } = await supabase.from('cameras').insert({ name: name.trim(), intersection_id: ix, gateway_ref: ref.trim(), retention_days: ret, registered_by: profile!.id }).select('id').single();
    setBusy(false);
    if (error) return setErr(error.message.includes('check') ? 'Rejected by the server: the gateway reference looks like a URL or credential.' : error.message);
    await audit(`Registered camera ${data.id}`, ref.trim(), 'camera');
    setName(''); setRef('');
  }
  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from('cameras').update({ status }).eq('id', id);
    if (!error) await audit(`Camera ${id} status set to ${status}`, null, 'camera');
  }

  return (
    <>
      <div className="notice">RTSP is accepted <strong>only</strong> by the secure backend video gateway. This frontend never receives RTSP URLs, usernames or passwords — you register a <strong>masked gateway reference</strong> only (e.g. <span className="mono">gw-accra ••••-4417</span>), and the database rejects anything that looks like a URL or credential. Live playback arrives via WebRTC/HLS once the video gateway is connected; until then feeds show status overlays only.</div>
      <div className="grid g3" style={{ marginTop: '1rem' }}>
        {cameras.map((c) => { const i = ixOf(c.intersection_id); return (
          <div key={c.id} className="feed">
            <div className="fh"><span>{c.id} · STATUS OVERLAY</span><span>{c.status.toUpperCase()}</span></div>
            <div className="scene" style={{ height: 130 }}>
              {c.status === 'Offline' ? <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#FF8A84', fontWeight: 800 }}>NO SIGNAL — camera offline</div>
                : <><div className="bbox" style={{ left: '38%', top: '10%' }}>{i?.current_state || '—'} · last observed</div><div style={{ position: 'absolute', left: '46%', top: '22%', width: 26, height: 74, border: '2px solid var(--lime)', borderRadius: 6 }} /></>}
            </div>
            <div style={{ padding: '.6rem .7rem', background: 'var(--panel)' }}><strong>{c.name}</strong><br />
              <span className="small muted">{i?.name} · Ref <span className="mono">{c.gateway_ref}</span> · Retention {c.retention_days}d</span>
              {can && <div className="pillrow" style={{ marginTop: '.4rem' }}>{['Online', 'Obstructed', 'Offline'].filter((s) => s !== c.status).map((s) => <button key={s} className="btn small" onClick={(e) => { e.stopPropagation(); setStatus(c.id, s); }}>Mark {s}</button>)}</div>}
            </div>
          </div>); })}
      </div>
      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <div className="card"><h3>Register authorised camera</h3>
          <label>Camera name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Osu Oxford St — North approach" maxLength={120} disabled={!can} />
          <label>Intersection assignment (manual — GPS alone never assigns a signal)</label>
          <select value={ix} onChange={(e) => setIx(e.target.value)} disabled={!can}>{intersections.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          <label>Masked gateway reference</label><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="gw-accra ••••-0000" maxLength={60} disabled={!can} />
          <label>Retention (days)</label><select value={ret} onChange={(e) => setRet(+e.target.value)} disabled={!can}><option>7</option><option>14</option><option>30</option></select>
          {err && <p className="small" style={{ color: '#FF8A84' }}>{err}</p>}
          <button className="btn primary" onClick={add} disabled={!can || busy} style={{ marginTop: '.6rem' }}>Register camera</button>
          <p className="small muted">Registration is audit-logged. {can ? '' : 'Your role is read-only for cameras.'}</p>
        </div>
        <div className="card"><h3>Camera access audit log</h3><div className="small" style={{ display: 'grid', gap: '.4rem', maxHeight: 320, overflow: 'auto' }}>
          {(log || []).length ? log!.map((a) => <div key={a.id} className="card" style={{ padding: '.5rem .7rem' }}>{fmtT(a.created_at)} — {a.actor_name}: {a.action}{a.target ? ` (${a.target})` : ''}</div>) : <span className="muted">No camera activity recorded yet.</span>}
        </div></div>
      </div>
    </>
  );
}
