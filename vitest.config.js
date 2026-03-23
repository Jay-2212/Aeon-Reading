/**
 * @fileoverview Vitest configuration for Aeon Reader JavaScript unit tests.
 *
 * Uses the jsdom environment so that browser globals (window, document,
 * localStorage, navigator) are available when the app scripts are evaluated.
 * Tests live in tests/js/ and are matched by the *.test.js glob.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /** Use jsdom so browser globals are available in tests. */
    environment: 'jsdom',

    /** Where to find test files. */
    include: ['tests/js/**/*.test.js'],

    /** Global vitest helpers (describe, it, expect, vi) injected automatically. */
    globals: true,
  },
});
