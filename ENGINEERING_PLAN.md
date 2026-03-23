# Aeon Reader — Engineering Specification & Implementation Plan

> **Version:** 1.0 — Initial Ideation  
> **Goal:** A distraction-free, mobile-first reading web app that surfaces recent Aeon articles with a beautiful, comfortable reading experience, hosted entirely on GitHub Pages.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Data Model](#3-data-model)
4. [Article Fetching & Refresh Pipeline](#4-article-fetching--refresh-pipeline)
5. [Front-End Structure](#5-front-end-structure)
6. [Home Screen — Article Feed](#6-home-screen--article-feed)
7. [Reader View](#7-reader-view)
8. [Themes](#8-themes)
9. [Typography](#9-typography)
10. [Quality-of-Life Reading Features](#10-quality-of-life-reading-features)
11. [Settings Panel](#11-settings-panel)
12. [Performance & Offline Support](#12-performance--offline-support)
13. [GitHub Actions Workflow Specs](#13-github-actions-workflow-specs)
14. [Security & Secrets](#14-security--secrets)
15. [File & Directory Layout](#15-file--directory-layout)
16. [Phase-by-Phase Implementation Checklist](#16-phase-by-phase-implementation-checklist)
17. [Open Questions & Future Considerations](#17-open-questions--future-considerations)

---

## 1. Project Overview

### 1.1 Purpose

Aeon Reader is a progressive web app (PWA) that delivers Aeon's most recent 10–15 articles in a clean, distraction-free environment optimised for reading on Android phones (and any browser). Every pop-up, advertisement, subscription nag, and navigation clutter is stripped away, leaving only the title, cover image, and article body.

### 1.2 Guiding Principles

| Principle | Description |
|---|---|
| **Reading first** | Every decision — layout, colour, spacing, interactions — serves the act of reading. |
| **Minimal friction** | The app opens immediately to articles. No sign-in, no onboarding, no splash screen. |
| **Static hosting** | The app is a collection of plain files served by GitHub Pages. No server or database. |
| **Battery & data aware** | Incremental refresh fetches only new content; images are lazy-loaded; the app works offline after first load. |
| **Beautiful by default** | Thoughtful defaults: sepia theme, carefully chosen serif font, comfortable line length. The reader should not have to change anything to have a great experience. |

### 1.3 Target Platform

- Primary: Android Chrome (mobile browser, home-screen shortcut via PWA)
- Secondary: any modern desktop/mobile browser
- Hosted on: GitHub Pages (`https://<user>.github.io/Aeon-Reading-/`) — note: the trailing hyphen is part of the repository name.

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        GitHub Repository                     │
│                                                              │
│  ┌─────────────────────┐      ┌──────────────────────────┐  │
│  │  GitHub Actions      │      │  Static Files (gh-pages) │  │
│  │  (backend worker)    │      │                          │  │
│  │                      │      │  index.html              │  │
│  │  fetch-articles.yml  │─────▶│  data/articles.json      │  │
│  │  (scheduled + manual)│      │  data/article-<id>.json  │  │
│  │                      │      │  assets/…                │  │
│  └─────────────────────┘      └──────────────────────────┘  │
│                                         │                    │
└─────────────────────────────────────────│────────────────────┘
                                          │ GitHub Pages CDN
                                          ▼
                              ┌───────────────────────┐
                              │   User's Browser /    │
                              │   Android PWA         │
                              │                       │
                              │  • Reads articles.json│
                              │  • Renders feed       │
                              │  • Opens reader view  │
                              │  • Triggers refresh   │
                              │    via GitHub API     │
                              └───────────────────────┘
```

### 2.1 Why GitHub Actions as Backend

GitHub Pages serves only static files — it cannot run code at request time. The "backend" work (fetching Aeon's RSS feed, scraping article bodies, stripping distractions, storing results) is done by a **GitHub Actions workflow**. This workflow:

- Runs on a **schedule** (e.g. every 6 hours) automatically.
- Can also be **triggered manually** from the web app via the GitHub REST API (`workflow_dispatch` event), which is the Refresh button.

The output of the workflow is committed back to the repository as JSON files, which GitHub Pages then serves. The front end reads these JSON files.

### 2.2 Refresh Flow

```
User taps Refresh
      │
      ▼
Front end calls GitHub API
POST /repos/{owner}/{repo}/actions/workflows/fetch-articles.yml/dispatches
(Authorization: Bearer <PAT stored in localStorage>)
      │
      ▼
GitHub Actions workflow runs
  1. Fetch Aeon RSS feed
  2. Compare against existing articles.json → find new slugs
  3. For each new article: fetch full HTML, clean it, extract content + image
  4. Append to articles.json, write individual article-<id>.json files
  5. git commit + push to gh-pages branch
      │
      ▼
GitHub Pages CDN updates (usually < 60 seconds)
      │
      ▼
Front end polls articles.json every 10 s until etag changes
      │
      ▼
Feed updates with new articles (smooth prepend animation)
```

---

## 3. Data Model

### 3.1 `data/articles.json` — Feed Index

Top-level array of article summaries, newest first. This file is kept to a maximum of **15 entries** (oldest are pruned).

```jsonc
{
  "lastFetched": "2025-06-01T12:00:00Z",   // ISO timestamp of last successful fetch
  "articles": [
    {
      "id": "the-age-of-the-brain",          // URL slug, stable identifier
      "title": "The Age of the Brain",
      "author": "Sally Davies",
      "category": "Philosophy",              // Aeon section/category
      "publishedAt": "2025-05-30T10:00:00Z",
      "excerpt": "First two sentences…",
      "imageUrl": "https://…/cover.jpg",     // original CDN URL from Aeon
      "imageAlt": "A brain scan…",
      "readingTimeMinutes": 9,               // estimated, computed from word count
      "articleFile": "data/article-the-age-of-the-brain.json"
    }
    // … up to 15 entries
  ]
}
```

### 3.2 `data/article-<id>.json` — Full Article

```jsonc
{
  "id": "the-age-of-the-brain",
  "title": "The Age of the Brain",
  "author": "Sally Davies",
  "authorBio": "Sally Davies is a philosopher…",
  "category": "Philosophy",
  "publishedAt": "2025-05-30T10:00:00Z",
  "imageUrl": "https://…/cover.jpg",
  "imageAlt": "A brain scan…",
  "readingTimeMinutes": 9,
  "bodyHtml": "<p>The first paragraph…</p>…"  // sanitised HTML, no scripts/ads
}
```

`bodyHtml` rules (enforced during scraping):

- Allowed tags: `<p>`, `<h2>`, `<h3>`, `<blockquote>`, `<em>`, `<strong>`, `<a>`, `<ul>`, `<ol>`, `<li>`, `<figure>`, `<img>`, `<figcaption>`, `<hr>`
- All `<a>` tags get `target="_blank" rel="noopener noreferrer"`
- Inline `style` attributes stripped
- `<script>`, `<iframe>`, `<form>`, `<button>`, `<input>`, social sharing widgets, newsletter sign-up sections removed
- Image `src` attributes preserved (pointing to Aeon's CDN)

---

## 4. Article Fetching & Refresh Pipeline

### 4.1 Aeon RSS Feed

Aeon publishes a public RSS/Atom feed at `https://aeon.co/feed.rss`. This feed provides:

- Article title
- Author
- Category/tag
- Excerpt
- Cover image (in `<media:content>` or `<enclosure>`)
- Publication date
- Canonical URL (from which the slug is extracted)

The workflow will parse this feed to get the list of recent articles (up to 15).

### 4.2 Full Article Scraping (within GitHub Actions)

For each article that is **not already in** `articles.json`, the workflow will:

1. Fetch the canonical Aeon article URL (`https://aeon.co/essays/<slug>` or similar).
2. Parse the HTML with a Python script (`lxml` / `html5lib` + `bleach` for sanitisation, or Node.js + `node-html-parser` + `dompurify`).
3. Extract:
   - The main article body (`<article>` element or CSS selector `.article__body` / `.essay-body`).
   - The hero/cover image and alt text.
   - Author bio if present in a `<aside>` or author block.
4. Strip all non-content elements (nav, header, footer, sidebars, `[class*="subscription"]`, `[class*="newsletter"]`, `[class*="paywall"]`, `[class*="popup"]`, `[class*="modal"]`, `[class*="share"]`, `[class*="social"]`, `[class*="ad-"]`).
5. Sanitise the HTML (allow-list approach).
6. Compute reading time: `word_count / 200` (rounded up), where 200 WPM is a comfortable reading pace.
7. Write output to `data/article-<id>.json`.

### 4.3 Diff Logic (Incremental Refresh)

```
existing_ids  = set of "id" values in current articles.json
rss_ids       = set of slugs parsed from RSS feed (latest 15)
new_ids       = rss_ids - existing_ids          # articles to fetch
removed_ids   = existing_ids - rss_ids          # articles to drop (if feed no longer lists them)

For each id in new_ids:  fetch + scrape + write article-<id>.json
Rebuild articles.json:   (new_ids ∪ (existing_ids - removed_ids)), sorted newest-first, capped at 15
Delete stale files:      data/article-<id>.json for id in removed_ids
```

If `new_ids` is empty the workflow exits early with "No new articles, skipping commit."

### 4.4 Scheduling

| Trigger | Frequency / Condition |
|---|---|
| Scheduled (cron) | Every 6 hours: `0 */6 * * *` |
| `workflow_dispatch` | Manually from the app (Refresh button) or GitHub UI |

---

## 5. Front-End Structure

### 5.1 Technology Choices

| Concern | Choice | Rationale |
|---|---|---|
| Framework | **Vanilla JS + Web Components** | Zero build step, no bundler, no node_modules in repo; loads instantly on mobile. |
| Styling | **Single CSS file with custom properties** | Theme switching via `data-theme` attribute on `<html>`. |
| Icons | **SVG inline icons** | No external font dependency; crisp at any DPI. |
| PWA | **Service Worker + Web App Manifest** | Offline support, home-screen install on Android. |
| Storage | **`localStorage`** | Persist user preferences (theme, font, size). |
| Cache | **Cache API (via Service Worker)** | Cache `articles.json` and article JSON files for offline reading. |

### 5.2 Page Structure (Single-Page Application)

The app is a single `index.html` with two **views** toggled by JavaScript:

```
index.html
├── <view id="feed">      — Home screen: article cards
└── <view id="reader">    — Reader: full article
```

Navigation between views is handled by `pushState`/`popstate` (hash routing: `#/` and `#/article/<id>`), so the back button on Android works correctly.

### 5.3 Key Files

```
index.html          — Shell; loads all CSS and JS
styles/
  main.css          — Layout, components, all four themes via CSS custom properties
  reader.css        — Reader-specific typography rules
js/
  app.js            — Bootstraps the app, handles routing
  feed.js           — Renders article cards, handles refresh
  reader.js         — Renders article body, reading progress
  settings.js       — Settings panel logic
  api.js            — GitHub API calls (trigger workflow, poll for updates)
  sw.js             — Service Worker
manifest.webmanifest
data/
  articles.json     — Generated by GH Actions
  article-*.json    — Generated by GH Actions
assets/
  icons/            — PWA icons (192×192, 512×512)
  placeholder.svg   — Shown while images load
.github/
  workflows/
    fetch-articles.yml
    pages.yml       — Deploy to GitHub Pages
```

---

## 6. Home Screen — Article Feed

### 6.1 Layout

- Full-width card list, single column (max-width 680 px, centred on desktop).
- Each card:
  - **Cover image** — 16:9 aspect ratio, lazy-loaded (`loading="lazy"`), with a warm blurred placeholder while loading.
  - **Category pill** — small tag above the title (e.g. "Philosophy", "Science").
  - **Title** — large, serif, 2–3 lines max; clipped with ellipsis if longer.
  - **Author & reading time** — one line, muted colour. E.g. "Sally Davies · 9 min read".
  - **Excerpt** — 2 lines of text, muted colour.
  - Tapping the card opens the reader view.

### 6.2 Header

- App name: **"Aeon"** (small, unobtrusive wordmark) — left aligned.
- Right side: **Settings gear icon** + **Refresh icon**.
- Header is sticky (stays at top while scrolling).
- On scroll down: header shrinks to just the icons (compact mode) to maximise reading area.

### 6.3 Refresh Button Behaviour

1. User taps Refresh.
2. If no PAT is saved: show a bottom sheet asking for a GitHub Personal Access Token (PAT) with instructions. Save it to `localStorage` on submit.
3. Call GitHub API to dispatch `fetch-articles.yml` workflow.
4. Show a small spinner/progress indicator in the header.
5. Poll `data/articles.json` every 10 seconds (check `ETag` or `Last-Modified` header).
6. When the file changes, reload the feed and prepend new cards with a slide-in animation.
7. Show a toast: "X new article(s) added" or "Already up to date."
8. If the API call fails (bad PAT, rate-limit), show an error toast with a retry option.

### 6.4 Empty State

- If `articles.json` has zero entries or fails to load: full-screen illustration + "No articles yet. Tap refresh to load." message + large Refresh button.

### 6.5 Pull-to-Refresh

- Implement native-feeling pull-to-refresh gesture on mobile (CSS overscroll + JS touch events) as a secondary way to trigger refresh (same flow as the button).

---

## 7. Reader View

### 7.1 Entry Transition

- Cards slide left off screen; reader view slides in from the right.
- Transition duration: 280 ms, `cubic-bezier(0.4, 0, 0.2, 1)`.

### 7.2 Layout

```
┌─────────────────────┐
│ ← Back    ··· Menu  │  ← minimal header (hidden on scroll, reappears on scroll up)
├─────────────────────┤
│                     │
│   [Cover Image]     │  ← full-width, max-height 56 vw, object-fit: cover
│                     │
├─────────────────────┤
│  PHILOSOPHY         │  ← category, small caps, accent colour
│                     │
│  Title of Article   │  ← 26–28 px, serif, bold, tight line-height
│                     │
│  By Sally Davies    │  ← 14 px, muted
│  9 min read         │
├─────────────────────┤
│ [Reading progress   │  ← thin bar below header, shows % scrolled
│  bar — 4 px high]  │
├─────────────────────┤
│                     │
│  Article body text  │  ← see §9 Typography
│  …                  │
│                     │
└─────────────────────┘
```

### 7.3 Back Navigation

- Tapping "← Back" or the Android back button returns to the feed.
- Scroll position in the feed is restored (remembered in a JS variable).

### 7.4 In-Reader Menu (`···`)

A bottom sheet with quick-access settings:
- Font size slider
- Line spacing toggle (comfortable / compact)
- Theme switcher (four pills)
- Font selector (three choices)

---

## 8. Themes

Themes are toggled by setting `data-theme="<name>"` on the `<html>` element. All colour values are CSS custom properties.

### 8.1 Theme Definitions

#### Light

Clean white background, dark ink text. High contrast, suitable for bright environments.

| Property | Value |
|---|---|
| `--bg` | `#FFFFFF` |
| `--bg-card` | `#F7F6F2` |
| `--text` | `#1A1A1A` |
| `--text-muted` | `#6B6B6B` |
| `--accent` | `#C0392B` (Aeon's signature red) |
| `--border` | `#E5E5E5` |
| `--header-bg` | `rgba(255,255,255,0.92)` + backdrop-filter blur |

#### Sepia (App Default — applied on first launch)

Warm cream background, dark brown ink. Reduces eye strain in moderate light. This is the **app default** — it is what a reader sees the first time they open the app. If the device reports `prefers-color-scheme: dark`, the app instead defaults to **Dark Gray** (see §8.2).

| Property | Value |
|---|---|
| `--bg` | `#F5ECD7` |
| `--bg-card` | `#EDE0C8` |
| `--text` | `#3B2F2F` |
| `--text-muted` | `#7A6652` |
| `--accent` | `#8B4513` (SaddleBrown) |
| `--border` | `#D5C5A5` |
| `--header-bg` | `rgba(245,236,215,0.92)` + backdrop-filter blur |

#### Dark Gray

Sophisticated dark theme. True dark but not pure black — easier on the eyes than AMOLED in most lighting.

| Property | Value |
|---|---|
| `--bg` | `#1C1C1E` |
| `--bg-card` | `#2C2C2E` |
| `--text` | `#E8E8E8` |
| `--text-muted` | `#9A9A9A` |
| `--accent` | `#FF6B6B` |
| `--border` | `#3A3A3C` |
| `--header-bg` | `rgba(28,28,30,0.92)` + backdrop-filter blur |

#### AMOLED Black

Pure black background saves battery on OLED screens. High contrast; white text on black. For night reading.

| Property | Value |
|---|---|
| `--bg` | `#000000` |
| `--bg-card` | `#111111` |
| `--text` | `#F0F0F0` |
| `--text-muted` | `#808080` |
| `--accent` | `#E57373` |
| `--border` | `#222222` |
| `--header-bg` | `rgba(0,0,0,0.95)` + backdrop-filter blur |

### 8.2 System Theme Detection

On first launch, if `prefers-color-scheme: dark` is detected and no preference is saved, default to **Dark Gray** theme instead of Sepia.

### 8.3 Theme Transition

Switching themes applies a `0.25 s` CSS transition on `background-color` and `color` so the change feels smooth rather than jarring.

---

## 9. Typography

### 9.1 Font Stack

Three font options (loaded via Google Fonts or self-hosted WOFF2 for offline support):

| Name | Font | Notes |
|---|---|---|
| **Lora** (default) | `'Lora', Georgia, serif` | Elegant serif, excellent for long-form reading. |
| **Merriweather** | `'Merriweather', Georgia, serif` | Slightly heavier serif, very legible at small sizes. |
| **System Serif** | `Georgia, 'Times New Roman', serif` | No extra download; good fallback. |

A fourth option (sans-serif) may be offered for accessibility:

| Name | Font | Notes |
|---|---|---|
| **Inter** | `'Inter', system-ui, sans-serif` | For readers who prefer sans-serif. |

Fonts are loaded with `font-display: swap` to prevent invisible text during load.

### 9.2 Reader Body Type Scale

| Element | Size | Weight | Line Height | Max Width |
|---|---|---|---|---|
| Article title | `clamp(22px, 5vw, 30px)` | 700 | 1.25 | 680 px |
| Body paragraph | `clamp(17px, 2.5vw, 19px)` | 400 | 1.75 | 660 px |
| `<blockquote>` | `clamp(18px, 2.5vw, 20px)` | 400 italic | 1.7 | 580 px |
| `<h2>` subheading | `clamp(19px, 3vw, 22px)` | 600 | 1.3 | 660 px |
| Caption | `13px` | 400 | 1.5 | 580 px |

### 9.3 Reading Line Length

- Body text is constrained to **60–70 characters per line** (approximately 660 px for the default font size), which is the typographic sweet spot for readability.
- On narrow phones this is naturally achieved; on desktop a centred column is used.

### 9.4 Paragraph Spacing

- `margin-bottom: 1.5em` between paragraphs (no `text-indent`; blank-line separation is more legible on screens).
- Drop cap option for the first paragraph (can be toggled in settings): first letter enlarged to `3em`, floated left.

### 9.5 Font Size Control

- A slider in the settings panel adjusts a `--font-scale` CSS custom property from `0.85` to `1.3` (step `0.05`).
- All type sizes are expressed as `calc(base * var(--font-scale))`, so the entire type scale scales uniformly.

---

## 10. Quality-of-Life Reading Features

### 10.1 Reading Progress Bar

- A 4 px bar pinned below the sticky header.
- Fills from left to right as the user scrolls through the article.
- Colour: `--accent`.
- On article completion (scroll to bottom): brief "✓ Finished" micro-animation.

### 10.2 Estimated Reading Time

- Displayed on both the feed card and at the top of the reader view.
- Computed server-side (in the GH Actions script): `ceil(word_count / 200)` minutes.
- Also shown as a live countdown in the reader: "~6 min left" that decrements as the user scrolls (based on % remaining).

### 10.3 Auto-Scroll (Optional, Off by Default)

- A slow automatic scroll at a user-configurable speed, similar to a teleprompter.
- Speed control: slider from 1 (very slow) to 5 (comfortable pace).
- Pause on tap; resume on long-press.
- Toggle in the reader's `···` menu.

### 10.4 Highlight / Annotations (Phase 2)

- Users can long-press text to highlight a passage.
- Highlights stored in `localStorage` keyed by article ID + character offset.
- Highlights survive page refresh.
- Option to copy highlighted text.

### 10.5 Share Article

- Share button in the reader menu sends the canonical Aeon URL (not the app URL) via the Web Share API (`navigator.share`), falling back to clipboard copy.

### 10.6 Text-to-Speech (Phase 2)

- Use the Web Speech API (`SpeechSynthesis`) to read the article aloud.
- Highlights the current sentence being read.
- Speed control.
- Accessible fallback: if TTS is unavailable, button is hidden.

### 10.7 Focus Mode

- Toggle in the `···` menu.
- Dims everything except the current paragraph the reader is interacting with (determined by IntersectionObserver).
- Subtle opacity transition on non-focused paragraphs: `opacity: 0.35`.

### 10.8 Swipe Navigation

- Swipe left from the reader view returns to the feed (same as back button).
- Swipe right while in the feed navigates to the next article in the list (pre-fetched if possible).

### 10.9 Keep Screen Awake

- Use the Screen Wake Lock API (`navigator.wakeLock`) to prevent the screen from sleeping while an article is open.
- Released automatically when the user leaves the reader view or the page goes to background.

### 10.10 Scroll-to-Top Button

- A floating button appears after scrolling more than 400 px down in the reader.
- Smooth-scrolls to the top on tap.

---

## 11. Settings Panel

Accessible via the gear icon in the header. Opens as a bottom sheet drawer.

### 11.1 Settings Items

| Setting | Control | Options / Range |
|---|---|---|
| Theme | 4-button pill group | Light / Sepia / Dark / AMOLED |
| Font | 3-button pill group | Lora / Merriweather / System |
| Font size | Slider | 85 % – 130 % |
| Line spacing | Toggle | Comfortable (1.75) / Compact (1.5) |
| Drop cap | Toggle switch | On / Off |
| Auto-scroll speed | Slider (visible only when auto-scroll is on) | 1–5 |
| GitHub PAT | Text input + Save button | For the Refresh feature |
| Clear cached data | Button | Clears Service Worker cache + localStorage |

All settings are persisted to `localStorage` and applied immediately (live preview).

---

## 12. Performance & Offline Support

### 12.1 Service Worker Strategy

| Resource | Cache Strategy |
|---|---|
| `index.html` | Network-first, stale-while-revalidate |
| `styles/*.css`, `js/*.js` | Cache-first (versioned filenames) |
| `data/articles.json` | Network-first; serve cache if offline |
| `data/article-*.json` | Cache-first; add to cache on first read |
| Article cover images | Cache-on-demand (cache when viewed) |
| Google Fonts | Cache-first |

### 12.2 Offline Behaviour

- If the network is unavailable, the app loads from cache silently.
- Cached articles are fully readable.
- Refresh button shows "You're offline" toast if triggered without connectivity.
- A small offline indicator badge appears in the header when offline.

### 12.3 Image Optimisation

- Images are served from Aeon's CDN; no re-hosting.
- `loading="lazy"` on all images.
- `decoding="async"` on all images.
- Card images have an `aspect-ratio: 16/9` CSS rule so layout does not shift on load (CLS = 0).
- A warm blurred inline SVG placeholder is shown until the image loads.

---

## 13. GitHub Actions Workflow Specs

### 13.1 `fetch-articles.yml`

```yaml
# .github/workflows/fetch-articles.yml
name: Fetch Aeon Articles

on:
  schedule:
    - cron: '0 */6 * * *'   # every 6 hours
  workflow_dispatch:         # manual trigger (Refresh button)

permissions:
  contents: write            # needed to commit data/ files

jobs:
  fetch:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install dependencies
        run: pip install requests lxml bleach python-dateutil

      - name: Run fetch script
        run: python scripts/fetch_articles.py

      - name: Commit and push if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/
          git diff --cached --quiet && echo "No changes" && exit 0
          git commit -m "chore: update articles [skip ci]"
          git push
```

### 13.2 `pages.yml`

```yaml
# .github/workflows/pages.yml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_run:
    workflows: ["Fetch Aeon Articles"]
    types: [completed]

permissions:
  pages: write
  id-token: write

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - uses: actions/deploy-pages@v4
        id: deployment
```

### 13.3 `scripts/fetch_articles.py` — Responsibilities

1. Parse `data/articles.json` to get existing IDs.
2. Fetch `https://aeon.co/feed.rss`.
3. Parse XML; extract up to 15 entries.
4. Compute diff (new vs existing).
5. For each new article:
   a. Fetch the article page.
   b. Extract hero image, title, author, body with `lxml`.
   c. Sanitise HTML with `bleach` (allow-list).
   d. Count words; compute reading time.
   e. Write `data/article-<id>.json`.
6. Update `data/articles.json` (upsert + cap at 15 + sort).
7. Delete stale `data/article-*.json` files.

---

## 14. Security & Secrets

### 14.1 Personal Access Token (PAT) for Refresh

- The user's GitHub PAT is stored in `localStorage` only (never sent to any server other than `api.github.com`).
- The PAT requires only the `repo` scope (specifically `actions:write` to dispatch workflows).
- The app UI will explain clearly what the PAT is used for and that it is stored locally on the device only.
- Recommendation: use a fine-grained PAT scoped to this repository and only the "Actions: write" permission.

### 14.2 Content Security Policy

The app will include a strict CSP meta tag:

```html
<meta http-equiv="Content-Security-Policy"
  content="
    default-src 'self';
    style-src   'self' 'unsafe-inline' https://fonts.googleapis.com;
    font-src    'self' https://fonts.gstatic.com;
    img-src     'self' https://aeon.co https://images.aeon.co data: blob:;
    connect-src 'self' https://api.github.com;
    script-src  'self';
    worker-src  'self';
    frame-src   'none';
    object-src  'none';
  ">
```

### 14.3 Article HTML Sanitisation

All article HTML is sanitised server-side (in the GH Actions script) using `bleach` before being stored. The front end renders it via `element.innerHTML` **after** it has been stored as sanitised data — no raw third-party HTML is ever set as innerHTML from a live fetch.

---

## 15. File & Directory Layout

```
Aeon-Reading-/          ← repository root (repo name includes trailing hyphen)
├── index.html
├── manifest.webmanifest
├── styles/
│   ├── main.css
│   └── reader.css
├── js/
│   ├── app.js
│   ├── feed.js
│   ├── reader.js
│   ├── settings.js
│   ├── api.js
│   └── sw.js
├── assets/
│   ├── icons/
│   │   ├── icon-192.png
│   │   └── icon-512.png
│   └── placeholder.svg
├── data/
│   ├── articles.json          ← generated; empty array on first commit
│   └── .gitkeep
├── scripts/
│   └── fetch_articles.py
├── .github/
│   └── workflows/
│       ├── fetch-articles.yml
│       └── pages.yml
├── README.md
└── ENGINEERING_PLAN.md
```

---

## 16. Phase-by-Phase Implementation Checklist

### Phase 0 — Repository Bootstrap ✅ *(this document)*

- [x] Write and commit `ENGINEERING_PLAN.md`
- [x] Update `README.md` with project description

### Phase 1 — Data Pipeline

- [ ] Create `scripts/fetch_articles.py`
  - [ ] RSS feed parser
  - [ ] Diff logic (skip existing articles)
  - [ ] HTML fetcher + `lxml` body extractor
  - [ ] `bleach` sanitiser with tag allow-list
  - [ ] Reading time calculator
  - [ ] JSON writer for article index and individual files
- [ ] Create `data/articles.json` (empty initial state: `{"lastFetched":null,"articles":[]}`)
- [ ] Create `.github/workflows/fetch-articles.yml`
- [ ] Test the script locally against Aeon RSS feed
- [ ] Verify workflow runs successfully in GitHub Actions
- [ ] Verify `data/` is correctly updated after workflow run

### Phase 2 — Static Shell

- [ ] Create `index.html` (semantic HTML shell, two view containers)
- [ ] Create `manifest.webmanifest` (name, icons, theme colour, display: standalone)
- [ ] Create `assets/icons/` (192×192 and 512×512 PNG app icons)
- [ ] Create `assets/placeholder.svg` (warm blurred rectangle placeholder)
- [ ] Create `.github/workflows/pages.yml`
- [ ] Verify GitHub Pages deployment succeeds

### Phase 3 — Feed View

- [ ] `styles/main.css` — CSS custom properties for all four themes, card layout
- [ ] `js/feed.js` — read `articles.json`, render article cards
- [ ] Implement hash router in `js/app.js` (`#/` and `#/article/<id>`)
- [ ] Card component: image, category pill, title, author + reading time, excerpt
- [ ] Sticky header with app wordmark, settings icon, refresh icon
- [ ] Empty state rendering
- [ ] Smooth card skeleton loading state (CSS animated shimmer)

### Phase 4 — Reader View

- [ ] `styles/reader.css` — typography rules, reading layout
- [ ] `js/reader.js` — load article JSON, render body HTML, back navigation
- [ ] Reading progress bar (IntersectionObserver or scroll event)
- [ ] "X min left" countdown logic
- [ ] Slide-in/slide-out view transitions (CSS + JS)
- [ ] Scroll position restoration on back navigation
- [ ] Scroll-to-top floating button

### Phase 5 — Themes & Typography

- [ ] Implement all four themes as `data-theme` CSS classes
- [ ] Implement `--font-scale` CSS variable and font size slider
- [ ] Implement three font options
- [ ] Implement line-spacing toggle
- [ ] Implement drop cap toggle
- [ ] System dark mode auto-detection on first launch

### Phase 6 — Settings Panel

- [ ] Bottom sheet drawer component (slide-up animation, backdrop tap to close)
- [ ] Theme selector (4-pill group)
- [ ] Font selector (3-pill group)
- [ ] Font size slider
- [ ] Line spacing toggle
- [ ] PAT input + save + clear button
- [ ] "Clear cache" button
- [ ] Persist all settings to `localStorage`

### Phase 7 — Refresh Mechanism

- [ ] `js/api.js` — `triggerWorkflowDispatch(pat)`, `pollForUpdate(etag)`
- [ ] Refresh button flow: check PAT → dispatch → spinner → poll → update feed
- [ ] PAT prompt bottom sheet (shown on first refresh attempt)
- [ ] Toast notification component
- [ ] Error handling: bad PAT, network error, rate limit

### Phase 8 — Service Worker & PWA

- [ ] `js/sw.js` — register, install, activate, fetch event handlers
- [ ] Cache strategies per resource type (§12.1)
- [ ] Offline indicator in header
- [ ] Pull-to-refresh gesture (touch events)
- [ ] Screen Wake Lock integration in reader view
- [ ] Test PWA install prompt on Android Chrome

### Phase 9 — Quality-of-Life Features

- [ ] Focus mode (IntersectionObserver + paragraph opacity)
- [ ] Swipe left gesture (reader → feed)
- [ ] Web Share API integration
- [ ] Keep screen awake (Wake Lock API)
- [ ] In-reader quick settings (`···` bottom sheet)

### Phase 10 — Phase 2 Features *(deferred)*

- [ ] Text highlight + localStorage persistence
- [ ] Auto-scroll (teleprompter mode)
- [ ] Text-to-Speech (Web Speech API)

---

## 17. Open Questions & Future Considerations

| # | Question | Notes |
|---|---|---|
| 1 | **Aeon RSS structure** | Verify the exact XML elements for cover image and excerpt; may need to inspect `<media:content>` vs `<enclosure>` vs embedded `<img>` in `<description>`. |
| 2 | **Aeon DOM structure for scraping** | CSS selectors for the article body may change with Aeon site updates; the scraper should use multiple fallback selectors. |
| 3 | **Rate limiting on Aeon** | Fetching 5–10 new articles per run should be well within any reasonable rate limit, but add a 1-second delay between article fetches to be polite. |
| 4 | **PAT visibility on mobile** | Consider whether to support `oauth_device_flow` instead of asking for a raw PAT, for a smoother mobile experience (Phase 2). |
| 5 | **Paywall articles** | Some Aeon articles may be paywalled. The scraper should detect a paywall response and skip those articles gracefully. |
| 6 | **Image CORS** | Images are served from Aeon's CDN with their own CORS policy; since the app only uses `<img src>` (not Canvas), CORS should not be an issue. |
| 7 | **Font self-hosting** | For full offline support, Google Fonts should be downloaded and self-hosted as WOFF2 files in `assets/fonts/`. |
| 8 | **Accessibility** | All interactive elements need ARIA labels; focus management when opening/closing drawers; sufficient colour contrast in all themes (WCAG AA minimum). |
| 9 | **Analytics** | None — the app intentionally has zero tracking. |
| 10 | **Multiple feeds** | In future, allow adding other RSS feeds beyond Aeon (Nautilus, Quanta, Aeon's sister publication Psyche). |

---

*End of Engineering Specification v1.0*
