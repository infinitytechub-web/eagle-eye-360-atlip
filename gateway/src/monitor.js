// Health monitor: keeps the platform's camera statuses truthful and the gateway heartbeat current.
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { loadVault } from './vault.js';
import { sb, myCameras, account } from './supa.js';
import { startWorker, stopWorker, workerStats } from './ai.js';
import { activeStreams } from './streams.js';
import { log } from './log.js';

const lastStatus = new Map();
let cams = [];
export const knownCameras = () => cams;

function probe(url) {
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'json'];
    if (/^rtsps?:/i.test(url)) args.push('-rtsp_transport', 'tcp', '-timeout', '8000000');
    const p = spawn(config.ffprobe, [...args, url], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = ''; p.stdout.on('data', (d) => (out += d));
    const t = setTimeout(() => { p.kill('SIGKILL'); resolve(null); }, 12000);
    p.on('exit', (code) => { clearTimeout(t); try { const v = JSON.parse(out).streams?.find((s) => s.width); resolve(code === 0 && v ? v : null); } catch { resolve(null); } });
  });
}

async function setStatus(cam, status, info) {
  const prev = lastStatus.get(cam.id) ?? cam.status;
  const patch = { stream_info: info || {} };
  if (status === 'Online') patch.last_frame_at = new Date().toISOString();
  // never overwrite an AI-raised 'Obstructed' with 'Online' here — the AI worker clears it when a signal reappears
  if (!(prev === 'Obstructed' && status === 'Online')) patch.status = status;
  const { error } = await sb.from('cameras').update(patch).eq('id', cam.id);
  if (error) { log.warn('camera status update failed', { cam: cam.id, error: error.message }); return; }
  if (patch.status && prev !== patch.status) {
    lastStatus.set(cam.id, patch.status);
    if (patch.status === 'Offline') await sb.from('alerts').insert({ kind: 'camera', severity: 'r', body: `Camera disconnected — ${cam.id} ${cam.name} (gateway ${config.gatewayId})`, created_by: account().id });
    else if (prev === 'Offline') await sb.from('alerts').insert({ kind: 'camera', severity: 'g', body: `Camera restored — ${cam.id} ${cam.name}`, created_by: account().id });
    log.info('camera status', { cam: cam.id, from: prev, to: patch.status });
  } else if (!lastStatus.has(cam.id)) lastStatus.set(cam.id, prev);
}

export async function tick() {
  try {
    cams = await myCameras();
    const vault = loadVault();
    const stats = new Map(workerStats().map((s) => [s.cam, s]));
    for (const cam of cams) {
      const src = vault[cam.id]?.url;
      if (!src) { await setStatus(cam, 'Offline', { reason: 'no source configured on gateway' }); continue; }
      if (config.ai.enabled && cam.ai_enabled) startWorker(cam); else stopWorker(cam.id);
      const w = stats.get(cam.id);
      if (w && w.frames > 0) {
        const fresh = Date.now() - w.lastFrame < Math.max(15000, 4000 / config.ai.fps);
        await setStatus(cam, fresh ? 'Online' : 'Offline', { ai: true, inference_ms: w.lastMs, frames: w.frames, lights_in_view: w.lastDets });
      } else {
        const v = await probe(src);
        await setStatus(cam, v ? 'Online' : 'Offline', v ? { codec: v.codec_name, width: v.width, height: v.height } : { reason: 'source unreachable' });
      }
    }
    for (const s of workerStats()) if (!cams.find((c) => c.id === s.cam && c.ai_enabled)) stopWorker(s.cam);
    await sb.from('gateways').update({
      status: 'online', version: config.version, last_seen_at: new Date().toISOString(),
      info: { cameras: cams.length, configured: Object.keys(vault).length, live_streams: activeStreams().length, ai_workers: workerStats().length, ai_enabled: config.ai.enabled },
    }).eq('id', config.gatewayId);
  } catch (e) { log.error('monitor tick failed', { error: String(e.message || e) }); }
}

export async function markOffline() { await sb.from('gateways').update({ status: 'offline', last_seen_at: new Date().toISOString() }).eq('id', config.gatewayId); }
