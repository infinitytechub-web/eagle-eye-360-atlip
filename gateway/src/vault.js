// Encrypted camera credential vault (AES-256-GCM). Camera source URLs — which contain RTSP usernames
// and passwords — exist ONLY here, on the gateway host. They never reach the browser or Supabase.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const FILE = () => path.join(config.dataDir, 'vault.enc');

function key() {
  const k = Buffer.from(config.vaultKey(), 'base64');
  if (k.length !== 32) throw new Error('GATEWAY_VAULT_KEY must be 32 bytes, base64-encoded (run: pnpm run cli keygen)');
  return k;
}

export function loadVault() {
  if (!fs.existsSync(FILE())) return {};
  const raw = fs.readFileSync(FILE());
  const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), data = raw.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
}

export function saveVault(v) {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(v), 'utf8'), c.final()]);
  const tmp = FILE() + '.tmp';
  fs.writeFileSync(tmp, Buffer.concat([iv, c.getAuthTag(), data]), { mode: 0o600 });
  fs.renameSync(tmp, FILE());
}

/** Mask credentials for display/logging: rtsp://admin:••••@10.0.0.5:554/… */
export function maskUrl(u) {
  try {
    const x = new URL(u);
    if (!x.username && !x.password) return u;
    const user = decodeURIComponent(x.username).slice(0, 2) + '•••';
    return `${x.protocol}//${user}${x.password ? ':••••' : ''}@${x.host}${x.pathname}${x.search ? '?…' : ''}`;
  } catch { return u.replace(/\/\/[^@/]*@/, '//•••@'); }
}

export const CAMERA_ID = /^CAM-[0-9A-Z-]{1,20}$/;
