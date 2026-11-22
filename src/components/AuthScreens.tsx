import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useBranding } from '../lib/branding';
import { Logo } from './ui';
import { errMsg } from '../lib/util';
import { audit } from '../lib/supabase';
import { PasswordInput } from './PasswordInput';
import { passwordStrength } from '../lib/password';
import { passkeysSupported, signInWithPasskey, friendlyError, isNativeShell } from '../lib/passkey';
import { NativeBrowserSignIn } from '../native/NativeBrowserSignIn';

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
  const [pkOk] = useState(passkeysSupported());
  const native = isNativeShell();

  async function passkey() {
    setErr(''); setOk(''); setBusy(true);
    try { await signInWithPasskey(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  }

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
        if (!passwordStrength(pw, [email, name]).acceptable) throw new Error('Choose a stronger password — see the guidance under the password field.');
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: pw, options: { data: { full_name: name.trim() }, emailRedirectTo: window.location.origin } });
        if (error) throw error;
        setOk(data.session ? 'Account created.' : 'Check your email to confirm your address. An administrator must then approve your access.');
        setMode('signin'); setPw('');
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
      {mode === 'signin' && pkOk && <>
        <button type="button" className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={passkey} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="8" r="4" /><path d="M2 21v-1a6 6 0 0 1 9.5-4.9" /><circle cx="18" cy="15" r="2.5" /><path d="M18 17.5V22M18 20h2" /></svg>
          Sign in with a passkey
        </button>
        <p className="small muted" style={{ textAlign: 'center', margin: '.4rem 0' }}>Face ID, Touch ID, Windows Hello, fingerprint or a security key — no password needed.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', margin: '.5rem 0' }}><hr style={{ flex: 1, borderColor: 'var(--line)' }} /><span className="small muted">or use your password</span><hr style={{ flex: 1, borderColor: 'var(--line)' }} /></div>
      </>}
      {mode === 'signin' && native && <><NativeBrowserSignIn onError={setErr} /><div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', margin: '.5rem 0' }}><hr style={{ flex: 1, borderColor: 'var(--line)' }} /><span className="small muted">or use your password</span><hr style={{ flex: 1, borderColor: 'var(--line)' }} /></div></>}
      <form onSubmit={submit}>
        {mode === 'register' && <><label htmlFor="nm">Full name</label><input id="nm" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" /></>}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete={mode === 'signin' ? 'username webauthn' : 'username'} />
        {mode !== 'forgot' && <PasswordInput id="pw" label="Password" value={pw} onChange={setPw} required autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          showStrength={mode === 'register'} personal={[email.split('@')[0], ...name.split(/\s+/)]} />}
        <Err msg={err} /><Ok msg={ok} />
        <button className={'btn ' + (mode === 'signin' && pkOk ? '' : 'primary')} style={{ width: '100%', justifyContent: 'center', marginTop: '.6rem' }} disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in with password' : mode === 'register' ? 'Submit access request' : 'Send reset link'}
        </button>
      </form>
      <div className="pillrow" style={{ marginTop: '.8rem', justifyContent: 'space-between' }}>
        {mode !== 'signin' && <button className="btn small" onClick={() => { setMode('signin'); setErr(''); }}>Back to sign in</button>}
        {mode === 'signin' && <button className="btn small" onClick={() => { setMode('register'); setErr(''); setPw(''); }}>Request access</button>}
        {mode === 'signin' && <button className="btn small" onClick={() => { setMode('forgot'); setErr(''); }}>Forgot password?</button>}
      </div>
      <p className="small muted" style={{ marginTop: '.8rem' }}>
        New accounts stay inactive until an administrator approves them and assigns a role. Super Administrators must use an authenticator app (MFA).
        Add a passkey under <strong>My Account Security</strong> after signing in. Sessions end after 30 minutes of inactivity.
      </p>
    </Frame>
  );
}

/** Plain-language messages for Supabase password-update errors. */
export function passwordUpdateError(e: { message: string; code?: string }): string {
  const m = e.message || '';
  if (e.code === 'current_password_invalid' || e.code === 'current_password_mismatch') return 'The current password is incorrect.';
  if (e.code === 'current_password_required') return 'Enter your current password to confirm the change.';
  if (e.code === 'same_password' || /same|different/i.test(m)) return 'The new password must be different from the old one.';
  if (/weak|pwned|leaked/i.test(m)) return 'This password appears in known data breaches or is too weak — choose another.';
  return m;
}

function NewPasswordForm({ title, intro, onSaved, personal, currentLabel }: { title: string; intro: ReactNode; onSaved: () => Promise<void>; personal: string[]; currentLabel?: string }) {
  const { signOut } = useAuth();
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!passwordStrength(pw, personal).acceptable) return setErr('Choose a stronger password — see the guidance under the field.');
    if (pw !== pw2) return setErr('The passwords do not match.');
    if (currentLabel && !cur) return setErr('Enter your ' + currentLabel.toLowerCase() + '.');
    setBusy(true);
    try {
      // The project requires the current password for password changes (Supabase "secure password change").
      const { error } = await supabase.auth.updateUser(currentLabel ? { password: pw, current_password: cur } : { password: pw });
      if (error) throw new Error(passwordUpdateError(error));
      await onSaved();
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  }
  return (
    <Frame>
      <h3>{title}</h3>
      {intro}
      <form onSubmit={save}>
        {currentLabel && <PasswordInput id="curpw" label={currentLabel} value={cur} onChange={setCur} autoComplete="current-password" required />}
        <PasswordInput id="np" label="New password" value={pw} onChange={setPw} autoComplete="new-password" showStrength personal={personal} required />
        <PasswordInput id="np2" label="Confirm new password" value={pw2} onChange={setPw2} autoComplete="new-password" required />
        {pw2 && pw !== pw2 && <p className="small" style={{ color: '#FF8A84' }}>Passwords do not match yet.</p>}
        <Err msg={err} />
        <div className="pillrow" style={{ marginTop: '.6rem' }}><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button><button type="button" className="btn" onClick={() => signOut()}>Sign out</button></div>
      </form>
    </Frame>
  );
}

export function RecoveryScreen() {
  const { refreshProfile, session } = useAuth();
  return <NewPasswordForm title="Choose a new password" intro={null} personal={[session?.user.email?.split('@')[0] || '']} onSaved={refreshProfile} />;
}

/** After a Super Administrator reset: the temporary password must be replaced before anything else (DB-verified). */
export function ForcedPasswordChangeScreen() {
  const { refreshProfile, profile } = useAuth();
  return <NewPasswordForm title="Set a new password" currentLabel="Temporary password (from your administrator)"
    intro={<div className="notice warn" style={{ marginBottom: '.6rem' }}><strong>Your password was reset by a Super Administrator.</strong> For your security, replace the temporary password now. Next you will be asked to set up your authenticator app again. All other sessions have been signed out.</div>}
    personal={[profile?.email.split('@')[0] || '', ...(profile?.full_name || '').split(/\s+/)]}
    onSaved={async () => { const { error } = await supabase.rpc('complete_password_change'); if (error) throw error; await audit('Password changed after administrator reset', null, 'auth').catch(() => {}); await refreshProfile(); }} />;
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

export function MfaEnrollScreen({ reenroll = false }: { reenroll?: boolean }) {
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
    if (reenroll) {
      const { error: e3 } = await supabase.rpc('complete_mfa_reenrolment');
      if (e3) return setErr(e3.message);
    } else await audit('MFA (TOTP) enrolled', null, 'auth');
    await recheckMfa();
  }
  return (
    <Frame>
      <h3>{reenroll ? 'Re-enrol your authenticator' : 'Set up multi-factor authentication'}</h3>
      {reenroll
        ? <div className="notice warn" style={{ marginBottom: '.6rem' }}><strong>Your previous authenticator was revoked when your password was reset.</strong> Scan this new code with your authenticator app (remove the old “Eagle Eye 360” entry first), then enter the 6-digit code. You cannot access the system until this is done.</div>
        : <p className="small">Super Administrator accounts must use an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…). Scan the code, then enter the 6-digit code it shows.</p>}
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
