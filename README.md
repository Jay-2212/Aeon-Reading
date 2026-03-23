# Aeon Reader

A distraction-free, mobile-first progressive web app (PWA) that delivers recent [Aeon](https://aeon.co) articles in a beautiful reading environment — hosted entirely on GitHub Pages.

## What it does

- Fetches the latest 10–15 articles from Aeon's RSS feed via a scheduled GitHub Actions workflow
- Strips all pop-ups, ads, subscription nags, and navigation clutter — leaving only the title, cover image, and clean article body
- Lets you trigger a refresh from the app itself (only new articles are fetched)
- Works offline after the first load (Service Worker cache)
- Installable as a PWA on Android (home-screen shortcut)

## Reading experience

- **Four themes**: Sepia (default), Light, Dark Gray, AMOLED Black
- **Three fonts**: Lora, Merriweather, System Serif (+ Inter sans-serif option)
- Adjustable font size and line spacing
- Reading progress bar and live "X min left" countdown
- Focus mode, scroll-to-top, Web Share API, Screen Wake Lock

## Engineering Specification

See [`ENGINEERING_PLAN.md`](ENGINEERING_PLAN.md) for the full engineering specification including architecture, data model, theme definitions, typography scale, phase-by-phase implementation checklist, and all technical details.

## Architecture Overview

```
GitHub Actions (scheduled / on-demand)
    → fetches Aeon RSS + scrapes article HTML
    → sanitises + stores as JSON in data/
    → commits to repo

GitHub Pages
    → serves index.html + data/*.json

Browser / Android PWA
    → reads articles.json, renders feed
    → reader view with clean article HTML
    → Refresh button triggers GitHub Actions via API
```

## Status

🚧 In development — see the [engineering plan](ENGINEERING_PLAN.md) for the implementation roadmap.
