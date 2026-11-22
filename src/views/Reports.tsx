import { useState } from 'react';
import { supabase, audit } from '../lib/supabase';
import { useLive, must } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { perms } from '../lib/roles';
import { downloadBlob, fmtFull, fmtT, toCSV, errMsg } from '../lib/util';
import { StateChip, useModal } from '../components/ui';
import type { AuditLog, DetectionEvent, Evidence, SignalState } from '../lib/types';

const RANGES: Record<string, number> = { 'Daily operational report': 1, 'Weekly report': 7, 'Monthly report': 30, 'Camera activity report': 7, 'Signal detection report': 7, 'AI accuracy report (review flags only)': 7 };

export default function Reports() {
  const { profile } = useAuth();
  const { intersections, cameras } = useData();
  const modal = useModal();
  const ev = useLive(async () => must(await supabase.from('evidence_records').select('*').order('created_at', { ascending: false }).limit(50)) as Evidence[], []);
  const { data: evAudit } = useLive(async () => must(await supabase.from('audit_logs').select('*').eq('category', 'evidence').order('created_at', { ascending: false }).limit(30)) as AuditLog[], ['audit_logs']);
  const [type, setType] = useState(Object.keys(RANGES)[0]);
  const [out, setOut] = useState<React.ReactNode>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ixName = (id: string | null) => intersections.find((i) => i.id === id)?.name || id || '—';

  async function fetchEvents(days: number) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const all: DetectionEvent[] = [];
    for (let from = 0; from < 20000; from += 1000) {
      const page = must(await supabase.from('detection_events').select('*').gte('created_at', since).order('created_at', { ascending: false }).range(from, from + 999)) as DetectionEvent[];
      all.push(...page); if (page.length < 1000) break;
    }
    return all;
  }
  async function generate() {
    setBusy(true); setErr('');
    try {
      const days = RANGES[type]; const evs = await fetchEvents(days);
      const c = (s: SignalState) => evs.filter((e) => e.state === s).length;
      const flagged = evs.filter((e) => e.state === 'UNKNOWN' || Number(e.confidence) < 0.7).length;
      setOut(<div className="notice"><strong>{type}</strong> — generated {fmtFull(Date.now())} (Africa/Accra), last {days} day(s)<br />
        Detections in scope: {evs.length} · RED {c('RED')} · CAUTION {c('CAUTION')} · GREEN {c('GREEN')} · UNKNOWN {c('UNKNOWN')}<br />
        Active cameras: {cameras.filter((x) => x.status !== 'Offline').length}/{cameras.length} · Flagged for analyst review: {flagged}<br />
        <span className="small muted">Observed states are not violation findings.</span></div>);
      await audit('Generated report: ' + type, null, 'evidence');
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  async function csv() {
    setBusy(true); setErr('');
    try {
      const evs = await fetchEvents(RANGES[type]);
      const rows = [['timestamp_accra', 'intersection', 'camera', 'state', 'detail', 'confidence', 'verified', 'source'],
        ...evs.map((e) => [fmtFull(e.created_at), ixName(e.intersection_id), e.camera_id, e.state, e.detail, e.confidence, e.verified ? 'yes' : 'no', e.source])];
      downloadBlob(`atlip-detections-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + toCSV(rows), 'text/csv;charset=utf-8');
      await audit(`Exported detections CSV (${evs.length} rows)`, type, 'evidence');
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  async function view(e: Evidence) {
    await audit('Viewed evidence metadata', e.ref, 'evidence');
    modal({ title: 'Evidence ' + e.ref, ok: 'Close', body: <>
      <span className="mono">SHA-256 integrity hash (computed in the database):<br />{e.sha256}</span><br /><br />
      Intersection: {ixName(e.intersection_id)}<br />Observed state: {e.state}<br />Created: {fmtT(e.created_at)} · Retain until {e.retention_until}<br />{e.notes}</> });
  }
  // create evidence
  const [nIx, setNIx] = useState('IX-01'); const [nSt, setNSt] = useState<SignalState>('RED'); const [nNotes, setNNotes] = useState('');
  async function createEv() {
    setErr('');
    const ref = 'EV-' + new Date().getFullYear() + '-' + Date.now().toString().slice(-6);
    const { error } = await supabase.from('evidence_records').insert({ ref, intersection_id: nIx, state: nSt, notes: nNotes.trim() || null, created_by: profile!.id });
    if (error) return setErr(error.message);
    await audit('Evidence record created', ref, 'evidence'); setNNotes(''); ev.reload();
  }

  return (
    <div className="grid g2">
      <div className="card"><h3>Generate report</h3>
        <label>Report type</label><select value={type} onChange={(e) => setType(e.target.value)}>{Object.keys(RANGES).map((r) => <option key={r}>{r}</option>)}</select>
        <div className="pillrow" style={{ marginTop: '.8rem' }}><button className="btn primary" onClick={generate} disabled={busy}>Generate summary</button><button className="btn" onClick={csv} disabled={busy}>Download CSV (Excel-compatible)</button></div>
        {err && <p className="small" style={{ color: '#FF8A84' }}>{err}</p>}
        <div style={{ marginTop: '.8rem' }}>{out}</div>
        <p className="small muted">Retention: evidence metadata 90 days by default. Deletion is audit-logged and restricted to Super Administrators and Supervisors by the database.</p>
        {perms.createEvidence(profile?.role) && <><h3 style={{ marginTop: '1rem' }}>Create evidence record</h3>
          <label>Intersection</label><select value={nIx} onChange={(e) => setNIx(e.target.value)}>{intersections.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          <label>Observed state</label><select value={nSt} onChange={(e) => setNSt(e.target.value as SignalState)}><option>RED</option><option>CAUTION</option><option>GREEN</option><option>UNKNOWN</option></select>
          <label>Notes</label><textarea rows={2} value={nNotes} onChange={(e) => setNNotes(e.target.value)} maxLength={1000} />
          <button className="btn small primary" style={{ marginTop: '.5rem' }} onClick={createEv}>Create &amp; hash</button></>}
      </div>
      <div className="card"><h3>Evidence records (SHA-256 integrity-hashed)</h3>
        <div className="tablewrap"><table><thead><tr><th>Ref</th><th>Intersection</th><th>State</th><th>SHA-256</th><th></th></tr></thead><tbody>
          {(ev.data || []).map((e) => <tr key={e.id}><td className="mono">{e.ref}</td><td>{ixName(e.intersection_id)}</td><td><StateChip s={e.state} /></td><td className="mono">{e.sha256.slice(0, 18)}…</td><td><button className="btn small" onClick={() => view(e)}>View</button></td></tr>)}
        </tbody></table></div>
        <h3 style={{ marginTop: '1rem' }}>Evidence access audit trail</h3>
        <div className="small" style={{ display: 'grid', gap: '.35rem' }}>{(evAudit || []).map((a) => <div key={a.id} className="card" style={{ padding: '.45rem .7rem' }}>{fmtT(a.created_at)} — {a.actor_name}: {a.action}{a.target ? ` (${a.target})` : ''}</div>)}</div>
      </div>
    </div>
  );
}
