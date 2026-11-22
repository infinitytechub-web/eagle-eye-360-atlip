// Minimal, audited bridge exposed to the ATLIP page as window.atlipDesktop (sandboxed preload, contextIsolation).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atlipDesktop', {
  platform: process.platform,
  version: process.versions.electron ? 'desktop' : 'unknown',
  /** Opens the passkey sign-in page in the system browser (the main process only accepts that one URL shape). */
  openExternal: (url) => ipcRenderer.invoke('atlip:open-external', String(url)),
  /** Subscribe to sign-in callbacks (gh.infinitytechub.atlip://auth?code=…); returns an unsubscribe function. */
  onAuthCallback: (cb) => {
    const h = (_e, url) => { if (typeof url === 'string') cb(url); };
    ipcRenderer.on('atlip:auth-callback', h);
    return () => ipcRenderer.removeListener('atlip:auth-callback', h);
  },
  retry: () => ipcRenderer.send('atlip:retry'),
});
