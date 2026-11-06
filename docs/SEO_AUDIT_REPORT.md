# SPONGE LIVE — سبونج لايف · Technical SEO audit and fixes

Audit date: 2026-11-06 · Site: https://spongelive.com · Repository: AhmedJAJA/liveverse-tiktok-events
Production at audit time: Render service `liveverse-tiktok-events` (Frankfurt, plan 0.5 CPU / 512 MB), live deploy
`dep-dbmrfljm8hqs73b8fhu0` = commit `8b54c9f` (the same commit this branch starts from).

This report separates three things that are often confused:

1. **Technical readiness** — what the site sends to crawlers. This is what the work below changes and measures.
2. **Indexing** — whether Google/Bing actually store the pages. Only Search Console / Bing Webmaster Tools can show
   this, after ownership verification (manual steps, section E). Nothing in this report claims indexing.
3. **Ranking** — position for queries such as «ألعاب تفاعلية للتيك توك». Depends on competition, links, brand
   searches and time. Not measurable yet and not promised.

Scores below are Lighthouse lab scores and an internal pass/fail checklist — not an official Google score.

---

## How the audit was done (evidence sources)

| Check | Tool / method | Ran against |
|---|---|---|
| DNS | `dns.google` DoH API (A, AAAA, CNAME, TXT, CAA, NS) | public DNS |
| Status codes, headers, redirects | `curl` through the sandbox proxy, 42 URLs | **production** |
| Raw HTML vs rendered DOM, console errors, failed requests, headings, metadata, sideways scroll | Playwright + Chromium 153, Pixel 7 and 1366×900 | **production** (before), local (after) |
| Internal links | every same-origin `<a href>` found on the 8 rendered public pages (35 URLs) | **production** |
| Lighthouse 12 (perf, a11y, best practices, SEO) | local Chromium, mobile + desktop presets | **production** (before), local before/after |
| PageSpeed Insights / CrUX field data | Google API | **not available**: the anonymous daily quota was exhausted (`Quota exceeded … Queries per day`). No field data reported. |
| Visual regression | full-page screenshots, `main` vs this branch, pixel diff | local, both versions side by side |
| Search Console / Bing | — | **not verified**: no account access from this environment |

Production `http://` (port 80) could not be tested: the sandbox only allows outbound HTTPS. Render documents an
automatic HTTP→HTTPS redirect for custom domains; it is listed as *not verified* below.

---

## A. Initial problems (production, before this change)

| # | URL / file | Problem | Severity | Search impact | Evidence |
|---|---|---|---|---|---|
| 1 | `/robots.txt` | Missing — **404** (JSON body) | High | Crawlers get no sitemap hint; fine to crawl but nothing declared | `curl` → `404 application/json` |
| 2 | `/sitemap.xml` | Missing — **404** | High | No list of canonical pages for Google/Bing | `curl` → `404` |
| 3 | `liveverse-tiktok-events.onrender.com` | Full duplicate of the site, **200** on every page, no canonical, no noindex | High | Two hosts compete for the same content; signals split | `curl -I https://liveverse-tiktok-events.onrender.com/games` → `200` |
| 4 | all public pages | No `<link rel="canonical">` | High | `/?utm_…`, `/home.html`, onrender host all look like separate pages | Playwright: `canon []` on 8 pages |
| 5 | `/home.html`, `/games.html`, `/guide-games.html`, `/privacy.html`, `/index.html` … | Raw file names answer **200** — duplicates of `/`, `/games` … | Medium | Duplicate URLs | `curl` → `200` |
| 6 | `/overlay`, `/play?room=…`, `/draw`, `/u/SPG-…`, `/index.html`, `/event.html`, `/bomb.html` | 7 app HTML files (OBS overlay, viewer join page, drawing page, public profiles, dashboard, setup pages) served **200 with no noindex** (`/role`, `/tool`, `/login`, the «قيد التطوير» notice already had `meta noindex`) | Medium | Thin app/user pages can be indexed | `curl` (no `X-Robots-Tag`); no `meta robots` in those files |
| 7 | `/games` | Game list is an **empty shell in the HTML** (`<ul id="gameGrid"></ul>`), filled by `games.js` | High | Only 1,446 characters of text in the first response; all 22 games invisible without JS | raw text 1,446 vs rendered 5,360 chars |
| 8 | `/games`, guides | **No Open Graph / Twitter card** | Medium | Bad previews on WhatsApp/X/Telegram shares | Playwright: `og []` |
| 9 | `/` | `og:image` is **relative** (`/brand/og-512.webp`), 512×512, no `og:url/description`, no Twitter card | Medium | Many crawlers ignore relative images; square image is cropped | `home.html` line 9 |
| 10 | all pages | No structured data (Organization / WebSite) | Low | No site-name / logo signals | Playwright: `ld 0` |
| 11 | `/` | Title only «سبونج لايف» — no description of what the site is | Medium | Weak relevance for «ألعاب بث مباشر تفاعلية» | `<title>` |
| 12 | `/guide/games` | Describes every game as ready to play while 21 of 22 are «قيد التطوير» in production | Medium | Misleading content | `/api/site`: only `roulette` = `available` |
| 13 | all | No `Strict-Transport-Security` | Low | Best practice only | response headers |
| 14 | `/games/` (trailing slash) | **404** instead of redirect | Low | Lost links | `curl` → `404` |
| 15 | favicon | Only a 64 px icon (Google wants a multiple of 48 px) | Low | Favicon may not show in results | `<link rel="icon">` |
| 16 | DNS | No TXT records on `spongelive.com` → no Search Console domain verification yet | Info | Indexing cannot be monitored | DoH: `TXT []` |

Things that were already right: HTTPS with a valid certificate (Cloudflare in front of Render), `www` → apex **301**,
`lang="ar" dir="rtl"` on every page, one `<h1>` per public page, `alt` on every image, no console errors, no failed
requests, no sideways scroll on phones, unknown URLs return a real **404**, private pages redirect to sign-in (302),
TikTok/Kick OAuth links already `rel="nofollow"`, 35 internal links: 25 × 200, 10 × 302 (sign-in), **0 broken**.

---

## B. Implemented fixes

| File | Change |
|---|---|
| `src/seo.mjs` (new) | One place for the rules: `SITE_URL` (default `https://spongelive.com`), the 5 indexable pages with `lastmod`, `robots.txt`, `sitemap.xml`, the 301 rules, the `X-Robots-Tag` policy, Search Console/Bing tag sanitising, IndexNow key, and the server-rendered library cards (same markup as `games.js`). |
| `server.mjs` | Serves `/robots.txt` and `/sitemap.xml` (200, cached 1 h). 301: `/home.html`→`/` etc., `/games/`→`/games`, and in production the indexable pages on `*.onrender.com` / `www` → `https://spongelive.com/…` (query kept). Sign-in, OAuth callbacks, overlays, join pages, APIs and WebSockets are **not** redirected. `X-Robots-Tag: noindex` on every HTML page except the 5 indexable ones on the canonical host, and on every JSON response. `Strict-Transport-Security: max-age=31536000` in production over HTTPS (no `includeSubDomains`, no preload). `/games` HTML now contains every game card with its live status; optional `GOOGLE_SITE_VERIFICATION` / `BING_SITE_VERIFICATION` meta tags on `/`; optional `/<INDEXNOW_KEY>.txt`. |
| `public/home.html`, `games.html`, `guide-games.html`, `guide-tiktok.html`, `guide-tools.html` | Unique title and description, absolute canonical, full Open Graph + Twitter card (1200×630 PNG), 192 px icon, JSON-LD: `Organization` + `WebSite` on `/`, `BreadcrumbList` on the others. No ratings, reviews, prices or awards. |
| `public/guide-games.html` | One sentence: some games are «قيد التطوير», the live status is in the library (link). |
| `public/brand/og-1200x630.png` (new) | Share image (131 KB) made from the existing brand assets (sponge artwork, Tajawal font, theme colours). |
| `tools/indexnow.mjs` (new) | Manual IndexNow submission of public pages changed since a date; checks the key file on the live site first; dry-run; logs and fails on 400/403/422/429. |
| `tests/seo.test.mjs` (new) | 13 tests (section D). |
| `tests/library.test.mjs`, `tests/sky-live-brand.test.mjs` | Kept their intent: "no external resources" ignores search metadata; the Latin «SPONGE LIVE» stays banned from the visible page but is allowed in `<head>` metadata (a search term). |
| `.github/workflows/seo.yml` (new) | On every PR: syntax check, SEO suite (with Chromium), full test suite. No third-party calls. |
| `render.yaml`, `package.json` | Documents `SITE_URL`, `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`, `INDEXNOW_KEY`; `npm run test:seo`; new files in `npm run check`. |

Decisions:
* **robots.txt blocks almost nothing** (only `/api/admin|manage|oauth|billing|kick/` and `/go/`). Private pages are protected by sign-in on the server and say `noindex` — blocking them in robots.txt would hide that `noindex` from crawlers. `/api/site`, `/api/streams` and all CSS/JS/images stay crawlable because the public pages need them to render.
* **Sitemap = 5 pages.** Game pages need sign-in (302) and the notice page is `noindex`; `/privacy`, `/terms`, `/refund` already had `meta noindex` set by the owner — left as is (they can be added later by removing that tag and adding them to `INDEXABLE_PAGES`).
* `lastmod` = 2026-11-06 for all five pages: each one's content changed in this commit (and in commits earlier the same day). A test compares `lastmod` with the page's last git commit so it cannot silently go stale.
* **No `SoftwareApplication`/`VideoGame` schema**: it would need offers/ratings that would be invented or inaccurate (21 of 22 games are under development).
* **IndexNow**: useful for Bing/Yandex only; implemented as a manual command (not on server start, so restarts never resend). Google ignores it.

Code review (high effort, 8 angles) found 8 items; 7 fixed (configurable `SITE_URL` now rewrites canonicals/OG/JSON-LD too, library HTML cached per status signature, ETag helper, escaper covers `'`, CLI entry detection, browser test ignores aborted requests, unused import). 1 accepted trade-off: see E.

### Tests performed (this branch, local)

| Run | Result |
|---|---|
| `node --test tests/seo.test.mjs` | 13 tests: **12 pass, 0 fail, 1 skip** (git `lastmod` check needs full history — runs in CI with `fetch-depth: 0`) |
| `npm test` (whole project) | **339 tests: 303 pass, 0 fail, 36 skip** (35 need PostgreSQL, same as before; 1 above). Before the change: 326 tests, 291 pass, 0 fail, 35 skip. |
| `npm run check` | pass |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Secret scan of the diff | no credentials |
| Production-mode server (`NODE_ENV=production`) | onrender `/games?utm=1` → 301 `https://spongelive.com/games?utm=1`; onrender `/login`, `/overlay` → 200 + `noindex`; onrender `/api/oauth/google/callback` → unchanged 302; HSTS present over HTTPS only |
| Visual diff `main` vs branch (Playwright, reduced motion) | `/` and `/games` with JS: **0 changed pixels** (phone), 12 px on desktop `/` (animation); `/guide/games`: +1 paragraph only; `/games` **without JS**: before = empty grid (3,654 px tall), after = all 22 cards in the site's own card design (25,095 px) |

What was **not** run: tests needing PostgreSQL (accounts, Google sign-in flow with a database, payments) — they are
skipped here exactly as before the change; the change does not touch those code paths (only adds a 301/robots step
for GET page addresses, verified by the "app routes stay" test). No real TikTok/Kick/Google OAuth round-trip was
performed.

---

## C. Readiness scorecard

| Area | Check | Before | After (local) | After (production) |
|---|---|---|---|---|
| Domain & DNS | apex A record → Render, `www` CNAME → Render | Pass | — | Pass (unchanged) |
| Domain & DNS | Search Console TXT record | Fail | — | **Manual (E1)** |
| HTTPS | valid certificate, HTTP/2 | Pass | — | Pass |
| HTTPS | http → https redirect | Not verified | — | Not verified (sandbox blocks port 80) |
| HTTPS | HSTS | Fail | Pass | Not verified until deploy |
| Crawlability | robots.txt 200, allows public pages + assets, sitemap line | Fail | Pass | Not verified until deploy |
| Crawlability | important content in first HTML (library) | Fail | Pass | Not verified until deploy |
| Crawlability | no crawler blocked by middleware | Pass | Pass | Pass |
| Indexability | public pages indexable, everything else noindex | Fail | Pass | Not verified until deploy |
| Indexability | duplicate host (onrender) consolidated | Fail | Pass | Not verified until deploy |
| Indexability | duplicate file URLs → 301 | Fail | Pass | Not verified until deploy |
| sitemap.xml | valid XML, 200, only 200-status canonical pages, real lastmod | Fail | Pass | Not verified until deploy |
| Canonicals | one absolute self-canonical per public page | Fail | Pass | Not verified until deploy |
| Page metadata | unique title + description, one H1, heading order, `lang=ar dir=rtl` | Partial | Pass | Not verified until deploy |
| Social | Open Graph + Twitter, absolute 1200×630 image | Fail | Pass | Not verified until deploy |
| Structured data | valid JSON-LD, matches visible content, nothing invented | Fail | Pass (parsed + checked by test; not run through Google's Rich Results Test) | Not verified |
| Internal links | 0 broken, no links to redirected addresses | Pass | Pass | Pass (before) |
| Mobile | renders, no sideways scroll, no console errors | Pass | Pass | Pass (before) |
| Performance | Lighthouse ≥ 90 mobile & desktop | Pass | Pass | Pass (before) |
| Content quality | honest game status, real descriptions | Partial | Pass | Not verified until deploy |
| Production verification | fixes visible on spongelive.com | — | — | **Pending deploy approval** |
| Search Console | property verified, sitemap submitted, URL inspection | Fail | — | **Manual (E1–E2)** |
| Bing | site verified, sitemap submitted | Fail | — | **Manual (E3)** |

Technical checklist after this branch (local): **16 of 16 code-controlled items pass**. Production: pending deploy.
Account-level items (Search Console, Bing, DNS TXT): 0 of 3 — they need you.

---

## D. Before and after (measured)

### Lighthouse 12 (lab; scores perf / a11y / best-practices / SEO)

| Page | Production before — mobile | Production before — desktop | Local `main` — mobile | Local branch — mobile | Local `main` — desktop | Local branch — desktop |
|---|---|---|---|---|---|---|
| `/` | 97 / 100 / 100 / 100 (LCP 1.8 s, CLS 0.005) | 100 / 100 / 100 / 100 | 96 / 100 / 100 / 100 | 95 / 100 / 100 / 100 (LCP 2.6 s, CLS 0.007) | 100 ×4 | 100 ×4 |
| `/games` | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | 99 / 100 / 100 / 100 | 97 / 100 / 100 / 100 (99 on 3 repeat runs) | 97 / 100 / 100 / 100 (CLS **0.105**) | **100** / 100 / 100 / 100 (CLS 0.058) |
| `/guide/games` | — | — | 100 ×4 | 100 ×4 | 100 ×4 | 100 ×4 |

Repeat runs of `/games` mobile, 3 each: `main` 99/99/99, branch 99/99/99 (TBT 0–110 ms both — noise).
Lighthouse SEO was already 100 before the change: its audit does not check for a sitemap, canonicals across hosts,
Open Graph, structured data or a duplicate onrender host — which is exactly what was missing. Field data (INP, real
LCP/CLS) was not available (no PageSpeed quota; the site is too new for CrUX).

### Other measures

| Measure | Before (production) | After (local branch) |
|---|---|---|
| Public URLs audited | 42 status checks + 8 rendered pages × 2 devices | same set + 19 private/app routes in tests |
| Broken internal links | 0 | 0 (enforced by test) |
| Indexable pages declared | 0 (no sitemap) | 5 |
| Pages with canonical | 0 / 5 | 5 / 5 |
| Pages with Open Graph | 1 / 5 (relative image) | 5 / 5 (absolute 1200×630) |
| JSON-LD blocks | 0 | 5 |
| App/private HTML files without noindex | 7 (`overlay`, `play`, `draw`, `profile`, `index`, `event`, `bomb`) | 0 (every non-public HTML response carries `X-Robots-Tag: noindex`) |
| Text in first HTML of `/games` | 1,446 chars, 0 game cards | all 22 game cards (title, category, summary, how to play, status) |
| Console errors / failed requests | 0 / 0 | 0 / 0 (test fails otherwise) |

Screenshots (session evidence, not committed): production phone home page; `main` vs branch for `/`, `/games`,
`/guide/games` (phone, desktop, phone without JavaScript).

### Remaining issues (not fixed here)

* 404 pages are JSON (`{"error":"Not found"}`) — correct status, but a visitor who mistypes a URL sees raw JSON. A designed 404 page would be a visual change; left for your decision.
* ~~Signed-in visitors on the onrender.com address would be moved to spongelive.com and lose their session~~ — fixed in the safety review (F1 below).
* Home page LCP on a throttled phone profile is 1.8–2.7 s (target < 2.5 s): the hero artwork; unchanged by this work.
* `/privacy`, `/terms`, `/refund` stay `noindex` (owner's existing choice).

---

## E. Remaining manual actions (need your accounts)

**E1 — Google Search Console (Domain property)**
1. Open https://search.google.com/search-console/ → *Add property* → **Domain** → `spongelive.com`.
2. Google shows a TXT value like `google-site-verification=…` (this report does not invent one).
3. GoDaddy → *My Products* → `spongelive.com` → *DNS* → *Add new record*: Type **TXT**, Name **@**, Value = the text from Google, TTL default. **Do not edit or delete** the existing `A @ 216.24.57.1` or `CNAME www → liveverse-tiktok-events.onrender.com` records.
4. Back in Search Console → *Verify* (DNS can take minutes to hours).
   *Alternative (no DNS):* choose *URL prefix* `https://spongelive.com/` → *HTML tag*, copy only the `content` value into Render env `GOOGLE_SITE_VERIFICATION`, redeploy; the tag appears on `/`.

**E2 — after verification and after this branch is deployed**
* *Sitemaps* → submit `https://spongelive.com/sitemap.xml`.
* *URL inspection* → `https://spongelive.com/`, `/games`, `/guide/games` → *Test live URL* → *Request indexing*.
* Check *Pages* (indexing report) after a few days; a submitted sitemap does **not** mean the pages are indexed.

**E3 — Bing Webmaster Tools** — https://www.bing.com/webmasters/ → *Import from Google Search Console* (fastest), or add the site and use the `msvalidate.01` value as Render env `BING_SITE_VERIFICATION`. Submit the sitemap.

**E4 — IndexNow (optional)** — set Render env `INDEXNOW_KEY` to a random 32-character hex string, deploy, then after each deploy that changes public pages run `INDEXNOW_KEY=… node tools/indexnow.mjs --since YYYY-MM-DD` from any machine with internet access.

**E5 — Deploy approval** — Render auto-deploys `main` on every commit. Merging the pull request **is** the production deploy. After it is live, re-run: `curl -I https://spongelive.com/robots.txt`, `/sitemap.xml`, `curl -I https://liveverse-tiktok-events.onrender.com/games` (expect 301) and `npm run test:seo`.

**E6 — Optional** — a PageSpeed Insights API key would allow measuring field data (INP) from this environment.

---

## F. Pre-merge production-safety review (same day)

**Cookies and sign-in.** Every cookie (`sky_session`, `sl_dev`, `sl_ref`, `oa_state`, `og_bind`, `g_nonce`, `g_pending`) is
host-only (no `Domain=`), `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS — so spongelive.com and the onrender.com
address have separate sessions. OAuth redirect URIs are built from the visitor's own host (`baseFor`), and the
`/api/oauth/*` routes are never redirected, so a Google/TikTok/Kick sign-in that starts on a host finishes on it.

**F1 — fixed.** After a successful sign-in on the onrender.com address the server sends the user to `/games` (or `/`);
the first version of this PR moved that page to spongelive.com, where the user has no session → signed out right after
signing in. Now a request carrying a session cookie is never moved to another host (the page still carries `noindex`
there). Crawlers send no cookies, so the duplicate-host consolidation is unchanged. Tests added (unit + HTTP).

**F2 — fixed.** With real network latency the server-rendered library cards played their entrance animation, then
`games.js` replaced them and the new cards faded in again (measured: 15 opacity dips on the first card with an 800 ms
`/api/site`). The first swap now skips the entrance (`.gl-card.no-in`); later filter/search repaints animate as before.
Measured after: 0 dips. A browser regression check was added to `tests/seo.test.mjs`. This was also why
`tests/library.test.mjs` measured the play button at 47.9998 px instead of 48 px under load.

**Database tests.** Ran against an isolated, throwaway PostgreSQL 16 in the sandbox (`localhost:55432`, deleted
afterwards; production `DATABASE_URL` was never set). Full suite: **339 tests, 337 pass, 1 fail, 1 skip**. The failure is
`tests/roulette-http.test.mjs` (timeout "waiting for history") — it fails the same way on `main` in a full parallel run
(326 tests, 325 pass, 1 fail) and passes on both `main` and this branch when run alone (2 runs each): a pre-existing
timing-sensitive test, unrelated to SEO. Covered by these DB tests: accounts, Google sign-in code paths (with a fake
Google), sessions, payments/economy, roulette, library, lobbies, overlays.

**Scope.** 18 files, all SEO-related. `server.mjs`: a 301/robots step before routing (GET/HEAD page addresses only),
`robots.txt`/`sitemap.xml`, HTML rendering of the library, headers. Not touched: WebSocket upgrade (live games, OBS),
POST webhooks (Kick, payments), OAuth handlers, sessions, game engines.

**Still unverified.**
* Real Google/TikTok/Kick OAuth round-trips and a real payment (no provider accounts here; code paths unchanged and covered by fakes).
* Production after deploy (needs the merge).
* Who actually uses the onrender.com address: Render returned no request logs for this service.
* `http://` → `https://` on production (sandbox cannot reach port 80).
* Field Core Web Vitals (no PageSpeed quota).
