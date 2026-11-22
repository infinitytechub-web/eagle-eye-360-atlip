/// <reference lib="webworker" />
/**
 * ATLIP inference worker — two-stage pipeline, fully on-device:
 *   1. YOLO11 (COCO class 9) finds traffic-light housings in the frame.
 *   2. atlip-state-v2 classifies each crop as RED / CAUTION / GREEN / UNKNOWN.
 * Frames never leave the device; only the resulting state is returned to the page.
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';

// Serve the runtime from this app's own origin (hashed, cacheable assets) — no CDN, CSP-friendly.
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };

ort.env.wasm.numThreads = 1; // no SharedArrayBuffer required (works without cross-origin isolation)

const SIZE = 640;
const TL_CLASS = 9;
const STATES = ['RED', 'CAUTION', 'GREEN', 'UNKNOWN'] as const;

let det: ort.InferenceSession | null = null;
let cls: ort.InferenceSession | null = null;
let detUrl = '';

export interface WorkerDetection {
  box: [number, number, number, number]; // x1,y1,x2,y2 in source pixels
  detConf: number;
  state: (typeof STATES)[number];
  stateConf: number;
  probs: number[];
  horizontal: boolean;
}

async function load(detectorUrl: string, stateUrl: string) {
  if (!det || detUrl !== detectorUrl) {
    det = await ort.InferenceSession.create(detectorUrl, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    detUrl = detectorUrl;
  }
  if (!cls) cls = await ort.InferenceSession.create(stateUrl, { executionProviders: ['wasm'] });
}

function iou(a: number[], b: number[]) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i + 1e-9);
}

async function detect(bmp: ImageBitmap, confTh: number, iouTh: number): Promise<{ dets: WorkerDetection[]; ms: number }> {
  const t0 = performance.now();
  const W = bmp.width, H = bmp.height;
  // letterbox to 640x640
  const scale = Math.min(SIZE / W, SIZE / H);
  const nw = Math.round(W * scale), nh = Math.round(H * scale), px = (SIZE - nw) >> 1, py = (SIZE - nh) >> 1;
  const cv = new OffscreenCanvas(SIZE, SIZE); const cx = cv.getContext('2d', { willReadFrequently: true })!;
  cx.fillStyle = 'rgb(114,114,114)'; cx.fillRect(0, 0, SIZE, SIZE);
  cx.drawImage(bmp, 0, 0, W, H, px, py, nw, nh);
  const px8 = cx.getImageData(0, 0, SIZE, SIZE).data;
  const plane = SIZE * SIZE; const input = new Float32Array(3 * plane);
  for (let i = 0, j = 0; i < plane; i++, j += 4) { input[i] = px8[j] / 255; input[i + plane] = px8[j + 1] / 255; input[i + 2 * plane] = px8[j + 2] / 255; }

  const out = await det!.run({ [det!.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const o = out[det!.outputNames[0]]; const d = o.data as Float32Array; const N = o.dims[2]; // [1, 84, N]
  const cand: { b: number[]; s: number }[] = [];
  for (let k = 0; k < N; k++) {
    const s = d[(4 + TL_CLASS) * N + k];
    if (s < confTh) continue;
    const x = d[k], y = d[N + k], w = d[2 * N + k], h = d[3 * N + k];
    const b = [(x - w / 2 - px) / scale, (y - h / 2 - py) / scale, (x + w / 2 - px) / scale, (y + h / 2 - py) / scale];
    b[0] = Math.max(0, b[0]); b[1] = Math.max(0, b[1]); b[2] = Math.min(W, b[2]); b[3] = Math.min(H, b[3]);
    if (b[2] - b[0] < 4 || b[3] - b[1] < 6) continue;
    cand.push({ b, s });
  }
  cand.sort((a, b) => b.s - a.s);
  const keep: typeof cand = [];
  for (const c of cand) { if (keep.every((k) => iou(k.b, c.b) < iouTh)) keep.push(c); if (keep.length >= 12) break; }

  // stage 2: classify crops (rotate horizontal housings so lamps read top→bottom like the training data)
  const CW = 32, CH = 64; const batch = new Float32Array(keep.length * 3 * CW * CH);
  const cc = new OffscreenCanvas(CW, CH); const ccx = cc.getContext('2d', { willReadFrequently: true })!;
  const horiz: boolean[] = [];
  keep.forEach((c, n) => {
    const [x1, y1, x2, y2] = c.b; const bw = x2 - x1, bh = y2 - y1; const h = bw > bh * 1.25; horiz.push(h);
    ccx.save(); ccx.clearRect(0, 0, CW, CH);
    if (h) { ccx.translate(CW, 0); ccx.rotate(Math.PI / 2); ccx.drawImage(bmp, x1, y1, bw, bh, 0, 0, CH, CW); }
    else ccx.drawImage(bmp, x1, y1, bw, bh, 0, 0, CW, CH);
    ccx.restore();
    const p = ccx.getImageData(0, 0, CW, CH).data; const pl = CW * CH; const off = n * 3 * pl;
    for (let i = 0, j = 0; i < pl; i++, j += 4) { batch[off + i] = p[j] / 255; batch[off + pl + i] = p[j + 1] / 255; batch[off + 2 * pl + i] = p[j + 2] / 255; }
  });
  const dets: WorkerDetection[] = [];
  if (keep.length) {
    const r = await cls!.run({ crop: new ort.Tensor('float32', batch, [keep.length, 3, CH, CW]) });
    const lg = r.logits.data as Float32Array;
    keep.forEach((c, n) => {
      const z = Array.from(lg.slice(n * 4, n * 4 + 4)); const m = Math.max(...z);
      const e = z.map((v) => Math.exp(v - m)); const s = e.reduce((a, b) => a + b, 0); const probs = e.map((v) => v / s);
      const k = probs.indexOf(Math.max(...probs));
      dets.push({ box: c.b as [number, number, number, number], detConf: c.s, state: STATES[k], stateConf: probs[k], probs, horizontal: horiz[n] });
    });
  }
  return { dets, ms: performance.now() - t0 };
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'load') { await load(m.detector, m.state); (self as DedicatedWorkerGlobalScope).postMessage({ type: 'loaded', id: m.id }); }
    else if (m.type === 'detect') {
      const r = await detect(m.bitmap as ImageBitmap, m.conf ?? 0.3, m.iou ?? 0.45);
      (m.bitmap as ImageBitmap).close();
      (self as DedicatedWorkerGlobalScope).postMessage({ type: 'result', id: m.id, ...r });
    }
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({ type: 'error', id: m.id, error: String((err as Error)?.message || err) });
  }
};
