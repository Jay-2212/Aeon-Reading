/**
 * @fileoverview Aeon Reader — feed.js
 * =====================================
 * Phase 3: Article Feed Rendering
 *
 * This module fetches `data/articles.json` and renders the article card list
 * in the feed view. It also handles the pull-to-refresh state coordination
 * with `api.js`.
 *
 * Responsibilities:
 *   - Fetch and parse `data/articles.json` on page load.
 *   - Render article cards in `#article-list`.
 *   - Show/hide the skeleton loader, empty state, and error state.
 *   - Listen for the `aeon:articles-updated` event from `api.js` and
 *     prepend new cards with an animation.
 *   - Remember the feed scroll position so it can be restored when
 *     the user navigates back from the reader view.
 *
 * @module feed
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Path to the articles index JSON file. */
const ARTICLES_JSON_URL = './data/articles.json';

/** Placeholder SVG data-URI shown while cover images load. */
const PLACEHOLDER_SVG = 'assets/placeholder.svg';

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

/** Cached scroll position in the feed (restored on back navigation). */
let savedScrollY = 0;

/** The current list of article summary objects (from articles.json). */
let currentArticles = [];

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const articleList   = document.getElementById('article-list');
const feedSkeleton  = document.getElementById('feed-skeleton');
const emptyState    = document.getElementById('empty-state');
const errorState    = document.getElementById('error-state');

// ---------------------------------------------------------------------------
// Data Loading
// ---------------------------------------------------------------------------

/**
 * Fetch `data/articles.json` and return the parsed data object.
 *
 * Throws if the network request fails or the response is not OK.
 *
 * @param {string} [url=ARTICLES_JSON_URL] - URL of the articles index.
 * @returns {Promise<{lastFetched: string|null, articles: Array}>}
 */
async function fetchArticles(url = ARTICLES_JSON_URL) {
  const response = await fetch(url, {
    // cache: 'no-store' is used so the feed always reflects the latest data
    // after a refresh. The Service Worker handles offline caching separately.
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Failed to load articles.json: HTTP ${response.status}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Card Rendering
// ---------------------------------------------------------------------------

/**
 * Create and return an `<li>` element representing an article card.
 *
 * The entire card is wrapped in a `<button>` for full keyboard and
 * screen-reader accessibility. Tapping the card calls
 * `window.AeonApp.navigateToArticle(id)`.
 *
 * @param {object} article - Article summary object from articles.json.
 * @param {string} article.id               - Slug (stable identifier).
 * @param {string} article.title            - Article title.
 * @param {string} article.author           - Author name.
 * @param {string} article.category         - Aeon section/category.
 * @param {string} article.excerpt          - Short excerpt (~300 chars).
 * @param {string} article.imageUrl         - Cover image URL.
 * @param {string} article.imageAlt         - Cover image alt text.
 * @param {number} article.readingTimeMinutes - Estimated reading time.
 * @returns {HTMLLIElement} The rendered card list item.
 */
function createArticleCard(article) {
  const li = document.createElement('li');
  li.className = 'article-card';
  li.dataset.id = article.id;

  // Build the inner HTML — note: article data is pre-sanitised server-side,
  // but we still use textContent / setAttribute for user-facing fields
  // to prevent any residual XSS.
  const btn = document.createElement('button');
  btn.className = 'article-card__btn';
  btn.setAttribute('aria-label', `Read: ${article.title}`);
  btn.addEventListener('click', () => {
    savedScrollY = window.scrollY;
    window.AeonApp.navigateToArticle(article.id);
  });

  // Cover image wrapper
  const imgWrap = document.createElement('div');
  imgWrap.className = 'article-card__image-wrap';

  if (article.imageUrl) {
    const img = document.createElement('img');
    img.className = 'article-card__image';
    img.alt = article.imageAlt || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    // Set src after creation to allow CSS to show placeholder first
    img.src = article.imageUrl;
    imgWrap.appendChild(img);
  }

  // Card body
  const body = document.createElement('div');
  body.className = 'article-card__body';

  // Category pill
  if (article.category) {
    const cat = document.createElement('span');
    cat.className = 'article-card__category';
    cat.textContent = article.category;
    body.appendChild(cat);
  }

  // Title
  const title = document.createElement('h2');
  title.className = 'article-card__title';
  title.textContent = article.title;
  body.appendChild(title);

  // Author + reading time meta line
  const meta = document.createElement('p');
  meta.className = 'article-card__meta';
  const parts = [];
  if (article.author) parts.push(article.author);
  if (article.readingTimeMinutes) parts.push(`${article.readingTimeMinutes} min read`);
  meta.textContent = parts.join(' · ');
  body.appendChild(meta);

  // Excerpt
  if (article.excerpt) {
    const excerpt = document.createElement('p');
    excerpt.className = 'article-card__excerpt';
    excerpt.textContent = article.excerpt;
    body.appendChild(excerpt);
  }

  btn.appendChild(imgWrap);
  btn.appendChild(body);
  li.appendChild(btn);
  return li;
}

// ---------------------------------------------------------------------------
// Feed Rendering
// ---------------------------------------------------------------------------

/**
 * Render the full list of article cards, replacing any existing cards.
 *
 * @param {Array} articles - Array of article summary objects.
 */
function renderFeed(articles) {
  console.log('[Feed] renderFeed called with', articles?.length, 'articles');
  
  // DEBUG: Show status on screen
  let debugEl = document.getElementById('debug-status');
  if (!debugEl) {
    debugEl = document.createElement('div');
    debugEl.id = 'debug-status';
    debugEl.style.cssText = 'position:fixed;bottom:0;left:0;background:rgba(0,0,0,0.8);color:white;font-family:monospace;z-index:9999;padding:5px;font-size:10px;';
    document.body.appendChild(debugEl);
  }
  debugEl.textContent = `Articles: ${articles?.length || 0} | List empty: ${articleList.children.length === 0}`;

  articleList.innerHTML = '';
  if (!articles || articles.length === 0) {
    console.warn('[Feed] No articles to render, showing empty state');
    showEmptyState();
    return;
  }
  const fragment = document.createDocumentFragment();
  articles.forEach(article => {
    fragment.appendChild(createArticleCard(article));
  });
  articleList.appendChild(fragment);
  console.log('[Feed] articleList populated with', articleList.children.length, 'items');
  
  debugEl.textContent += ` | Populated: ${articleList.children.length}`;
  
  hideSkeleton();
  hideEmptyState();
  hideErrorState();
}

/**
 * Prepend newly fetched article cards to the top of the feed with an
 * animated slide-in. Called by api.js after a successful refresh.
 *
 * @param {Array} newArticles - Array of new article summary objects to prepend.
 */
function prependNewCards(newArticles) {
  if (!newArticles || newArticles.length === 0) return;

  // Build the new cards in reverse order so they appear in the correct order
  // after prepending (last card is inserted first, then the next, etc.)
  const fragment = document.createDocumentFragment();
  newArticles.forEach(article => {
    fragment.appendChild(createArticleCard(article));
  });

  articleList.insertBefore(fragment, articleList.firstChild);
  hideEmptyState();
  hideErrorState();
}

// ---------------------------------------------------------------------------
// Loading State Helpers
// ---------------------------------------------------------------------------

/** Show the skeleton loading animation, hide other states. */
function showSkeleton() {
  feedSkeleton.removeAttribute('hidden');
  hideEmptyState();
  hideErrorState();
}

/** Hide the skeleton loading animation. */
function hideSkeleton() {
  feedSkeleton.setAttribute('hidden', '');
}

/** Show the empty state (no articles loaded). */
function showEmptyState() {
  emptyState.removeAttribute('hidden');
  hideSkeleton();
  hideErrorState();
}

/** Hide the empty state. */
function hideEmptyState() {
  emptyState.setAttribute('hidden', '');
}

/** Show the error state (articles.json failed to load). */
function showErrorState() {
  errorState.removeAttribute('hidden');
  hideSkeleton();
  hideEmptyState();
}

/** Hide the error state. */
function hideErrorState() {
  errorState.setAttribute('hidden', '');
}

// ---------------------------------------------------------------------------
// Scroll Position Restoration
// ---------------------------------------------------------------------------

/**
 * Restore the saved scroll position in the feed view.
 * Called by `aeon:show-feed` event handler after navigating back from reader.
 */
function restoreScrollPosition() {
  if (savedScrollY > 0) {
    // Use requestAnimationFrame to allow the view transition to settle first
    requestAnimationFrame(() => {
      window.scrollTo({ top: savedScrollY, behavior: 'instant' });
    });
  }
}

// ---------------------------------------------------------------------------
// Refresh Button
// ---------------------------------------------------------------------------

/**
 * Handle a tap on the Refresh button (or the empty-state Refresh button).
 * Delegates to `window.AeonAPI.triggerRefresh()` if that module is loaded.
 */
function handleRefresh() {
  if (window.AeonAPI && typeof window.AeonAPI.triggerRefresh === 'function') {
    window.AeonAPI.triggerRefresh();
  } else {
    window.AeonApp.showToast('Refresh is not available yet.', 'error');
  }
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Load and render the article feed.
 * Shows the skeleton during loading and handles error / empty states.
 */
async function loadFeed() {
  console.log('[Feed] loadFeed called');
  showSkeleton();
  try {
    const data = await fetchArticles();
    console.log('[Feed] fetchArticles response:', data);
    currentArticles = data.articles || [];
    console.log('[Feed] currentArticles length:', currentArticles.length);
    renderFeed(currentArticles);
  } catch (err) {
    console.error('[Feed] Failed to load articles:', err);
    hideSkeleton();
    showErrorState();
  }
}

/** Initialise feed event listeners and load the feed. */
function init() {
  console.log('[Feed] init starting');
  // Refresh button in header
  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', handleRefresh);
  }

  // Refresh button in empty state
  const btnRefreshEmpty = document.getElementById('btn-refresh-empty');
  if (btnRefreshEmpty) {
    btnRefreshEmpty.addEventListener('click', handleRefresh);
  }

  // Retry button in error state
  const btnRetry = document.getElementById('btn-retry');
  if (btnRetry) {
    btnRetry.addEventListener('click', loadFeed);
  }

  // Listen for articles-updated event from api.js
  document.addEventListener('aeon:articles-updated', (event) => {
    const { newArticles, totalCount } = event.detail;
    console.log('[Feed] aeon:articles-updated received:', newArticles?.length);
    if (newArticles && newArticles.length > 0) {
      prependNewCards(newArticles);
      window.AeonApp.showToast(
        `${newArticles.length} new article${newArticles.length > 1 ? 's' : ''} added`
      );
    } else {
      window.AeonApp.showToast('Already up to date');
    }
  });

  // Restore scroll position when returning from reader view
  document.addEventListener('aeon:show-feed', () => {
    console.log('[Feed] aeon:show-feed received');
    restoreScrollPosition();
  });

  // Initial load
  console.log('[Feed] Initial load trigger');
  loadFeed();
}

// Initialise once the DOM and other deferred scripts are ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

window.AeonFeed = {
  loadFeed,
  prependNewCards,
  getCurrentArticles: () => currentArticles,
};
