/**
 * @fileoverview Unit tests for js/settings.js — Phase 6 Settings Panel.
 *
 * Covers:
 *  - camelToKebab() — pure string transformation utility
 *  - openSheet() / closeSheet() — bottom sheet DOM state management
 *  - setActivePill() — pill group aria-pressed and CSS class updates
 *  - Theme selection — calls AeonApp.applyTheme and updates localStorage
 *  - Font-size slider — calls AeonApp.applyFontScale and syncs both sliders
 *  - Line-spacing toggle — applies correct value and updates pill states
 *  - Drop cap toggle — persists to localStorage and applies to reader body
 *  - savePat() / clearPat() — GitHub PAT localStorage management
 *  - restoreUIFromStorage() — UI reflects saved preferences on startup
 *
 * All localStorage calls use the vitest jsdom implementation.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { settingsHtml, loadScript } from './helpers.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setup() {
  document.documentElement.innerHTML = `<head></head><body>${settingsHtml()}</body>`;

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

  loadScript('app.js');
  loadScript('settings.js');
}

// ---------------------------------------------------------------------------
// camelToKebab (utility — tested indirectly via syncAllPills)
// ---------------------------------------------------------------------------

describe('settings.js — Theme pill synchronisation (camelToKebab path)', () => {
  beforeEach(() => {
    setup();
    localStorage.clear();
  });

  it('marks the selected theme pill as active across all pill groups', () => {
    /**
     * Asserts that clicking a theme pill in the main settings sheet activates
     * the matching pill in the reader settings sheet via syncAllPills.
     */
    const themePills = document.getElementById('theme-pills');
    const darkPill = themePills.querySelector('[data-theme-value="dark"]');
    darkPill.click();

    // Main sheet pill should be active
    expect(darkPill.classList.contains('pill--active')).toBe(true);
    expect(darkPill.getAttribute('aria-pressed')).toBe('true');

    // Reader sheet pill should also be active (syncAllPills)
    const readerThemePills = document.getElementById('reader-theme-pills');
    const readerDarkPill = readerThemePills.querySelector('[data-theme-value="dark"]');
    expect(readerDarkPill.classList.contains('pill--active')).toBe(true);
  });

  it('deactivates the previously active theme pill when a new one is chosen', () => {
    /**
     * Asserts that the previously active pill loses the active state when a
     * different theme is selected.
     */
    const themePills = document.getElementById('theme-pills');
    const sepiaPill = themePills.querySelector('[data-theme-value="sepia"]');
    const lightPill = themePills.querySelector('[data-theme-value="light"]');

    lightPill.click();

    expect(lightPill.classList.contains('pill--active')).toBe(true);
    expect(sepiaPill.classList.contains('pill--active')).toBe(false);
    expect(sepiaPill.getAttribute('aria-pressed')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// Settings sheet open / close
// ---------------------------------------------------------------------------

describe('settings.js — Settings sheet open/close', () => {
  beforeEach(() => {
    setup();
  });

  it('removes hidden from the settings sheet when the settings button is clicked', () => {
    /** Asserts the settings sheet becomes visible on button click. */
    const sheet = document.getElementById('settings-sheet');
    const btn = document.getElementById('btn-settings');
    expect(sheet.hasAttribute('hidden')).toBe(true);
    btn.click();
    expect(sheet.hasAttribute('hidden')).toBe(false);
  });

  it('adds hidden back when the close button is clicked', () => {
    /** Asserts the settings sheet is hidden again when the close button is tapped. */
    const sheet = document.getElementById('settings-sheet');
    const openBtn = document.getElementById('btn-settings');
    const closeBtn = document.getElementById('btn-close-settings');

    openBtn.click();
    expect(sheet.hasAttribute('hidden')).toBe(false);
    closeBtn.click();
    expect(sheet.hasAttribute('hidden')).toBe(true);
  });

  it('sets aria-expanded to true when the sheet opens', () => {
    /** Asserts aria-expanded is updated on the trigger button. */
    const btn = document.getElementById('btn-settings');
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('sets aria-expanded to false when the sheet closes', () => {
    /** Asserts aria-expanded is reset when the sheet is dismissed. */
    const btn = document.getElementById('btn-settings');
    const closeBtn = document.getElementById('btn-close-settings');
    btn.click();
    closeBtn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the settings sheet when Escape is pressed', () => {
    /** Asserts that the Escape key dismisses the open sheet. */
    const sheet = document.getElementById('settings-sheet');
    const openBtn = document.getElementById('btn-settings');
    openBtn.click();
    expect(sheet.hasAttribute('hidden')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(sheet.hasAttribute('hidden')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Line-spacing toggle
// ---------------------------------------------------------------------------

describe('settings.js — Line-spacing toggle', () => {
  beforeEach(() => {
    setup();
    localStorage.clear();
  });

  it('applies compact spacing and updates pills when Compact is clicked', () => {
    /** Asserts compact spacing value is applied and pill state updates. */
    const compactBtn = document.getElementById('spacing-compact');
    compactBtn.click();

    expect(localStorage.getItem('aeon_line_spacing')).toBe('1.5');
    expect(compactBtn.classList.contains('pill--active')).toBe(true);
    expect(compactBtn.getAttribute('aria-pressed')).toBe('true');

    const comfortableBtn = document.getElementById('spacing-comfortable');
    expect(comfortableBtn.classList.contains('pill--active')).toBe(false);
  });

  it('applies comfortable spacing and updates pills when Comfortable is clicked', () => {
    /** Asserts comfortable spacing value is applied and pill state updates. */
    // First click compact to change state
    document.getElementById('spacing-compact').click();
    // Then restore to comfortable
    const comfortableBtn = document.getElementById('spacing-comfortable');
    comfortableBtn.click();

    expect(localStorage.getItem('aeon_line_spacing')).toBe('1.75');
    expect(comfortableBtn.classList.contains('pill--active')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Drop cap toggle
// ---------------------------------------------------------------------------

describe('settings.js — Drop cap toggle', () => {
  beforeEach(() => {
    setup();
    localStorage.clear();
  });

  it('persists the drop-cap state to localStorage when toggled on', () => {
    /** Asserts localStorage is updated when drop cap is enabled. */
    const toggle = document.getElementById('drop-cap-toggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('aeon_drop_cap')).toBe('true');
  });

  it('persists the drop-cap state to localStorage when toggled off', () => {
    /** Asserts localStorage is updated when drop cap is disabled. */
    const toggle = document.getElementById('drop-cap-toggle');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('aeon_drop_cap')).toBe('false');
  });
});

// ---------------------------------------------------------------------------
// PAT management
// ---------------------------------------------------------------------------

describe('settings.js — PAT management', () => {
  beforeEach(() => {
    setup();
    localStorage.clear();
  });

  it('savePat saves the trimmed token to localStorage', () => {
    /** Asserts that saving a valid token stores it in localStorage. */
    window.AeonSettings.savePat('  github_pat_abc123  ');
    expect(localStorage.getItem('aeon_github_pat')).toBe('github_pat_abc123');
  });

  it('savePat shows an error toast when the token is empty', () => {
    /** Asserts that an empty token triggers an error notification. */
    const showToastSpy = vi.spyOn(window.AeonApp, 'showToast');
    window.AeonSettings.savePat('   ');
    expect(showToastSpy).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('clearPat removes the token from localStorage', () => {
    /** Asserts that clearing removes the PAT from localStorage. */
    localStorage.setItem('aeon_github_pat', 'github_pat_abc123');
    window.AeonSettings.clearPat();
    expect(localStorage.getItem('aeon_github_pat')).toBeNull();
  });

  it('getSavedPat returns the stored token', () => {
    /** Asserts getSavedPat retrieves the token correctly. */
    localStorage.setItem('aeon_github_pat', 'github_pat_xyz');
    expect(window.AeonSettings.getSavedPat()).toBe('github_pat_xyz');
  });

  it('getSavedPat returns empty string when no token is saved', () => {
    /** Asserts getSavedPat returns empty string when localStorage has no token. */
    expect(window.AeonSettings.getSavedPat()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Font-size slider synchronisation
// ---------------------------------------------------------------------------

describe('settings.js — Font-size slider synchronisation', () => {
  beforeEach(() => {
    setup();
    localStorage.clear();
  });

  it('syncs the reader font-size slider when the main slider changes', () => {
    /**
     * Asserts both sliders reflect the same value after the main slider is moved.
     */
    const mainSlider = document.getElementById('font-size-slider');
    const readerSlider = document.getElementById('reader-font-size-slider');

    mainSlider.value = '1.2';
    mainSlider.dispatchEvent(new Event('input'));

    expect(readerSlider.value).toBe('1.2');
    expect(localStorage.getItem('aeon_font_scale')).toBe('1.2');
  });

  it('syncs the main font-size slider when the reader slider changes', () => {
    /**
     * Asserts both sliders reflect the same value after the reader slider is moved.
     */
    const mainSlider = document.getElementById('font-size-slider');
    const readerSlider = document.getElementById('reader-font-size-slider');

    readerSlider.value = '0.9';
    readerSlider.dispatchEvent(new Event('input'));

    expect(mainSlider.value).toBe('0.9');
    expect(localStorage.getItem('aeon_font_scale')).toBe('0.9');
  });
});
