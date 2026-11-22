// PKCE (RFC 7636, S256) helpers for the native-app sign-in handoff.
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function makeVerifier() { return b64url(crypto.getRandomValues(new Uint8Array(48))); } // 64 chars
export async function challengeFor(verifier: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export const NATIVE_SCHEME = 'gh.infinitytechub.atlip';      // custom URL scheme registered by the iOS/Android apps
export const NATIVE_CALLBACK = `${NATIVE_SCHEME}://auth`;
export const WEB_ORIGIN = 'https://atlip.infinitytechub.com';
