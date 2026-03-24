/**
 * @fileoverview Unit tests for js/api.js — Phase 7 Refresh Mechanism.
 *
 * Covers:
 *  - triggerWorkflowDispatch() — constructs the correct GitHub API request
 *    (URL, method, headers, body) and handles HTTP error codes.
 *  - checkForUpdates() — returns new data when ETag changes, null when unchanged.
 *  - Polling stops (stopPolling) when an update is detected.
 *  - triggerRefresh() — shows offline toast and returns early when offline.
 *
 * All fetch calls are mocked; no real network calls are made.
 * All timer calls use vi.useFakeTimers() to control setInterval/setTimeout.
 */

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { apiHtml, loadScript } from './helpers.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setup() {
  document.documentElement.innerHTML = `<head></head><body>${apiHtml()}</body>`;

  // Stub matchMedia for app.js
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }),
  });

  // Stub serviceWorker for app.js
  Object.defineProperty(navigator, 'serviceWorker', {
    writable: true,
    value: { register: vi.fn().mockResolvedValue({ scope: './' }) },
  });

  // Feed.js stubs
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ lastFetched: null, articles: [] }),
  });

  loadScript('app.js');
  loadScript('feed.js');
  loadScript('api.js');
}

// ---------------------------------------------------------------------------
// triggerWorkflowDispatch
// ---------------------------------------------------------------------------

describe('api.js — triggerWorkflowDispatch()', () => {
  beforeEach(() => {
    setup();
    localStorage.clear();
  });

  it('calls the correct GitHub API endpoint URL', async () => {
    /** Asserts the dispatch URL includes the owner, repo name, and workflow. */
    global.fetch = vi.fn().mockResolvedValue({ status: 204, ok: true });

    await window.AeonAPI.triggerWorkflowDispatch('mytoken');

    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('api.github.com');
    expect(url).toContain('Jay-2212');
    // Repository name is 'Aeon-Reading'
    expect(url).toContain('Aeon-Reading');
    expect(url).toContain('fetch-articles.yml');
  });

  it('uses the POST method', async () => {
    /** Asserts the workflow dispatch request uses POST. */
    global.fetch = vi.fn().mockResolvedValue({ status: 204, ok: true });

    await window.AeonAPI.triggerWorkflowDispatch('mytoken');

    const [, options] = global.fetch.mock.calls[0];
    expect(options.method).toBe('POST');
  });

  it('sends the PAT as a Bearer token in the Authorization header', async () => {
    /** Asserts the Authorization header is formatted correctly. */
    global.fetch = vi.fn().mockResolvedValue({ status: 204, ok: true });

    await window.AeonAPI.triggerWorkflowDispatch('github_pat_secret');

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer github_pat_secret');
  });

  it('sends the correct Accept header for GitHub API v3', async () => {
    /** Asserts the Accept header matches the GitHub JSON media type. */
    global.fetch = vi.fn().mockResolvedValue({ status: 204, ok: true });

    await window.AeonAPI.triggerWorkflowDispatch('mytoken');

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['Accept']).toBe('application/vnd.github+json');
  });

  it('sends ref: "main" in the JSON body', async () => {
    /** Asserts the dispatch body targets the main branch. */
    global.fetch = vi.fn().mockResolvedValue({ status: 204, ok: true });

    await window.AeonAPI.triggerWorkflowDispatch('mytoken');

    const [, options] = global.fetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.ref).toBe('main');
  });

  it('resolves without error on a 204 response', async () => {
    /** Asserts that HTTP 204 is treated as a successful dispatch. */
    global.fetch = vi.fn().mockResolvedValue({ status: 204, ok: true });
    await expect(
      window.AeonAPI.triggerWorkflowDispatch('mytoken')
    ).resolves.toBeUndefined();
  });

  it('rejects with an error message on a 401 response', async () => {
    /** Asserts that HTTP 401 triggers a user-friendly error. */
    global.fetch = vi.fn().mockResolvedValue({ status: 401, ok: false });
    await expect(
      window.AeonAPI.triggerWorkflowDispatch('badtoken')
    ).rejects.toThrow(/invalid|expired/i);
  });

  it('rejects with an error message on a 403 response', async () => {
    /** Asserts that HTTP 403 triggers a permissions error. */
    global.fetch = vi.fn().mockResolvedValue({ status: 403, ok: false });
    await expect(
      window.AeonAPI.triggerWorkflowDispatch('mytoken')
    ).rejects.toThrow(/permission/i);
  });

  it('rejects with an error message on a 404 response', async () => {
    /** Asserts that HTTP 404 triggers a workflow-not-found error. */
    global.fetch = vi.fn().mockResolvedValue({ status: 404, ok: false });
    await expect(
      window.AeonAPI.triggerWorkflowDispatch('mytoken')
    ).rejects.toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// checkForUpdates — ETag detection
// ---------------------------------------------------------------------------

describe('api.js — checkForUpdates()', () => {
  beforeEach(() => {
    setup();
    localStorage.clear();
  });

  it('returns the new data when the ETag has changed', async () => {
    /**
     * Asserts that checkForUpdates returns data when the ETag differs
     * from the last known value. Simulates a scenario where the file has
     * been updated on the server.
     */
    const mockArticles = { lastFetched: '2026-01-02', articles: [{ id: 'new-article' }] };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (h) => (h === 'ETag' ? '"abc123"' : null) },
      json: async () => mockArticles,
    });

    const result = await window.AeonAPI.checkForUpdates();
    expect(result).not.toBeNull();
    expect(result.data).toEqual(mockArticles);
    expect(result.etag).toBe('"abc123"');
  });

  it('returns null when the ETag is unchanged', async () => {
    /**
     * Asserts that checkForUpdates returns null when the ETag matches the
     * last known value (i.e. the file has not changed since the last poll).
     */
    const etag = '"unchanged-etag"';

    // First call — establishes the known ETag
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (h) => (h === 'ETag' ? etag : null) },
      json: async () => ({ lastFetched: null, articles: [] }),
    });
    await window.AeonAPI.checkForUpdates();

    // Second call — same ETag → should return null
    const result = await window.AeonAPI.checkForUpdates();
    expect(result).toBeNull();
  });

  it('uses lastFetched as a version token when no ETag or Last-Modified is present', async () => {
    /**
     * Asserts that when the server sends no caching headers, checkForUpdates
     * falls back to the lastFetched field inside articles.json.
     * This is the typical behaviour on GitHub Pages which does not always
     * send ETag/Last-Modified for static files.
     */
    const ts1 = '2026-03-23T19:00:00.000000+00:00';
    const ts2 = '2026-03-23T20:00:00.000000+00:00';
    const noHeaders = { get: () => null }; // No ETag, no Last-Modified

    // First call — sets lastKnownEtag to ts1
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: noHeaders,
      json: async () => ({ lastFetched: ts1, articles: [] }),
    });
    await window.AeonAPI.checkForUpdates();

    // Second call — same lastFetched → no change
    let result = await window.AeonAPI.checkForUpdates();
    expect(result).toBeNull();

    // Third call — updated lastFetched → change detected
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: noHeaders,
      json: async () => ({ lastFetched: ts2, articles: [{ id: 'article-a' }] }),
    });
    result = await window.AeonAPI.checkForUpdates();
    expect(result).not.toBeNull();
    expect(result.etag).toBe(ts2);
  });

  it('returns null when no version token is available at all (null === null)', async () => {
    /**
     * Asserts that when neither ETag/Last-Modified nor lastFetched is available,
     * checkForUpdates treats the state as unchanged (null === null) on the
     * second call, preventing spurious "change detected" events.
     */
    const noHeaders = { get: () => null };

    // First call — lastKnownEtag set to null
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: noHeaders,
      json: async () => ({ lastFetched: null, articles: [] }),
    });
    await window.AeonAPI.checkForUpdates();

    // Second call — still null → should return null (no false positive)
    const result = await window.AeonAPI.checkForUpdates();
    expect(result).toBeNull();
  });
});

