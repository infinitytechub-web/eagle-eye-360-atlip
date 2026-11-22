import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, audit } from './supabase';
import type { Profile } from './types';

type Gate = 'loading' | 'signed-out' | 'recovery' | 'pending' | 'password-change' | 'mfa-reenroll' | 'mfa-enroll' | 'mfa-verify' | 'ready';
interface AuthCtx {
  session: Session | null; profile: Profile | null; gate: Gate;
  refreshProfile: () => Promise<void>; recheckMfa: () => Promise<void>; signOut: (reason?: string) => Promise<void>;
  signOutReason: string | null;
}
const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

const IDLE_LIMIT_MS = 30 * 60 * 1000; // session expires after 30 minutes of inactivity

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [gate, setGate] = useState<Gate>('loading');
  const [signOutReason, setReason] = useState<string | null>(null);

  const evaluate = useCallback(async (s: Session | null, recovery = false) => {
    setSession(s);
    if (!s) { setProfile(null); setGate('signed-out'); return; }
    if (recovery) { setGate('recovery'); return; }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', s.user.id).single();
    setProfile((p as Profile) || null);
    if (!p || !p.active) { setGate('pending'); return; }
    // After a Super Administrator password reset: first a new password, then a new authenticator (enforced by the DB too)
    if (p.password_change_required) { setGate('password-change'); return; }
    if (p.mfa_reenroll_required) {
      const { data: aal0 } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal0?.currentLevel === 'aal2') {
        const { error } = await supabase.rpc('complete_mfa_reenrolment');
        if (!error) { const { data: p2 } = await supabase.from('profiles').select('*').eq('id', s.user.id).single(); setProfile(p2 as Profile); }
        else { setGate('mfa-reenroll'); return; }
      } else { setGate('mfa-reenroll'); return; }
    }
    // MFA: verified TOTP factors raise the session to AAL2. Super Administrators must use MFA.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') { setGate('mfa-verify'); return; }
    if (p.role === 'super_admin' && aal?.currentLevel !== 'aal2') { setGate('mfa-enroll'); return; }
    setGate('ready');
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => evaluate(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') evaluate(s, true);
      else if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'MFA_CHALLENGE_VERIFIED') setTimeout(() => evaluate(s), 0);
      else if (event === 'TOKEN_REFRESHED') setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [evaluate]);

  const signOut = useCallback(async (reason?: string) => {
    try { if (gate === 'ready') await audit('Signed out' + (reason ? ` (${reason})` : ''), null, 'auth'); } catch { /* ignore */ }
    setReason(reason || null);
    await supabase.auth.signOut();
  }, [gate]);

  // Inactivity timeout
  useEffect(() => {
    if (gate !== 'ready') return;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => { if (Date.now() - last > IDLE_LIMIT_MS) signOut('session expired after 30 min inactivity'); }, 30000);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); clearInterval(t); };
  }, [gate, signOut]);

  // Server heartbeat for "last seen" (live presence uses Realtime)
  useEffect(() => {
    if (gate !== 'ready') return;
    supabase.rpc('heartbeat');
    const t = setInterval(() => supabase.rpc('heartbeat'), 60000);
    return () => clearInterval(t);
  }, [gate]);

  const refreshProfile = useCallback(async () => { const { data } = await supabase.auth.getSession(); await evaluate(data.session); }, [evaluate]);

  return (
    <Ctx.Provider value={{ session, profile, gate, refreshProfile, recheckMfa: refreshProfile, signOut, signOutReason }}>
      {children}
    </Ctx.Provider>
  );
}
