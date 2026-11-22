import type { WorkerDetection } from './detector.worker';
import type { SignalState } from '../lib/types';

export type Detection = WorkerDetection;
export interface DetectorInfo { id: string; file: string; label: string; default: boolean; licence: string; eval: Record<string, unknown> }
export interface Manifest {
  pipeline: string; evaluated: string;
  operating_point: { detector_conf: number; nms_iou: number; state_conf: number; temporal_frames: number };
  detectors: DetectorInfo[];
  state_classifier: { id: string; file: string; trained_on: string; eval_in_domain: Record<string, unknown>; eval_cross_dataset: Record<string, unknown> } & Record<string, unknown>;
  limitations: string[];
}

let manifestP: Promise<Manifest> | null = null;
export const loadManifest = (): Promise<Manifest> => (manifestP ??= fetch('/models/manifest.json').then((r) => { if (!r.ok) throw new Error('Model manifest missing'); return r.json() as Promise<Manifest>; }));

/** Thin promise wrapper around the inference worker. One instance per page. */
export class TrafficLightDetector {
  private w: Worker; private seq = 0;
  private pending = new Map<number, { res: (v: never) => void; rej: (e: Error) => void }>();
  loadedDetector = '';

  constructor() {
    this.w = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' });
    this.w.onmessage = (e) => {
      const p = this.pending.get(e.data.id); if (!p) return; this.pending.delete(e.data.id);
      if (e.data.type === 'error') p.rej(new Error(e.data.error)); else p.res(e.data as never);
    };
  }
  private call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((res, rej) => { this.pending.set(id, { res: res as (v: never) => void, rej }); this.w.postMessage({ ...msg, id }, transfer); });
  }
  async load(detectorFile: string, stateFile: string) { await this.call({ type: 'load', detector: detectorFile, state: stateFile }); this.loadedDetector = detectorFile; }
  async detect(source: CanvasImageSource | ImageBitmap, conf = 0.3, iou = 0.45): Promise<{ dets: Detection[]; ms: number }> {
    const bitmap = source instanceof ImageBitmap ? source : await createImageBitmap(source as ImageBitmapSource);
    return this.call({ type: 'detect', bitmap, conf, iou }, [bitmap]);
  }
  dispose() { this.w.terminate(); this.pending.forEach((p) => p.rej(new Error('disposed'))); this.pending.clear(); }
}

/**
 * Pick the signal that matters to the driver: the largest (closest) confidently-classified housing.
 * Below the state-confidence threshold the answer is UNKNOWN — the system never guesses.
 */
export function primarySignal(dets: Detection[], stateConf: number): { state: SignalState; conf: number; det: Detection | null } {
  if (!dets.length) return { state: 'UNKNOWN', conf: 0, det: null };
  const area = (d: Detection) => (d.box[2] - d.box[0]) * (d.box[3] - d.box[1]);
  const confident = dets.filter((d) => d.state !== 'UNKNOWN' && d.stateConf >= stateConf).sort((a, b) => area(b) - area(a));
  if (!confident.length) return { state: 'UNKNOWN', conf: 0, det: [...dets].sort((a, b) => area(b) - area(a))[0] };
  // if the two largest confident signals disagree and are similar in size, refuse rather than pick one
  const [a, b] = confident;
  if (b && b.state !== a.state && area(b) > area(a) * 0.6) return { state: 'UNKNOWN', conf: 0, det: a };
  return { state: a.state, conf: a.stateConf * a.detConf ** 0.25, det: a };
}

/** Temporal verification: a state is only reported after N consecutive agreeing frames. */
export class TemporalFilter {
  private cand: SignalState | null = null; private n = 0; current: SignalState | 'OFF' = 'OFF';
  constructor(private need = 3) {}
  push(s: SignalState): { changed: boolean; stable: number } {
    if (s === this.cand) this.n++; else { this.cand = s; this.n = 1; }
    if (this.n >= this.need && s !== this.current) { this.current = s; return { changed: true, stable: this.n }; }
    return { changed: false, stable: this.n };
  }
  reset() { this.cand = null; this.n = 0; this.current = 'OFF'; }
}

export function drawDetections(ctx: CanvasRenderingContext2D, dets: Detection[], sx: number, sy: number, stateConf: number, primary?: Detection | null) {
  const col: Record<string, string> = { RED: '#FF3B30', CAUTION: '#FFB340', GREEN: '#2EFF7A', UNKNOWN: '#9AA4B2' };
  ctx.lineWidth = 3; ctx.font = 'bold 13px system-ui, sans-serif';
  for (const d of dets) {
    const st = d.stateConf >= stateConf ? d.state : 'UNKNOWN';
    const [x1, y1, x2, y2] = [d.box[0] * sx, d.box[1] * sy, d.box[2] * sx, d.box[3] * sy];
    ctx.strokeStyle = col[st]; ctx.setLineDash(d === primary ? [] : [5, 4]); ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    const label = `${st} ${Math.round(d.stateConf * 100)}%`;
    const tw = ctx.measureText(label).width + 8;
    ctx.fillStyle = col[st]; ctx.fillRect(x1, Math.max(0, y1 - 18), tw, 18);
    ctx.fillStyle = '#0A2342'; ctx.fillText(label, x1 + 4, Math.max(13, y1 - 5));
  }
  ctx.setLineDash([]);
}
