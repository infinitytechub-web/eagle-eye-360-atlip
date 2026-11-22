#!/usr/bin/env node
// Gateway administration CLI — run on the gateway host only.
//   npm run cli keygen                         print fresh GATEWAY_VAULT_KEY and GATEWAY_TICKET_SECRET
//   npm run cli add CAM-01 "rtsp://user:pass@10.0.0.5:554/Streaming/Channels/101" [--transcode]
//   npm run cli list                           show configured cameras (credentials masked)
//   npm run cli test CAM-01                    probe the camera source with ffprobe
//   npm run cli remove CAM-01
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { config } from './config.js';
import { loadVault, saveVault, maskUrl, CAMERA_ID } from './vault.js';

const [cmd, ...args] = process.argv.slice(2);
const die = (m) => { console.error(m); process.exit(1); };

async function ask(q) { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); const a = await new Promise((r) => rl.question(q, r)); rl.close(); return a; }

switch (cmd) {
  case 'keygen':
    console.log('GATEWAY_VAULT_KEY=' + crypto.randomBytes(32).toString('base64'));
    console.log('GATEWAY_TICKET_SECRET=' + crypto.randomBytes(32).toString('base64'));
    console.log('# Store these in the gateway .env only. Losing the vault key means re-entering camera sources.');
    break;
  case 'add': {
    const [id, urlArg] = args; if (!id || !CAMERA_ID.test(id)) die('Usage: add CAM-01 [source-url] [--transcode]   (id must match the platform camera id)');
    // prefer interactive entry so the password does not land in shell history
    const url = urlArg && !urlArg.startsWith('--') ? urlArg : await ask(`Source URL for ${id} (rtsp://user:pass@host:554/path): `);
    if (!/^(rtsps?|https?|file):\/\//i.test(url) && !url.startsWith('/')) die('Source must be rtsp://, rtsps://, http(s):// or a file path');
    const v = loadVault(); v[id] = { url, transcode: args.includes('--transcode') ? true : undefined, added: new Date().toISOString() }; saveVault(v);
    console.log(`Saved ${id} → ${maskUrl(url)}. In the platform: assign ${id} to gateway "${config.gatewayId}" and enable streaming.`);
    break;
  }
  case 'list': { const v = loadVault(); const ids = Object.keys(v); if (!ids.length) console.log('No cameras configured.'); ids.forEach((k) => console.log(`${k}\t${maskUrl(v[k].url)}${v[k].transcode ? '\t(transcode)' : ''}`)); break; }
  case 'remove': { const v = loadVault(); if (!v[args[0]]) die('Not found'); delete v[args[0]]; saveVault(v); console.log('Removed ' + args[0]); break; }
  case 'test': {
    const e = loadVault()[args[0]]; if (!e) die('Not found');
    const a = ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate', '-of', 'compact'];
    if (/^rtsps?:/i.test(e.url)) a.push('-rtsp_transport', 'tcp', '-timeout', '8000000');
    const r = spawnSync(config.ffprobe, [...a, e.url], { encoding: 'utf8', timeout: 15000 });
    console.log(r.status === 0 ? `OK ${maskUrl(e.url)}\n${r.stdout.trim()}` : `FAILED ${maskUrl(e.url)}\n${(r.stderr || 'timeout').replace(/rtsps?:\/\/\S+/g, (u) => maskUrl(u)).trim()}`);
    break;
  }
  default: console.log('Commands: keygen | add <CAM-ID> [url] [--transcode] | list | test <CAM-ID> | remove <CAM-ID>');
}
