// Eagle Eye 360 · ATLIP — desktop app (Electron). A hardened, origin-locked window onto https://atlip.infinitytechub.com.
// No Node.js in the page, sandboxed renderer, minimal preload bridge, permissions only for the ATLIP origin,
// and sign-in with passkeys through the system browser (PKCE hand-off via the gh.infinitytechub.atlip:// scheme).
'use strict';
const { app, BrowserWindow, session, shell, ipcMain, Menu, nativeTheme } = require('electron');
const path = require('node:path');
const sec = require('./security');

app.setAppUserModelId('gh.infinitytechub.atlip.desktop');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// Register the sign-in URL scheme (dev runs pass the script path so Windows/Linux can relaunch us).
if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(sec.SCHEME, process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient(sec.SCHEME);

let win = null;
let pendingCallback = sec.authCallbackFrom(process.argv); // cold start from a sign-in link (Windows/Linux)

function deliverCallback(url) {
  if (!url) return;
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    if (sec.isAppUrl(win.webContents.getURL())) win.webContents.send('atlip:auth-callback', url); else pendingCallback = url;
  } else pendingCallback = url;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 640,
    title: 'Eagle Eye 360 ATLIP', backgroundColor: '#07182E', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false,
      spellcheck: true, devTools: !app.isPackaged,
    },
  });
  win.once('ready-to-show', () => win.show());

  const wc = win.webContents;
  // Never leave the ATLIP origin inside the app; open other web links in the default browser.
  wc.on('will-navigate', (e, url) => {
    if (sec.isAppUrl(url) || url.startsWith('file://' + path.join(__dirname, 'offline.html'))) return;
    e.preventDefault(); if (sec.isSafeExternal(url)) shell.openExternal(url);
  });
  wc.on('will-redirect', (e, url) => { if (!sec.isAppUrl(url)) { e.preventDefault(); if (sec.isSafeExternal(url)) shell.openExternal(url); } });
  wc.setWindowOpenHandler(({ url }) => { if (sec.isSafeExternal(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-attach-webview', (e) => e.preventDefault());

  // Offline / server unreachable → local page with a retry button.
  wc.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 /* aborted */ && sec.isAppUrl(url)) win.loadFile(path.join(__dirname, 'offline.html'));
  });
  wc.on('did-finish-load', () => { if (pendingCallback && sec.isAppUrl(wc.getURL())) { const u = pendingCallback; pendingCallback = null; setTimeout(() => wc.send('atlip:auth-callback', u), 300); } });
  win.on('closed', () => { win = null; });
  win.loadURL(sec.APP_URL);
}

app.on('second-instance', (_e, argv) => deliverCallback(sec.authCallbackFrom(argv)));   // Windows / Linux
app.on('open-url', (e, url) => { e.preventDefault(); deliverCallback(sec.authCallbackFrom([url])); }); // macOS

// Every web contents, current or future: no new windows, no webviews.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => { if (sec.isSafeExternal(url)) shell.openExternal(url); return { action: 'deny' }; });
});

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, cb, details) => cb(sec.allowPermission(permission, details.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((wc, permission, origin) => sec.allowPermission(permission, origin || (wc && wc.getURL()) || ''));
  ses.setDevicePermissionHandler(() => false); // no USB/HID/serial access
  // The bridge: open the passkey hand-off page in the system browser — nothing else.
  ipcMain.handle('atlip:open-external', async (e, url) => {
    if (!sec.isAppUrl(e.senderFrame.url)) throw new Error('Not allowed');
    if (!sec.isHandoffUrl(url)) throw new Error('Only the ATLIP sign-in page can be opened');
    await shell.openExternal(url);
  });
  ipcMain.on('atlip:retry', (e) => { if (win && e.sender === win.webContents) win.loadURL(sec.APP_URL); });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [{ label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win && win.loadURL(sec.APP_URL) }, { type: 'separator' }, process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'Open ATLIP in browser', click: () => shell.openExternal(sec.APP_URL) }, { label: `Version ${app.getVersion()}`, enabled: false }] },
  ]));
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
