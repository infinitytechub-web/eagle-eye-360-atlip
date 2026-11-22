import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { supabase } from './supabase';

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('passkey', { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return data as T;
}

/** The iOS/Android app (Capacitor): native plugins for location, speech and the system browser. */
export const isCapacitorApp = () => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
/** Desktop bridge exposed by the Electron preload (contextBridge) — a minimal, audited surface. */
export interface DesktopBridge { platform: string; version: string; openExternal: (url: string) => Promise<void>; onAuthCallback: (cb: (url: string) => void) => () => void }
export const desktopBridge = (): DesktopBridge | undefined => (window as unknown as { atlipDesktop?: DesktopBridge }).atlipDesktop;
export const isDesktopApp = () => !!desktopBridge();
/** Any installed app (mobile or desktop): passkeys run in the system browser and hand the session back via PKCE. */
export const isNativeShell = () => isCapacitorApp() || isDesktopApp();

/** Passkeys need WebAuthn and a secure, real web origin (not a native app's bundled origin). */
export function passkeysSupported() { return browserSupportsWebAuthn() && window.isSecureContext && !isNativeShell(); }
export const hasPlatformAuthenticator = () => platformAuthenticatorIsAvailable().catch(() => false);

export function friendlyError(e: unknown) {
  const err = e as { name?: string; message?: string };
  if (err?.name === 'NotAllowedError') return 'Passkey request was cancelled or timed out.';
  if (err?.name === 'InvalidStateError') return 'This device already has a passkey for your account.';
  if (err?.name === 'SecurityError') return 'Passkeys are only available on the official ATLIP site over HTTPS.';
  return err?.message || 'Passkey error';
}

export async function registerPasskey(name: string) {
  const optionsJSON = await call<Parameters<typeof startRegistration>[0]['optionsJSON']>({ action: 'register-options' });
  const response = await startRegistration({ optionsJSON });
  await call({ action: 'register-verify', response, name });
}

export async function signInWithPasskey() {
  const { options, challengeId } = await call<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON']; challengeId: string }>({ action: 'login-options' });
  const response = await startAuthentication({ optionsJSON: options });
  const { token_hash } = await call<{ token_hash: string }>({ action: 'login-verify', challengeId, response });
  const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' });
  if (error) throw error;
}

// ---- native app sign-in handoff (PKCE S256): the browser half ----
export async function approveNativeHandoff(codeChallenge: string) {
  const { code } = await call<{ code: string }>({ action: 'handoff-create', code_challenge: codeChallenge });
  return code;
}
export async function redeemNativeHandoff(code: string, verifier: string) {
  const { token_hash } = await call<{ token_hash: string }>({ action: 'handoff-redeem', code, code_verifier: verifier });
  const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' });
  if (error) throw error;
}
