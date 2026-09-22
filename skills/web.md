---
name: web
triggers:
  - scrape
  - crawl
  - website
  - browser
  - playwright
  - dom
  - selector
  - link
  - sitemap
  - http
  - fetch
weight: 1.0
---

# Web Skill

When interacting with the live web.

## Tool selection

- `scrape_url` — single static page, fast. First stop.
- `scrape_multiple` — same shape across many URLs.
- `scrape_sitemap` — discover URLs then scrape. Whole-section harvesting.
- `scrape_api` — known JSON endpoint, no parsing.
- `web_fetch` — raw text, when you need full control.
- `screen_capture` / `webcam_capture` — when the page is JS-rendered and
  cheerio can't see it; falls back to the browser.

## Defaults

- Always set a `maxChars` cap on bulk scrapes. Default is fine for one page,
  not for a hundred.
- Add delays between requests when crawling a single domain.
- Cache scraped content keyed by URL + etag/last-modified when available.

## Refuse

- Scraping behind auth without explicit permission.
- Bypassing robots.txt.
