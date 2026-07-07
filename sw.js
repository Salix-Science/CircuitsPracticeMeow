// sw.js — Service Worker for CircuitsPractice
// Caches Pyodide v0.26.4 + sympy so repeat loads are near-instant.
//
// DEPLOY: place this file at the repo ROOT (same level as index.html).
// GitHub Pages will serve it at https://circuitspractice.org/sw.js
// which gives it scope over the entire origin.

const CACHE_NAME = 'pyodide-v0.26.4-sympy-v1';

// All Pyodide core assets for v0.26.4
const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

// These are the files Pyodide always fetches on loadPyodide() + loadPackage('sympy').
// If you ever upgrade Pyodide, bump CACHE_NAME and update this list.
const PRECACHE_URLS = [
  `${PYODIDE_BASE}pyodide.js`,
  `${PYODIDE_BASE}pyodide.asm.wasm`,
  `${PYODIDE_BASE}pyodide.asm.js`,
  `${PYODIDE_BASE}pyodide-lock.json`,
  `${PYODIDE_BASE}python_stdlib.zip`,
  // sympy and its deps (fetched by loadPackage)
  `${PYODIDE_BASE}sympy-1.13.3-py3-none-any.whl`,
  `${PYODIDE_BASE}mpmath-1.3.0-py3-none-any.whl`,
];

// ── Install: pre-cache the known assets ──────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing, pre-caching Pyodide assets…');
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Fetch each URL individually so one failure doesn't abort the whole set.
      const results = await Promise.allSettled(
        PRECACHE_URLS.map(url =>
          fetch(url, { credentials: 'omit' })
            .then(res => {
              if (!res.ok) throw new Error(`${res.status} ${url}`);
              return cache.put(url, res);
            })
            .catch(err => console.warn('[SW] Pre-cache miss:', err.message))
        )
      );
      const ok  = results.filter(r => r.status === 'fulfilled').length;
      const bad = results.filter(r => r.status === 'rejected').length;
      console.log(`[SW] Pre-cache done: ${ok} cached, ${bad} failed`);
    })
  );
  // Activate immediately without waiting for old tabs to close
  self.skipWaiting();
});

// ── Activate: delete old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating…');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first for Pyodide CDN, network-first for everything else ────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Only intercept Pyodide CDN requests
  if (url.startsWith(PYODIDE_BASE)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) {
          console.log('[SW] Cache hit:', url.split('/').pop());
          return cached;
        }
        // Not in cache yet — fetch, store, and return
        console.log('[SW] Cache miss, fetching:', url.split('/').pop());
        try {
          const res = await fetch(event.request, { credentials: 'omit' });
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        } catch (err) {
          console.error('[SW] Fetch failed:', err);
          throw err;
        }
      })
    );
    return;
  }

  // All other requests: network-first (default browser behavior)
  // Don't intercept — let them fall through normally
});
