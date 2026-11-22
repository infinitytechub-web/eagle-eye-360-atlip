#!/usr/bin/env node
// Eagle Eye 360 · ATLIP — CCTV video gateway (HTTP API).
//   GET  /health                               public liveness (no camera details)
//   GET  /v1/status                            [Bearer] cameras on this gateway + live/AI state
//   POST /v1/streams/:cam/ticket               [Bearer] → { ticket, playlist, expiresAt }
//   GET  /v1/hls/:cam/:ticket/index.m3u8       ticketed HLS playlist
//   GET  /v1/hls/:cam/:ticket/seg_00001.ts     ticketed HLS segment
import './privacy.js'; // must stay the first import: disables runtime telemetry before the AI engine loads
import http from 'node:http';
import fs from 'node:fs';
import { config } from './config.js';
import { log } from './log.js';
import { signIn, sb, audit } from './supa.js';
import { verifyViewer, issueTicket, checkTicket, AuthError } from './auth.js';
import { ensureStream, streamFile, touch, isLive, activeStreams, stopAll } from './streams.js';
import { tick, markOffline, knownCameras } from './monitor.js';
import { loadModels, workerStats, stopAllWorkers } from './ai.js';
import { CAMERA_ID } from './vault.js';

const sessionTouch = new Map(); // session id -> last DB update (throttle)

function cors(req, res) {
  const o = req.headers.origin;
  if (o && config.allowedOrigins.includes(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
async function readJson(req) {
  let raw = ''; for await (const c of req) { raw += c; if (raw.length > 4096) throw Object.assign(new Error('Body too large'), { status: 413 }); }
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;

// simple per-IP rate limit for ticket issuance (brute force / abuse)
const hits = new Map();
function limited(ip, max = 30) { const now = Date.now(), w = hits.get(ip) || []; const r = w.filter((t) => now - t < 60000); r.push(now); hits.set(ip, r); return r.length > max; }

async function handle(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://x'); const parts = url.pathname.split('/').filter(Boolean);
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();

  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, gateway: config.gatewayId, version: config.version });

  if (req.method === 'GET' && url.pathname === '/v1/status') {
    await verifyViewer(bearer(req));
    const ai = new Map(workerStats().map((w) => [w.cam, w]));
    return send(res, 200, { gateway: config.gatewayId, version: config.version, cameras: knownCameras().map((c) => ({ id: c.id, live: isLive(c.id), stream_enabled: c.stream_enabled, ai: ai.get(c.id) || null })), streams: activeStreams() });
  }

  if (req.method === 'POST' && parts[0] === 'v1' && parts[1] === 'streams' && parts[3] === 'ticket') {
    if (limited(ip)) return send(res, 429, { error: 'Too many requests' });
    const cam = parts[2]; if (!CAMERA_ID.test(cam)) return send(res, 400, { error: 'Bad camera id' });
    const viewer = await verifyViewer(bearer(req));
    const camRow = knownCameras().find((c) => c.id === cam);
    if (!camRow) return send(res, 404, { error: 'Camera is not assigned to this gateway' });
    if (!camRow.stream_enabled) return send(res, 403, { error: 'Live streaming is disabled for this camera' });
    const body = await readJson(req);
    await ensureStream(cam);
    let sessionId = null;
    if (body.session) { // renewal: reuse the viewer's existing session for this camera
      const { data: prev } = await sb.from('cctv_sessions').select('id').eq('id', Number(body.session)).eq('user_id', viewer.id).eq('camera_id', cam).maybeSingle();
      sessionId = prev?.id ?? null;
    }
    if (!sessionId) {
      const { data: sess } = await sb.from('cctv_sessions').insert({ user_id: viewer.id, user_name: viewer.name, camera_id: cam, gateway_id: config.gatewayId, client: String(req.headers['user-agent'] || '').slice(0, 160) }).select('id').single();
      sessionId = sess?.id ?? null;
      await audit(viewer.id, viewer.name, `Live CCTV view started: ${cam}`, `gateway ${config.gatewayId}`);
    }
    const t = issueTicket(viewer, cam, sessionId);
    return send(res, 200, { ...t, session: sessionId, ttl: config.ticketTtlSec, playlist: `/v1/hls/${cam}/${t.ticket}/index.m3u8` });
  }

  if (req.method === 'GET' && parts[0] === 'v1' && parts[1] === 'hls' && parts.length === 5) {
    const [, , cam, ticket, file] = parts;
    const t = checkTicket(ticket, cam);
    touch(cam);
    if (t.s && Date.now() - (sessionTouch.get(t.s) || 0) > 30000) { sessionTouch.set(t.s, Date.now()); sb.from('cctv_sessions').update({ last_activity_at: new Date().toISOString() }).eq('id', t.s).then(() => {}); }
    let f = streamFile(cam, file);
    if (!f && file === 'index.m3u8') { await ensureStream(cam); f = streamFile(cam, file); }
    if (!f) return send(res, 404, { error: 'Not found' });
    const isPl = file.endsWith('.m3u8');
    res.writeHead(200, { 'Content-Type': isPl ? 'application/vnd.apple.mpegurl' : 'video/mp2t', 'Cache-Control': isPl ? 'no-store' : 'private, max-age=30', 'X-Content-Type-Options': 'nosniff' });
    return fs.createReadStream(f).pipe(res);
  }
  return send(res, 404, { error: 'Not found' });
}

async function main() {
  fs.mkdirSync(config.streamDir, { recursive: true });
  await signIn();
  if (config.ai.enabled) await loadModels();
  await tick();
  setInterval(tick, config.monitorIntervalSec * 1000);
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      const status = e instanceof AuthError ? e.status : e.status || 500;
      if (status >= 500) log.error('request failed', { path: req.url?.split('/').slice(0, 4).join('/'), error: String(e.message || e) });
      if (!res.headersSent) send(res, status, { error: status >= 500 ? 'Gateway error' : e.message });
    });
  });
  server.listen(config.port, config.host, () => log.info('gateway listening', { host: config.host, port: config.port, gateway: config.gatewayId }));
  const shutdown = async () => { log.info('shutting down'); stopAll(); stopAllWorkers(); await markOffline().catch(() => {}); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
main().catch((e) => { log.error('fatal', { error: String(e.message || e) }); process.exit(1); });
