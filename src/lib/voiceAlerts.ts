/**
 * Location-aware traffic-light voice alerts — runs entirely on the device.
 * Privacy: positions are processed in memory only; they are never sent to the server or stored.
 * The full signal list is downloaded once, so the server never learns where the user is.
 */
import { distance, bearing, angleDiff } from './geo';
import type { SignalState } from './types';

export interface Signal { id: number; lat: number; lon: number; name: string | null; intersection_id: string | null }
export interface VoiceSettings {
  distances: number[];          // metres, descending, e.g. [300, 100]
  minSpeedKmh: number;          // stay quiet below this speed (parked, walking)
  headingTolerance: number;     // degrees either side of travel direction that count as "ahead"
  announceState: boolean;       // include the AI-observed state for monitored intersections
  lang: string; rate: number; volume: number; voiceURI?: string;
}
export const DEFAULT_VOICE: VoiceSettings = { distances: [300, 100], minSpeedKmh: 10, headingTolerance: 45, announceState: true, lang: 'en-GB', rate: 1, volume: 1 };

export interface Fix { lat: number; lon: number; accuracy: number; speed: number | null; heading: number | null; t: number }
export interface Alert { signal: Signal; distance: number; threshold: number; text: string }

const JUNCTION_RADIUS = 70;     // OSM maps one node per approach — treat nodes within 70 m as one junction
const INTERSECTION_RADIUS = 160; // monitored intersections are single surveyed points; attach nearby OSM nodes to them
const SEARCH_RADIUS = 1200;

export class ProximityEngine {
  private last: Fix | null = null;
  private derivedHeading: number | null = null;
  private announced = new Map<string, { lat: number; lon: number; done: Set<number> }>(); // junction -> thresholds spoken this approach
  private quietUntil = 0;
  speedKmh = 0; heading: number | null = null; nearest: { signal: Signal; distance: number; ahead: boolean } | null = null;

  private signals: Signal[] = [];
  constructor(signals: Signal[], private s: VoiceSettings, private stateOf: (ix: string) => SignalState | undefined, private ixName: (ix: string) => string | undefined) { this.setSignals(signals); }
  update(settings: VoiceSettings) { this.s = settings; }

  /** Attach OSM nodes near a monitored intersection to it (name + AI state) so one junction = one alert. */
  setSignals(list: Signal[]) {
    const ix = list.filter((x) => x.intersection_id);
    this.signals = list.map((sig) => {
      if (sig.intersection_id) return sig;
      const near = ix.find((m) => distance(sig.lat, sig.lon, m.lat, m.lon) < INTERSECTION_RADIUS);
      return near ? { ...sig, intersection_id: near.intersection_id, name: sig.name || near.name } : sig;
    });
  }

  private junctionKey(sig: Signal) {
    // stable key: monitored intersection id, else the lowest id among signals in the same cluster
    if (sig.intersection_id) return 'ix:' + sig.intersection_id;
    let key = sig.id;
    for (const o of this.signals) if (o.id < key && distance(sig.lat, sig.lon, o.lat, o.lon) < JUNCTION_RADIUS) key = o.id;
    return 'n:' + key;
  }

  describe(sig: Signal, d: number, threshold: number) {
    const name = sig.intersection_id ? this.ixName(sig.intersection_id) || sig.name : sig.name;
    const dist = threshold >= 1000 ? `${(threshold / 1000).toFixed(1)} kilometres` : `${Math.round(Math.min(d, threshold) / 50) * 50 || Math.round(d)} metres`;
    let text = `Traffic light ahead in ${dist}${name ? `, ${name}` : ''}.`;
    if (this.s.announceState && sig.intersection_id) {
      const st = this.stateOf(sig.intersection_id);
      if (st === 'RED') text += ' Last observed: red. Prepare to stop.';
      else if (st === 'CAUTION') text += ' Last observed: amber. Slow down.';
      else if (st === 'GREEN') text += ' Last observed: green. Proceed with care.';
    }
    if (threshold === this.s.distances[this.s.distances.length - 1]) text += ' Obey the signal.';
    return text;
  }

  /** Feed a GPS fix; returns an alert to speak, or null. */
  push(f: Fix): Alert | null {
    const prev = this.last; this.last = f;
    // speed & heading: prefer the device's values, otherwise derive from movement (ignoring GPS jitter)
    let speed = f.speed ?? null;
    if (prev) {
      const moved = distance(prev.lat, prev.lon, f.lat, f.lon), dt = (f.t - prev.t) / 1000;
      if (speed === null && dt > 0) speed = moved / dt;
      if (moved > Math.max(8, f.accuracy * 0.5)) this.derivedHeading = bearing(prev.lat, prev.lon, f.lat, f.lon);
    }
    this.speedKmh = Math.max(0, (speed ?? 0) * 3.6);
    this.heading = f.heading !== null && !Number.isNaN(f.heading) && (speed ?? 0) > 1 ? f.heading : this.derivedHeading;

    // nearest signal ahead
    const dLat = SEARCH_RADIUS / 111000, dLon = dLat / Math.max(0.2, Math.cos(f.lat * Math.PI / 180));
    let best: { signal: Signal; distance: number; ahead: boolean } | null = null;
    for (const sig of this.signals) {
      if (Math.abs(sig.lat - f.lat) > dLat || Math.abs(sig.lon - f.lon) > dLon) continue;
      const d = distance(f.lat, f.lon, sig.lat, sig.lon);
      // "ahead" = within the heading cone AND close to our line of travel (cross-track distance), so a junction on a
      // parallel or side road that merely lies in front of us is not announced
      let ahead = false;
      if (this.heading !== null) {
        const off = angleDiff(this.heading, bearing(f.lat, f.lon, sig.lat, sig.lon));
        const crossTrack = d * Math.sin(Math.min(off, 90) * Math.PI / 180);
        ahead = d < 25 || (off <= this.s.headingTolerance && crossTrack <= Math.max(60, 0.3 * d));
      }
      if (ahead && (!best || !best.ahead || d < best.distance)) best = { signal: sig, distance: d, ahead };
      else if (!best) best = { signal: sig, distance: d, ahead };
    }
    this.nearest = best;

    // forget junctions we have left behind so the next approach is announced again
    const maxT = Math.max(...this.s.distances);
    for (const [key, a] of [...this.announced.entries()]) if (distance(f.lat, f.lon, a.lat, a.lon) > maxT + 150) this.announced.delete(key);

    if (!best || !best.ahead || this.heading === null) return null;
    if (this.speedKmh < this.s.minSpeedKmh) return null;
    if (f.accuracy > 60) return null; // too imprecise to be useful
    if (Date.now() < this.quietUntil) return null;

    const key = this.junctionKey(best.signal);
    const entry = this.announced.get(key) || { lat: best.signal.lat, lon: best.signal.lon, done: new Set<number>() };
    const done = entry.done;
    // speak the smallest threshold we have crossed but not yet announced (skip larger ones if we jumped past them)
    const crossed = this.s.distances.filter((t) => best!.distance <= t && !done.has(t)).sort((a, b) => a - b)[0];
    if (crossed === undefined) return null;
    this.s.distances.filter((t) => t >= crossed).forEach((t) => done.add(t));
    this.announced.set(key, entry);
    this.quietUntil = Date.now() + 4000;
    return { signal: best.signal, distance: best.distance, threshold: crossed, text: this.describe(best.signal, best.distance, crossed) };
  }
}
