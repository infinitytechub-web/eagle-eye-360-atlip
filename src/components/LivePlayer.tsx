import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { supabase, audit } from '../lib/supabase';
import { TrafficLightDetector, primarySignal, drawDetections, loadManifest, TemporalFilter } from '../ai/detector';
import type { Camera, Gateway } from '../lib/types';

interface Ticket { ticket: string; expiresAt: number; session: number | null; ttl: number }

/**
 * Live CCTV tile. Exchanges the signed-in user's Supabase session for a short-lived, camera-bound stream
 * ticket at the gateway, plays the HLS stream, and renews the ticket before it expires.
 * The RTSP address and camera credentials never reach the browser.
 */
export function LivePlayer({ cam, gw, compact = false }: { cam: Camera; gw: Gateway; compact?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const hls = useRef<Hls | null>(null);
  const ticket = useRef<Ticket | null>(null);
  const det = useRef<TrafficLightDetector | null>(null);
  const [state, setState] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [ai, setAi] = useState(false); const aiRef = useRef(false); aiRef.current = ai;
  const [aiState, setAiState] = useState('');
  const base = gw.public_url.replace(/\/+$/, '');

  async function getTicket(session?: number | null): Promise<Ticket> {
    const { data } = await supabase.auth.getSession();
    const r = await fetch(`${base}/v1/streams/${cam.id}/ticket`, {
      method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(session ? { session } : {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Gateway responded ${r.status}`);
    return j as Ticket;
  }

  async function start() {
    setErr(''); setState('connecting');
    try {
      ticket.current = await getTicket();
      const url = () => `${base}/v1/hls/${cam.id}/${ticket.current!.ticket}/index.m3u8`;
      const v = video.current!;
      if (Hls.isSupported()) {
        const h = new Hls({
          liveSyncDurationCount: 2, maxLiveSyncPlaybackRate: 1.5, lowLatencyMode: false, backBufferLength: 10,
          // always use the CURRENT ticket, so renewals take effect without restarting playback
          xhrSetup: (xhr, u) => { xhr.open('GET', u.replace(/\/v1\/hls\/([^/]+)\/[^/]+\//, `/v1/hls/$1/${ticket.current!.ticket}/`), true); },
        });
        h.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) { setErr(d.details || 'Playback error'); setState('error'); } });
        h.loadSource(url()); h.attachMedia(v); hls.current = h;
      } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = url(); // Safari / iOS native HLS
      } else throw new Error('This browser cannot play HLS video');
      v.muted = true; await v.play().catch(() => {});
      setState('live');
    } catch (e) { setErr((e as Error).message); setState('error'); }
  }

  function stop() {
    hls.current?.destroy(); hls.current = null;
    if (video.current) { video.current.removeAttribute('src'); video.current.load(); }
    ticket.current = null; setState('idle'); setAi(false);
  }

  // renew the ticket one minute before expiry (same viewing session)
  useEffect(() => {
    if (state !== 'live') return;
    const t = setInterval(async () => {
      const tk = ticket.current; if (!tk) return;
      if (tk.expiresAt - Date.now() < 60_000) {
        try {
          ticket.current = await getTicket(tk.session);
          if (!hls.current && video.current) { const time = video.current.currentTime; video.current.src = `${base}/v1/hls/${cam.id}/${ticket.current.ticket}/index.m3u8`; video.current.currentTime = time; video.current.play().catch(() => {}); }
        } catch (e) { setErr('Ticket renewal failed: ' + (e as Error).message); }
      }
    }, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => () => { hls.current?.destroy(); det.current?.dispose(); }, []);

  // optional on-device AI overlay on the live picture (~1 fps)
  useEffect(() => {
    if (!ai || state !== 'live') { overlay.current?.getContext('2d')?.clearRect(0, 0, 9999, 9999); setAiState(''); return; }
    let stopped = false;
    (async () => {
      const m = await loadManifest();
      if (!det.current) { det.current = new TrafficLightDetector(); }
      const file = m.detectors.find((d) => d.default)!.file;
      if (det.current.loadedDetector !== file) { setAiState('Loading AI model…'); await det.current.load(file, m.state_classifier.file); }
      const tf = new TemporalFilter(m.operating_point.temporal_frames);
      while (!stopped && aiRef.current) {
        const v = video.current!, ov = overlay.current!;
        if (v.videoWidth && !v.paused) {
          const r = await det.current.detect(v, m.operating_point.detector_conf, m.operating_point.nms_iou);
          const p = primarySignal(r.dets, m.operating_point.state_conf); tf.push(p.state);
          ov.width = ov.clientWidth; ov.height = ov.clientHeight;
          const s = Math.min(ov.width / v.videoWidth, ov.height / v.videoHeight), ox = (ov.width - v.videoWidth * s) / 2, oy = (ov.height - v.videoHeight * s) / 2;
          const ctx = ov.getContext('2d')!; ctx.clearRect(0, 0, ov.width, ov.height); ctx.save(); ctx.translate(ox, oy);
          drawDetections(ctx, r.dets, s, s, m.operating_point.state_conf, p.det); ctx.restore();
          setAiState(tf.current === 'OFF' ? 'Analysing…' : `AI: ${tf.current} · ${r.dets.length} light(s) · ${Math.round(r.ms)} ms`);
        }
        await new Promise((res) => setTimeout(res, 900));
      }
    })().catch((e) => setAiState('AI error: ' + e.message));
    return () => { stopped = true; };
  }, [ai, state]);

  async function snapshot() {
    const v = video.current!; if (!v.videoWidth) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext('2d')!; ctx.drawImage(v, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, c.height - 28, c.width, 28); ctx.fillStyle = '#fff'; ctx.font = '16px system-ui';
    ctx.fillText(`${cam.id} · ${cam.name} · ${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Accra' })} GMT`, 10, c.height - 9);
    const a = document.createElement('a'); a.href = c.toDataURL('image/jpeg', 0.9); a.download = `${cam.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`; a.click();
    await audit(`Snapshot captured from ${cam.id}`, gw.id, 'camera');
  }

  const fullscreen = () => { const el = wrap.current; if (!el) return; if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.(); };

  return (
    <div className="feed" ref={wrap} style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="fh"><span>{cam.id} · {state === 'live' ? '● LIVE' : state === 'connecting' ? 'CONNECTING…' : cam.status.toUpperCase()}</span><span>{gw.id}</span></div>
      <div style={{ position: 'relative', background: '#000', aspectRatio: '16/9' }}>
        <video ref={video} playsInline muted crossOrigin="anonymous" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 0, aspectRatio: 'auto' }} />
        <canvas ref={overlay} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
        {state !== 'live' && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', textAlign: 'center', padding: '.5rem' }}>
          {state === 'connecting' ? <span>Connecting securely…</span> : state === 'error' ? <span style={{ color: '#FF8A84' }}>{err}</span> :
            <button className="btn primary" onClick={start} disabled={cam.status === 'Offline'}>{cam.status === 'Offline' ? 'Camera offline' : '▶ Watch live'}</button>}
        </div>}
        {aiState && <div style={{ position: 'absolute', left: 6, bottom: 6, background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: '.75rem', padding: '.15rem .45rem', borderRadius: 6 }}>{aiState}</div>}
      </div>
      <div style={{ padding: '.5rem .6rem', background: 'var(--panel)' }}>
        <strong style={{ fontSize: compact ? '.85rem' : undefined }}>{cam.name}</strong>
        {state === 'live' && <div className="pillrow" style={{ marginTop: '.35rem' }}>
          <button className="btn small" onClick={stop}>■ Stop</button>
          <button className="btn small" onClick={fullscreen}>⛶ Full screen</button>
          <button className="btn small" onClick={snapshot}>📷 Snapshot</button>
          <label className="small" style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', margin: 0 }}><input type="checkbox" style={{ width: 'auto' }} checked={ai} onChange={(e) => setAi(e.target.checked)} /> AI overlay</label>
        </div>}
        {err && state === 'live' && <p className="small" style={{ color: '#FF8A84', margin: '.3rem 0 0' }}>{err}</p>}
      </div>
    </div>
  );
}
