#!/usr/bin/env python3
"""
Aeon Reader — Article Fetching Script
======================================
Phase 1: Data Pipeline

This script is the backend worker for the Aeon Reader PWA. It is executed by the
GitHub Actions workflow `fetch-articles.yml` on a schedule (every 6 hours) and
on demand via `workflow_dispatch` (the in-app Refresh button).

Responsibilities (in order):
    1. Load the existing ``data/articles.json`` to get the set of known article IDs.
    2. Fetch the Aeon public RSS feed (https://aeon.co/feed.rss).
    3. Parse the RSS XML to extract article metadata for up to MAX_ARTICLES entries.
    4. Diff the RSS IDs against the existing IDs to find new and stale articles.
    5. For each new article:
       a. Fetch the full article page HTML.
       b. Strip non-content elements (nav, ads, modals, etc.).
       c. Extract the article body using a priority list of CSS selectors.
       d. Sanitise the HTML using ``bleach`` (allow-list approach — no scripts, iframes, etc.).
       e. Compute estimated reading time (word_count / WORDS_PER_MINUTE, rounded up).
       f. Write ``data/article-<id>.json`` with full article content.
    6. Update ``data/articles.json`` (merge new + kept articles, sort newest-first, cap at 15).
    7. Delete ``data/article-<id>.json`` files for articles that are no longer in the feed.

Exit behaviour:
    - Exits with code 0 and prints "No new articles" if there is nothing to update (so
      the GitHub Actions step can detect this and skip the git commit).
    - Exits with code 1 on unrecoverable errors (RSS fetch failure, etc.).

Dependencies (install via pip):
    requests, lxml, bleach, python-dateutil, cssselect
"""

import json
import math
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree

import bleach
import requests
from dateutil import parser as dateutil_parser
from lxml import html as lxml_html
from lxml import etree as lxml_etree

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Aeon public RSS feed URL
RSS_URL = "https://aeon.co/feed.rss"

# Path to the data directory (relative to this script's parent directory)
DATA_DIR = Path(__file__).parent.parent / "data"

# Path to the articles index file
ARTICLES_JSON = DATA_DIR / "articles.json"

# Maximum number of articles to keep in the index
MAX_ARTICLES = 15

# Assumed reading speed in words per minute (comfortable reading pace)
WORDS_PER_MINUTE = 200

# Polite crawl delay between article fetches (seconds)
REQUEST_DELAY = 1.0

# HTTP request timeout (seconds)
REQUEST_TIMEOUT = 30

# User-agent string identifying this bot.
# NOTE: The trailing hyphen in 'Aeon-Reading-' is the actual repository name — not a typo.
USER_AGENT = (
    "AeonReader/1.0 (+https://github.com/Jay-2212/Aeon-Reading-)"
)

# ---------------------------------------------------------------------------
# HTML Sanitisation Configuration
# ---------------------------------------------------------------------------

# Tags that are allowed to appear in article body HTML after sanitisation.
# All other tags are stripped (content preserved) or removed (content also removed).
ALLOWED_TAGS = [
    "p", "h2", "h3", "blockquote", "em", "strong", "a",
    "ul", "ol", "li", "figure", "img", "figcaption", "hr",
]

# Per-tag attribute allow-list.
ALLOWED_ATTRS: dict[str, list[str]] = {
    "a":          ["href", "title"],
    "img":        ["src", "alt", "width", "height", "loading", "decoding"],
    "figure":     ["class"],
    "figcaption": [],
}

# ---------------------------------------------------------------------------
# Article Body Extraction Configuration
# ---------------------------------------------------------------------------

# CSS selectors to try when locating the article body, in priority order.
# The first matching element is used. If none match, the full <body> is used as fallback.
BODY_SELECTORS = [
    ".article__body",
    ".essay-body",
    "article .content",
    "article",
    ".content-body",
    '[itemprop="articleBody"]',
]

# Substrings that, if present in an element's ``class`` attribute, indicate
# non-content elements that should be removed before body extraction.
STRIP_CLASS_PATTERNS = [
    "subscription", "newsletter", "paywall", "popup", "modal",
    "share", "social", "ad-", "advertisement", "promo",
    "sidebar", "related", "author-bio-inline", "sign-up",
]

# HTML tags that are always removed with all their children before extraction.
REMOVE_TAGS = [
    "script", "style", "iframe", "form", "button", "input",
    "nav", "header", "footer", "aside",
]

# ---------------------------------------------------------------------------
# RSS Feed Parsing
# ---------------------------------------------------------------------------


def fetch_rss_feed(url: str) -> str:
    """Fetch the Aeon RSS feed and return its raw XML text.

    Args:
        url: The URL of the RSS feed to fetch.

    Returns:
        The raw XML content of the feed as a UTF-8 string.

    Raises:
        requests.RequestException: If the HTTP request fails.
    """
    headers = {"User-Agent": USER_AGENT}
    response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return response.text


def parse_rss_feed(xml_text: str) -> list[dict]:
    """Parse the Aeon RSS feed XML and return article metadata dicts.

    Extracts up to MAX_ARTICLES items from the feed. Each returned dict
    contains the fields needed to build the ``articles.json`` index entry
    and to locate the full article for scraping.

    Args:
        xml_text: Raw RSS/Atom XML text.

    Returns:
        A list of article metadata dicts (see ``_parse_rss_item`` for fields).
        Returns an empty list if the feed cannot be parsed or is empty.
    """
    # XML namespaces used by Aeon's RSS feed
    ns = {
        "media":   "http://search.yahoo.com/mrss/",
        "dc":      "http://purl.org/dc/elements/1.1/",
        "content": "http://purl.org/rss/1.0/modules/content/",
    }

    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError as exc:
        print(f"ERROR: Could not parse RSS XML: {exc}", file=sys.stderr)
        return []

    channel = root.find("channel")
    if channel is None:
        print("ERROR: RSS feed has no <channel> element.", file=sys.stderr)
        return []

    articles = []
    for item in channel.findall("item")[:MAX_ARTICLES]:
        article = _parse_rss_item(item, ns)
        if article:
            articles.append(article)

    return articles


def _parse_rss_item(item: ElementTree.Element, ns: dict) -> dict | None:
    """Parse a single RSS ``<item>`` element into an article metadata dict.

    Args:
        item: An ``<item>`` XML element from the RSS feed.
        ns:   Namespace prefix-to-URI mapping for XPath lookups.

    Returns:
        A dict with keys:
            - ``id``          (str)  URL slug used as the stable identifier.
            - ``title``       (str)  Article title.
            - ``author``      (str)  Author name, may be empty.
            - ``category``    (str)  Aeon section/category, may be empty.
            - ``publishedAt`` (str)  ISO 8601 timestamp string.
            - ``excerpt``     (str)  First ~300 chars of description (HTML stripped).
            - ``imageUrl``    (str)  Cover image URL, may be empty.
            - ``imageAlt``    (str)  Cover image alt text (always empty from RSS).
            - ``url``         (str)  Canonical article URL.
        Returns ``None`` if the item is missing required fields (title or link).
    """
    title_el = item.find("title")
    link_el = item.find("link")

    if title_el is None or link_el is None:
        return None

    title = (title_el.text or "").strip()
    url = (link_el.text or "").strip()

    if not title or not url:
        return None

    # Extract a stable URL slug to use as the article ID
    slug = _extract_slug(url)
    if not slug:
        return None

    # ------------------------------------------------------------------
    # Publication date — parse with dateutil for broad RFC 2822 support
    # ------------------------------------------------------------------
    published_at: str
    pub_date_el = item.find("pubDate")
    if pub_date_el is not None and pub_date_el.text:
        try:
            published_at = dateutil_parser.parse(pub_date_el.text).isoformat()
        except (ValueError, OverflowError, TypeError):
            published_at = datetime.now(timezone.utc).isoformat()
    else:
        published_at = datetime.now(timezone.utc).isoformat()

    # ------------------------------------------------------------------
    # Excerpt — strip all HTML tags from the <description> element
    # ------------------------------------------------------------------
    excerpt = ""
    desc_el = item.find("description")
    if desc_el is not None and desc_el.text:
        raw = desc_el.text or ""
        excerpt = re.sub(r"<[^>]+>", "", raw).strip()
        # Collapse whitespace and truncate
        excerpt = " ".join(excerpt.split())[:300]

    # ------------------------------------------------------------------
    # Author — try dc:creator first, fall back to <author>
    # ------------------------------------------------------------------
    author = ""
    author_el = item.find("dc:creator", ns)
    if author_el is None:
        author_el = item.find("author")
    if author_el is not None and author_el.text:
        author = author_el.text.strip()

    # ------------------------------------------------------------------
    # Category — first <category> element
    # ------------------------------------------------------------------
    category = ""
    category_el = item.find("category")
    if category_el is not None and category_el.text:
        category = category_el.text.strip()

    # ------------------------------------------------------------------
    # Cover image — try media:content, then <enclosure>
    # ------------------------------------------------------------------
    image_url = ""
    media_content = item.find("media:content", ns)
    if media_content is not None:
        image_url = media_content.get("url", "")
    if not image_url:
        enclosure = item.find("enclosure")
        if enclosure is not None and enclosure.get("type", "").startswith("image"):
            image_url = enclosure.get("url", "")

    return {
        "id":          slug,
        "title":       title,
        "author":      author,
        "category":    category,
        "publishedAt": published_at,
        "excerpt":     excerpt,
        "imageUrl":    image_url,
        "imageAlt":    "",  # RSS feeds rarely carry alt text; enriched from article page
        "url":         url,
    }


def _extract_slug(url: str) -> str:
    """Extract a URL-slug identifier from a canonical Aeon article URL.

    Takes the last non-empty path segment and keeps only lowercase letters,
    digits, and hyphens.

    Examples::

        >>> _extract_slug("https://aeon.co/essays/the-age-of-the-brain")
        'the-age-of-the-brain'
        >>> _extract_slug("https://aeon.co/ideas/why-music-matters")
        'why-music-matters'

    Args:
        url: A canonical Aeon article URL.

    Returns:
        The slug string, or an empty string if no suitable slug can be found.
    """
    parsed = urllib.parse.urlparse(url)
    path = parsed.path.rstrip("/")
    parts = [p for p in path.split("/") if p]
    if not parts:
        return ""
    slug = parts[-1]
    # Keep only lowercase letters, digits, and hyphens
    slug = re.sub(r"[^a-z0-9-]", "", slug.lower())
    return slug


# ---------------------------------------------------------------------------
# Article Scraping
# ---------------------------------------------------------------------------


def fetch_article_html(url: str) -> str:
    """Fetch the full HTML of an Aeon article page.

    Args:
        url: Canonical URL of the article.

    Returns:
        The full page HTML as a string.

    Raises:
        requests.RequestException: If the HTTP request fails.
    """
    headers = {"User-Agent": USER_AGENT}
    response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return response.text


def extract_article_content(page_html: str, article_meta: dict) -> dict:
    """Extract, clean, and sanitise article content from full-page HTML.

    Steps:
        1. Parse the HTML with lxml.
        2. Remove non-content elements (nav, scripts, ads, modals, etc.).
        3. Locate the article body using BODY_SELECTORS priority list.
        4. Serialise the body subtree back to an HTML string.
        5. Sanitise the string with bleach (allow-list of tags + attributes).
        6. Add ``target="_blank" rel="noopener noreferrer"`` to all ``<a>`` tags.
        7. Count words; compute estimated reading time.
        8. Try to extract author bio and a higher-quality hero image.

    Args:
        page_html:    Full HTML of the article page.
        article_meta: Metadata dict from the RSS feed (used as fallback for
                      ``imageUrl`` and ``imageAlt``).

    Returns:
        A dict with keys:
            - ``bodyHtml``           (str)  Sanitised article body HTML.
            - ``authorBio``          (str)  Author biography text, may be empty.
            - ``imageUrl``           (str)  Hero image URL (article-page quality).
            - ``imageAlt``           (str)  Hero image alt text.
            - ``readingTimeMinutes`` (int)  Estimated reading time in minutes (≥ 1).
    """
    doc = lxml_html.fromstring(page_html)

    # Steps 1–2: Extract author bio and hero image BEFORE removing elements,
    # because author bios often live in <aside> elements that would otherwise
    # be stripped, and hero images may live in a <header>.
    author_bio = _extract_author_bio(doc)

    image_url = article_meta.get("imageUrl", "")
    image_alt = article_meta.get("imageAlt", "")
    if not image_url:
        image_url, image_alt = _extract_hero_image(doc)

    # Step 3: Remove non-content elements before extracting body
    _remove_unwanted_elements(doc)

    # Step 4: Find the article body using CSS selector priority list
    body_el = None
    for selector in BODY_SELECTORS:
        elements = doc.cssselect(selector)
        if elements:
            body_el = elements[0]
            break

    # Fallback: use the full <body> if no specific selector matched
    if body_el is None:
        body_candidates = doc.cssselect("body")
        body_el = body_candidates[0] if body_candidates else doc

    # Step 5: Serialise the body element to an HTML string
    raw_html = lxml_etree.tostring(body_el, encoding="unicode", method="html")

    # Step 6: Sanitise with bleach and add link security attributes
    sanitised_html = _sanitise_html(raw_html)

    # Step 7: Estimate reading time from plain-text word count
    text_content = re.sub(r"<[^>]+>", " ", sanitised_html)
    word_count = len(text_content.split())
    reading_time = max(1, math.ceil(word_count / WORDS_PER_MINUTE))

    return {
        "bodyHtml":           sanitised_html,
        "authorBio":          author_bio,
        "imageUrl":           image_url,
        "imageAlt":           image_alt,
        "readingTimeMinutes": reading_time,
    }


def _remove_unwanted_elements(doc: lxml_html.HtmlElement) -> None:
    """Remove non-content elements from the parsed HTML document in-place.

    Removes:
    - Tags in REMOVE_TAGS (script, style, iframe, nav, header, footer, etc.)
    - Any element whose ``class`` attribute contains a substring from STRIP_CLASS_PATTERNS.

    Args:
        doc: The root lxml HTML element to clean (mutated in place).
    """
    # Remove entire tags with their content
    for tag in REMOVE_TAGS:
        for el in doc.findall(".//" + tag):
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)

    # Remove elements whose class name signals non-content
    for el in list(doc.iter()):
        classes = (el.get("class") or "").lower()
        if any(pattern in classes for pattern in STRIP_CLASS_PATTERNS):
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)


def _sanitise_html(raw_html: str) -> str:
    """Sanitise article HTML using bleach's allow-list approach.

    After cleaning with bleach, every ``<a>`` tag is also given
    ``target="_blank" rel="noopener noreferrer"`` for security.
    Trailing whitespace and excessive blank lines are removed.

    Args:
        raw_html: Unsanitised HTML string (e.g. serialised lxml output).

    Returns:
        A sanitised HTML string safe for use as ``innerHTML``.
    """
    # bleach.clean strips disallowed tags (preserving their text content)
    # and strips any disallowed attributes from allowed tags.
    cleaned = bleach.clean(
        raw_html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        strip=True,
        strip_comments=True,
    )

    # Add security attributes to all anchor tags
    cleaned = re.sub(
        r"<a(\s[^>]*)?>",
        lambda m: _make_secure_link(m.group(0)),
        cleaned,
    )

    # Collapse runs of 3+ newlines into two
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _make_secure_link(tag_str: str) -> str:
    """Return an ``<a>`` tag string with ``target`` and ``rel`` security attributes.

    Removes any existing ``target`` and ``rel`` attributes and replaces them
    with ``target="_blank" rel="noopener noreferrer"``.

    Args:
        tag_str: The original ``<a ...>`` tag string (opening tag only).

    Returns:
        The modified opening ``<a>`` tag string.
    """
    # Strip existing target and rel attributes
    tag_str = re.sub(r'\s+target=["\'][^"\']*["\']', "", tag_str)
    tag_str = re.sub(r'\s+rel=["\'][^"\']*["\']', "", tag_str)
    # Insert security attributes before the closing >
    return tag_str.rstrip(">").rstrip() + ' target="_blank" rel="noopener noreferrer">'


def _extract_author_bio(doc: lxml_html.HtmlElement) -> str:
    """Try to extract the author biography text from an article page.

    Tries several common CSS selectors used by Aeon. Returns the first
    non-trivially short text found (> 20 characters).

    Args:
        doc: The parsed lxml HTML document.

    Returns:
        Author biography as plain text, or an empty string if not found.
    """
    bio_selectors = [
        ".author-bio",
        "[class*='author'] p",
        ".about-author",
        '[itemprop="author"] p',
        ".contributor-bio",
    ]
    for selector in bio_selectors:
        elements = doc.cssselect(selector)
        if elements:
            text = elements[0].text_content().strip()
            if len(text) > 20:
                return text
    return ""


def _extract_hero_image(doc: lxml_html.HtmlElement) -> tuple[str, str]:
    """Try to extract the hero/cover image URL and alt text from an article page.

    Tries several common CSS selectors used by Aeon for hero images.

    Args:
        doc: The parsed lxml HTML document.

    Returns:
        A ``(src, alt)`` tuple. Both are empty strings if no image is found.
    """
    hero_selectors = [
        ".hero-image img",
        ".article-hero img",
        ".cover-image img",
        "figure.hero img",
        "[class*='hero'] img",
    ]
    for selector in hero_selectors:
        elements = doc.cssselect(selector)
        if elements:
            img = elements[0]
            # Some sites use data-src for lazy loading
            src = img.get("src", "") or img.get("data-src", "")
            alt = img.get("alt", "")
            if src:
                return src, alt
    return "", ""


# ---------------------------------------------------------------------------
# Data File I/O
# ---------------------------------------------------------------------------


def load_articles_json() -> dict:
    """Load the existing ``data/articles.json`` index.

    Returns an empty structure if the file does not exist or is corrupt.

    Returns:
        A dict with keys ``lastFetched`` (str or None) and
        ``articles`` (list of article summary dicts).
    """
    if not ARTICLES_JSON.exists():
        return {"lastFetched": None, "articles": []}
    try:
        with open(ARTICLES_JSON, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        print(f"WARNING: Could not load {ARTICLES_JSON}: {exc}", file=sys.stderr)
        return {"lastFetched": None, "articles": []}


def save_articles_json(data: dict) -> None:
    """Write the articles index to ``data/articles.json``.

    Args:
        data: Dict with ``lastFetched`` and ``articles`` keys.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(ARTICLES_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Saved {ARTICLES_JSON}")


def save_article_json(article_id: str, data: dict) -> None:
    """Write a full article to ``data/article-<id>.json``.

    Args:
        article_id: The article slug (used to form the filename).
        data:       Full article dict (title, author, bodyHtml, etc.).
    """
    path = DATA_DIR / f"article-{article_id}.json"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Saved {path}")


def delete_stale_articles(stale_ids: set[str]) -> None:
    """Delete ``data/article-<id>.json`` files for stale articles.

    Stale articles are those that were in the previous articles.json but
    are no longer present in the latest RSS feed.

    Args:
        stale_ids: Set of article IDs whose JSON files should be deleted.
    """
    for article_id in stale_ids:
        path = DATA_DIR / f"article-{article_id}.json"
        if path.exists():
            path.unlink()
            print(f"Deleted stale article file: {path}")


# ---------------------------------------------------------------------------
# Main Pipeline
# ---------------------------------------------------------------------------


def build_article_summary(rss_art: dict, content: dict) -> dict:
    """Build an article summary dict suitable for ``articles.json``.

    Merges RSS metadata with content extracted from the full article page.

    Args:
        rss_art: Article metadata dict from ``parse_rss_feed``.
        content: Content dict from ``extract_article_content``.

    Returns:
        An article summary dict with the fields defined in
        ``ENGINEERING_PLAN.md §3.1``.
    """
    article_id = rss_art["id"]
    return {
        "id":                 article_id,
        "title":              rss_art["title"],
        "author":             rss_art["author"],
        "category":           rss_art["category"],
        "publishedAt":        rss_art["publishedAt"],
        "excerpt":            rss_art["excerpt"],
        "imageUrl":           content["imageUrl"] or rss_art["imageUrl"],
        "imageAlt":           content["imageAlt"] or rss_art["imageAlt"],
        "readingTimeMinutes": content["readingTimeMinutes"],
        "articleFile":        f"data/article-{article_id}.json",
    }


def build_full_article(rss_art: dict, content: dict) -> dict:
    """Build a full article dict suitable for ``data/article-<id>.json``.

    Args:
        rss_art: Article metadata dict from ``parse_rss_feed``.
        content: Content dict from ``extract_article_content``.

    Returns:
        A full article dict with the fields defined in
        ``ENGINEERING_PLAN.md §3.2``.
    """
    return {
        "id":                 rss_art["id"],
        "title":              rss_art["title"],
        "author":             rss_art["author"],
        "authorBio":          content["authorBio"],
        "category":           rss_art["category"],
        "publishedAt":        rss_art["publishedAt"],
        "imageUrl":           content["imageUrl"] or rss_art["imageUrl"],
        "imageAlt":           content["imageAlt"] or rss_art["imageAlt"],
        "readingTimeMinutes": content["readingTimeMinutes"],
        "bodyHtml":           content["bodyHtml"],
    }


def run() -> None:
    """Execute the full article fetch-and-update pipeline.

    This is the main entry point called by the GitHub Actions workflow.
    It orchestrates all steps: load → diff → fetch → sanitise → write → cleanup.

    Exits with code 0 on success (even if there are no new articles).
    Exits with code 1 on unrecoverable errors (e.g. RSS feed unreachable).
    """
    print("=== Aeon Reader: Article Fetch Pipeline ===")

    # ------------------------------------------------------------------
    # Step 1: Load existing article index
    # ------------------------------------------------------------------
    existing_data = load_articles_json()
    existing_articles: list[dict] = existing_data.get("articles", [])
    existing_ids: set[str] = {a["id"] for a in existing_articles}
    print(f"Existing articles: {len(existing_ids)}")

    # ------------------------------------------------------------------
    # Step 2: Fetch RSS feed
    # ------------------------------------------------------------------
    print(f"Fetching RSS feed from {RSS_URL} ...")
    try:
        rss_xml = fetch_rss_feed(RSS_URL)
    except requests.RequestException as exc:
        print(f"ERROR: Failed to fetch RSS feed: {exc}", file=sys.stderr)
        sys.exit(1)

    # ------------------------------------------------------------------
    # Step 3: Parse RSS feed
    # ------------------------------------------------------------------
    rss_articles = parse_rss_feed(rss_xml)
    rss_ids: set[str] = {a["id"] for a in rss_articles}
    print(f"RSS feed articles: {len(rss_ids)}")

    # ------------------------------------------------------------------
    # Step 4: Compute diff
    # ------------------------------------------------------------------
    new_ids: set[str] = rss_ids - existing_ids
    removed_ids: set[str] = existing_ids - rss_ids
    print(f"New articles to fetch: {len(new_ids)}")
    print(f"Stale articles to remove: {len(removed_ids)}")

    if not new_ids:
        print("No new articles found. Skipping commit.")
        return

    # ------------------------------------------------------------------
    # Step 5: Fetch and process each new article
    # ------------------------------------------------------------------
    new_summaries: list[dict] = []   # summary entries for articles.json
    processed_count = 0

    for rss_art in rss_articles:
        art_id = rss_art["id"]
        if art_id not in new_ids:
            continue

        print(f"\nFetching article: {art_id}")
        try:
            page_html = fetch_article_html(rss_art["url"])
            content = extract_article_content(page_html, rss_art)

            # Write the full article JSON
            full_article = build_full_article(rss_art, content)
            save_article_json(art_id, full_article)

            # Collect summary for articles.json
            new_summaries.append(build_article_summary(rss_art, content))
            processed_count += 1

        except requests.RequestException as exc:
            print(f"WARNING: Failed to fetch article '{art_id}': {exc}", file=sys.stderr)
        except Exception as exc:  # pylint: disable=broad-except
            print(f"WARNING: Error processing article '{art_id}': {exc}", file=sys.stderr)

        # Polite crawl delay between requests
        time.sleep(REQUEST_DELAY)

    # ------------------------------------------------------------------
    # Step 6: Delete stale article files
    # ------------------------------------------------------------------
    delete_stale_articles(removed_ids)

    # ------------------------------------------------------------------
    # Step 7: Rebuild articles.json
    # ------------------------------------------------------------------
    # Guard: only write the index if at least one article was processed
    # OR stale articles need to be removed.  If new_ids were found but
    # every article-page fetch failed, new_summaries is empty — in that
    # case we leave the existing articles.json untouched rather than
    # overwriting it with an empty list.
    if not new_summaries and not removed_ids:
        print("No articles were successfully processed or removed. Skipping index update.")
        return

    # Keep articles that are still in the feed
    kept_articles = [a for a in existing_articles if a["id"] not in removed_ids]

    # Merge new summaries (prepended) with kept articles
    all_articles = new_summaries + kept_articles

    # Sort newest-first by publishedAt ISO timestamp (lexicographic sort works for ISO 8601)
    all_articles.sort(key=lambda a: a.get("publishedAt", ""), reverse=True)

    # Cap at maximum allowed count
    all_articles = all_articles[:MAX_ARTICLES]

    updated_data = {
        "lastFetched": datetime.now(timezone.utc).isoformat(),
        "articles":    all_articles,
    }
    save_articles_json(updated_data)

    print(f"\n=== Done. {processed_count} new article(s) added. ===")


if __name__ == "__main__":
    run()
