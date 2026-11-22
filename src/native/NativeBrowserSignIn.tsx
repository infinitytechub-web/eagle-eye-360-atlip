import { useEffect, useRef, useState } from 'react';
import { redeemNativeHandoff, desktopBridge } from '../lib/passkey';
import { makeVerifier, challengeFor, NATIVE_SCHEME, WEB_ORIGIN } from './pkce';

/**
 * Native apps (iOS/Android): sign in through the system browser, where passkeys, Face ID / fingerprint and saved
 * passwords work. The browser returns a one-time code via the app's URL scheme; only this app instance holds the
 * PKCE verifier needed to redeem it, so an intercepted code is useless.
 */
export function NativeBrowserSignIn({ onError }: { onError: (m: string) => void }) {
  const verifier = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let remove: (() => void) | undefined;
    const handle = async (url: string) => {
      if (!url.startsWith(`${NATIVE_SCHEME}://auth`)) return;
      const code = new URL(url.replace(`${NATIVE_SCHEME}://`, 'https://x/')).searchParams.get('code');
      if (!code || !verifier.current) { onError('Sign-in was not completed. Please try again.'); setBusy(false); return; }
      try { await redeemNativeHandoff(code, verifier.current); }
      catch (e) { onError((e as Error).message); }
      finally { verifier.current = null; setBusy(false); }
    };
    const desk = desktopBridge();
    if (desk) { remove = desk.onAuthCallback((u) => { void handle(u); }); return () => remove?.(); }
    (async () => {
      const { App } = await import('@capacitor/app');
      const { Browser } = await import('@capacitor/browser');
      const h = await App.addListener('appUrlOpen', async ({ url }) => { await Browser.close().catch(() => {}); await handle(url); });
      remove = () => h.remove();
    })();
    return () => remove?.();
  }, [onError]);

  async function start() {
    onError(''); setBusy(true);
    try {
      verifier.current = makeVerifier();
      const cc = await challengeFor(verifier.current);
      const url = `${WEB_ORIGIN}/#/native-login?cc=${cc}`;
      const desk = desktopBridge();
      if (desk) await desk.openExternal(url);
      else { const { Browser } = await import('@capacitor/browser'); await Browser.open({ url, presentationStyle: 'popover' }); }
    } catch (e) { setBusy(false); onError((e as Error).message); }
  }

  return (
    <>
      <button type="button" className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={start} disabled={busy}>
        {busy ? 'Waiting for browser sign-in…' : 'Sign in with passkey or browser'}
      </button>
      <p className="small muted" style={{ textAlign: 'center', margin: '.4rem 0' }}>Opens your secure system browser — use your passkey (Face ID, fingerprint or Windows Hello) there.</p>
    </>
  );
}
