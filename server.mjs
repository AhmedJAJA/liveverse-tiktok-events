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
import { prepareLobby } from './src/lobby.mjs';
import { FrameStore } from './src/frames.mjs';
import { settingsSchema, JOIN_WORD_SUGGESTIONS, LATE_JOIN_MODES } from './src/game-settings.mjs';
import { QuestionBank, loadDefaultQuestions } from './src/question-bank.mjs';
import { siteConfig, ALL_GAMES, UPDATES } from './src/catalog.mjs';
import { AccountStore, Sessions, RateLimiter, FieldError, parseCookies, roomId, PLANS } from './src/accounts.mjs';
import { DrawHub } from './src/draw.mjs';
import { PromoStore, PROMO_LEVELS } from './src/promo.mjs';
import { createPool, migrate } from './src/db.mjs';
import { PromoMirror, SessionMirror } from './src/persist.mjs';
import { Platform, PlatformError, canonicalEmail, PLANS as PLATFORM_PLANS, AVATARS, privacyOf, weekOf } from './src/platform.mjs';
import { createMailer, createGateway } from './src/services.mjs';
import { Economy, EconomyError, hashDevice, hashIp, WHATSAPP_URL, DAILY_REWARD, REFERRAL_REWARD, REFERRAL_CAP } from './src/economy.mjs';
import { GoogleVerifier, GoogleOAuth } from './src/google.mjs';
import { Providers, TokenBox, OAuthError, pkcePair } from './src/oauth.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'public');
const authToken = process.env.ADMIN_TOKEN || randomBytes(24).toString('hex');
if (!process.env.ADMIN_TOKEN) { if (process.env.NODE_ENV === 'production') console.warn('ADMIN_TOKEN is unset; configure it in the hosting environment.'); else console.log('\n[LOCAL ADMIN TOKEN] ' + authToken + '\nSet ADMIN_TOKEN in hosting environment before publishing.'); }
const safeToken = Buffer.from(authToken, 'utf8');
const matchesToken = (raw) => { const incoming = Buffer.from(String(raw||''), 'utf8'); return incoming.length === safeToken.length && timingSafeEqual(incoming, safeToken); };
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.glb': 'model/gltf-binary' };
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
const skinCache = new Map(); // 'platform:handle' → { skin, at }
const frameCache = new Map(); // 'platform:handle' → { frame, at }
// lobby transitions → the event name sent to every screen of the room (the full state follows in the next 'state')
const LOBBY_EVENT = { PREPARING_LOBBY: 'lobby:preparing', LOBBY_READY: 'lobby:ready', LOBBY_ERROR: 'lobby:error', RECOVERING: 'lobby:recovering', REGISTRATION_OPEN: 'registration:opened',
  REGISTRATION_CLOSED: 'registration:closed', ROUND_STARTING: 'round:starting', ROUND_RUNNING: 'round:started', ROUND_FINISHED: 'round:finished', GAME_LIBRARY: 'session:ended', GAME_SETUP: 'lobby:state' };
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
    this.flow = new GameFlow({ engine: this.engine, games: ALL_GAMES, onChange: () => this.lobbyChanged() });
    this.lastLobbyState = this.flow.state; this.lastCount = 0; this.persistTimer = null; this.persistSig = ''; this.restoring = null; this.preparing = null;
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
  /** One lobby event per change, sent at once (not throttled): the preparation screen follows each real step. */
  lobbyChanged() {
    if (this.inLobbyEvent) return; // snapshot() may itself settle the state; one event is enough
    this.inLobbyEvent = true;
    try {
      const f = this.flow.snapshot(), st = f.state;
      const event = st === this.lastLobbyState ? 'lobby:progress' : LOBBY_EVENT[st] || 'lobby:state';
      this.lastLobbyState = st;
      if (this.clients.size) { const raw = JSON.stringify({ type: 'lobby', event, data: { state: st, stage: f.stage, version: f.version, lobby: f.lobby } }); for (const ws of this.clients) if (ws.readyState === WebSocket.OPEN) ws.send(raw); }
    } finally { this.inLobbyEvent = false; }
    this.scheduleBroadcast(); this.persistSoon();
  }
  /** Account rooms keep their open lobby in PostgreSQL so a restart can bring it back (src/flow.mjs recover()). */
  persistSoon() {
    if (this.kind !== 'acct' || !frames || this.restoring) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      const data = this.flow.persisted(), sig = data ? JSON.stringify({ ...data, savedAt: 0 }) : 'none';
      if (sig === this.persistSig) return;
      this.persistSig = sig;
      frames.saveLobby(this.id, this.ownerId, data).catch((err) => { this.persistSig = ''; console.warn('[lobby] save', err.message); });
    }, 1200);
    this.persistTimer.unref?.();
  }
  view() { return { ...this.engine.snapshot(), flow: this.flow.snapshot(), frames: this.frameView(), connRetry: this.engine.connection.platform === 'tiktok' && this.engine.connection.state !== 'connected' ? this.tiktok.retryState() : null, tools: this.tools.snapshot(), roomCode: this.joinCode && roomCodes.get(this.joinCode) === this.id ? this.joinCode : null, viewers: this.clients.size, skins: this.skinView() }; }
  /** Equipped skins of players whose TikTok / Kick account is officially linked to a سبونج لايف account.
      Read from a shared 60-second cache, so building the state never waits on the database. */
  skinView() {
    const where = this.engine.connection.platform;
    if (!platform || !['tiktok', 'kick'].includes(where)) return {};
    const out = {}, missing = [], now = Date.now();
    for (const p of this.engine.players.values()) {
      if (!p.handle) continue;
      const hit = skinCache.get(where + ':' + p.handle);
      if (!hit || now - hit.at > 60_000) missing.push(p.handle);
      if (hit?.skin) { out['n:' + p.number] = hit.skin; out['i:' + p.id] = hit.skin; }
    }
    if (missing.length && !this.skinLookup) {
      this.skinLookup = platform.skinsForHandles(where, missing).then((found) => {
        let any = false;
        for (const [h, skin] of found) { const prev = skinCache.get(where + ':' + h); skinCache.set(where + ':' + h, { skin, at: Date.now() }); if (skin && prev?.skin?.id !== skin.id) any = true; }
        if (skinCache.size > 20_000) skinCache.clear();
        if (any) this.scheduleBroadcast();
      }).catch(() => {}).finally(() => { this.skinLookup = null; });
    }
    return out;
  }
  /** Name frames of players whose TikTok / Kick account is linked to a سبونج لايف account that equipped one
      (guests get none — nothing is invented). Same 60-second shared cache as the skins. */
  frameView() {
    const where = this.engine.connection.platform;
    if (!frames || !['tiktok', 'kick'].includes(where)) return {};
    const out = {}, missing = [], now = Date.now();
    for (const p of this.engine.players.values()) {
      const handle = p.handle || (p.host ? String(this.engine.connection.username || '').toLowerCase() : '');
      if (!handle) continue;
      const hit = frameCache.get(where + ':' + handle);
      if (!hit || now - hit.at > 60_000) missing.push(handle);
      if (hit?.frame) { out['n:' + p.number] = hit.frame; out['i:' + p.id] = hit.frame; }
    }
    if (missing.length && !this.frameLookup) {
      this.frameLookup = frames.forHandles(where, missing).then((found) => {
        let any = false;
        for (const [h, frame] of found) { const prev = frameCache.get(where + ':' + h); frameCache.set(where + ':' + h, { frame, at: Date.now() }); if (frame?.id !== prev?.frame?.id) any = true; }
        if (frameCache.size > 20_000) frameCache.clear();
        if (any) this.scheduleBroadcast();
      }).catch(() => {}).finally(() => { this.frameLookup = null; });
    }
    return out;
  }
  scheduleBroadcast() {
    this.noteGameEnd();
    if (this.flushTimer) return;
    const wait = Math.max(0, BROADCAST_MS - (Date.now() - this.lastFlush));
    this.flushTimer = setTimeout(() => this.flush(), wait);
  }
  flush() {
    clearTimeout(this.flushTimer); this.flushTimer = null; this.lastFlush = Date.now();
    if (!this.clients.size) return 0;
    this.broadcasts++;
    const n = this.engine.players.size;
    if (n !== this.lastCount) { // participant events (the full list follows in the state)
      const raw = JSON.stringify({ type: 'lobby', event: n > this.lastCount ? 'participant:added' : 'participant:removed', data: { count: n, generation: this.engine.registration.generation } });
      this.lastCount = n; this.persistSoon();
      for (const ws of this.clients) if (ws.readyState === WebSocket.OPEN) ws.send(raw);
    }
    const raw = JSON.stringify({ type: 'state', data: this.view() });
    let sent = 0;
    for (const ws of this.clients) if (ws.readyState === WebSocket.OPEN && (ws.bufferedAmount || 0) < 4_000_000) { ws.send(raw); sent++; }
    return sent;
  }
  /** Weekly leaderboard: a finished game in a real, listed session gives each real player an entry and the winner a win. */
  noteGameEnd() {
    const st = this.engine.status, ev = st.lastEvent;
    if (!ev || st.active || ev.at === this.lastGameAt || !(ev.winner || st.results)) return;
    this.lastGameAt = ev.at;
    if (this.kind !== 'acct' || !platform || !this.sessionCounted) return;
    if (this.flow.trial || this.flow.lobby?.demo) return; // «وضع التجربة» never reaches the rankings
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
    if (kind === 'acct' && frames) room.restoring = restoreLobby(room).finally(() => { room.restoring = null; });
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
let platform = null, economy = null, frames = null;
if (pool) {
  await migrate(pool);
  await PromoMirror.attach(pool, promos);
  await SessionMirror.attach(pool, sessions);
  platform = new Platform({ pool, hashCode: (c) => promos.hash(c), mail: createMailer(), gateway: createGateway(), appUrl: process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + (Number(process.env.PORT) || 3000),
    ...(process.env.NODE_ENV === 'test' && process.env.SKY_MIN_ROUND_MS ? { minRoundMs: Number(process.env.SKY_MIN_ROUND_MS) } : {}) });
  await platform.init();
  economy = new Economy({ pool, platform });
  frames = new FrameStore({ pool });
  for (const code of String(process.env.SPONGE_PROMO_CODES || '').split(',').map((c) => c.trim()).filter(Boolean)) promos.seed(code);
} else console.warn('[db] DATABASE_URL is not set: games and promo codes work; accounts, trials and subscriptions are off.');
const appUrl = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + (Number(process.env.PORT) || 3000)).replace(/\/$/, '');
const providers = new Providers({ appUrl });
const tokenBox = new TokenBox();
const google = new GoogleVerifier({ clientId: process.env.GOOGLE_CLIENT_ID || '', jwksUrl: process.env.GOOGLE_JWKS_URL || undefined });
const googleOAuth = new GoogleOAuth({ clientId: process.env.GOOGLE_CLIENT_ID || '', clientSecret: process.env.GOOGLE_CLIENT_SECRET || '', verifier: google,
  ...(process.env.GOOGLE_AUTH_URL ? { authUrl: process.env.GOOGLE_AUTH_URL } : {}), ...(process.env.GOOGLE_TOKEN_URL ? { tokenUrl: process.env.GOOGLE_TOKEN_URL } : {}) });
/** The site's own addresses (APP_URL, PUBLIC_HOSTS, Render's address). OAuth callbacks are built for the address the
    visitor is on — but only for these hosts, never for an arbitrary Host header. */
const PUBLIC_HOSTS = new Set([appUrl, process.env.RENDER_EXTERNAL_URL || '', ...String(process.env.PUBLIC_HOSTS || '').split(',').map((h) => 'https://' + h.trim())]
  .map((u) => { try { return new URL(u).host.toLowerCase(); } catch { return ''; } }).filter(Boolean));
function baseFor(req) {
  const host = String(req.headers.host || '').toLowerCase();
  if (PUBLIC_HOSTS.has(host)) return (isHttps(req) || process.env.NODE_ENV === 'production' ? 'https://' : 'http://') + host;
  if (process.env.NODE_ENV !== 'production' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return 'http://' + host;
  return appUrl;
}
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
/** Adds a cookie without dropping the ones already set on this response. */
function appendCookie(res, cookie) { const prev = res.getHeader('Set-Cookie'); res.setHeader('Set-Cookie', [...(prev ? [].concat(prev) : []), cookie]); }
/** A random first-party browser id (never shown); one of the signals used to spot self-invitations. */
function browserId(req, res) {
  let id = parseCookies(req.headers.cookie).sl_dev || '';
  if (!/^[A-Za-z0-9_-]{24}$/.test(id)) { id = randomBytes(18).toString('base64url'); appendCookie(res, `sl_dev=${id}; HttpOnly; Path=/; SameSite=Lax; Max-Age=63072000${isHttps(req) ? '; Secure' : ''}`); }
  return hashDevice(id);
}
/** After a new account is created: remember who invited it (cookie from /signup?ref=…) and this browser. */
async function afterSignup(req, res, userId) {
  if (!economy) return;
  const device = browserId(req, res);
  try {
    const ref = parseCookies(req.headers.cookie).sl_ref;
    if (ref) { await economy.attachReferral(userId, ref, { device, ipHash: hashIp(clientIp(req)) }); appendCookie(res, `sl_ref=; Path=/; Max-Age=0; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`); }
    await economy.noteDevice(userId, device);
    await economy.settleReferral(userId); // Google sign-ups arrive already verified
  } catch (err) { console.warn('[economy] signup', err.message); }
}
async function afterLogin(req, res, userId) { if (economy) await economy.noteDevice(userId, browserId(req, res)).catch(() => {}); }
function setSession(res, req, id, maxAge) {
  appendCookie(res, `${COOKIE}=${id}; HttpOnly; Path=/; SameSite=Lax${maxAge ? '; Max-Age=' + maxAge : ''}${isHttps(req) ? '; Secure' : ''}`);
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
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' https://accounts.google.com/gsi/style; frame-src 'self' https://accounts.google.com/gsi/; connect-src 'self' blob: ws: wss: https://accounts.google.com/gsi/; img-src 'self' data: blob: https://*.googleusercontent.com https://files.kick.com https://*.tiktokcdn.com https://*.tiktokcdn-us.com https://*.tiktokcdn-eu.com https://*.tiktokcdn-in.com https://*.byteoversea.com https://*.ibytedtos.com https://*.ibyteimg.com https://*.muscdn.com; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
}

/** One question of «تحدي المعرفة» from the bank; when the chosen category/level runs out, any question will do. */
function drawQuestion(bank, { category = 'all', difficulty = 'all' } = {}) {
  let q; try { q = bank.draw({ category, difficulty }); } catch { try { q = bank.draw({}); } catch { bank.reset(); q = bank.draw({}); } }
  return { title: 'تحدي ' + (bank.stats().categories[q.category]?.title || 'المعلومات'), prompt: q.question, options: q.options, answer: q.answer };
}
async function handleAction(action, body, actor) {
  const { engine, questionBank } = actor.room;
  const room = actor.room;
  if (room.restoring && action !== 'heartbeat') await room.restoring; // a lobby coming back after a restart is settled first
  switch (action) {
    // ---- the launch flow: every step is a separate command (see src/flow.mjs)
    case 'flow-setup': room.flow.setup(String(body.mode || '')); room.scheduleBroadcast(); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-settings': room.flow.saveSettings(room.flow.mode, body.settings, { lateJoin: body.lateJoin, keyword: body.keyword, autoOpen: typeof body.autoOpen === 'boolean' ? body.autoOpen : undefined, audience: body.audience }); room.scheduleBroadcast(); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-reset': room.flow.resetSettings(room.flow.mode); room.scheduleBroadcast(); return { ok: true, flow: room.flow.snapshot() };
    // «ابدأ اللعبة»: PREPARING_LOBBY now; the real steps run in the background and report themselves
    case 'flow-begin': { const r = room.flow.begin({ demo: false }); if (!r.reused) startPreparation(room, actor, String(body.platform || '')); return { ok: true, reused: r.reused, flow: room.flow.snapshot() }; }
    case 'flow-cancel': room.flow.cancel(); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-open': room.flow.open(body.keyword); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-close': room.flow.close(); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-keyword': room.flow.setKeyword(body.keyword, body.version); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-registration-reset': {
      const r = room.flow.resetRegistration({ confirm: body.confirm === true });
      if (actor.kind === 'acct') platform?.audit('user:' + actor.userId, 'lobby-reset', { target: actor.userId, details: { generation: r.generation } }).catch(() => {});
      return { ok: true, ...r, flow: room.flow.snapshot() };
    }
    case 'flow-start': {
      // the live chat must really be connected for a live lobby («وضع التجربة» is exempt)
      const c = engine.connection;
      const streamIssue = room.flow.lobby?.demo ? null : c.state !== 'connected' ? 'البث غير متصل — أعد الاتصال من الأعلى أو استخدم «تجربة اللعبة»'
        : actor.kind === 'acct' && !engine.connMeta.verified ? 'لم يُتحقق من حساب البث — أعد الاتصال من الأعلى' : null;
      const requestId = /^[A-Za-z0-9_-]{6,64}$/.test(String(body.requestId || '')) ? String(body.requestId) : null;
      const r = room.flow.start((s) => { const q = drawQuestion(questionBank, s); engine.configure({ mode: 'quiz', title: q.title, prompt: q.prompt, options: q.options, answer: q.answer }); }, { requestId, requireStream: streamIssue });
      room.flush();
      return { ok: true, duplicate: !!r.duplicate, round: r.round, flow: room.flow.snapshot() };
    }
    case 'flow-again': room.flow.again(); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-end': room.flow.end(); room.scheduleBroadcast(); return { ok: true, flow: room.flow.snapshot() };
    case 'flow-library': room.flow.library(); room.scheduleBroadcast(); return { ok: true, flow: room.flow.snapshot() };
    // «تجربة اللعبة»: the same preparation in «وضع التجربة» (test players, no stream, nothing counted)
    case 'flow-trial': { const r = room.flow.tryOut(); if (!r.reused) startPreparation(room, actor, ''); return { ok: true, flow: room.flow.snapshot() }; }
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
    case 'remove-player': {
      const r = engine.removePlayer(body);
      if (actor.kind === 'acct') platform?.audit('user:' + actor.userId, 'lobby-remove-player', { target: actor.userId, details: { name: r.removed, session: room.flow.sessionId } }).catch(() => {});
      return { ok: true, ...r };
    }
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
      if (room.tabs.size >= 12 && !room.tabs.has(tab)) throw new Error('نوافذ كثيرة مفتوحة للعبة');
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
/** Linking a LIVE needs a running trial or subscription on a سبونج لايف account (or the site owner). */
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
/* ------------------------------------------------ the game lobby: preparation, recovery (src/lobby.mjs) */
const PREPARE_LIMIT = 6; let preparingNow = 0; // limits simultaneous connection attempts across all rooms
function lobbyContext(actor, room, platformPref = '') {
  return {
    actor, platform: ['tiktok', 'kick'].includes(platformPref) ? platformPref : '',
    entitled: (a) => a.kind !== 'acct' || !!platform?.entitlement(a.userId).active,
    linked: async (userId) => ({ tiktok: await platform.verifiedStream(userId, 'tiktok'), kick: await platform.verifiedStream(userId, 'kick') }),
    linkable: (p) => linkableNow(p),
    connect: (a, r, p) => connectLinked(a, r, p),
    flush: () => room.flush(),
    release: (why) => { if (room.engine.connection.state !== 'connected') { room.tiktok.disconnect(false).catch(() => {}); room.engine.setConnection('disconnected', room.engine.connection.username, why, room.engine.connection.platform); } },
    addDemo: () => { const added = room.engine.addDemoPlayers({ count: Math.max(4, minPlayersOf(room)) }); room.engine.setSimulation({ autoplay: true }); return added; },
  };
}
const minPlayersOf = (room) => room.engine.snapshot().registration.minPlayers || 1;
/** Run the preparation in the background; the studio follows it through lobby events (and /api/state). */
function startPreparation(room, actor, platformPref) {
  if (room.preparing) return room.preparing;
  if (preparingNow >= PREPARE_LIMIT) { room.flow.failLobby({ code: 'prepare_failed', message: 'الخادم يجهّز لوبيات كثيرة الآن — أعد المحاولة بعد لحظات', action: 'retry' }); return Promise.resolve(); }
  preparingNow++;
  room.preparing = prepareLobby(room, lobbyContext(actor, room, platformPref))
    .catch((err) => { console.warn('[lobby]', err?.message); room.flow.failLobby({ code: 'prepare_failed', message: '', action: 'retry' }); })
    .finally(() => { preparingNow--; room.preparing = null; });
  return room.preparing;
}
/** After a restart: a saved lobby of an account room comes back in RECOVERING and reconnects its chat. */
async function restoreLobby(room) {
  try {
    const saved = await frames.loadLobby(room.id);
    if (!saved || !room.flow.recover(saved)) return;
    await platform.refresh(room.ownerId).catch(() => {});
    const actor = { kind: 'acct', userId: room.ownerId, live: true };
    room.restoring = null; // later changes are saved again
    await startPreparation(room, actor, saved.platform || '');
  } catch (err) { console.warn('[lobby] restore', err?.message); }
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
    const base = baseFor(req);
    oauthStates.set(state, { userId: s.userId, platform: p, verifier, base, sessionKey: sessions.key(s.id), expires: now + OAUTH_STATE_MS });
    res.writeHead(302, { Location: providers.authorizeUrl(p, { state, challenge, base }), 'Cache-Control': 'no-store',
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
    const t = await providers.exchange(p, { code, verifier: entry.verifier, base: entry.base });
    const who = await providers.identity(p, t.accessToken);
    if (p === 'tiktok' && t.platformUserId && t.platformUserId !== who.platformUserId) throw new OAuthError('mismatch', 'userinfo');
    const { previousOwners } = await platform.saveOAuthLink(s.userId, p, { platformUserId: who.platformUserId, handle: who.handle, displayName: who.displayName, avatar: who.avatar,
      scope: t.scope, accessTokenEnc: tokenBox.seal(t.accessToken), refreshTokenEnc: tokenBox.seal(t.refreshToken), expiresAt: t.expiresAt, refreshExpiresAt: t.refreshExpiresAt });
    for (const r of rooms.values()) if (previousOwners.includes(r.ownerId) && r.engine.connection.platform === p) r.revokeStream('ارتبط هذا الحساب بحساب سبونج لايف آخر');
    return back('linked=' + p);
  } catch (err) {
    console.warn('[oauth]', p, err.code || '', String(err.message).slice(0, 120));
    return back('link_error=' + (err.code === 'network' ? 'network' : 'failed') + '&p=' + p);
  }
}
/* ------------------------------------------------ «المتابعة باستخدام Google» (OpenID Connect, code flow)
   GET /api/oauth/google/start?mode=login|link|reauth&next=…&remember=1 → Google → GET /api/oauth/google/callback
   state: single use, 10 minutes, bound to this browser (og_bind cookie) — two tabs can sign in at once;
   nonce + PKCE; the account is found by Google's subject ID only. */
/** The games list (no separate studio): every game opens from here. */
const GAMES_LIST = '/games';
const GOOGLE_MODES = new Set(['login', 'link', 'reauth']);
const googleLimiter = new RateLimiter({ limit: 30, windowMs: 10 * 60_000 });
/** Same e-mail, exactly, and verified by Google → the existing account (Google linked to it). If that account's e-mail
 *  had never been confirmed, its other sessions end: whoever created it with this address no longer stays signed in. */
async function autoLinkGoogle(g, req) {
  const hit = await platform.linkByExactEmail(g);
  if (!hit) return null;
  if (!hit.wasVerified) sessions.destroyUser(hit.user.id);
  economy?.settleReferral(hit.user.id).catch(() => {});
  await platform.audit('user:' + hit.user.id, 'google-auto-link', { target: hit.user.id, emailWasVerified: hit.wasVerified, ip: clientIp(req) }).catch(() => {});
  return hit.user;
}
const pendingGoogle = new Map(); // id -> { g, expires }: a Google identity waiting for the password of the account with its e-mail
const safeNext = (n) => (typeof n === 'string' && /^\/(account|game\/|games|admin|u\/|go\/|tools|event|#games)(?:[/?#A-Za-z0-9_=&.%-]*)$/.test(n) && !n.startsWith('//') ? n : '');
async function handleGoogleOAuth(step, req, res, url) {
  const secure = isHttps(req) ? '; Secure' : '';
  const go = (to, cookies = []) => { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) }); res.end(); };
  const fail = (mode, code, next = '') => go(mode === 'login' ? '/login?google_error=' + code + (next ? '&next=' + encodeURIComponent(next) : '') : '/account?google_error=' + code + '#settings');
  if (!platform) return fail('login', 'unavailable');
  if (step === 'start') {
    const mode = GOOGLE_MODES.has(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'login';
    const next = safeNext(url.searchParams.get('next') || '');
    if (!googleOAuth.enabled) return fail(mode, 'unavailable', next);
    if (!googleLimiter.hit('g:' + clientIp(req))) return fail(mode, 'busy', next);
    const s = accountSession(req);
    if (mode !== 'login' && !s) return go('/login?next=' + encodeURIComponent('/account#settings'));
    // linking adds a way into the account: the account owner confirms first (password or Google again)
    if (mode === 'link' && String(platform.cached(s.userId)?.user?.password_hash || '').startsWith('scrypt$') && !sessions.reauthed(s.id)) return fail(mode, 'reauth');
    const now = Date.now();
    for (const [k, v] of oauthStates) if (v.expires < now) oauthStates.delete(k);
    if (oauthStates.size > 5000) return fail(mode, 'busy', next);
    let bind = parseCookies(req.headers.cookie).og_bind || '';
    if (!/^[A-Za-z0-9_-]{24}$/.test(bind)) bind = randomBytes(18).toString('base64url');
    const state = randomBytes(24).toString('base64url'), nonce = randomBytes(18).toString('base64url'), { verifier, challenge } = pkcePair();
    const redirectUri = baseFor(req) + '/api/oauth/google/callback';
    oauthStates.set(state, { platform: 'google', mode, bind, verifier, nonce, redirectUri, next, remember: url.searchParams.get('remember') !== '0',
      userId: s?.userId || null, sessionKey: s ? sessions.key(s.id) : null, expires: now + OAUTH_STATE_MS });
    const hint = s && mode !== 'login' ? platform.cached(s.userId)?.user?.email || '' : '';
    return go(googleOAuth.authorizeUrl({ redirectUri, state, challenge, nonce, loginHint: mode === 'reauth' ? hint : '' }),
      [`og_bind=${bind}; HttpOnly; Path=/api/oauth/google/; Max-Age=900; SameSite=Lax${secure}`]);
  }
  // callback: one use of the state, the same browser, within 10 minutes
  const state = url.searchParams.get('state') || '', entry = oauthStates.get(state);
  oauthStates.delete(state);
  const bind = parseCookies(req.headers.cookie).og_bind || '';
  if (!entry || entry.platform !== 'google') return fail('login', 'state');
  const { mode, next } = entry;
  if (entry.expires < Date.now()) return fail(mode, 'expired', next);
  if (!bind || bind !== entry.bind) return fail(mode, 'state', next);
  const gErr = url.searchParams.get('error');
  if (gErr) return fail(mode, gErr === 'access_denied' ? 'cancelled' : 'denied', next);
  let g;
  try { g = await googleOAuth.exchange({ code: url.searchParams.get('code') || '', codeVerifier: entry.verifier, redirectUri: entry.redirectUri, nonce: entry.nonce }); }
  catch (err) { console.warn('[google] callback:', String(err.message).slice(0, 120)); return fail(mode, err.code === 'expired' ? 'expired' : /nonce|signature|issuer|audience|expired|subject|malformed|algorithm|key/.test(err.message) ? 'verify' : 'temporary', next); }
  try {
    if (mode !== 'login') {
      const s = accountSession(req);
      if (!s || s.userId !== entry.userId || sessions.key(s.id) !== entry.sessionKey) return fail(mode, 'state');
      if (mode === 'reauth') {
        const me = platform.cached(s.userId).user;
        if (!me.google_sub || me.google_sub !== g.sub) return fail(mode, 'other_google');
        sessions.markReauth(s.id);
        return go('/account?reauth=ok#settings');
      }
      const owner = await platform.findByGoogle(g.sub);
      if (owner && owner.id !== s.userId) return fail(mode, 'taken');
      if (platform.cached(s.userId).user.google_sub && platform.cached(s.userId).user.google_sub !== g.sub) return fail(mode, 'other_google');
      await platform.linkGoogle(s.userId, g); economy?.settleReferral(s.userId).catch(() => {});
      await platform.audit('user:' + s.userId, 'google-link', { target: s.userId }).catch(() => {});
      return go('/account?google=linked#settings');
    }
    let user = await platform.findByGoogle(g.sub), created = false;
    if (!user) user = await autoLinkGoogle(g, req);
    if (!user) {
      if (!g.email) return fail(mode, 'no_email', next);
      if (await platform.findByEmail(g.email)) {
        // an account with this e-mail exists but is not linked: never merge on the e-mail alone. Its password proves
        // ownership; then this Google identity is linked to it (the account, its SPG ID and everything in it stay).
        const id = randomBytes(18).toString('base64url');
        for (const [k, v] of pendingGoogle) if (v.expires < Date.now()) pendingGoogle.delete(k);
        pendingGoogle.set(id, { g, expires: Date.now() + 10 * 60_000 });
        return go('/login?google_error=link_needed' + (next ? '&next=' + encodeURIComponent(next) : ''), [`g_pending=${id}; HttpOnly; Path=/api/auth/; Max-Age=600; SameSite=Lax${secure}`]);
      }
      user = await platform.createFromGoogle(g); created = true;
    }
    if (user.disabled_at) return fail(mode, 'disabled', next);
    await platform.refresh(user.id);
    const old = sessionOf(req); if (old) sessions.destroy(old.id);
    setSession(res, req, sessions.create('acct', { userId: user.id, remember: entry.remember, device: deviceLabel(req) }), entry.remember ? REMEMBER_S : 0);
    await platform.touchLogin(user.id, { picture: g.picture }).catch(() => {});
    if (created) await afterSignup(req, res, user.id); else await afterLogin(req, res, user.id);
    const a = accountView(user.id);
    res.writeHead(302, { Location: next || (created ? '/account?welcome=1' : GAMES_LIST), 'Cache-Control': 'no-store' });
    return res.end();
  } catch (err) {
    console.warn('[google] sign-in:', String(err.message).slice(0, 120));
    return fail(mode, err.status === 409 ? 'taken' : 'temporary', next);
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
      at: Date.parse(String(req.headers['kick-event-message-timestamp'] || ev.created_at || '')) || 0,
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
    return json(res, 200, { ok: true, access: 'owner', next: GAMES_LIST });
  }
  const promo = promos.redeem(code);
  if (!promo && platform) {
    // A free-trial code: it works only for the account it was made for, while that account is signed in.
    const trial = await platform.findTrialCode(code);
    const acct = accountSession(req);
    if (trial && acct && trial.user_id === acct.userId) {
      try { await platform.activateTrial(acct.userId, { code, ip }); return json(res, 200, { ok: true, access: 'account', trial: true, next: GAMES_LIST }); }
      catch (err) { if (err instanceof PlatformError) return json(res, err.status, { error: err.message }); throw err; }
    }
    if (trial && !acct) return json(res, 401, { error: 'هذا رمز تجربة مجانية: سجّل الدخول بالحساب الذي حصل عليه ثم أدخله مجددًا', login: true });
    // A subscription voucher (SHFQ-… / AMIR-…): it adds its plan to the signed-in account.
    const voucher = trial ? null : await platform.findVoucher(code);
    if (voucher && !acct) return json(res, 401, { error: 'هذا رمز اشتراك: سجّل الدخول أو أنشئ حسابًا ثم أدخله مجددًا ليُضاف الاشتراك إلى حسابك', login: true, voucher: true });
    if (voucher) {
      try { const r = await platform.redeemVoucher(acct.userId, code); return json(res, 200, { ok: true, access: 'account', voucher: r, next: GAMES_LIST }); }
      catch (err) { if (err instanceof PlatformError) return json(res, err.status, { error: err.message }); throw err; }
    }
  }
  if (!promo) { await new Promise((r) => setTimeout(r, 350)); return json(res, 401, { error: 'الرمز غير صحيح أو انتهت صلاحيته' }); }
  if (old) sessions.destroy(old.id);
  setSession(res, req, sessions.create('promo', { room: roomId('p'), codeId: promo.id, level: promo.level }), 30 * 86400);
  return json(res, 200, { ok: true, access: 'promo', level: promo.level, next: GAMES_LIST });
}

async function handleAccount(action, req, res) {
  const ip = clientIp(req);
  if (action === 'me' && req.method === 'GET') return json(res, 200, meFor(req));
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'طلب من مصدر غير مسموح' }); } catch { return json(res, 403, { error: 'طلب غير صالح' }); } }
  const body = await readBody(req).catch(() => null);
  if (!body) return json(res, 400, { error: 'طلب غير صالح' });
  if ((action === 'register' || action === 'guest') && !OPEN_SIGNUP) return json(res, 403, { error: 'الدخول يتم بالرمز الترويجي' });
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
    return json(res, 200, { ok: true, message: 'استعادة كلمة المرور تتم عبر فريق سبونج لايف: تواصل معنا باسم المستخدم أو البريد المسجل وسنعيد تعيينها لك.', support });
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
const findLimiter = new RateLimiter({ limit: 20, windowMs: 60_000 });
const clearCookie = (req, res) => res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
const platformOff = (res) => json(res, 503, { error: 'الحسابات غير مفعّلة على هذا الخادم بعد (قاعدة البيانات غير مهيأة). يمكنك الدخول بالرمز الترويجي.', disabled: true });
const pErr = (res, err) => { if (err instanceof PlatformError || err instanceof EconomyError) return json(res, err.status, { error: err.message, ...(err.fields ? { fields: err.fields } : {}) }); throw err; };

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
    return json(res, 200, { enabled: true, clientId: google.clientId, nonce, codeFlow: googleOAuth.enabled });
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
      await afterSignup(req, res, u.id);
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
      await afterLogin(req, res, u.id);
      // «ربط Google بعد إثبات الملكية»: a Google identity that found this account's e-mail waits here for its password
      let googleLinked = false;
      const pid = parseCookies(req.headers.cookie).g_pending, pend = pid && pendingGoogle.get(pid);
      if (pend) {
        pendingGoogle.delete(pid); appendCookie(res, `g_pending=; HttpOnly; Path=/api/auth/; Max-Age=0; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`);
        if (pend.expires > Date.now() && canonicalEmail(pend.g.email) === u.canonical_email && !(await platform.findByGoogle(pend.g.sub))) {
          try { await platform.linkGoogle(u.id, pend.g); googleLinked = true; platform.audit('user:' + u.id, 'google-link', { target: u.id, details: { via: 'password' } }).catch(() => {}); } catch {}
        }
      }
      const a = accountView(u.id);
      return json(res, 200, { ok: true, account: a, googleLinked, next: GAMES_LIST });
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
      let user = await platform.findByGoogle(g.sub), created = false;
      if (!user && current && body.link === true) { user = await platform.linkGoogle(current.userId, g); economy?.settleReferral(user.id).catch(() => {}); }
      if (!user) user = await autoLinkGoogle(g, req);
      if (!user) {
        if (await platform.findByEmail(g.email)) return json(res, 409, { error: 'يوجد حساب سبونج لايف بهذا البريد. سجّل الدخول بكلمة المرور، ثم اربط Google من صفحة «حسابي» — لا نربط الحسابات تلقائيًا بالبريد وحده.', needsLink: true });
        user = await platform.createFromGoogle(g);
        created = true;
      }
      if (user.disabled_at) return json(res, 403, { error: 'هذا الحساب موقوف. تواصل مع الدعم.' });
      await platform.refresh(user.id);
      const old = sessionOf(req); if (old) sessions.destroy(old.id);
      setSession(res, req, sessions.create('acct', { userId: user.id, remember: body.remember !== false, device: deviceLabel(req) }), body.remember !== false ? REMEMBER_S : 0);
      await platform.touchLogin(user.id, { picture: g.picture }).catch(() => {});
      if (created) await afterSignup(req, res, user.id); else await afterLogin(req, res, user.id);
      const a = accountView(user.id);
      return json(res, 200, { ok: true, account: a, next: GAMES_LIST });
    }
    if (action === 'forgot') {
      if (!authLimiter.hit('forgot:' + ip)) return json(res, 429, { error: 'محاولات كثيرة. انتظر قليلًا ثم حاول.' });
      await platform.requestPasswordReset(body.identifier, baseFor(req));
      // the same answer whether or not the account exists
      return json(res, 200, { ok: true, mail: !!platform.mail.configured, support: { url: siteConfig().support?.url || WHATSAPP_URL } });
    }
    if (action === 'reset') {
      if (!authLimiter.hit('reset:' + ip)) return json(res, 429, { error: 'محاولات كثيرة. انتظر قليلًا ثم حاول.' });
      if (String(body.password || '') !== String(body.confirm || '')) return json(res, 400, { error: 'كلمتا المرور غير متطابقتين', fields: { confirm: 'غير متطابقة' } });
      const u = await platform.resetPassword(String(body.token || ''), String(body.password || ''));
      sessions.destroyWhere((x) => x.userId === u.id); // every device signs in again with the new password
      return json(res, 200, { ok: true, next: '/login?reset=1' });
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
    if (action === 'wallet' && req.method === 'GET') return json(res, 200, await economy.wallet(userId));
    if (action === 'wheel' && req.method === 'GET') return json(res, 200, await economy.wheel(userId));
    if (action === 'store' && req.method === 'GET') return json(res, 200, await economy.store(userId));
    if (action === 'coins-order' && req.method === 'GET') return json(res, 200, await economy.orderStatus(userId, new URL(req.url, 'http://x').searchParams.get('id')));
    if (action === 'wheel-result' && req.method === 'GET') { const r = await economy.spinByKey(userId, new URL(req.url, 'http://x').searchParams.get('key')); return r ? json(res, 200, r) : json(res, 404, { error: 'لم تُسجَّل هذه العملية' }); }
    if (action === 'invites' && req.method === 'GET') { const u = platform.cached(userId).user; return json(res, 200, await economy.invitations(userId, u.public_id, appUrl)); }
    if (action === 'skins' && req.method === 'GET') return json(res, 200, await platform.skins(userId));
    if (action === 'frames' && req.method === 'GET') return json(res, 200, await frames.list(userId));
    if (action === 'friends' && req.method === 'GET') return json(res, 200, await platform.community(userId));
    if (action === 'find' && req.method === 'GET') {
      if (!findLimiter.hit('find:' + userId)) return json(res, 429, { error: 'بحث كثير — انتظر دقيقة' });
      const m = await platform.findMember(userId, new URL(req.url, 'http://x').searchParams.get('id'));
      return m ? json(res, 200, { member: m }) : json(res, 404, { error: 'لا يوجد حساب بهذا المعرف' });
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
    /* ---- «عملات الإسفنجة»: nothing about amounts or timing is read from the browser ---- */
    // the price is never read from the browser: only the package id and the age confirmation
    if (action === 'coins-order') return json(res, 200, { ok: true, ...(await economy.createOrder(userId, body.package, { adult: body.adult === true })) });
    if (action === 'coins-cancel') return json(res, 200, { ok: true, ...(await economy.cancelOrder(userId, body.ref)) });
    if (action === 'wheel-spin') { const r = await economy.spin(userId, body.count, body.key); return json(res, 200, { ok: true, ...r }); }
    if (action === 'daily-claim') { const r = await economy.claimDaily(userId); if (r.granted) await afterLogin(req, res, userId); return json(res, 200, { ok: true, ...r }); }
    /* ---- «السكنات» (the skin id is the only input; ownership is checked on the server) ---- */
    if (action === 'skin-claim') return json(res, 200, { ok: true, ...(await platform.claimSkin(userId, body.id)) });
    if (action === 'skin-equip') return json(res, 200, { ok: true, ...(await platform.equipSkin(userId, body.id)) });
    if (action === 'frame-claim') { const r = await frames.claim(userId, body.id); frameCache.clear(); return json(res, 200, { ok: true, ...r }); }
    if (action === 'frame-equip') { const r = await frames.equip(userId, body.id === null ? null : String(body.id || '')); frameCache.clear(); for (const room of rooms.values()) room.scheduleBroadcast(); return json(res, 200, { ok: true, ...r }); }
    if (action === 'skin-buy') { await economy.buySkin(userId, body.id); return json(res, 200, { ok: true, ...(await platform.skins(userId)), wallet: await economy.wallet(userId) }); }
    /* ---- «المجتمع» (the other account is named only by its SPG ID; who I am comes from the session) ---- */
    if (action === 'friend-request') return json(res, 200, { ok: true, ...(await platform.friendRequest(userId, body.id)) });
    if (action === 'friend-accept') return json(res, 200, { ok: true, ...(await platform.friendRespond(userId, body.id, true)) });
    if (action === 'friend-decline') return json(res, 200, { ok: true, ...(await platform.friendRespond(userId, body.id, false)) });
    if (action === 'friend-remove') return json(res, 200, { ok: true, ...(await platform.friendRemove(userId, body.id)) });
    if (action === 'block') return json(res, 200, { ok: true, ...(await platform.block(userId, body.id)) });
    if (action === 'unblock') return json(res, 200, { ok: true, ...(await platform.unblock(userId, body.id)) });
    if (action === 'report') return json(res, 200, await platform.report(userId, body.id, String(body.reason || ''), body.note));
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
    if (action === 'trial-start') { const r = await platform.startTrial(userId, { ip }); return json(res, 200, { ok: true, ...r, next: GAMES_LIST, account: accountView(userId) }); }
    if (action === 'link-google') {
      if (!google.enabled) return json(res, 503, { error: 'تسجيل الدخول باستخدام Google غير مفعّل بعد' });
      let g;
      try { g = await google.verify(String(body.credential || ''), { nonce: parseCookies(req.headers.cookie).g_nonce || '' }); }
      catch { return json(res, 401, { error: 'تعذر التحقق من حساب Google' }); }
      await platform.linkGoogle(userId, g); economy?.settleReferral(userId).catch(() => {});
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
    const purchaseId = /^[0-9a-f-]{36}$/i.test(String(data.metadata?.purchase_id || '')) ? data.metadata.purchase_id : null;
    let r;
    if (purchaseId) r = await economy.confirmPurchase({ purchaseId });          // Sponge Coins order
    else if (paymentId) r = await platform.confirmPayment({ paymentId });      // subscription
    else if (ref) { r = await platform.confirmPayment({ providerRef: ref }); if (r.status === 'unknown') r = await economy.confirmPurchase({ providerRef: ref }); }
    else r = { status: 'ignored' };
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
      if (action === 'reports') return json(res, 200, { reports: await platform.listReports(url.searchParams.get('status') || 'open') });
      if (action === 'economy') return json(res, 200, await economy.adminOverview());
      if (action === 'wheel') return json(res, 200, await economy.wheelReport());
      if (action === 'skins') return json(res, 200, { skins: await platform.adminSkins() });
      if (action === 'frames') return json(res, 200, { frames: await frames.admin() });
      if (action === 'purchases') return json(res, 200, { purchases: await economy.adminPurchases(url.searchParams.get('status') || ''), packages: await economy.packages() });
      if (action === 'codes') return json(res, 200, { codes: promos.list(), levels: PROMO_LEVELS, vouchers: await platform.voucherStats() });
      return json(res, 404, { error: 'Not found' });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    const body = await readBody(req, action === 'partner-save' ? 600_000 : action === 'skin-upload' ? 6_200_000 : action === 'frame-save' ? 900_000 : 4096);
    if (action === 'partner-save') { const partners = await platform.savePartner(body); await platform.audit(admin.name, 'partner-save', { details: { name: String(body.name || '').slice(0, 40) }, ip }); return json(res, 200, { ok: true, partners }); }
    if (action === 'partner-delete') { const partners = await platform.deletePartner(body.id); await platform.audit(admin.name, 'partner-delete', { details: { id: body.id }, ip }); return json(res, 200, { ok: true, partners }); }
    if (action === 'prize-save') { const r = await platform.savePrize(body); await platform.audit(admin.name, 'prize-save', { details: { title: String(body.title || '').slice(0, 80) }, ip }); return json(res, 200, { ok: true, ...r }); }
    if (action === 'report-status') { const r = await platform.setReportStatus(body.id, String(body.status || '')); await platform.audit(admin.name, 'report-status', { details: { id: body.id, status: body.status }, ip }); return json(res, 200, r); }
    if (action === 'award-status') { const r = await platform.setAwardStatus(body.id, String(body.status || '')); await platform.audit(admin.name, 'award-status', { details: { id: body.id, status: body.status }, ip }); return json(res, 200, { ok: true, ...r }); }
    if (action === 'code-create') { const code = promos.create(body); await platform.audit(admin.name, 'promo-create', { details: { id: code.id, label: code.label, level: code.level, maxUses: code.maxUses }, ip }); return json(res, 200, { ok: true, code }); }
    if (action === 'voucher-create') { const codes = await platform.createVouchers(String(body.plan), body.count, { label: body.label, createdBy: admin.name }); await platform.audit(admin.name, 'voucher-create', { details: { plan: body.plan, count: codes.length, label: String(body.label || '').slice(0, 60) }, ip }); return json(res, 200, { ok: true, codes }); }
    if (action === 'voucher-revoke') { const r = await platform.revokeVoucher(String(body.code || '')); await platform.audit(admin.name, 'voucher-revoke', { details: { hint: String(body.code).slice(0, 4) + '…' + String(body.code).slice(-4) }, ip }); return json(res, 200, { ok: true, ...r }); }
    if (action === 'code-revoke') { const code = promos.update(String(body.id), { active: false }); sessions.destroyWhere((x) => x.codeId === body.id); await platform.audit(admin.name, 'promo-revoke', { details: { id: body.id }, ip }); return json(res, 200, { ok: true, code }); }
    if (action === 'skin-save') { const skins = await platform.saveSkin(body); await platform.catalog(true); return json(res, 200, { ok: true, skins }); }
    if (action === 'skin-upload') { const skins = await platform.uploadSkin(body); await platform.catalog(true); return json(res, 200, { ok: true, skins }); }
    if (action === 'frame-save') { const frame = await frames.save(body); frameCache.clear(); await platform.audit(admin.name, 'frame-save', { details: { id: frame.id, name: frame.name, active: frame.active }, ip }); return json(res, 200, { ok: true, frame }); }
    if (action === 'order-decide') return json(res, 200, { ok: true, ...(await economy.decideOrder(body.ref, String(body.decision || ''), { actor: admin.name, reason: body.reason })) });
    if (action === 'wheel-odds') return json(res, 200, { ok: true, config: await economy.setWheelOdds(body.odds, { cost1: body.cost1, cost10: body.cost10, actor: admin.name, reason: body.reason }) });
    if (action === 'wheel-simulate') return json(res, 200, await economy.simulate(body.n));
    const userId = await platform.userByPublicId(body.publicId || '');
    if (!userId) return json(res, 404, { error: 'لا يوجد حساب بهذا المعرف' });
    const log = (what, details = {}) => platform.audit(admin.name, what, { target: userId, details, ip });
    if (action === 'wallet-adjust') { const w = await economy.adjust(userId, { amount: Number(body.amount), bucket: body.bucket === 'purchased' ? 'purchased' : 'earned', reason: body.reason, actor: admin.name }); await log('wallet-adjust', { amount: Number(body.amount), reason: String(body.reason || '').slice(0, 200) }); return json(res, 200, { ok: true, wallet: w }); }
    if (action === 'referral-decide') { const r = await economy.decideReferral(userId, body.approve === true, admin.name, body.reason); return json(res, 200, { ok: true, result: r }); }
    if (action === 'password-reset-link') { const t = await platform.createPasswordReset(userId); await log('password-reset-link'); return json(res, 200, { ok: true, link: baseFor(req) + '/reset?token=' + t, expiresInMinutes: 30 }); }
    if (action === 'frame-grant') { const r = await frames.grant(userId, body.frame, admin.name); frameCache.clear(); await log('frame-grant', { frame: String(body.frame || '').slice(0, 32) }); return json(res, 200, r); }
    if (action === 'skin-grant') { const r = await platform.grantSkin(userId, body.skin, admin.name); await log('skin-grant', { skin: String(body.skin || '').slice(0, 32) }); return json(res, 200, r); }
    if (action === 'grant') { const r = await platform.grant(userId, body); await log('subscription-grant', { days: Number(body.days), plan: body.plan || 'manual', note: String(body.note || '').slice(0, 200) }); return json(res, 200, { ok: true, access: r }); }
    if (action === 'extend') { const r = await platform.extend(userId, body); await log('subscription-extend', { days: Number(body.days) }); return json(res, 200, { ok: true, access: r }); }
    if (action === 'stop') { const r = await platform.stop(userId); await log('subscription-stop', r); return json(res, 200, { ok: true, ...r }); }
    if (action === 'verify') { await platform.setVerified(userId); await economy?.settleReferral(userId).catch(() => {}); await log('email-verify-manual'); return json(res, 200, { ok: true }); }
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
      // registration open: viewers join by typing the room's join word in the stream comments (shown on the overlay too)
      joinOpen: st.state === 'waiting', ...(st.state === 'waiting' && s.registration?.keyword ? { keyword: String(s.registration.keyword).slice(0, 32) } : {}),
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

const STATIC = new Set(['setup.css','games.html','games.js','games.css','game-icons.svg','profile.html','profile.js','dash.css','index.html','home.html','home.js','home.css','pages.css','auth.html','auth.js','me.html','me.js','admin.html','admin.js','privacy.html','terms.html','refund.html','google.js','studio.html','studio.js','studio.css','event.html','event.js','event.css','bomb.html','bomb.js','bomb.css','draw.html','draw.js','draw.css','play.html','play.js','play.css','role.html','role.js','sponge.css','sponge.js','sponge-ui.js','sponge-mark.svg','seafloor.svg','draw-mark.svg','icons.svg','royal-core.css','royal-studio.css','royal-broadcast.css','royal-luxe.css','royal-arena.css','royal-dash.css','aurum.css','aurum.js','session.js','account.js','account.css','mascot.js','overlay.html','app.js','overlay.js','favicon.svg','tools.html','tools.js','tools.css','tool.html','tool.js','tool.css','guide-games.html','guide-tiktok.html','guide-tools.html','skin-viewer.js','bottom-nav.js','bottom-nav.css','coins.js','coins.css','wheel.js','wheel.css','store.js','store.css','admin-economy.js','frames.js','frames.css','lobby.css','me-frames.js','game-ui.css','auth.css',
  ...ALL_GAMES.map((g) => g.cover.slice(1)),
  // game art, legacy covers and flags: every file in these folders is public
  ...['cards', 'covers', 'flags', 'brand'].flatMap((dir) => { try { return fs.readdirSync(path.join(here, 'public', dir)).filter((f) => /^[\w.-]+\.(png|webp|svg|txt)$/.test(f)).map((f) => dir + '/' + f); } catch { return []; } }),
  // 3D skins (optimized GLB + poster) and the pinned, self-hosted three.js (no CDN — the CSP allows only 'self')
  ...['skins', 'vendor/three'].flatMap((dir) => { try { return fs.readdirSync(path.join(here, 'public', dir)).filter((f) => /^[\w.-]+\.(glb|webp|js|txt)$/.test(f)).map((f) => dir + '/' + f); } catch { return []; } }),
  'fonts/tajawal-arabic-500-normal.woff2','fonts/tajawal-arabic-700-normal.woff2','fonts/tajawal-arabic-800-normal.woff2','fonts/tajawal-latin-700-normal.woff2','fonts/inter-display-light.woff','fonts/inter-display-semibold.woff','fonts/OFL.txt',
  'fonts/noto-kufi-arabic-700.woff','fonts/ibm-plex-arabic-400.woff','fonts/ibm-plex-arabic-600.woff','fonts/ibm-plex-arabic-700.woff','fonts/readex-pro-700.woff','fonts/OFL-library-fonts.txt']);

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
    // «المتجر» on the home page: the public coin price list (the only thing sold), read from coin_packages
    if (url.pathname === '/api/store/packages' && req.method === 'GET') return json(res, 200, { packages: economy ? await economy.packages() : [], dailyReward: DAILY_REWARD, referralReward: REFERRAL_REWARD, referralCap: REFERRAL_CAP });
    if (url.pathname === '/api/site' && req.method === 'GET') return json(res, 200, { ...siteConfig(), updates: UPDATES, plans: PLANS, gameSettings: settingsSchema(), joinWords: JOIN_WORD_SUGGESTIONS, lateJoinModes: LATE_JOIN_MODES });
    if (url.pathname.startsWith('/api/u/') && req.method === 'GET') {
      if (!platform) return json(res, 404, { error: 'غير موجود' });
      const p = await platform.publicProfile(decodeURIComponent(url.pathname.slice(7)), accountSession(req)?.userId || null);
      return p ? json(res, 200, p) : json(res, 404, { error: 'لا يوجد حساب بهذا المعرف' });
    }
    const fu = /^\/frames\/u\/([a-z0-9_]{2,32})-(avatar|plate)\.(png|webp)$/.exec(url.pathname);
    if (fu && req.method === 'GET' && frames) {
      const f = await frames.file(fu[1], fu[2]);
      if (!f) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': url.searchParams.get('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Length': f.data.length });
      return res.end(f.data);
    }
    const up = /^\/skins\/u\/([a-z0-9_]{2,32})\.(glb|webp)$/.exec(url.pathname);
    if (up && req.method === 'GET' && platform) {
      const f = await platform.skinFile(up[1], up[2] === 'glb' ? 'model' : 'thumb');
      if (!f) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': url.searchParams.get('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Length': f.data.length });
      return res.end(f.data);
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
    { const m = /^\/api\/oauth\/google\/(start|callback)$/.exec(url.pathname); if (m && req.method === 'GET') return await handleGoogleOAuth(m[1], req, res, url); }
    if (url.pathname === '/api/kick/webhook' && req.method === 'POST') return await handleKickWebhook(req, res);
    if (url.pathname.startsWith('/api/me/')) return await handleMe(url.pathname.slice('/api/me/'.length), req, res);
    if (url.pathname.startsWith('/api/manage/')) return await handleManage(url.pathname.slice('/api/manage/'.length), req, res);
    if (url.pathname === '/api/billing/webhook' && req.method === 'POST') return await handleWebhook(req, res);
    if (url.pathname === '/verify' && req.method === 'GET') {
      const user = platform ? await platform.verifyEmail(url.searchParams.get('token') || '') : null;
      if (user && economy) await economy.settleReferral(user.id).catch((err) => console.warn('[economy] referral', err.message));
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
      if (tab && action !== 'heartbeat' && actor.room.hostTab() && actor.room.primaryTab !== tab) return json(res, 409, { error: 'اللعبة مفتوحة في نافذة أخرى — اضغط «التحكم من هنا» لنقل التحكم إلى هذه النافذة', otherWindow: true });
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
  // Bottom navigation (bottom-nav.js): the server picks the destination from the session — never the page.
  //   /go/studio, /go/games → the games list (every game is free; a game asks for sign-in when opened).
  //   /go/profile|community|bag|challenge → that section of «لوحة التحكم», or sign-in that comes back to it.
  if (url.pathname.startsWith('/go/')) {
    const target = url.pathname.slice(4), SECTION = { profile: 'profile', community: 'community', bag: 'bag', challenge: 'challenge' };
    let to = null;
    if (target === 'studio' || target === 'games') to = GAMES_LIST;
    else if (SECTION[target]) { const dest = '/account#' + SECTION[target]; to = accountSession(req) ? dest : '/login?next=' + encodeURIComponent(dest); }
    if (!to) return json(res, 404, { error: 'Not found' });
    res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); return res.end();
  }
  // No separate studio: a game opens on its own page — settings, then the waiting room, then the round.
  // /studio and the host side of /play (old links and bookmarks) lead to that game, or to the games list.
  const gameOf = (m) => (ALL_GAMES.some((x) => x.mode === m) ? m : null);
  if (url.pathname === '/studio' || (url.pathname === '/play' && !url.searchParams.has('room'))) {
    const m = gameOf(url.searchParams.get('mode'));
    res.writeHead(302, { Location: m ? '/game/' + m : GAMES_LIST, 'Cache-Control': 'no-store' }); return res.end();
  }
  const gamePage = url.pathname.match(/^\/game\/([a-z]{2,20})$/);
  if (gamePage && !gameOf(gamePage[1])) return json(res, 404, { error: 'Not found' });
  // Host pages need a signed-in session (any account — every game is free —, the owner or a promo code). Viewers keep /overlay, /play?room and /role.
  const HOST_PAGES = new Set(['/dashboard', '/event', '/bomb', '/tools']);
  if (gamePage || HOST_PAGES.has(url.pathname)) {
    if (!actorFor(req)) { res.writeHead(302, { Location: '/login?next=' + encodeURIComponent(url.pathname + url.search), 'Cache-Control': 'no-store' }); return res.end(); }
  }
  // invitation links (/signup?ref=SPG-XXXXXX): remembered for 30 days until an account is created here
  if ((url.pathname === '/signup' || url.pathname === '/login') && /^SPG-[A-HJ-NP-Z2-9]{6}$/i.test(url.searchParams.get('ref') || '') && !accountSession(req))
    appendCookie(res, `sl_ref=${url.searchParams.get('ref').toUpperCase()}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${isHttps(req) ? '; Secure' : ''}`);
  if ((url.pathname === '/login' || url.pathname === '/signup') && accountSession(req)) {
    const intent = url.searchParams.get('intent'), next = url.searchParams.get('next') || '';
    const a = accountView(accountSession(req).userId);
    const to = /^\/(account|game\/[a-z]+|admin)(?:[/?#]|$)/.test(next) ? next : intent === 'studio' || intent === 'trial' ? GAMES_LIST : '/account';
    res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); return res.end();
  }
  if (url.pathname === '/admin' && !adminActor(req)) { res.writeHead(302, { Location: '/login?next=/admin', 'Cache-Control': 'no-store' }); return res.end(); }
  if (url.pathname === '/account' && !accountSession(req)) { res.writeHead(302, { Location: '/login?next=/account' + encodeURIComponent(url.search), 'Cache-Control': 'no-store' }); return res.end(); }
  const fileMap = { '/': 'home.html', '/games': 'games.html', '/signup': 'auth.html', '/login': 'auth.html', '/forgot': 'auth.html', '/reset': 'auth.html', '/account': 'me.html', '/admin': 'admin.html', '/privacy': 'privacy.html', '/terms': 'terms.html', '/refund': 'refund.html', '/event': 'event.html', '/bomb': 'bomb.html', '/dashboard': 'index.html', '/overlay': 'overlay.html', '/draw': 'draw.html', '/play': 'play.html', '/role': 'role.html', '/tools': 'tools.html', '/tool': 'tool.html', '/guide/games': 'guide-games.html', '/guide/tiktok-live': 'guide-tiktok.html', '/guide/tools': 'guide-tools.html', '/favicon.ico': 'brand/favicon-64.png', '/apple-touch-icon.png': 'brand/sponge-192.png', '/og-image.webp': 'brand/og-512.webp' };
  const relative = fileMap[url.pathname] || (gamePage ? 'studio.html' : null) || (/^\/u\/SPG-[A-Z0-9]{6}$/i.test(url.pathname) ? 'profile.html' : url.pathname.slice(1));
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
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.txt', '.json', '.glb']);
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
  // signed-in pages are never kept by the browser: after «تسجيل الخروج» the back button cannot show them again
  const cache = ['me.html', 'studio.html', 'admin.html', 'auth.html', 'index.html'].includes(relative) ? 'no-store'
    : asset.ext === '.html' ? 'no-cache'
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
server.listen(PORT, '0.0.0.0', () => console.log(`سبونج لايف ready on http://localhost:${PORT}`));
const shutdown = async () => {
  clearInterval(roundClock); clearInterval(heartbeat); clearInterval(liveSweep); clearInterval(weekCloser);
  for (const room of rooms.values()) await room.disconnectAll().catch(() => {});
  wss.close(); server.close(); server.closeIdleConnections?.();
  if (pool) { await promos.mirror?.drain(); await sessions.mirror?.drain(); await pool.end().catch(() => {}); }
};
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
