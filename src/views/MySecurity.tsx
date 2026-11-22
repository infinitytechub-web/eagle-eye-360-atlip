import { passwordUpdateError } from '../components/AuthScreens';
import { useEffect, useState } from 'react';
import { supabase, audit } from '../lib/supabase';
import { useLive, must } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { fmtT, relMin } from '../lib/util';
import { passkeysSupported, registerPasskey, friendlyError, hasPlatformAuthenticator, isNativeShell } from '../lib/passkey';
import { passwordStrength } from '../lib/password';
import { PasswordInput } from '../components/PasswordInput';
import { useModal } from '../components/ui';

interface Passkey { id: string; name: string; device_type: string | null; backed_up: boolean; transports: string[]; created_at: string; last_used_at: string | null }
interface Factor { id: string; friendly_name?: string; factor_type: string; status: string; created_at: string }

function guessDeviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${os}${br ? ' · ' + br : ''}`;
}

export default function MySecurity() {
  const { profile, recheckMfa } = useAuth();
  const modal = useModal();
  const me = profile!;
  const { data: keys, reload } = useLive(async () => must(await supabase.from('user_passkeys').select('id, name, device_type, backed_up, transports, created_at, last_used_at').eq('user_id', me.id).order('created_at')) as Passkey[], [], [me.id]);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [platform, setPlatform] = useState<boolean | null>(null);
  const [pkName, setPkName] = useState(guessDeviceName()); const [pkMsg, setPkMsg] = useState(''); const [pkErr, setPkErr] = useState(''); const [busy, setBusy] = useState(false);
  const supported = passkeysSupported();

  useEffect(() => { hasPlatformAuthenticator().then(setPlatform); supabase.auth.mfa.listFactors().then(({ data }) => setFactors((data?.all || []) as Factor[])); }, []);

  async function addPasskey() {
    setPkErr(''); setPkMsg(''); setBusy(true);
    try { await registerPasskey(pkName.trim() || 'Passkey'); setPkMsg('Passkey added. You can now sign in with it from this device.'); reload(); }
    catch (e) { setPkErr(friendlyError(e)); } finally { setBusy(false); }
  }
  async function rename(k: Passkey) {
    const name = prompt('Rename passkey', k.name)?.trim(); if (!name) return;
    await supabase.from('user_passkeys').update({ name: name.slice(0, 60) }).eq('id', k.id); reload();
  }
  function remove(k: Passkey) {
    modal({ title: 'Remove passkey', ok: 'Remove', body: `Remove “${k.name}”? It will no longer work for signing in. Also delete it from the device's password manager to avoid confusion.`, cb: async () => {
      const { error } = await supabase.from('user_passkeys').delete().eq('id', k.id);
      if (error) setPkErr(error.message); else { await audit('Passkey removed', k.name, 'auth'); reload(); }
    } });
  }

  // change password
  const [cur, setCur] = useState(''); const [np, setNp] = useState(''); const [np2, setNp2] = useState(''); const [pwMsg, setPwMsg] = useState(''); const [pwErr, setPwErr] = useState('');
  async function changePassword() {
    setPwErr(''); setPwMsg('');
    if (!passwordStrength(np, [me.email.split('@')[0], ...me.full_name.split(/\s+/)]).acceptable) return setPwErr('Choose a stronger password — see the guidance under the field.');
    if (np !== np2) return setPwErr('The new passwords do not match.');
    if (!cur) return setPwErr('Enter your current password.');
    // The server verifies the current password (secure password change) without replacing the
    // MFA-verified session — a fresh sign-in here would drop a Super Administrator to AAL1.
    const { error } = await supabase.auth.updateUser({ password: np, current_password: cur });
    if (error) return setPwErr(passwordUpdateError(error));
    await audit('Password changed by user', null, 'auth'); setCur(''); setNp(''); setNp2(''); setPwMsg('Password changed.');
    recheckMfa();
  }

  const totp = factors.filter((f) => f.factor_type === 'totp' && f.status === 'verified');
  return (
    <>
      <div className="grid g2">
        <div className="card"><h3>Passkeys</h3>
          <p className="small muted">Passkeys replace passwords with Face ID, Touch ID, Windows Hello, Android fingerprint or a hardware security key. They are phishing-resistant: they only work on the official ATLIP site and the private key never leaves your device.</p>
          {(keys || []).length ? <div className="tablewrap"><table><thead><tr><th>Passkey</th><th>Added</th><th>Last used</th><th></th></tr></thead><tbody>
            {keys!.map((k) => <tr key={k.id}><td><strong>{k.name}</strong><br /><span className="small muted">{k.backed_up ? 'Synced passkey' : 'Device-bound'}{k.transports.length ? ' · ' + k.transports.join(', ') : ''}</span></td>
              <td className="small">{fmtT(k.created_at)}</td><td className="small">{k.last_used_at ? relMin(k.last_used_at) : 'never'}</td>
              <td><div className="pillrow"><button className="btn small" onClick={() => rename(k)}>Rename</button><button className="btn small danger" onClick={() => remove(k)}>Remove</button></div></td></tr>)}
          </tbody></table></div> : <p className="muted small">No passkeys yet.</p>}
          {supported ? <>
            <label htmlFor="pkname">Name for this passkey</label>
            <input id="pkname" value={pkName} onChange={(e) => setPkName(e.target.value)} maxLength={60} />
            <button className="btn primary" style={{ marginTop: '.6rem' }} onClick={addPasskey} disabled={busy}>{busy ? 'Waiting for your device…' : '+ Add a passkey'}</button>
            {platform === false && <p className="small muted">No built-in authenticator detected — you can still use a phone (QR code) or a USB/NFC security key.</p>}
          </> : <p className="small notice warn">{isNativeShell() ? 'In the installed app, passkeys are used through the secure browser sign-in. Add passkeys from the website (atlip.infinitytechub.com) in a browser on this device.' : 'This browser does not support passkeys (or the page is not on the official HTTPS site).'}</p>}
          {pkMsg && <p className="small" style={{ color: 'var(--lime)' }}>{pkMsg}</p>}{pkErr && <p className="small" style={{ color: '#FF8A84' }}>{pkErr}</p>}
        </div>

        <div className="card"><h3>Change password</h3>
          <PasswordInput id="curpw" label="Current password" value={cur} onChange={setCur} autoComplete="current-password" />
          <PasswordInput id="newpw" label="New password" value={np} onChange={setNp} autoComplete="new-password" showStrength personal={[me.email.split('@')[0], ...me.full_name.split(/\s+/)]} />
          <PasswordInput id="newpw2" label="Confirm new password" value={np2} onChange={setNp2} autoComplete="new-password" />
          {np2 && np !== np2 && <p className="small" style={{ color: '#FF8A84' }}>Passwords do not match yet.</p>}
          <button className="btn primary" style={{ marginTop: '.6rem' }} onClick={changePassword} disabled={!cur || !np}>Change password</button>
          {pwMsg && <p className="small" style={{ color: 'var(--lime)' }}>{pwMsg}</p>}{pwErr && <p className="small" style={{ color: '#FF8A84' }}>{pwErr}</p>}

          <h3 style={{ marginTop: '1.2rem' }}>Authenticator app (MFA)</h3>
          {totp.length ? <p className="small"><span className="chip g">Enabled</span> {totp.length} authenticator{totp.length > 1 ? 's' : ''} · added {fmtT(totp[0].created_at)}</p>
            : <p className="small"><span className="chip grey">Not set up</span> {me.role === 'super_admin' ? 'Required for your role.' : 'Optional for your role.'}</p>}
          <p className="small muted">If a Super Administrator resets your password, your authenticator and passkeys are revoked and you must set them up again at your next sign-in.</p>
        </div>
      </div>
    </>
  );
}
