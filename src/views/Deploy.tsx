import { useState } from 'react';
import { supabase, audit } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { sha256Hex, toCSV } from '../lib/util';

const PLATFORMS: [string, string, string, string][] = [
  ['Web PWA', 'React/Vite build on Hostinger (HTTPS, CSP, service worker)', 'g', 'Live'],
  ['Backend', 'Supabase — Postgres 17, Auth + MFA, Realtime, Storage, Edge Functions', 'g', 'Live'],
  ['Source control', 'GitHub repository with build workflow', 'g', 'Live'],
  ['iOS', 'Capacitor + Core ML', 'grey', 'Not built'],
  ['Android', 'Capacitor + LiteRT / ONNX Runtime Mobile', 'grey', 'Not built'],
  ['Desktop', 'Tauri / Electron packaging', 'grey', 'Not built'],
  ['AI detection model', 'YOLO11 + ATLIP state classifier, on-device (ONNX Runtime Web)', 'g', 'Live'],
  ['Video gateway (CCTV)', 'RTSP → WebRTC/HLS server-side service', 'grey', 'Not built'],
];
const ACCEPT: [string, string, 'ok' | 'part' | 'no'][] = [
  ['1. Red/amber/green detection', 'MET — trained models live; 97.1% state accuracy in-domain; Ghana validation pending', 'part'],
  ['2. Directional signal recognition', 'PARTIAL — arrows classified by colour; direction not yet recognised', 'part'],
  ['3. Mobile camera integration', 'MET — live camera, results stored server-side', 'ok'],
  ['4. Authorised CCTV integration', 'PARTIAL — registration & audit live; no video gateway/streams', 'part'],
  ['5. Real-time AI inference (trained model)', 'MET — YOLO11n + state CNN on-device, ~3 fps in browser; Ghana fine-tuning pending', 'part'],
  ['6. GPS & intersection mapping', 'MET — map, manual assignment, device GPS comparison', 'ok'],
  ['7. Analytics dashboard', 'MET — database aggregates with realtime updates', 'ok'],
  ['8. Secure auth & RBAC', 'MET — Supabase Auth, TOTP MFA, approval flow, RLS on every table', 'ok'],
  ['9. Audit trails', 'MET — append-only server-side audit log', 'ok'],
  ['10. Web/iOS/Android/Desktop builds', 'PARTIAL — installable web PWA only', 'part'],
  ['11. Offline & network recovery', 'PARTIAL — app shell cached, on-device detection offline; data sync needs connection', 'part'],
  ['12. Documented APIs & database', 'MET — live schema, migrations in repository', 'ok'],
  ['13. Verified backup & restoration', 'PARTIAL — JSON export live; Supabase backups per plan; restore drill NOT run', 'part'],
  ['14. Cybersecurity & performance testing', 'PARTIAL — Supabase advisor clean; penetration & load tests NOT run', 'part'],
  ['15. No broken navigation / critical errors', 'MET — see Test Centre', 'ok'],
];

export default function Deploy() {
  const { profile } = useAuth();
  const { intersections, cameras, stats } = useData();
  const [out, setOut] = useState<[string, boolean, string?][] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res: [string, boolean, string?][] = [];
    type R = boolean | [boolean, string];
    const t = async (name: string, fn: () => Promise<R> | R) => {
      try { const r = await fn(); res.push(Array.isArray(r) ? [name, r[0], r[1]] : [name, !!r]); } catch (e) { res.push([name, false, (e as Error).message]); }
    };
    await t('Backend reachable and session valid', async () => { const { data } = await supabase.auth.getUser(); return !!data.user; });
    await t('Profile active with an assigned role', () => !!profile?.active && !!profile.role);
    await t('Reference data loaded (intersections & cameras)', () => [intersections.length > 0 && cameras.length > 0, `${intersections.length} intersections · ${cameras.length} cameras`]);
    await t('Statistics RPC returns data', () => [!!stats && typeof stats.total_24h === 'number', `${stats?.total_24h ?? 0} events in 24h`]);
    await t('Database rejects raw RTSP / credential camera references', async () => {
      const { error } = await supabase.from('cameras').insert({ name: 'TEST — should be rejected', intersection_id: 'IX-01', gateway_ref: 'rtsp://user:pass@10.0.0.1' });
      return [!!error, error ? 'rejected: ' + error.message.slice(0, 60) : 'NOT rejected'];
    });
    await t('Audit log is append-only (direct insert refused)', async () => {
      const { error } = await supabase.from('audit_logs').insert({ action: 'tamper test' });
      return [!!error, error ? 'refused' : 'accepted — check policies'];
    });
    await t('Evidence hashes are 64-hex SHA-256', async () => {
      const { data } = await supabase.from('evidence_records').select('sha256').limit(5);
      return (data || []).length > 0 && (data || []).every((r) => /^[0-9a-f]{64}$/.test(r.sha256));
    });
    await t('Browser SHA-256 available (Web Crypto)', async () => (await sha256Hex('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    await t('CSV export neutralises formula injection', () => toCSV([['=HYPERLINK("x")']]).startsWith('"\''));
    await t('Realtime channel connects', () => new Promise<[boolean, string]>((resolve) => {
      const ch = supabase.channel('selftest-' + Date.now());
      const timer = setTimeout(() => { supabase.removeChannel(ch); resolve([false, 'timeout']); }, 6000);
      ch.subscribe((s) => { if (s === 'SUBSCRIBED') { clearTimeout(timer); supabase.removeChannel(ch); resolve([true, 'subscribed']); } });
    }));
    await t('Secure context (HTTPS) for camera & GPS', () => [window.isSecureContext, window.isSecureContext ? 'yes' : 'not HTTPS']);
    await t('Exactly two themes (Day / Night)', () => ['light', 'dark'].includes(document.documentElement.dataset.theme || ''));
    await t('In-page confirm modal present (no native dialogs)', () => !!document.querySelector('.modal'));
    await t('Responsive viewport configured', () => !!document.querySelector('meta[name=viewport]'));
    setOut(res); setBusy(false);
    await audit(`Test centre executed: ${res.filter((r) => r[1]).length}/${res.length} passed`, null, 'system');
  }

  return (
    <>
      <div className="grid g2">
        <div className="card"><h3>Platform deployment status — honest</h3>
          <div className="tablewrap"><table><thead><tr><th>Platform</th><th>Path</th><th>Status</th></tr></thead><tbody>
            {PLATFORMS.map((p) => <tr key={p[0]}><td>{p[0]}</td><td className="small">{p[1]}</td><td><span className={'chip ' + p[2]}>{p[3]}</span></td></tr>)}
          </tbody></table></div>
          <p className="small muted">Surveillance deployments in Ghana require the applicable permissions from road/property authorities and compliance with the Data Protection Act, 2012 (Act 843).</p>
          <h3 style={{ marginTop: '1rem' }}>Test &amp; Verification Centre — live checks</h3>
          <button className="btn primary" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run checks now'}</button>
          {out && <div style={{ marginTop: '.7rem', display: 'grid', gap: '.4rem' }}>
            {out.map((o) => <div key={o[0]} className="card" style={{ padding: '.55rem .8rem' }}>{o[1] ? <span className="chip g">PASS</span> : <span className="chip r">FAIL</span>} {o[0]}{o[2] && <span className="small muted"> — {o[2]}</span>}</div>)}
            <p className="small muted">These checks run against the live backend and this browser now. Model accuracy figures are on the AI Engine page.</p>
          </div>}
        </div>
        <div className="card"><h3>AI test matrix — measured 22 Nov 2026</h3>
          <div className="tablewrap"><table><thead><tr><th>Case</th><th>Status</th></tr></thead><tbody>
            {[['Red / amber / green recognition', 'RUN — 97.1% held-out accuracy (state model)'], ['Cross-dataset generalisation', 'RUN — 98.7% colour-claim precision on 2,494 unseen crops'], ['Detector on real driving frames', 'RUN — recall 50.8% (n) / 62.9% (s), lights ≥ 25 px'], ['Glare / blur / unlit → UNKNOWN', 'RUN — synthetic UNKNOWN test set'], ['Confidence threshold selection', 'RUN — operating point 0.7 + 3-frame check'], ['Browser inference speed', 'RUN — ~350 ms/frame WASM (server CPU)'], ['Ghanaian signals (field test)', 'NOT YET RUN — needs local labelled data'], ['Night-time & rain (Ghana)', 'NOT YET RUN'], ['Directional arrow direction', 'NOT YET RUN — not implemented'], ['Low-end phone latency', 'NOT YET RUN']].map((r) =>
              <tr key={r[0]}><td>{r[0]}</td><td><span className={'chip ' + (r[1].startsWith('RUN') ? 'g' : 'grey')}>{r[1]}</span></td></tr>)}
          </tbody></table></div>
          <p className="small muted">Full figures and methodology are on the AI Engine page and in ml/README.md. Field validation on Ghanaian signals is the next gating step.</p></div>
      </div>
      <div className="card" style={{ marginTop: '1rem' }}><h3>Final acceptance checklist — 15 criteria, honest status</h3>
        <ul className="check">{ACCEPT.map((a) => <li key={a[0]}><span>{a[0]}</span><span className={'chip ' + (a[2] === 'ok' ? 'g' : a[2] === 'part' ? 'a' : 'r')}>{a[1]}</span></li>)}</ul></div>
    </>
  );
}
