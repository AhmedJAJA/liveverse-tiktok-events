import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { WebSocketServer, WebSocket } from 'ws';
import { Engine } from './src/engine.mjs';
import { LiveBridge } from './src/bridge.mjs';
import { KickBridge, validKickSlug } from './src/kick.mjs';
import { QuestionBank, loadDefaultQuestions } from './src/question-bank.mjs';
import { siteConfig, ALL_GAMES, UPDATES } from './src/catalog.mjs';
import { AccountStore, Sessions, RateLimiter, FieldError, parseCookies, roomId, PLANS } from './src/accounts.mjs';
import { DrawHub } from './src/draw.mjs';
import { PromoStore, PROMO_LEVELS } from './src/promo.mjs';

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
class Room {
  constructor(id, kind, ownerId = null) {
    this.id = id; this.kind = kind; this.ownerId = ownerId; this.clients = new Set(); this.touched = Date.now();
    // Chat can arrive hundreds of times a second. The engine only marks the room dirty; one snapshot is
    // built, serialised once and sent to every screen at most every BROADCAST_MS (game events are never lost:
    // each broadcast carries the full current state).
    this.engine = new Engine({ lazy: true, notify: () => this.scheduleBroadcast() });
    this.flushTimer = null; this.lastFlush = 0; this.broadcasts = 0;
    this.tiktok = new LiveBridge(this.engine);
    this.kick = new KickBridge(this.engine);
    this.questionBank = new QuestionBank(questions);
  }
  view() { return { ...this.engine.snapshot(), viewers: this.clients.size }; }
  scheduleBroadcast() {
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
  async disconnectAll() { await this.tiktok.disconnect(false); await this.kick.disconnect(false); this.engine.setConnection('disconnected', '', 'تم الفصل'); }
}
const mainRoom = new Room('main', 'main');
rooms.set('main', mainRoom);
function evictIdleRooms(force = false) {
  const t = Date.now();
  for (const [id, room] of rooms) {
    if (id === 'main' || room.clients.size || ['connected', 'connecting'].includes(room.engine.connection.state)) continue;
    if (force || t - room.touched > ROOM_IDLE_MS) { room.disconnectAll().catch(() => {}); rooms.delete(id); }
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
  const owner = /^u[a-z0-9]{9}$/.test(key) ? accounts.byRoom(key) : null;
  if (owner) return ensureRoom(key, 'user', owner.id);
  // a promo-code room survives restarts as long as its session does (so OBS links keep working)
  if (/^p[a-z0-9]{9}$/.test(key) && [...sessions.map.values()].some((x) => x.room === key)) return ensureRoom(key, 'promo');
  return null;
}

/* --------------------------------------------------------------- accounts */
const accounts = new AccountStore({ file: path.join(DATA_DIR, 'users.json') });
const sessions = new Sessions({ file: path.join(DATA_DIR, 'sessions.json') });
const promos = new PromoStore({ file: path.join(DATA_DIR, 'promo-codes.json') });
// Optional bootstrap codes from the environment (comma separated); stored hashed, never in public files.
for (const code of String(process.env.SPONGE_PROMO_CODES || '').split(',').map((c) => c.trim()).filter(Boolean)) promos.seed(code);
const OPEN_SIGNUP = process.env.SKY_OPEN_SIGNUP === '1';
const redeemIp = new RateLimiter({ limit: 8, windowMs: 10 * 60_000 });
const redeemAll = new RateLimiter({ limit: 300, windowMs: 10 * 60_000 });
const authLimiter = new RateLimiter({ limit: 12, windowMs: 10 * 60_000 });
const draw = new DrawHub();
const isHttps = (req) => req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'ip';
function setSession(res, req, id, maxAge) {
  res.setHeader('Set-Cookie', `${COOKIE}=${id}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`);
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
  if (s?.kind === 'guest') return { user: null, guest: true, room: s.room, live: false };
  return { user: null, guest: false, room: null, live: false };
}

function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
async function readBody(req, limit = 16384) {
  let size = 0, bytes = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('الطلب كبير جدًا'); bytes.push(chunk); }
  try { return JSON.parse(Buffer.concat(bytes).toString('utf8') || '{}'); }
  catch { throw new Error('JSON غير صالح'); }
}
function secureHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: https://*.tiktokcdn.com https://*.tiktokcdn-us.com https://*.tiktokcdn-eu.com https://*.tiktokcdn-in.com https://*.byteoversea.com https://*.ibytedtos.com https://*.ibyteimg.com https://*.muscdn.com; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
}

async function handleAction(action, body, actor) {
  const { engine, questionBank } = actor.room;
  const room = actor.room;
  switch (action) {
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
    case 'bank-reset': return { ok: true, bank: questionBank.reset() };
    case 'start': engine.start(); return { ok: true };
    case 'stop': engine.stop(); return { ok: true };
    case 'reset': engine.resetScores(); return { ok: true };
    case 'draw': return { ok: true, result: engine.drawWheel() };
    case 'connect': {
      if (!actor.live) throw Object.assign(new Error(actor.kind === 'guest' ? 'ربط البث يحتاج حسابًا مشتركًا — جرّب الألعاب الآن بلاعبين تجريبيين' : 'ربط البث يحتاج اشتراكًا فعّالًا — جرّب الألعاب الآن بلاعبين تجريبيين'), { status: 403 });
      const platform = body.platform === 'kick' ? 'kick' : 'tiktok';
      if (platform === 'kick') {
        if (!validKickSlug(body.username)) throw new Error('اسم قناة Kick غير صالح');
        await room.tiktok.disconnect(false);
        await room.kick.connect(body.username, { chatroomId: body.chatroomId });
      } else {
        await room.kick.disconnect(false);
        await room.tiktok.connect(body.username);
      }
      return { ok: true };
    }
    case 'disconnect': await room.tiktok.disconnect(false); await room.kick.disconnect(false); engine.setConnection('disconnected', '', 'تم الفصل'); return { ok: true };
    case 'simulate': {
      const name = String(body.username ?? '').trim().slice(0,32);
      if (!name || !body.text) throw new Error('أدخل اسم المشاهد والتعليق');
      engine.receiveChat({ id: 'demo:' + name.toLowerCase(), username: name, text: body.text, avatar: typeof body.avatar === 'string' ? body.avatar : '', isFollower: body.isFollower === true, isSubscriber: body.isSubscriber === true });
      return { ok: true };
    }
    // Owner-only account administration (subscriptions are activated manually after payment).
    case 'accounts': requireOwner(actor); return { ok: true, accounts: accounts.list() };
    case 'promo-list': requireOwner(actor); return { ok: true, codes: promos.list(), levels: PROMO_LEVELS };
    case 'promo-create': requireOwner(actor); return { ok: true, code: promos.create(body) };
    case 'promo-update': {
      requireOwner(actor);
      const code = promos.update(body.id, body);
      if (code.status !== 'active') sessions.destroyWhere((x) => x.codeId === body.id);
      return { ok: true, code };
    }
    case 'promo-delete': requireOwner(actor); promos.remove(body.id); sessions.destroyWhere((x) => x.codeId === body.id); return { ok: true };
    case 'account-plan': requireOwner(actor); return { ok: true, account: accounts.setPlan(body.username, body.plan, body.days) };
    case 'account-password': requireOwner(actor); { await accounts.setPassword(body.username, body.password); const u = accounts.find(body.username); if (u) sessions.destroyUser(u.id); return { ok: true }; }
    default: throw new Error('الإجراء غير معروف');
  }
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

function streams() {
  const list = [];
  for (const room of rooms.values()) {
    const s = room.engine.snapshot();
    if (s.connection.state !== 'connected') continue;
    const game = ALL_GAMES.find((g) => g.mode === s.status.mode);
    list.push({ room: room.id, platform: s.connection.platform, username: s.connection.username, players: s.playerCount, active: !!s.status.active,
      mode: s.status.mode, game: game?.title || s.status.title, cover: game?.cover || '/covers/quiz.svg' });
  }
  list.sort((a, b) => b.players - a.players);
  if (list.length > 1 && list[0].players > 0) list[0].top = true;
  return { streams: list, totalStreams: list.length, totalPlayers: list.reduce((n, s) => n + s.players, 0) };
}

const STATIC = new Set(['index.html','home.html','home.js','home.css','studio.html','studio.js','studio.css','event.html','event.js','event.css','bomb.html','bomb.js','bomb.css','draw.html','draw.js','draw.css','play.html','play.js','play.css','role.html','role.js','sponge.css','sponge.js','sponge-ui.js','sponge-mark.svg','seafloor.svg','draw-mark.svg','icons.svg','royal-core.css','royal-studio.css','royal-broadcast.css','royal-luxe.css','royal-arena.css','royal-dash.css','aurum.css','aurum.js','session.js','account.js','account.css','mascot.js','overlay.html','app.js','overlay.js','favicon.svg',
  ...ALL_GAMES.map((g) => g.cover.slice(1)),
  // game art, legacy covers and flags: every file in these folders is public
  ...['games', 'covers', 'flags', 'brand'].flatMap((dir) => { try { return fs.readdirSync(path.join(here, 'public', dir)).filter((f) => /^[\w.-]+\.(png|webp|svg|txt)$/.test(f)).map((f) => dir + '/' + f); } catch { return []; } }),
  'fonts/tajawal-arabic-500-normal.woff2','fonts/tajawal-arabic-700-normal.woff2','fonts/tajawal-arabic-800-normal.woff2','fonts/tajawal-latin-700-normal.woff2','fonts/inter-display-light.woff','fonts/inter-display-semibold.woff','fonts/OFL.txt']);

const server = http.createServer(async (req, res) => {
  secureHeaders(res);
  let url; try { url = new URL(req.url, 'http://localhost'); } catch { return json(res, 400, { error: 'Bad URL' }); }
  try {
    if (url.pathname === '/health') return json(res, 200, { ok: true, mode: mainRoom.engine.status.mode, rooms: rooms.size });
    if (url.pathname === '/api/state' && req.method === 'GET') {
      const room = publicRoom(url.searchParams.get('room'));
      return room ? json(res, 200, room.view()) : json(res, 404, { error: 'الغرفة غير موجودة' });
    }
    if (url.pathname === '/api/site' && req.method === 'GET') return json(res, 200, { ...siteConfig(), updates: UPDATES, plans: PLANS });
    if (url.pathname === '/api/streams' && req.method === 'GET') return json(res, 200, streams());
    if (url.pathname === '/api/sketch' && req.method === 'GET') { const room = publicRoom(url.searchParams.get('room')); return room ? json(res, 200, room.sketch || { data: '', v: 0 }) : json(res, 404, { error: 'الغرفة غير موجودة' }); }
    if (url.pathname.startsWith('/api/role/')) return await handleRole(url.pathname.slice('/api/role/'.length), url, req, res);
    if (url.pathname.startsWith('/api/access/')) return await handleAccess(url.pathname.slice('/api/access/'.length), req, res);
    if (url.pathname.startsWith('/api/account/')) return await handleAccount(url.pathname.slice('/api/account/'.length), req, res);
    if (url.pathname.startsWith('/api/draw/')) return await handleDraw(url.pathname.slice('/api/draw/'.length), req, res);
    if (url.pathname === '/api/admin/bank' && req.method === 'GET') { const actor = actorFor(req); return actor ? json(res, 200, actor.room.questionBank.stats()) : json(res, 401, { error: 'رمز الإدارة غير صحيح' }); }
    if (url.pathname === '/api/admin/verify' && req.method === 'POST') {
      const actor = actorFor(req);
      return json(res, actor ? 200 : 401, { ok: !!actor, ...(actor ? { kind: actor.kind, room: actor.room.id, live: actor.live } : {}) });
    }
    if (url.pathname.startsWith('/api/admin/') && req.method === 'POST') {
      if (!isAuthorized(req)) return json(res, 401, { error: 'رمز الإدارة غير صحيح' });
      const actor = actorFor(req);
      actor.room.touched = Date.now();
      try { const action = url.pathname.slice('/api/admin/'.length); const result = await handleAction(action, await readBody(req, action === 'sketch' ? 200_000 : 16384), actor); return json(res, 200, result); }
      catch (err) { return json(res, err.status || 400, { error: String(err.message || err).slice(0, 240), ...(err.fields ? { fields: err.fields } : {}) }); }
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
  const STUDIO_PAGES = new Set(['/studio', '/dashboard', '/event', '/bomb', '/play']);
  if (STUDIO_PAGES.has(url.pathname)) {
    const viewer = url.pathname === '/play' && url.searchParams.has('room');
    if (!viewer && !actorFor(req)) { res.writeHead(302, { Location: '/?next=' + encodeURIComponent(url.pathname + url.search), 'Cache-Control': 'no-store' }); return res.end(); }
    if (url.pathname === '/play' && !viewer) { res.writeHead(302, { Location: '/studio' + (url.search || ''), 'Cache-Control': 'no-store' }); return res.end(); }
  }
  const fileMap = { '/': 'home.html', '/event': 'event.html', '/bomb': 'bomb.html', '/studio': 'studio.html', '/dashboard': 'index.html', '/overlay': 'overlay.html', '/draw': 'draw.html', '/play': 'play.html', '/role': 'role.html', '/favicon.ico': 'brand/favicon-64.png', '/apple-touch-icon.png': 'brand/sponge-192.png', '/og-image.webp': 'brand/sponge-512.webp' };
  const relative = fileMap[url.pathname] || url.pathname.slice(1);
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
const heartbeat = setInterval(() => {
  for (const room of rooms.values()) for (const ws of room.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
  evictIdleRooms(); sessions.prune(); draw.cleanup();
}, 30000);
heartbeat.unref?.();
server.listen(PORT, '0.0.0.0', () => console.log(`TikTok LIVE Events ready on http://localhost:${PORT}`));
const shutdown = async () => { clearInterval(roundClock); clearInterval(heartbeat); for (const room of rooms.values()) await room.disconnectAll().catch(() => {}); wss.close(); server.close(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
