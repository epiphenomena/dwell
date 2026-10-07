// Offline support: precache the app shell and the full text. Text is served
// cache-first (it never changes); app files are stale-while-revalidate, so
// an update shows on the next launch. Bump VERSION when the file list changes.
// Public Bible versions are precached; licensed ones (an owner account
// only) are cached as the app fetches them with its token, and removed by
// the app on sign-out. The list comes from js/versions.js (a change there
// also updates this worker). API calls are never cached.
importScripts('js/versions.js');
const VERSION = 'dwell-v21';

const SHELL = [
  './', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'css/tokens.css', 'css/base.css',
  ...['topbar', 'reader', 'locator', 'dock', 'actionbar', 'sheet', 'list', 'navigator', 'heatmap', 'notes', 'search', 'toast']
    .map(c => `css/components/${c}.css`),
  'js/account.js', 'js/app.js', 'js/canon.js', 'js/canon-data.js', 'js/db.js', 'js/dom.js', 'js/heat.js',
  'js/history.js', 'js/reader.js', 'js/sheet.js', 'js/store.js', 'js/sync.js', 'js/text.js', 'js/versions.js',
  ...['actionbar', 'dock', 'history-view', 'info', 'locator', 'menu', 'navigator', 'notes', 'passage', 'search', 'tags']
    .map(c => `js/components/${c}.js`),
];
const TEXT = self.DWELL_VERSIONS.filter(v => v.public).map(v => `text/${v.id}`);

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    await cache.addAll(TEXT);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const refresh = () => fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    if (hit) {
      if (!url.pathname.includes('/text/')) e.waitUntil(refresh().catch(() => {}));
      return hit;
    }
    try {
      return await refresh();
    } catch (err) {
      if (req.mode === 'navigate') return cache.match('./');
      throw err;
    }
  })());
});
