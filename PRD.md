# PRD — Facebook Business Page Lead Scraper (Chrome Extension)

**Product Name:** (TBD — working title "FB Page Scraper")
**Version:** 0.1 (MVP)
**Status:** Draft
**Author:** (TBD)
**Date:** 2026-08-08
**Stack:** Chrome Extension (Manifest V3), TypeScript

---

## 1. Overview & Goals

A Chrome extension that finds Facebook business pages by **keyword + location**, extracts **public business contact data** (page URL, name, category, phone, email, website, address/city/country/geo), deduplicates the results, and exports them to a **CSV file**. It runs in the background while the user is on other tabs with Chrome minimized, applying a **strict anti-detection layer** (humanized delays, pacing caps, and an auto-response ladder) so the operator's Facebook session is not flagged as a bot / "auto-manned" account.

**Primary Goals**
- Automate discovery of business pages by keyword/niche + location.
- Extract public fields: `page_url`, `page_name`, `category`, `phone`, `email`, `website`, `city`, `country`, `address`, `scraped_at`.
- Export weekly CSV (Excel-readable) with a **clean, canonical page URL** — never Facebook's personal/session-tracking URL variants.
- Run unattended in the background (Chrome minimized is acceptable; fully closed is not supported in MVP).
- Never get the operator's session flagged: sustained **125 pages/day cap** behind humanized behavior + auto response ladder.

**MVP Acceptance Criteria**
- Sustained **~875 pages/week** (≈125/day) on a single identity without a checkpoint.
- **≥85% field-hit rate** for phone/website/location on pages that publicly expose them.
- **0 captcha-triggered stops** for 2 consecutive weeks of normal operation.
- Output CSV contains only canonical page URLs (see §7 normalization).
- Resume capability: a crash/restart continues from the last checkpoint, no duplicate rows.

---

## 2. Non-Goals (explicitly out of MVP scope)

- No scraping of private user profiles or non-public data.
- No bypassing Facebook login walls or paywalled content.
- No auto-login / credential management.
- No accounts, no payment, no backend API (deferred — see §8).
- No proxy fabric / multi-identity rotation (deferred — enterprise/cloud design, see §5.6).
- No UI dashboard; output is CSV files only.

---

## 3. User Stories & Acceptance Criteria

**US-1 — Run a niche search**
> "As a marketer, I set `HVAC contractor` + `Chicago` in the options, run the bot for the week, and receive a CSV of page links + contact data."

AC-1: Correctly resolves search → list of matching pages → visits each once → writes CSV.
AC-2: Only business pages (not profiles/groups) are collected.

**US-2 — Background operation**
> "As a user, I want to close/tab away and have the bot keep working."

AC-1: Works while Chrome is minimized / user on other tabs.
AC-2: Resumes from last checkpoint after crash or computer restart.

**US-3 — Anti-detection guarantees**
> "As a user, I want to run the bot daily without triggering a checkpoint or being treated as a bot."

AC-1: `MAX_PAGES_PER_DAY = 125` enforced hard — no overflow runs.
AC-2: All delays randomized (human jitter); no constant-interval patterns.
AC-3: On any captcha/checkpoint/2FA signal → auto-stop per the response ladder (§5.5), never force-retry.

**US-4 — Clean links**
> "As a user, the CSV must contain links that work for anyone — not the tracking URL Facebook gives me."

AC-1: Every `page_url` is canonical: `https://www.facebook.com/<handle>` or `.../profile.php?id=<id>`.
AC-2: No `ref`, `rdid`, `cft[]`, `entrypoint`, `locale`, `_rdr`, `fbclid`, or user tokens in output.

**US-5 — Nobody out**
> "As a user, I don't want duplicate leads across runs."

AC-1: Dedup on canonical `page_url` in IndexedDB (row present once ever).

---

## 4. Architecture

```
┌─────────────────────────────── Chrome (user's real profile) ───────────────────────────────┐
│                                                                                             │
│  Options Page (settings.ts)          Off-screen Tab                  Background Service Worker │
│  ├ keywords + locations              └─ hosts facebook.com            ├─ scheduler / pacing     │
│  └ delays, caps, hours, cooldown        (tab shows pages)             ├─ anti-detection engine  │
│                                                                      ├─ checkpoint queue       │
│  Content Script (on facebook.com)                                     └─ CSV export glue       │
│  ├─ reads canonical URL from <meta og:url> + @handle                   │                        │
│  ├─ extracts phone/email/website/location/category                     │                        │
│  └─ humanized interaction (scroll/mouse/dwell)                        │                        │
│                                                                       ▼                        │
│                                             IndexedDB ─ lead cache + dedup                     │
│                                             chrome.storage.local ─ settings + checkpoints      │
│                                             chrome.downloads ──► out/<date>/leads.csv           │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Components**
- **Content script** (`facebook.com`): in-page context = the bot's DOM extraction is indistinguishable from real JS. Reads canonical URL + all data fields. Performs humanized interactions (scroll, hover, dwell).
- **Background service worker** (`MV3`): orchestrates the run, enforces the pacing/timing engine, responds to anti-detection signals, persists checkpoints.
- **Off-screen tab**: hosts the navigation surface for service worker (kept alive base; MV3 session lifetime guaranteed while Chrome runs).
- **Options page** (`settings.ts`, `antidetection.ts`): user config surface.
- **IndexedDB**: lead store + dedup.
- **`chrome.downloads`**: CSV export.

**Permissions (minimal, store-friendly):** `activeTab`, `tabs`, `storage`, `downloads`. No broad host permissions beyond `facebook.com`. Single-purpose story: "export public business contact info from public business pages."

---

## 5. Strict Anti-Detection Design (core section)

**Principle:** we run inside the operator's *real, authenticated session* with their genuinely available browser fingerprint. We optimize for **behavioral invisibility and volume discipline**, not fingerprint spoofing (spoofing is itself a red flag for logged-in Facebook sessions).

### 5.1 Threat model
We defend against:
- **Behavioral fingerprinting** — click rates, dwell time, scroll velocity, usage rhythm, request sequencing (uniform vs. relaxed timing).
- **Volume anomalies** — pages/day, searches/hour, business-page:profile ratio vs. typical human.
- **Bot heuristics** — no mousemove, instant navigation, WebDriver/`--headless` markers, synthetic events.
- **Session signals** — login frequency, geographic jumps, concurrent-session conflicts, non-age-typical hours.
- **Decision triggers** — Checkpoint (CAPTCHA / required_2fa / "suspicious activity").

### 5.2 Timing engine (configurable defaults)
| Parameter | Token | Default |
|---|---|---|
| Between pages | `PAGE_DELAY_RANGE` | 20–45 s, uniform + jitter |
| Between keyword searches | `SEARCH_DELAY_RANGE` | 45–120 s |
| Per action micro-delays | 250–900 ms after hover; typing 8–15 chars/s | built-in |
| Scroll segment timing | 1–4 s wrapper | built-in |
| Page cap / day | `MAX_PAGES_PER_DAY` | **125** |
| Page cap / hour | `PAGES_PER_HOUR` | 10 |
| Warm-up | `WARMUP_MIN` | 6 min of organic surfing before any bot action |
| Active hours | `ACTIVE_HOURS` | user's timezone, two 90-min sessions/day (e.g. 09:30–11:00, 14:30–16:00) — never one continuous long run |

Jitter rule: every delay = `BASE × k` with `k ~ logNormal(1, 0.2)`, plus random micro-pauses. **No constant intervals anywhere.**

### 5.3 Humanized interaction layer
- **Mouse:** generated `mousemove` events along Bézier curves source→target, per-step speed variance; click always preceded by hover.
- **Scroll:** wheel/touch events with momentum + deceleration, mid-scroll hesitation reads.
- **Dwell variance:** occasionally leave a page open longer than the data time requires; random tab-switch events and revisits.
- **Task wobble:** ~15% of visits perform a plausible "distraction" action (click see-more, open a link, scroll to footer, like a comment).
- **Input homogeneity:** typed pacing is realistic (8–15 chars/s with bursts/pauses); pause before submit.

### 5.4 Session & identity hygiene
- **Persistent real session:** reuse the operator's existing logged-in session/cookies; never auto re-login.
- **Warm-up:** first 5–10 min of every run = organic surfing (home feed, profile views, group scroll) before the first bot action.
- **Timezone consistency:** only run within `ACTIVE_HOURS` in the user's local timezone.
- **No headless/bot markers:** extension is MV3, never sets `--headless`; content script does all DOM reads in-page.
- **No proxies in MVP:** use operator's real residential IP; proxy/IP switching is itself an anomaly for logged-in sessions.

### 5.5 Detector & automated response ladder
**Detector** (background service worker): monitors DOM for `checkpoint`, `captcha`, `auth_required`, `restricted_content`, `login`, `logout` overlays; also watches for soft-blocks (200 responses containing error templates or login-fence copies).

**Response ladder (automatic):**

| Severity | Signal | Response |
|---|---|---|
| Mild | single captcha / soft-block | Stop runs 12 h; notify (notification) |
| Moderate | captcha ×2 within 48 h or "suspicious activity" fence | Stop 48 h + permanently lower `MAX_PAGES_PER_DAY` (config decay, e.g. 125 → 60) |
| Severe | 2FA prompt, checkpoint-required, forced logout | Hard stop, notify, leave session untouched, ≥72 h cooldown |

**Ramp-up:** after any cooldown ends, resume at 20% of current cap (≈25/day), +15%/day until back to cap.

---

## 6. Background Operation & Reliability

- Runs on an off-screen tab; service worker keeps state while Chrome is open/minimized.
- **Checkpoint/resume:** every processed page is committed to IndexedDB with status; a restart re-reads the queue and skips completed items (idempotent).
- **Retry/backoff:** per-page transient failures retried with exponential backoff (3 attempts); errors + the page classified.
- **Error taxonomy** per page: `captcha`, `login_required`, `not_found`, `no_data`, `unknown`.
- **Logging:** rotating log file (one per run) plus a summary report row per run (counts, errors, duration, pages added).

---

## 7. Data Schema (CSV console)

**Output columns (exact):**
| Column | Type | Notes |
|---|---|---|
| `page_url` | string | canonical, always `https://www.facebook.com/<handle>` or `.../profile.php?id=<id>` |
| `page_name` | string | |
| `category` | string | e.g. "Local service / Rehab center" |
| `phone` | string | as published |
| `email` | string | as published |
| `website` | string | from the About / СB section, canonicalized |
| `city` | string | |
| `country` | string | |

**URL normalization rules (hard requirement):**
- Prefer page's canonical @handle read from DOM meta `og:url` + explicit `@mention` handle.
- Fallback: `profile.php?id=<numeric>` → rebuilt as `https://www.facebook.com/profile.php?id=<id>`.
- Stripped from any captured URL: `ref`, `rdid`, `cft[]`, `entrypoint`, `locale`, `_rdr`, `fbclid`, user tokens, `?abcd=...` (signature/redirect noise).

**Dedup:** canonical `page_url` is the unique key in IndexedDB; duplicate rows never written.

---

## 8. Deferred Monetization (NOT in MVP)

- **Recommended model:** Freemium — free tier (~50 pages/mo) + paid tiers (1k / 5k / 20k pages per month), metered by pages scraped.
- **Implementation note:** preemption of the Chrome Web Store listing requires in-extension checkout via Chrome Web Store Payments (LSV) **for anything sold in the store**. Standard workaround (matches "let's just see a working version first"): extension is free on the store; the license key is sold + validated on a user's own site.
- **Architecture hook (kept cheap in MVP):** a `validateKey(key)` function (resolved to `NOT_ACTIVATED` in MVP) sitting behind a single call site; store the key in `chrome.storage.local`. A future minimal endpoint (Stripe + portal → license validation) can be dropped in without any rework of the extension core.
- Files like this: `LICENSE_KEY` stored, `settings.monetized.restriction` flags nothing in MVP, and `MAX_PAGES_PER_DAY` remains a plain config value (not entitlement-gated) until monetization lands.

---

## 9. Compliance & Risk

- **Facebook ToS:** Facebook's ToS prohibit unauthorised automated scraping; use of this tool may violate the ToS. Operators use the tool at their own risk; risk is carried on the operator's own Facebook account/session (FB may suspend it).
- **Scope of data:** collect *only public* business contact info visible to any visitor without login where possible; if a field requires a logged-in view, note that in the record, but do not attempt to bypass any access controls.
- **GDPR / data protection:** if the operator's target markets include EU users, collecting personal data (email/phone) has GDPR implications — operator is a data controller, responsible for lawful basis (legitimate business intent), the notice for storage, and applicable security. PRD assumes operator has a legitimate use for the data; recommendations are a disclaimer of liability, not legal advice.
- **Chrome Web Store policy:** extension must have a clear single-purpose justification; manual review may ask why broad DOM access on facebook.com. This PRD (public business-data field extraction) is the disclosed purpose story.
- **Do not auto-login at large scale.** No bypass login walls. No CAPTCHA bypass. These are hard non-negotiables — the extension stops and waits instead.

---

## 10. Milestones (MVP)

| M# | Scope | Exit criteria |
|---|---|---|
| M1 | Extension loads; manual scrape of a single opened page (extraction + normalization) | Fields extracted for one open FB business page; CSV row correct URL |
| M2 | Keyword+location search flow + timing engine | Queue resolves, visits pages, waits → delays applied; logs pacing |
| M3 | Background scheduled + continues + CSV export | Off-screen run works with Chrome minimized; per-day 125 cap enforced; checkpoint resume valid; CSV correct |
| M4 | Detector & response ladder (mild/moderate/severe) | Mock captcha trigger stops runs at correct severity; cooldown + ramp back |
| M5 | Polish + store submission | Options UI final; privacy policy drafted; manifest single-purpose wording; build/package path documented |

---

## 11. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Checkpoint on operator session | Med | High | Strict pacing 125/day; response ladder; ramp-down; warm-up |
| FB layout change breaks selectors | Med | Med | Selector registry + periodic manual audit; error taxonomy catches partial fails |
| Email often hidden behind login | High | Med | Requires visitor—email is only scraped when it's public in page content; MVP reports email hit-rate, doesn't force login |
| Store rejection of DOM access | Med | Med | Disclosed single purpose; minimal perms; privacy policy paper |
| Lead quality drift over time | Med | Med | Weekly re-fresh runs; dedup keys keep uniqueness; field-hit metric tracks quality |

---

## 12. Open Questions
1. Confirm the operator's FB account posture — new-ish or long-standing (long-standing = better risk profile), verify.
2. Confirm email scrape expectation: emails appear only if public on the page. Does the user accept ≤ its typical share of rows for MVP?
3. Naming and branding (TBD).
4. Confirm fluency on the Google $5/$6 store fee for publishing (vs. local unpacked use).