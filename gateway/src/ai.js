// Server-side AI on live CCTV: the same two-stage pipeline as the web app (YOLO11 detector + ATLIP state CNN),
// run with onnxruntime-node on frames that FFmpeg decodes, letterboxes to 640x640 and pipes as raw RGB.
// Only verified state CHANGES are written to the platform; frames are never stored.
import { spawn } from 'node:child_process';
import path from 'node:path';
import ort from 'onnxruntime-node';
import { config } from './config.js';
import { inputArgs } from './streams.js';
import { loadVault, maskUrl } from './vault.js';
import { sb, account } from './supa.js';
import { log } from './log.js';

const S = 640, FRAME = S * S * 3, TL = 9, STATES = ['RED', 'CAUTION', 'GREEN', 'UNKNOWN'];
let det = null, cls = null;
const workers = new Map(); // cam -> worker state

export async function loadModels() {
  const o = { graphOptimizationLevel: 'all', intraOpNumThreads: 2 };
  det = await ort.InferenceSession.create(path.join(config.ai.modelsDir, config.ai.detector), o);
  cls = await ort.InferenceSession.create(path.join(config.ai.modelsDir, config.ai.stateModel), o);
  log.info('AI models loaded', { detector: config.ai.detector, state: config.ai.stateModel });
}

const iou = (a, b) => {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1); return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i + 1e-9);
};

/** Bilinear crop of an RGB24 640x640 frame into a CHW float32 32x64 tile (rotating horizontal housings). */
export function cropTile(rgb, box, out, off) {
  const [x1, y1, x2, y2] = box; const bw = x2 - x1, bh = y2 - y1; const horiz = bw > bh * 1.25;
  const W = 32, H = 64, pl = W * H;
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    // for horizontal housings, tile row maps to source x (left lamp → top), tile col maps to source y
    const u = horiz ? (ty + 0.5) / H : (tx + 0.5) / W, v = horiz ? 1 - (tx + 0.5) / W : (ty + 0.5) / H;
    const sx = Math.min(S - 1.001, Math.max(0, x1 + u * bw - 0.5)), sy = Math.min(S - 1.001, Math.max(0, y1 + v * bh - 0.5));
    const ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy;
    for (let c = 0; c < 3; c++) {
      const p = (yy, xx) => rgb[(yy * S + xx) * 3 + c];
      const val = p(iy, ix) * (1 - fx) * (1 - fy) + p(iy, ix + 1) * fx * (1 - fy) + p(iy + 1, ix) * (1 - fx) * fy + p(iy + 1, ix + 1) * fx * fy;
      out[off + c * pl + ty * W + tx] = val / 255;
    }
  }
  return horiz;
}

export async function analyse(rgb) {
  const plane = S * S, input = new Float32Array(3 * plane);
  for (let i = 0, j = 0; i < plane; i++, j += 3) { input[i] = rgb[j] / 255; input[i + plane] = rgb[j + 1] / 255; input[i + 2 * plane] = rgb[j + 2] / 255; }
  const o = (await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) }))[det.outputNames[0]];
  const d = o.data, N = o.dims[2], cand = [];
  for (let k = 0; k < N; k++) {
    const s = d[(4 + TL) * N + k]; if (s < config.ai.detConf) continue;
    const x = d[k], y = d[N + k], w = d[2 * N + k], h = d[3 * N + k];
    const b = [Math.max(0, x - w / 2), Math.max(0, y - h / 2), Math.min(S, x + w / 2), Math.min(S, y + h / 2)];
    if (b[2] - b[0] >= 3 && b[3] - b[1] >= 5) cand.push({ b, s });
  }
  cand.sort((a, b) => b.s - a.s); const keep = [];
  for (const c of cand) { if (keep.every((k) => iou(k.b, c.b) < 0.45)) keep.push(c); if (keep.length >= 12) break; }
  if (!keep.length) return [];
  const batch = new Float32Array(keep.length * 3 * 32 * 64); const horiz = keep.map((c, n) => cropTile(rgb, c.b, batch, n * 3 * 32 * 64));
  const lg = (await cls.run({ crop: new ort.Tensor('float32', batch, [keep.length, 3, 64, 32]) })).logits.data;
  return keep.map((c, n) => {
    const z = Array.from(lg.slice(n * 4, n * 4 + 4)), m = Math.max(...z), e = z.map((v) => Math.exp(v - m)), sum = e.reduce((a, b) => a + b, 0), p = e.map((v) => v / sum);
    const k = p.indexOf(Math.max(...p)); return { box: c.b, detConf: c.s, state: STATES[k], stateConf: p[k], horizontal: horiz[n] };
  });
}

export function primary(dets) {
  const area = (x) => (x.box[2] - x.box[0]) * (x.box[3] - x.box[1]);
  const ok = dets.filter((x) => x.state !== 'UNKNOWN' && x.stateConf >= config.ai.stateConf).sort((a, b) => area(b) - area(a));
  if (!ok.length) return { state: 'UNKNOWN', conf: 0 };
  if (ok[1] && ok[1].state !== ok[0].state && area(ok[1]) > area(ok[0]) * 0.6) return { state: 'UNKNOWN', conf: 0 };
  return { state: ok[0].state, conf: ok[0].stateConf * ok[0].detConf ** 0.25 };
}

async function onStable(w, state, conf) {
  const acc = account(); if (!acc) return;
  const row = { camera_id: w.cam.id, intersection_id: w.cam.intersection_id, state, confidence: state === 'UNKNOWN' ? null : Number(conf.toFixed(3)), verified: state !== 'UNKNOWN', source: 'gateway', user_id: acc.id };
  const { error } = await sb.from('detection_events').insert(row);
  if (error) log.warn('detection insert failed', { cam: w.cam.id, error: error.message });
  if (w.cam.intersection_id) await sb.from('intersections').update({ current_state: state }).eq('id', w.cam.intersection_id);
  w.events++;
  log.info('verified state change', { cam: w.cam.id, state, conf: Number(conf.toFixed(2)) });
}

async function checkObstruction(w) {
  const mins = (Date.now() - w.lastSeenLight) / 60000;
  if (mins >= 10 && !w.obstructionRaised) {
    w.obstructionRaised = true;
    await sb.from('alerts').insert({ kind: 'obstructed', severity: 'a', body: `No traffic signal visible on ${w.cam.id} (${w.cam.name}) for 10 minutes — possible obstruction, glare or camera movement`, created_by: account().id });
    await sb.from('cameras').update({ status: 'Obstructed' }).eq('id', w.cam.id);
    log.warn('possible obstruction', { cam: w.cam.id });
  }
}

export function startWorker(cam) {
  if (workers.has(cam.id)) { workers.get(cam.id).cam = cam; return; }
  const src = loadVault()[cam.id]?.url; if (!src) return;
  const w = { cam, proc: null, buf: Buffer.alloc(0), busy: false, cand: null, n: 0, current: null, events: 0, frames: 0, lastFrame: 0, lastSeenLight: Date.now(), obstructionRaised: false, stopped: false, restarts: 0, lastMs: 0 };
  workers.set(cam.id, w);
  const vf = `fps=${config.ai.fps},scale=${S}:${S}:force_original_aspect_ratio=decrease,pad=${S}:${S}:(ow-iw)/2:(oh-ih)/2:color=0x727272`;
  const run = () => {
    w.proc = spawn(config.ffmpeg, [...inputArgs(src), '-an', '-vf', vf, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    w.proc.stderr.resume();
    w.proc.stdout.on('data', async (chunk) => {
      w.buf = Buffer.concat([w.buf, chunk]);
      while (w.buf.length >= FRAME) {
        const frame = w.buf.subarray(0, FRAME); w.buf = w.buf.subarray(FRAME);
        if (w.busy) continue; // drop frames while inferring — always analyse the newest
        w.busy = true; const t0 = Date.now();
        try {
          const dets = await analyse(new Uint8Array(frame)); const p = primary(dets);
          w.frames++; w.lastFrame = Date.now(); w.lastMs = Date.now() - t0; w.lastDets = dets.length;
          if (dets.length) { w.lastSeenLight = Date.now(); if (w.obstructionRaised) { w.obstructionRaised = false; await sb.from('cameras').update({ status: 'Online' }).eq('id', w.cam.id); } }
          if (p.state === w.cand) w.n++; else { w.cand = p.state; w.n = 1; }
          if (w.n >= config.ai.frames && p.state !== w.current) { w.current = p.state; await onStable(w, p.state, p.conf); }
          await checkObstruction(w);
        } catch (e) { log.error('inference failed', { cam: w.cam.id, error: String(e.message || e) }); }
        finally { w.busy = false; }
      }
    });
    w.proc.on('exit', (code) => {
      if (w.stopped) return; w.restarts++;
      log.warn('AI ffmpeg exited, restarting', { cam: cam.id, code, src: maskUrl(src) });
      setTimeout(() => { if (!w.stopped) run(); }, Math.min(30000, 1000 * 2 ** Math.min(w.restarts, 5)));
    });
  };
  run(); log.info('AI worker started', { cam: cam.id, fps: config.ai.fps });
}

export function stopWorker(id) { const w = workers.get(id); if (!w) return; w.stopped = true; try { w.proc?.kill('SIGTERM'); } catch { /* ignore */ } workers.delete(id); log.info('AI worker stopped', { cam: id }); }
export function workerStats() { return [...workers.values()].map((w) => ({ cam: w.cam.id, frames: w.frames, lastFrame: w.lastFrame, state: w.current, events: w.events, lastMs: w.lastMs, lastDets: w.lastDets ?? 0, restarts: w.restarts })); }
export function stopAllWorkers() { for (const id of [...workers.keys()]) stopWorker(id); }
