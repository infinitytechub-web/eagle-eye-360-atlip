const LAYERS: [string, string, boolean, string][] = [
  ['MULTI-PLATFORM CLIENTS', 'Web PWA (live) · iOS · Android · Windows · macOS', false, 'Web live'],
  ['SECURE API GATEWAY', 'Supabase Auth · JWT · RLS · Realtime WebSockets · Edge Functions', false, 'Live'],
  ['AI ENGINE', 'YOLO · OpenCV · PyTorch', true, 'Not yet built'],
  ['VIDEO ENGINE', 'RTSP · GStreamer · WebRTC', false, 'Not yet built'],
  ['INTELLIGENCE', 'GPS · Analytics · Alerts', false, 'Live'],
  ['SECURITY', 'Audit · Monitoring · Evidence', false, 'Live'],
  ['DATA INFRASTRUCTURE', 'PostgreSQL · Supabase · Secure Object Storage', false, 'Live'],
];
const PRI: [string, string, string, string][] = [
  ['1', 'Working AI traffic-light detection prototype', 'a', 'In progress — verification pipeline and labelled heuristic run; a trained YOLO model validated on a real Ghana signal dataset is the gating step.'],
  ['2', 'Mobile camera and live detection', 'g', 'Live — getUserMedia on-device heuristic; verified state changes are stored server-side.'],
  ['3', 'CCTV integration and monitoring', 'a', 'Partial — registration, status, audit and masked references live; video gateway and real streams not connected.'],
  ['4', 'Intelligence dashboard and GPS', 'g', 'Live — dashboard, analytics, reports and map run on database data with realtime updates.'],
  ['5', 'Cybersecurity and administration', 'g', 'Live — Supabase Auth, MFA, RLS, approvals, audit, admin edge function.'],
  ['6', 'iOS, Android and desktop packaging', 'grey', 'Not built — installable PWA today; Capacitor and Tauri are the planned paths.'],
  ['7', 'Performance, security and field testing', 'grey', 'Not yet run — awaits the trained model; Supabase advisor checks pass.'],
];

export default function Arch() {
  return (
    <>
      <div className="notice"><strong>Strongest recommendation:</strong> build and validate the AI detection engine next, then integrate it into the web and mobile interfaces. The platform around it — authentication, data, realtime, audit — is now live, so the detection engine is the critical path.</div>
      <div className="card" style={{ marginTop: '1rem' }}><h3>System architecture — separation of application services</h3>
        <p className="small muted">Clients never talk to cameras or the database directly — everything passes through the authenticated API layer, and video will pass through the protected video gateway.</p>
        <div className="archflow">
          {LAYERS.map((l, i) => <div key={l[0]}>
            {i > 0 && <div className="archdown">▼</div>}
            <div className={'archlayer' + (l[2] ? ' hot' : '')}><div className="lname">{l[0]} <span className={'chip ' + (l[3].startsWith('Live') || l[3] === 'Web live' ? 'g' : 'grey')} style={{ marginLeft: '.4rem' }}>{l[3]}</span></div><div className="lsub">{l[1]}</div></div>
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
