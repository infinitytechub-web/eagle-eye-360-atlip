import { AuthProvider, useAuth } from './lib/auth';
import { BrandingProvider } from './lib/branding';
import { DataProvider } from './lib/data';
import { configError } from './lib/supabase';
import { ModalProvider } from './components/ui';
import { ForcedPasswordChangeScreen, LoginScreen, MfaEnrollScreen, MfaVerifyScreen, PendingScreen, RecoveryScreen } from './components/AuthScreens';
import { Shell } from './components/Shell';
import { NativeHandoffScreen, captureHandoffRequest, pendingHandoff } from './native/NativeHandoffScreen';

captureHandoffRequest();

function ReadyGate() {
  const { profile, signOut } = useAuth();
  if (profile?.role === 'gateway') return (
    <section id="login"><div className="card" style={{ maxWidth: 460 }}><h3>Service account</h3>
      <p className="muted">This is a CCTV gateway machine account. It is used by the gateway service only and cannot use the web application.</p>
      <button className="btn" onClick={() => signOut()}>Sign out</button></div></section>);
  const handoff = pendingHandoff();
  if (handoff) return <NativeHandoffScreen cc={handoff} />;
  return <DataProvider><Shell /></DataProvider>;
}

function Gate() {
  const { gate } = useAuth();
  if (configError) return <div className="notice warn" style={{ margin: '2rem' }}>{configError}</div>;
  switch (gate) {
    case 'loading': return <section id="login"><p className="muted">Connecting to secure backend…</p></section>;
    case 'signed-out': return <LoginScreen />;
    case 'recovery': return <RecoveryScreen />;
    case 'pending': return <PendingScreen />;
    case 'password-change': return <ForcedPasswordChangeScreen />;
    case 'mfa-reenroll': return <MfaEnrollScreen reenroll />;
    case 'mfa-enroll': return <MfaEnrollScreen />;
    case 'mfa-verify': return <MfaVerifyScreen />;
    case 'ready': return <ReadyGate />;
  }
}

export default function App() {
  return (
    <BrandingProvider>
      <AuthProvider>
        <ModalProvider><Gate /></ModalProvider>
      </AuthProvider>
    </BrandingProvider>
  );
}
