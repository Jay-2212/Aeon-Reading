/**
 * @fileoverview Aeon Reader — settings.js
 * =========================================
 * Phase 6: Settings Panel
 *
 * This module manages the settings bottom sheet drawer and the in-reader
 * quick settings sheet. It handles:
 *   - Opening and closing both bottom sheets (with animations and backdrop).
 *   - Theme selection (4 pill buttons in both sheets).
 *   - Font family selection (4 pill buttons).
 *   - Font size slider (synchronised between main settings and reader sheet).
 *   - Line spacing toggle (Comfortable / Compact).
 *   - Drop cap toggle.
 *   - GitHub PAT input (save and clear).
 *   - "Clear cached data" button (clears Service Worker cache + localStorage).
 *   - Focus mode toggle (in-reader sheet).
 *
 * All changes are applied immediately (live preview) and persisted to localStorage.
 *
 * @module settings
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** localStorage key for the saved GitHub Personal Access Token. */
const LS_PAT = 'aeon_github_pat';

/** Line height value for "comfortable" spacing. */
const SPACING_COMFORTABLE = 1.75;

/** Line height value for "compact" spacing. */
const SPACING_COMPACT = 1.5;

// ---------------------------------------------------------------------------
// DOM References — Main Settings Sheet
// ---------------------------------------------------------------------------

const settingsBackdrop      = document.getElementById('settings-backdrop');
const settingsSheet         = document.getElementById('settings-sheet');
const btnOpenSettings       = document.getElementById('btn-settings');
const btnCloseSettings      = document.getElementById('btn-close-settings');

const themePills            = document.getElementById('theme-pills');
const fontPills             = document.getElementById('font-pills');
const fontSizeSlider        = document.getElementById('font-size-slider');
const spacingComfortableBtn = document.getElementById('spacing-comfortable');
const spacingCompactBtn     = document.getElementById('spacing-compact');
const dropCapToggle         = document.getElementById('drop-cap-toggle');
const patInput              = document.getElementById('pat-input');
const btnSavePat            = document.getElementById('btn-save-pat');
const btnClearPat           = document.getElementById('btn-clear-pat');
const btnClearCache         = document.getElementById('btn-clear-cache');

// ---------------------------------------------------------------------------
// DOM References — Reader Settings Sheet
// ---------------------------------------------------------------------------

const readerSettingsBackdrop  = document.getElementById('reader-settings-backdrop');
const readerSettingsSheet     = document.getElementById('reader-settings-sheet');
const btnOpenReaderSettings   = document.getElementById('btn-reader-menu');
const btnCloseReaderSettings  = document.getElementById('btn-close-reader-settings');

const readerThemePills        = document.getElementById('reader-theme-pills');
const readerFontSizeSlider    = document.getElementById('reader-font-size-slider');
const focusModeToggle         = document.getElementById('focus-mode-toggle');
const autoScrollToggle        = document.getElementById('auto-scroll-toggle');
const autoScrollSpeedGroup    = document.getElementById('auto-scroll-speed-group');
const autoScrollSpeedSlider   = document.getElementById('auto-scroll-speed-slider');

// ---------------------------------------------------------------------------
// DOM References — PAT Prompt Sheet
// ---------------------------------------------------------------------------

const patBackdrop       = document.getElementById('pat-backdrop');
const patSheet          = document.getElementById('pat-sheet');
const patPromptInput    = document.getElementById('pat-prompt-input');
const btnSavePatPrompt  = document.getElementById('btn-save-pat-prompt');

// ---------------------------------------------------------------------------
// Bottom Sheet Helpers
// ---------------------------------------------------------------------------

/**
 * Open a bottom sheet by removing its `hidden` attribute and showing the backdrop.
 * Also updates the triggering button's `aria-expanded` state.
 *
 * @param {HTMLElement} sheet    - The bottom sheet element.
 * @param {HTMLElement} backdrop - The backdrop element.
 * @param {HTMLElement} [triggerBtn] - The button that opened the sheet (for aria-expanded).
 */
function openSheet(sheet, backdrop, triggerBtn) {
  backdrop.removeAttribute('hidden');
  sheet.removeAttribute('hidden');
  if (triggerBtn) {
    triggerBtn.setAttribute('aria-expanded', 'true');
  }
  // Trap focus inside the sheet
  trapFocus(sheet);
}

/**
 * Close a bottom sheet by adding the `hidden` attribute and hiding the backdrop.
 * Also restores the triggering button's `aria-expanded` state.
 *
 * @param {HTMLElement} sheet    - The bottom sheet element.
 * @param {HTMLElement} backdrop - The backdrop element.
 * @param {HTMLElement} [triggerBtn] - The button that opened the sheet.
 */
function closeSheet(sheet, backdrop, triggerBtn) {
  sheet.setAttribute('hidden', '');
  backdrop.setAttribute('hidden', '');
  if (triggerBtn) {
    triggerBtn.setAttribute('aria-expanded', 'false');
    triggerBtn.focus();
  }
}

/**
 * Move focus to the first focusable element inside a bottom sheet.
 * This implements basic focus trapping for accessibility.
 *
 * @param {HTMLElement} container - The bottom sheet container element.
 */
function trapFocus(container) {
  const focusable = container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length > 0) {
    focusable[0].focus();
  }
}

// ---------------------------------------------------------------------------
// Pill Group Helpers
// ---------------------------------------------------------------------------

/**
 * Update the active pill in a pill group container.
 * Sets `aria-pressed="true"` and `.pill--active` on the matching pill,
 * and `aria-pressed="false"` + removes `.pill--active` from all others.
 *
 * @param {HTMLElement} container - The `.pill-group` container element.
 * @param {string}      attrName  - The data attribute name to match (e.g. 'themeValue').
 * @param {string}      value     - The value to mark as active.
 */
function setActivePill(container, attrName, value) {
  if (!container) return;
  container.querySelectorAll('.pill').forEach(pill => {
    const isActive = pill.dataset[attrName] === value;
    pill.classList.toggle('pill--active', isActive);
    pill.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

/**
 * Synchronise the active pill in all pill groups that share the same data attribute.
 * Used to keep the main settings and reader settings theme pickers in sync.
 *
 * @param {string} attrName - The data attribute name (e.g. 'themeValue').
 * @param {string} value    - The value to mark as active.
 */
function syncAllPills(attrName, value) {
  document.querySelectorAll(`.pill[data-${camelToKebab(attrName)}]`).forEach(pill => {
    const isActive = pill.dataset[attrName] === value;
    pill.classList.toggle('pill--active', isActive);
    pill.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

/**
 * Convert a camelCase data attribute name to its kebab-case HTML attribute form.
 * E.g. 'themeValue' → 'theme-value'.
 *
 * @param {string} str - camelCase string.
 * @returns {string} kebab-case string.
 */
function camelToKebab(str) {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}

// ---------------------------------------------------------------------------
// Theme Pill Listeners
// ---------------------------------------------------------------------------

/**
 * Attach click listeners to all theme pill buttons in the given container.
 * On click, applies the theme and syncs all pill groups.
 *
 * @param {HTMLElement|null} container - The `.pill-group` container.
 */
function attachThemePillListeners(container) {
  if (!container) return;
  container.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill[data-theme-value]');
    if (!pill) return;
    const theme = pill.dataset.themeValue;
    window.AeonApp.applyTheme(theme);
    syncAllPills('themeValue', theme);
  });
}

/**
 * Attach click listeners to all font pill buttons in the given container.
 *
 * @param {HTMLElement|null} container - The `.pill-group` container.
 */
function attachFontPillListeners(container) {
  if (!container) return;
  container.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill[data-font-value]');
    if (!pill) return;
    const font = pill.dataset.fontValue;
    window.AeonApp.applyFont(font);
    setActivePill(container, 'fontValue', font);
  });
}

// ---------------------------------------------------------------------------
// Font Size Slider Synchronisation
// ---------------------------------------------------------------------------

/**
 * Update both font-size sliders (main settings + reader sheet) to reflect `value`.
 *
 * @param {number} value - The new font-scale value.
 */
function syncFontSizeSliders(value) {
  if (fontSizeSlider)       fontSizeSlider.value       = value;
  if (readerFontSizeSlider) readerFontSizeSlider.value = value;
}

// ---------------------------------------------------------------------------
// Stored Preference Restoration
// ---------------------------------------------------------------------------

/**
 * Restore all settings UI controls to reflect the currently saved preferences.
 * Called once on initialisation so the controls match what's already applied.
 */
function restoreUIFromStorage() {
  const theme        = localStorage.getItem('aeon_theme')          || 'sepia';
  const font         = localStorage.getItem('aeon_font')           || 'lora';
  const scale        = localStorage.getItem('aeon_font_scale')     || '1';
  const spacing      = localStorage.getItem('aeon_line_spacing')   || String(SPACING_COMFORTABLE);
  const dropCap      = localStorage.getItem('aeon_drop_cap')       === 'true';
  const pat          = localStorage.getItem(LS_PAT)                || '';
  const autoScroll   = localStorage.getItem('aeon_auto_scroll')    === 'true';
  const scrollSpeed  = parseInt(localStorage.getItem('aeon_auto_scroll_speed') || '2', 10);

  // Theme pills (both sheets)
  syncAllPills('themeValue', theme);

  // Font pills
  setActivePill(fontPills, 'fontValue', font);

  // Font size sliders
  syncFontSizeSliders(parseFloat(scale));

  // Spacing buttons
  const isComfortable = parseFloat(spacing) >= SPACING_COMFORTABLE;
  if (spacingComfortableBtn) {
    spacingComfortableBtn.classList.toggle('pill--active', isComfortable);
    spacingComfortableBtn.setAttribute('aria-pressed', isComfortable ? 'true' : 'false');
  }
  if (spacingCompactBtn) {
    spacingCompactBtn.classList.toggle('pill--active', !isComfortable);
    spacingCompactBtn.setAttribute('aria-pressed', isComfortable ? 'false' : 'true');
  }

  // Drop cap toggle
  if (dropCapToggle) {
    dropCapToggle.checked = dropCap;
  }

  // Auto-scroll toggle and speed slider
  if (autoScrollToggle) {
    autoScrollToggle.checked = autoScroll;
  }
  if (autoScrollSpeedSlider) {
    autoScrollSpeedSlider.value = String(scrollSpeed);
  }
  if (autoScrollSpeedGroup) {
    if (autoScroll) {
      autoScrollSpeedGroup.removeAttribute('hidden');
    } else {
      autoScrollSpeedGroup.setAttribute('hidden', '');
    }
  }

  // PAT input (show masked placeholder if token exists)
  if (patInput) {
    patInput.placeholder = pat ? 'Token saved (tap Clear to remove)' : 'github_pat_…';
    patInput.value = '';
  }
}

// ---------------------------------------------------------------------------
// PAT Management
// ---------------------------------------------------------------------------

/**
 * Save a GitHub Personal Access Token to localStorage.
 *
 * @param {string} token - The PAT to save.
 */
function savePat(token) {
  const trimmed = token.trim();
  if (!trimmed) {
    window.AeonApp.showToast('Please enter a token', 'error');
    return;
  }
  localStorage.setItem(LS_PAT, trimmed);
  window.AeonApp.showToast('Token saved');
  if (patInput) {
    patInput.value       = '';
    patInput.placeholder = 'Token saved (tap Clear to remove)';
  }
}

/**
 * Clear the saved GitHub Personal Access Token from localStorage.
 */
function clearPat() {
  localStorage.removeItem(LS_PAT);
  window.AeonApp.showToast('Token cleared');
  if (patInput) {
    patInput.value       = '';
    patInput.placeholder = 'github_pat_…';
  }
}

// ---------------------------------------------------------------------------
// Clear Cache
// ---------------------------------------------------------------------------

/**
 * Clear all Service Worker caches and relevant localStorage keys.
 * After clearing, reloads the page so a fresh load is performed.
 */
async function clearAllCache() {
  // Clear Service Worker caches
  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => caches.delete(name)));
  }

  // Remove non-setting localStorage keys (keep preferences)
  // Currently there is no article-specific localStorage data in Phase 1–8

  window.AeonApp.showToast('Cache cleared. Reloading…');

  // Reload after a brief pause so the toast is readable
  setTimeout(() => location.reload(), 1500);
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/** Attach all settings event listeners and restore UI from storage. */
function init() {
  // ---- Main Settings Sheet ----

  // Open / close
  if (btnOpenSettings) {
    btnOpenSettings.addEventListener('click', () => openSheet(settingsSheet, settingsBackdrop, btnOpenSettings));
  }
  if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', () => closeSheet(settingsSheet, settingsBackdrop, btnOpenSettings));
  }
  if (settingsBackdrop) {
    settingsBackdrop.addEventListener('click', () => closeSheet(settingsSheet, settingsBackdrop, btnOpenSettings));
  }

  // Theme pills
  attachThemePillListeners(themePills);

  // Font pills
  attachFontPillListeners(fontPills);

  // Font size slider
  if (fontSizeSlider) {
    fontSizeSlider.addEventListener('input', () => {
      const value = parseFloat(fontSizeSlider.value);
      window.AeonApp.applyFontScale(value);
      syncFontSizeSliders(value);
    });
  }

  // Line spacing toggle
  if (spacingComfortableBtn) {
    spacingComfortableBtn.addEventListener('click', () => {
      window.AeonApp.applyLineSpacing(SPACING_COMFORTABLE);
      spacingComfortableBtn.classList.add('pill--active');
      spacingComfortableBtn.setAttribute('aria-pressed', 'true');
      spacingCompactBtn.classList.remove('pill--active');
      spacingCompactBtn.setAttribute('aria-pressed', 'false');
    });
  }
  if (spacingCompactBtn) {
    spacingCompactBtn.addEventListener('click', () => {
      window.AeonApp.applyLineSpacing(SPACING_COMPACT);
      spacingCompactBtn.classList.add('pill--active');
      spacingCompactBtn.setAttribute('aria-pressed', 'true');
      spacingComfortableBtn.classList.remove('pill--active');
      spacingComfortableBtn.setAttribute('aria-pressed', 'false');
    });
  }

  // Drop cap toggle
  if (dropCapToggle) {
    dropCapToggle.addEventListener('change', () => {
      const enabled = dropCapToggle.checked;
      localStorage.setItem('aeon_drop_cap', String(enabled));
      // Apply to the active reader body if visible
      const bodyDiv = document.getElementById('reader-body');
      if (bodyDiv) {
        bodyDiv.classList.toggle('drop-cap', enabled);
      }
    });
  }

  // PAT save / clear
  if (btnSavePat) {
    btnSavePat.addEventListener('click', () => savePat(patInput ? patInput.value : ''));
  }
  if (btnClearPat) {
    btnClearPat.addEventListener('click', clearPat);
  }

  // PAT input — save on Enter
  if (patInput) {
    patInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') savePat(patInput.value);
    });
  }

  // Clear cache
  if (btnClearCache) {
    btnClearCache.addEventListener('click', clearAllCache);
  }

  // Close settings on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (settingsSheet && !settingsSheet.hasAttribute('hidden')) {
        closeSheet(settingsSheet, settingsBackdrop, btnOpenSettings);
      }
      if (readerSettingsSheet && !readerSettingsSheet.hasAttribute('hidden')) {
        closeSheet(readerSettingsSheet, readerSettingsBackdrop, btnOpenReaderSettings);
      }
      if (patSheet && !patSheet.hasAttribute('hidden')) {
        closeSheet(patSheet, patBackdrop, null);
      }
    }
  });

  // ---- In-Reader Settings Sheet ----

  if (btnOpenReaderSettings) {
    btnOpenReaderSettings.addEventListener('click', () =>
      openSheet(readerSettingsSheet, readerSettingsBackdrop, btnOpenReaderSettings)
    );
  }
  if (btnCloseReaderSettings) {
    btnCloseReaderSettings.addEventListener('click', () =>
      closeSheet(readerSettingsSheet, readerSettingsBackdrop, btnOpenReaderSettings)
    );
  }
  if (readerSettingsBackdrop) {
    readerSettingsBackdrop.addEventListener('click', () =>
      closeSheet(readerSettingsSheet, readerSettingsBackdrop, btnOpenReaderSettings)
    );
  }

  // Reader theme pills (synced with main settings)
  attachThemePillListeners(readerThemePills);

  // Reader font size slider
  if (readerFontSizeSlider) {
    readerFontSizeSlider.addEventListener('input', () => {
      const value = parseFloat(readerFontSizeSlider.value);
      window.AeonApp.applyFontScale(value);
      syncFontSizeSliders(value);
    });
  }

  // Focus mode toggle
  if (focusModeToggle) {
    focusModeToggle.addEventListener('change', () => {
      document.dispatchEvent(new CustomEvent('aeon:focus-mode-changed', {
        detail: { enabled: focusModeToggle.checked },
      }));
    });
  }

  // Auto-scroll toggle — enables/disables teleprompter mode
  if (autoScrollToggle) {
    autoScrollToggle.addEventListener('change', () => {
      const enabled = autoScrollToggle.checked;

      // Show or hide the speed slider based on the toggle state
      if (autoScrollSpeedGroup) {
        if (enabled) {
          autoScrollSpeedGroup.removeAttribute('hidden');
        } else {
          autoScrollSpeedGroup.setAttribute('hidden', '');
        }
      }

      document.dispatchEvent(new CustomEvent('aeon:auto-scroll-changed', {
        detail: { enabled },
      }));
    });
  }

  // Auto-scroll speed slider
  if (autoScrollSpeedSlider) {
    autoScrollSpeedSlider.addEventListener('input', () => {
      const speed = parseInt(autoScrollSpeedSlider.value, 10);
      document.dispatchEvent(new CustomEvent('aeon:auto-scroll-speed-changed', {
        detail: { speed },
      }));
    });
  }

  // ---- PAT Prompt Sheet ----

  if (patBackdrop) {
    patBackdrop.addEventListener('click', () => closeSheet(patSheet, patBackdrop, null));
  }
  if (btnSavePatPrompt) {
    btnSavePatPrompt.addEventListener('click', () => {
      const token = patPromptInput ? patPromptInput.value : '';
      savePat(token);
      closeSheet(patSheet, patBackdrop, null);
      // Trigger refresh after saving PAT
      if (window.AeonAPI && typeof window.AeonAPI.triggerRefresh === 'function') {
        window.AeonAPI.triggerRefresh();
      }
    });
  }
  if (patPromptInput) {
    patPromptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && btnSavePatPrompt) {
        btnSavePatPrompt.click();
      }
    });
  }

  // ---- Restore UI from Storage ----
  restoreUIFromStorage();
}

init();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

window.AeonSettings = {
  openPatPrompt: () => openSheet(patSheet, patBackdrop, null),
  savePat,
  clearPat,
  getSavedPat: () => localStorage.getItem(LS_PAT) || '',
};
