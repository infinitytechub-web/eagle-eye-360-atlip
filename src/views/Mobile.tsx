import { useEffect, useRef, useState } from 'react';
import { supabase, audit } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { perms } from '../lib/roles';
import { TZ } from '../lib/util';

type St = 'OFF' | 'RED' | 'CAUTION' | 'GREEN' | 'UNKNOWN';

export default function Mobile() {
  const { profile } = useAuth();
  const { intersections } = useData();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const smooth = useRef({ candidate: '' as string, stable: 0, last: 'OFF' as St });
  const [running, setRunning] = useState(false);
  const [sens, setSens] = useState(170);
  const sensRef = useRef(170); sensRef.current = sens;
  const [audio, setAudio] = useState(false); const audioRef = useRef(false); audioRef.current = audio;
  const [save, setSave] = useState(true); const saveRef = useRef(true); saveRef.current = save;
  const [ix, setIx] = useState(''); const ixRef = useRef(''); ixRef.current = ix;
  const [err, setErr] = useState('');
  const [view, setView] = useState<{ st: St; title: string; conf: string; rows: [string, string][] }>({ st: 'OFF', title: 'Camera off — no frame analysed', conf: 'Start the camera and point it at a bright red, amber or green light.', rows: [['Frame analysed', 'No']] });
  const [hist, setHist] = useState<string[]>([]);

  const beep = (f: number) => {
    if (!audioRef.current) return;
    try { const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; const ctx = new Ctx(); const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; o.connect(g); g.connect(ctx.destination); g.gain.value = 0.08; o.start(); o.stop(ctx.currentTime + 0.18); } catch { /* ignore */ }
  };

  function analyse() {
    const v = video.current, c = canvas.current; if (!v || !c || !v.videoWidth) return;
    const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(v, 0, 0, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data; const s = sensRef.current;
    const b = { RED: 0, CAUTION: 0, GREEN: 0 }; let bright = 0;
    for (let i = 0; i < d.length; i += 16) {
      const r = d[i], g = d[i + 1], bl = d[i + 2]; const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
      if (mx < s || mx - mn < 50) continue; bright++;
      if (r > g * 1.35 && r > bl * 1.35) b.RED++; else if (g > r * 1.25 && g > bl * 1.2) b.GREEN++; else if (r > 150 && g > 100 && bl < 110 && Math.abs(r - g) < 110) b.CAUTION++;
    }
    let best = null as keyof typeof b | null, bn = 0;
    for (const k of Object.keys(b) as (keyof typeof b)[]) { if (b[k] > bn) { bn = b[k]; best = k; } }
    let state = 'UNKNOWN' as St, conf = 0;
    if (best && bn >= 6) { conf = Math.min(0.97, 0.55 + (bn / (bright || 1)) * 0.9); state = conf >= 0.6 ? best : 'UNKNOWN'; }
    const sm = smooth.current;
    if (state === sm.candidate) sm.stable++; else { sm.candidate = state; sm.stable = 1; }
    const rows: [string, string][] = [['Frame analysed', `Yes — ${c.width}×${c.height} downsample`], ['Bright saturated regions', String(bright)], ['Dominant candidate', best ? `${best} (${bn} px clusters)` : 'None'], ['Temporal stability', `${sm.stable} frame(s) agreeing`], ['Low-light / glare note', bright === 0 ? 'Too dark or no signal in view' : 'OK']];
    if (sm.stable >= 2 && state !== sm.last) {
      sm.last = state;
      const t = new Date().toLocaleTimeString('en-GB', { timeZone: TZ });
      setHist((h) => [`${t} — ${state}${state === 'UNKNOWN' ? ' (visibility insufficient)' : ' · conf ' + Math.round(conf * 100) + '%'}`, ...h].slice(0, 20));
      beep(state === 'RED' ? 520 : state === 'GREEN' ? 880 : 660);
      if (saveRef.current && perms.recordDetection(profile?.role)) {
        supabase.from('detection_events').insert({ intersection_id: ixRef.current || null, state, confidence: state === 'UNKNOWN' ? null : Number(conf.toFixed(3)), verified: state !== 'UNKNOWN', source: 'mobile-heuristic', user_id: profile!.id }).then(() => {});
      }
    }
    const l = sm.last;
    setView({ st: l === 'OFF' ? 'UNKNOWN' : l, title: l === 'OFF' ? 'Analysing…' : 'Observed: ' + l, conf: l === 'UNKNOWN' ? 'Visibility insufficient — UNKNOWN is the safe result. Point at one bright signal colour.' : `Heuristic confidence ${Math.round(conf * 100)}% (heuristic detector — verify visually).`, rows });
  }

  async function start() {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia) { setErr('Camera API not available in this browser/context (HTTPS is required). No detection is simulated instead.'); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.current!.srcObject = stream.current; await video.current!.play();
      smooth.current = { candidate: '', stable: 0, last: 'OFF' };
      timer.current = window.setInterval(analyse, 450); setRunning(true);
      audit('Mobile camera started (on-device heuristic detector)', ixRef.current || null, 'detection');
    } catch (e) { setErr('Camera permission denied or unavailable: ' + (e as Error).message + ' — no detection claimed.'); }
  }
  function stop() {
    window.clearInterval(timer.current); stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    if (video.current) video.current.srcObject = null; setRunning(false);
    setView({ st: 'OFF', title: 'Camera off — no frame analysed', conf: 'Start the camera to analyse real frames.', rows: [['Frame analysed', 'No']] });
  }
  useEffect(() => () => { window.clearInterval(timer.current); stream.current?.getTracks().forEach((t) => t.stop()); }, []);

  return (
    <>
      <div className="notice warn"><strong>Honest label:</strong> this is an <strong>on-device heuristic detector</strong> — it analyses bright illuminated regions in the camera frame and classifies their hue/position. It is <strong>not</strong> a trained YOLO model. When the camera is off, no detection is claimed. Alerts are advisory only — never guaranteed driving instructions. Always obey the physical signal.</div>
      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <div className="card"><h3>Live camera (rear preferred)</h3>
          <video ref={video} playsInline muted />
          <canvas ref={canvas} width={160} height={120} style={{ display: 'none' }} />
          <div className="pillrow" style={{ marginTop: '.6rem' }}>
            <button className="btn primary" onClick={start} disabled={running}>Start camera</button>
            <button className="btn" onClick={stop} disabled={!running}>Stop</button>
            <label style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center', margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={audio} onChange={(e) => setAudio(e.target.checked)} /> Audio alerts</label>
          </div>
          <label htmlFor="sens">Sensitivity (minimum brightness to count as “illuminated”): {sens}</label>
          <input type="range" id="sens" min={90} max={240} value={sens} onChange={(e) => setSens(+e.target.value)} />
          {perms.recordDetection(profile?.role) && <>
            <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={save} onChange={(e) => setSave(e.target.checked)} /> Save verified state changes to the event log</label>
            <label>Intersection being observed (manual — GPS never assigns a signal)</label>
            <select value={ix} onChange={(e) => setIx(e.target.value)}><option value="">Not at a registered intersection</option>{intersections.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          </>}
          <p className="small muted">Low light / glare lowers confidence and can produce UNKNOWN — that is the correct, safe result. The heuristic runs fully on-device; only state changes are sent to the server.</p>
          {err && <p className="small" style={{ color: '#FF8A84' }}>{err}</p>}
        </div>
        <div className="card"><h3>Live result</h3>
          <div className="sig"><div className={'lamp ' + (view.st === 'OFF' ? 'UNKNOWN' : view.st)}>{view.st}</div><div><strong style={{ fontSize: '1.25rem' }}>{view.title}</strong><br /><span className="muted">{view.conf}</span></div></div>
          <table style={{ marginTop: '.7rem' }}><tbody>{view.rows.map((r) => <tr key={r[0]}><td className="muted">{r[0]}</td><td><strong>{r[1]}</strong></td></tr>)}</tbody></table>
          <h3 style={{ marginTop: '1rem' }}>Detection history (this session)</h3>
          <div className="small" style={{ display: 'grid', gap: '.35rem', maxHeight: 220, overflow: 'auto' }}>
            {hist.length ? hist.map((h, i) => <div key={i} className="card" style={{ padding: '.4rem .6rem' }}>{h}</div>) : <span className="muted">No verified changes yet.</span>}
          </div>
        </div>
      </div>
    </>
  );
}
