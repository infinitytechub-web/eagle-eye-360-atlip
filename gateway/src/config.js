// Eagle Eye 360 · ATLIP gateway — configuration from environment (see .env.example)
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadDotEnv(path.resolve(process.cwd(), '.env'));

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const req = (k) => { const v = env(k); if (!v) throw new Error(`Missing required setting ${k} (see .env.example)`); return v; };

export const config = {
  version: '1.0.0',
  gatewayId: env('GATEWAY_ID', 'gw-accra-01'),
  port: Number(env('PORT', '8090')),
  host: env('HOST', '127.0.0.1'), // bind locally; expose through the TLS reverse proxy (deploy/Caddyfile)
  dataDir: path.resolve(env('DATA_DIR', './data')),
  streamDir: path.resolve(env('STREAM_DIR', './data/streams')),
  allowedOrigins: env('ALLOWED_ORIGINS', 'https://atlip.infinitytechub.com,capacitor://localhost,https://localhost').split(',').map((s) => s.trim()).filter(Boolean),
  supabaseUrl: env('SUPABASE_URL', 'https://qhyiicwfwbmbkdkpyrnh.supabase.co'),
  supabaseKey: env('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_4Kqw1-U1pJJDGRJXesl3xA_fdAvpFT-'),
  serviceEmail: () => req('GATEWAY_ACCOUNT_EMAIL'),
  servicePassword: () => req('GATEWAY_ACCOUNT_PASSWORD'),
  vaultKey: () => req('GATEWAY_VAULT_KEY'),          // base64, 32 bytes — `npm run cli keygen`
  ticketSecret: () => req('GATEWAY_TICKET_SECRET'),  // base64, 32 bytes
  ticketTtlSec: Number(env('TICKET_TTL_SEC', '300')),
  idleStopSec: Number(env('STREAM_IDLE_STOP_SEC', '60')),
  hlsSegmentSec: Number(env('HLS_SEGMENT_SEC', '1')),
  ffmpeg: env('FFMPEG_PATH', 'ffmpeg'),
  ffprobe: env('FFPROBE_PATH', 'ffprobe'),
  monitorIntervalSec: Number(env('MONITOR_INTERVAL_SEC', '30')),
  ai: {
    enabled: env('AI_ENABLED', 'true') === 'true',
    fps: Number(env('AI_FPS', '1')),
    modelsDir: path.resolve(env('MODELS_DIR', '../public/models')),
    detector: env('AI_DETECTOR', 'atlip-detector-yolo11n.onnx'),
    stateModel: env('AI_STATE_MODEL', 'atlip-state-v2.onnx'),
    detConf: Number(env('AI_DET_CONF', '0.3')),
    stateConf: Number(env('AI_STATE_CONF', '0.7')),
    frames: Number(env('AI_TEMPORAL_FRAMES', '3')),
  },
  viewerRoles: ['super_admin', 'system_admin', 'supervisor', 'analyst', 'operator', 'support_officer'],
};
