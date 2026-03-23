/**
 * @fileoverview Unit tests for js/reader.js — Phase 4 Article Reader View.
 *
 * Covers:
 *  - calculateProgress() — correct scroll percentage calculation
 *  - updateCountdown() — "X min left" display at various scroll depths
 *  - updateScrollTopButton() — button visibility above/below 400 px threshold
 *  - Swipe gesture detection — right swipe from left edge navigates back
 *  - Reading progress bar — width reflects scroll percentage
 *
 * All scroll values are set via jsdom's scrollY property mock.
 * No real network calls are made.
 */

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readerHtml, loadScript } from './helpers.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Full article data object used across tests. */
const SAMPLE_ARTICLE_DATA = {
  id: 'the-age-of-the-brain',
  title: 'The Age of the Brain',
  author: 'Sally Davies',
  category: 'Philosophy',
  excerpt: 'A short excerpt.',
  imageUrl: '',
  imageAlt: '',
  readingTimeMinutes: 10,
  bodyHtml: '<p>Paragraph one.</p><p>Paragraph two.</p><p>Paragraph three.</p>',
  authorBio: 'Sally Davies is a writer.',
};

function setup() {
  document.documentElement.innerHTML = `<head></head><body>${readerHtml()}</body>`;

  // Stub matchMedia for app.js
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }),
  });

  // Stub serviceWorker
  Object.defineProperty(navigator, 'serviceWorker', {
    writable: true,
    value: { register: vi.fn().mockResolvedValue({ scope: './' }) },
  });

  // Stub fetch — used by showArticle()
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => SAMPLE_ARTICLE_DATA,
  });

  // Stub wakeLock
  Object.defineProperty(navigator, 'wakeLock', {
    writable: true,
    value: {
      request: vi.fn().mockResolvedValue({
        release: vi.fn().mockResolvedValue(undefined),
      }),
    },
  });

  // Stub IntersectionObserver
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    disconnect: vi.fn(),
    unobserve: vi.fn(),
  }));

  loadScript('app.js');
  loadScript('reader.js');
}

// ---------------------------------------------------------------------------
// Reading progress calculation
// ---------------------------------------------------------------------------

describe('reader.js — Reading progress calculation', () => {
  beforeEach(setup);

  it('returns 100 when the page is not scrollable', () => {
    /**
     * When scrollHeight equals innerHeight the document is not scrollable
     * and progress should be reported as 100%.
     */
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true, value: 800,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true, value: 800,
    });
    Object.defineProperty(window, 'scrollY', {
      configurable: true, value: 0,
    });

    // Progress bar receives 100 when not scrollable
    const bar = document.getElementById('reading-progress');
    // Trigger scroll event to exercise handler
    window.dispatchEvent(new Event('scroll'));
    // For a non-scrollable page the bar should reach 100%
    expect(bar.style.width).toBe('100%');
  });

  it('updates progress bar width proportionally to scroll position', () => {
    /**
     * At 50% scroll depth the progress bar width should be 50%.
     */
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true, value: 2000,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true, value: 1000,
    });
    Object.defineProperty(window, 'scrollY', {
      configurable: true, value: 500,
    });

    // Make reader view visible so the scroll handler fires
    const readerView = document.getElementById('view-reader');
    readerView.removeAttribute('hidden');

    window.dispatchEvent(new Event('scroll'));
    const bar = document.getElementById('reading-progress');
    expect(bar.style.width).toBe('50%');
  });
});

// ---------------------------------------------------------------------------
// Scroll-to-top button visibility
// ---------------------------------------------------------------------------

describe('reader.js — Scroll-to-top button visibility', () => {
  beforeEach(setup);

  it('hides the scroll-to-top button below the threshold', () => {
    /** Asserts the button is hidden when scrollY < 400. */
    const btn = document.getElementById('btn-scroll-top');
    const readerView = document.getElementById('view-reader');
    readerView.removeAttribute('hidden');

    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true, value: 2000,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true, value: 1000,
    });
    Object.defineProperty(window, 'scrollY', {
      configurable: true, value: 100,
    });

    window.dispatchEvent(new Event('scroll'));
    expect(btn.hasAttribute('hidden')).toBe(true);
  });

  it('shows the scroll-to-top button above the 400 px threshold', () => {
    /** Asserts the button becomes visible when scrollY > 400. */
    const btn = document.getElementById('btn-scroll-top');
    const readerView = document.getElementById('view-reader');
    readerView.removeAttribute('hidden');

    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true, value: 3000,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true, value: 1000,
    });
    Object.defineProperty(window, 'scrollY', {
      configurable: true, value: 450,
    });

    window.dispatchEvent(new Event('scroll'));
    expect(btn.hasAttribute('hidden')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// "X min left" countdown
// ---------------------------------------------------------------------------

describe('reader.js — Countdown display', () => {
  beforeEach(async () => {
    setup();
    // Load the article to populate currentArticle and #reader-time-display
    await window.AeonReader.showArticle('the-age-of-the-brain');
  });

  it('shows full reading time when progress is 0%', () => {
    /** Asserts the countdown shows the total reading time at the start. */
    const readerView = document.getElementById('view-reader');
    readerView.removeAttribute('hidden');

    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true, value: 2000,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true, value: 1000,
    });
    Object.defineProperty(window, 'scrollY', {
      configurable: true, value: 0,
    });

    window.dispatchEvent(new Event('scroll'));
    const timeDisplay = document.getElementById('reader-time-display');
    // At 0% scroll, should show ~10 min left (full reading time)
    expect(timeDisplay.textContent).toContain('min left');
  });

  it('shows "✓ Finished" when progress reaches 99%+', () => {
    /** Asserts "Finished" is displayed when the reader scrolls to the end. */
    const readerView = document.getElementById('view-reader');
    readerView.removeAttribute('hidden');

    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true, value: 1001,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true, value: 1000,
    });
    Object.defineProperty(window, 'scrollY', {
      configurable: true, value: 1000,
    });

    window.dispatchEvent(new Event('scroll'));
    const timeDisplay = document.getElementById('reader-time-display');
    expect(timeDisplay.textContent).toBe('✓ Finished');
  });
});

// ---------------------------------------------------------------------------
// Swipe gesture detection
// ---------------------------------------------------------------------------

describe('reader.js — Swipe gesture', () => {
  beforeEach(setup);

  it('calls navigateToFeed() on a right swipe from the left edge', () => {
    /** Asserts that swiping right from ≤30 px triggers back navigation. */
    const navigateSpy = vi.spyOn(window.AeonApp, 'navigateToFeed');
    // Reset call history that may have accumulated from previous test setups
    navigateSpy.mockClear();

    // Simulate touchstart at x=15 (left edge)
    document.dispatchEvent(new TouchEvent('touchstart', {
      touches: [{ clientX: 15, clientY: 300 }],
      bubbles: true,
    }));

    // Simulate touchend at x=120 (moved right by 105 px > threshold of 80)
    document.dispatchEvent(new TouchEvent('touchend', {
      changedTouches: [{ clientX: 120, clientY: 300 }],
      bubbles: true,
    }));

    expect(navigateSpy).toHaveBeenCalled();
  });

  it('does NOT navigate on a right swipe that starts far from the left edge', () => {
    /** Asserts swipes starting away from the left edge are ignored. */
    const navigateSpy = vi.spyOn(window.AeonApp, 'navigateToFeed');

    // Touchstart from middle of screen (x=200)
    document.dispatchEvent(new TouchEvent('touchstart', {
      touches: [{ clientX: 200, clientY: 300 }],
      bubbles: true,
    }));

    document.dispatchEvent(new TouchEvent('touchend', {
      changedTouches: [{ clientX: 320, clientY: 300 }],
      bubbles: true,
    }));

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does NOT navigate when the swipe distance is less than 80 px', () => {
    /** Asserts that a short swipe from the edge does not trigger navigation. */
    const navigateSpy = vi.spyOn(window.AeonApp, 'navigateToFeed');

    document.dispatchEvent(new TouchEvent('touchstart', {
      touches: [{ clientX: 10, clientY: 300 }],
      bubbles: true,
    }));

    document.dispatchEvent(new TouchEvent('touchend', {
      changedTouches: [{ clientX: 50, clientY: 300 }],
      bubbles: true,
    }));

    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Auto-scroll
// ---------------------------------------------------------------------------

describe('reader.js — Auto-scroll', () => {
  beforeEach(() => {
    setup();
    // Provide a minimal DOM with auto-scroll controls
    document.body.insertAdjacentHTML('beforeend', `
      <input type="checkbox" id="auto-scroll-toggle" />
      <div id="auto-scroll-speed-group" hidden></div>
    `);
    // Stub rAF to queue but NOT execute callbacks immediately.
    // This prevents autoScrollStep from running synchronously and calling stopAutoScroll.
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.AeonReader.stopAutoScroll();
  });

  it('sets aeon_auto_scroll to true in localStorage when started', () => {
    /** Asserts startAutoScroll persists the enabled state. */
    window.AeonReader.startAutoScroll();
    expect(localStorage.getItem('aeon_auto_scroll')).toBe('true');
  });

  it('sets aeon_auto_scroll to false in localStorage when stopped', () => {
    /** Asserts stopAutoScroll persists the disabled state. */
    window.AeonReader.startAutoScroll();
    window.AeonReader.stopAutoScroll();
    expect(localStorage.getItem('aeon_auto_scroll')).toBe('false');
  });

  it('checks the toggle when auto-scroll starts', () => {
    /** Asserts the toggle checkbox reflects the enabled state. */
    const toggle = document.getElementById('auto-scroll-toggle');
    window.AeonReader.startAutoScroll();
    expect(toggle.checked).toBe(true);
  });

  it('unchecks the toggle when auto-scroll stops', () => {
    /** Asserts the toggle checkbox reflects the disabled state. */
    const toggle = document.getElementById('auto-scroll-toggle');
    window.AeonReader.startAutoScroll();
    window.AeonReader.stopAutoScroll();
    expect(toggle.checked).toBe(false);
  });

  it('shows the speed slider group when auto-scroll starts', () => {
    /** Asserts the speed slider becomes visible when auto-scroll is enabled. */
    const speedGroup = document.getElementById('auto-scroll-speed-group');
    window.AeonReader.startAutoScroll();
    expect(speedGroup.hasAttribute('hidden')).toBe(false);
  });

  it('hides the speed slider group when auto-scroll stops', () => {
    /** Asserts the speed slider is hidden when auto-scroll is disabled. */
    const speedGroup = document.getElementById('auto-scroll-speed-group');
    window.AeonReader.startAutoScroll();
    window.AeonReader.stopAutoScroll();
    expect(speedGroup.hasAttribute('hidden')).toBe(true);
  });

  it('persists the speed level to localStorage via setAutoScrollSpeed', () => {
    /** Asserts the speed value is stored in localStorage. */
    window.AeonReader.setAutoScrollSpeed(4);
    expect(localStorage.getItem('aeon_auto_scroll_speed')).toBe('4');
  });

  it('clamps speed level to minimum 1', () => {
    /** Asserts speeds below 1 are clamped to 1. */
    window.AeonReader.setAutoScrollSpeed(0);
    expect(localStorage.getItem('aeon_auto_scroll_speed')).toBe('1');
  });

  it('clamps speed level to maximum 5', () => {
    /** Asserts speeds above 5 are clamped to 5. */
    window.AeonReader.setAutoScrollSpeed(10);
    expect(localStorage.getItem('aeon_auto_scroll_speed')).toBe('5');
  });
});

// ---------------------------------------------------------------------------
// Text-to-Speech
// ---------------------------------------------------------------------------

describe('reader.js — Text-to-Speech', () => {
  /** Shared mock utterance object used across all TTS tests. */
  let mockUtterance;

  beforeEach(async () => {
    // Stub speechSynthesis BEFORE loading reader.js so that initTTS() sees the API.
    mockUtterance = {
      onstart: null,
      onend: null,
      onerror: null,
      rate: 1,
      pitch: 1,
      lang: '',
    };
    vi.stubGlobal('SpeechSynthesisUtterance', vi.fn(() => mockUtterance));
    vi.stubGlobal('speechSynthesis', {
      speak: vi.fn(),
      cancel: vi.fn(),
    });

    setup();

    // Load an article so currentArticle is populated
    await window.AeonReader.showArticle('the-age-of-the-brain');
  });

  afterEach(() => {
    window.AeonReader.stopTTS();
    vi.unstubAllGlobals();
  });

  it('shows the TTS button when speechSynthesis is available', () => {
    /**
     * Asserts the TTS button is made visible when the Web Speech API is present.
     * Since speechSynthesis was stubbed before the script loaded, initTTS()
     * should have removed the hidden attribute.
     */
    const btn = document.getElementById('btn-tts');
    expect(btn.hasAttribute('hidden')).toBe(false);
  });

  it('calls speechSynthesis.speak() when startTTS is called', () => {
    /** Asserts the speech API is invoked when TTS is started. */
    window.AeonReader.startTTS();
    expect(window.speechSynthesis.speak).toHaveBeenCalledOnce();
  });

  it('calls speechSynthesis.cancel() when stopTTS is called', () => {
    /** Asserts the speech API is cancelled when TTS is stopped. */
    window.AeonReader.startTTS();
    window.AeonReader.stopTTS();
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });

  it('toggleTTS starts TTS when not currently active', () => {
    /** Asserts toggleTTS initiates playback when TTS is off. */
    window.AeonReader.stopTTS(); // Ensure TTS is off
    window.AeonReader.toggleTTS();
    expect(window.speechSynthesis.speak).toHaveBeenCalled();
  });
});
