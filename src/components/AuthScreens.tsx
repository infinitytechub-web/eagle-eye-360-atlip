import { useEffect, useState, type ReactNode } from 'react';
import { supabase, audit } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useBranding } from '../lib/branding';
import { Logo } from './ui';
import { errMsg } from '../lib/util';

function Frame({ children }: { children: ReactNode }) {
  const { branding } = useBranding();
  const m = branding.sysName.match(/^(.*?)(360)\s*$/);
  return (
    <section id="login">
      <div className="loginbox">
        <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}><Logo src={branding.logo} size={150} /></div>
          <h1 style={{ margin: '.6rem 0 .1rem', fontSize: '1.7rem' }}>
            {m ? <>{m[1]}<span style={{ color: 'var(--lime)' }} className="glow">360</span></> : branding.sysName}
          </h1>
          <p className="muted" style={{ margin: 0, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>{branding.tagline}</p>
          <p className="small muted">{branding.welcome}</p>
        </div>
        <div className="card">{children}</div>
        <p className="small muted" style={{ textAlign: 'center' }}>{branding.org} · Africa/Accra (GMT) · Authorised personnel only — all access is audit-logged</p>
      </div>
    </section>
  );
}
const Err = ({ msg }: { msg: string }) => (msg ? <p className="small" role="alert" style={{ color: '#FF8A84' }}>{msg}</p> : null);
const Ok = ({ msg }: { msg: string }) => (msg ? <p className="small" role="status" style={{ color: 'var(--lime)' }}>{msg}</p> : null);

export function LoginScreen() {
  const { signOutReason } = useAuth();
  const [mode, setMode] = useState<'signin' | 'register' | 'forgot'>('signin');
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [name, setName] = useState('');
  const [err, setErr] = useState(''); const [ok, setOk] = useState(signOutReason ? 'Signed out: ' + signOutReason : '');
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0); const [lockUntil, setLockUntil] = useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setOk('');
    if (Date.now() < lockUntil) { setErr(`Too many attempts. Try again in ${Math.ceil((lockUntil - Date.now()) / 1000)} s.`); return; }
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (error) {
          const n = fails + 1; setFails(n);
          if (n >= 5) { setLockUntil(Date.now() + 60_000 * Math.min(15, 2 ** (n - 5))); }
          throw new Error(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message);
        }
        setFails(0);
      } else if (mode === 'register') {
        if (pw.length < 12) throw new Error('Use a password of at least 12 characters.');
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: pw, options: { data: { full_name: name.trim() }, emailRedirectTo: window.location.origin } });
        if (error) throw error;
        setOk(data.session ? 'Account created.' : 'Check your email to confirm your address. An administrator must then approve your access.');
        setMode('signin');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) throw error;
        setOk('If that address has an account, a reset link has been sent.');
        setMode('signin');
      }
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  }

  return (
    <Frame>
      <h3>{mode === 'signin' ? 'Sign in' : mode === 'register' ? 'Request access' : 'Reset password'}</h3>
      <form onSubmit={submit}>
        {mode === 'register' && <><label htmlFor="nm">Full name</label><input id="nm" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" /></>}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        {mode !== 'forgot' && <><label htmlFor="pw">Password{mode === 'register' && <span className="muted"> (minimum 12 characters)</span>}</label>
          <input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={mode === 'register' ? 12 : 1} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} /></>}
        <Err msg={err} /><Ok msg={ok} />
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: '.6rem' }} disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'register' ? 'Submit access request' : 'Send reset link'}
        </button>
      </form>
      <div className="pillrow" style={{ marginTop: '.8rem', justifyContent: 'space-between' }}>
        {mode !== 'signin' && <button className="btn small" onClick={() => { setMode('signin'); setErr(''); }}>Back to sign in</button>}
        {mode === 'signin' && <button className="btn small" onClick={() => { setMode('register'); setErr(''); }}>Request access</button>}
        {mode === 'signin' && <button className="btn small" onClick={() => { setMode('forgot'); setErr(''); }}>Forgot password?</button>}
      </div>
      <p className="small muted" style={{ marginTop: '.8rem' }}>
        New accounts stay inactive until an administrator approves them and assigns a role. Super Administrators must use an authenticator app (MFA).
        Sessions end after 30 minutes of inactivity.
      </p>
    </Frame>
  );
}

export function RecoveryScreen() {
  const { refreshProfile } = useAuth();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (pw.length < 12) return setErr('Use at least 12 characters.');
    if (pw !== pw2) return setErr('The passwords do not match.');
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return setErr(error.message);
    await refreshProfile();
  }
  return (
    <Frame>
      <h3>Choose a new password</h3>
      <form onSubmit={save}>
        <label htmlFor="np">New password</label><input id="np" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        <label htmlFor="np2">Confirm new password</label><input id="np2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        <Err msg={err} />
        <button className="btn primary" style={{ marginTop: '.6rem' }}>Save password</button>
      </form>
    </Frame>
  );
}

export function PendingScreen() {
  const { profile, signOut, refreshProfile } = useAuth();
  return (
    <Frame>
      <h3>Access pending approval</h3>
      <p>Your account <strong>{profile?.email}</strong> has been created but is not yet active.</p>
      <p className="small muted">A Super Administrator or System Administrator must approve it and assign your role in System Administration → Users. You will not see any operational data until then.</p>
      <div className="pillrow"><button className="btn" onClick={refreshProfile}>Check again</button><button className="btn" onClick={() => signOut()}>Sign out</button></div>
    </Frame>
  );
}

export function MfaEnrollScreen() {
  const { recheckMfa, signOut } = useAuth();
  const [qr, setQr] = useState(''); const [secret, setSecret] = useState(''); const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState(''); const [err, setErr] = useState('');
  useEffect(() => {
    (async () => {
      // remove stale unverified factors, then enrol a fresh TOTP factor
      const { data: f } = await supabase.auth.mfa.listFactors();
      for (const x of f?.all || []) if (x.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: x.id });
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'ATLIP ' + new Date().toISOString().slice(0, 10) });
      if (error) { setErr(error.message); return; }
      setFactorId(data.id); setQr(data.totp.qr_code); setSecret(data.totp.secret);
    })();
  }, []);
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const { data: ch, error: e1 } = await supabase.auth.mfa.challenge({ factorId });
    if (e1) return setErr(e1.message);
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() });
    if (error) return setErr('That code was not accepted. Check your device clock and try again.');
    await audit('MFA (TOTP) enrolled', null, 'auth');
    await recheckMfa();
  }
  return (
    <Frame>
      <h3>Set up multi-factor authentication</h3>
      <p className="small">Super Administrator accounts must use an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…). Scan the code, then enter the 6-digit code it shows.</p>
      {qr ? <div style={{ background: '#fff', padding: 10, borderRadius: 12, width: 'fit-content', margin: '0 auto' }}><img src={qr} alt="MFA QR code" width={180} height={180} /></div> : <p className="muted small">Preparing…</p>}
      {secret && <p className="small muted" style={{ textAlign: 'center' }}>Manual key: <span className="mono">{secret}</span></p>}
      <form onSubmit={verify}>
        <label htmlFor="code">6-digit code</label>
        <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
        <Err msg={err} />
        <div className="pillrow" style={{ marginTop: '.6rem' }}><button className="btn primary" disabled={!factorId}>Verify &amp; continue</button><button type="button" className="btn" onClick={() => signOut()}>Sign out</button></div>
      </form>
    </Frame>
  );
}

export function MfaVerifyScreen() {
  const { recheckMfa, signOut } = useAuth();
  const [code, setCode] = useState(''); const [err, setErr] = useState('');
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const { data: f } = await supabase.auth.mfa.listFactors();
    const factor = f?.totp?.[0];
    if (!factor) return setErr('No authenticator is registered for this account.');
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    if (error) return setErr('That code was not accepted.');
    await recheckMfa();
  }
  return (
    <Frame>
      <h3>Multi-factor verification</h3>
      <form onSubmit={verify}>
        <label htmlFor="code2">Enter the 6-digit code from your authenticator app</label>
        <input id="code2" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
        <Err msg={err} />
        <div className="pillrow" style={{ marginTop: '.6rem' }}><button className="btn primary">Verify</button><button type="button" className="btn" onClick={() => signOut()}>Sign out</button></div>
      </form>
    </Frame>
  );
}
