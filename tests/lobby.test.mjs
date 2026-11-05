// The game lobby end to end (real server + PostgreSQL + the platform stand-ins of tests/fake-platforms.mjs):
// «ابدأ اللعبة» runs real preparation steps, failures name their cause and action, «وضع التجربة», the join word
// version, «إعادة تعيين», the lobby coming back after a restart, and the name frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { fakePlatforms } from './fake-platforms.mjs';

const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_lobby_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let available = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); available = true; } catch {}
const skip = available ? false : 'no PostgreSQL at TEST_DATABASE_URL';
test.after(async () => { if (!available) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

const OWNER = 'owner-token-for-oauth-tests-1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 12_000, what = 'condition') { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(150); } }
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function boot(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), ADMIN_TOKEN: OWNER, NODE_ENV: 'test', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-l-')), DATABASE_URL: dbUrl, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await sleep(50); }
  return { base: 'http://127.0.0.1:' + port, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
function browser(base, fixed = {}) {
  const jar = new Map();
  const call = async (method, route, body, headers = {}) => {
    const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const res = await fetch(base + route, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...fixed, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k); }
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, location: res.headers.get('location') };
  };
  call.jar = jar;
  return call;
}
async function account(base, name, trial = true) {
  const b = browser(base);
  const r = await b('POST', '/api/auth/register', { username: name, email: name + '@example.com', password: 'reef2026go', confirm: 'reef2026go' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  b.publicId = r.data.account.publicId; b.room = r.data.account.room;
  if (trial) assert.equal((await b('POST', '/api/me/trial-start', {})).data.started, true);
  return b;
}
/** The whole sign-in round trip: our start → the platform's page (approved as `uid`) → our callback. */
async function signIn(fake, b, p, uid, tweak = (x) => x) {
  const start = await b('GET', '/api/oauth/' + p + '/start');
  if (!/\/(tiktok|kick)\/authorize\?/.test(start.location || '')) return start;
  const { code, state, params } = fake.approve(start.location, uid);
  const q = tweak({ code, state });
  const cb = await b('GET', '/api/oauth/' + p + '/callback?' + new URLSearchParams(q));
  cb.params = params;
  return cb;
}
const streams = async (b) => (await b('GET', '/api/streams')).data;


import { FrameStore } from '../src/frames.mjs';
test('lobby preparation, errors with actions, demo mode, keyword version, reset, restart recovery, frames', { skip, timeout: 240_000 }, async () => {
  const fake = await fakePlatforms();
  fake.addKick(601, { slug: 'lobbychan', name: 'Lobby Chan' });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-l-'));
  let srv = await boot({ ...fake.env, SKY_DATA_DIR: dataDir });
  const pool = new pg.Pool({ connectionString: dbUrl });
  try {
    const host = await account(srv.base, 'lobby_host');
    const T = 'lobby-tab-000001', H = { 'X-Studio-Tab': T };
    await host('POST', '/api/admin/heartbeat', { tab: T, screen: 'game' });
    const state = async () => (await host('GET', '/api/state?room=' + host.room)).data;
    const settled = (what) => waitFor(async () => { const x = await state(); return !['PREPARING_LOBBY', 'RECOVERING'].includes(x.flow.state) && x; }, 10_000, what);

    // 1. no linked stream account → LOBBY_ERROR «حساب البث غير مرتبط» with «ربط الحساب»; nothing was started
    assert.equal((await host('POST', '/api/admin/flow-begin', {}, H)).status, 409, '«ابدأ اللعبة» needs the setup first');
    await host('POST', '/api/admin/flow-setup', { mode: 'quiz' }, H);
    let r = await host('POST', '/api/admin/flow-begin', {}, H);
    assert.equal(r.data.flow.state, 'PREPARING_LOBBY');
    let st = await settled('error');
    assert.equal(st.flow.state, 'LOBBY_ERROR');
    assert.deepEqual([st.flow.lobby.error.code, st.flow.lobby.error.title, st.flow.lobby.error.label, st.flow.lobby.error.href], ['not_linked', 'حساب البث غير مرتبط', 'ربط الحساب', '/account#settings']);
    assert.deepEqual(st.flow.lobby.steps.map((x) => x.status), ['done', 'done', 'done', 'done', 'failed', 'pending', 'pending'], 'later steps were not run (and not claimed)');
    assert.equal(st.status.active, false); assert.notEqual(st.registration.phase, 'open');
    assert.equal((await host('POST', '/api/admin/flow-start', {}, H)).status, 409, 'no round from an error');
    // cancel → back to the settings
    assert.equal((await host('POST', '/api/admin/flow-cancel', {}, H)).data.flow.state, 'GAME_SETUP');

    // 2. linked but the stream is offline → «البث المباشر غير نشط» / «التحقق مجددًا»; going live and retrying works
    assert.match((await signIn(fake, host, 'kick', 601)).location, /linked=kick/);
    fake.setKickLive(601, false);
    await host('POST', '/api/admin/flow-begin', {}, H);
    st = await settled('offline');
    assert.equal(st.flow.lobby.error.code, 'not_live'); assert.equal(st.flow.lobby.error.label, 'التحقق مجددًا');
    fake.setKickLive(601, true);
    r = await host('POST', '/api/admin/flow-begin', {}, H); // LOBBY_ERROR.retry
    st = await settled('ready');
    assert.equal(st.flow.state, 'REGISTRATION_OPEN', JSON.stringify(st.flow.lobby?.error));
    assert.match(st.flow.lobby.steps.find((x) => x.key === 'listener').detail, /Kick/);
    assert.equal(st.connection.state, 'connected'); assert.equal(st.connection.platform, 'kick');

    // 3. the join word: changed once, a stale version is refused, chat matches the new word only
    const v = st.flow.version;
    r = await host('POST', '/api/admin/flow-keyword', { keyword: 'العب', version: v }, H); assert.equal(r.status, 200);
    r = await host('POST', '/api/admin/flow-keyword', { keyword: 'دخول', version: v }, H);
    assert.equal(r.status, 409); assert.match(r.data.error, /نافذة أخرى/);
    assert.equal((await host('POST', '/api/admin/flow-keyword', { keyword: '12', version: r.data.version }, H)).status, 400);
    await fake.kickWebhook(srv.base, { broadcasterUserId: 601, sender: { id: 1, name: 'Ali', slug: 'ali' }, content: 'العب' });
    await fake.kickWebhook(srv.base, { broadcasterUserId: 601, sender: { id: 2, name: 'Sara', slug: 'sara' }, content: 'انضم' });
    await fake.kickWebhook(srv.base, { broadcasterUserId: 601, sender: { id: 3, name: 'Omar', slug: 'omar' }, content: 'العب!' });
    st = await waitFor(async () => { const x = await state(); return x.playerCount === 2 && x; }, 5000, 'two players');
    assert.deepEqual(st.roster.map((p) => p.name).sort(), ['Ali', 'Omar']);
    assert.equal(st.registration.keyword, 'العب');

    // 4. the lobby comes back after a restart (registration closed, players, word) — through RECOVERING
    await host('POST', '/api/admin/flow-close', {}, H);
    await waitFor(async () => (await pool.query('SELECT data FROM lobby_sessions WHERE room=$1', [host.room])).rows[0]?.data?.lobby?.state === 'REGISTRATION_CLOSED', 5000, 'lobby saved');
    await srv.stop();
    srv = await boot({ ...fake.env, SKY_DATA_DIR: dataDir });
    const host2 = browser(srv.base); for (const [k, x] of host.jar) host2.jar.set(k, x);
    await host2('POST', '/api/admin/heartbeat', { tab: T, screen: 'game' });
    st = await waitFor(async () => { const x = (await host2('GET', '/api/state?room=' + host.room)).data; return !['PREPARING_LOBBY', 'RECOVERING'].includes(x.flow.state) && x; }, 10_000, 'recovered');
    assert.equal(st.flow.state, 'REGISTRATION_CLOSED', 'restored as it was — not reopened');
    assert.equal(st.playerCount, 2); assert.equal(st.registration.keyword, 'العب'); assert.equal(st.flow.mode, 'quiz');
    assert.match(st.flow.lobby.note, /أُعيد تشغيل الخادم/);
    assert.equal(st.connection.state, 'connected', 'the Kick chat was reconnected');
    await fake.kickWebhook(srv.base, { broadcasterUserId: 601, sender: { id: 4, name: 'Late', slug: 'late' }, content: 'العب' });
    await sleep(300); assert.equal((await host2('GET', '/api/state?room=' + host.room)).data.playerCount, 2, 'closed means closed');

    // 5. «إعادة تعيين»: confirmation first, then a new generation
    r = await host2('POST', '/api/admin/flow-registration-reset', {}, H);
    assert.equal(r.status, 428); assert.match(r.data.error, /أكّد/);
    r = await host2('POST', '/api/admin/flow-registration-reset', { confirm: true }, H);
    assert.equal(r.status, 200); assert.ok(r.data.generation >= 2);
    assert.equal((await host2('GET', '/api/state?room=' + host.room)).data.playerCount, 0);

    // 6. start: needs players; the same click twice makes one round
    r = await host2('POST', '/api/admin/flow-start', { requestId: 'start-click-1' }, H);
    assert.equal(r.status, 409); assert.match(r.data.error, /تحتاج/);
    await host2('POST', '/api/admin/flow-open', {}, H);
    await fake.kickWebhook(srv.base, { broadcasterUserId: 601, sender: { id: 5, name: 'Nour', slug: 'nour' }, content: 'العب' });
    await waitFor(async () => (await host2('GET', '/api/state?room=' + host.room)).data.playerCount === 1, 5000, 'Nour');
    const [a, b] = await Promise.all([host2('POST', '/api/admin/flow-start', { requestId: 'start-click-2' }, H), host2('POST', '/api/admin/flow-start', { requestId: 'start-click-2' }, H)]);
    assert.deepEqual([a.status, b.status], [200, 200]); assert.equal(a.data.round.id, b.data.round.id, 'one round');
    assert.equal((await host2('POST', '/api/admin/flow-start', { requestId: 'start-click-3' }, H)).status, 409);
    await host2('POST', '/api/admin/flow-end', {}, H);
    await waitFor(async () => !(await pool.query('SELECT 1 FROM lobby_sessions WHERE room=$1', [host.room])).rowCount, 5000, 'saved lobby removed at the end');

    // 7. «وضع التجربة»: no stream needed, test players, labelled, never saved
    await host2('POST', '/api/admin/disconnect', {}, H);
    await host2('POST', '/api/admin/flow-setup', { mode: 'rps' }, H);
    await host2('POST', '/api/admin/flow-trial', {}, H);
    st = await waitFor(async () => { const x = (await host2('GET', '/api/state?room=' + host.room)).data; return x.flow.state === 'REGISTRATION_OPEN' && x; }, 8000, 'demo ready');
    assert.equal(st.flow.lobby.demo, true); assert.equal(st.flow.trial, true);
    assert.ok(st.roster.filter((p) => p.bot).length >= 4, 'labelled test players');
    assert.ok(!st.flow.lobby.steps.some((x) => x.key === 'listener'), 'no connection claimed in demo mode');
    r = await host2('POST', '/api/admin/flow-start', {}, H); assert.equal(r.status, 200, JSON.stringify(r.data));
    await host2('POST', '/api/admin/flow-end', {}, H);

    // 8. name frames: the free one needs a verified e-mail; equip; owner grant; the lookup by linked handle
    let f = await host2('GET', '/api/me/frames');
    assert.ok(f.data.frames.some((x) => x.id === 'cyan' && !x.owned)); assert.ok(!f.data.frames.some((x) => x.id === 'royal'), 'granted frames are hidden until given');
    assert.equal((await host2('POST', '/api/me/frame-claim', { id: 'cyan' })).status, 403);
    await pool.query('UPDATE users SET email_verified_at=now() WHERE public_id=$1', [host.publicId]);
    assert.equal((await host2('POST', '/api/me/frame-claim', { id: 'cyan' })).status, 200);
    assert.equal((await host2('POST', '/api/me/frame-claim', { id: 'royal' })).status, 403, 'granted frames cannot be claimed');
    assert.equal((await host2('POST', '/api/me/frame-equip', { id: 'royal' })).status, 403, 'not owned');
    assert.equal((await host2('POST', '/api/me/frame-equip', { id: 'cyan' })).data.equipped, 'cyan');
    const store = new FrameStore({ pool });
    const found = await store.forHandles('kick', ['lobbychan', 'stranger']);
    assert.equal(found.get('lobbychan')?.id, 'cyan'); assert.equal(found.get('stranger'), null, 'guests get no invented frame');
    const uid = (await pool.query('SELECT id FROM users WHERE public_id=$1', [host.publicId])).rows[0].id;
    assert.equal((await store.grant(uid, 'royal', 'test')).added, true);
    assert.equal((await host2('POST', '/api/me/frame-equip', { id: 'royal' })).data.equipped, 'royal');
    await assert.rejects(store.save({ id: 'bad', name: 'x', plate: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }), /PNG أو WebP/);
    const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4810000000049454e44ae426082', 'hex').toString('base64');
    const saved = await store.save({ id: 'neon_plate', name: 'لوحة نيون', rarity: 'rare', plate: png, slice: [10, 20, 10, 20] });
    assert.match(saved.plate, /^\/frames\/u\/neon_plate-plate\.png\?v=/); assert.deepEqual(saved.slice, [10, 20, 10, 20]);
    const img = await fetch(srv.base + saved.plate); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  } finally { await pool.end(); await srv.stop(); await fake.close?.(); }
});
