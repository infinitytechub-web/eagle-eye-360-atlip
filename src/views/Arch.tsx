const LAYERS: [string, string, boolean, string][] = [
  ['MULTI-PLATFORM CLIENTS', 'Web PWA (live) · iOS · Android · Windows · macOS', false, 'Web live'],
  ['SECURE API GATEWAY', 'Supabase Auth · JWT · RLS · Realtime WebSockets · Edge Functions', false, 'Live'],
  ['AI ENGINE', 'YOLO11 detector + ATLIP state CNN · ONNX Runtime (on-device)', true, 'Live'],
  ['VIDEO ENGINE', 'ATLIP gateway · RTSP → HLS (FFmpeg) · ticketed access · server-side AI', false, 'Built — install pending'],
  ['INTELLIGENCE', 'GPS · Analytics · Alerts', false, 'Live'],
  ['SECURITY', 'Audit · Monitoring · Evidence', false, 'Live'],
  ['DATA INFRASTRUCTURE', 'PostgreSQL · Supabase · Secure Object Storage', false, 'Live'],
];
const PRI: [string, string, string, string][] = [
  ['1', 'Working AI traffic-light detection', 'g', 'Live — trained two-stage pipeline on-device; measured on held-out and unseen real driving data. Next: fine-tune and validate on Ghanaian footage.'],
  ['2', 'Mobile camera and live detection', 'g', 'Live — getUserMedia on-device heuristic; verified state changes are stored server-side.'],
  ['3', 'CCTV integration and monitoring', 'a', 'Gateway built and tested end-to-end (live video, tickets, AI, health, oversight); install on the camera network and connect real cameras.'],
  ['4', 'Intelligence dashboard and GPS', 'g', 'Live — dashboard, analytics, reports and map run on database data with realtime updates.'],
  ['5', 'Cybersecurity and administration', 'g', 'Live — Supabase Auth, MFA, RLS, approvals, audit, admin edge function.'],
  ['6', 'iOS, Android and desktop apps', 'g', 'Capacitor 8 (iOS/Android) and Electron 45 (Windows/macOS/Linux), built and launch-tested in GitHub Actions; store and code signing pending.'],
  ['7', 'Performance, security and field testing', 'a', 'Partial — model benchmarks and RLS tests done; Ghana field trials and load tests not yet run.'],
];

export default function Arch() {
  return (
    <>
      <div className="notice"><strong>Current recommendation:</strong> the AI detection engine is now live on-device. The CCTV gateway is built; the critical path is installing it on the camera network and collecting labelled Ghanaian footage to fine-tune and field-validate the model (see gateway/README.md and ml/README.md).</div>
      <div className="card" style={{ marginTop: '1rem' }}><h3>System architecture — separation of application services</h3>
        <p className="small muted">Clients never talk to cameras or the database directly — everything passes through the authenticated API layer, and video will pass through the protected video gateway.</p>
        <div className="archflow">
          {LAYERS.map((l, i) => <div key={l[0]}>
            {i > 0 && <div className="archdown">▼</div>}
            <div className={'archlayer' + (l[2] ? ' hot' : '')}><div className="lname">{l[0]} <span className={'chip ' + (l[3].startsWith('Live') || l[3] === 'Web live' ? 'g' : l[3].startsWith('Built') ? 'a' : 'grey')} style={{ marginLeft: '.4rem' }}>{l[3]}</span></div><div className="lsub">{l[1]}</div></div>
          </div>)}
        </div>
      </div>
      <div className="card" style={{ marginTop: '1rem' }}><h3>Three important implementation decisions</h3>
        <div className="grid g3" style={{ marginTop: '.4rem' }}>
          <div><p><span className="chip g">1 · CCTV</span></p><p className="small">Process RTSP streams through a protected backend video gateway. Browsers never connect directly to RTSP cameras; the database rejects URLs and credentials in camera records.</p></div>
          <div><p><span className="chip a">2 · AI accuracy</span></p><p className="small">Detecting a red-coloured object is not the same as recognising an illuminated red traffic signal. Train and validate against real traffic-signal datasets; never rely on colour alone.</p></div>
          <div><p><span className="chip r">3 · Driving safety</span></p><p className="small">ATLIP is an assistance and monitoring tool, not a replacement for road signs, traffic laws or human observation. UNKNOWN — not a guess — is the result whenever visibility is insufficient.</p></div>
        </div>
      </div>
      <div className="card" style={{ marginTop: '1rem' }}><h3>Development priorities</h3>
        <div className="tablewrap"><table><thead><tr><th>Priority</th><th>Deliverable</th><th>Status</th></tr></thead><tbody>
          {PRI.map((p) => <tr key={p[0]}><td><strong>{p[0]}</strong></td><td>{p[1]}</td><td><span className={'chip ' + p[2]}>{p[2] === 'g' ? 'Live' : p[2] === 'a' ? 'Partial' : 'Not yet'}</span><br /><span className="small muted">{p[3]}</span></td></tr>)}
        </tbody></table></div>
      </div>
    </>
  );
}
