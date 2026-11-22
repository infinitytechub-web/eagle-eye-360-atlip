// On-demand RTSP → HLS with FFmpeg. A stream starts when the first authorised viewer asks for it and
// stops after STREAM_IDLE_STOP_SEC with no segment requests. Each camera gets its own directory.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { loadVault, maskUrl } from './vault.js';
import { log } from './log.js';

const streams = new Map(); // cam -> { proc, dir, lastHit, startedAt, restarts, ready }

export function inputArgs(src) {
  const a = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (/^rtsps?:/i.test(src)) a.push('-rtsp_transport', 'tcp', '-timeout', '10000000');   // TCP is reliable across NAT/firewalls
  else if (/^(file:|\/)/.test(src) || /\.(mp4|mkv|mov|ts)$/i.test(src)) a.push('-re', '-stream_loop', '-1');    // test sources
  a.push('-fflags', '+genpts', '-i', src);
  return a;
}

function hlsArgs(src, dir, transcode) {
  const v = transcode
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
       '-vf', 'scale=-2:min(720\\,ih)', '-force_key_frames', `expr:gte(t,n_forced*${config.hlsSegmentSec})`, '-sc_threshold', '0', '-b:v', '1800k', '-maxrate', '2200k', '-bufsize', '3600k']
    : ['-c:v', 'copy'];
  return [...inputArgs(src), '-map', '0:v:0', '-an', ...v,
    '-f', 'hls', '-hls_time', String(config.hlsSegmentSec), '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+omit_endlist+independent_segments+temp_file',
    '-hls_segment_filename', path.join(dir, 'seg_%05d.ts'), path.join(dir, 'index.m3u8')];
}

export function isLive(cam) { const s = streams.get(cam); return !!s && s.ready; }
export function activeStreams() { return [...streams.entries()].map(([cam, s]) => ({ cam, since: s.startedAt, ready: s.ready, restarts: s.restarts })); }

export async function ensureStream(cam) {
  const existing = streams.get(cam);
  if (existing) { existing.lastHit = Date.now(); return existing; }
  const vault = loadVault(); const entry = vault[cam];
  if (!entry) throw Object.assign(new Error(`No source configured on this gateway for ${cam}`), { status: 404 });
  const dir = path.join(config.streamDir, cam.replace(/[^A-Z0-9-]/g, ''));
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const s = { proc: null, dir, lastHit: Date.now(), startedAt: Date.now(), restarts: 0, ready: false, stopped: false };
  streams.set(cam, s);
  const start = () => {
    const transcode = entry.transcode ?? !/^rtsps?:/i.test(entry.url);
    s.proc = spawn(config.ffmpeg, hlsArgs(entry.url, dir, transcode), { stdio: ['ignore', 'ignore', 'pipe'] });
    let errTail = '';
    s.proc.stderr.on('data', (d) => { errTail = (errTail + d).slice(-600); });
    s.proc.on('exit', (code) => {
      s.ready = false;
      if (s.stopped) return;
      s.restarts++;
      log.warn('stream ffmpeg exited, restarting', { cam, code, src: maskUrl(entry.url), err: errTail.replace(/rtsps?:\/\/[^\s]*/g, (u) => maskUrl(u)).trim().slice(-300) });
      setTimeout(() => { if (!s.stopped) start(); }, Math.min(30000, 1000 * 2 ** Math.min(s.restarts, 5)));
    });
  };
  start();
  log.info('stream started', { cam, src: maskUrl(entry.url) });
  // wait until the first playlist exists (max 15 s)
  const pl = path.join(dir, 'index.m3u8');
  for (let i = 0; i < 150 && !fs.existsSync(pl); i++) await new Promise((r) => setTimeout(r, 100));
  s.ready = fs.existsSync(pl);
  if (!s.ready) { stopStream(cam); throw Object.assign(new Error('Camera did not produce video within 15 s'), { status: 504 }); }
  return s;
}

export function touch(cam) { const s = streams.get(cam); if (s) s.lastHit = Date.now(); }

export function stopStream(cam) {
  const s = streams.get(cam); if (!s) return;
  s.stopped = true; try { s.proc?.kill('SIGTERM'); } catch { /* ignore */ }
  streams.delete(cam); setTimeout(() => fs.rmSync(s.dir, { recursive: true, force: true }), 2000);
  log.info('stream stopped', { cam });
}

export function streamFile(cam, name) {
  const s = streams.get(cam); if (!s) return null;
  if (!/^(index\.m3u8|seg_\d{5}\.ts)$/.test(name)) return null; // no path traversal, only HLS artefacts
  const f = path.join(s.dir, name);
  return fs.existsSync(f) ? f : null;
}

setInterval(() => { for (const [cam, s] of streams) if (Date.now() - s.lastHit > config.idleStopSec * 1000) stopStream(cam); }, 5000).unref();
export function stopAll() { for (const cam of [...streams.keys()]) stopStream(cam); }
