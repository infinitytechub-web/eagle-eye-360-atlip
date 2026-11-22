import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { approveNativeHandoff } from '../lib/passkey';
import { NATIVE_CALLBACK } from './pkce';

export const HANDOFF_KEY = 'ee360-native-handoff';

/** Read and remember a native-app sign-in request (#/native-login?cc=...) so it survives the sign-in steps. */
export function captureHandoffRequest() {
  const h = window.location.hash;
  if (!h.startsWith('#/native-login')) return;
  const cc = new URLSearchParams(h.split('?')[1] || '').get('cc') || '';
  if (/^[A-Za-z0-9_-]{43}$/.test(cc)) sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ cc, at: Date.now() }));
  window.history.replaceState(null, '', window.location.pathname);
}
export function pendingHandoff(): string | null {
  try { const v = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null'); return v && Date.now() - v.at < 10 * 60_000 ? v.cc : null; } catch { return null; }
}

/** Browser half of the native sign-in: the signed-in user explicitly approves the app on their device. */
export function NativeHandoffScreen({ cc }: { cc: string }) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(false);
  async function approve() {
    setBusy(true); setErr('');
    try {
      const code = await approveNativeHandoff(cc);
      sessionStorage.removeItem(HANDOFF_KEY); setDone(true);
      window.location.href = `${NATIVE_CALLBACK}?code=${encodeURIComponent(code)}`;
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const cancel = () => { sessionStorage.removeItem(HANDOFF_KEY); window.location.reload(); };
  return (
    <section id="login"><div className="loginbox"><div className="card">
      <h3>Sign in to the Eagle Eye 360 app</h3>
      {done ? <p>Returning to the app… You can close this window.</p> : <>
        <p>Allow the Eagle Eye 360 app on this device to sign in as <strong>{profile?.full_name || profile?.email}</strong>?</p>
        <p className="small muted">Only approve if you just tapped “Sign in” in the app yourself. The approval works once, expires in 60 seconds, and can only be used by the app that requested it.</p>
        {err && <p className="small" style={{ color: '#FF8A84' }}>{err}</p>}
        <div className="pillrow"><button className="btn primary" onClick={approve} disabled={busy}>{busy ? 'Approving…' : 'Approve sign-in'}</button><button className="btn" onClick={cancel}>Cancel</button></div>
      </>}
    </div></div></section>
  );
}
