import { useEffect, useRef, useState } from 'react';
import { supabase, audit } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { perms } from '../lib/roles';
import { TrafficLightDetector, TemporalFilter, primarySignal, drawDetections, loadManifest, type Detection, type Manifest } from '../ai/detector';
import { StateChip } from './ui';

/** Run the AI pipeline on an uploaded photo or dashcam video — everything stays on this device. */
export function ModelAnalyse() {
  const { profile } = useAuth();
  const { intersections } = useData();
  const canvas = useRef<HTMLCanvasElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const det = useRef<TrafficLightDetector | null>(null);
  const playing = useRef(false);
  const [m, setM] = useState<Manifest | null>(null);
  const [detFile, setDetFile] = useState('');
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  const [dets, setDets] = useState<Detection[]>([]); const [ms, setMs] = useState(0);
  const [verdict, setVerdict] = useState<{ state: string; conf: number } | null>(null);
  const [ix, setIx] = useState(''); const [saved, setSaved] = useState('');
  const [isVideo, setIsVideo] = useState(false);

  useEffect(() => { loadManifest().then((x) => { setM(x); setDetFile(x.detectors.find((d) => d.default)!.file); }).catch((e) => setErr(e.message)); return () => { playing.current = false; det.current?.dispose(); }; }, []);
  const op = m?.operating_point;

  async function ensure() {
    if (!det.current) det.current = new TrafficLightDetector();
    if (det.current.loadedDetector !== detFile) { setBusy('Loading AI model (first time only — cached afterwards)…'); await det.current.load(detFile, m!.state_classifier.file); }
  }
  function paint(src: CanvasImageSource, w: number, h: number, d: Detection[], primary: Detection | null) {
    const c = canvas.current!; const s = Math.min(1, 900 / w); c.width = Math.round(w * s); c.height = Math.round(h * s);
    const ctx = c.getContext('2d')!; ctx.drawImage(src, 0, 0, c.width, c.height); drawDetections(ctx, d, s, s, op!.state_conf, primary);
  }

  async function onFile(f: File) {
    setErr(''); setSaved(''); setVerdict(null); playing.current = false;
    try {
      await ensure();
      if (f.type.startsWith('image/')) {
        setIsVideo(false); setBusy('Analysing image…');
        const bmp = await createImageBitmap(f); const keep = await createImageBitmap(bmp);
        const r = await det.current!.detect(bmp, op!.detector_conf, op!.nms_iou);
        const p = primarySignal(r.dets, op!.state_conf);
        paint(keep, keep.width, keep.height, r.dets, p.det); keep.close();
        setDets(r.dets); setMs(r.ms); setVerdict({ state: p.state, conf: p.conf });
        await audit('AI model analysed an uploaded image', `${r.dets.length} lights · primary ${p.state}`, 'detection');
      } else if (f.type.startsWith('video/')) {
        setIsVideo(true); setBusy('');
        const v = vid.current!; v.src = URL.createObjectURL(f); v.muted = true; await v.play();
        const tf = new TemporalFilter(op!.temporal_frames); playing.current = true;
        while (playing.current && !v.ended) {
          if (!v.videoWidth) { await new Promise((r) => setTimeout(r, 50)); continue; }
          const r = await det.current!.detect(v, op!.detector_conf, op!.nms_iou);
          const p = primarySignal(r.dets, op!.state_conf); tf.push(p.state);
          paint(v, v.videoWidth, v.videoHeight, r.dets, p.det); setDets(r.dets); setMs(r.ms);
          setVerdict(tf.current === 'OFF' ? null : { state: tf.current, conf: p.conf });
        }
        playing.current = false;
        await audit('AI model analysed an uploaded video', null, 'detection');
      } else setErr('Choose an image (JPG/PNG) or a video (MP4/WebM).');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  }

  async function saveResult() {
    if (!verdict) return;
    const { error } = await supabase.from('detection_events').insert({ intersection_id: ix || null, state: verdict.state, confidence: verdict.state === 'UNKNOWN' ? null : Number(verdict.conf.toFixed(3)), verified: verdict.state !== 'UNKNOWN', source: 'model', detail: 'uploaded media', user_id: profile!.id });
    setSaved(error ? 'Not saved: ' + error.message : 'Saved to the event log (source “model”).');
  }

  return (
    <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--gold)' }}>
      <h3>AI model — analyse a photo or dashcam video</h3>
      <p className="small muted">Two-stage pipeline running in your browser: YOLO11 finds traffic lights, then the ATLIP state classifier reads each one (RED / CAUTION / GREEN / UNKNOWN). Files are not uploaded anywhere.</p>
      <div className="grid g2">
        <div>
          {m && <><label>Model size</label><select value={detFile} onChange={(e) => setDetFile(e.target.value)}>{m.detectors.map((d) => <option key={d.id} value={d.file}>{d.label}</option>)}</select></>}
          <div className="pillrow" style={{ marginTop: '.6rem' }}>
            <label className="btn primary" style={{ cursor: 'pointer', margin: 0 }}>Choose image or video<input type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} /></label>
            {isVideo && <button className="btn" onClick={() => { playing.current = false; vid.current?.pause(); }}>Stop video</button>}
          </div>
          {busy && <p className="small" style={{ color: 'var(--lime)' }}>{busy}</p>}
          {err && <p className="small" style={{ color: '#FF8A84' }}>{err}</p>}
          {verdict && <div className="sig" style={{ marginTop: '.8rem' }}><div className={'lamp ' + verdict.state}>{verdict.state === 'UNKNOWN' ? '?' : verdict.state}</div>
            <div><strong style={{ fontSize: '1.15rem' }}>{verdict.state === 'UNKNOWN' ? 'No confident signal (UNKNOWN)' : 'Primary signal: ' + verdict.state}</strong><br />
              <span className="muted small">{dets.length} traffic light(s) detected · {Math.round(ms)} ms{isVideo ? ` · temporal check ${op?.temporal_frames} frames` : ''}</span></div></div>}
          {dets.length > 0 && <table style={{ marginTop: '.6rem' }}><thead><tr><th>#</th><th>State</th><th>State conf.</th><th>Detector conf.</th><th>Size</th></tr></thead><tbody>
            {dets.map((d, i) => <tr key={i}><td>{i + 1}</td><td><StateChip s={d.stateConf >= (op?.state_conf ?? 0.7) ? d.state : 'UNKNOWN'} /></td><td>{Math.round(d.stateConf * 100)}%</td><td>{Math.round(d.detConf * 100)}%</td><td className="small">{Math.round(d.box[2] - d.box[0])}×{Math.round(d.box[3] - d.box[1])} px{d.horizontal ? ' · horizontal' : ''}</td></tr>)}
          </tbody></table>}
          {verdict && perms.recordDetection(profile?.role) && <>
            <label>Intersection (optional)</label>
            <select value={ix} onChange={(e) => setIx(e.target.value)}><option value="">Not linked to an intersection</option>{intersections.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
            <button className="btn small" style={{ marginTop: '.5rem' }} onClick={saveResult}>Save result to event log</button>
            {saved && <p className="small" style={{ color: 'var(--lime)' }}>{saved}</p>}
          </>}
        </div>
        <div>
          <canvas ref={canvas} style={{ width: '100%', borderRadius: 12, background: '#06162B', minHeight: 180 }} />
          <video ref={vid} playsInline muted style={{ display: 'none' }} />
        </div>
      </div>
    </div>
  );
}
