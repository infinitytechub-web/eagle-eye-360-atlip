import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useLive, must } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useData, statusOf } from '../lib/data';
import { perms, ROLE_LABEL, ROLES } from '../lib/roles';
import { fmtT, relMin } from '../lib/util';
import { Bars, Donut, StateChip, sevDot } from '../components/ui';
import type { Alert, DetectionEvent, SignalState } from '../lib/types';

function LiveUsers() {
  const { directory, presence } = useData();
  const [q, setQ] = useState(''); const [rf, setRf] = useState(''); const [showS, setShowS] = useState(false);
  const rows = directory.filter((d) => d.active && (!rf || d.role === rf) && (!q || (d.full_name + d.email).toLowerCase().includes(q.toLowerCase())));
  const counts = { online: 0, idle: 0 };
  directory.forEach((d) => { const s = statusOf(d, presence); if (s === 'online') counts.online++; else if (s === 'idle') counts.idle++; });
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>● LIVE USERS ONLINE <span className="chip g">{counts.online} online · {counts.idle} idle</span></h3>
        <span className="chip a">LIVE · Realtime presence</span>
      </div>
      <p className="small muted" style={{ margin: '.4rem 0' }}>Visible to Super Administrators, System Administrators and Supervisors. Presence comes from secure Realtime channels; idle after 5 minutes without input, offline when the session closes. No message content is shown here.</p>
      <div className="pillrow" style={{ margin: '.4rem 0' }}>
        <input placeholder="Search by name…" style={{ maxWidth: 230 }} value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ maxWidth: 240 }} value={rf} onChange={(e) => setRf(e.target.value)}><option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        <button className="btn small" onClick={() => setShowS(!showS)}>{showS ? 'Hide active sessions' : 'Show active sessions'}</button>
      </div>
      <div style={{ display: 'grid', gap: '.45rem' }}>
        {rows.length ? rows.map((u) => { const st = statusOf(u, presence); return (
          <div key={u.id} className="lurow"><span className={'statusdot ' + (st === 'online' ? 'on' : st === 'idle' ? 'idle' : 'off')} style={{ marginTop: '.35rem' }} />
            <div style={{ flex: 1 }}><strong>{u.full_name || u.email}</strong> <span className={'chip ' + (st === 'online' ? 'g' : st === 'idle' ? 'a' : 'grey')}>{st.toUpperCase()}</span><br />
              <span className="small muted">{ROLE_LABEL[u.role]}{u.command ? ' · ' + u.command : ''}<br />Last seen: {u.last_seen_at ? `${fmtT(u.last_seen_at)} (${relMin(u.last_seen_at)})` : 'never'}</span></div></div>); })
          : <p className="muted small">No users match the search / filter.</p>}
      </div>
      {showS && <div className="tablewrap" style={{ marginTop: '.7rem' }}><table><thead><tr><th>User</th><th>Device</th><th>Since</th><th>Status</th></tr></thead><tbody>
        {Object.values(presence).map((p) => { const u = directory.find((d) => d.id === p.user_id); return <tr key={p.user_id}><td>{u?.full_name || u?.email || p.user_id}</td><td className="small">{p.device}</td><td className="small">{fmtT(p.online_at)}</td><td><span className={'chip ' + (p.idle ? 'a' : 'g')}>{p.idle ? 'idle' : 'online'}</span></td></tr>; })}
      </tbody></table></div>}
    </div>
  );
}

export default function Dashboard() {
  const { profile } = useAuth();
  const { stats, cameras, intersections } = useData();
  const { data: feed } = useLive(async () => must(await supabase.from('detection_events').select('*').order('created_at', { ascending: false }).limit(8)) as DetectionEvent[], ['detection_events']);
  const { data: alerts } = useLive(async () => must(await supabase.from('alerts').select('*').order('created_at', { ascending: false }).limit(4)) as Alert[], ['alerts']);

  const online = cameras.filter((c) => c.status !== 'Offline').length;
  const conf = stats?.mean_conf_verified_24h != null ? Math.round(Number(stats.mean_conf_verified_24h) * 100) : null;
  const camAcc = cameras.length - online === 0 ? 'green' : online / Math.max(cameras.length, 1) >= 0.5 ? 'amber' : 'red';
  const confAcc = conf == null ? 'blue' : conf >= 75 ? 'green' : conf >= 60 ? 'amber' : 'red';
  const s24 = stats?.by_state_24h || {};
  const hours = Array.from({ length: 24 }, (_, i) => ({ l: String(i).padStart(2, '0') + ':00', v: Number(stats?.by_hour_24h?.[i] || 0) })).filter((_, i) => i % 2 === 0);
  const ixName = (id: string | null) => intersections.find((i) => i.id === id)?.name || id || '—';

  return (
    <div id="v-dashboard">
      {perms.liveUsers(profile?.role) && <LiveUsers />}
      <div className="grid g4">
        <div className="card stat" data-acc="blue"><span>Total detected signals (24h)</span><b>{stats ? stats.total_24h.toLocaleString() : '—'}</b><span className="muted">All sources, Ghana intersections</span></div>
        <div className="card stat" data-acc={camAcc}><span>Active cameras / devices</span><b>{online} / {cameras.length}</b><span className="muted">Authorised cameras only</span></div>
        <div className="card stat" data-acc={confAcc}><span>Mean confidence</span><b>{conf != null ? conf + '%' : '—'}</b><span className="muted">Verified events only</span></div>
        <div className="card stat" data-acc="green"><span>System health</span><b>ONLINE</b><span className="muted">Database & realtime: connected · AI gateway: not yet connected</span></div>
      </div>
      <div className="grid g3" style={{ marginTop: '1rem' }}>
        <div className="card"><h3>Signal states — last 24h</h3>
          <Donut parts={(['RED', 'CAUTION', 'GREEN', 'UNKNOWN'] as SignalState[]).map((k) => [k, Number(s24[k] || 0)])} />
          <p>Observed signal states only. An observed RED is <strong>not</strong> a claim that any vehicle violated a signal.</p></div>
        <div className="card"><h3>Detections by hour (Accra time)</h3><Bars data={hours} /><p>Morning &amp; evening peaks at Circle and Madina.</p></div>
        <div className="card"><h3>Live event feed</h3>
          <div style={{ display: 'grid', gap: '.5rem', maxHeight: 300, overflow: 'auto' }}>
            {(feed || []).map((e) => <div key={e.id} className="card" style={{ padding: '.5rem .7rem' }}><StateChip s={e.state} /> <strong>{ixName(e.intersection_id)}</strong><br />
              <span className="muted small">{e.source} · {e.confidence != null ? 'conf ' + Math.round(Number(e.confidence) * 100) + '%' : 'confidence withheld'} · {relMin(e.created_at)}</span></div>)}
          </div>
          <p className="small">Streams new detection events from the database in real time (mobile detector, demo scenes and seed history are labelled by source).</p></div>
      </div>
      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <div className="card"><h3>Intersection monitoring</h3><div className="tablewrap"><table><thead><tr><th>Intersection</th><th>Current observed state</th><th>Cameras</th><th>Health</th></tr></thead><tbody>
          {intersections.map((ix) => <tr key={ix.id}><td><strong>{ix.name}</strong><br /><span className="muted small">{ix.city} · {ix.lat.toFixed(4)}, {ix.lon.toFixed(4)}</span></td><td><StateChip s={ix.current_state} /></td><td>{cameras.filter((c) => c.intersection_id === ix.id).length}</td><td>{ix.current_state === 'UNKNOWN' ? <span className="chip a">Check feed</span> : <span className="chip g">Monitoring</span>}</td></tr>)}
        </tbody></table></div></div>
        <div className="card"><h3>Recent alerts &amp; activity</h3><div style={{ display: 'grid', gap: '.5rem' }}>
          {(alerts || []).map((a) => <div key={a.id} className="card" style={{ padding: '.6rem .8rem' }}><span className={'dot ' + sevDot(a.severity)} /> {a.body}<br /><span className="muted small">{relMin(a.created_at)} · {a.kind}</span></div>)}
        </div></div>
      </div>
    </div>
  );
}
