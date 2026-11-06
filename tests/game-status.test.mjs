// «قيد التطوير» — every game is stopped until it is rebuilt and released, and the server enforces it:
// the library shows it, a direct link opens the notice instead of the game, every game command answers 423, the
// WebSocket stays read-only, and only developers (owner, site admins, SKY_GAME_TESTERS) can still test a game.
// Accounts, coins, the store, frames, the bag, the community and the leaderboard are not touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { WebSocket } from 'ws';
import { GameStatus, DEV_MESSAGE, SPOTLIGHT, devError } from '../src/game-status.mjs';
import { ALL_GAMES } from '../src/catalog.mjs';

const MESSAGE = 'نعمل حالياً على تطوير هذه اللعبة لتقديم تجربة أفضل. ستعود قريباً!';

test('one switch per game: every game is under development by default, the roulette comes first', () => {
  assert.equal(DEV_MESSAGE, MESSAGE);
  const s = new GameStatus({ modes: ALL_GAMES.map((g) => g.mode) });
  for (const g of ALL_GAMES) { assert.equal(s.status(g.mode), 'dev', g.mode); assert.equal(s.isAvailable(g.mode), false); }
  const r = s.decorate(ALL_GAMES.find((g) => g.mode === 'roulette'));
  assert.equal(r.spotlight, true); assert.equal(r.spotlightBadge, 'أول لعبة قادمة — قيد التطوير'); assert.equal(SPOTLIGHT.mode, 'roulette');
  assert.equal(s.decorate(ALL_GAMES.find((g) => g.mode === 'quiz')).spotlight, undefined);
  // an unknown value never becomes a status; the testers list takes SPG ids only
  assert.equal(new GameStatus({ modes: ['quiz'], defaultStatus: 'open' }).status('quiz'), 'dev');
  assert.equal(new GameStatus({ modes: ['quiz'], defaultStatus: 'available' }).status('quiz'), 'available');
  const t = new GameStatus({ modes: ['quiz'], testers: 'spg-abc234, nope, SPG-XYZ789' });
  assert.equal(t.isTester('SPG-ABC234'), true); assert.equal(t.isTester('SPG-XYZ789'), true); assert.equal(t.isTester('nope'), false);
  const e = devError('quiz', 'تحدي المعرفة'); assert.equal(e.status, 423); assert.equal(e.message, MESSAGE); assert.equal(e.gameStatus, 'dev');
});

test('releasing a game is validated (known game, known status)', async () => {
  const s = new GameStatus({ modes: ['quiz', 'roulette'] });
  await assert.rejects(s.set('nope', 'available'), /لعبة غير معروفة/);
  await assert.rejects(s.set('quiz', 'open'), /الحالة/);
  const v = await s.set('roulette', 'available', 'owner');
  assert.equal(v.status, 'available'); assert.equal(s.isAvailable('roulette'), true);
  assert.equal(s.decorate({ mode: 'roulette' }).spotlightBadge, null, 'a released game no longer says «قيد التطوير»');
});

/* ---------------- the real server ---------------- */
const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_gstatus_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let available = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); available = true; } catch {}
const skip = available ? false : 'no PostgreSQL at TEST_DATABASE_URL';
test.after(async () => { if (!available) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

const OWNER = 'owner-token-game-status-1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function boot(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, SKY_GAMES_DEFAULT: '', PORT: String(port), ADMIN_TOKEN: OWNER, NODE_ENV: 'test', SKY_OPEN_SIGNUP: '1', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-gs-')), DATABASE_URL: dbUrl, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await sleep(50); }
  return { base: 'http://127.0.0.1:' + port, port, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
function browser(base, fixed = {}) {
  const jar = new Map();
  const call = async (method, route, body, headers = {}) => {
    const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const res = await fetch(base + route, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...fixed, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k); }
    const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch {}
    return { status: res.status, data, text, location: res.headers.get('location'), gameStatus: res.headers.get('x-game-status') };
  };
  return call;
}
async function account(base, name) {
  const b = browser(base);
  const r = await b('POST', '/api/auth/register', { username: name, email: name + '@example.com', password: 'reef2026go', confirm: 'reef2026go' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  b.publicId = r.data.account.publicId; b.room = r.data.account.room;
  return b;
}

test('the server: library statuses, direct links, API and WebSocket refused; developers may test; the rest of the site works', { skip, timeout: 90_000 }, async () => {
  const srv = await boot();
  try {
    const guest = browser(srv.base);
    // /api/site: every game says «قيد التطوير», the roulette carries the spotlight badge, nothing is playable
    const site = (await guest('GET', '/api/site')).data;
    const all = [...site.games, ...site.extraGames];
    assert.equal(all.length, ALL_GAMES.length);
    for (const g of all) assert.equal(g.status, 'dev', g.mode);
    assert.equal(site.availableCount, 0); assert.equal(site.devMessage, MESSAGE);
    const roulette = all.find((g) => g.mode === 'roulette');
    assert.equal(roulette.spotlight, true); assert.equal(roulette.spotlightBadge, 'أول لعبة قادمة — قيد التطوير');
    // the cards keep their art, name and description
    for (const g of all) { assert.ok(g.title && g.summary && g.cover, g.mode); }

    // a direct link opens the notice — signed out and signed in alike — never the game
    for (const route of ['/game/quiz', '/game/roulette', '/game/chain', '/bomb', '/event?mode=glass']) {
      const r = await guest('GET', route);
      assert.equal(r.status, 200, route); assert.equal(r.gameStatus, 'dev', route);
      assert.match(r.text, /game-soon\.js/, route + ': the notice page'); assert.doesNotMatch(r.text, /studio\.js/, route);
    }
    assert.equal((await guest('GET', '/dashboard')).location, '/games');
    const player = await account(srv.base, 'gsplayer1');
    const page = await player('GET', '/game/quiz');
    assert.equal(page.gameStatus, 'dev'); assert.match(page.text, /قيد التطوير/);
    assert.equal((await player('GET', '/api/access/me')).data.developer, false);

    // every game command is refused with the same message (HTTP 423), whatever the route
    const refused = [
      ['flow-setup', { mode: 'quiz' }], ['flow-setup', { mode: 'roulette' }], ['prepare', { mode: 'chain' }], ['configure', { mode: 'race' }],
      ['start', {}], ['advance', {}], ['draw', {}], ['demo-players', { count: 4 }], ['simulation', { autoplay: true }], ['bomb-pass', { to: 2 }],
      ['flow-trial', {}], ['flow-begin', {}], ['flow-start', {}], ['registration-open', {}], ['simulate', { username: 'x', text: 'انضم' }],
    ];
    for (const [action, body] of refused) {
      const r = await player('POST', '/api/admin/' + action, body);
      assert.equal(r.status, 423, action + ' → ' + r.status + ' ' + JSON.stringify(r.data));
      assert.equal(r.data.error, MESSAGE, action); assert.equal(r.data.gameStatus, 'dev', action);
    }
    // stopping, leaving and housekeeping still work
    for (const [action, body] of [['heartbeat', { tab: 'tab-game-status-1' }], ['stop', {}], ['flow-library', {}], ['reset', {}]]) { const r = await player('POST', '/api/admin/' + action, body, { 'X-Studio-Tab': 'tab-game-status-1' }); assert.equal(r.status, 200, action + ' ' + JSON.stringify(r.data)); }
    const st = (await guest('GET', '/api/state?room=' + player.room)).data;
    assert.equal(st.status?.active, false, 'nothing runs');

    // the WebSocket is read-only: a client message cannot start anything
    const ws = new WebSocket('ws://127.0.0.1:' + srv.port + '/ws?room=' + player.room);
    await once(ws, 'open');
    for (const m of [{ type: 'start' }, { action: 'flow-start' }, { type: 'command', action: 'start', mode: 'quiz' }]) ws.send(JSON.stringify(m));
    await sleep(400); ws.close();
    assert.equal((await guest('GET', '/api/state?room=' + player.room)).data.status.active, false);

    // the rest of the site is untouched
    for (const route of ['/api/me/wallet', '/api/me/profile', '/api/store/packages', '/api/leaderboard']) assert.equal((await player('GET', route)).status, 200, route);
    for (const route of ['/', '/games', '/account', '/login']) { const r = await player('GET', route); assert.ok(r.status === 200 || r.status === 302, route + ' ' + r.status); }

    // a developer: the owner (admin token) runs a game under development; an admin account opens its page
    const owner = browser(srv.base, { Authorization: 'Bearer ' + OWNER });
    assert.equal((await owner('POST', '/api/admin/flow-setup', { mode: 'roulette' })).status, 200);
    assert.equal((await owner('POST', '/api/admin/flow-trial', {})).status, 200);
    const admin = await account(srv.base, 'gsadmin1');
    { const c = new pg.Client({ connectionString: dbUrl }); await c.connect(); await c.query("UPDATE users SET is_admin=true, email_verified_at=now() WHERE username='gsadmin1'"); await c.end(); }
    assert.equal((await admin('POST', '/api/auth/login', { identifier: 'gsadmin1', password: 'reef2026go' })).status, 200);
    assert.equal((await admin('GET', '/api/access/me')).data.developer, true);
    const devPage = await admin('GET', '/game/roulette');
    assert.equal(devPage.status, 200); assert.equal(devPage.gameStatus, null); assert.match(devPage.text, /studio\.js/, 'the developer gets the game');
    assert.equal((await admin('POST', '/api/admin/flow-setup', { mode: 'roulette' })).status, 200);

    // the admin panel lists the switches and releases a game (audited); then everyone can open it
    const list = (await admin('GET', '/api/manage/games')).data.games;
    assert.equal(list.length, ALL_GAMES.length); assert.ok(list.every((g) => g.status === 'dev'));
    assert.equal((await player('POST', '/api/manage/game-status', { mode: 'quiz', status: 'available' })).status, 403, 'players cannot release games');
    const rel = await admin('POST', '/api/manage/game-status', { mode: 'quiz', status: 'available' });
    assert.equal(rel.status, 200); assert.equal(rel.data.game.status, 'available');
    const open = await player('GET', '/game/quiz');
    assert.equal(open.gameStatus, null); assert.match(open.text, /studio\.js/);
    assert.equal((await player('POST', '/api/admin/flow-setup', { mode: 'quiz' })).status, 200);
    assert.equal((await guest('GET', '/api/site')).data.availableCount, 1);
    // …and back under development
    assert.equal((await admin('POST', '/api/manage/game-status', { mode: 'quiz', status: 'dev' })).status, 200);
    assert.equal((await player('POST', '/api/admin/flow-setup', { mode: 'quiz' })).status, 423);
  } finally { await srv.stop(); }
  // the switches survive a restart (PostgreSQL)
  const again = await boot();
  try {
    const owner = browser(again.base, { Authorization: 'Bearer ' + OWNER });
    const c = new pg.Client({ connectionString: dbUrl }); await c.connect();
    const rows = (await c.query('SELECT mode, status FROM game_flags')).rows; await c.end();
    assert.deepEqual(rows.map((r) => [r.mode, r.status]), [['quiz', 'dev']]);
    assert.equal((await owner('GET', '/api/site')).data.games.find((g) => g.mode === 'quiz').status, 'dev');
  } finally { await again.stop(); }
});

test('testers listed in SKY_GAME_TESTERS may test; everyone else may not', { skip, timeout: 60_000 }, async () => {
  // the tester's id is only known after sign-up: sign up on one server, start a second one that lists it
  let id;
  { const s = await boot(); try { const t = await account(s.base, 'gstester1'); id = t.publicId; } finally { await s.stop(); } }
  const srv = await boot({ SKY_GAME_TESTERS: id });
  try {
    const t = browser(srv.base);
    assert.equal((await t('POST', '/api/auth/login', { identifier: 'gstester1', password: 'reef2026go' })).status, 200);
    assert.equal((await t('GET', '/api/access/me')).data.developer, true);
    assert.equal((await t('POST', '/api/admin/flow-setup', { mode: 'roulette' })).status, 200);
    const other = await account(srv.base, 'gsplayer2');
    assert.equal((await other('POST', '/api/admin/flow-setup', { mode: 'roulette' })).status, 423);
  } finally { await srv.stop(); }
});
