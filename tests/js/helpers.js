/**
 * @fileoverview Shared test helpers for Aeon Reader JavaScript unit tests.
 *
 * Provides utilities to:
 *  - Load browser script files into the jsdom global scope using eval().
 *  - Build minimal HTML fixtures for the DOM elements required by each module.
 *
 * Because the app scripts are plain browser scripts (not ES modules), they
 * are loaded by reading their content and calling eval() inside the vitest
 * jsdom environment, where `window === globalThis`. The scripts set their
 * public APIs on `window` (e.g. `window.AeonApp = {…}`), which is then
 * accessible in the tests as `global.AeonApp` or simply `AeonApp`.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repository root. */
const REPO_ROOT = resolve(__dirname, '../../');

/**
 * Read and evaluate a JS file from the js/ directory in the current jsdom
 * global scope. The script is wrapped in a function call to avoid leaking
 * top-level `const`/`let` declarations into the test module scope, while
 * still allowing `window.X = …` assignments to reach the global object.
 *
 * @param {string} filename - Basename of the file, e.g. 'app.js'.
 */
export function loadScript(filename) {
  const content = readFileSync(resolve(REPO_ROOT, 'js', filename), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function(content)();
}

// ---------------------------------------------------------------------------
// Minimal HTML fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal HTML snippet for the elements required by app.js.
 *
 * @returns {string} HTML string.
 */
export function appHtml() {
  return `
    <meta id="theme-color-meta" content="#F5ECD7" />
    <div id="view-feed"></div>
    <div id="view-reader" hidden></div>
    <div id="toast-container"></div>
    <div id="offline-indicator" hidden></div>
  `;
}

/**
 * Minimal HTML snippet for feed.js (plus appHtml elements).
 *
 * @returns {string} HTML string.
 */
export function feedHtml() {
  return `
    ${appHtml()}
    <ul id="article-list"></ul>
    <div id="feed-skeleton"></div>
    <div id="empty-state" hidden></div>
    <div id="error-state" hidden></div>
    <button id="btn-refresh"></button>
    <button id="btn-refresh-empty"></button>
    <button id="btn-retry"></button>
    <div id="refresh-progress" hidden></div>
  `;
}

/**
 * Minimal HTML snippet for reader.js (plus appHtml elements).
 *
 * @returns {string} HTML string.
 */
export function readerHtml() {
  return `
    ${appHtml()}
    <article id="reader-article"></article>
    <div id="reading-progress"></div>
    <button id="btn-back"></button>
    <button id="btn-tts" hidden></button>
    <button id="btn-share"></button>
    <button id="btn-scroll-top" hidden></button>
    <header id="reader-header"></header>
  `;
}

/**
 * Minimal HTML snippet for settings.js (plus appHtml elements).
 *
 * @returns {string} HTML string.
 */
export function settingsHtml() {
  return `
    ${appHtml()}
    <div id="settings-backdrop" hidden></div>
    <aside id="settings-sheet" hidden>
      <button id="btn-close-settings"></button>
      <div id="theme-pills">
        <button class="pill" data-theme-value="light" aria-pressed="false">Light</button>
        <button class="pill pill--active" data-theme-value="sepia" aria-pressed="true">Sepia</button>
        <button class="pill" data-theme-value="dark" aria-pressed="false">Dark</button>
        <button class="pill" data-theme-value="amoled" aria-pressed="false">AMOLED</button>
      </div>
      <div id="font-pills">
        <button class="pill pill--active" data-font-value="lora" aria-pressed="true">Lora</button>
        <button class="pill" data-font-value="merriweather" aria-pressed="false">Merriweather</button>
        <button class="pill" data-font-value="system" aria-pressed="false">System</button>
        <button class="pill" data-font-value="inter" aria-pressed="false">Inter</button>
      </div>
      <input type="range" id="font-size-slider" min="0.85" max="1.3" step="0.01" value="1" />
      <button id="spacing-comfortable" class="pill pill--active" aria-pressed="true">Comfortable</button>
      <button id="spacing-compact" class="pill" aria-pressed="false">Compact</button>
      <input type="checkbox" id="drop-cap-toggle" role="switch" />
      <input type="text" id="pat-input" />
      <button id="btn-save-pat"></button>
      <button id="btn-clear-pat"></button>
      <button id="btn-clear-cache"></button>
    </aside>
    <button id="btn-settings" aria-expanded="false" aria-controls="settings-sheet"></button>
    <div id="reader-settings-backdrop" hidden></div>
    <aside id="reader-settings-sheet" hidden>
      <button id="btn-close-reader-settings"></button>
      <div id="reader-theme-pills">
        <button class="pill" data-theme-value="light" aria-pressed="false">Light</button>
        <button class="pill pill--active" data-theme-value="sepia" aria-pressed="true">Sepia</button>
        <button class="pill" data-theme-value="dark" aria-pressed="false">Dark</button>
        <button class="pill" data-theme-value="amoled" aria-pressed="false">AMOLED</button>
      </div>
      <input type="range" id="reader-font-size-slider" min="0.85" max="1.3" step="0.01" value="1" />
      <input type="checkbox" id="focus-mode-toggle" role="switch" />
      <input type="checkbox" id="auto-scroll-toggle" role="switch" />
      <div id="auto-scroll-speed-group" hidden>
        <input type="range" id="auto-scroll-speed-slider" min="1" max="5" step="1" value="2" />
      </div>
    </aside>
    <button id="btn-reader-menu" aria-expanded="false" aria-controls="reader-settings-sheet"></button>
    <div id="pat-backdrop" hidden></div>
    <aside id="pat-sheet" hidden>
      <input type="password" id="pat-prompt-input" />
      <button id="btn-save-pat-prompt"></button>
    </aside>
  `;
}

/**
 * Minimal HTML snippet for api.js (plus feedHtml elements).
 *
 * @returns {string} HTML string.
 */
export function apiHtml() {
  return feedHtml();
}
