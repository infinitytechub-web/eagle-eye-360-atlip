// Supabase connection as the gateway's own least-privilege service account (role 'gateway').
// Row-Level Security limits it to: health fields of its own cameras, gateway-sourced detections,
// intersection signal state, its own gateway row, CCTV sessions and camera audit entries.
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { log } from './log.js';

export const sb = createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: true },
});
let me = null;

export async function signIn() {
  const { data, error } = await sb.auth.signInWithPassword({ email: config.serviceEmail(), password: config.servicePassword() });
  if (error) throw new Error('Gateway service account sign-in failed: ' + error.message);
  const { data: p, error: e2 } = await sb.from('profiles').select('id, role, active, full_name').eq('id', data.user.id).single();
  if (e2 || !p) throw new Error('Gateway profile not readable: ' + (e2?.message || 'missing'));
  if (p.role !== 'gateway' || !p.active) throw new Error(`Account ${config.serviceEmail()} must be an ACTIVE account with role "gateway" (current: ${p.role}, active=${p.active})`);
  const { data: gw, error: e3 } = await sb.from('gateways').select('*').eq('id', config.gatewayId).maybeSingle();
  if (e3) throw new Error(e3.message);
  if (!gw) throw new Error(`Gateway "${config.gatewayId}" is not registered. Register it in CCTV Surveillance Centre → Gateways and link this service account.`);
  if (gw.account_id !== p.id) throw new Error(`Gateway "${config.gatewayId}" is linked to a different service account.`);
  me = p; log.info('signed in as gateway service account', { gateway: config.gatewayId });
  return p;
}
export const account = () => me;

/** Cameras assigned to this gateway in the platform (metadata only — no credentials). */
export async function myCameras() {
  const { data, error } = await sb.from('cameras').select('id, name, intersection_id, status, stream_enabled, ai_enabled, gateway_id').eq('gateway_id', config.gatewayId).order('id');
  if (error) throw new Error(error.message);
  return data || [];
}

export async function audit(actor, actorName, action, target) {
  const { error } = await sb.rpc('gateway_audit', { p_actor: actor, p_actor_name: actorName, p_action: action, p_target: target });
  if (error) log.warn('audit write failed', { error: error.message });
}
