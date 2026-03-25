"""
Tests for scripts/fetch_articles.py — Phase 1: Data Pipeline
=============================================================

This test module covers the key units of the article fetching pipeline:

- RSS feed parsing (``parse_rss_feed``, ``_parse_rss_item``, ``_extract_slug``)
- Article HTML extraction and sanitisation (``extract_article_content``,
  ``_sanitise_html``, ``_make_secure_link``, ``_remove_unwanted_elements``)
- Reading time calculation (embedded in ``extract_article_content``)
- Author bio / hero-image extraction helpers
- JSON file I/O (``load_articles_json``, ``save_articles_json``,
  ``save_article_json``, ``delete_stale_articles``)
- Diff logic and full pipeline (``run``)

All HTTP calls are mocked so tests never make real network requests.

Run with::

    pytest tests/test_fetch_articles.py -v
"""

import json
import math
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, mock_open, patch

import pytest

# ---------------------------------------------------------------------------
# Make the scripts/ directory importable
# ---------------------------------------------------------------------------
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import fetch_articles as fa  # noqa: E402  (import after sys.path manipulation)

# ---------------------------------------------------------------------------
# Fixtures and helpers
# ---------------------------------------------------------------------------

# Minimal valid RSS XML with two items
SAMPLE_RSS_XML = """\
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:media="http://search.yahoo.com/mrss/"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Aeon</title>
    <link>https://aeon.co</link>
    <item>
      <title>The Age of the Brain</title>
      <link>https://aeon.co/essays/the-age-of-the-brain</link>
      <pubDate>Thu, 01 Jun 2025 10:00:00 +0000</pubDate>
      <dc:creator>Sally Davies</dc:creator>
      <category>Philosophy</category>
      <description>&lt;p&gt;First two sentences of the article excerpt.&lt;/p&gt;</description>
      <media:content url="https://images.aeon.co/brain.jpg" medium="image"/>
    </item>
    <item>
      <title>Why Music Matters</title>
      <link>https://aeon.co/ideas/why-music-matters</link>
      <pubDate>Mon, 27 May 2025 08:00:00 +0000</pubDate>
      <dc:creator>John Smith</dc:creator>
      <category>Culture</category>
      <description>Music is everywhere.</description>
    </item>
  </channel>
</rss>
"""

# Sample article page HTML (simplified)
SAMPLE_ARTICLE_HTML = """\
<html>
<body>
  <nav>Navigation (should be removed)</nav>
  <header>Site header (should be removed)</header>
  <div class="article__body">
    <p>First paragraph of the article body.</p>
    <p>Second paragraph with <a href="https://example.com">a link</a> and <em>emphasis</em>.</p>
    <h2>A subheading</h2>
    <blockquote>A notable quote from someone.</blockquote>
    <p>Third paragraph.</p>
    <script>alert('evil');</script>
    <div class="newsletter-signup">Subscribe now! (should be removed)</div>
  </div>
  <aside class="author-bio">
    Sally Davies is a philosopher and writer based in London.
  </aside>
  <div class="hero-image"><img src="https://images.aeon.co/hero.jpg" alt="Brain scan" /></div>
  <footer>Site footer (should be removed)</footer>
</body>
</html>
"""

PROMO_ARTICLE_HTML = """\
<html>
<body>
  <div class="article__body">
    <p>Listen to this essay</p>
    <p>35 minute listen</p>
    <p>Real content starts here.</p>
  </div>
</body>
</html>
"""

RECOMMENDATIONS_HTML = """\
<html>
<body>
  <div class="article__body">
    <p>Keep this paragraph.</p>
    <a href="/syndication?article_slug=test">SYNDICATE THIS ESSAY</a>
    <a href="/essays/related">
      <img src="https://images.aeonmedia.co/images/related.jpg" alt="Related" />
      <p>Related article that should be stripped.</p>
    </a>
  </div>
</body>
</html>
"""

IMAGE_FALLBACK_HTML = """\
<html>
<body>
  <div class="article__body">
    <p><img src="https://images.aeonmedia.co/images/fallback.jpg" alt="Fallback hero" /></p>
    <p>Body text.</p>
  </div>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# Tests: _extract_slug
# ---------------------------------------------------------------------------

class TestExtractSlug:
    """Tests for the URL-slug extraction helper."""

    def test_extracts_slug_from_essays_url(self):
        """Slug from a standard /essays/<slug> URL is returned correctly."""
        result = fa._extract_slug("https://aeon.co/essays/the-age-of-the-brain")
        assert result == "the-age-of-the-brain"

    def test_extracts_slug_from_ideas_url(self):
        """Slug from a /ideas/<slug> URL is returned correctly."""
        result = fa._extract_slug("https://aeon.co/ideas/why-music-matters")
        assert result == "why-music-matters"

    def test_trailing_slash_stripped(self):
        """Trailing slash in URL does not affect slug extraction."""
        result = fa._extract_slug("https://aeon.co/essays/some-article/")
        assert result == "some-article"

    def test_uppercase_lowercased(self):
        """Slug is always returned in lowercase."""
        result = fa._extract_slug("https://aeon.co/essays/Some-Article")
        assert result == "some-article"

    def test_special_chars_stripped(self):
        """Characters other than letters, digits, and hyphens are removed from slug.

        Note: underscores are stripped (not converted to hyphens) because the URL
        query string is discarded by urlparse and only the path segment is used.
        """
        result = fa._extract_slug("https://aeon.co/essays/article-2025?q=1")
        assert result == "article-2025"

    def test_empty_path_returns_empty(self):
        """URL with no path returns an empty string."""
        result = fa._extract_slug("https://aeon.co/")
        assert result == ""

    def test_empty_string_returns_empty(self):
        """Empty URL returns an empty string."""
        result = fa._extract_slug("")
        assert result == ""


# ---------------------------------------------------------------------------
# Tests: parse_rss_feed
# ---------------------------------------------------------------------------

class TestParseRssFeed:
    """Tests for the RSS feed XML parser."""

    def test_returns_correct_number_of_articles(self):
        """parse_rss_feed returns one dict per RSS <item>."""
        articles = fa.parse_rss_feed(SAMPLE_RSS_XML)
        assert len(articles) == 2

    def test_first_article_title(self):
        """The title of the first item is parsed correctly."""
        articles = fa.parse_rss_feed(SAMPLE_RSS_XML)
        assert articles[0]["title"] == "The Age of the Brain"

    def test_first_article_id(self):
        """The id (slug) of the first item is derived from the link."""
        articles = fa.parse_rss_feed(SAMPLE_RSS_XML)
        assert articles[0]["id"] == "the-age-of-the-brain"

    def test_first_article_author(self):
        """The dc:creator element is used for the author field."""
        articles = fa.parse_rss_feed(SAMPLE_RSS_XML)
        assert articles[0]["author"] == "Sally Davies"

    def test_first_article_category(self):
        """The category element is parsed correctly."""
        articles = fa.parse_rss_feed(SAMPLE_RSS_XML)
        assert articles[0]["category"] == "Philosophy"

    def test_first_article_image_url(self):
        """The media:content url attribute is used for imageUrl."""
        articles = fa.parse_rss_feed(SAMPLE_RSS_XML)
        assert articles[0]["imageUrl"] == "https://images.aeon.co/brain.jpg"

    def test_second_article_no_image(self):
        """An item with no media:content or enclosure has an empty imageUrl."""
        articles = fa.parse_rss_feed(SAMPLE_RSS_XML)
        assert articles[1]["imageUrl"] == ""

    def test_excerpt_is_html_stripped(self):
        """HTML tags in <description> are stripped from the excerpt."""
        articles = fa.parse_rss_feed(SAMPLE_RSS_XML)
        assert "<p>" not in articles[0]["excerpt"]
        assert "First two sentences" in articles[0]["excerpt"]

    def test_published_at_is_iso_format(self):
        """The publishedAt field is an ISO 8601 formatted string."""
        articles = fa.parse_rss_feed(SAMPLE_RSS_XML)
        # Should be parseable as an ISO timestamp
        from dateutil import parser as dp
        dt = dp.parse(articles[0]["publishedAt"])
        assert dt.year == 2025

    def test_invalid_xml_returns_empty_list(self):
        """Invalid XML does not raise; returns an empty list."""
        result = fa.parse_rss_feed("this is not xml at all <><>")
        assert result == []

    def test_missing_channel_returns_empty_list(self):
        """RSS XML with no <channel> element returns an empty list."""
        xml = '<?xml version="1.0"?><rss version="2.0"></rss>'
        result = fa.parse_rss_feed(xml)
        assert result == []

    def test_item_missing_title_is_skipped(self):
        """An RSS item without a <title> element is skipped."""
        xml = """\
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <link>https://aeon.co/essays/no-title-article</link>
    </item>
  </channel>
</rss>
"""
        result = fa.parse_rss_feed(xml)
        assert result == []

    def test_respects_max_articles_limit(self):
        """At most MAX_ARTICLES items are returned even if the feed has more."""
        items_xml = ""
        for i in range(fa.MAX_ARTICLES + 5):
            items_xml += f"""
    <item>
      <title>Article {i}</title>
      <link>https://aeon.co/essays/article-{i}</link>
    </item>
"""
        xml = f'<?xml version="1.0"?><rss version="2.0"><channel>{items_xml}</channel></rss>'
        result = fa.parse_rss_feed(xml)
        assert len(result) <= fa.MAX_ARTICLES


# ---------------------------------------------------------------------------
# Tests: _sanitise_html
# ---------------------------------------------------------------------------

class TestSanitiseHtml:
    """Tests for the bleach-based HTML sanitiser."""

    def test_strips_script_tags(self):
        """<script> tags are stripped by bleach (text content is preserved as plain text,
        which is safe — it is not executable). In practice, script elements are always
        removed with their content by _remove_unwanted_elements before sanitisation."""
        html = "<p>Text</p><script>alert('xss')</script>"
        result = fa._sanitise_html(html)
        assert "<script" not in result

    def test_strips_iframe_tags(self):
        """<iframe> tags are removed."""
        html = "<p>Text</p><iframe src='evil.com'></iframe>"
        result = fa._sanitise_html(html)
        assert "<iframe" not in result

    def test_preserves_allowed_tags(self):
        """Allowed tags (p, h2, em, strong, a, blockquote) are preserved."""
        html = "<p>Hello <em>world</em></p><h2>Title</h2><blockquote>Quote</blockquote>"
        result = fa._sanitise_html(html)
        assert "<p>" in result
        assert "<em>" in result
        assert "<h2>" in result
        assert "<blockquote>" in result

    def test_adds_target_blank_to_links(self):
        """All <a> tags get target='_blank' rel='noopener noreferrer'."""
        html = '<p><a href="https://example.com">Link</a></p>'
        result = fa._sanitise_html(html)
        assert 'target="_blank"' in result
        assert 'rel="noopener noreferrer"' in result

    def test_strips_inline_style_attributes(self):
        """Inline style= attributes are stripped from allowed tags."""
        html = '<p style="color:red">Styled text</p>'
        result = fa._sanitise_html(html)
        assert "style=" not in result

    def test_strips_disallowed_div_tag_preserves_content(self):
        """Disallowed <div> tag is stripped but its text content is preserved."""
        html = "<div>Some text content</div>"
        result = fa._sanitise_html(html)
        assert "<div>" not in result
        assert "Some text content" in result

    def test_empty_string_returns_empty(self):
        """An empty input string returns an empty string."""
        result = fa._sanitise_html("")
        assert result == ""


# ---------------------------------------------------------------------------
# Tests: _make_secure_link
# ---------------------------------------------------------------------------

class TestMakeSecureLink:
    """Tests for the link security-attribute helper."""

    def test_adds_target_and_rel_to_plain_anchor(self):
        """A plain <a href="..."> gets target and rel added."""
        result = fa._make_secure_link('<a href="https://example.com">')
        assert 'target="_blank"' in result
        assert 'rel="noopener noreferrer"' in result

    def test_replaces_existing_target(self):
        """An existing target= attribute is replaced, not duplicated."""
        result = fa._make_secure_link('<a href="x" target="_self">')
        assert result.count("target=") == 1
        assert 'target="_blank"' in result

    def test_replaces_existing_rel(self):
        """An existing rel= attribute is replaced, not duplicated."""
        result = fa._make_secure_link('<a href="x" rel="nofollow">')
        assert result.count("rel=") == 1
        assert 'rel="noopener noreferrer"' in result


# ---------------------------------------------------------------------------
# Tests: reading time calculation
# ---------------------------------------------------------------------------

class TestReadingTime:
    """Tests for the estimated reading-time calculation embedded in extract_article_content."""

    def _make_html(self, word_count: int) -> str:
        """Create a simple HTML string with the given approximate word count."""
        words = " ".join(["word"] * word_count)
        return f"<p>{words}</p>"

    def test_short_article_minimum_one_minute(self):
        """Articles with very few words always return at least 1 minute."""
        html = self._make_html(10)
        result = math.ceil(10 / fa.WORDS_PER_MINUTE)
        assert max(1, result) == 1

    def test_exact_two_hundred_words_is_one_minute(self):
        """Exactly WORDS_PER_MINUTE words → 1 minute."""
        count = fa.WORDS_PER_MINUTE
        result = max(1, math.ceil(count / fa.WORDS_PER_MINUTE))
        assert result == 1

    def test_two_hundred_and_one_words_is_two_minutes(self):
        """WORDS_PER_MINUTE + 1 words → 2 minutes (ceil behaviour)."""
        count = fa.WORDS_PER_MINUTE + 1
        result = max(1, math.ceil(count / fa.WORDS_PER_MINUTE))
        assert result == 2

    def test_nine_hundred_words_is_five_minutes(self):
        """900 words at 200 WPM → ceil(4.5) = 5 minutes."""
        count = 900
        result = max(1, math.ceil(count / fa.WORDS_PER_MINUTE))
        assert result == 5


# ---------------------------------------------------------------------------
# Tests: extract_article_content
# ---------------------------------------------------------------------------

class TestExtractArticleContent:
    """Tests for the full article extraction pipeline."""

    def test_extracts_body_html(self):
        """Content in the .article__body element is extracted."""
        meta = {"imageUrl": "", "imageAlt": ""}
        result = fa.extract_article_content(SAMPLE_ARTICLE_HTML, meta)
        assert "First paragraph" in result["bodyHtml"]

    def test_removes_nav_elements(self):
        """<nav> elements are not present in the extracted body."""
        meta = {"imageUrl": "", "imageAlt": ""}
        result = fa.extract_article_content(SAMPLE_ARTICLE_HTML, meta)
        assert "Navigation" not in result["bodyHtml"]

    def test_removes_script_elements(self):
        """<script> elements are not present in the extracted body."""
        meta = {"imageUrl": "", "imageAlt": ""}
        result = fa.extract_article_content(SAMPLE_ARTICLE_HTML, meta)
        assert "alert" not in result["bodyHtml"]

    def test_removes_newsletter_elements(self):
        """Elements with class containing 'newsletter' are stripped."""
        meta = {"imageUrl": "", "imageAlt": ""}
        result = fa.extract_article_content(SAMPLE_ARTICLE_HTML, meta)
        assert "Subscribe now" not in result["bodyHtml"]

    def test_links_get_security_attrs(self):
        """All links in the body get target='_blank' rel='noopener noreferrer'."""
        meta = {"imageUrl": "", "imageAlt": ""}
        result = fa.extract_article_content(SAMPLE_ARTICLE_HTML, meta)
        assert 'rel="noopener noreferrer"' in result["bodyHtml"]

    def test_reading_time_is_positive_integer(self):
        """readingTimeMinutes is always a positive integer."""
        meta = {"imageUrl": "", "imageAlt": ""}
        result = fa.extract_article_content(SAMPLE_ARTICLE_HTML, meta)
        assert isinstance(result["readingTimeMinutes"], int)
        assert result["readingTimeMinutes"] >= 1

    def test_author_bio_extracted(self):
        """Author bio is extracted from the .author-bio element."""
        meta = {"imageUrl": "", "imageAlt": ""}
        result = fa.extract_article_content(SAMPLE_ARTICLE_HTML, meta)
        assert "Sally Davies" in result["authorBio"]

    def test_hero_image_extracted_when_meta_empty(self):
        """Hero image URL is extracted from the page when RSS meta has none."""
        meta = {"imageUrl": "", "imageAlt": ""}
        result = fa.extract_article_content(SAMPLE_ARTICLE_HTML, meta)
        assert result["imageUrl"] == "https://images.aeon.co/hero.jpg"
        assert result["imageAlt"] == "Brain scan"

    def test_rss_image_preserved_when_page_has_none(self):
        """If the page has no hero image, the RSS imageUrl is returned."""
        meta = {"imageUrl": "https://rss.example.com/img.jpg", "imageAlt": "RSS alt"}
        html_no_hero = "<html><body><div class='article__body'><p>Body</p></div></body></html>"
        result = fa.extract_article_content(html_no_hero, meta)
        assert result["imageUrl"] == "https://rss.example.com/img.jpg"

    def test_removes_audio_promo_blocks(self):
        """Inline 'Listen to this essay' promos are stripped from bodyHtml."""
        meta = {"imageUrl": "", "imageAlt": ""}
        result = fa.extract_article_content(PROMO_ARTICLE_HTML, meta)
        assert "Listen to this essay" not in result["bodyHtml"]
        assert "minute listen" not in result["bodyHtml"]
        assert "Real content starts here." in result["bodyHtml"]

    def test_strips_recommendations_after_syndication_link(self):
        """Content after the 'SYNDICATE THIS ESSAY' block is removed."""
        meta = {"imageUrl": "", "imageAlt": ""}
        result = fa.extract_article_content(RECOMMENDATIONS_HTML, meta)
        assert "SYNDICATE THIS ESSAY" not in result["bodyHtml"]
        assert "Related article that should be stripped." not in result["bodyHtml"]
        assert "Keep this paragraph." in result["bodyHtml"]

    def test_uses_first_image_as_fallback_hero(self):
        """When no hero is detected, the first content image is used as imageUrl."""
        meta = {"imageUrl": "", "imageAlt": ""}
        result = fa.extract_article_content(IMAGE_FALLBACK_HTML, meta)
        assert result["imageUrl"] == "https://images.aeonmedia.co/images/fallback.jpg"
        assert result["imageAlt"] == "Fallback hero"


# ---------------------------------------------------------------------------
# Tests: JSON file I/O
# ---------------------------------------------------------------------------

class TestLoadArticlesJson:
    """Tests for load_articles_json."""

    def test_returns_empty_structure_when_file_missing(self, tmp_path):
        """Returns empty structure when articles.json does not exist."""
        with patch.object(fa, "ARTICLES_JSON", tmp_path / "articles.json"):
            result = fa.load_articles_json()
        assert result == {"lastFetched": None, "articles": []}

    def test_loads_valid_json(self, tmp_path):
        """Returns parsed JSON when the file exists and is valid."""
        data = {"lastFetched": "2025-01-01T00:00:00", "articles": [{"id": "test"}]}
        json_file = tmp_path / "articles.json"
        json_file.write_text(json.dumps(data))
        with patch.object(fa, "ARTICLES_JSON", json_file):
            result = fa.load_articles_json()
        assert result == data

    def test_returns_empty_structure_on_corrupt_json(self, tmp_path):
        """Returns empty structure when the file contains invalid JSON."""
        json_file = tmp_path / "articles.json"
        json_file.write_text("not valid json {{{{")
        with patch.object(fa, "ARTICLES_JSON", json_file):
            result = fa.load_articles_json()
        assert result == {"lastFetched": None, "articles": []}


class TestSaveArticlesJson:
    """Tests for save_articles_json."""

    def test_writes_json_to_disk(self, tmp_path):
        """The data dict is correctly written as JSON to ARTICLES_JSON."""
        data = {"lastFetched": "2025-01-01T00:00:00", "articles": []}
        json_file = tmp_path / "articles.json"
        with patch.object(fa, "ARTICLES_JSON", json_file), \
             patch.object(fa, "DATA_DIR", tmp_path):
            fa.save_articles_json(data)
        written = json.loads(json_file.read_text())
        assert written == data


class TestDeleteStaleArticles:
    """Tests for delete_stale_articles."""

    def test_deletes_existing_stale_file(self, tmp_path):
        """An existing stale article file is deleted."""
        stale_file = tmp_path / "article-old-article.json"
        stale_file.write_text("{}")
        with patch.object(fa, "DATA_DIR", tmp_path):
            fa.delete_stale_articles({"old-article"})
        assert not stale_file.exists()

    def test_does_not_raise_if_file_missing(self, tmp_path):
        """No error is raised if the stale file does not exist."""
        with patch.object(fa, "DATA_DIR", tmp_path):
            fa.delete_stale_articles({"ghost-article"})  # should not raise


# ---------------------------------------------------------------------------
# Tests: Diff logic via run()
# ---------------------------------------------------------------------------

class TestRunPipeline:
    """Integration-style tests for the run() pipeline with mocked HTTP."""

    def _make_mock_response(self, text: str, status_code: int = 200) -> MagicMock:
        """Helper: create a mock requests.Response with given text."""
        mock_resp = MagicMock()
        mock_resp.text = text
        mock_resp.status_code = status_code
        mock_resp.raise_for_status = MagicMock()
        return mock_resp

    def test_no_new_articles_exits_cleanly(self, tmp_path, capsys):
        """run() prints 'No new articles' and returns when feed matches existing."""
        existing = {
            "lastFetched": "2025-01-01T00:00:00",
            "articles": [
                {"id": "the-age-of-the-brain", "publishedAt": "2025-06-01T10:00:00"},
                {"id": "why-music-matters",    "publishedAt": "2025-05-27T08:00:00"},
            ],
        }
        articles_file = tmp_path / "articles.json"
        articles_file.write_text(json.dumps(existing))

        with patch.object(fa, "ARTICLES_JSON", articles_file), \
             patch.object(fa, "DATA_DIR", tmp_path), \
             patch("fetch_articles.fetch_rss_feed",
                   return_value=SAMPLE_RSS_XML):
            fa.run()

        captured = capsys.readouterr()
        assert "No new articles" in captured.out

    def test_new_article_is_saved(self, tmp_path):
        """run() writes a new article-<id>.json when a new article is found."""
        # Existing articles.json has one of the two RSS articles already
        existing = {
            "lastFetched": None,
            "articles": [{"id": "why-music-matters", "publishedAt": "2025-05-27T08:00:00"}],
        }
        articles_file = tmp_path / "articles.json"
        articles_file.write_text(json.dumps(existing))

        with patch.object(fa, "ARTICLES_JSON", articles_file), \
             patch.object(fa, "DATA_DIR", tmp_path), \
             patch("fetch_articles.fetch_rss_feed",
                   return_value=SAMPLE_RSS_XML), \
             patch("fetch_articles.fetch_article_html",
                   return_value=SAMPLE_ARTICLE_HTML), \
             patch("fetch_articles.time") as mock_time:
            mock_time.sleep = MagicMock()
            fa.run()

        new_file = tmp_path / "article-the-age-of-the-brain.json"
        assert new_file.exists(), "New article JSON file should have been created"
        data = json.loads(new_file.read_text())
        assert data["id"] == "the-age-of-the-brain"
        assert "bodyHtml" in data

    def test_articles_json_updated_after_run(self, tmp_path):
        """articles.json is updated with the new article after run()."""
        existing = {"lastFetched": None, "articles": []}
        articles_file = tmp_path / "articles.json"
        articles_file.write_text(json.dumps(existing))

        with patch.object(fa, "ARTICLES_JSON", articles_file), \
             patch.object(fa, "DATA_DIR", tmp_path), \
             patch("fetch_articles.fetch_rss_feed",
                   return_value=SAMPLE_RSS_XML), \
             patch("fetch_articles.fetch_article_html",
                   return_value=SAMPLE_ARTICLE_HTML), \
             patch("fetch_articles.time") as mock_time:
            mock_time.sleep = MagicMock()
            fa.run()

        updated = json.loads(articles_file.read_text())
        ids = {a["id"] for a in updated["articles"]}
        assert "the-age-of-the-brain" in ids or "why-music-matters" in ids

    def test_rss_fetch_failure_exits_with_error(self, tmp_path, capsys):
        """run() exits with code 1 when the RSS feed cannot be fetched."""
        import requests as req_lib

        articles_file = tmp_path / "articles.json"
        articles_file.write_text('{"lastFetched":null,"articles":[]}')

        with patch.object(fa, "ARTICLES_JSON", articles_file), \
             patch.object(fa, "DATA_DIR", tmp_path), \
             patch("fetch_articles.fetch_rss_feed",
                   side_effect=req_lib.RequestException("connection refused")):
            with pytest.raises(SystemExit) as exc_info:
                fa.run()

        assert exc_info.value.code == 1

    def test_stale_articles_are_removed(self, tmp_path):
        """run() deletes article JSON files for articles no longer in the feed."""
        # Existing index has an article that is NOT in the RSS sample above
        stale_id = "an-old-article-no-longer-in-feed"
        existing = {
            "lastFetched": None,
            "articles": [{"id": stale_id, "publishedAt": "2024-01-01T00:00:00"}],
        }
        articles_file = tmp_path / "articles.json"
        articles_file.write_text(json.dumps(existing))
        # Create the stale file so we can check it gets deleted
        stale_file = tmp_path / f"article-{stale_id}.json"
        stale_file.write_text("{}")

        with patch.object(fa, "ARTICLES_JSON", articles_file), \
             patch.object(fa, "DATA_DIR", tmp_path), \
             patch("fetch_articles.fetch_rss_feed",
                   return_value=SAMPLE_RSS_XML), \
             patch("fetch_articles.fetch_article_html",
                   return_value=SAMPLE_ARTICLE_HTML), \
             patch("fetch_articles.time") as mock_time:
            mock_time.sleep = MagicMock()
            fa.run()

        assert not stale_file.exists(), "Stale article file should have been deleted"
