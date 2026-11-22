// Pure, unit-tested security policy for the desktop shell (no Electron imports — see test/security.test.js).
'use strict';
const APP_ORIGIN = 'https://atlip.infinitytechub.com';
const APP_URL = APP_ORIGIN + '/';
const SCHEME = 'gh.infinitytechub.atlip';
// Supabase API host the site talks to (XHR/fetch — never navigated to).
const ALLOWED_PERMISSIONS = new Set(['geolocation', 'media', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection']);

function originOf(u) { try { return new URL(u).origin; } catch { return null; } }
/** Only the ATLIP site may be shown inside the app window. */
function isAppUrl(u) { return originOf(u) === APP_ORIGIN; }
/** Links that leave the app open in the user's browser — web links and mail only. */
function isSafeExternal(u) { try { const p = new URL(u).protocol; return p === 'https:' || p === 'http:' || p === 'mailto:'; } catch { return false; } }
/** The renderer may only ask the OS browser to open the passkey hand-off page with a PKCE challenge. */
function isHandoffUrl(u) {
  try {
    const x = new URL(u);
    return x.origin === APP_ORIGIN && x.pathname === '/' && /^#\/native-login\?cc=[A-Za-z0-9_-]{43}$/.test(x.hash);
  } catch { return false; }
}
/** A sign-in callback from the system browser: gh.infinitytechub.atlip://auth?code=… */
function authCallbackFrom(argv) {
  const list = Array.isArray(argv) ? argv : [argv];
  for (const a of list) {
    if (typeof a !== 'string' || !a.startsWith(SCHEME + '://auth')) continue;
    try { const code = new URL(a.replace(SCHEME + '://', 'https://x/')).searchParams.get('code'); if (code && /^[A-Za-z0-9_-]{20,128}$/.test(code)) return a; } catch { /* ignore */ }
  }
  return null;
}
/** Permissions are granted only to the ATLIP origin, and only the ones the app uses. */
function allowPermission(permission, requestingUrl) { return ALLOWED_PERMISSIONS.has(permission) && isAppUrl(requestingUrl || ''); }

module.exports = { APP_ORIGIN, APP_URL, SCHEME, isAppUrl, isSafeExternal, isHandoffUrl, authCallbackFrom, allowPermission };
