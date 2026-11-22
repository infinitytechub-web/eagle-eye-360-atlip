import { useState } from 'react';
import { supabase, audit } from '../lib/supabase';
import { useLive, must } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { perms, ROLE_LABEL } from '../lib/roles';
import { fmtT, relMin } from '../lib/util';
import { LivePlayer } from '../components/LivePlayer';
import type { AuditLog, Camera, CctvSession, Gateway } from '../lib/types';

const gwStale = (g: Gateway) => !g.last_seen_at || Date.now() - new Date(g.last_seen_at).getTime() > 120_000;
const gwState = (g: Gateway) => (g.status === 'online' && !gwStale(g) ? 'online' : 'offline');

function StatusTile({ c, ixName, note }: { c: Camera; ixName: string; note: string }) {
  return (
    <div className="feed">
      <div className="fh"><span>{c.id}</span><span>{c.status.toUpperCase()}</span></div>
      <div className="scene" style={{ height: 130, display: 'grid', placeItems: 'center', textAlign: 'center', padding: '.5rem', color: c.status === 'Offline' ? '#FF8A84' : '#B9C9DE' }}>
        <span className="small">{c.status === 'Offline' ? 'NO SIGNAL — camera offline' : note}</span>
      </div>
      <div style={{ padding: '.6rem .7rem', background: 'var(--panel)' }}><strong>{c.name}</strong><br />
        <span className="small muted">{ixName} · Ref <span className="mono">{c.gateway_ref}</span> · Retention {c.retention_days}d{c.last_frame_at ? ` · last frame ${relMin(c.last_frame_at)}` : ''}</span></div>
    </div>
  );
}

export default function Cctv() {
  const { profile } = useAuth();
  const { cameras, intersections, directory } = useData();
  const role = profile?.role;
  const { data: gateways } = useLive(async () => must(await supabase.from('gateways').select('*').order('id')) as Gateway[], ['gateways']);
  const { data: log } = useLive(async () => must(await supabase.from('audit_logs').select('*').eq('category', 'camera').order('created_at', { ascending: false }).limit(40)) as AuditLog[], ['cameras', 'audit_logs']);
  const { data: sessions } = useLive(async () => must(await supabase.from('cctv_sessions').select('*').order('started_at', { ascending: false }).limit(40)) as CctvSession[], ['cctv_sessions']);
  const [layout, setLayout] = useState(4);
  const [onlyLive, setOnlyLive] = useState(false);
  const [page, setPage] = useState(0);
  const gws = gateways || [];
  const gwOf = (c: Camera) => gws.find((g) => g.id === c.gateway_id);
  const ixName = (id: string) => intersections.find((i) => i.id === id)?.name || id;
  const canLive = perms.viewCctvLive(role);
  const liveCapable = cameras.filter((c) => c.stream_enabled && gwOf(c));
  const pool = onlyLive ? liveCapable : cameras;
  const pages = Math.max(1, Math.ceil(pool.length / layout));
  const pg = Math.min(page, pages - 1);
  const shown = pool.slice(pg * layout, pg * layout + layout);
  const cols = layout === 1 ? 1 : layout === 4 ? 2 : 3;

  // ---- register camera ----
  const [name, setName] = useState(''); const [ix, setIx] = useState('IX-01'); const [ref, setRef] = useState(''); const [ret, setRet] = useState(14);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const canReg = perms.registerCamera(role);
  async function add() {
    setErr('');
    if (!canReg) return setErr('Your role cannot register cameras.');
    if (!name.trim() || !ref.trim()) return setErr('Name and masked gateway reference are required. Never paste a real RTSP URL or password here.');
    if (/(rtsp|rtmp|https?:\/\/|password|passwd|@)/i.test(ref)) return setErr('Blocked: that looks like a raw stream URL or credential. Camera sources are entered on the gateway host only.');
    setBusy(true);
    const { data, error } = await supabase.from('cameras').insert({ name: name.trim(), intersection_id: ix, gateway_ref: ref.trim(), retention_days: ret, registered_by: profile!.id }).select('id').single();
    setBusy(false);
    if (error) return setErr(error.message.includes('check') ? 'Rejected by the server: the gateway reference looks like a URL or credential.' : error.message);
    await audit(`Registered camera ${data.id}`, ref.trim(), 'camera'); setName(''); setRef('');
  }

  // ---- camera ↔ gateway configuration ----
  async function patchCam(c: Camera, patch: Partial<Camera>, label: string) {
    const { error } = await supabase.from('cameras').update(patch).eq('id', c.id);
    if (error) setErr(error.message); else await audit(`${c.id}: ${label}`, null, 'camera');
  }

  // ---- gateways ----
  const gatewayAccounts = directory.filter((d) => d.role === 'gateway');
  const [g, setG] = useState({ id: '', name: '', url: '', account: '' }); const [gErr, setGErr] = useState('');
  async function addGateway() {
    setGErr('');
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(g.id)) return setGErr('Gateway ID: lowercase letters, digits and dashes (e.g. gw-accra-01).');
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(g.url)) return setGErr('Public URL must be the gateway\'s HTTPS address, e.g. https://gw-accra.infinitytechub.com');
    const { error } = await supabase.from('gateways').insert({ id: g.id, name: g.name.trim() || g.id, public_url: g.url.replace(/\/+$/, ''), account_id: g.account || null });
    if (error) return setGErr(error.message);
    await audit('Gateway registered', `${g.id} → ${g.url}`, 'camera'); setG({ id: '', name: '', url: '', account: '' });
  }
  async function linkAccount(gw: Gateway, account: string) {
    const { error } = await supabase.from('gateways').update({ account_id: account || null }).eq('id', gw.id);
    if (error) setGErr(error.message); else await audit('Gateway service account linked', gw.id, 'camera');
  }

  return (
    <>
      <div className="notice"><strong>Secure CCTV path:</strong> cameras → ATLIP gateway on the camera network (RTSP over TCP, credentials in an AES-256 vault on the gateway only) → HTTPS HLS → this page. Your session is exchanged for a 5-minute, camera-bound stream ticket, and every live view is recorded below for oversight. The database rejects camera records that contain URLs or passwords.</div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Video wall</h3>
          <div className="pillrow">
            {[1, 4, 9].map((n) => <button key={n} className={'btn small' + (layout === n ? ' primary' : '')} onClick={() => { setLayout(n); setPage(0); }}>{n === 1 ? '1 × 1' : n === 4 ? '2 × 2' : '3 × 3'}</button>)}
            <label className="small" style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center', margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={onlyLive} onChange={(e) => { setOnlyLive(e.target.checked); setPage(0); }} /> Live-capable only ({liveCapable.length})</label>
            {pages > 1 && <><button className="btn small" disabled={pg === 0} onClick={() => setPage(pg - 1)} aria-label="Previous page">‹</button><span className="small">Page {pg + 1} / {pages}</span><button className="btn small" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} aria-label="Next page">›</button></>}
          </div>
        </div>
        {!canLive && <p className="small muted">Your role ({ROLE_LABEL[role!]}) can see camera status but not live video.</p>}
        <div className="grid" style={{ marginTop: '.8rem', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {shown.map((c) => {
            const gw = gwOf(c);
            if (canLive && gw && c.stream_enabled) return <LivePlayer key={c.id} cam={c} gw={gw} compact={layout === 9} />;
            const note = !gw ? 'Not assigned to a gateway yet' : !c.stream_enabled ? 'Live streaming disabled for this camera' : 'Status only';
            return <StatusTile key={c.id} c={c} ixName={ixName(c.intersection_id)} note={note} />;
          })}
          {!shown.length && <p className="muted small">No cameras match.</p>}
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <div className="card"><h3>Gateways</h3>
          {gws.length ? <div className="tablewrap"><table><thead><tr><th>Gateway</th><th>Status</th><th>Cameras / live / AI</th>{perms.manageGateways(role) && <th>Service account</th>}</tr></thead><tbody>
            {gws.map((x) => { const st = gwState(x); const i = x.info as Record<string, number>; return (
              <tr key={x.id}><td><strong>{x.name}</strong><br /><span className="small muted mono">{x.id} · {x.public_url}</span></td>
                <td><span className={'chip ' + (st === 'online' ? 'g' : 'r')}>{st}</span><br /><span className="small muted">{x.last_seen_at ? 'seen ' + relMin(x.last_seen_at) : 'never connected'}{x.version ? ' · v' + x.version : ''}</span></td>
                <td className="small">{i?.cameras ?? 0} / {i?.live_streams ?? 0} / {i?.ai_workers ?? 0}</td>
                {perms.manageGateways(role) && <td><select value={x.account_id || ''} onChange={(e) => linkAccount(x, e.target.value)} style={{ minWidth: 160 }}><option value="">— none —</option>{gatewayAccounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}</select></td>}
              </tr>); })}
          </tbody></table></div> : <p className="muted small">No gateway registered yet. A gateway is installed on a server inside the camera network (see gateway/README.md).</p>}
          {perms.manageGateways(role) && <>
            <h3 style={{ marginTop: '1rem' }}>Register a gateway</h3>
            <div className="grid g2">
              <div><label>Gateway ID</label><input value={g.id} onChange={(e) => setG({ ...g, id: e.target.value.toLowerCase() })} placeholder="gw-accra-01" maxLength={40} /></div>
              <div><label>Name</label><input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="Accra Command gateway" maxLength={80} /></div>
            </div>
            <label>Public HTTPS URL</label><input value={g.url} onChange={(e) => setG({ ...g, url: e.target.value.trim() })} placeholder="https://gw-accra.infinitytechub.com" />
            <label>Service account (role “gateway”)</label>
            <select value={g.account} onChange={(e) => setG({ ...g, account: e.target.value })}><option value="">— link later —</option>{gatewayAccounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}</select>
            {!gatewayAccounts.length && <p className="small muted">Create the service account first: System Administration → Create user account → role “CCTV Gateway (service account)” (Super Administrators only).</p>}
            {gErr && <p className="small" style={{ color: '#FF8A84' }}>{gErr}</p>}
            <button className="btn primary small" style={{ marginTop: '.5rem' }} onClick={addGateway}>Register gateway</button>
          </>}
        </div>

        <div className="card"><h3>Camera streaming &amp; AI configuration</h3>
          <div className="tablewrap"><table><thead><tr><th>Camera</th><th>Gateway</th><th>Live</th><th>AI</th><th>Health</th></tr></thead><tbody>
            {cameras.map((c) => { const admin = perms.manageGateways(role); const si = (c.stream_info || {}) as Record<string, unknown>; return (
              <tr key={c.id}><td><strong>{c.id}</strong><br /><span className="small muted">{c.name}</span></td>
                <td>{admin ? <select value={c.gateway_id || ''} onChange={(e) => patchCam(c, { gateway_id: e.target.value || null }, `assigned to gateway ${e.target.value || 'none'}`)} style={{ minWidth: 120 }}><option value="">—</option>{gws.map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}</select> : (c.gateway_id || '—')}</td>
                <td><input type="checkbox" style={{ width: 'auto' }} checked={c.stream_enabled} disabled={!admin} onChange={(e) => patchCam(c, { stream_enabled: e.target.checked }, `live streaming ${e.target.checked ? 'enabled' : 'disabled'}`)} aria-label={`Live streaming for ${c.id}`} /></td>
                <td><input type="checkbox" style={{ width: 'auto' }} checked={c.ai_enabled} disabled={!admin} onChange={(e) => patchCam(c, { ai_enabled: e.target.checked }, `server-side AI ${e.target.checked ? 'enabled' : 'disabled'}`)} aria-label={`AI for ${c.id}`} /></td>
                <td><span className={'chip ' + (c.status === 'Online' ? 'g' : c.status === 'Obstructed' ? 'a' : 'r')}>{c.status}</span>{si.inference_ms !== undefined && <><br /><span className="small muted">AI {String(si.inference_ms)} ms</span></>}</td></tr>); })}
          </tbody></table></div>
          <p className="small muted">Assignment and toggles: Super/System Administrators. The gateway updates health automatically every 30 s and runs the AI pipeline on cameras with AI enabled, writing verified signal changes to the event log (source “gateway”).</p>
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <div className="card"><h3>Register authorised camera</h3>
          <label>Camera name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Osu Oxford St — North approach" maxLength={120} disabled={!canReg} />
          <label>Intersection assignment (manual — GPS alone never assigns a signal)</label>
          <select value={ix} onChange={(e) => setIx(e.target.value)} disabled={!canReg}>{intersections.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          <label>Masked gateway reference</label><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="gw-accra ••••-0000" maxLength={60} disabled={!canReg} />
          <label>Retention (days)</label><select value={ret} onChange={(e) => setRet(+e.target.value)} disabled={!canReg}><option>7</option><option>14</option><option>30</option></select>
          {err && <p className="small" style={{ color: '#FF8A84' }}>{err}</p>}
          <button className="btn primary" onClick={add} disabled={!canReg || busy} style={{ marginTop: '.6rem' }}>Register camera</button>
          <p className="small muted">After registering, add the camera's RTSP source on the gateway host (<span className="mono">npm run cli add CAM-09</span>), then assign it to that gateway above.</p>
        </div>
        <div className="card"><h3>Live viewing sessions (oversight)</h3>
          <div className="small" style={{ display: 'grid', gap: '.35rem', maxHeight: 200, overflow: 'auto' }}>
            {(sessions || []).length ? sessions!.map((s) => <div key={s.id} className="card" style={{ padding: '.45rem .7rem' }}>{fmtT(s.started_at)} — <strong>{s.user_name}</strong> watched {s.camera_id} via {s.gateway_id} · last activity {relMin(s.last_activity_at)}</div>) : <span className="muted">No live views recorded yet.</span>}
          </div>
          <h3 style={{ marginTop: '1rem' }}>Camera access audit log</h3>
          <div className="small" style={{ display: 'grid', gap: '.35rem', maxHeight: 220, overflow: 'auto' }}>
            {(log || []).length ? log!.map((a) => <div key={a.id} className="card" style={{ padding: '.45rem .7rem' }}>{fmtT(a.created_at)} — {a.actor_name}: {a.action}{a.target ? ` (${a.target})` : ''}</div>) : <span className="muted">No camera activity recorded yet.</span>}
          </div>
        </div>
      </div>
    </>
  );
}
