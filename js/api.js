/**
 * @fileoverview Aeon Reader — api.js
 * =====================================
 * Phase 7: GitHub API Integration — Refresh Mechanism
 *
 * This module provides the Refresh functionality that allows users to trigger
 * the `fetch-articles.yml` GitHub Actions workflow from within the app.
 *
 * Flow:
 *   1. User taps Refresh.
 *   2. If no PAT is saved, open the PAT prompt sheet (see settings.js).
 *   3. Call `POST /repos/{owner}/{repo}/actions/workflows/fetch-articles.yml/dispatches`
 *      with the user's PAT as a Bearer token.
 *   4. Show a spinner / progress indicator in the header.
 *   5. Poll `data/articles.json` every POLL_INTERVAL_MS milliseconds, checking the
 *      `Last-Modified` or `ETag` header for changes.
 *   6. When the file changes, dispatch `aeon:articles-updated` with the new articles.
 *   7. Show a toast notification with the result.
 *   8. Handle errors: bad PAT, rate limit, network failure.
 *
 * @module api
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** GitHub repository owner (username or org). */
const REPO_OWNER = 'Jay-2212';

/** GitHub repository name.
 * NOTE: The repository name is 'Aeon-Reading' as seen in the git remote.
 */
const REPO_NAME = 'Aeon-Reading';

/** The workflow file name to dispatch. */
const WORKFLOW_ID = 'fetch-articles.yml';

/** GitHub API base URL. */
const GITHUB_API_BASE = 'https://api.github.com';

/** Polling interval in milliseconds — how often to check articles.json. */
const POLL_INTERVAL_MS = 10_000;

/** Maximum time to poll before giving up (15 minutes). */
const POLL_TIMEOUT_MS = 15 * 60 * 1_000;

/** Path to articles index used for polling. */
const ARTICLES_JSON_URL = './data/articles.json';

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

/** Whether a refresh is currently in progress. */
let refreshInProgress = false;

/** The polling interval timer ID (from setInterval). */
let pollIntervalId = null;

/** The polling timeout timer ID (from setTimeout). */
let pollTimeoutId = null;

/** The ETag or Last-Modified value from the last successful articles.json fetch. */
let lastKnownEtag = null;

// ---------------------------------------------------------------------------
// Helper: Refresh Progress Indicator
// ---------------------------------------------------------------------------

/**
 * Show or hide the refresh progress bar in the feed header.
 * The bar is indeterminate — it just pulses to indicate activity.
 *
 * @param {boolean} visible - Whether to show the progress bar.
 */
function setRefreshProgress(visible) {
  const bar = document.getElementById('refresh-progress');
  if (!bar) return;
  if (visible) {
    bar.removeAttribute('hidden');
    // Animate to 60% to indicate "in progress" without knowing the real value
    bar.style.width = '60%';
    bar.setAttribute('aria-valuenow', '60');
  } else {
    // Complete the bar, then hide after transition
    bar.style.width = '100%';
    bar.setAttribute('aria-valuenow', '100');
    setTimeout(() => {
      bar.setAttribute('hidden', '');
      bar.style.width = '0%';
    }, 400);
  }
}

/**
 * Set the refreshing state of the Refresh button — shows a spinner icon.
 *
 * @param {boolean} loading - Whether to show the loading state.
 */
function setRefreshButtonLoading(loading) {
  const btn = document.getElementById('btn-refresh');
  if (!btn) return;
  btn.disabled = loading;
  btn.setAttribute('aria-label', loading ? 'Refreshing…' : 'Refresh articles');
}

// ---------------------------------------------------------------------------
// GitHub API: Trigger Workflow
// ---------------------------------------------------------------------------

/**
 * Dispatch the `fetch-articles.yml` workflow via the GitHub Actions API.
 *
 * @param {string} pat - The user's GitHub Personal Access Token.
 * @returns {Promise<void>} Resolves on success (HTTP 204), rejects on failure.
 * @throws {Error} With a user-friendly message if the request fails.
 */
async function triggerWorkflowDispatch(pat) {
  const url = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_ID}/dispatches`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept':        'application/vnd.github+json',
      'Content-Type':  'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main' }),
  });

  if (response.status === 204) {
    // Success — workflow was queued
    return;
  }

  if (response.status === 401) {
    throw new Error('Invalid or expired GitHub token. Please update it in Settings.');
  }

  if (response.status === 403) {
    throw new Error('Token does not have Actions: write permission for this repository.');
  }

  if (response.status === 404) {
    throw new Error('Workflow not found. The app may need an update.');
  }

  if (response.status === 422) {
    throw new Error('Could not trigger workflow. Is the branch name correct?');
  }

  throw new Error(`GitHub API error: HTTP ${response.status}`);
}

// ---------------------------------------------------------------------------
// Polling: Detect articles.json Updates
// ---------------------------------------------------------------------------

/**
 * Fetch `data/articles.json` and return `{ etag, data }` if the file has
 * changed since the last known version, or `null` if unchanged.
 *
 * Version detection order:
 *   1. HTTP `ETag` response header (most reliable — set by most servers).
 *   2. HTTP `Last-Modified` response header (fallback for servers without ETags).
 *   3. `lastFetched` field inside the JSON (GitHub Pages CDN fallback — the
 *      workflow always updates this timestamp when it writes new articles).
 *
 * Using `cache: 'no-store'` bypasses the browser HTTP cache; the SW's
 * network-first strategy ensures the response comes from the origin server.
 *
 * @returns {Promise<{etag: string, data: object}|null>}
 *   Returns the new data + version string if changed, or null if unchanged.
 */
async function checkForUpdates() {
  const response = await fetch(ARTICLES_JSON_URL, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Failed to poll articles.json: HTTP ${response.status}`);
  }

  // Always parse the body — we need lastFetched as a version fallback
  const data = await response.json();

  // Build a version token: prefer ETag/Last-Modified; fall back to lastFetched
  const newVersion = response.headers.get('ETag')
    || response.headers.get('Last-Modified')
    || data.lastFetched
    || null;

  // Strict equality covers null===null (both unavailable → treat as unchanged)
  if (newVersion === lastKnownEtag) {
    return null; // No change detected
  }

  lastKnownEtag = newVersion;
  return { etag: newVersion, data };
}

/**
 * Stop any active polling timers.
 */
function stopPolling() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  if (pollTimeoutId) {
    clearTimeout(pollTimeoutId);
    pollTimeoutId = null;
  }
}

/**
 * Start polling `data/articles.json` for changes.
 * Stops automatically when an update is detected or the timeout is reached.
 *
 * @param {Array} previousArticles - The article list before the workflow was triggered.
 *   Used to compute which articles are new.
 */
function startPolling(previousArticles) {
  const previousIds = new Set((previousArticles || []).map(a => a.id));

  pollIntervalId = setInterval(async () => {
    try {
      const result = await checkForUpdates();
      if (!result) return; // No change yet

      const { data } = result;
      const currentArticles = data.articles || [];

      // Find articles that are new (not in previousIds)
      const newArticles = currentArticles.filter(a => !previousIds.has(a.id));

      // Dispatch event regardless (even if 0 new — could be an error case)
      document.dispatchEvent(new CustomEvent('aeon:articles-updated', {
        detail: { newArticles, totalCount: currentArticles.length },
      }));

      stopPolling();
      finishRefresh(true);

    } catch (err) {
      console.warn('[API] Polling error:', err);
      // Continue polling — transient network errors should not stop the poll
    }
  }, POLL_INTERVAL_MS);

  // Safety timeout — give up after POLL_TIMEOUT_MS
  pollTimeoutId = setTimeout(() => {
    stopPolling();
    finishRefresh(false);
    window.AeonApp.showToast('Refresh timed out. Try again later.', 'error');
  }, POLL_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// Main Refresh Flow
// ---------------------------------------------------------------------------

/**
 * Finish the refresh flow, resetting UI state.
 *
 * @param {boolean} success - Whether the refresh completed successfully.
 */
function finishRefresh(success) {
  refreshInProgress = false;
  setRefreshButtonLoading(false);
  setRefreshProgress(false);
}

/**
 * Trigger the full refresh flow:
 *   1. Check for a saved PAT; if missing, open the PAT prompt.
 *   2. Record the current article list for diff computation.
 *   3. Capture the current ETag for change detection.
 *   4. Dispatch the workflow.
 *   5. Begin polling for the result.
 */
async function triggerRefresh() {
  if (refreshInProgress) return;

  // Get saved PAT
  const pat = (window.AeonSettings && window.AeonSettings.getSavedPat())
    || localStorage.getItem('aeon_github_pat')
    || '';

  if (!pat) {
    // No PAT saved — open the prompt sheet
    if (window.AeonSettings && typeof window.AeonSettings.openPatPrompt === 'function') {
      window.AeonSettings.openPatPrompt();
    } else {
      window.AeonApp.showToast('Please add a GitHub token in Settings.', 'error');
    }
    return;
  }

  refreshInProgress = true;
  setRefreshButtonLoading(true);
  setRefreshProgress(true);

  // Snapshot the current articles for diff computation during polling
  const previousArticles = (window.AeonFeed && window.AeonFeed.getCurrentArticles())
    ? window.AeonFeed.getCurrentArticles()
    : [];

  // Prime the version baseline so we can detect changes after the workflow runs.
  // Use GET (not HEAD) so we can read lastFetched as a fallback when the server
  // does not send ETag/Last-Modified headers (e.g. GitHub Pages CDN).
  try {
    const response = await fetch(ARTICLES_JSON_URL, { cache: 'no-store' });
    const etag = response.headers.get('ETag') || response.headers.get('Last-Modified');
    if (etag) {
      lastKnownEtag = etag;
    } else {
      const data = await response.json();
      lastKnownEtag = data.lastFetched || null;
    }
  } catch (_) {
    // Not critical — polling will still detect changes even without a baseline
  }

  try {
    await triggerWorkflowDispatch(pat);
    window.AeonApp.showToast('Refresh started — checking for new articles…');
    startPolling(previousArticles);
  } catch (err) {
    console.error('[API] Workflow dispatch failed:', err);
    window.AeonApp.showToast(err.message || 'Refresh failed', 'error');
    finishRefresh(false);
  }
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/** Expose the public API on window so feed.js can call triggerRefresh(). */
window.AeonAPI = {
  triggerRefresh,
  triggerWorkflowDispatch,
  checkForUpdates,
};
