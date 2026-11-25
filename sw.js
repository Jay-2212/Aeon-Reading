/**
 * @fileoverview Aeon Reader — sw.js (Service Worker)
 * =====================================================
 * Phase 8: Service Worker & Progressive Web App Support
 *
 * This Service Worker provides offline support and caching for the Aeon Reader.
 * It is registered by `js/app.js` without an explicit scope, so its default
 * scope covers the entire app origin path (the SW file is at the repo root).
 *
 * Cache strategies per resource type (see ENGINEERING_PLAN.md §12.1):
 *
 * | Resource                | Strategy                              |
 * |-------------------------|---------------------------------------|
 * | index.html / HTML pages | Network-first (always serve fresh)    |
 * | styles/*.css, js/*.js   | Cache-first (immutable-ish assets)    |
 * | data/articles.json      | Network-first; serve cache if offline |
 * | data/article-*.json     | Cache-first; add on first read        |
 * | Article cover images    | Cache-on-demand (cache when viewed)   |
 * | Google Fonts            | Cache-first                           |
 * | manifest.webmanifest    | Network-first                         |
 *
 * Cache names are versioned so that updating the SW version causes old caches
 * to be deleted during the `activate` event.
 *
 * @module sw
 */

'use strict';

// ---------------------------------------------------------------------------
// Cache Configuration
// ---------------------------------------------------------------------------

/**
 * Current cache version — increment this whenever the SW logic or
 * PRECACHE_URLS change to ensure clients receive the updated assets.
 */
const CACHE_VERSION = 'v4';

/** Cache for the application shell (HTML, CSS, JS, manifest, icons). */
const SHELL_CACHE = `aeon-shell-${CACHE_VERSION}`;

/** Cache for article data files (articles.json and article-*.json). */
const DATA_CACHE = `aeon-data-${CACHE_VERSION}`;

/** Cache for Google Fonts. */
const MEDIA_CACHE = `aeon-media-${CACHE_VERSION}`;

/**
 * Cache for article images (Aeon CDN). Entries are capped and pruned so the
 * cache cannot grow unbounded on the user's device — see pruneImageCache().
 */
const IMAGE_CACHE = `aeon-images-${CACHE_VERSION}`;

/** Maximum number of images kept in the image cache (LRU eviction). */
const IMAGE_CACHE_MAX_ENTRIES = 40;

/** All cache names — used during activation to delete old versions. */
const ALL_CACHES = [SHELL_CACHE, DATA_CACHE, MEDIA_CACHE, IMAGE_CACHE];

/**
 * Resources to pre-cache during the `install` event (app shell).
 * These are the minimum files needed to render the UI offline.
 */
const PRECACHE_URLS = [
  './',
  './index.html',
  './styles/main.css',
  './styles/reader.css',
  './js/app.js',
  './js/feed.js',
  './js/reader.js',
  './js/settings.js',
  './js/api.js',
  './manifest.webmanifest',
  './assets/placeholder.svg',
  './data/articles.json',
];

// ---------------------------------------------------------------------------
// Install Event — Pre-cache App Shell
// ---------------------------------------------------------------------------

/**
 * The `install` event fires when the Service Worker is first installed.
 * We pre-cache the app shell so the app can load offline immediately.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      // Pre-cache app shell resources; ignore individual failures
      const results = await Promise.allSettled(
        PRECACHE_URLS.map(url => cache.add(url).catch(err => {
          console.warn(`[SW] Pre-cache failed for ${url}:`, err.message);
        }))
      );
      console.info('[SW] Install complete. Pre-cached app shell.');
      return results;
    })
  );
  // Take over immediately without waiting for existing SW to finish
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate Event — Clean Up Old Caches
// ---------------------------------------------------------------------------

/**
 * The `activate` event fires after installation, once the old SW has been replaced.
 * We delete any caches whose names are not in ALL_CACHES (i.e., old versions).
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (cacheNames) => {
      const deletions = cacheNames
        .filter(name => !ALL_CACHES.includes(name))
        .map(name => {
          console.info(`[SW] Deleting old cache: ${name}`);
          return caches.delete(name);
        });
      await Promise.all(deletions);
      console.info('[SW] Activate complete. Old caches removed.');
      // Take control of all pages immediately
      return self.clients.claim();
    })
  );
});

// ---------------------------------------------------------------------------
// Fetch Event — Intercept Requests
// ---------------------------------------------------------------------------

/**
 * The `fetch` event intercepts every network request made by the app.
 * We apply the appropriate caching strategy based on the request URL.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // ---- Google Fonts — Cache-first ----
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, MEDIA_CACHE));
    return;
  }

  // ---- Article images (Aeon CDN) — Cache-on-demand with LRU pruning ----
  if (url.hostname === 'images.aeonmedia.co' ||
      url.hostname === 'images.aeon.co' ||
      url.hostname === 'd2e1bqvws99ptg.cloudfront.net' ||
      (url.hostname === 'aeon.co' && url.pathname.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i))) {
    event.respondWith(cacheImage(request));
    // Prune the image cache in the background so it stays within its cap
    event.waitUntil(pruneImageCache());
    return;
  }

  // Only handle same-origin requests beyond this point
  if (url.origin !== self.location.origin) return;

  // ---- articles.json — Network-first, fall back to cache ----
  if (url.pathname.endsWith('/data/articles.json')) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  // ---- Individual article files — Cache-first ----
  if (url.pathname.match(/\/data\/article-.+\.json$/)) {
    event.respondWith(cacheFirst(request, DATA_CACHE));
    return;
  }

  // ---- HTML pages and directory indexes — Network-first ----
  // Always fetch HTML fresh so the user gets updated script/style references.
  if (url.pathname.match(/\.html$/) || url.pathname === '/' || url.pathname.endsWith('/')) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  // ---- JS, CSS, manifest, icons, SVGs — Cache-first (immutable assets) ----
  if (url.pathname.match(/\.(css|js|webmanifest|svg|png|ico)$/)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // ---- Default: Network-first for everything else ----
  event.respondWith(networkFirst(request, SHELL_CACHE));
});

// ---------------------------------------------------------------------------
// Cache Strategy Implementations
// ---------------------------------------------------------------------------

/**
 * Cache-first strategy: try the cache first; fall back to network on miss.
 * Caches the network response for future use.
 *
 * Best for: immutable assets (CSS, JS, fonts, images, individual article JSON).
 *
 * @param {Request} request   - The incoming fetch request.
 * @param {string}  cacheName - The name of the cache to use.
 * @returns {Promise<Response>}
 */
async function cacheFirst(request, cacheName) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    console.debug('[SW] cacheFirst hit:', request.url);
    return cachedResponse;
  }
  console.debug('[SW] cacheFirst miss, fetching:', request.url);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.warn('[SW] Cache-first: network failed and no cache hit:', request.url);
    return new Response('Offline — resource not cached.', {
      status:  503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/**
 * Cache-first strategy for article images, with a timestamped entry so the
 * cache can be pruned LRU-style (see pruneImageCache). On network failure and
 * no cache hit, returns a 1x1 transparent GIF so <img> error handlers can
 * swap in the placeholder instead of a broken-image icon.
 *
 * @param {Request} request - The image request.
 * @returns {Promise<Response>}
 */
async function cacheImage(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(IMAGE_CACHE);
      // Clone with a timestamp header so pruning can order entries by age
      const body = await networkResponse.blob();
      const stamped = new Response(body, {
        status: networkResponse.status,
        statusText: networkResponse.statusText,
        headers: {
          ...Object.fromEntries(networkResponse.headers.entries()),
          'x-sw-cached-at': String(Date.now()),
        },
      });
      cache.put(request, stamped);
    }
    return networkResponse;
  } catch (err) {
    console.warn('[SW] Image fetch failed and not cached:', request.url);
    return new Response('', { status: 504, statusText: 'Image unavailable' });
  }
}

/**
 * Prune the image cache down to IMAGE_CACHE_MAX_ENTRIES, evicting the oldest
 * entries first (by the x-sw-cached-at header stamped in cacheImage).
 * Runs in the background after each image fetch so user storage stays bounded.
 *
 * @returns {Promise<void>}
 */
async function pruneImageCache() {
  try {
    const cache = await caches.open(IMAGE_CACHE);
    const requests = await cache.keys();
    if (requests.length <= IMAGE_CACHE_MAX_ENTRIES) return;
    const entries = await Promise.all(requests.map(async (req) => {
      const res = await cache.match(req);
      const ts = Number(res && res.headers.get('x-sw-cached-at')) || 0;
      return { req, ts };
    }));
    entries.sort((a, b) => a.ts - b.ts);
    const toDelete = entries.slice(0, entries.length - IMAGE_CACHE_MAX_ENTRIES);
    await Promise.all(toDelete.map(e => cache.delete(e.req)));
    if (toDelete.length) {
      console.info(`[SW] Pruned ${toDelete.length} old image(s) from cache.`);
    }
  } catch (err) {
    console.warn('[SW] Image cache pruning failed:', err.message);
  }
}

/**
 * Network-first strategy: try the network first; fall back to cache on failure.
 * Updates the cache with the fresh network response.
 *
 * Best for: frequently updated resources (articles.json, index.html).
 *
 * @param {Request} request   - The incoming fetch request.
 * @param {string}  cacheName - The name of the cache to use.
 * @returns {Promise<Response>}
 */
async function networkFirst(request, cacheName) {
  try {
    console.debug('[SW] networkFirst trying network:', request.url);
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      console.debug('[SW] networkFirst success:', request.url);
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.info('[SW] networkFirst failed, trying cache:', request.url);
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.info('[SW] Network-first: serving from cache (offline):', request.url);
      return cachedResponse;
    }
    // Neither network nor cache — return offline fallback for HTML requests
    if (request.headers.get('Accept') && request.headers.get('Accept').includes('text/html')) {
      const offlineFallback = await caches.match('./index.html');
      if (offlineFallback) return offlineFallback;
    }
    return new Response('Offline — resource not available.', {
      status:  503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
