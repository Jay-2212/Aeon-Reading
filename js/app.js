/**
 * @fileoverview Aeon Reader — app.js
 * ===================================
 * Phase 3: Application Bootstrap and Hash Router
 *
 * This module is the entry point for the Aeon Reader SPA. It:
 *   1. Registers the Service Worker (Phase 8).
 *   2. Applies saved user preferences from localStorage on startup.
 *   3. Implements a hash-based router that maps URL hashes to views:
 *        `#/`               → feed view
 *        `#/article/<id>`   → reader view for the given article ID
 *   4. Listens for `popstate` events (browser back/forward) to navigate.
 *   5. Provides shared utilities used by other modules:
 *        - `showToast(message, type)`
 *        - `setOfflineStatus(isOffline)`
 *
 * @module app
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** localStorage key for the saved theme name. */
const LS_THEME = 'aeon_theme';

/** localStorage key for the saved font name. */
const LS_FONT = 'aeon_font';

/** localStorage key for the saved font-scale value (0.85–1.3). */
const LS_FONT_SCALE = 'aeon_font_scale';

/** localStorage key for the saved line-spacing value. */
const LS_LINE_SPACING = 'aeon_line_spacing';

/** localStorage key for the drop-cap toggle state (boolean string). */
const LS_DROP_CAP = 'aeon_drop_cap';

/** Default theme — used on first launch unless dark mode is preferred. */
const DEFAULT_THEME = 'sepia';

/** Default dark theme — used if prefers-color-scheme: dark and no saved preference. */
const DEFAULT_DARK_THEME = 'dark';

/** Default font family key. */
const DEFAULT_FONT = 'lora';

/** Default font scale. */
const DEFAULT_FONT_SCALE = 1.0;

/** Default line spacing value. */
const DEFAULT_LINE_SPACING = 1.75;

/** Toast display duration in milliseconds. */
const TOAST_DURATION_MS = 3500;

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const viewFeed   = document.getElementById('view-feed');
const viewReader = document.getElementById('view-reader');

// ---------------------------------------------------------------------------
// Preference Application (Phase 5)
// ---------------------------------------------------------------------------

/**
 * Detect the best default theme for the user on their first visit.
 * Returns 'dark' if the device prefers dark mode, otherwise 'sepia'.
 *
 * @returns {string} The theme name to use as the default.
 */
function detectDefaultTheme() {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return DEFAULT_DARK_THEME;
  }
  return DEFAULT_THEME;
}

/**
 * Apply all stored preferences (theme, font, font scale, line spacing, drop cap)
 * to the document at startup. If a preference has not been saved yet, the
 * default value is used and persisted to localStorage.
 */
function applyStoredPreferences() {
  // Theme
  const savedTheme = localStorage.getItem(LS_THEME) || detectDefaultTheme();
  applyTheme(savedTheme);

  // Font
  const savedFont = localStorage.getItem(LS_FONT) || DEFAULT_FONT;
  applyFont(savedFont);

  // Font scale
  const savedScale = parseFloat(localStorage.getItem(LS_FONT_SCALE)) || DEFAULT_FONT_SCALE;
  applyFontScale(savedScale);

  // Line spacing
  const savedSpacing = parseFloat(localStorage.getItem(LS_LINE_SPACING)) || DEFAULT_LINE_SPACING;
  applyLineSpacing(savedSpacing);
}

/**
 * Set the active theme by updating `data-theme` on `<html>` and persisting to localStorage.
 * Also updates the `<meta name="theme-color">` tag to match the theme background colour.
 *
 * @param {string} theme - One of 'light', 'sepia', 'dark', 'amoled'.
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(LS_THEME, theme);

  // Update the browser chrome colour (Android status bar)
  const themeColorMeta = document.getElementById('theme-color-meta');
  if (themeColorMeta) {
    const themeColors = {
      light:  '#FFFFFF',
      sepia:  '#F5ECD7',
      dark:   '#1C1C1E',
      amoled: '#000000',
    };
    themeColorMeta.content = themeColors[theme] || themeColors.sepia;
  }
}

/**
 * Set the body font by updating `data-font` on `<html>` and persisting to localStorage.
 *
 * @param {string} font - One of 'lora', 'merriweather', 'system', 'inter'.
 */
function applyFont(font) {
  document.documentElement.setAttribute('data-font', font);
  localStorage.setItem(LS_FONT, font);
}

/**
 * Set the font scale CSS custom property on `<html>` and persist to localStorage.
 *
 * @param {number} scale - Font scale value between 0.85 and 1.3.
 */
function applyFontScale(scale) {
  document.documentElement.style.setProperty('--font-scale', String(scale));
  localStorage.setItem(LS_FONT_SCALE, String(scale));
}

/**
 * Set the line-spacing CSS custom property on `<html>` and persist to localStorage.
 *
 * @param {number} spacing - Line height value (1.5 for compact, 1.75 for comfortable).
 */
function applyLineSpacing(spacing) {
  document.documentElement.style.setProperty('--line-spacing', String(spacing));
  localStorage.setItem(LS_LINE_SPACING, String(spacing));
}

// ---------------------------------------------------------------------------
// Hash Router (Phase 3)
// ---------------------------------------------------------------------------

/**
 * Parse the current `location.hash` and return a route descriptor object.
 *
 * @returns {{ view: string, articleId: string|null }} The parsed route.
 *   - `view` is either 'feed' or 'reader'.
 *   - `articleId` is the article slug, or null for the feed view.
 */
function parseHash() {
  const hash = location.hash || '#/';
  const match = hash.match(/^#\/article\/(.+)$/);
  if (match) {
    return { view: 'reader', articleId: match[1] };
  }
  return { view: 'feed', articleId: null };
}

/**
 * Navigate to the article reader view for the given article ID.
 * Pushes a new browser history entry so the back button works.
 *
 * @param {string} articleId - The article slug to navigate to.
 */
function navigateToArticle(articleId) {
  history.pushState({ articleId }, '', `#/article/${articleId}`);
  renderRoute({ view: 'reader', articleId });
}

/**
 * Navigate back to the feed view.
 * Pushes a new history entry (or goes back if history allows it).
 */
function navigateToFeed() {
  history.pushState(null, '', '#/');
  renderRoute({ view: 'feed', articleId: null });
}

/**
 * Show or hide the two views based on the current route.
 * Applies CSS animation classes for the slide transition.
 *
 * @param {{ view: string, articleId: string|null }} route - The parsed route.
 */
function renderRoute(route) {
  if (route.view === 'reader') {
    // Show reader, hide feed (with slide animations)
    viewFeed.removeAttribute('hidden');
    viewReader.removeAttribute('hidden');

    viewFeed.classList.add('view-feed--exit');
    viewReader.classList.add('view-reader--enter');

    // After animation, keep only the active view visible
    setTimeout(() => {
      viewFeed.setAttribute('hidden', '');
      viewFeed.classList.remove('view-feed--exit');
      viewReader.classList.remove('view-reader--enter');
    }, 300);

    // Instruct reader.js to load the article
    document.dispatchEvent(
      new CustomEvent('aeon:show-article', { detail: { articleId: route.articleId } })
    );
  } else {
    // Show feed, hide reader
    viewReader.removeAttribute('hidden');
    viewFeed.removeAttribute('hidden');

    viewReader.classList.add('view-reader--exit');
    viewFeed.classList.add('view-feed--enter');

    setTimeout(() => {
      viewReader.setAttribute('hidden', '');
      viewReader.classList.remove('view-reader--exit');
      viewFeed.classList.remove('view-feed--enter');
    }, 300);

    document.dispatchEvent(new CustomEvent('aeon:show-feed'));
  }
}

// ---------------------------------------------------------------------------
// Toast Notifications
// ---------------------------------------------------------------------------

/**
 * Show a temporary toast notification at the bottom of the screen.
 *
 * @param {string} message - The text to display in the toast.
 * @param {'info'|'error'} [type='info'] - Toast style variant.
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast' + (type === 'error' ? ' toast--error' : '');
  toast.textContent = message;
  container.appendChild(toast);

  // Auto-remove after TOAST_DURATION_MS
  setTimeout(() => {
    toast.classList.add('toast--exiting');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, TOAST_DURATION_MS);
}

// ---------------------------------------------------------------------------
// Online / Offline Status
// ---------------------------------------------------------------------------

/**
 * Update the offline indicator banner visibility.
 *
 * @param {boolean} isOffline - True if the device is currently offline.
 */
function setOfflineStatus(isOffline) {
  const indicator = document.getElementById('offline-indicator');
  if (indicator) {
    if (isOffline) {
      indicator.removeAttribute('hidden');
    } else {
      indicator.setAttribute('hidden', '');
    }
  }
}

// ---------------------------------------------------------------------------
// Service Worker Registration (Phase 8)
// ---------------------------------------------------------------------------

/**
 * Register the Service Worker if the browser supports it.
 * The SW file is at `js/sw.js` but is served from the root scope
 * by registering with `scope: './'`.
 */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('./js/sw.js', { scope: './' })
      .then(reg => console.info('[SW] Registered, scope:', reg.scope))
      .catch(err => console.warn('[SW] Registration failed:', err));
  }
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Bootstrap the application.
 * Called once after the DOM is ready (scripts are `defer`-ed).
 */
function init() {
  // 1. Apply stored user preferences (theme, font, etc.)
  applyStoredPreferences();

  // 2. Register Service Worker
  registerServiceWorker();

  // 3. Handle initial route on page load
  renderRoute(parseHash());

  // 4. Listen for back/forward browser navigation
  window.addEventListener('popstate', () => {
    renderRoute(parseHash());
  });

  // 5. Listen for online/offline events
  window.addEventListener('online',  () => setOfflineStatus(false));
  window.addEventListener('offline', () => setOfflineStatus(true));

  // Set initial offline status
  if (!navigator.onLine) {
    setOfflineStatus(true);
  }
}

// Run on DOM ready (scripts are deferred so DOM is already available)
init();

// ---------------------------------------------------------------------------
// Public API — exported via window so other modules can call these functions
// ---------------------------------------------------------------------------

window.AeonApp = {
  navigateToArticle,
  navigateToFeed,
  showToast,
  applyTheme,
  applyFont,
  applyFontScale,
  applyLineSpacing,
  // Expose localStorage keys so settings.js can use them
  LS: { LS_THEME, LS_FONT, LS_FONT_SCALE, LS_LINE_SPACING, LS_DROP_CAP },
};
