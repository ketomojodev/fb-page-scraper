# FB Page Scraper

Chrome extension (Manifest V3) that finds Facebook business pages by **keyword + location** and exports publicly visible contact data (`page_url`, `page_name`, `category`, `phone`, `email`, `website`, `city`, `country`, `address`, `scraped_at`) to CSV.

Built as a working MVP per `PRD.md`.

## Features

- **Keyword discovery** — searches Facebook for business pages per keyword (+ optional location).
- **Clean canonical URLs** — extracts `facebook.com/<handle>` (or numeric-id fallback) from the page's own `og:url` metadata. Never returns the personal/session tracking URL variants (ref/rdid/cft/entrypoint/locale/_rdr stripped).
- **Strict anti-detection** — humanized, randomized delays between pages (default 20–45 s), warm-up surfing before the first action, per-day + per-hour page caps (default 125/day, 10/hr), active-hour windows, and an automated cooldown ladder (mild → moderate → severe) that stops runs and decays the daily cap when Facebook shows a captcha/checkpoint.
- **Background operation** — runs in a background tab while you use Chrome (minimized or other tabs). Chrome must be open.
- **CSV export** — via your file manager (Save As), deduplicated by page URL.
- **Dedicated options page** with live settings (delays, caps, warm-up, active hours, cooldowns).

## Install (dev / unpacked)

1. `npm install` (Node 18+)
2. `npm run build` → produces `dist/`
3. In Chrome, open `chrome://extensions`, enable **Developer mode**
4. **Load unpacked** → select the `dist/` folder
5. Pin the extension, open **Settings**, add keywords, press **Start** in the popup

Prerequisites at runtime: you must be **logged in to Facebook** in this Chrome profile (the bot reuses your real session — that's the anti-detection strategy: identical fingerprint, real cookies, humanized behavior).

## Build

```bash
npm run build        # bundle to dist/
npm run build:watch  # rebuild on change
npm run typecheck    # tsc --noEmit
```

## Structure

```
src/
  background.ts      service worker: orchestrator, pacing, cooldown ladder, CSV export
  content.ts         in-page script: extraction, link discovery, block detection, humanized scrolling
  options.{ts,html}  settings UI
  popup.{ts,html}    quick controls + live status
  shared/            config/defaults, message contracts, URL normalization, scanner, IndexedDB store, CSV
build.mjs              esbuild bundle + icon/png generation
PRD.md                 Product Requirements Document
```

## Compliance note

Reminder (from PRD §9): this only collects **public business info**; it does not and will not bypass login walls, solve captchas, or scrape personal profiles. Facebook's ToS don't allow unsolicited automated collection — run at your own risk, on your own account, at a pace that behaves like a normal user (the app enforces this by default).