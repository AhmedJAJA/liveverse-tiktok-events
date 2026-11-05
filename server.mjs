import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual, createHash, randomInt, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { WebSocketServer, WebSocket } from 'ws';
import { Engine, liveUrlFor } from './src/engine.mjs';
import { LiveBridge } from './src/bridge.mjs';
import { KickBridge, validKickSlug } from './src/kick.mjs';
import { StreamTools } from './src/stream-tools.mjs';
import { GameFlow } from './src/flow.mjs';
import { settingsSchema, JOIN_WORD_SUGGESTIONS, LATE_JOIN_MODES } from './src/game-settings.mjs';
import { QuestionBank, loadDefaultQuestions } from './src/question-bank.mjs';
import { siteConfig, ALL_GAMES, UPDATES } from './src/catalog.mjs';
import { AccountStore, Sessions, RateLimiter, FieldError, parseCookies, roomId, PLANS } from './src/accounts.mjs';
import { DrawHub } from './src/draw.mjs';
import { PromoStore, PROMO_LEVELS } from './src/promo.mjs';
import { createPool, migrate } from './src/db.mjs';
import { PromoMirror, SessionMirror } from './src/persist.mjs';
import { Platform, PlatformError, PLANS as PLATFORM_PLANS, AVATARS, privacyOf, weekOf } from './src/platform.mjs';
import { createMailer, createGateway } from './src/services.mjs';
import { GoogleVerifier } from './src/google.mjs';
import { Providers, TokenBox, OAuthError, pkcePair } from './src/oauth.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'public');
const authToken = process.env.ADMIN_TOKEN || randomBytes(24).toString('hex');
if (!process.env.ADMIN_TOKEN) { if (process.env.NODE_ENV === 'production') console.warn('ADMIN_TOKEN is unset; configure it in the hosting environment.'); else console.log('\n[LOCAL ADMIN TOKEN] ' + authToken + '\nSet ADMIN_TOKEN in hosting environment before publishing.'); }
const safeToken = Buffer.from(authToken, 'utf8');
const matchesToken = (raw) => { const incoming = Buffer.from(String(raw||''), 'utf8'); return incoming.length === safeToken.length && timingSafeEqual(incoming, safeToken); };
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.SKY_DATA_DIR || path.join(here, 'data', 'runtime');
const COOKIE = 'sky_session';
function send(ws, value) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); }

/* ------------------------------------------------------------------ rooms
   One room = one streamer's game engine, chat bridges and viewers. The owner
   (ADMIN_TOKEN) runs the "main" room exactly as before; each account gets its
   own permanent room and each guest a temporary demo room. */
const questions = loadDefaultQuestions();
const MAX_ROOMS = 80;
const BROADCAST_MS = Math.max(40, Number(process.env.SKY_BROADCAST_MS) || 120);
const ROOM_IDLE_MS = 3 * 60 * 60_000;
const rooms = new Map();
const HOST_TIMEOUT_MS = Math.max(5_000, Number(process.env.SKY_HOST_TIMEOUT_MS) || 45_000); // a studio window that stops beating is gone after this
const sameHandle = (a, b) => String(a || '').replace(/^@/, '').toLowerCase() === String(b || '').replace(/^@/, '').toLowerCase();
class Room {
  constructor(id, kind, ownerId = null) {
    this.id = id; this.kind = kind; this.ownerId = ownerId; this.clients = new Set(); this.touched = Date.now();
    // Chat can arrive hundreds of times a second. The engine only marks the room dirty; one snapshot is
    // built, serialised once and sent to every screen at most every BROADCAST_MS (game events are never lost:
    // each broadcast carries the full current state).
    this.engine = new Engine({ lazy: true, notify: () => this.scheduleBroadcast() });
    this.flushTimer = null; this.lastFlush = 0; this.broadcasts = 0;
    // Bridges talk to the room, not the engine: chat from a stream whose ownership is not proven never reaches a game.
    this.hub = {
      setConnection: (...a) => this.engine.setConnection(...a), setStreamer: (p) => this.engine.setStreamer(p),
      setConnectionMeta: (m) => this.engine.setConnectionMeta(m), receiveChat: (c) => this.receiveChat(c),
    };
    this.tiktok = new LiveBridge(this.hub);
    this.kick = new KickBridge(this.hub);
    this.questionBank = new QuestionBank(questions);
    this.kickOfficial = null;  // Kick chat delivered by Kick's webhooks: {broadcasterUserId, userId, checkedAt}
    this.tabs = new Map();     // studio windows of the host: tab id -> {at, screen}
    this.primaryTab = null;    // the one window allowed to control the room
    this.gameSessionId = null; this.saved = { state: '', at: 0 };
    this.tools = new StreamTools();  // OBS tools: countdown, chat draw, active chatters
    // the game session's launch flow (library → setup → join word → lobby → round → results), kept on the server
    this.flow = new GameFlow({ engine: this.engine, games: ALL_GAMES });
    this.engine.questionSource = (filter) => drawQuestion(this.questionBank, filter);
  }
  receiveChat(chat) {
    // An account room only plays with a stream whose account was linked by signing in with the platform.
    if (this.kind === 'acct' && !this.engine.connMeta.verified) return;
    if (this.tools.chat(chat)) this.scheduleBroadcast();
    this.engine.receiveChat(chat);
  }
  revokeStream(reason) {
    this.kickOfficial = null;
    this.tiktok.disconnect(false).catch(() => {}); this.kick.disconnect(false).catch(() => {});
    this.engine.setConnection('disconnected', '', reason);
  }
  hostTab() { const t = this.primaryTab && this.tabs.get(this.primaryTab); return t && Date.now() - t.at <= HOST_TIMEOUT_MS ? t : null; }
  view() { return { ...this.engine.snapshot(), flow: this.flow.snapshot(), tools: this.tools.snapshot(), roomCode: this.joinCode && roomCodes.get(this.joinCode) === this.id ? this.joinCode : null, viewers: this.clients.size }; }
  scheduleBroadcast() {
    this.noteGameEnd();
    if (this.flushTimer) return;
    const wait = Math.max(0, BROADCAST_MS - (Date.now() - this.lastFlush));
    this.flushTimer = setTimeout(() => this.flush(), wait);
  }
  flush() {
    this.flushTimer = null; this.lastFlush = Date.now();
    if (!this.clients.size) return;
    this.broadcasts++;
    const raw = JSON.stringify({ type: 'state', data: this.view() });
    for (const ws of this.clients) if (ws.readyState === WebSocket.OPEN && (ws.bufferedAmount || 0) < 4_000_000) ws.send(raw);
  }
  /** Weekly leaderboard: a finished game in a real, listed session gives each real player an entry and the winner a win. */
  noteGameEnd() {
    const st = this.engine.status, ev = st.lastEvent;
    if (!ev || st.active || ev.at === this.lastGameAt || !(ev.winner || st.results)) return;
    this.lastGameAt = ev.at;
    if (this.kind !== 'acct' || !platform || !this.sessionCounted) return;
    const where = this.engine.connection.platform;
    const participants = [...this.engine.players.values()].filter((p) => !p.manual && !/^(demo|host|manual):/.test(p.id)).map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, handle: p.handle }));
    if (!participants.length) return;
    const winnerId = ev.winner?.id && participants.some((p) => p.id === ev.winner.id) ? ev.winner.id : null;
    platform.recordGameResult({ platform: where, winnerId, participants, startedAt: st.startedAt, endedAt: ev.at, streamerId: this.ownerId }).catch(() => {});
  }
  async disconnectAll() { this.kickOfficial = null; await this.tiktok.disconnect(false); await this.kick.disconnect(false); this.engine.setConnection('disconnected', '', 'تم الفصل'); }
}
const mainRoom = new Room('main', 'main');
rooms.set('main', mainRoom);
function evictIdleRooms(force = false) {
  const t = Date.now();
  for (const [id, room] of rooms) {
    if (id === 'main' || room.clients.size || ['connected', 'connecting'].includes(room.engine.connection.state)) continue;
    if (force || t - room.touched > ROOM_IDLE_MS) { room.disconnectAll().catch(() => {}); rooms.delete(id); if (room.joinCode) roomCodes.delete(room.joinCode); }
  }
}
function ensureRoom(id, kind, ownerId) {
  let room = rooms.get(id);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) evictIdleRooms(true);
    if (rooms.size >= MAX_ROOMS) throw Object.assign(new Error('الخادم مشغول الآن، حاول بعد قليل'), { status: 503 });
    room = new Room(id, kind, ownerId);
    rooms.set(id, room);
  }
  room.touched = Date.now();
  return room;
}
/** Public lookup for viewers: main, live guest rooms, or any account room. */
function publicRoom(id) {
  const key = String(id || 'main');
  if (rooms.has(key)) return rooms.get(key);
  if (/^a[a-z0-9]{9}$/.test(key) && platform) { const u = platform.userForRoom(key); return u ? ensureRoom(key, 'acct', u.id) : null; }
  const owner = /^u[a-z0-9]{9}$/.test(key) ? accounts.byRoom(key) : null;
  if (owner) return ensureRoom(key, 'user', owner.id);
  // a promo-code room survives restarts as long as its session does (so OBS links keep working)
  if (/^p[a-z0-9]{9}$/.test(key) && [...sessions.map.values()].some((x) => x.room === key)) return ensureRoom(key, 'promo');
  return null;
}

/* --------------------------------------------------------------- accounts */
const accounts = new AccountStore({ file: path.join(DATA_DIR, 'users.json') });
// Test runs may move the session clock forward to check expiry and renewal; never outside NODE_ENV=test.
const clock = () => Date.now() + (process.env.NODE_ENV === 'test' ? Number(process.env.SKY_TEST_CLOCK_OFFSET_MS) || 0 : 0);
const sessions = new Sessions({ file: path.join(DATA_DIR, 'sessions.json'), now: clock });
const promos = new PromoStore({ file: path.join(DATA_DIR, 'promo-codes.json') });
// Optional bootstrap codes from the environment (comma separated); stored hashed, never in public files.
for (const code of String(process.env.SPONGE_PROMO_CODES || '').split(',').map((c) => c.trim()).filter(Boolean)) promos.seed(code);
/* PostgreSQL (DATABASE_URL): accounts with permanent IDs, trials, subscriptions, payments, admin audit — and
   the promo codes and sessions above are written through to it, so nothing depends on the host's disk. */
const pool = createPool();
let platform = null;
if (pool) {
  await migrate(pool);
  await PromoMirror.attach(pool, promos);
  await SessionMirror.attach(pool, sessions);
  platform = new Platform({ pool, hashCode: (c) => promos.hash(c), mail: createMailer(), gateway: createGateway(), appUrl: process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + (Number(process.env.PORT) || 3000),
    ...(process.env.NODE_ENV === 'test' && process.env.SKY_MIN_ROUND_MS ? { minRoundMs: Number(process.env.SKY_MIN_ROUND_MS) } : {}) });
  await platform.init();
  for (const code of String(process.env.SPONGE_PROMO_CODES || '').split(',').map((c) => c.trim()).filter(Boolean)) promos.seed(code);
} else console.warn('[db] DATABASE_URL is not set: games and promo codes work; accounts, trials and subscriptions are off.');
const appUrl = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + (Number(process.env.PORT) || 3000)).replace(/\/$/, '');
const providers = new Providers({ appUrl });
const tokenBox = new TokenBox();
const google = new GoogleVerifier({ clientId: process.env.GOOGLE_CLIENT_ID || '', jwksUrl: process.env.GOOGLE_JWKS_URL || undefined });
const OPEN_SIGNUP = process.env.SKY_OPEN_SIGNUP === '1';
const redeemIp = new RateLimiter({ limit: 8, windowMs: 10 * 60_000 });
const redeemAll = new RateLimiter({ limit: 300, windowMs: 10 * 60_000 });
const authLimiter = new RateLimiter({ limit: 12, windowMs: 10 * 60_000 });
const roomCodeLimiter = new RateLimiter({ limit: 30, windowMs: 10 * 60_000 });
/** «كود الغرفة»: a short code viewers type on the home page to open a room's game page. Kept in memory, per room. */
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const roomCodes = new Map(); // code -> room id
function roomCodeFor(room) {
  if (room.joinCode && roomCodes.get(room.joinCode) === room.id) return room.joinCode;
  let code; do { code = Array.from({ length: 4 }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join(''); } while (roomCodes.has(code));
  roomCodes.set(code, room.id); room.joinCode = code;
  return code;
}
const draw = new DrawHub();
const isHttps = (req) => req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'ip';
/** maxAge in seconds; 0 = a browser-session cookie (gone when the browser closes, «تذكرني» off). */
function setSession(res, req, id, maxAge) {
  res.setHeader('Set-Cookie', `${COOKIE}=${id}; HttpOnly; Path=/; SameSite=Lax${maxAge ? '; Max-Age=' + maxAge : ''}${isHttps(req) ? '; Secure' : ''}`);
}
const REMEMBER_S = 30 * 86400;
/** Every request with a remembered account session pushes its expiry back to 30 days (at most once a day). */
function renewSession(req, res) {
  const id = parseCookies(req.headers.cookie)[COOKIE];
  if (id) sessions.seen(id);
  if (!id || !sessions.renew(id)) return;
  setSession(res, req, id, REMEMBER_S);
}
/** A short, human label for «الأجهزة والجلسات» (browser + system), from the User-Agent only. */
function deviceLabel(req) {
  const ua = String(req.headers['user-agent'] || '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'متصفح';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'جهاز';
  return browser + ' — ' + os;
}
function sessionOf(req) { return sessions.get(parseCookies(req.headers.cookie)[COOKIE]); }
/** Who is acting: the owner (Bearer ADMIN_TOKEN → main room), an account, or a guest. */
function actorFor(req) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (bearer && matchesToken(bearer)) return { kind: 'owner', room: mainRoom, live: true };
  const s = sessionOf(req);
  if (!s) return null;
  // Cookie-authenticated writes must come from this site.
  const origin = req.headers.origin;
  if (origin && req.method !== 'GET') { try { if (new URL(origin).host !== req.headers.host) return null; } catch { return null; } }
  if (s.kind === 'user') {
    const user = accounts.byId(s.userId);
    if (!user) return null;
    return { kind: 'user', user, room: ensureRoom(user.room, 'user', user.id), live: accounts.planActive(user) };
  }
  if (s.kind === 'acct') {
    // Account sessions open the studio only while a trial or subscription is running (checked here, every request).
    // E-mail verification gates the free trial, not access that was paid for or granted.
    const e = platform?.cached(s.userId);
    if (!e || e.user.disabled_at || !platform.entitlement(s.userId).active) return null;
    return { kind: 'acct', userId: s.userId, user: { displayName: e.user.display_name }, room: ensureRoom(e.user.room, 'acct', s.userId), live: true };
  }
  if (s.kind === 'guest') return { kind: 'guest', room: ensureRoom(s.room, 'guest'), live: false };
  if (s.kind === 'owner') return { kind: 'owner', room: mainRoom, live: true };
  if (s.kind === 'promo') {
    if (!promos.stillValid(s.codeId)) return null; // a disabled or expired code closes its sessions
    return { kind: 'promo', room: ensureRoom(s.room, 'promo'), live: s.level === 'live', level: s.level };
  }
  return null;
}
const isAuthorized = (req) => !!actorFor(req);
function meFor(req) {
  const s = sessionOf(req);
  if (s?.kind === 'owner') return { user: null, guest: false, owner: true, access: 'owner', room: 'main', live: true };
  if (s?.kind === 'promo' && promos.stillValid(s.codeId)) return { user: null, guest: false, access: 'promo', level: s.level, room: s.room, live: s.level === 'live' };
  if (s?.kind === 'user') { const u = accounts.byId(s.userId); if (u) return { user: accounts.publicUser(u), guest: false, room: u.room, live: accounts.planActive(u) }; }
  if (s?.kind === 'acct') { const a = accountView(s.userId); if (a) return { user: null, guest: false, access: 'account', account: a, room: a.room, live: a.entitled }; }
  if (s?.kind === 'guest') return { user: null, guest: true, room: s.room, live: false };
  return { user: null, guest: false, room: null, live: false };
}

/** What every page may know about the signed-in account (no secrets). */
function accountView(userId) {
  const e = platform?.cached(userId); if (!e) return null;
  const ent = platform.entitlement(userId);
  return { ...platform.publicUser(e.user), entitled: ent.active && !e.user.disabled_at, plan: ent.plan, planName: ent.plan ? PLATFORM_PLANS[ent.plan].name : null, endsAt: ent.endsAt ? new Date(ent.endsAt).toISOString() : null,
    trial: platform.trialStatus(userId), expired: !ent.active && e.hadAccess, trialNeedsVerifiedEmail: platform.trialNeedsVerifiedEmail };
}
function accountSession(req) { const s = sessionOf(req); return s?.kind === 'acct' && platform?.cached(s.userId) ? s : null; }
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false; // CSRF: browsers label requests sent from other sites
  const origin = req.headers.origin; if (!origin) return true; try { return new URL(origin).host === req.headers.host; } catch { return false; } }
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
async function readBody(req, limit = 16384) {
  let size = 0, bytes = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('الطلب كبير جدًا'); bytes.push(chunk); }
  try { return JSON.parse(Buffer.concat(bytes).toString('utf8') || '{}'); }
  catch { throw new Error('JSON غير صالح'); }
}
function secureHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); // Google Identity Services needs the origin
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' https://accounts.google.com/gsi/style; frame-src https://accounts.google.com/gsi/; connect-src 'self' ws: wss: https://accounts.google.com/gsi/; img-src 'self' data: https://*.googleusercontent.com https://files.kick.com https://*.tiktokcdn.com https://*.tiktokcdn-us.com https://*.tiktokcdn-eu.com https://*.tiktokcdn-in.com https://*.byteoversea.com https://*.ibytedtos.com https://*.ibyteimg.com https://*.muscdn.com; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
}

/** One question of «تحدي المعرفة» from the bank; when the chosen category/level runs out, any question will do. */
function drawQuestion(bank, { category = 'all', difficulty = 'all' } = {}) {
  let q; try { q = bank.draw({ category, difficulty }); } catch { try { q = bank.draw({}); } catch { bank.reset(); q = bank.draw({}); } }
  return { title: 'تحدي ' + (bank.stats().categories[q.category]?.title || 'المعلومات'), prompt: q.question, options: q.options, answer: q.answer };
}
async function handleAction(action, body, actor) {
  const { engine, questionBank } = actor.room;
  const room = actor.room;
  switch (action) {
    // ---- the launch flow: every step is a separate command (see src/flow.mjs)
    case 'flow-setup': room.flow.setup(String(body.mode || '')); room.scheduleBroadcast(); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-settings': room.flow.saveSettings(room.flow.mode, body.settings, { lateJoin: body.lateJoin, keyword: body.keyword }); room.scheduleBroadcast(); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-reset': room.flow.resetSettings(room.flow.mode); room.scheduleBroadcast(); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-begin': room.flow.begin(); room.scheduleBroadcast(); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-open': room.flow.open(body.keyword); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-close': room.flow.close(); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-start': room.flow.start((s) => { const q = drawQuestion(questionBank, s); engine.configure({ mode: 'quiz', title: q.title, prompt: q.prompt, options: q.options, answer: q.answer }); }); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-again': room.flow.again(); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-end': room.flow.end(); room.scheduleBroadcast(); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-library': room.flow.library(); room.scheduleBroadcast(); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-trial': {
      room.flow.tryOut();
      const added = engine.addDemoPlayers({ count: Math.max(4, engine.snapshot().registration.minPlayers || 1) });
      engine.setSimulation({ autoplay: true });
      return { ok: true, flow: room.flow.snapshot(), added };
    }
    case 'configure': engine.configure(body); return { ok: true };
    case 'registration-open': engine.openRegistration(body); return { ok: true };
    case 'registration-settings': return { ok: true, registration: engine.updateRegistration({ ...body, ...(body.hostJoin ? { hostName: actor.user?.displayName || 'المشرف' } : {}) }) };
    case 'registration-close': engine.closeRegistration(); return { ok: true };
    case 'bomb-pause': engine.bombPause(); return { ok: true };
    case 'bomb-resume': engine.bombResume(); return { ok: true };
    case 'bomb-pass': engine.bombPass(body); return { ok: true };
    case 'bomb-restart': engine.bombRestart(); return { ok: true };
    case 'bomb-end': engine.requireBombMatch(); engine.stop(); return { ok: true };
    case 'bomb-settings': return { ok: true, bomb: engine.bombSettings(body) };
    case 'bomb-demo': case 'demo-players': return { ok: true, added: engine.addDemoPlayers(body) };
    case 'simulation': return { ok: true, simulation: engine.setSimulation(body) };
    case 'advance': engine.advance(); return { ok: true };
    case 'add-player': return { ok: true, player: engine.addManualPlayer({ name: body.name }) };
    case 'add-host': return { ok: true, player: engine.joinHost() };
    case 'host-seat': return { ok: true, player: engine.seatHost({ name: actor.user?.displayName || (actor.kind === 'owner' ? 'المشرف' : 'المشرف') }) };
    case 'host-unseat': return { ok: true, ...engine.unseatHost() };
    case 'secret': return { ok: true, secret: engine.partySecret() };
    case 'judge': engine.judgeAnswer(body.accept === true); return { ok: true };
    case 'roles-admin': return { ok: true, ...engine.rolesAdmin() };
    case 'sketch': {
      // «خمن الرسمة»: the host's canvas as a PNG, pushed to every screen of this room.
      const data = String(body.data ?? '');
      if (data && (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(data) || data.length > 180_000)) throw new Error('الرسمة غير صالحة أو كبيرة جدًا');
      room.sketch = { data, v: (room.sketch?.v || 0) + 1 };
      for (const ws of room.clients) send(ws, { type: 'sketch', data: room.sketch });
      return { ok: true, v: room.sketch.v };
    }
    case 'prepare': {
      // Join page: pick the game and open signups. A quiz gets a fresh question from the bank.
      const game = ALL_GAMES.find((g) => g.mode === body.mode);
      if (!game) throw new Error('لعبة غير معروفة');
      const result = engine.prepareJoin({ mode: game.mode, title: game.title });
      if (game.mode === 'quiz' && result.phase === 'open') {
        const q = questionBank.draw({});
        engine.configure({ mode: 'quiz', title: 'تحدي ' + (questionBank.stats().categories[q.category]?.title || 'المعلومات'), prompt: q.question, options: q.options, answer: q.answer });
      }
      room.flow.legacy('prepare', game.mode);
      return { ok: true, ...result };
    }
    case 'remove-player': return { ok: true, ...engine.removePlayer(body) };
    case 'branding': return { ok: true, branding: engine.setBranding(body) };
    case 'bank-next': {
      if (engine.status.active) throw new Error('أوقف الجولة الحالية قبل اختيار سؤال جديد');
      if (body.start && !engine.players.size) throw new Error('افتح التسجيل أولًا وانتظر المشاركين');
      const q = questionBank.draw(body);
      engine.configure({ mode: 'quiz', title: 'تحدي ' + (questionBank.stats().categories[q.category]?.title || 'المعلومات'), prompt: q.question, options: q.options, answer: q.answer });
      if (body.start === true) engine.start();
      return { ok: true, question: q, bank: questionBank.stats() };
    }
    case 'room-code': return { ok: true, code: roomCodeFor(room) };
    case 'tools': { const tools = room.tools.command(String(body.action || ''), body); room.scheduleBroadcast(); return { ok: true, tools }; }
    case 'bank-reset': return { ok: true, bank: questionBank.reset() };
    case 'start': engine.start(); room.flow.legacy('start'); return { ok: true };
    case 'stop': engine.stop(); return { ok: true };
    case 'reset': engine.resetScores(); return { ok: true };
    case 'draw': return { ok: true, result: engine.drawWheel() };
    case 'connect': {
      // 1) only a running trial or subscription (or the site owner) may connect a LIVE — checked here, on the server
      requireStreamAccess(actor);
      const service = body.platform === 'kick' ? 'kick' : 'tiktok';
      if (actor.kind !== 'acct') {
        // the site owner's own room: a manual test connection; it is never listed among the active streams
        const handle = String(body.username || '').trim().replace(/^@/, '');
        if (!liveUrlFor(service, handle) || (service === 'kick' && !validKickSlug(handle))) throw new Error(service === 'kick' ? 'اسم قناة Kick غير صالح' : 'اسم حساب TikTok غير صالح');
        room.kickOfficial = null;
        if (service === 'kick') { await room.tiktok.disconnect(false); await room.kick.connect(handle, { chatroomId: body.chatroomId }); }
        else { await room.kick.disconnect(false); await room.tiktok.connect(handle); }
        return { ok: true, state: engine.connection.state, verified: false };
      }
      // 2) accounts: only the platform account they signed in with — never a name typed in the browser
      return connectLinked(actor, room, service);
    }
    case 'disconnect': room.kickOfficial = null; await room.tiktok.disconnect(false); await room.kick.disconnect(false); engine.setConnection('disconnected', '', 'تم الفصل'); return { ok: true };
    case 'heartbeat': {
      // The studio window says it is open (every ~15 s). Only one window controls the room; it can be taken over.
      const tab = String(body.tab || '');
      if (!/^[A-Za-z0-9_-]{8,48}$/.test(tab)) throw new Error('نافذة غير معروفة');
      const now = Date.now();
      if (body.closing === true) { room.tabs.delete(tab); if (room.primaryTab === tab) room.primaryTab = null; return { ok: true }; }
      for (const [id, t] of room.tabs) if (now - t.at > HOST_TIMEOUT_MS) room.tabs.delete(id);
      if (room.tabs.size >= 12 && !room.tabs.has(tab)) throw new Error('نوافذ كثيرة مفتوحة للاستوديو');
      room.tabs.set(tab, { at: now, screen: body.screen === 'game' ? 'game' : 'games' });
      if (!room.hostTab() || body.takeover === true) room.primaryTab = tab;
      const st = liveStatus(room);
      return { ok: true, primary: room.primaryTab === tab, state: st.state, listed: st.listed, reasons: st.reasons };
    }
    case 'simulate': {
      const name = String(body.username ?? '').trim().slice(0,32);
      if (!name || !body.text) throw new Error('أدخل اسم المشاهد والتعليق');
      engine.receiveChat({ id: 'demo:' + name.toLowerCase(), username: name, text: body.text, avatar: typeof body.avatar === 'string' ? body.avatar : '', isFollower: body.isFollower === true, isSubscriber: body.isSubscriber === true });
      return { ok: true };
    }
    // Owner-only account administration (subscriptions are activated manually after payment).
    case 'accounts': requireOwner(actor); return { ok: true, accounts: accounts.list() };
    case 'promo-list': requireOwner(actor); return { ok: true, codes: promos.list(), levels: PROMO_LEVELS };
    case 'promo-create': { requireOwner(actor); const code = promos.create(body); platform?.audit('owner', 'promo-create', { details: { id: code.id, label: code.label, level: code.level, maxUses: code.maxUses } }).catch(() => {}); return { ok: true, code }; }
    case 'promo-update': {
      requireOwner(actor);
      const code = promos.update(body.id, body);
      if (code.status !== 'active') sessions.destroyWhere((x) => x.codeId === body.id);
      platform?.audit('owner', 'promo-update', { details: { id: body.id, active: code.active, status: code.status } }).catch(() => {});
      return { ok: true, code };
    }
    case 'promo-delete': requireOwner(actor); promos.remove(body.id); sessions.destroyWhere((x) => x.codeId === body.id); platform?.audit('owner', 'promo-delete', { details: { id: body.id } }).catch(() => {}); return { ok: true };
    case 'account-plan': requireOwner(actor); return { ok: true, account: accounts.setPlan(body.username, body.plan, body.days) };
    case 'account-password': requireOwner(actor); { await accounts.setPassword(body.username, body.password); const u = accounts.find(body.username); if (u) sessions.destroyUser(u.id); return { ok: true }; }
    default: throw new Error('الإجراء غير معروف');
  }
}
/** Linking a LIVE needs a running trial or subscription on a SPONGE LIVE account (or the site owner). */
function requireStreamAccess(actor) {
  if (actor.kind === 'owner') return;
  if (actor.kind === 'acct' && platform?.entitlement(actor.userId).active) return;
  throw Object.assign(new Error('تحتاج إلى اشتراك فعال لربط بثك المباشر'), { status: 402, needPlan: true });
}
/* ------------------------------------------------ official platform sign-in (TikTok / Kick) */
const KICK_LIVE_CHECK_MS = Math.max(5_000, Number(process.env.KICK_LIVE_CHECK_MS) || 120_000);
const oauthStates = new Map(); // state -> { userId, platform, verifier, sessionKey, expires }
const OAUTH_STATE_MS = 10 * 60_000;
const linkableNow = (p) => providers.enabled(p) && tokenBox.ready && !!platform;
/** A usable access token for the linked account: refreshed when it is about to expire; a refused refresh marks the link for re-authorisation. */
async function linkToken(userId, p, link) {
  let access = tokenBox.open(link.accessTokenEnc);
  if (access && link.tokenExpiresAt - Date.now() > 120_000) return access;
  try {
    const t = await providers.refresh(p, tokenBox.open(link.refreshTokenEnc));
    await platform.updateOAuthLink(userId, p, { accessTokenEnc: tokenBox.seal(t.accessToken), refreshTokenEnc: tokenBox.seal(t.refreshToken), expiresAt: t.expiresAt, refreshExpiresAt: t.refreshExpiresAt || undefined, needsReauth: false });
    return t.accessToken;
  } catch (err) {
    if (err instanceof OAuthError && err.code === 'unauthorized') await platform.updateOAuthLink(userId, p, { needsReauth: true }).catch(() => {});
    throw err;
  }
}
const needLink = (p, msg) => Object.assign(new Error(msg || ('اربط حسابك على ' + (p === 'kick' ? 'Kick' : 'TikTok') + ' من «الإعدادات» أولًا')), { status: 409, needLink: true });
/** Connect an account room to the platform account it signed in with (stored official id; nothing typed). */
async function connectLinked(actor, room, p) {
  if (!linkableNow(p)) throw Object.assign(new Error('ربط ' + (p === 'kick' ? 'Kick' : 'TikTok') + ' غير مفعّل على الموقع بعد'), { status: 503 });
  const link = await platform.verifiedStream(actor.userId, p);
  if (!link) throw needLink(p);
  if (link.needsReauth) throw needLink(p, 'انتهى تفويض ' + (p === 'kick' ? 'Kick' : 'TikTok') + ' — أعد الربط من «الإعدادات»');
  let token;
  try { token = await linkToken(actor.userId, p, link); }
  catch (err) { if (err instanceof OAuthError && err.code === 'unauthorized') throw needLink(p, err.message); throw err; }
  const { engine } = room;
  if (p === 'tiktok') {
    // the current username comes from TikTok itself (it can change); LIVE chat is then read by the stream bridge
    const who = await providers.identity('tiktok', token);
    if (who.platformUserId !== link.platformUserId) throw needLink(p, 'حساب TikTok تغيّر — أعد الربط من «الإعدادات»');
    if (!who.handle) throw needLink(p, 'اسمح بصلاحية «الملف الشخصي» عند الربط حتى نصل إلى بثك المباشر');
    await platform.updateOAuthLink(actor.userId, p, { handle: who.handle, displayName: who.displayName, avatar: who.avatar }).catch(() => {});
    room.kickOfficial = null; await room.kick.disconnect(false);
    try { await room.tiktok.connect(who.handle); }
    catch (err) { throw Object.assign(new Error(/offline|isn't online|not online|UserOffline/i.test(String(err?.message)) ? 'بثك على TikTok غير مباشر الآن — ابدأ البث ثم اتصل' : 'تعذر الوصول إلى بث TikTok — تأكد أن البث شغال'), { status: 409 }); }
    engine.setStreamer({ displayName: who.displayName, avatar: who.avatar });
  } else {
    // Kick: the official API says whether the channel is live; chat is delivered to our webhook by Kick
    const ch = await providers.kickChannel(token);
    if (ch.broadcasterUserId !== link.platformUserId) throw needLink(p, 'قناة Kick تغيّرت — أعد الربط من «الإعدادات»');
    if (!ch.live) throw Object.assign(new Error('بثك على Kick غير مباشر الآن — ابدأ البث ثم اتصل'), { status: 409 });
    await room.tiktok.disconnect(false); await room.kick.disconnect(false);
    await providers.kickSubscribeChat(token, ch.broadcasterUserId);
    room.kickOfficial = { broadcasterUserId: ch.broadcasterUserId, userId: actor.userId, checkedAt: Date.now() };
    engine.setConnection('connected', ch.slug, 'متصل بـ Kick (الربط الرسمي)', 'kick');
    engine.setStreamer({ displayName: link.displayName || ch.slug, avatar: link.avatar || '', platformId: ch.broadcasterUserId });
    engine.setConnectionMeta({ liveConfirmed: true });
  }
  engine.setConnectionMeta({ verified: true, verifying: false });
  platform.touchStream(actor.userId, p).catch(() => {});
  return { ok: true, state: engine.connection.state, verified: true, platform: p, handle: engine.connection.username };
}
/** Kick live state, re-read from the official API every few minutes while connected. */
async function checkKickLive(room) {
  const k = room.kickOfficial; if (!k || k.checking) return;
  k.checking = true; k.checkedAt = Date.now();
  try {
    const link = await platform.verifiedStream(k.userId, 'kick');
    if (!link) return room.revokeStream('أُزيل ربط Kick');
    const ch = await providers.kickChannel(await linkToken(k.userId, 'kick', link));
    room.engine.setConnectionMeta({ liveConfirmed: ch.live });
    if (!ch.live) room.engine.setConnection('disconnected', room.engine.connection.username, 'انتهى البث المباشر على Kick', 'kick');
    else if (room.engine.connection.state !== 'connected') room.engine.setConnection('connected', ch.slug, 'متصل بـ Kick (الربط الرسمي)', 'kick');
  } catch { room.engine.setConnectionMeta({ liveConfirmed: false }); }
  finally { k.checking = false; }
}
/** GET /api/oauth/:platform/start → the platform's sign-in page; GET /api/oauth/:platform/callback ← back here. */
async function handleOAuth(p, step, req, res, url) {
  const back = (q) => { res.writeHead(302, { Location: '/account?' + q + '#settings', 'Cache-Control': 'no-store' }); res.end(); };
  if (!['tiktok', 'kick'].includes(p)) return json(res, 404, { error: 'Not found' });
  const s = accountSession(req);
  if (step === 'start') {
    if (!s) { res.writeHead(302, { Location: '/login?next=' + encodeURIComponent('/account#settings') }); return res.end(); }
    if (!linkableNow(p)) return back('link_error=unavailable&p=' + p);
    if (!platform.entitlement(s.userId).active) return back('link_error=plan&p=' + p);
    const now = Date.now();
    for (const [k, v] of oauthStates) if (v.expires < now) oauthStates.delete(k);
    if (oauthStates.size > 5000) return back('link_error=busy&p=' + p);
    const state = randomBytes(24).toString('base64url'), { verifier, challenge } = pkcePair();
    oauthStates.set(state, { userId: s.userId, platform: p, verifier, sessionKey: sessions.key(s.id), expires: now + OAUTH_STATE_MS });
    res.writeHead(302, { Location: providers.authorizeUrl(p, { state, challenge }), 'Cache-Control': 'no-store',
      'Set-Cookie': `oa_state=${state}; HttpOnly; Path=/api/oauth/; Max-Age=600; SameSite=Lax${isHttps(req) ? '; Secure' : ''}` });
    return res.end();
  }
  if (step !== 'callback') return json(res, 404, { error: 'Not found' });
  const state = url.searchParams.get('state') || '', entry = oauthStates.get(state);
  oauthStates.delete(state); // single use
  const cookieState = parseCookies(req.headers.cookie).oa_state || '';
  res.setHeader('Set-Cookie', `oa_state=; HttpOnly; Path=/api/oauth/; Max-Age=0; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`);
  // the same browser, the same signed-in account, the same platform, within 10 minutes
  if (!entry || !state || cookieState !== state || entry.platform !== p || entry.expires < Date.now() || !s || sessions.key(s.id) !== entry.sessionKey || s.userId !== entry.userId) return back('link_error=state&p=' + p);
  if (url.searchParams.get('error')) return back('link_error=denied&p=' + p);
  const code = url.searchParams.get('code') || '';
  if (!code) return back('link_error=denied&p=' + p);
  if (!platform.entitlement(s.userId).active) return back('link_error=plan&p=' + p);
  try {
    const t = await providers.exchange(p, { code, verifier: entry.verifier });
    const who = await providers.identity(p, t.accessToken);
    if (p === 'tiktok' && t.platformUserId && t.platformUserId !== who.platformUserId) throw new OAuthError('mismatch', 'userinfo');
    const { previousOwners } = await platform.saveOAuthLink(s.userId, p, { platformUserId: who.platformUserId, handle: who.handle, displayName: who.displayName, avatar: who.avatar,
      scope: t.scope, accessTokenEnc: tokenBox.seal(t.accessToken), refreshTokenEnc: tokenBox.seal(t.refreshToken), expiresAt: t.expiresAt, refreshExpiresAt: t.refreshExpiresAt });
    for (const r of rooms.values()) if (previousOwners.includes(r.ownerId) && r.engine.connection.platform === p) r.revokeStream('ارتبط هذا الحساب بحساب SPONGE LIVE آخر');
    return back('linked=' + p);
  } catch (err) {
    console.warn('[oauth]', p, err.code || '', String(err.message).slice(0, 120));
    return back('link_error=' + (err.code === 'network' ? 'network' : 'failed') + '&p=' + p);
  }
}
/** Kick event webhook (chat.message.sent): signed by Kick; routed to the room of the linked broadcaster. */
async function handleKickWebhook(req, res) {
  let raw = ''; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 65536) return json(res, 413, { error: 'too large' }); raw += chunk; }
  if (!(await providers.kickWebhookValid(req.headers, raw))) return json(res, 400, { error: 'bad signature' });
  if (req.headers['kick-event-type'] !== 'chat.message.sent') return json(res, 200, { ok: true });
  let ev; try { ev = JSON.parse(raw); } catch { return json(res, 400, { error: 'bad json' }); }
  const bid = String(ev?.broadcaster?.user_id ?? '');
  const room = [...rooms.values()].find((r) => r.kickOfficial?.broadcasterUserId === bid);
  const sender = ev?.sender || {};
  if (room && sender.user_id !== undefined && ev.content) {
    room.receiveChat({ id: 'kick:' + sender.user_id, username: String(sender.username || 'مشاهد'), handle: String(sender.channel_slug || sender.username || ''),
      text: String(ev.content).replace(/\[emote:\d+:[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim(), msgId: 'kick:' + String(req.headers['kick-event-message-id'] || ev.message_id || ''),
      avatar: '', isFollower: false, isSubscriber: (sender.identity?.badges || []).some((b) => /subscriber|founder|og/i.test(String(b?.type || ''))) });
  }
  return json(res, 200, { ok: true });
}
function requireOwner(actor) { if (actor.kind !== 'owner') throw Object.assign(new Error('هذا الإجراء لمالك الموقع فقط'), { status: 403 }); }

/* «الدخول بالرمز الترويجي»: the server checks the code and opens a session cookie; the page never
   decides on its own. The owner can type the ADMIN_TOKEN in the same field to open the main room. */
async function handleAccess(action, req, res) {
  if (action === 'me' && req.method === 'GET') { const me = meFor(req); return json(res, 200, { signedIn: !!actorFor(req), ...me }); }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'طلب من مصدر غير مسموح' }); } catch { return json(res, 403, { error: 'طلب غير صالح' }); } }
  if (action === 'logout') {
    const s = sessionOf(req); if (s) sessions.destroy(s.id);
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
    return json(res, 200, { ok: true });
  }
  if (action !== 'redeem') return json(res, 404, { error: 'Not found' });
  const ip = clientIp(req);
  if (!redeemIp.hit('ip:' + ip) || !redeemAll.hit('all')) return json(res, 429, { error: 'محاولات كثيرة. انتظر 10 دقائق ثم حاول مرة أخرى.' });
  const body = await readBody(req, 1024).catch(() => null);
  const code = String(body?.code ?? '').trim();
  if (!code) return json(res, 400, { error: 'أدخل الرمز الترويجي' });
  const old = sessionOf(req);
  if (matchesToken(code)) {
    if (old) sessions.destroy(old.id);
    setSession(res, req, sessions.create('owner', {}), 30 * 86400);
    return json(res, 200, { ok: true, access: 'owner', next: '/studio' });
  }
  const promo = promos.redeem(code);
  if (!promo && platform) {
    // A free-trial code: it works only for the account it was made for, while that account is signed in.
    const trial = await platform.findTrialCode(code);
    const acct = accountSession(req);
    if (trial && acct && trial.user_id === acct.userId) {
      try { await platform.activateTrial(acct.userId, { code, ip }); return json(res, 200, { ok: true, access: 'account', trial: true, next: '/studio' }); }
      catch (err) { if (err instanceof PlatformError) return json(res, err.status, { error: err.message }); throw err; }
    }
    if (trial && !acct) return json(res, 401, { error: 'هذا رمز تجربة مجانية: سجّل الدخول بالحساب الذي حصل عليه ثم أدخله مجددًا', login: true });
    // A subscription voucher (SHFQ-… / AMIR-…): it adds its plan to the signed-in account.
    const voucher = trial ? null : await platform.findVoucher(code);
    if (voucher && !acct) return json(res, 401, { error: 'هذا رمز اشتراك: سجّل الدخول أو أنشئ حسابًا ثم أدخله مجددًا ليُضاف الاشتراك إلى حسابك', login: true, voucher: true });
    if (voucher) {
      try { const r = await platform.redeemVoucher(acct.userId, code); return json(res, 200, { ok: true, access: 'account', voucher: r, next: '/studio' }); }
      catch (err) { if (err instanceof PlatformError) return json(res, err.status, { error: err.message }); throw err; }
    }
  }
  if (!promo) { await new Promise((r) => setTimeout(r, 350)); return json(res, 401, { error: 'الرمز غير صحيح أو انتهت صلاحيته' }); }
  if (old) sessions.destroy(old.id);
  setSession(res, req, sessions.create('promo', { room: roomId('p'), codeId: promo.id, level: promo.level }), 30 * 86400);
  return json(res, 200, { ok: true, access: 'promo', level: promo.level, next: '/studio' });
}

async function handleAccount(action, req, res) {
  const ip = clientIp(req);
  if (action === 'me' && req.method === 'GET') return json(res, 200, meFor(req));
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'طلب من مصدر غير مسموح' }); } catch { return json(res, 403, { error: 'طلب غير صالح' }); } }
  const body = await readBody(req).catch(() => null);
  if (!body) return json(res, 400, { error: 'طلب غير صالح' });
  if ((action === 'register' || action === 'guest') && !OPEN_SIGNUP) return json(res, 403, { error: 'الدخول إلى الاستوديو يتم بالرمز الترويجي' });
  if (action === 'register') {
    if (!authLimiter.hit('reg:' + ip)) return json(res, 429, { error: 'محاولات كثيرة، انتظر قليلًا ثم حاول' });
    try {
      const user = await accounts.register(body);
      setSession(res, req, sessions.create('user', { userId: user.id }), 30 * 86400);
      return json(res, 201, { ...meFor({ headers: {} }), user: accounts.publicUser(user), room: user.room, live: accounts.planActive(user) });
    } catch (err) { return json(res, err.status || 400, { error: err.message, ...(err.fields ? { fields: err.fields } : {}) }); }
  }
  if (action === 'login') {
    const id = String(body.username ?? '').trim().toLowerCase();
    if (!authLimiter.hit('login:' + ip) || !authLimiter.hit('acct:' + id)) return json(res, 429, { error: 'محاولات كثيرة، انتظر 10 دقائق ثم حاول' });
    if (!id || !body.password) return json(res, 400, { error: 'أدخل اسم المستخدم وكلمة المرور', fields: { ...(id ? {} : { username: 'مطلوب' }), ...(body.password ? {} : { password: 'مطلوبة' }) } });
    const user = await accounts.verify(id, body.password);
    if (!user) return json(res, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة', fields: { password: 'تحقق من البيانات' } });
    const old = sessionOf(req); if (old) sessions.destroy(old.id);
    setSession(res, req, sessions.create('user', { userId: user.id }), 30 * 86400);
    return json(res, 200, { user: accounts.publicUser(user), guest: false, room: user.room, live: accounts.planActive(user) });
  }
  if (action === 'guest') {
    if (!authLimiter.hit('guest:' + ip)) return json(res, 429, { error: 'محاولات كثيرة، انتظر قليلًا' });
    const existing = sessionOf(req);
    if (existing?.kind === 'guest') return json(res, 200, { user: null, guest: true, room: existing.room, live: false });
    const room = roomId('g');
    setSession(res, req, sessions.create('guest', { room }), 86400);
    return json(res, 200, { user: null, guest: true, room, live: false });
  }
  if (action === 'logout') {
    const s = sessionOf(req); if (s) sessions.destroy(s.id);
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
    return json(res, 200, { ok: true });
  }
  if (action === 'forgot') {
    // No email service is configured: recovery goes through the support channel, never by revealing whether an account exists.
    const support = siteConfig().support;
    return json(res, 200, { ok: true, message: 'استعادة كلمة المرور تتم عبر فريق SPONGE LIVE: تواصل معنا باسم المستخدم أو البريد المسجل وسنعيد تعيينها لك.', support });
  }
  return json(res, 404, { error: 'Not found' });
}

/* ------------------------------------------------------- platform accounts
   /api/auth/*   sign up, sign in, sign out, resend verification
   /api/me/*     profile, trial, checkout (signed-in account only — the account comes from the session cookie,
                 never from the request body, so nobody can act on another account or grant themselves access)
   /api/manage/* admin panel (owner session or a verified admin account), every change written to the audit log */
const signupLimiter = new RateLimiter({ limit: 5, windowMs: 60 * 60_000 });
const loginIpLimiter = new RateLimiter({ limit: 20, windowMs: 15 * 60_000 });
const loginAcctLimiter = new RateLimiter({ limit: 8, windowMs: 15 * 60_000 });
const mailLimiter = new RateLimiter({ limit: 3, windowMs: 30 * 60_000 });
const meLimiter = new RateLimiter({ limit: 60, windowMs: 10 * 60_000 });
const clearCookie = (req, res) => res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
const platformOff = (res) => json(res, 503, { error: 'الحسابات غير مفعّلة على هذا الخادم بعد (قاعدة البيانات غير مهيأة). يمكنك الدخول بالرمز الترويجي.', disabled: true });
const pErr = (res, err) => { if (err instanceof PlatformError) return json(res, err.status, { error: err.message, ...(err.fields ? { fields: err.fields } : {}) }); throw err; };

async function handleAuth(action, req, res) {
  if (action === 'me' && req.method === 'GET') {
    // Restores the signed-in state on page load: who is this, and what access do they have right now.
    const s = sessionOf(req), me = meFor(req);
    return json(res, 200, { signedIn: !!actorFor(req), ...me, session: s ? { kind: s.kind, remember: s.remember !== false, expiresAt: new Date(s.expires).toISOString() } : null });
  }
  if (action === 'google' && req.method === 'GET') {
    // A fresh nonce for Google's button, bound to this browser by an HttpOnly cookie; the ID token must carry it back.
    if (!platform || !google.enabled) return json(res, 200, { enabled: false });
    const nonce = randomBytes(18).toString('base64url');
    res.setHeader('Set-Cookie', `g_nonce=${nonce}; HttpOnly; Path=/api/; SameSite=Lax; Max-Age=600${isHttps(req) ? '; Secure' : ''}`);
    return json(res, 200, { enabled: true, clientId: google.clientId, nonce });
  }
  if (action === 'config' && req.method === 'GET') return json(res, 200, { enabled: !!platform, mail: !!platform?.mail.configured, billing: !!platform?.gateway.configured, google: !!(platform && google.enabled), trialNeedsVerifiedEmail: !!platform?.trialNeedsVerifiedEmail, plans: Object.values(PLATFORM_PLANS).filter((p) => p.id !== 'manual').map((p) => ({ id: p.id, name: p.name, price: p.priceHalalas / 100, duration: p.duration })) });
  if (!platform) return platformOff(res);
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!sameOrigin(req)) return json(res, 403, { error: 'طلب من مصدر غير مسموح' });
  const ip = clientIp(req);
  const body = await readBody(req, 8192).catch(() => null);
  if (!body) return json(res, 400, { error: 'طلب غير صالح' });
  try {
    if (action === 'register') {
      if (!signupLimiter.hit('ip:' + ip)) return json(res, 429, { error: 'محاولات تسجيل كثيرة من هذه الشبكة. حاول بعد ساعة.' });
      const u = await platform.register(body, { ip });
      const old = sessionOf(req); if (old) sessions.destroy(old.id);
      setSession(res, req, sessions.create('acct', { userId: u.id, remember: body.remember !== false, device: deviceLabel(req) }), body.remember !== false ? REMEMBER_S : 0);
      platform.touchLogin(u.id).catch(() => {});
      return json(res, 201, { ok: true, account: accountView(u.id), next: '/account?welcome=1' });
    }
    if (action === 'login') {
      const id = String(body.identifier ?? body.username ?? '').trim().toLowerCase().slice(0, 254);
      if (!id || !body.password) return json(res, 400, { error: 'أدخل اسم المستخدم أو البريد وكلمة المرور', fields: { ...(id ? {} : { identifier: 'مطلوب' }), ...(body.password ? {} : { password: 'مطلوبة' }) } });
      if (!loginIpLimiter.hit('ip:' + ip) || !loginAcctLimiter.hit('acct:' + id)) return json(res, 429, { error: 'محاولات كثيرة. انتظر 15 دقيقة ثم حاول.' });
      const u = await platform.login(id, String(body.password));
      if (!u) { await new Promise((r) => setTimeout(r, 300)); return json(res, 401, { error: 'بيانات الدخول غير صحيحة', fields: { password: 'تحقق من البيانات' } }); }
      const old = sessionOf(req); if (old) sessions.destroy(old.id);
      setSession(res, req, sessions.create('acct', { userId: u.id, remember: body.remember !== false, device: deviceLabel(req) }), body.remember !== false ? REMEMBER_S : 0);
      platform.touchLogin(u.id).catch(() => {});
      const a = accountView(u.id);
      return json(res, 200, { ok: true, account: a, next: a.entitled ? '/studio' : '/account' });
    }
    if (action === 'logout') { const s = sessionOf(req); if (s) sessions.destroy(s.id); clearCookie(req, res); return json(res, 200, { ok: true }); }
    if (action === 'google') {
      // Sign in (or sign up) with Google. The account is found by Google's subject ID only.
      if (!google.enabled) return json(res, 503, { error: 'تسجيل الدخول باستخدام Google غير مفعّل بعد' });
      if (!loginIpLimiter.hit('g:' + ip)) return json(res, 429, { error: 'محاولات كثيرة. انتظر قليلًا ثم حاول.' });
      let g;
      try { g = await google.verify(String(body.credential || ''), { nonce: parseCookies(req.headers.cookie).g_nonce || '' }); }
      catch (err) { console.warn('[google] rejected token:', err.message); return json(res, 401, { error: 'تعذر التحقق من حساب Google. حدّث الصفحة وحاول مرة أخرى.' }); }
      const current = accountSession(req);
      let user = await platform.findByGoogle(g.sub);
      if (!user && current && body.link === true) user = await platform.linkGoogle(current.userId, g);
      if (!user) {
        if (await platform.findByEmail(g.email)) return json(res, 409, { error: 'يوجد حساب SPONGE LIVE بهذا البريد. سجّل الدخول بكلمة المرور، ثم اربط Google من صفحة «حسابي» — لا نربط الحسابات تلقائيًا بالبريد وحده.', needsLink: true });
        user = await platform.createFromGoogle(g);
      }
      if (user.disabled_at) return json(res, 403, { error: 'هذا الحساب موقوف. تواصل مع الدعم.' });
      await platform.refresh(user.id);
      const old = sessionOf(req); if (old) sessions.destroy(old.id);
      setSession(res, req, sessions.create('acct', { userId: user.id, remember: body.remember !== false, device: deviceLabel(req) }), body.remember !== false ? REMEMBER_S : 0);
      await platform.touchLogin(user.id, { picture: g.picture }).catch(() => {});
      const a = accountView(user.id);
      return json(res, 200, { ok: true, account: a, next: a.entitled ? '/studio' : '/account' });
    }
    if (action === 'resend') {
      const s = accountSession(req); if (!s) return json(res, 401, { error: 'سجّل الدخول أولًا' });
      if (!mailLimiter.hit('mail:' + s.userId)) return json(res, 429, { error: 'أُرسلت رسائل كثيرة. انتظر 30 دقيقة.' });
      const r = await platform.sendVerification(s.userId);
      return json(res, 200, { ok: true, sent: r.sent, already: !!r.already, ...(r.devLink && process.env.NODE_ENV !== 'production' ? { devLink: r.devLink } : {}) });
    }
  } catch (err) { return pErr(res, err); }
  return json(res, 404, { error: 'Not found' });
}

async function handleMe(action, req, res) {
  if (!platform) return platformOff(res);
  const s = accountSession(req);
  if (!s) return json(res, 401, { error: 'سجّل الدخول أولًا', login: true });
  const userId = s.userId, ip = clientIp(req);
  try {
    if (action === 'profile' && req.method === 'GET') return json(res, 200, { ...(await platform.profile(userId)), platforms: { tiktok: linkableNow('tiktok'), kick: linkableNow('kick'), twitch: false } });
    if (action === 'payment' && req.method === 'GET') return json(res, 200, await platform.paymentStatus(userId, new URL(req.url, 'http://x').searchParams.get('id')));
    if (action === 'links' && req.method === 'GET') {
      // what the studio needs: the signed-in platform accounts (no tokens), and which sign-ins the site offers
      const p = await platform.profile(userId);
      return json(res, 200, { linked: p.linked, platforms: { tiktok: linkableNow('tiktok'), kick: linkableNow('kick'), twitch: false }, entitled: platform.entitlement(userId).active });
    }
    if (action === 'sessions' && req.method === 'GET') return json(res, 200, { sessions: sessions.listUser(userId, s.id).map((x) => ({ ...x, createdAt: new Date(x.createdAt).toISOString(), lastSeenAt: new Date(x.lastSeenAt).toISOString(), expiresAt: new Date(x.expiresAt).toISOString() })), reauthed: sessions.reauthed(s.id) });
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    if (!sameOrigin(req)) return json(res, 403, { error: 'طلب من مصدر غير مسموح' });
    if (!meLimiter.hit(userId)) return json(res, 429, { error: 'طلبات كثيرة، انتظر قليلًا' });
    const body = await readBody(req, 8192).catch(() => ({}));
    // Only these fields can come from the browser; plan, dates, IDs and admin rights are never read from the body.
    if (action === 'update') { await platform.updateProfile(userId, { displayName: body.displayName, avatar: body.avatar }); return json(res, 200, { ok: true, account: accountView(userId) }); }
    /* ---- «الإعدادات» ---- */
    if (action === 'privacy') return json(res, 200, { ok: true, privacy: await platform.setPrivacy(userId, String(body.key || ''), body.value) });
    if (action === 'sessions-revoke') {
      if (body.others !== true && sessions.key(s.id).slice(0, 16) === String(body.id)) return json(res, 400, { error: 'لإنهاء هذه الجلسة استخدم «تسجيل الخروج»' });
      const n = body.others === true ? sessions.destroyWhere((x) => x.userId === userId && x.key !== sessions.key(s.id)) : sessions.destroyUserSession(userId, String(body.id || ''));
      return json(res, 200, { ok: true, removed: n });
    }
    // Sensitive changes need a fresh proof of identity: the current password, or Google again (never a Google password here).
    if (action === 'reauth') {
      const me = platform.cached(userId).user;
      if (body.credential) {
        if (!google.enabled) return json(res, 503, { error: 'تسجيل الدخول باستخدام Google غير مفعّل' });
        let g; try { g = await google.verify(String(body.credential), { nonce: parseCookies(req.headers.cookie).g_nonce || '' }); } catch { return json(res, 401, { error: 'تعذر التحقق عبر Google' }); }
        if (!me.google_sub || g.sub !== me.google_sub) return json(res, 403, { error: 'استخدم حساب Google المرتبط بحسابك' });
      } else {
        if (!authLimiter.hit('reauth:' + userId)) return json(res, 429, { error: 'محاولات كثيرة. انتظر قليلًا' });
        if (!(await platform.checkUserPassword(userId, body.password))) return json(res, 401, { error: 'كلمة المرور الحالية غير صحيحة', fields: { password: 'غير صحيحة' } });
      }
      sessions.markReauth(s.id);
      return json(res, 200, { ok: true, reauthUntil: new Date(Date.now() + 10 * 60_000).toISOString() });
    }
    if (['password', 'email', 'google-unlink'].includes(action) && !sessions.reauthed(s.id)) return json(res, 403, { error: 'أكّد هويتك أولًا', reauth: true });
    if (action === 'password') {
      if (String(body.password || '') !== String(body.confirm || '')) return json(res, 400, { error: 'كلمتا المرور غير متطابقتين', fields: { confirm: 'غير متطابقة' } });
      await platform.setPassword(userId, body.password);
      // other devices sign in again with the new password
      sessions.destroyWhere((x) => x.userId === userId && x.key !== sessions.key(s.id));
      return json(res, 200, { ok: true, account: accountView(userId) });
    }
    if (action === 'email') { const r = await platform.changeEmail(userId, body.email); return json(res, 200, { ok: true, sent: !!r.sent, account: accountView(userId) }); }
    if (action === 'google-unlink') { await platform.unlinkGoogle(userId); return json(res, 200, { ok: true, account: accountView(userId) }); }
    if (action === 'stream-unlink') {
      const service = body.platform === 'kick' ? 'kick' : body.platform === 'tiktok' ? 'tiktok' : '';
      if (!service) return json(res, 400, { error: 'منصة غير معروفة' });
      // works with or without a running plan: managing and removing links is always allowed
      const room = rooms.get(platform.cached(userId).user.room);
      if (room && room.engine.connection.platform === service && room.engine.connection.username) room.revokeStream('أُزيل ربط الحساب من الإعدادات');
      const r = await platform.unlinkStream(userId, service);
      const revoked = r.accessTokenEnc ? await providers.revoke(service, tokenBox.open(r.accessTokenEnc)) : false;
      return json(res, 200, { ok: true, removed: r.removed, revoked });
    }
    if (action === 'trial-claim') return json(res, 200, { ok: true, trial: await platform.claimTrial(userId) });
    if (action === 'trial-start') { const r = await platform.startTrial(userId, { ip }); return json(res, 200, { ok: true, ...r, next: '/studio', account: accountView(userId) }); }
    if (action === 'link-google') {
      if (!google.enabled) return json(res, 503, { error: 'تسجيل الدخول باستخدام Google غير مفعّل بعد' });
      let g;
      try { g = await google.verify(String(body.credential || ''), { nonce: parseCookies(req.headers.cookie).g_nonce || '' }); }
      catch { return json(res, 401, { error: 'تعذر التحقق من حساب Google' }); }
      await platform.linkGoogle(userId, g);
      return json(res, 200, { ok: true, account: accountView(userId) });
    }
    if (action === 'trial-activate') { const r = await platform.activateTrial(userId, { ip }); return json(res, 200, { ok: true, ...r, account: accountView(userId) }); }
    if (action === 'checkout') return json(res, 200, { ok: true, ...(await platform.checkout(userId, String(body.plan || ''))) });
    if (action === 'redeem') {
      if (!redeemIp.hit('ip:' + ip)) return json(res, 429, { error: 'محاولات كثيرة. انتظر 10 دقائق ثم حاول مرة أخرى.' });
      const v = await platform.findVoucher(String(body.code || ''));
      if (!v) { await new Promise((r) => setTimeout(r, 350)); return json(res, 401, { error: 'رمز الاشتراك غير صحيح' }); }
      return json(res, 200, { ok: true, voucher: await platform.redeemVoucher(userId, String(body.code)), account: accountView(userId) });
    }
  } catch (err) { return pErr(res, err); }
  return json(res, 404, { error: 'Not found' });
}

/** Payment notification from the gateway. It is only a hint: the invoice is re-read from the gateway before anything is activated. */
async function handleWebhook(req, res) {
  if (!platform?.gateway.configured) return json(res, 404, { error: 'Not found' });
  const body = await readBody(req, 65536).catch(() => null);
  if (!body || !platform.gateway.checkWebhook(body.secret_token)) return json(res, 401, { error: 'unauthorized' });
  const data = body.data || {};
  const ref = String(data.invoice_id || (data.url && data.amount !== undefined && data.id) || '');
  const paymentId = /^[0-9a-f-]{36}$/i.test(String(data.metadata?.payment_id || '')) ? data.metadata.payment_id : null;
  try {
    const r = paymentId ? await platform.confirmPayment({ paymentId }) : ref ? await platform.confirmPayment({ providerRef: ref }) : { status: 'ignored' };
    return json(res, 200, { ok: true, status: r.status });
  } catch (err) { console.error('[billing] webhook', err.message); return json(res, 500, { error: 'retry' }); }
}

function adminActor(req) {
  const s = sessionOf(req);
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if ((bearer && matchesToken(bearer)) || s?.kind === 'owner') return { name: 'owner' };
  if (s?.kind === 'acct' && platform?.isAdmin(s.userId)) return { name: platform.cached(s.userId).user.public_id, userId: s.userId };
  return null;
}
async function handleManage(action, req, res) {
  if (!platform) return platformOff(res);
  const admin = adminActor(req);
  if (!admin) return json(res, 403, { error: 'لوحة الإدارة لمالك الموقع فقط' });
  if (!sameOrigin(req)) return json(res, 403, { error: 'طلب من مصدر غير مسموح' });
  const url = new URL(req.url, 'http://x'), ip = clientIp(req);
  try {
    if (req.method === 'GET') {
      if (action === 'users') return json(res, 200, { users: await platform.searchUsers(url.searchParams.get('q') || ''), stats: await platform.stats() });
      if (action === 'user') { const id = await platform.userByPublicId(url.searchParams.get('id') || ''); if (!id) return json(res, 404, { error: 'لا يوجد حساب بهذا المعرف' }); return json(res, 200, await platform.adminUser(id)); }
      if (action === 'audit') return json(res, 200, { log: await platform.auditLog(Number(url.searchParams.get('limit')) || 100) });
      if (action === 'partners') return json(res, 200, { partners: await platform.partners({ all: true }) });
      if (action === 'prizes') return json(res, 200, await platform.listPrizes());
      if (action === 'codes') return json(res, 200, { codes: promos.list(), levels: PROMO_LEVELS, vouchers: await platform.voucherStats() });
      return json(res, 404, { error: 'Not found' });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    const body = await readBody(req, action === 'partner-save' ? 600_000 : 4096);
    if (action === 'partner-save') { const partners = await platform.savePartner(body); await platform.audit(admin.name, 'partner-save', { details: { name: String(body.name || '').slice(0, 40) }, ip }); return json(res, 200, { ok: true, partners }); }
    if (action === 'partner-delete') { const partners = await platform.deletePartner(body.id); await platform.audit(admin.name, 'partner-delete', { details: { id: body.id }, ip }); return json(res, 200, { ok: true, partners }); }
    if (action === 'prize-save') { const r = await platform.savePrize(body); await platform.audit(admin.name, 'prize-save', { details: { title: String(body.title || '').slice(0, 80) }, ip }); return json(res, 200, { ok: true, ...r }); }
    if (action === 'award-status') { const r = await platform.setAwardStatus(body.id, String(body.status || '')); await platform.audit(admin.name, 'award-status', { details: { id: body.id, status: body.status }, ip }); return json(res, 200, { ok: true, ...r }); }
    if (action === 'code-create') { const code = promos.create(body); await platform.audit(admin.name, 'promo-create', { details: { id: code.id, label: code.label, level: code.level, maxUses: code.maxUses }, ip }); return json(res, 200, { ok: true, code }); }
    if (action === 'voucher-create') { const codes = await platform.createVouchers(String(body.plan), body.count, { label: body.label, createdBy: admin.name }); await platform.audit(admin.name, 'voucher-create', { details: { plan: body.plan, count: codes.length, label: String(body.label || '').slice(0, 60) }, ip }); return json(res, 200, { ok: true, codes }); }
    if (action === 'voucher-revoke') { const r = await platform.revokeVoucher(String(body.code || '')); await platform.audit(admin.name, 'voucher-revoke', { details: { hint: String(body.code).slice(0, 4) + '…' + String(body.code).slice(-4) }, ip }); return json(res, 200, { ok: true, ...r }); }
    if (action === 'code-revoke') { const code = promos.update(String(body.id), { active: false }); sessions.destroyWhere((x) => x.codeId === body.id); await platform.audit(admin.name, 'promo-revoke', { details: { id: body.id }, ip }); return json(res, 200, { ok: true, code }); }
    const userId = await platform.userByPublicId(body.publicId || '');
    if (!userId) return json(res, 404, { error: 'لا يوجد حساب بهذا المعرف' });
    const log = (what, details = {}) => platform.audit(admin.name, what, { target: userId, details, ip });
    if (action === 'grant') { const r = await platform.grant(userId, body); await log('subscription-grant', { days: Number(body.days), plan: body.plan || 'manual', note: String(body.note || '').slice(0, 200) }); return json(res, 200, { ok: true, access: r }); }
    if (action === 'extend') { const r = await platform.extend(userId, body); await log('subscription-extend', { days: Number(body.days) }); return json(res, 200, { ok: true, access: r }); }
    if (action === 'stop') { const r = await platform.stop(userId); await log('subscription-stop', r); return json(res, 200, { ok: true, ...r }); }
    if (action === 'verify') { await platform.setVerified(userId); await log('email-verify-manual'); return json(res, 200, { ok: true }); }
    if (action === 'disable') { await platform.setDisabled(userId, body.disabled !== false); if (body.disabled !== false) sessions.destroyWhere((x) => x.userId === userId); await log(body.disabled !== false ? 'account-disable' : 'account-enable'); return json(res, 200, { ok: true }); }
    if (action === 'trial-code-revoke') { const r = await platform.revokeTrialCode(userId); await log('trial-code-revoke', r); return json(res, 200, { ok: true, ...r }); }
    return json(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err instanceof PlatformError) return pErr(res, err);
    return json(res, err.status || 400, { error: String(err.message || err).slice(0, 200) });
  }
}

async function handleDraw(action, req, res) {
  const pid = String(req.headers['x-draw-player'] || ''), secret = String(req.headers['x-draw-secret'] || '');
  try {
    if (action === 'state' && req.method === 'GET') { const url = new URL(req.url, 'http://x'); return json(res, 200, draw.view(url.searchParams.get('code'), pid, secret)); }
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    const body = await readBody(req, action === 'submit' ? 200_000 : 4096);
    const me = meFor(req);
    if (action === 'create') {
      const actor = actorFor(req);
      if (!(actor?.kind === 'owner' || (actor?.kind === 'user' && actor.live))) return json(res, 403, { error: 'إنشاء الغرف متاح للمشتركين — يمكنك الانضمام إلى غرفة برمزها' });
      return json(res, 200, draw.create({ name: body.name || me.user?.displayName, color: body.color }));
    }
    if (action === 'join') return json(res, 200, draw.join(body.code, { name: body.name || me.user?.displayName, color: body.color }, { guest: !me.user }));
    if (action === 'start') return json(res, 200, { ok: draw.start(body.code, pid, secret) });
    if (action === 'submit') return json(res, 200, { ok: draw.submit(body.code, pid, secret, body) });
    if (action === 'album') return json(res, 200, { ok: draw.albumNav(body.code, pid, secret, body) });
    if (action === 'guests') return json(res, 200, { ok: draw.setGuests(body.code, pid, secret, body.allow) });
    if (action === 'restart') return json(res, 200, { ok: draw.restart(body.code, pid, secret) });
    if (action === 'leave') return json(res, 200, { ok: draw.leave(body.code, pid, secret) });
    return json(res, 404, { error: 'Not found' });
  } catch (err) { return json(res, 400, { error: String(err.message || err).slice(0, 240) }); }
}

/* «الأدوار المخفية»: a player's private role page. The page gets a one-time code; the player writes
   «دوري <code>» in the stream chat, which proves which viewer owns this browser token. */
const roleLimiter = new RateLimiter({ limit: 30, windowMs: 10 * 60_000 });
async function handleRole(action, url, req, res) {
  const room = publicRoom(url.searchParams.get('room'));
  if (!room) return json(res, 404, { error: 'الغرفة غير موجودة' });
  const token = String(req.headers['x-role-token'] || '');
  try {
    if (action === 'me' && req.method === 'GET') return json(res, 200, room.engine.rolesPrivate(token));
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    if (action === 'claim') {
      if (!roleLimiter.hit('role:' + clientIp(req))) return json(res, 429, { error: 'محاولات كثيرة، انتظر قليلًا' });
      return json(res, 200, room.engine.rolesClaim());
    }
    if (action === 'act') { const body = await readBody(req, 1024); room.engine.rolesAct(token, body.number); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: 'Not found' });
  } catch (err) { return json(res, 400, { error: String(err.message || err).slice(0, 200) }); }
}

/** Server-kept state of a host's live session. */
function liveStatus(room) {
  const e = room.engine, c = e.connection, st = e.status, reg = e.registration || {};
  const meta = e.connMeta, host = room.hostTab();
  let state;
  if (c.state !== 'connected') state = c.username ? 'disconnected' : 'offline';
  else if (!host) state = 'connected';
  else if (host.screen !== 'game') state = 'in_studio';
  else if (st.active) state = 'running';
  else if (reg.phase === 'open') state = 'waiting';
  else if (st.results) state = 'ended';
  else state = 'in_studio';
  // who stands behind the room: an account with a running plan, or the site owner (main room)
  let subscribed = false;
  if (room.kind === 'acct') { const u = platform?.cached(room.ownerId); subscribed = !!u && !u.user.disabled_at && platform.entitlement(room.ownerId).active; }
  else if (room.id === 'main') subscribed = true;
  const reasons = [];
  if (room.kind === 'acct' && platform && privacyOf(platform.cached(room.ownerId)?.user).hideStream) reasons.push('hidden'); // «إخفاء بثي من الصفحة الرئيسية»
  if (!subscribed) reasons.push('no-subscription');
  if (!meta.verified) reasons.push('not-verified');
  if (c.state !== 'connected' || !meta.liveConfirmed) reasons.push('not-live');
  if (!host) reasons.push('studio-closed');
  if (!['waiting', 'running'].includes(state)) reasons.push('no-game');
  return { state, listed: reasons.length === 0, reasons, subscribed, host };
}
function streams() {
  const list = [];
  for (const room of rooms.values()) {
    const st = liveStatus(room);
    if (!st.listed) continue; // subscription + proven ownership + live on the platform + studio open + a game on screen
    const s = room.engine.snapshot();
    const game = ALL_GAMES.find((g) => g.mode === s.status.mode);
    const who = room.engine.streamer || {};
    const handle = String(s.connection.username || '').replace(/^@/, '');
    list.push({ room: room.id, platform: s.connection.platform, username: handle, displayName: who.name || handle,
      avatarUrl: who.avatar || '', liveUrl: liveUrlFor(s.connection.platform, handle), state: st.state, verified: true,
      players: room.engine.realPlayerCount(), active: !!s.status.active, mode: s.status.mode,
      currentGame: game?.title || s.status.title, game: game?.title || s.status.title, cover: game?.cover || '/covers/quiz.svg' });
  }
  list.sort((a, b) => b.players - a.players);
  if (list.length > 1 && list[0].players > 0) list[0].top = true;
  return { streams: list, totalStreams: list.length, totalPlayers: list.reduce((n, s) => n + s.players, 0) };
}
/** Every few seconds: expire codes, close streams whose plan ended, keep the live_sessions rows current. */
function sweepLive() {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.kickOfficial && now - room.kickOfficial.checkedAt > KICK_LIVE_CHECK_MS) checkKickLive(room);
    const st = liveStatus(room);
    if (room.kind === 'acct' && !st.subscribed && ['connected', 'connecting'].includes(room.engine.connection.state)) room.revokeStream('انتهى الاشتراك — جدّد لربط البث');
    const inGame = ['waiting', 'running'].includes(st.state);
    if (inGame && !room.gameSessionId) room.gameSessionId = randomUUID();
    // streamer statistics count only real sessions: every listing condition holds (a hidden stream still counts)
    const real = inGame && st.reasons.every((x) => x === 'hidden');
    if (real && room.kind === 'acct' && platform && !room.sessionCounted) {
      room.sessionCounted = true; room.sessionPeak = 0; room.minuteAt = now; room.sessionStartedAt = now;
      platform.recordStreamSession(room.ownerId, room.engine.status.mode).catch(() => {});
      platform.addWeeklyStreamer(room.ownerId, { sessions: 1 }).catch(() => {});
    }
    if (room.sessionCounted) {
      room.sessionPeak = Math.max(room.sessionPeak || 0, room.engine.realPlayerCount());
      const minutes = Math.floor((now - room.minuteAt) / 60_000); // streaming time, counted only while every listing condition holds
      if (minutes > 0 && real) { room.minuteAt += minutes * 60_000; platform.addWeeklyStreamer(room.ownerId, { minutes }).catch(() => {}); }
      else if (!real) room.minuteAt = now;
    }
    if (!inGame) {
      if (room.sessionCounted && platform) {
        platform.addStreamPlayers(room.ownerId, room.sessionPeak).catch(() => {}); platform.addWeeklyStreamer(room.ownerId, { players: room.sessionPeak }).catch(() => {});
        platform.noteSessionLength(room.ownerId, Math.floor((now - (room.sessionStartedAt || now)) / 60_000)).catch(() => {});
      }
      room.gameSessionId = null; room.sessionCounted = false; room.sessionPeak = 0;
    }
    if (room.kind !== 'acct' || !platform) continue;
    const sig = st.state + '|' + st.listed + '|' + room.gameSessionId + '|' + room.engine.realPlayerCount();
    if (sig === room.saved.sig && now - room.saved.at < 60_000) continue;
    if (st.state === 'offline' && room.saved.state === 'offline') continue;
    room.saved = { sig, state: st.state, at: now };
    const c = room.engine.connection;
    platform.saveLiveSession(room.ownerId, { room: room.id, gameSessionId: room.gameSessionId, platform: c.username ? c.platform : null, handle: c.username || null,
      platformUserId: room.engine.streamer?.platformId || null, verified: room.engine.connMeta.verified, subscriptionActive: st.subscribed, state: st.state, listed: st.listed,
      currentGame: inGame ? (ALL_GAMES.find((g) => g.mode === room.engine.status.mode)?.title || null) : null, players: room.engine.realPlayerCount(),
      lastHeartbeatAt: st.host?.at || null, lastLiveCheckAt: c.state === 'connected' ? now : null, liveConfirmed: c.state === 'connected' && room.engine.connMeta.liveConfirmed }).catch(() => {});
  }
}

const STATIC = new Set(['profile.html','profile.js','dash.css','index.html','home.html','home.js','home.css','pages.css','auth.html','auth.js','me.html','me.js','admin.html','admin.js','privacy.html','terms.html','refund.html','google.js','studio.html','studio.js','studio.css','event.html','event.js','event.css','bomb.html','bomb.js','bomb.css','draw.html','draw.js','draw.css','play.html','play.js','play.css','role.html','role.js','sponge.css','sponge.js','sponge-ui.js','sponge-mark.svg','seafloor.svg','draw-mark.svg','icons.svg','royal-core.css','royal-studio.css','royal-broadcast.css','royal-luxe.css','royal-arena.css','royal-dash.css','aurum.css','aurum.js','session.js','account.js','account.css','mascot.js','overlay.html','app.js','overlay.js','favicon.svg','tools.html','tools.js','tools.css','tool.html','tool.js','tool.css','guide-games.html','guide-tiktok.html','guide-tools.html',
  ...ALL_GAMES.map((g) => g.cover.slice(1)),
  // game art, legacy covers and flags: every file in these folders is public
  ...['games', 'covers', 'flags', 'brand'].flatMap((dir) => { try { return fs.readdirSync(path.join(here, 'public', dir)).filter((f) => /^[\w.-]+\.(png|webp|svg|txt)$/.test(f)).map((f) => dir + '/' + f); } catch { return []; } }),
  'fonts/tajawal-arabic-500-normal.woff2','fonts/tajawal-arabic-700-normal.woff2','fonts/tajawal-arabic-800-normal.woff2','fonts/tajawal-latin-700-normal.woff2','fonts/inter-display-light.woff','fonts/inter-display-semibold.woff','fonts/OFL.txt']);

const server = http.createServer(async (req, res) => {
  secureHeaders(res);
  renewSession(req, res);
  let url; try { url = new URL(req.url, 'http://localhost'); } catch { return json(res, 400, { error: 'Bad URL' }); }
  try {
    if (url.pathname === '/health') return json(res, 200, { ok: true, mode: mainRoom.engine.status.mode, rooms: rooms.size, accounts: !!platform });
    if (url.pathname === '/api/state' && req.method === 'GET') {
      const room = publicRoom(url.searchParams.get('room'));
      return room ? json(res, 200, room.view()) : json(res, 404, { error: 'الغرفة غير موجودة' });
    }
    if (url.pathname === '/api/site' && req.method === 'GET') return json(res, 200, { ...siteConfig(), updates: UPDATES, plans: PLANS, gameSettings: settingsSchema(), joinWords: JOIN_WORD_SUGGESTIONS, lateJoinModes: LATE_JOIN_MODES });
    if (url.pathname.startsWith('/api/u/') && req.method === 'GET') {
      if (!platform) return json(res, 404, { error: 'غير موجود' });
      const p = await platform.publicProfile(decodeURIComponent(url.pathname.slice(7)));
      return p ? json(res, 200, p) : json(res, 404, { error: 'لا يوجد حساب بهذا المعرف' });
    }
    if (url.pathname === '/api/streams' && req.method === 'GET') return json(res, 200, streams());
    if (url.pathname === '/api/room-code' && req.method === 'GET') {
      if (!roomCodeLimiter.hit('ip:' + clientIp(req))) return json(res, 429, { error: 'محاولات كثيرة — انتظر قليلًا ثم حاول مرة أخرى' });
      const code = String(url.searchParams.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const id = code.length === 4 ? roomCodes.get(code) : null;
      if (!id || !rooms.has(id)) return json(res, 404, { error: 'الكود غير صحيح أو انتهت الغرفة — تأكد منه من شاشة البث' });
      const reg = rooms.get(id).engine.registration, count = rooms.get(id).engine.players.size;
      if (reg.phase === 'open' && count >= reg.maxPlayers) return json(res, 409, { error: 'الغرفة ممتلئة — اكتمل عدد المتسابقين في هذه الجولة', full: true });
      return json(res, 200, { room: id, url: '/play?room=' + encodeURIComponent(id) });
    }
    if (url.pathname === '/api/leaderboard' && req.method === 'GET') {
      if (!platform) return json(res, 503, { error: 'اللوحة غير متاحة الآن' });
      const board = url.searchParams.get('board') === 'streamers' ? 'streamers' : 'players';
      const metric = String(url.searchParams.get('metric') || '').slice(0, 12);
      const find = url.searchParams.get('find');
      if (find) {
        if (!/^SPG-[A-Z0-9]{4,8}$/i.test(find)) return json(res, 400, { error: 'اكتب معرف SPG بالشكل SPG-XXXXXX' });
        const hit = await platform.leaderboardFind(find, metric, board);
        return hit ? json(res, 200, { found: hit }) : json(res, 404, { error: 'لا يوجد حساب بهذا المعرف أو إحصاءاته مخفية' });
      }
      res.setHeader('Cache-Control', 'public, max-age=20');
      if (url.searchParams.get('week') === 'prev') {
        const prev = new Date(Date.parse(weekOf(Date.now()).start + 'T00:00:00Z') - 7 * 86400_000).toISOString().slice(0, 10);
        return json(res, 200, await platform.archivedBoard(prev, board, metric || (board === 'players' ? 'wins' : 'hours')));
      }
      return json(res, 200, await platform.leaderboard(board, metric));
    }
    if (url.pathname === '/api/partners' && req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, max-age=60');
      return json(res, 200, { partners: platform ? await platform.partners() : [] });
    }
    const photo = /^\/api\/partners\/(\d{1,8})\/photo$/.exec(url.pathname);
    if (photo && req.method === 'GET') {
      const img = platform && await platform.partnerPhoto(photo[1]);
      if (!img) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': img.type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      return res.end(img.data);
    }
    if (url.pathname === '/api/sketch' && req.method === 'GET') { const room = publicRoom(url.searchParams.get('room')); return room ? json(res, 200, room.sketch || { data: '', v: 0 }) : json(res, 404, { error: 'الغرفة غير موجودة' }); }
    if (url.pathname.startsWith('/api/role/')) return await handleRole(url.pathname.slice('/api/role/'.length), url, req, res);
    if (url.pathname.startsWith('/api/access/')) return await handleAccess(url.pathname.slice('/api/access/'.length), req, res);
    if (url.pathname.startsWith('/api/account/')) return await handleAccount(url.pathname.slice('/api/account/'.length), req, res);
    if (url.pathname.startsWith('/api/auth/')) return await handleAuth(url.pathname.slice('/api/auth/'.length), req, res);
    { const m = /^\/api\/oauth\/(tiktok|kick)\/(start|callback)$/.exec(url.pathname); if (m && req.method === 'GET') return await handleOAuth(m[1], m[2], req, res, url); }
    if (url.pathname === '/api/kick/webhook' && req.method === 'POST') return await handleKickWebhook(req, res);
    if (url.pathname.startsWith('/api/me/')) return await handleMe(url.pathname.slice('/api/me/'.length), req, res);
    if (url.pathname.startsWith('/api/manage/')) return await handleManage(url.pathname.slice('/api/manage/'.length), req, res);
    if (url.pathname === '/api/billing/webhook' && req.method === 'POST') return await handleWebhook(req, res);
    if (url.pathname === '/verify' && req.method === 'GET') {
      const user = platform ? await platform.verifyEmail(url.searchParams.get('token') || '') : null;
      res.writeHead(302, { Location: user ? '/account?verified=1' : '/account?verified=0', 'Cache-Control': 'no-store' }); return res.end();
    }
    if (url.pathname.startsWith('/api/draw/')) return await handleDraw(url.pathname.slice('/api/draw/'.length), req, res);
    if (url.pathname === '/api/admin/bank' && req.method === 'GET') { const actor = actorFor(req); return actor ? json(res, 200, actor.room.questionBank.stats()) : json(res, 401, { error: 'رمز الإدارة غير صحيح' }); }
    if (url.pathname === '/api/admin/verify' && req.method === 'POST') {
      const actor = actorFor(req);
      return json(res, actor ? 200 : 401, { ok: !!actor, ...(actor ? { kind: actor.kind, room: actor.room.id, live: actor.live } : {}) });
    }
    if (url.pathname.startsWith('/api/admin/') && req.method === 'POST') {
      const action = url.pathname.slice('/api/admin/'.length);
      if (!isAuthorized(req) && accountSession(req)) return json(res, 402, { error: action === 'connect' ? 'تحتاج إلى اشتراك فعال لربط بثك المباشر' : 'اشتراكك أو تجربتك غير فعّالة الآن — فعّل التجربة أو اشترك من صفحة «حسابي»', account: true, needPlan: true });
      if (!isAuthorized(req)) return json(res, 401, { error: action === 'connect' ? 'تحتاج إلى اشتراك فعال لربط بثك المباشر' : 'رمز الإدارة غير صحيح', needPlan: action === 'connect' });
      const actor = actorFor(req);
      actor.room.touched = Date.now();
      // Several studio windows: only the controlling one may change the room (the others can take over).
      const tab = String(req.headers['x-studio-tab'] || '');
      if (tab && action !== 'heartbeat' && actor.room.hostTab() && actor.room.primaryTab !== tab) return json(res, 409, { error: 'الاستوديو مفتوح في نافذة أخرى — اضغط «التحكم من هنا» لنقل التحكم إلى هذه النافذة', otherWindow: true });
      try { const result = await handleAction(action, await readBody(req, action === 'sketch' ? 200_000 : 16384), actor); return json(res, 200, result); }
      catch (err) { return json(res, err.status || 400, { error: String(err.message || err).slice(0, 240), ...(err.fields ? { fields: err.fields } : {}), ...(err.needPlan ? { needPlan: true } : {}) }); }
    }
    if (url.pathname === '/api/dev-token' && req.method === 'GET') {
      // Never expose administrator credentials on a deployed or remotely reachable server.
      const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      if (process.env.NODE_ENV === 'development' && loopback) return json(res, 200, { token: authToken });
      return json(res, 404, { error: 'Not found' });
    }
  } catch (err) { return json(res, err.status || 500, { error: String(err.message || err).slice(0, 200) }); }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
  // Studio pages need a signed-in session (promo code, owner or account). Viewers keep /overlay and /role.
  const STUDIO_PAGES = new Set(['/studio', '/dashboard', '/event', '/bomb', '/play', '/tools']);
  if (STUDIO_PAGES.has(url.pathname)) {
    const viewer = url.pathname === '/play' && url.searchParams.has('room');
    const acct = !viewer && !actorFor(req) ? accountSession(req) : null;
    if (acct) { res.writeHead(302, { Location: '/account?need=plan', 'Cache-Control': 'no-store' }); return res.end(); }
    if (!viewer && !actorFor(req)) { res.writeHead(302, { Location: '/?next=' + encodeURIComponent(url.pathname + url.search), 'Cache-Control': 'no-store' }); return res.end(); }
    if (url.pathname === '/play' && !viewer) { res.writeHead(302, { Location: '/studio' + (url.search || ''), 'Cache-Control': 'no-store' }); return res.end(); }
  }
  if ((url.pathname === '/login' || url.pathname === '/signup') && accountSession(req)) {
    const intent = url.searchParams.get('intent'), next = url.searchParams.get('next') || '';
    const a = accountView(accountSession(req).userId);
    const to = /^\/(account|studio|admin)(?:[/?#]|$)/.test(next) ? next : intent === 'studio' && a?.entitled ? '/studio' : intent === 'trial' ? '/account?verify=trial#trial' : '/account';
    res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); return res.end();
  }
  if (url.pathname === '/admin' && !adminActor(req)) { res.writeHead(302, { Location: '/login?next=/admin', 'Cache-Control': 'no-store' }); return res.end(); }
  if (url.pathname === '/account' && !accountSession(req)) { res.writeHead(302, { Location: '/login?next=/account' + encodeURIComponent(url.search), 'Cache-Control': 'no-store' }); return res.end(); }
  const fileMap = { '/': 'home.html', '/signup': 'auth.html', '/login': 'auth.html', '/account': 'me.html', '/admin': 'admin.html', '/privacy': 'privacy.html', '/terms': 'terms.html', '/refund': 'refund.html', '/event': 'event.html', '/bomb': 'bomb.html', '/studio': 'studio.html', '/dashboard': 'index.html', '/overlay': 'overlay.html', '/draw': 'draw.html', '/play': 'play.html', '/role': 'role.html', '/tools': 'tools.html', '/tool': 'tool.html', '/guide/games': 'guide-games.html', '/guide/tiktok-live': 'guide-tiktok.html', '/guide/tools': 'guide-tools.html', '/favicon.ico': 'brand/favicon-64.png', '/apple-touch-icon.png': 'brand/sponge-192.png', '/og-image.webp': 'brand/sponge-512.webp' };
  const relative = fileMap[url.pathname] || (/^\/u\/SPG-[A-Z0-9]{6}$/i.test(url.pathname) ? 'profile.html' : url.pathname.slice(1));
  // Explicit whitelist: no path traversal, hidden files or project files exposed.
  if (!STATIC.has(relative)) return json(res, 404, { error: 'Not found' });
  try { return await serveStatic(req, res, relative); }
  catch { json(res, 404, { error: 'Not found' }); }
});
/* ---------------------------------------------------------- static files
   Files are read once, gzip-compressed once and served with an ETag. HTML pages get a content hash on
   every local CSS/JS link (?v=…), so those files can be cached for a year and a deploy is picked up
   immediately — an old design can never stick in a browser cache. */
const fileCache = new Map();
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.txt', '.json']);
async function loadAsset(relative) {
  const filename = path.join(root, relative);
  const stat = await fs.promises.stat(filename);
  const hit = fileCache.get(relative);
  if (hit && hit.mtime === stat.mtimeMs) return hit;
  let body = await fs.promises.readFile(filename);
  const ext = path.extname(filename);
  if (ext === '.html') {
    let html = body.toString('utf8');
    const refs = [...new Set([...html.matchAll(/(?:href|src)="\/([\w.-]+\.(?:css|js))"/g)].map((m) => m[1]))];
    for (const ref of refs) { if (!STATIC.has(ref)) continue; const asset = await loadAsset(ref); html = html.split('"/' + ref + '"').join('"/' + ref + '?v=' + asset.etag.slice(1, 9) + '"'); }
    body = Buffer.from(html);
  }
  const etag = '"' + createHash('sha1').update(body).digest('base64url').slice(0, 16) + '"';
  const entry = { body, gzip: COMPRESSIBLE.has(ext) && body.length > 600 ? gzipSync(body, { level: 9 }) : null, etag, type: mime[ext] || 'application/octet-stream', ext, mtime: stat.mtimeMs };
  fileCache.set(relative, entry);
  return entry;
}
async function serveStatic(req, res, relative) {
  const asset = await loadAsset(relative);
  const versioned = /[?&]v=/.test(req.url);
  const cache = asset.ext === '.html' ? 'no-cache'
    : versioned ? 'public, max-age=31536000, immutable'
    : ['.css', '.js'].includes(asset.ext) ? 'public, max-age=300, must-revalidate'
    : 'public, max-age=604800';
  const headers = { 'Content-Type': asset.type, 'Cache-Control': cache, ETag: asset.etag, Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === asset.etag) { res.writeHead(304, headers); return res.end(); }
  const useGzip = asset.gzip && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = useGzip ? asset.gzip : asset.body;
  if (useGzip) headers['Content-Encoding'] = 'gzip';
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : body);
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
let socketCount = 0;
server.on('upgrade', (req, socket, head) => {
  let url; try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  const room = publicRoom(url.searchParams.get('room'));
  if (!room) { socket.destroy(); return; }
  // Public WebSocket is read-only; messages from clients do nothing.
  wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, room); });
});
wss.on('connection', (ws, room) => {
  if (room.clients.size >= 150 || socketCount >= 1200) { ws.close(1013, 'Too many connections'); return; }
  room.clients.add(ws); socketCount++;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', () => {});
  ws.on('close', () => { room.clients.delete(ws); socketCount--; room.touched = Date.now(); });
  send(ws, { type: 'state', data: room.view() });
  if (room.sketch?.data) send(ws, { type: 'sketch', data: room.sketch }); // reconnects get the current drawing
});
// 100 ms resolution: every deadline is authoritative on the server, viewers only render it.
const roundClock = setInterval(() => { for (const room of rooms.values()) room.engine.tick(); draw.tick(); }, 100);
roundClock.unref?.();
const liveSweep = setInterval(sweepLive, 5000);
// a week that ended: freeze its leaderboard and record prize winners (idempotent)
const weekCloser = setInterval(() => { platform?.closeWeeks().catch(() => {}); }, 60_000);
liveSweep.unref?.();
const heartbeat = setInterval(() => {
  for (const room of rooms.values()) for (const ws of room.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
  evictIdleRooms(); sessions.prune(); draw.cleanup();
}, 30000);
heartbeat.unref?.();
server.listen(PORT, '0.0.0.0', () => console.log(`TikTok LIVE Events ready on http://localhost:${PORT}`));
const shutdown = async () => {
  clearInterval(roundClock); clearInterval(heartbeat); clearInterval(liveSweep); clearInterval(weekCloser);
  for (const room of rooms.values()) await room.disconnectAll().catch(() => {});
  wss.close(); server.close(); server.closeIdleConnections?.();
  if (pool) { await promos.mirror?.drain(); await sessions.mirror?.drain(); await pool.end().catch(() => {}); }
};
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
