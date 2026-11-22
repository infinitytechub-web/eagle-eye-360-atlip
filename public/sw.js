/* Eagle Eye 360 — service worker: app-shell caching only. API/auth traffic to Supabase is never cached. */
const CACHE = 'ee360-shell-v3';
const MODELS = 'ee360-models-v1'; // AI model + runtime: cached on first use for offline detection
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.png', '/icon-192.png', '/logo-256.jpg'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== MODELS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  if (url.pathname.startsWith('/models/') || url.pathname.endsWith('.wasm')) {
    const fresh = url.pathname.endsWith('.json'); // manifest: network first so metrics stay current
    e.respondWith(caches.open(MODELS).then(async (c) => {
      if (fresh) { try { const r = await fetch(e.request); c.put(e.request, r.clone()); return r; } catch { return (await c.match(e.request)) || Response.error(); } }
      const hit = await c.match(e.request); if (hit) return hit;
      const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r;
    }));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res;
    })));
  }
});
