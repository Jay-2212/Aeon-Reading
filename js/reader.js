/**
 * @fileoverview Aeon Reader — reader.js
 * =======================================
 * Phase 4 & 10: Article Reader View
 *
 * This module handles everything that happens in the reader view:
 *   - Fetching the individual article JSON file.
 *   - Rendering the article header (hero image, title, author, reading time).
 *   - Injecting the sanitised `bodyHtml` into the article element.
 *   - Tracking reading progress (scroll percentage) and updating the progress bar.
 *   - Computing and displaying the "X min left" countdown.
 *   - Showing/hiding the scroll-to-top button.
 *   - Hiding/showing the reader header on scroll (auto-hide).
 *   - Focus mode: dims non-active paragraphs via IntersectionObserver.
 *   - Screen Wake Lock: prevents screen sleep while article is open.
 *   - Back navigation (hardware back button and ← Back UI button).
 *   - Web Share API integration for the Share button.
 *   - Auto-scroll (teleprompter mode): scrolls the article at a configurable speed.
 *   - Text-to-Speech: reads the article aloud using the Web Speech API.
 *
 * @module reader
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Path prefix for individual article JSON files. */
const ARTICLE_FILE_PREFIX = './data/article-';

/** Scroll depth (px) at which the scroll-to-top button appears. */
const SCROLL_TOP_BTN_THRESHOLD = 400;

/** Scroll depth (px) at which the reader header auto-hides. */
const HEADER_HIDE_THRESHOLD = 80;

/** Minimum scroll velocity to trigger header hide/show. */
const HEADER_SCROLL_MIN_DELTA = 5;

/**
 * Auto-scroll pixel-per-frame speeds mapped to the 1–5 slider levels.
 * Level 1 is the slowest (0.4 px/frame at 60fps ≈ 24 px/s),
 * Level 5 is the fastest (2.0 px/frame ≈ 120 px/s).
 */
const AUTO_SCROLL_SPEEDS = [0, 0.4, 0.8, 1.2, 1.6, 2.0];

/** localStorage key for the auto-scroll enabled state. */
const LS_AUTO_SCROLL = 'aeon_auto_scroll';

/** localStorage key for the auto-scroll speed level (1–5). */
const LS_AUTO_SCROLL_SPEED = 'aeon_auto_scroll_speed';

/** Delay (ms) before auto-scroll resumes after the user manually scrolls. */
const AUTO_SCROLL_RESUME_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

/** The currently displayed article data object. */
let currentArticle = null;

/** Wake Lock sentinel (if active). */
let wakeLockSentinel = null;

/** Whether focus mode is currently active. */
let focusModeActive = false;

/** IntersectionObserver for focus mode paragraph detection. */
let focusObserver = null;

/** Last scrollY value, used to detect scroll direction for header hide/show. */
let lastScrollY = 0;

// ---------------------------------------------------------------------------
// Auto-scroll state
// ---------------------------------------------------------------------------

/** Whether auto-scroll (teleprompter mode) is currently running. */
let autoScrollActive = false;

/** requestAnimationFrame ID for the current auto-scroll animation loop. */
let autoScrollRafId = null;

/** Current auto-scroll speed level (1–5). */
let autoScrollSpeedLevel = 2;

/** setTimeout ID used to resume auto-scroll after a manual scroll pause. */
let autoScrollResumeTimerId = null;

/** Whether the user is currently manually scrolling (pauses auto-scroll). */
let autoScrollPaused = false;

// ---------------------------------------------------------------------------
// Text-to-Speech state
// ---------------------------------------------------------------------------

/** Whether TTS is currently active (speaking or paused). */
let ttsActive = false;

/** The SpeechSynthesisUtterance currently being spoken, or null. */
let ttsUtterance = null;

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const readerArticle   = document.getElementById('reader-article');
const readingProgress = document.getElementById('reading-progress');
const btnBack         = document.getElementById('btn-back');
const btnShare        = document.getElementById('btn-share');
const btnTTS          = document.getElementById('btn-tts');
const btnScrollTop    = document.getElementById('btn-scroll-top');
const readerHeader    = document.getElementById('reader-header');

// ---------------------------------------------------------------------------
// Article Loading
// ---------------------------------------------------------------------------

/**
 * Fetch the full article data JSON for the given article ID.
 *
 * @param {string} articleId - The article slug.
 * @returns {Promise<object>} The full article data object.
 * @throws {Error} If the fetch fails or the response is not OK.
 */
async function fetchArticle(articleId) {
  const url = `${ARTICLE_FILE_PREFIX}${articleId}.json`;
  const response = await fetch(url, { cache: 'default' });
  if (!response.ok) {
    throw new Error(`Failed to load article ${articleId}: HTTP ${response.status}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Article Rendering
// ---------------------------------------------------------------------------

/**
 * Render the article content into the `#reader-article` element.
 *
 * Builds the article header (image, category, title, author, reading time),
 * then injects the pre-sanitised `bodyHtml` and optional author bio.
 *
 * SECURITY NOTE: `bodyHtml` is set via `innerHTML`, but it has been sanitised
 * server-side by `scripts/fetch_articles.py` using bleach. It is never set
 * from a live-fetched URL — only from the static JSON files stored in `data/`.
 *
 * @param {object} article - Full article data object from `data/article-<id>.json`.
 */
function renderArticle(article) {
  currentArticle = article;
  readerArticle.innerHTML = '';

  // ---- Hero Image ----
  if (article.imageUrl) {
    const img = document.createElement('img');
    img.className = 'reader-hero-image';
    img.src       = article.imageUrl;
    img.alt       = article.imageAlt || '';
    img.loading   = 'lazy';
    img.decoding  = 'async';
    readerArticle.appendChild(img);
  }

  // ---- Category Label ----
  if (article.category) {
    const cat = document.createElement('span');
    cat.className   = 'reader-category';
    cat.textContent = article.category;
    readerArticle.appendChild(cat);
  }

  // ---- Title ----
  const titleEl = document.createElement('h1');
  titleEl.className   = 'reader-title';
  titleEl.textContent = article.title;
  readerArticle.appendChild(titleEl);

  // ---- Byline ----
  if (article.author) {
    const authorEl = document.createElement('p');
    authorEl.className   = 'reader-author';
    authorEl.textContent = `By ${article.author}`;
    readerArticle.appendChild(authorEl);
  }

  // ---- Reading Time ----
  const timeEl = document.createElement('p');
  timeEl.className   = 'reader-time';
  timeEl.id          = 'reader-time-display';
  timeEl.textContent = `${article.readingTimeMinutes} min read`;
  readerArticle.appendChild(timeEl);

  // ---- Divider ----
  const hr = document.createElement('hr');
  hr.className = 'reader-divider';
  readerArticle.appendChild(hr);

  // ---- Article Body ----
  // bodyHtml is pre-sanitised server-side — see fetch_articles.py
  const bodyDiv = document.createElement('div');
  bodyDiv.className = 'reader-body';
  bodyDiv.id        = 'reader-body';

  // Apply drop-cap setting
  const dropCapEnabled = localStorage.getItem('aeon_drop_cap') === 'true';
  if (dropCapEnabled) {
    bodyDiv.classList.add('drop-cap');
  }

  // Apply line spacing
  const lineSpacing = localStorage.getItem('aeon_line_spacing') || '1.75';
  document.documentElement.style.setProperty('--line-spacing', lineSpacing);

  bodyDiv.innerHTML = article.bodyHtml;
  readerArticle.appendChild(bodyDiv);

  // ---- Author Bio ----
  if (article.authorBio) {
    const bioSection = document.createElement('div');
    bioSection.className = 'reader-author-bio';

    const bioLabel = document.createElement('span');
    bioLabel.className   = 'reader-author-bio-label';
    bioLabel.textContent = 'About the author';
    bioSection.appendChild(bioLabel);

    const bioText = document.createElement('p');
    bioText.textContent = article.authorBio;
    bioSection.appendChild(bioText);

    readerArticle.appendChild(bioSection);
  }

  // Update document title for browser tab
  document.title = `${article.title} — Aeon Reader`;

  // Start scroll-based features
  initScrollFeatures();

  // Start focus mode if previously enabled
  if (focusModeActive) {
    enableFocusMode();
  }

  // Acquire Wake Lock
  acquireWakeLock();
}

// ---------------------------------------------------------------------------
// Reading Progress Bar
// ---------------------------------------------------------------------------

/**
 * Calculate reading progress as a percentage (0–100) based on scroll position.
 *
 * @returns {number} Progress percentage rounded to 1 decimal place.
 */
function calculateProgress() {
  const scrollTop    = window.scrollY || document.documentElement.scrollTop;
  const docHeight    = document.documentElement.scrollHeight;
  const windowHeight = window.innerHeight;
  const scrollable   = docHeight - windowHeight;
  if (scrollable <= 0) return 100;
  return Math.min(100, Math.round((scrollTop / scrollable) * 1000) / 10);
}

/**
 * Update the reading progress bar width and ARIA value.
 *
 * @param {number} progress - Progress percentage (0–100).
 */
function updateProgressBar(progress) {
  if (!readingProgress) return;
  readingProgress.style.width = `${progress}%`;
  readingProgress.setAttribute('aria-valuenow', String(Math.round(progress)));
}

// ---------------------------------------------------------------------------
// "X min left" Countdown
// ---------------------------------------------------------------------------

/**
 * Update the "X min left" countdown displayed below the article title.
 * Uses the percentage of the article already scrolled to estimate remaining time.
 *
 * @param {number} progressPercent - Reading progress as a percentage (0–100).
 */
function updateCountdown(progressPercent) {
  if (!currentArticle) return;
  const timeDisplay = document.getElementById('reader-time-display');
  if (!timeDisplay) return;

  const totalMinutes = currentArticle.readingTimeMinutes;
  if (progressPercent >= 99) {
    timeDisplay.textContent = '✓ Finished';
    return;
  }
  const remaining = Math.ceil(totalMinutes * (1 - progressPercent / 100));
  timeDisplay.textContent = remaining <= 1
    ? '~1 min left'
    : `~${remaining} min left`;
}

// ---------------------------------------------------------------------------
// Auto-hide Reader Header
// ---------------------------------------------------------------------------

/**
 * Update the reader header visibility based on scroll direction.
 * Hides on scroll-down, shows on scroll-up.
 *
 * @param {number} currentScrollY - Current window.scrollY value.
 */
function updateHeaderVisibility(currentScrollY) {
  if (!readerHeader) return;
  const delta = currentScrollY - lastScrollY;

  if (delta > HEADER_SCROLL_MIN_DELTA && currentScrollY > HEADER_HIDE_THRESHOLD) {
    readerHeader.classList.add('reader-header--hidden');
  } else if (delta < -HEADER_SCROLL_MIN_DELTA) {
    readerHeader.classList.remove('reader-header--hidden');
  }

  lastScrollY = currentScrollY;
}

// ---------------------------------------------------------------------------
// Scroll-to-Top Button
// ---------------------------------------------------------------------------

/**
 * Update the scroll-to-top button visibility.
 * Shown after SCROLL_TOP_BTN_THRESHOLD px of scroll.
 *
 * @param {number} scrollY - Current scroll position.
 */
function updateScrollTopButton(scrollY) {
  if (!btnScrollTop) return;
  if (scrollY > SCROLL_TOP_BTN_THRESHOLD) {
    btnScrollTop.removeAttribute('hidden');
  } else {
    btnScrollTop.setAttribute('hidden', '');
  }
}

// ---------------------------------------------------------------------------
// Scroll Event Handler
// ---------------------------------------------------------------------------

/**
 * Handle scroll events in the reader view.
 * Updates progress bar, countdown, header visibility, and scroll-to-top button.
 */
function handleReaderScroll() {
  const scrollY    = window.scrollY;
  const progress   = calculateProgress();

  updateProgressBar(progress);
  updateCountdown(progress);
  updateHeaderVisibility(scrollY);
  updateScrollTopButton(scrollY);
}

// ---------------------------------------------------------------------------
// Touch Swipe (Back gesture)
// ---------------------------------------------------------------------------

/** Stores the initial touchstart X position. */
let touchStartX = 0;

/**
 * Record the touch start X position.
 * @param {TouchEvent} e
 */
function onTouchStart(e) {
  touchStartX = e.touches[0].clientX;
}

/**
 * Detect a right-to-left swipe from the left edge of the screen.
 * A swipe starting within the first 30px and moving > 80px right triggers
 * navigation back to the feed.
 *
 * @param {TouchEvent} e
 */
function onTouchEnd(e) {
  const touchEndX = e.changedTouches[0].clientX;
  const deltaX    = touchEndX - touchStartX;
  // Swipe left (feed→reader was swiped right→left on iOS)
  // Here: swipe right from left edge → navigate back
  if (touchStartX < 30 && deltaX > 80) {
    window.AeonApp.navigateToFeed();
  }
}

// ---------------------------------------------------------------------------
// Focus Mode (Phase 9)
// ---------------------------------------------------------------------------

/**
 * Enable focus mode: observe all paragraphs with IntersectionObserver
 * and dim non-focused paragraphs (opacity 0.35).
 */
function enableFocusMode() {
  const bodyDiv = document.getElementById('reader-body');
  if (!bodyDiv) return;

  bodyDiv.classList.add('focus-mode');
  focusModeActive = true;

  const paragraphs = bodyDiv.querySelectorAll('p');
  if (paragraphs.length === 0) return;

  // Disconnect existing observer if any
  if (focusObserver) focusObserver.disconnect();

  focusObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Dim all paragraphs, then highlight the newly focused one
          paragraphs.forEach(p => p.classList.remove('focus-active'));
          entry.target.classList.add('focus-active');
        }
      });
    },
    {
      // Consider a paragraph "focused" when ≥40% of it is visible
      threshold: 0.4,
      rootMargin: '-10% 0px -10% 0px',
    }
  );

  paragraphs.forEach(p => focusObserver.observe(p));
}

/**
 * Disable focus mode: restore all paragraphs to full opacity.
 */
function disableFocusMode() {
  const bodyDiv = document.getElementById('reader-body');
  if (!bodyDiv) return;

  bodyDiv.classList.remove('focus-mode');
  focusModeActive = false;

  if (focusObserver) {
    focusObserver.disconnect();
    focusObserver = null;
  }

  bodyDiv.querySelectorAll('p.focus-active').forEach(p => p.classList.remove('focus-active'));
}

// ---------------------------------------------------------------------------
// Screen Wake Lock (Phase 9)
// ---------------------------------------------------------------------------

/**
 * Request a Screen Wake Lock to prevent the display from sleeping while reading.
 * Silently does nothing if the API is not supported.
 */
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
  } catch (err) {
    // Wake lock requests can fail (e.g. page is not visible); that's OK.
    console.debug('[WakeLock] Could not acquire:', err.message);
  }
}

/**
 * Release the Screen Wake Lock, if one is currently held.
 */
async function releaseWakeLock() {
  if (wakeLockSentinel) {
    await wakeLockSentinel.release();
    wakeLockSentinel = null;
  }
}

// Re-acquire Wake Lock if the page becomes visible again (e.g. after tab switch)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentArticle) {
    acquireWakeLock();
  }
});

// ---------------------------------------------------------------------------
// Web Share API (Phase 9)
// ---------------------------------------------------------------------------

/**
 * Share the current article using the Web Share API.
 * Falls back to copying the Aeon URL to the clipboard if Web Share is unavailable.
 */
async function shareArticle() {
  if (!currentArticle) return;

  // Construct the canonical Aeon URL from the article ID
  const articleUrl = `https://aeon.co/essays/${currentArticle.id}`;
  const shareData  = {
    title: currentArticle.title,
    text:  currentArticle.excerpt || currentArticle.title,
    url:   articleUrl,
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (err) {
      // User cancelled — not an error
      if (err.name !== 'AbortError') {
        console.warn('[Share] Web Share failed:', err);
      }
    }
  } else {
    // Fallback: copy URL to clipboard
    try {
      await navigator.clipboard.writeText(articleUrl);
      window.AeonApp.showToast('Link copied to clipboard');
    } catch (err) {
      console.warn('[Share] Clipboard failed:', err);
      window.AeonApp.showToast('Could not copy link', 'error');
    }
  }
}

// ---------------------------------------------------------------------------
// Scroll Feature Initialisation
// ---------------------------------------------------------------------------

/**
 * Set up scroll-based features for the reader view.
 * Resets scroll position and attaches/detaches the scroll handler.
 */
function initScrollFeatures() {
  // Reset to top when a new article loads
  window.scrollTo({ top: 0, behavior: 'instant' });
  lastScrollY = 0;

  // Reset progress bar
  updateProgressBar(0);

  // Reset scroll-to-top button
  if (btnScrollTop) {
    btnScrollTop.setAttribute('hidden', '');
  }

  // Ensure header is visible
  if (readerHeader) {
    readerHeader.classList.remove('reader-header--hidden');
  }
}

// ---------------------------------------------------------------------------
// Auto-scroll (Phase 10 — Teleprompter Mode)
// ---------------------------------------------------------------------------

/**
 * Run a single animation frame of the auto-scroll.
 * Advances the scroll position by the configured pixels-per-frame and
 * stops automatically when the bottom of the page is reached.
 */
function autoScrollStep() {
  if (!autoScrollActive || autoScrollPaused) {
    autoScrollRafId = null;
    return;
  }

  const pixelsPerFrame = AUTO_SCROLL_SPEEDS[autoScrollSpeedLevel] || AUTO_SCROLL_SPEEDS[2];
  window.scrollBy({ top: pixelsPerFrame, behavior: 'instant' });

  // Stop at the bottom of the page
  const atBottom =
    window.scrollY + window.innerHeight >=
    document.documentElement.scrollHeight - 2;

  if (atBottom) {
    stopAutoScroll();
    return;
  }

  autoScrollRafId = requestAnimationFrame(autoScrollStep);
}

/**
 * Start auto-scroll at the current speed level.
 * Saves the enabled state to localStorage so it persists across articles.
 */
function startAutoScroll() {
  autoScrollActive = true;
  autoScrollPaused = false;
  localStorage.setItem(LS_AUTO_SCROLL, 'true');

  // Update the toggle UI
  const toggle = document.getElementById('auto-scroll-toggle');
  if (toggle) toggle.checked = true;

  // Show the speed slider
  const speedGroup = document.getElementById('auto-scroll-speed-group');
  if (speedGroup) speedGroup.removeAttribute('hidden');

  // Add a visual indicator bar at the bottom of the viewport
  if (!document.getElementById('auto-scroll-indicator')) {
    const indicator = document.createElement('div');
    indicator.id        = 'auto-scroll-indicator';
    indicator.className = 'auto-scroll-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    document.body.appendChild(indicator);
  }

  if (autoScrollRafId) cancelAnimationFrame(autoScrollRafId);
  autoScrollRafId = requestAnimationFrame(autoScrollStep);
}

/**
 * Stop auto-scroll and cancel the animation loop.
 * Updates localStorage and the toggle UI.
 */
function stopAutoScroll() {
  autoScrollActive = false;
  autoScrollPaused = false;
  localStorage.setItem(LS_AUTO_SCROLL, 'false');

  if (autoScrollRafId) {
    cancelAnimationFrame(autoScrollRafId);
    autoScrollRafId = null;
  }
  if (autoScrollResumeTimerId) {
    clearTimeout(autoScrollResumeTimerId);
    autoScrollResumeTimerId = null;
  }

  // Update the toggle UI
  const toggle = document.getElementById('auto-scroll-toggle');
  if (toggle) toggle.checked = false;

  // Hide the speed slider
  const speedGroup = document.getElementById('auto-scroll-speed-group');
  if (speedGroup) speedGroup.setAttribute('hidden', '');

  // Remove the visual indicator bar
  const indicator = document.getElementById('auto-scroll-indicator');
  if (indicator) indicator.remove();
}

/**
 * Set the auto-scroll speed level (1–5) and persist to localStorage.
 * If auto-scroll is running, the new speed takes effect on the next frame.
 *
 * @param {number} level - Speed level between 1 (slowest) and 5 (fastest).
 */
function setAutoScrollSpeed(level) {
  // Clamp to valid range
  autoScrollSpeedLevel = Math.min(5, Math.max(1, Math.round(level)));
  localStorage.setItem(LS_AUTO_SCROLL_SPEED, String(autoScrollSpeedLevel));
}

/**
 * Handle a manual scroll event while auto-scroll is active.
 * Pauses auto-scroll temporarily and resumes it after AUTO_SCROLL_RESUME_DELAY_MS.
 */
function onManualScrollDuringAutoScroll() {
  if (!autoScrollActive) return;

  // Pause the animation loop
  autoScrollPaused = true;
  if (autoScrollRafId) {
    cancelAnimationFrame(autoScrollRafId);
    autoScrollRafId = null;
  }

  // Clear any existing resume timer
  if (autoScrollResumeTimerId) {
    clearTimeout(autoScrollResumeTimerId);
  }

  // Resume after a short delay
  autoScrollResumeTimerId = setTimeout(() => {
    autoScrollResumeTimerId = null;
    if (autoScrollActive) {
      autoScrollPaused = false;
      autoScrollRafId = requestAnimationFrame(autoScrollStep);
    }
  }, AUTO_SCROLL_RESUME_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Text-to-Speech (Phase 10.6)
// ---------------------------------------------------------------------------

/**
 * Initialise the TTS button: show it only if the Web Speech API is available.
 * Called once on module load.
 */
function initTTS() {
  if (!btnTTS) return;
  if (!('speechSynthesis' in window)) {
    // API not supported — keep the button hidden
    return;
  }
  // Show the button now that we know TTS is available
  btnTTS.removeAttribute('hidden');
}

/**
 * Extract the readable plain-text content of the current article body.
 * Returns the concatenation of all paragraph text nodes.
 *
 * @returns {string} Plain text suitable for speechSynthesis.
 */
function getArticleTextForTTS() {
  if (!currentArticle) return '';
  // Build text from title + paragraphs in the rendered body
  const bodyDiv = document.getElementById('reader-body');
  if (!bodyDiv) return currentArticle.title || '';

  const titleText = currentArticle.title ? `${currentArticle.title}. ` : '';
  const bodyText  = Array.from(bodyDiv.querySelectorAll('p'))
    .map(p => p.textContent.trim())
    .filter(Boolean)
    .join(' ');
  return titleText + bodyText;
}

/**
 * Start reading the article aloud using the Web Speech API.
 * Updates the button label and adds the `.tts-active` class to `<body>`
 * so CSS can highlight the TTS indicator.
 */
function startTTS() {
  if (!('speechSynthesis' in window) || !currentArticle) return;

  // Stop any previous utterance
  window.speechSynthesis.cancel();

  const text = getArticleTextForTTS();
  if (!text) return;

  ttsUtterance = new SpeechSynthesisUtterance(text);
  ttsUtterance.rate  = 1.0;
  ttsUtterance.pitch = 1.0;
  ttsUtterance.lang  = 'en';

  ttsUtterance.onstart = () => {
    ttsActive = true;
    if (btnTTS) {
      btnTTS.setAttribute('aria-label', 'Stop reading aloud');
      btnTTS.classList.add('btn--tts-active');
    }
  };

  ttsUtterance.onend = () => {
    ttsActive = false;
    if (btnTTS) {
      btnTTS.setAttribute('aria-label', 'Read article aloud');
      btnTTS.classList.remove('btn--tts-active');
    }
    ttsUtterance = null;
  };

  ttsUtterance.onerror = (event) => {
    // Ignore 'interrupted' errors — these are triggered by cancel() and are expected
    if (event.error === 'interrupted') return;
    console.warn('[TTS] Speech error:', event.error);
    ttsActive = false;
    if (btnTTS) {
      btnTTS.setAttribute('aria-label', 'Read article aloud');
      btnTTS.classList.remove('btn--tts-active');
    }
    ttsUtterance = null;
  };

  window.speechSynthesis.speak(ttsUtterance);
}

/**
 * Stop the current TTS playback and reset the button state.
 */
function stopTTS() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  ttsActive = false;
  ttsUtterance = null;
  if (btnTTS) {
    btnTTS.setAttribute('aria-label', 'Read article aloud');
    btnTTS.classList.remove('btn--tts-active');
  }
}

/**
 * Toggle TTS on or off. If currently speaking, stops; otherwise starts.
 */
function toggleTTS() {
  if (ttsActive) {
    stopTTS();
  } else {
    startTTS();
  }
}

// ---------------------------------------------------------------------------
// Show / Hide Reader View
// ---------------------------------------------------------------------------

/**
 * Load and display an article in the reader view.
 * Called when `aeon:show-article` is dispatched by `app.js`.
 *
 * @param {string} articleId - The article slug to display.
 */
async function showArticle(articleId) {
  // Show a loading state while fetching
  readerArticle.innerHTML = '<p class="reader-loading" aria-live="polite">Loading…</p>';

  try {
    const article = await fetchArticle(articleId);
    renderArticle(article);
  } catch (err) {
    console.error('[Reader] Failed to load article:', err);
    readerArticle.innerHTML = '<p class="reader-error" role="alert">Could not load article. Please go back and try again.</p>';
    window.AeonApp.showToast('Failed to load article', 'error');
  }
}

/**
 * Clean up reader-specific state when leaving the reader view.
 * Called when `aeon:show-feed` is dispatched.
 */
function onLeavingReader() {
  releaseWakeLock();

  if (focusModeActive) {
    disableFocusMode();
  }

  // Stop auto-scroll if running
  if (autoScrollActive) {
    stopAutoScroll();
  }

  // Stop TTS if speaking
  if (ttsActive) {
    stopTTS();
  }

  // Reset document title
  document.title = 'Aeon Reader';

  currentArticle = null;
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/** Initialise all reader event listeners. */
function init() {
  // Article loaded / view shown
  document.addEventListener('aeon:show-article', (event) => {
    showArticle(event.detail.articleId);
  });

  // Leaving reader view
  document.addEventListener('aeon:show-feed', onLeavingReader);

  // Back button
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      window.AeonApp.navigateToFeed();
    });
  }

  // Share button
  if (btnShare) {
    btnShare.addEventListener('click', shareArticle);
  }

  // TTS button
  if (btnTTS) {
    btnTTS.addEventListener('click', toggleTTS);
  }

  // Scroll-to-top button
  if (btnScrollTop) {
    btnScrollTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Scroll handler — only active when reader view is visible
  window.addEventListener('scroll', () => {
    const readerView = document.getElementById('view-reader');
    if (readerView && !readerView.hasAttribute('hidden')) {
      handleReaderScroll();
      // Pause auto-scroll briefly when the user scrolls manually
      if (autoScrollActive) {
        onManualScrollDuringAutoScroll();
      }
    }
  }, { passive: true });

  // Touch swipe (back gesture)
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchend',   onTouchEnd,   { passive: true });

  // Focus mode toggle event from settings.js
  document.addEventListener('aeon:focus-mode-changed', (event) => {
    if (event.detail.enabled) {
      enableFocusMode();
    } else {
      disableFocusMode();
    }
  });

  // Auto-scroll toggle event from settings.js
  document.addEventListener('aeon:auto-scroll-changed', (event) => {
    if (event.detail.enabled) {
      startAutoScroll();
    } else {
      stopAutoScroll();
    }
  });

  // Auto-scroll speed change event from settings.js
  document.addEventListener('aeon:auto-scroll-speed-changed', (event) => {
    setAutoScrollSpeed(event.detail.speed);
  });

  // Initialise TTS (show button if API is available)
  initTTS();
}

init();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

window.AeonReader = {
  showArticle,
  enableFocusMode,
  disableFocusMode,
  startAutoScroll,
  stopAutoScroll,
  setAutoScrollSpeed,
  startTTS,
  stopTTS,
  toggleTTS,
  getCurrentArticle: () => currentArticle,
};
