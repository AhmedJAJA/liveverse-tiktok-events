// Active streams are real: subscription + proven account ownership + live on the platform + studio open + a game.
// Runs the real server against PostgreSQL and a local stand-in for Kick (channel API + Pusher chat socket), so the
// same code paths as production are exercised: connect, ownership code in the owner's own chat, heartbeats, sweep.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { WebSocketServer } from 'ws';

const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_live_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let available = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); available = true; } catch {}
const skip = available ? false : 'no PostgreSQL at TEST_DATABASE_URL';
test.after(async () => { if (!available) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

const OWNER = 'owner-token-for-live-tests-1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 12_000, what = 'condition') { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(150); } }
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }

/** Stand-in for Kick: GET /api/v2/channels/:slug and a Pusher-like chat socket. */
async function fakeKick() {
  const channels = new Map(); // slug -> { chatroom, userId, live }
  const subs = new Map();     // chatroom id -> Set(ws)
  const srv = http.createServer((req, res) => {
    const slug = decodeURIComponent((/^\/api\/v2\/channels\/([^/?]+)/.exec(req.url) || [])[1] || '');
    const ch = channels.get(slug);
    if (!ch) { res.writeHead(404); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ chatroom: { id: ch.chatroom }, user_id: ch.userId, user: { username: slug, profile_pic: 'https://files.kick.com/images/user/' + ch.userId + '/p.webp' }, livestream: ch.live ? { is_live: true } : null }));
  });
  const wss = new WebSocketServer({ server: srv });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ event: 'pusher:connection_established', data: '{}' }));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.event !== 'pusher:subscribe') return;
      const id = Number(String(m.data.channel).split('.')[1]);
      if (!subs.has(id)) subs.set(id, new Set());
      subs.get(id).add(ws); ws.on('close', () => subs.get(id)?.delete(ws));
      ws.send(JSON.stringify({ event: 'pusher_internal:subscription_succeeded', channel: m.data.channel, data: '{}' }));
    });
  });
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
  const base = 'http://127.0.0.1:' + srv.address().port;
  let n = 0;
  return {
    api: base, socket: base.replace('http', 'ws') + '/app',
    add(slug, { userId, live = true }) { channels.set(slug, { chatroom: 1000 + channels.size, userId, live }); },
    setLive(slug, live) { channels.get(slug).live = live; },
    /** a chat message as Kick sends it: the sender is decided by the platform, not by the message text */
    say(slug, sender, text) {
      const ch = channels.get(slug);
      const data = JSON.stringify({ id: 'm' + (++n), content: text, sender: { id: sender.id, username: sender.slug, slug: sender.slug, identity: { badges: [] } } });
      for (const ws of subs.get(ch.chatroom) || []) ws.send(JSON.stringify({ event: 'App\\Events\\ChatMessageEvent', channel: 'chatrooms.' + ch.chatroom + '.v2', data }));
    },
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(); srv.close(r); }),
  };
}
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
    return { status: res.status, data };
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
const streams = async (b) => (await b('GET', '/api/streams')).data;

test('active streams: subscription, proven ownership, real LIVE, open studio and a running game — all checked on the server', { skip, timeout: 180_000 }, async () => {
  const kick = await fakeKick();
  kick.add('hostchan', { userId: 501 }); kick.add('otherchan', { userId: 777 }); kick.add('quietchan', { userId: 502 });
  const srv = await boot({ KICK_API_URL: kick.api, KICK_PUSHER_URL: kick.socket, KICK_LIVE_CHECK_MS: '700', SKY_HOST_TIMEOUT_MS: '5000' });
  const pool = new pg.Pool({ connectionString: dbUrl });
  const owner = browser(srv.base, { Authorization: 'Bearer ' + OWNER });
  const anon = browser(srv.base);
  try {
    // 1. not subscribed: no account, then an account without a trial or plan
    let r = await anon('POST', '/api/admin/connect', { platform: 'kick', username: 'hostchan' });
    assert.equal(r.status, 401); assert.equal(r.data.needPlan, true);
    const free = await account(srv.base, 'free_user');
    r = await free('POST', '/api/admin/connect', { platform: 'kick', username: 'hostchan' });
    assert.equal(r.status, 402); assert.equal(r.data.error, 'تحتاج إلى اشتراك فعال لربط بثك المباشر'); assert.equal(r.data.needPlan, true);

    // 2. the free trial has ended
    const lapsed = await account(srv.base, 'lapsed_user');
    assert.equal((await lapsed('POST', '/api/me/trial-start', {})).data.started, true);
    await pool.query("UPDATE trial_activations SET activated_at=now()-interval '25 hours', ends_at=now()-interval '1 hour' WHERE user_id=(SELECT id FROM users WHERE public_id=$1)", [lapsed.publicId]);
    await pool.query("UPDATE subscriptions SET starts_at=now()-interval '25 hours', ends_at=now()-interval '1 hour' WHERE user_id=(SELECT id FROM users WHERE public_id=$1)", [lapsed.publicId]);
    await owner('POST', '/api/manage/verify', { publicId: lapsed.publicId }); // refreshes the server's view of that account
    r = await lapsed('POST', '/api/admin/connect', { platform: 'kick', username: 'hostchan' });
    assert.equal(r.status, 402); assert.equal(r.data.needPlan, true);

    // host with a running trial
    const host = await account(srv.base, 'host_user');
    assert.equal((await host('POST', '/api/me/trial-start', {})).data.started, true);
    const state = async () => (await anon('GET', '/api/state?room=' + host.room)).data;

    // 4. an account he does not own: the code typed from his own account in someone else's chat proves nothing
    r = await host('POST', '/api/admin/connect', { platform: 'kick', username: 'otherchan' });
    assert.equal(r.status, 200); assert.equal(r.data.verified, false); assert.match(r.data.verify.code, /^SL-[A-Z2-9]{6}$/);
    const foreignCode = r.data.verify.code;
    assert.equal((await state()).connection.verifying, true);
    assert.doesNotMatch(JSON.stringify(await state()), new RegExp(foreignCode), 'the code is never in the public room state');
    kick.say('otherchan', { id: 9001, slug: 'host_user' }, foreignCode);
    kick.say('otherchan', { id: 9002, slug: 'viewer_a' }, 'انضم');
    await sleep(600);
    let s = await state();
    assert.equal(s.connection.verified, false, 'not proven');
    assert.equal(s.playerCount, 0, 'chat of an unproven stream never reaches a game');
    assert.equal((await streams(anon)).totalStreams, 0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM linked_accounts WHERE verified")).rows[0].n, 0);

    // 3. his own channel: the code appears in the owner's own chat → proven, stored, and not asked again
    r = await host('POST', '/api/admin/connect', { platform: 'kick', username: 'hostchan' });
    assert.equal(r.data.verified, false);
    kick.say('hostchan', { id: 501, slug: 'hostchan' }, 'my code ' + r.data.verify.code.toLowerCase());
    await waitFor(async () => (await state()).connection.verified, 5000, 'verification');
    const link = await waitFor(async () => { const rows = (await pool.query("SELECT handle, verified, platform_user_id, verify_method FROM linked_accounts WHERE platform='kick'")).rows; return rows.length && rows; }, 5000, 'stored proof');
    assert.deepEqual(link, [{ handle: 'hostchan', verified: true, platform_user_id: '501', verify_method: 'live-chat-code' }]);
    await host('POST', '/api/admin/disconnect', {});
    r = await host('POST', '/api/admin/connect', { platform: 'kick', username: 'hostchan' });
    assert.equal(r.data.verified, true, 'a proven account connects directly next time'); assert.equal(r.data.verify, undefined);
    assert.equal((await host('GET', '/api/me/profile')).data?.linked?.kick?.verified ?? true, true);

    // 5. linked and live, studio not open / only the games library open → not listed
    assert.equal((await streams(anon)).totalStreams, 0);
    const T1 = 'tab-one-000001', T2 = 'tab-two-000002';
    const beat = (tab, screen = 'game', extra = {}) => host('POST', '/api/admin/heartbeat', { tab, screen, ...extra });
    r = await beat(T1, 'games');
    assert.equal(r.data.state, 'in_studio'); assert.equal(r.data.listed, false); assert.ok(r.data.reasons.includes('no-game'));
    assert.equal((await streams(anon)).totalStreams, 0, 'being in the studio is not running a game');

    // 7. a game on screen during a real LIVE → listed with the real data
    r = await beat(T1, 'game');
    await host('POST', '/api/admin/prepare', { mode: 'quiz' }, { 'X-Studio-Tab': T1 });
    let list = await waitFor(async () => { const l = await streams(anon); return l.totalStreams === 1 && l; }, 4000, 'listing');
    assert.equal(list.streams[0].username, 'hostchan'); assert.equal(list.streams[0].platform, 'kick');
    assert.equal(list.streams[0].liveUrl, 'https://kick.com/hostchan'); assert.equal(list.streams[0].state, 'waiting');
    assert.match(list.streams[0].avatarUrl, /^https:\/\/files\.kick\.com\//);
    kick.say('hostchan', { id: 9100, slug: 'real_viewer' }, 'انضم');
    await waitFor(async () => (await streams(anon)).totalPlayers === 1, 4000, 'a real player');
    await host('POST', '/api/admin/demo-players', { count: 3 }, { 'X-Studio-Tab': T1 });
    assert.equal((await streams(anon)).totalPlayers, 1, 'demo players are never counted as real players');
    assert.equal((await waitFor(async () => (await pool.query('SELECT state, listed FROM live_sessions')).rows.find((x) => x.listed), 8000, 'live_sessions row')).state, 'waiting');

    // 11. a second studio window: one card, one controller, take-over on demand
    r = await beat(T2, 'game');
    assert.equal(r.data.primary, false);
    r = await host('POST', '/api/admin/start', {}, { 'X-Studio-Tab': T2 });
    assert.equal(r.status, 409); assert.equal(r.data.otherWindow, true);
    assert.equal((await streams(anon)).totalStreams, 1, 'no duplicate card');
    r = await beat(T2, 'game', { takeover: true });
    assert.equal(r.data.primary, true);
    assert.equal((await host('POST', '/api/admin/registration-close', {}, { 'X-Studio-Tab': T1 })).status, 409, 'the old window lost control');

    // 8. the host closes the game (back to the library / registration closed) → removed
    await beat(T2, 'games');
    assert.equal((await streams(anon)).totalStreams, 0);
    await beat(T2, 'game');
    assert.equal((await streams(anon)).totalStreams, 1);
    await host('POST', '/api/admin/registration-close', {}, { 'X-Studio-Tab': T2 });
    assert.equal((await streams(anon)).totalStreams, 0, 'no open game, not listed');
    await host('POST', '/api/admin/prepare', { mode: 'quiz' }, { 'X-Studio-Tab': T2 });
    assert.equal((await streams(anon)).totalStreams, 1);

    // 9. the host's studio goes away: closed window → at once; lost connection → after the short grace period
    await beat(T2, 'game', { closing: true });
    await beat(T1, 'game', { closing: true });
    assert.equal((await streams(anon)).totalStreams, 0, 'closed windows');
    await beat(T1, 'game');
    assert.equal((await streams(anon)).totalStreams, 1);
    await waitFor(async () => (await streams(anon)).totalStreams === 0, 9000, 'heartbeat timeout');

    // 10. the LIVE stops on the platform → removed even though chat stays open
    await beat(T1, 'game');
    assert.equal((await streams(anon)).totalStreams, 1);
    kick.setLive('hostchan', false);
    await waitFor(async () => (await streams(anon)).totalStreams === 0, 5000, 'live ended');
    assert.equal((await state()).connection.liveConfirmed, false);
    kick.setLive('hostchan', true);
    await waitFor(async () => { await beat(T1, 'game'); return (await streams(anon)).totalStreams === 1; }, 5000, 'live again');

    // 12. forging LIVE from the browser: no request can set verified/live/listed
    const faker = await account(srv.base, 'faker_user');
    await faker('POST', '/api/me/trial-start', {});
    r = await faker('POST', '/api/admin/connect', { platform: 'kick', username: 'hostchan' }); // somebody else's channel
    assert.equal(r.data.verified, false, 'another user cannot reuse a proven account');
    await faker('POST', '/api/admin/simulate', { username: 'hostchan', text: r.data.verify.code });
    await faker('POST', '/api/admin/configure', { connection: { state: 'connected', verified: true }, verified: true, liveConfirmed: true });
    r = await faker('POST', '/api/admin/heartbeat', { tab: 'fake-tab-0001', screen: 'game', listed: true, state: 'running', verified: true });
    await faker('POST', '/api/admin/prepare', { mode: 'quiz' });
    assert.equal(r.data.listed, false); assert.ok(r.data.reasons.includes('not-verified'));
    const fs1 = (await anon('GET', '/api/state?room=' + faker.room)).data.connection;
    assert.equal(fs1.verified, false); assert.equal(fs1.verifying, true);
    assert.equal((await streams(anon)).streams.filter((x) => x.room === faker.room).length, 0);
    const ws = new WebSocket(srv.base.replace('http', 'ws') + '/ws?room=' + faker.room);
    await new Promise((res) => ws.addEventListener('open', res)); ws.send(JSON.stringify({ type: 'state', data: { connection: { verified: true } } })); ws.close();
    assert.equal((await streams(anon)).totalStreams, 1, 'still only the real host');
    await faker('POST', '/api/admin/disconnect', {});

    // 6. a game without a LIVE: subscribed, studio open, game running, but nothing connected
    const quiet = await account(srv.base, 'quiet_user');
    await quiet('POST', '/api/me/trial-start', {});
    r = await quiet('POST', '/api/admin/heartbeat', { tab: 'quiet-tab-001', screen: 'game' });
    await quiet('POST', '/api/admin/prepare', { mode: 'quiz' });
    r = await quiet('POST', '/api/admin/heartbeat', { tab: 'quiet-tab-001', screen: 'game' });
    assert.equal(r.data.listed, false); assert.ok(r.data.reasons.includes('not-live')); assert.equal(r.data.state, 'offline');

    // 13. the subscription ends during the game → removed, and the stream link is closed by the server
    assert.equal((await streams(anon)).totalStreams, 1);
    assert.equal((await owner('POST', '/api/manage/stop', { publicId: host.publicId })).status, 200);
    assert.equal((await streams(anon)).totalStreams, 0, 'removed at once');
    await waitFor(async () => (await state()).connection.state === 'disconnected', 8000, 'stream closed by the server');
    assert.equal((await host('POST', '/api/admin/connect', { platform: 'kick', username: 'hostchan' })).status, 402);

    // 14. the list on the home page refreshes by itself (no reload), and its cards link to the real broadcast
    const home = fs.readFileSync(new URL('../public/home.js', import.meta.url), 'utf8');
    assert.match(home, /liveTimer = setTimeout\(loadStreams, 20_000\)/);
    assert.match(home, /visibilitychange[^\n]*loadStreams/);
  } finally { await pool.end(); await srv.stop(); await kick.close(); }
});
