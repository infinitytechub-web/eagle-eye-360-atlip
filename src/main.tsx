import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isCapacitorApp } from './lib/passkey';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

if (isCapacitorApp()) {
  // The app bundle is already on the device, so no service worker; set up the native chrome instead.
  import('./native/bootstrap').then((m) => m.nativeBootstrap()).catch(() => {});
} else if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
