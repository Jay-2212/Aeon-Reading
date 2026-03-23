# Agent Instructions — Aeon Reader

> **Purpose:** This file contains mandatory guidelines for every AI agent that works on this repository.
> Read this file in its entirety before making any changes. These rules exist to ensure consistency,
> quality, and continuity across multiple agent sessions.

---

## 1. Before You Begin

1. **Read the Engineering Plan.** Open `ENGINEERING_PLAN.md` and read the section for the phase(s)
   you are about to implement. Do not guess — every design decision (selectors, data shapes,
   colour values, API contracts) is specified there.

2. **Read the Logbook.** Open `LOGBOOK.md` and read the most recent entry. The previous agent
   will have left a handover note telling you:
   - Which phases are complete
   - What files were created or modified
   - Any known issues or gotchas
   - Which phase to start with and where exactly to pick up

3. **Check existing code.** Before creating any file, verify it does not already exist. If it does,
   read it before editing to understand what has already been done.

---

## 2. Documentation Requirements (Mandatory)

Every file you create **must** be documented. These are not optional.

### Python files
- Module-level docstring explaining the file's purpose, its inputs, and its outputs.
- Function-level docstrings for every public function using the Google docstring style:
  ```python
  def my_function(arg1: str, arg2: int) -> bool:
      """
      One-line summary.

      Longer description if needed.

      Args:
          arg1: Description of arg1.
          arg2: Description of arg2.

      Returns:
          True if …, False otherwise.

      Raises:
          ValueError: If arg1 is empty.
      """
  ```
- Inline comments for any non-obvious logic block.
- Type hints on every function signature.

### JavaScript files
- File-level JSDoc comment explaining the module's role:
  ```javascript
  /**
   * @fileoverview Description of what this module does.
   * @module moduleName
   */
  ```
- JSDoc block comment on every exported function or class:
  ```javascript
  /**
   * Brief description.
   *
   * @param {string} id - Article identifier.
   * @returns {Promise<Article>} The loaded article data.
   */
  ```
- Inline `//` comments for non-obvious logic.

### CSS files
- Section divider comments for every logical group:
  ```css
  /* =========================================================
     Section Name
     ========================================================= */
  ```
- A brief comment above any non-obvious rule explaining why it exists.

### HTML files
- HTML comments (`<!-- ... -->`) separating major structural sections.
- ARIA attributes documented with an inline comment if their purpose is not self-evident.

### Workflow YAML files
- A comment at the top of the file explaining when and why it runs.
- A comment above each `step` explaining what it does.

---

## 3. Testing Requirements (Mandatory)

Every phase you implement **must** have corresponding tests.

### Python (Phase 1 and any future backend scripts)
- Tests live in `tests/test_<module_name>.py`.
- Use **pytest** as the test runner.
- Use `unittest.mock` (`patch`, `MagicMock`) to mock all HTTP requests — tests must never make
  real network calls.
- Aim for ≥ 80 % line coverage of every Python module you write.
- Group tests into classes by the function being tested, e.g. `class TestParseFeed:`.
- Each test method must have a docstring explaining what it asserts.

### JavaScript (Phases 2–9)
- Tests live in `tests/js/test_<module_name>.test.js`.
- If no test runner is set up yet, create a minimal `package.json` and install **vitest** or
  **jest** (prefer **vitest** as it is lighter).
- Mock `fetch`, `localStorage`, and DOM APIs as needed.
- At a minimum, unit-test every pure function (data transformation, calculation, parsing).

### What must be tested (minimum bar for each phase)
| Phase | Must test |
|-------|-----------|
| 1 | RSS parsing, slug extraction, HTML sanitisation, reading-time calculation, diff logic, JSON read/write |
| 2 | pages.yml renders to a valid YAML (lint); manifest.webmanifest has required fields |
| 3 | `renderCard()` produces expected HTML; hash router dispatches correct views |
| 4 | Reading-progress calculation; "X min left" countdown; scroll-to-top visibility threshold |
| 5 | Theme/font/size settings are applied and persisted to `localStorage` |
| 6 | Settings panel open/close; each setting updates `localStorage` and the DOM |
| 7 | `triggerWorkflowDispatch` constructs correct request; polling stops when ETag changes |
| 8 | Service worker caches correct resources; offline fallback returns cached data |
| 9 | Focus mode toggles paragraph opacity; swipe gesture is detected correctly |

---

## 4. Code Quality Rules

- **No magic numbers.** Extract them into named constants with descriptive names.
- **No inline styles in JS.** Apply styles via CSS classes; JS only adds/removes classes.
- **No alert() or console.log() in production code.** Use the toast notification system for user
  messages; remove or replace debug logs before committing.
- **Accessibility first.** Every interactive element must have an accessible name (`aria-label`,
  `aria-labelledby`, or visible text). All colour pairs must meet WCAG AA contrast.
- **Progressive enhancement.** The app should degrade gracefully if the Service Worker, Wake Lock,
  or Share API is unavailable (feature detection, not assumption).
- **Security.** Never set `innerHTML` from a live-fetched external URL. Article HTML is pre-sanitised
  server-side (in `fetch_articles.py`) and read from static JSON. See `ENGINEERING_PLAN.md §14`.

---

## 5. Git & PR Workflow

- Commit after completing each **phase** (not each file).
- Commit message format: `feat(phaseN): brief description` e.g. `feat(phase1): add data pipeline script and tests`.
- After finishing all phases in your session, call `report_progress` to push and update the PR.
- Update `LOGBOOK.md` **as the very last step** before calling `report_progress`.

---

## 6. Picking Up Where the Previous Agent Left Off

1. Read `LOGBOOK.md` → find the last entry → note the "Next agent should start at" line.
2. Identify the corresponding phase in `ENGINEERING_PLAN.md §16`.
3. Check the checklist items for that phase — some may already be done; start from the first
   unchecked item.
4. If you are unsure whether a checklist item is done, inspect the relevant file.

---

## 7. Updating the Logbook

When you have finished your session, append a new entry to `LOGBOOK.md` using the template
described in that file. Your entry **must** include:

- Which phases you completed (with ✅)
- Which phases are partially done (with 🔄) and what is left
- Files created or significantly modified
- Any known issues, workarounds, or technical debt
- A "Next agent should start at" recommendation with a specific phase and sub-task
- A "Good luck" note if you have any advice for the next agent

---

## 8. Directory & File Layout Reference

Follow the layout in `ENGINEERING_PLAN.md §15` exactly. Key points:
- All styles → `styles/`
- All JS → `js/` (except Service Worker `js/sw.js` which is served from root via `scope`)
- All generated data → `data/`
- Python scripts → `scripts/`
- GitHub Actions workflows → `.github/workflows/`
- Tests → `tests/` (Python) and `tests/js/` (JavaScript)
- Assets → `assets/icons/` for PWA icons, `assets/placeholder.svg` for image placeholder

---

*End of Agent Instructions*
