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
const CACHE_VERSION = 'v2';

/** Cache for the application shell (HTML, CSS, JS, manifest, icons). */
const SHELL_CACHE = `aeon-shell-${CACHE_VERSION}`;

/** Cache for article data files (articles.json and article-*.json). */
const DATA_CACHE = `aeon-data-${CACHE_VERSION}`;

/** Cache for images and Google Fonts. */
const MEDIA_CACHE = `aeon-media-${CACHE_VERSION}`;

/** All cache names — used during activation to delete old versions. */
const ALL_CACHES = [SHELL_CACHE, DATA_CACHE, MEDIA_CACHE];

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

  // ---- Article cover images (Aeon CDN) — Cache-on-demand ----
  if (url.hostname === 'images.aeon.co' ||
      url.hostname === 'd2e1bqvws99ptg.cloudfront.net' ||
      (url.hostname === 'aeon.co' && url.pathname.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i))) {
    event.respondWith(cacheFirst(request, MEDIA_CACHE));
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
    return cachedResponse;
  }
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      // Clone before caching — a Response can only be consumed once
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
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
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
