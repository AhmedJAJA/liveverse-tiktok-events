# SKY LIVE — TikTok LIVE Event Studio

**SKY LIVE** is the current public brand; repository and hosting slugs retain their earlier names to preserve existing links.

SKY LIVE is an Arabic interactive livestream events website with a public homepage at `/`, a presenter studio at `/studio`, and a read-only broadcast screen at `/overlay`. Built with Node.js and WebSockets, with an OBS overlay and a **best-effort unofficial** TikTok LIVE chat bridge.

**Included in v0.5:**
- Chat-based registration before games (default `انضم`, configurable) with duplicate prevention, auto-open on first LIVE connection.
- 4 event modes: quiz, guess-the-answer, chat-powered race, and random participant wheel.
- Live public read-only overlay at `/overlay` (suitable for OBS Browser Source / TikTok LIVE Studio Browser Source if supported).
- Leaderboard and recent comments stream.
- Demo chat simulation to test without going live.
- Admin controls protected by an `ADMIN_TOKEN` bearer token.
- Automatic WebSocket updates, reconnect attempts and basic tests.
- RTL / mobile-friendly dashboard with English technical labels.

## TIME BOMB | القنبلة المؤقتة

A server-authoritative "pass the bomb" elimination game. Page: **`/bomb`** (intro + host control room). Broadcast: the existing **`/overlay`** OBS source switches to the bomb view automatically.

**Rules (enforced by the server, `src/bomb.mjs`):**
- Registration uses the normal chat keyword; each viewer joins once and keeps their registration number. Nobody can join after kick-off.
- A random alive player gets the bomb and a shared timer starts (15 s by default, 5–60 s configurable).
- Only the current holder can pass, by typing `!مرر 12` or `!bomb 12` (Arabic-Indic digits accepted). Identity is the stable TikTok user id, never the display name. Passing to yourself, to an eliminated or unknown number, or after the deadline is rejected.
- **Passing never resets the timer.** At zero the current holder is eliminated, a 3.5 s transition plays, and a new random survivor gets the bomb with a fresh timer.
- The match ends only when one player remains; the survivor is announced and earns 10 points.
- Each match and turn has an id; stale, duplicate or concurrent requests can't touch a newer turn. Explosions are idempotent.

**Host tools** (all `POST /api/admin/*`, token-protected): `registration-open/close`, `start`, `bomb-pause`, `bomb-resume`, `bomb-end`, `bomb-restart`, `bomb-settings {seconds, sound, autoBots}`, `bomb-demo {count}` (test players), `bomb-pass {target, turn, match}` (manual pass for testing).

**Tests:** `tests/bomb.test.mjs` covers the required rule cases plus simulations of 2/10/50/100-player matches (880 matches on a virtual clock); `tests/bomb-http.test.mjs` checks viewer sync, reconnection, pause/resume and server-side auth through a real server and WebSockets.

## v0.7 — Royal Black redesign

SKY LIVE moves from the blue interface to a **Royal Black & Gold** identity across the landing page, presenter studio and broadcast screen.

- **Design system:** `public/royal-core.css` holds every token (obsidian/carbon/graphite surfaces, metallic gold, champagne, ivory), typography, buttons, fields, avatars and motion. Each surface adds one stylesheet: `royal-landing.css`, `royal-studio.css`, `royal-broadcast.css`. The eight previous layered stylesheets were removed.
- **Icons:** a single SVG sprite, `public/icons.svg` (24px grid, duotone), used through `<use href="/icons.svg#i-…">`. Octagonal gold "crest" containers replace emoji as interface icons. Each quiz answer has its own jewel shape so viewers can tell them apart at a glance.
- **Brand:** new crown-and-live-signal emblem (`sky-live-mark.svg`, also exported to `sky-live.webp`).
- **Broadcast:** a fixed 1920×1080 / 1080×1920 composition scaled by one unit, so OBS, the studio preview and phones show the same layout. Redesigned registration (invitation plaque, latest-entrant spotlight, participant wall, ghost-seat empty state), question plates, timer ring, 3-2-1 countdown, podium results and a staged winner reveal with gold particles.
- **Typography:** self-hosted Tajawal for Arabic and a Latin subset of Inter Display for numerals and wordmarks (both OFL, see `public/fonts/OFL.txt`).
- Reduced-motion support throughout; the demo simulator accepts an optional TikTok-CDN `avatar` URL (same allowlist as live data) for testing profile photos.

## v0.6 — Arabic broadcast redesign

- The home page opens directly to the broadcast stage. The top toolbar opens/closes registration, starts the next question, ends a round, opens settings, and toggles fullscreen.
- **الإعدادات** contains the existing connection, question library, game setup, demo comments and leaderboard. The public `/overlay` remains read-only and contains no administrative controls or credentials.
- Registration uses a dense participant wall and a highlighted latest entrant. The broadcast wall shows the 48 most recent registrations in landscape and 30 in portrait (newest first). Counts always include everyone registered. Empty slots never create fake contestants.
- Questions use a large white panel, four colored numbered shapes, live answer counts and small profile-photo stacks. Profile photos are accepted only from supported HTTPS TikTok CDNs, with initials if unavailable. Only the first valid answer counts; the correct answer stays private until results.
- Self-hosted Tajawal fonts, responsive 16:9 and 9:16 layouts, text fitting for long Arabic questions, and reduced-motion support. Font licensing is included under `public/fonts/OFL.txt`.
- Registration and results use simulated events in automated tests. A real TikTok LIVE session is still needed to validate the external chat connection.

For local development use `npm run dev -- --port 3000`. An optional, ignored `.env.local` can set `ADMIN_TOKEN` for development; production continues to use the hosting environment.

## Quick start

Node.js 20+ is required.

```bash
npm install
# macOS / Linux:
ADMIN_TOKEN='replace-with-long-random-secret' npm start
# Windows PowerShell:
# $env:ADMIN_TOKEN='replace-with-long-random-secret'; npm start
```

### Home page settings (optional)

The home page reads its game catalogue, prices and support channel from `/api/site` (`src/catalog.mjs`). Prices and the support link are owner settings:

| Variable | Default | Purpose |
|---|---|---|
| `SKY_PRICE_MONTHLY` | `29` | Monthly plan price |
| `SKY_PRICE_ANNUAL` | `290` | Annual plan price (the saving is computed) |
| `SKY_CURRENCY` | `ريال` | Currency label |
| `SKY_SUPPORT_URL` | *(empty)* | `https:` or `mailto:` link used by the subscribe buttons; when empty the buttons show «الاشتراك قريبًا» |
| `SKY_SUPPORT_LABEL` | `تواصل مع فريق Sky Live` | Name of the support channel |

Game covers are generated by `node tools/build-covers.mjs`.

Open `http://localhost:3000`. Enter the admin token into the studio panel and click **تفعيل صلاحية الإدارة**. Configure a round, save, start, and use demo chat to test. When `ADMIN_TOKEN` is omitted, a random token is printed in server logs for local testing. **Always set it in hosted production.**

## TikTok LIVE connection

1. Start a **public livestream** on TikTok.
2. Enter its username (without the leading `@`) into the studio and click **اتصال بالبث**.
3. Live comments are delivered to the current game mode through the backend.

The `tiktok-live-connector` npm library is **not official TikTok API access**, can fail for offline/private streams, rate limits or platform changes, and depends on third-party signing. We do **not** collect TikTok password/session cookies; connection for public rooms requires just a username. Do not rely on the integration as a guaranteed real-time event feed. TikTok or a signing service may change behavior unexpectedly. Only use with appropriate rights and respect TikTok rules.

## Chat registration: mandatory first step

1. Start your TikTok LIVE and connect LIVEVERSE from the host dashboard. On the **first successful connection**, registration opens automatically; alternatively press **فتح التسجيل** (works with demo chat, too).
2. Viewers must send the exact chosen word (default `انضم`, e.g. `!join` if you configure that) **in the stream comments** to enroll. Merely entering the TikTok live room or typing an answer does not register someone.
3. The broadcast overlay switches to a prominent registration screen showing the word, registered count and recent signups. Each stable TikTok user ID can register **once**; duplicate join messages do nothing.
4. Press **إغلاق التسجيل** or start the first round to close registration. Only registered users can answer, race or enter the wheel. All registered users remain eligible for every subsequent round; no repeated signups required.
5. You may reopen registration later (keeps names/points), or use **بدء فعالية جديدة** to wipe the current event and open registration for a new audience.

**Important:** the system uses the time that TikTok's comment reaches the server, not the viewer's real typing time. The TikTok connector is unofficial and may delay or drop messages. Registration and scores currently live in RAM, and a Render restart/redeploy clears them. For a serious prize event use reliable always-on hosting and database persistence.

## Event commands

| Mode | Viewer comment | Points | Behavior |
|---|---|---:|---|
| Quiz | `1`, `2`, `3`, `4`, `A`, `B`, `C`, `D`, or answer text (registered viewers only) | 10 / 7 / 5 / 3 / 2 / 1 | Only the first valid answer per viewer is accepted; the round remains open for its configured time (10–180 sec), then winners rank by earliest server receipt |
| Guess | Exact answer text (registered viewers only) | 10 / 7 / 5 / 3 / 2 / 1 | Only one guess per viewer; results ranked by first correct arrival at the round deadline |
| Race | `!go` / `!انطلق` (registered only) | 5 | First to target distance wins, 1.2s action cooldown |
| Wheel | Registered contestants are entered automatically | 5 | Names are collected; host draws a secure random pick |

Press **حفظ الإعدادات** to save, or **بدء الجولة** to save and immediately start. The quiz answer is a `1–4` index; the secret guess answer is not sent in public `/api/state` or OBS WebSocket updates.

## OBS setup

1. Add **Browser Source**.
2. URL: `https://<your-render-domain>/overlay` (or local `http://localhost:3000/overlay`).
3. Suggested width and height: `1920 × 1080`.
4. The overlay is a full-screen scene (not transparent). Use it as a scene or crop it. If rendering over gameplay, adapt overlay background in CSS.

## Deploy to Render

1. Create a **new GitHub repository**, upload these project files (not the ZIP itself), and connect that repo to Render.
2. Create **Web Service**: Runtime `Node`, Build `npm ci || npm install`, Start `npm start`, free plan if preferred.
3. Add `ADMIN_TOKEN` in Render Environment using a long unpredictable random string, e.g. `openssl rand -hex 32`. **Never commit this secret or share it publicly**.
4. The app binds to Render's injected `PORT`; use `/health` for the health check. `render.yaml` is provided for Blueprint deployments.
5. Render free services may sleep when idle. That interrupts live connectivity until the service wakes. Paid always-on hosting is more reliable for live events.

## Security / MVP limits

- Admin token checked server-side for every write action; WebSocket and overlay are public and read-only.
- **No persistent database yet:** points, comments and sessions reset on restart/deploy. For production tournaments, add PostgreSQL / Redis and authenticated host accounts.
- One shared studio/game per server instance, ideal for one creator. Scaling to multiple instances requires shared state and session routing.
- Some events can be dropped or delayed by TikTok. Prize competitions should not assume exact arrival order under network delays.
- A public site allows anyone to view chat and leaderboard; avoid sharing personal data. Do not tie rewards to paid gifts.
- Tests use simulated events; successful TikTok connection requires an actual live broadcast and cannot be certified by unit tests.

## Development

```bash
npm run check
npm test
```

## Stack

Native Node HTTP server, `ws` WebSocket, optional `tiktok-live-connector`, vanilla HTML/CSS/JS. No build step needed.

## Arabic question library (v0.2)

The studio now includes an offline, prebuilt Arabic question library under `data/questions.ar.json`.
Choose a **category** and **difficulty**, then select **تحميل سؤال** to prepare a round or **سؤال عشوائي وابدأ** to begin it immediately. The host can reset used-question history from the studio.

- Every entry includes a stable ID, category, difficulty, question, four unique options, correct-answer index, and a topical source/reference.
- Every source is a *reference for factual context*, **not** a claim that question wording came from the linked site. Questions are original compositions, generated factual variants, or arithmetic exercises. The bank has automated schema, duplicate, and arithmetic checks. Editorial checks of every culture/game fact are an ongoing task.
- The right answer is only returned to an authenticated admin request, never in public state or the OBS overlay.
- Used-question history is in memory and resets when the service restarts, is redeployed, or the host resets it. Persistent history can be added with a database.
- The current library mixes hundreds of mathematics and element/geography questions with manually curated games, football, anime and technology questions. The difficulty levels are estimates, not statistically calibrated.
- The authoring script at `tools/build_questions.py` can rebuild the JSON locally with Python + Babel + RDKit; running the website requires only Node.js.

### Reference sources for the question library

- Royal Society of Chemistry periodic table: <https://periodic-table.rsc.org/>.
- U.S. Department of State's country/capital reference: <https://fam.state.gov/FAM/05FAH01/05FAH011020.html>.
- FIFA tournament archive and champions: <https://www.archives.fifa.com/fifa_world_cup>, <https://www.fifa.com/en/tournaments/mens/worldcup>.
- Official Dragon Ball: <https://en.dragon-ball-official.com/about/>.
- Minecraft gameplay guides: <https://help.minecraft.net/hc/en-us/sections/27983418545293-Minecraft-Game-Guides>.
- MDN web platform documentation: <https://developer.mozilla.org/en-US/docs/Web>.

Open Trivia DB was researched as an optional future provider, but its API questions were **not copied** into this bundled Arabic bank; an external API is not required to play. Its content is CC BY-SA 4.0 and any future import must comply with attribution and share-alike terms: <https://opentdb.com/api_config.php>.

## v0.3 — locked first answers and timed podium

- Quiz and guessing rounds accept **exactly one valid answer per unique TikTok user ID per round**, even if it was incorrect. Chat without any of the four valid quiz choices is ignored. A second response is never able to replace a previously locked answer.
- Configure a 10–180 second timer (30 seconds by default). The server ends the round even if nobody comments; the host's **إيقاف** button also ends the round early and opens results.
- At round end, the OBS overlay shows a full results panel with up to the first 10 fastest correct respondents, server-receipt times relative to the start, and podium medals. The host dashboard shows up to 20.
- Speed awards cumulative points: 1st **10**, 2nd **7**, 3rd **5**, 4th **3**, 5th **2**, all subsequent correct responses **1** point. Cumulative tie-breaks use average response time.
- The answer key is never included in public state before the results screen. Times reflect **server arrival**, not precise time the viewer pressed Send, because TikTok may buffer/delay comments.
- Race and wheel modes keep their existing rules; the single-answer rule applies only to quiz and guessing rounds.

