# LIVEVERSE — TikTok LIVE Event Studio

A standalone Arabic interactive livestream events dashboard. Built with Node.js and WebSockets, with an OBS overlay and a **best-effort unofficial** TikTok LIVE chat bridge.

**Included in v0.1:**
- 4 event modes: quiz, guess-the-answer, chat-powered race, and random participant wheel.
- Live public read-only overlay at `/overlay` (suitable for OBS Browser Source / TikTok LIVE Studio Browser Source if supported).
- Leaderboard and recent comments stream.
- Demo chat simulation to test without going live.
- Admin controls protected by an `ADMIN_TOKEN` bearer token.
- Automatic WebSocket updates, reconnect attempts and basic tests.
- RTL / mobile-friendly dashboard with English technical labels.

## Quick start

Node.js 20+ is required.

```bash
npm install
# macOS / Linux:
ADMIN_TOKEN='replace-with-long-random-secret' npm start
# Windows PowerShell:
# $env:ADMIN_TOKEN='replace-with-long-random-secret'; npm start
```

Open `http://localhost:3000`. Enter the admin token into the studio panel and click **تفعيل صلاحية الإدارة**. Configure a round, save, start, and use demo chat to test. When `ADMIN_TOKEN` is omitted, a random token is printed in server logs for local testing. **Always set it in hosted production.**

## TikTok LIVE connection

1. Start a **public livestream** on TikTok.
2. Enter its username (without the leading `@`) into the studio and click **اتصال بالبث**.
3. Live comments are delivered to the current game mode through the backend.

The `tiktok-live-connector` npm library is **not official TikTok API access**, can fail for offline/private streams, rate limits or platform changes, and depends on third-party signing. We do **not** collect TikTok password/session cookies; connection for public rooms requires just a username. Do not rely on the integration as a guaranteed real-time event feed. TikTok or a signing service may change behavior unexpectedly. Only use with appropriate rights and respect TikTok rules.

## Event commands

| Mode | Viewer comment | Points | Behavior |
|---|---|---:|---|
| Quiz | `1`, `2`, `3`, `4`, `A`, `B`, `C`, `D`, or answer text | 5 | First correct answer wins and round stops |
| Guess | Exact answer text (normalizes Arabic diacritics/hamza/punctuation) | 5 | First correct guess wins and round stops |
| Race | `!join` or `!انضم`, then `!go` / `!انطلق` | 5 | First to target distance wins, 1.2s action cooldown |
| Wheel | `!join` or `!انضم` | 5 | Names are collected; host draws a secure random pick |

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
