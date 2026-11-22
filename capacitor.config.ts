import type { CapacitorConfig } from '@capacitor/cli';

// Eagle Eye 360 · ATLIP — iOS & Android apps. The web build (dist/) is bundled into the app; it talks to the same
// Supabase backend over HTTPS. Sign-in with passkeys happens in the system browser (see src/native/).
const config: CapacitorConfig = {
  appId: 'gh.infinitytechub.atlip',
  appName: 'Eagle Eye 360 ATLIP',
  webDir: 'dist',
  server: { androidScheme: 'https' },          // origin https://localhost (secure context for camera & location)
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  ios: { contentInset: 'automatic', limitsNavigationsToAppBoundDomains: false },
  plugins: {
    SplashScreen: { launchShowDuration: 1500, launchAutoHide: false, backgroundColor: '#000000', showSpinner: false },
    StatusBar: { style: 'DARK', backgroundColor: '#0A2342', overlaysWebView: false },
  },
};
export default config;
