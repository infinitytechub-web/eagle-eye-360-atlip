// Viewer authorisation.
// 1. The browser sends its Supabase access token (Bearer) to POST /v1/streams/:cam/ticket.
// 2. The gateway verifies it with Supabase Auth, checks the profile is ACTIVE with a CCTV-viewing role,
//    and that the camera belongs to this gateway with streaming enabled.
// 3. It returns a short-lived HMAC ticket bound to (user, camera, expiry). The ticket — never the JWT —
//    is carried in HLS URLs, so tokens do not leak into server logs or browser history.
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { sb } from './supa.js';

const verifyClient = createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
const cache = new Map(); // token hash -> { until, viewer }

export class AuthError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export async function verifyViewer(bearer) {
  if (!bearer) throw new AuthError(401, 'Sign in required');
  const h = crypto.createHash('sha256').update(bearer).digest('hex');
  const hit = cache.get(h); if (hit && hit.until > Date.now()) return hit.viewer;
  const { data, error } = await verifyClient.auth.getUser(bearer);
  if (error || !data?.user) throw new AuthError(401, 'Session invalid or expired');
  // the gateway account can read active profiles (RLS) — look up the viewer's role
  const { data: p } = await sb.from('profiles').select('id, full_name, email, role, active').eq('id', data.user.id).maybeSingle();
  if (!p || !p.active) throw new AuthError(403, 'Account is not active');
  if (!config.viewerRoles.includes(p.role)) throw new AuthError(403, 'Your role is not permitted to view live CCTV');
  const viewer = { id: p.id, name: p.full_name || p.email, role: p.role };
  cache.set(h, { until: Date.now() + 60_000, viewer });
  if (cache.size > 500) for (const [k, v] of cache) if (v.until < Date.now()) cache.delete(k);
  return viewer;
}

const b64u = (b) => Buffer.from(b).toString('base64url');
const secret = () => Buffer.from(config.ticketSecret(), 'base64');

export function issueTicket(viewer, cam, sessionId) {
  const exp = Math.floor(Date.now() / 1000) + config.ticketTtlSec;
  const body = b64u(JSON.stringify({ u: viewer.id, n: viewer.name, c: cam, s: sessionId, e: exp }));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return { ticket: `${body}.${sig}`, expiresAt: exp * 1000 };
}

export function checkTicket(ticket, cam) {
  const [body, sig] = String(ticket || '').split('.');
  if (!body || !sig) throw new AuthError(401, 'Missing ticket');
  const expect = crypto.createHmac('sha256', secret()).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) throw new AuthError(401, 'Invalid ticket');
  const t = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (t.c !== cam) throw new AuthError(403, 'Ticket is for a different camera');
  if (t.e * 1000 < Date.now()) throw new AuthError(401, 'Ticket expired');
  return t;
}
