import { useEffect, useRef, useState } from 'react';
import { supabase, audit } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { perms } from '../lib/roles';
import { TZ } from '../lib/util';
import { TrafficLightDetector, TemporalFilter, primarySignal, drawDetections, loadManifest, type Manifest } from '../ai/detector';
import type { SignalState } from '../lib/types';

type St = 'OFF' | SignalState;
type Engine = 'model' | 'heuristic';

/** Legacy colour heuristic — kept only as a fallback for devices that cannot run the model. */
function heuristic(c: HTMLCanvasElement, v: HTMLVideoElement, sens: number): { state: SignalState; conf: number; note: string } {
  const x = c.getContext('2d', { willReadFrequently: true })!; c.width = 160; c.height = 120; x.drawImage(v, 0, 0, 160, 120);
  const d = x.getImageData(0, 0, 160, 120).data; const b = { RED: 0, CAUTION: 0, GREEN: 0 }; let bright = 0;
  for (let i = 0; i < d.length; i += 16) {
    const r = d[i], g = d[i + 1], bl = d[i + 2]; const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
    if (mx < sens || mx - mn < 50) continue; bright++;
    if (r > g * 1.35 && r > bl * 1.35) b.RED++; else if (g > r * 1.25 && g > bl * 1.2) b.GREEN++; else if (r > 150 && g > 100 && bl < 110 && Math.abs(r - g) < 110) b.CAUTION++;
  }
  let best = null as keyof typeof b | null, bn = 0;
  for (const k of Object.keys(b) as (keyof typeof b)[]) if (b[k] > bn) { bn = b[k]; best = k; }
  if (!best || bn < 6) return { state: 'UNKNOWN', conf: 0, note: `${bright} bright pixels, no dominant colour` };
  const conf = Math.min(0.97, 0.55 + (bn / (bright || 1)) * 0.9);
  return { state: conf >= 0.6 ? best : 'UNKNOWN', conf, note: `${bn} ${best} pixel clusters` };
}

export default function Mobile() {
  const { profile } = useAuth();
  const { intersections } = useData();
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const scratch = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const running = useRef(false);
  const detector = useRef<TrafficLightDetector | null>(null);
  const filter = useRef(new TemporalFilter(3));
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [engine, setEngine] = useState<Engine>('model'); const engineRef = useRef<Engine>('model'); engineRef.current = engine;
  const [detFile, setDetFile] = useState(''); const [loading, setLoading] = useState('');
  const [on, setOn] = useState(false);
  const [sens, setSens] = useState(170); const sensRef = useRef(170); sensRef.current = sens;
  const [audio, setAudio] = useState(false); const audioRef = useRef(false); audioRef.current = audio;
  const [save, setSave] = useState(true); const saveRef = useRef(true); saveRef.current = save;
  const [ix, setIx] = useState(''); const ixRef = useRef(''); ixRef.current = ix;
  const [err, setErr] = useState('');
  const [view, setView] = useState<{ st: St; title: string; conf: string; rows: [string, string][] }>({ st: 'OFF', title: 'Camera off — no frame analysed', conf: 'Start the camera and point it at the traffic signal ahead.', rows: [['Frame analysed', 'No']] });
  const [hist, setHist] = useState<string[]>([]);

  useEffect(() => { loadManifest().then((m) => { setManifest(m); setDetFile(m.detectors.find((d) => d.default)?.file || m.detectors[0].file); }).catch((e) => setErr(String(e.message))); }, []);
  useEffect(() => () => { running.current = false; stream.current?.getTracks().forEach((t) => t.stop()); detector.current?.dispose(); }, []);

  const op = manifest?.operating_point;
  const beep = (f: number) => {
    if (!audioRef.current) return;
    try { const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; const ctx = new Ctx(); const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; o.connect(g); g.connect(ctx.destination); g.gain.value = 0.08; o.start(); o.stop(ctx.currentTime + 0.18); } catch { /* ignore */ }
  };

  function record(state: SignalState, conf: number, source: 'model' | 'mobile-heuristic', detail?: string) {
    const t = new Date().toLocaleTimeString('en-GB', { timeZone: TZ });
    setHist((h) => [`${t} — ${state}${state === 'UNKNOWN' ? ' (no confident signal)' : ' · conf ' + Math.round(conf * 100) + '%'} · ${source === 'model' ? 'AI model' : 'heuristic'}`, ...h].slice(0, 25));
    beep(state === 'RED' ? 520 : state === 'GREEN' ? 880 : 660);
    if (saveRef.current && perms.recordDetection(profile?.role))
      supabase.from('detection_events').insert({ intersection_id: ixRef.current || null, state, detail: detail || null, confidence: state === 'UNKNOWN' ? null : Number(conf.toFixed(3)), verified: state !== 'UNKNOWN', source, user_id: profile!.id }).then(() => {});
  }

  async function loop() {
    const v = video.current!, ov = overlay.current!;
    while (running.current) {
      if (!v.videoWidth) { await new Promise((r) => setTimeout(r, 100)); continue; }
      const t0 = performance.now();
      if (engineRef.current === 'model' && detector.current) {
        try {
          const { dets, ms } = await detector.current.detect(v, op?.detector_conf ?? 0.3, op?.nms_iou ?? 0.45);
          const p = primarySignal(dets, op?.state_conf ?? 0.7);
          ov.width = ov.clientWidth; ov.height = ov.clientHeight;
          const ctx = ov.getContext('2d')!; ctx.clearRect(0, 0, ov.width, ov.height);
          // video uses object-fit: cover — map source pixels onto the displayed box
          const s = Math.max(ov.width / v.videoWidth, ov.height / v.videoHeight); const ox = (ov.width - v.videoWidth * s) / 2, oy = (ov.height - v.videoHeight * s) / 2;
          ctx.save(); ctx.translate(ox, oy); drawDetections(ctx, dets, s, s, op?.state_conf ?? 0.7, p.det); ctx.restore();
          const f = filter.current.push(p.state);
          if (f.changed) record(p.state, p.conf, 'model', p.det?.horizontal ? 'horizontal housing' : undefined);
          const cur = filter.current.current;
          setView({
            st: cur === 'OFF' ? 'UNKNOWN' : cur, title: cur === 'OFF' ? 'Analysing…' : cur === 'UNKNOWN' ? 'No confident signal (UNKNOWN)' : 'Observed: ' + cur,
            conf: cur === 'UNKNOWN' ? 'No traffic light classified with enough confidence. UNKNOWN is the safe result — verify visually.' : `Model confidence ${Math.round(p.conf * 100)}% · verified across ${f.stable} frame(s). Advisory only.`,
            rows: [['Engine', 'AI model — YOLO11 detector + ATLIP state classifier (on-device)'], ['Traffic lights detected', String(dets.length)],
              ['Primary signal', p.det ? `${p.det.state} ${Math.round(p.det.stateConf * 100)}% (box ${Math.round(p.det.box[3] - p.det.box[1])} px tall)` : 'None'],
              ['Temporal verification', `${f.stable}/${op?.temporal_frames ?? 3} agreeing frames`], ['Inference time', `${Math.round(ms)} ms / frame`]],
          });
        } catch (e) { setErr('Model error: ' + (e as Error).message + ' — switching to the heuristic fallback.'); setEngine('heuristic'); }
      } else {
        const h = heuristic(scratch.current!, v, sensRef.current);
        const ctx = ov.getContext('2d'); ctx?.clearRect(0, 0, ov.width, ov.height);
        const f = filter.current.push(h.state); if (f.changed) record(h.state, h.conf, 'mobile-heuristic');
        const cur = filter.current.current;
        setView({ st: cur === 'OFF' ? 'UNKNOWN' : cur, title: cur === 'OFF' ? 'Analysing…' : 'Observed: ' + cur, conf: 'Heuristic fallback (colour only, not the AI model) — verify visually.',
          rows: [['Engine', 'Colour heuristic (fallback)'], ['Analysis', h.note], ['Temporal verification', `${f.stable} agreeing frame(s)`]] });
        await new Promise((r) => setTimeout(r, Math.max(0, 450 - (performance.now() - t0))));
      }
    }
  }

  async function start() {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia) { setErr('Camera API not available in this browser/context (HTTPS is required). No detection is simulated instead.'); return; }
    try {
      if (engine === 'model') {
        if (!detector.current) detector.current = new TrafficLightDetector();
        if (detector.current.loadedDetector !== detFile) { setLoading('Downloading and preparing the AI model (first time only — then cached on this device)…'); await detector.current.load(detFile, manifest!.state_classifier.file); setLoading(''); }
      }
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      video.current!.srcObject = stream.current; await video.current!.play();
      filter.current.reset(); running.current = true; setOn(true); loop();
      audit(`Mobile camera started (${engine === 'model' ? 'AI model' : 'heuristic'})`, ixRef.current || null, 'detection');
    } catch (e) { setLoading(''); setErr('Could not start: ' + (e as Error).message + ' — no detection claimed.'); }
  }
  function stop() {
    running.current = false; stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    if (video.current) video.current.srcObject = null; setOn(false);
    overlay.current?.getContext('2d')?.clearRect(0, 0, overlay.current.width, overlay.current.height);
    setView({ st: 'OFF', title: 'Camera off — no frame analysed', conf: 'Start the camera to analyse real frames.', rows: [['Frame analysed', 'No']] });
  }

  return (
    <>
      <div className="notice warn"><strong>Driving safety:</strong> results are <strong>advisory only</strong>. The AI model runs entirely on this device; frames never leave it. When no signal is classified confidently the answer is <strong>UNKNOWN</strong> — never a guess. Mount the phone securely and do not operate it while driving. Always obey the physical signal and road rules.</div>
      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <div className="card"><h3>Live camera (rear preferred)</h3>
          <div style={{ position: 'relative' }}>
            <video ref={video} playsInline muted />
            <canvas ref={overlay} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
          </div>
          <canvas ref={scratch} style={{ display: 'none' }} />
          <div className="pillrow" style={{ marginTop: '.6rem' }}>
            <button className="btn primary" onClick={start} disabled={on || !!loading || !manifest}>Start camera</button>
            <button className="btn" onClick={stop} disabled={!on}>Stop</button>
            <label style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center', margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={audio} onChange={(e) => setAudio(e.target.checked)} /> Audio alerts</label>
          </div>
          {loading && <p className="small" style={{ color: 'var(--lime)' }}>{loading}</p>}
          <label>Detection engine</label>
          <select value={engine} onChange={(e) => setEngine(e.target.value as Engine)} disabled={on}>
            <option value="model">AI model — YOLO11 + ATLIP state classifier (recommended)</option>
            <option value="heuristic">Colour heuristic (fallback for low-end devices)</option>
          </select>
          {engine === 'model' && manifest && <><label>Model size</label>
            <select value={detFile} onChange={(e) => setDetFile(e.target.value)} disabled={on}>{manifest.detectors.map((d) => <option key={d.id} value={d.file}>{d.label}</option>)}</select></>}
          {engine === 'heuristic' && <><label htmlFor="sens">Sensitivity: {sens}</label><input type="range" id="sens" min={90} max={240} value={sens} onChange={(e) => setSens(+e.target.value)} /></>}
          {perms.recordDetection(profile?.role) && <>
            <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={save} onChange={(e) => setSave(e.target.checked)} /> Save verified state changes to the event log</label>
            <label>Intersection being observed (manual — GPS never assigns a signal)</label>
            <select value={ix} onChange={(e) => setIx(e.target.value)}><option value="">Not at a registered intersection</option>{intersections.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          </>}
          {err && <p className="small" style={{ color: '#FF8A84' }}>{err}</p>}
        </div>
        <div className="card"><h3>Live result</h3>
          <div className="sig"><div className={'lamp ' + (view.st === 'OFF' ? 'UNKNOWN' : view.st)}>{view.st}</div><div><strong style={{ fontSize: '1.25rem' }}>{view.title}</strong><br /><span className="muted">{view.conf}</span></div></div>
          <table style={{ marginTop: '.7rem' }}><tbody>{view.rows.map((r) => <tr key={r[0]}><td className="muted">{r[0]}</td><td><strong>{r[1]}</strong></td></tr>)}</tbody></table>
          <h3 style={{ marginTop: '1rem' }}>Verified state changes (this session)</h3>
          <div className="small" style={{ display: 'grid', gap: '.35rem', maxHeight: 220, overflow: 'auto' }}>
            {hist.length ? hist.map((h, i) => <div key={i} className="card" style={{ padding: '.4rem .6rem' }}>{h}</div>) : <span className="muted">No verified changes yet.</span>}
          </div>
          <p className="small muted" style={{ marginTop: '.6rem' }}>The model reports the largest (nearest) confidently classified signal. If two nearby signals disagree, it reports UNKNOWN. A state is shown only after {op?.temporal_frames ?? 3} consecutive agreeing frames.</p>
        </div>
      </div>
    </>
  );
}
