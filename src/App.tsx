import { AuthProvider, useAuth } from './lib/auth';
import { BrandingProvider } from './lib/branding';
import { DataProvider } from './lib/data';
import { configError } from './lib/supabase';
import { ModalProvider } from './components/ui';
import { LoginScreen, MfaEnrollScreen, MfaVerifyScreen, PendingScreen, RecoveryScreen } from './components/AuthScreens';
import { Shell } from './components/Shell';

function Gate() {
  const { gate } = useAuth();
  if (configError) return <div className="notice warn" style={{ margin: '2rem' }}>{configError}</div>;
  switch (gate) {
    case 'loading': return <section id="login"><p className="muted">Connecting to secure backend…</p></section>;
    case 'signed-out': return <LoginScreen />;
    case 'recovery': return <RecoveryScreen />;
    case 'pending': return <PendingScreen />;
    case 'mfa-enroll': return <MfaEnrollScreen />;
    case 'mfa-verify': return <MfaVerifyScreen />;
    case 'ready': return <DataProvider><Shell /></DataProvider>;
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
