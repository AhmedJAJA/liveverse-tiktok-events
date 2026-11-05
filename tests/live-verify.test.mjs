// Official platform sign-in (TikTok Login Kit, Kick OAuth 2.1 + PKCE) and the active-streams rules, end to end:
// real server + PostgreSQL + local stand-ins for the platforms' official endpoints (tests/fake-platforms.mjs).
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
const dbName = 'sponge_oauth_' + process.pid;
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
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), ADMIN_TOKEN: OWNER, NODE_ENV: 'test', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-o-')), DATABASE_URL: dbUrl, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
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

test('official TikTok/Kick sign-in, linked-only connections and the active-streams rules', { skip, timeout: 240_000 }, async () => {
  const fake = await fakePlatforms();
  fake.addKick(501, { slug: 'hostchan', name: 'Host Chan' }); fake.addKick(777, { slug: 'otherchan' });
  fake.addTikTok('tt-open-1', { username: 'reef.host', name: 'Reef Host', linkOnly: true }); // username read from the profile link
  const srv = await boot({ ...fake.env, KICK_LIVE_CHECK_MS: '5000', SKY_HOST_TIMEOUT_MS: '5000', SKY_MIN_ROUND_MS: '100' });
  const pool = new pg.Pool({ connectionString: dbUrl });
  const owner = browser(srv.base, { Authorization: 'Bearer ' + OWNER });
  const anon = browser(srv.base);
  try {
    // the settings page knows both sign-ins are offered
    let r = await anon('GET', '/api/oauth/kick/start');
    assert.equal(r.status, 302); assert.match(r.location, /^\/login\?next=/, 'signed out → sign in to SPONGE LIVE first');

    // 5. not subscribed: refused before any platform page is opened
    const free = await account(srv.base, 'free_user', false);
    r = await free('GET', '/api/oauth/kick/start');
    assert.match(r.location, /link_error=plan/);
    r = await free('POST', '/api/admin/connect', { platform: 'kick' });
    assert.equal(r.status, 402); assert.equal(r.data.error, 'تحتاج إلى اشتراك فعال لربط بثك المباشر');

    // 3. Kick: OAuth 2.1 + PKCE (S256), state checked, the official id stored, tokens sealed
    const host = await account(srv.base, 'host_user');
    r = await signIn(fake, host, 'kick', 501);
    assert.match(r.location, /linked=kick/);
    assert.equal(r.params.get('code_challenge_method'), 'S256'); assert.ok(r.params.get('code_challenge'));
    assert.equal(r.params.get('scope'), 'user:read channel:read events:subscribe', 'no stream-key scope');
    let row = (await pool.query("SELECT * FROM linked_accounts WHERE platform='kick'")).rows[0];
    assert.equal(row.verified, true); assert.equal(row.verify_method, 'oauth'); assert.equal(row.platform_user_id, '501'); assert.equal(row.handle, 'hostchan');
    assert.match(row.access_token_enc, /^v1\./); assert.doesNotMatch(row.access_token_enc + row.refresh_token_enc, /at-|rt-/, 'tokens are never stored readable');
    const prof = (await host('GET', '/api/me/profile')).data;
    assert.equal(prof.linked.kick.handle, 'hostchan'); assert.match(prof.linked.kick.avatar, /files\.kick\.com/);
    assert.ok(!JSON.stringify(prof).includes('access_token') && !JSON.stringify(prof).includes('v1.'), 'no token reaches the browser');
    assert.deepEqual(prof.platforms, { tiktok: true, kick: true, twitch: false });

    // 2. TikTok: Login Kit, user.info.basic + user.info.profile → the real username, picture and open_id
    r = await signIn(fake, host, 'tiktok', 'tt-open-1');
    assert.match(r.location, /linked=tiktok/);
    assert.equal(r.params.get('scope'), 'user.info.basic,user.info.profile');
    const links = (await host('GET', '/api/me/links')).data;
    assert.equal(links.linked.tiktok.handle, 'reef.host'); assert.equal(links.linked.tiktok.displayName, 'Reef Host');

    // 9. a refused or tampered sign-in links nothing
    const other = await account(srv.base, 'other_user');
    r = await signIn(fake, other, 'kick', 777, (q) => ({ ...q, state: 'forged-state' }));
    assert.match(r.location, /link_error=state/);
    r = await signIn(fake, other, 'kick', 777, ({ state }) => ({ state, error: 'access_denied' }));
    assert.match(r.location, /link_error=denied/);
    const stolen = browser(srv.base); // another browser cannot finish someone else's sign-in
    const start = await other('GET', '/api/oauth/kick/start');
    const ap = fake.approve(start.location, 777);
    assert.match((await stolen('GET', '/api/oauth/kick/callback?' + new URLSearchParams({ code: ap.code, state: ap.state }))).location, /link_error=state/);
    assert.equal((await other('GET', '/api/me/profile')).data.linked.kick, undefined);

    // 10. the studio connects with the stored official account; a typed name is ignored
    r = await host('POST', '/api/admin/connect', { platform: 'kick', username: 'otherchan' });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.handle, 'hostchan'); assert.equal(r.data.verified, true);
    assert.equal(fake.subscriptions.at(-1).broadcaster_user_id, 501); assert.equal(fake.subscriptions.at(-1).events[0].name, 'chat.message.sent');
    // unsigned or forged chat webhooks are refused; signed ones reach the game
    assert.equal((await fake.kickWebhook(srv.base, { broadcasterUserId: 501, sender: { id: 9, name: 'x', slug: 'x' }, content: 'انضم', forge: true })).status, 400);
    const T = 'tab-host-00001';
    await host('POST', '/api/admin/heartbeat', { tab: T, screen: 'game' });
    await host('POST', '/api/admin/prepare', { mode: 'quiz' }, { 'X-Studio-Tab': T });
    assert.equal((await fake.kickWebhook(srv.base, { broadcasterUserId: 501, sender: { id: 9100, name: 'Real Viewer', slug: 'real_viewer' }, content: 'انضم' })).status, 200);

    // 11 + 13 + 14. listed only now: plan + official link + LIVE on Kick + studio open + a game; real picture and link
    let list = await waitFor(async () => { const l = await streams(anon); return l.totalPlayers === 1 && l; }, 5000, 'listing with the real player');
    assert.equal(list.streams[0].username, 'hostchan'); assert.equal(list.streams[0].liveUrl, 'https://kick.com/hostchan');
    assert.match(list.streams[0].avatarUrl, /^https:\/\/files\.kick\.com\//);
    await host('POST', '/api/admin/demo-players', { count: 3 }, { 'X-Studio-Tab': T });
    assert.equal((await streams(anon)).totalPlayers, 1, 'demo players are never counted');

    // weekly leaderboard: a finished round in this real, listed session counts — the real viewer only, never demo players
    await waitFor(async () => { await host('POST', '/api/admin/heartbeat', { tab: T, screen: 'game' }); return (await pool.query('SELECT sessions FROM weekly_streamer_stats')).rows[0]?.sessions === 1; }, 10000, 'weekly session counted');
    await host('POST', '/api/admin/configure', { mode: 'quiz', prompt: 'عاصمة السعودية؟', options: ['الرياض', 'جدة', 'الدمام', 'مكة'], answer: '1' }, { 'X-Studio-Tab': T });
    assert.equal((await host('POST', '/api/admin/start', {}, { 'X-Studio-Tab': T })).status, 200);
    await fake.kickWebhook(srv.base, { broadcasterUserId: 501, sender: { id: 9100, name: 'Real Viewer', slug: 'real_viewer' }, content: '1' });
    await sleep(300);
    assert.equal((await host('POST', '/api/admin/stop', {}, { 'X-Studio-Tab': T })).status, 200);
    const board = await waitFor(async () => { const d = (await anon('GET', '/api/leaderboard?board=players&metric=wins')).data; return d.rows?.length && d; }, 5000, 'leaderboard row');
    assert.deepEqual(board.rows.map((x) => [x.name, x.wins, x.entries, x.platform]), [['Real Viewer', 1, 1, 'kick']]);
    assert.equal((await anon('GET', '/api/leaderboard?board=streamers&metric=sessions')).data.rows[0].publicId, host.publicId);
    assert.equal((await anon('GET', '/api/leaderboard?board=streamers&find=bad id')).status, 400);
    assert.equal((await anon('GET', '/api/leaderboard?board=streamers&metric=sessions&find=' + host.publicId)).data.found.rank, 1);
    await host('POST', '/api/admin/heartbeat', { tab: T, screen: 'game' });
    await host('POST', '/api/admin/prepare', { mode: 'quiz' }, { 'X-Studio-Tab': T }); // back to a waiting game

    // ===== the launch flow, with real (signed) chat comments from Kick =====
    const H = { 'X-Studio-Tab': T };
    const flowOf = async () => (await anon('GET', '/api/state?room=' + host.room)).data;
    const say = (id, name, content) => fake.kickWebhook(srv.base, { broadcasterUserId: 501, sender: { id, name, slug: name.toLowerCase() }, content });
    await host('POST', '/api/admin/reset', {}, H);
    r = await host('POST', '/api/admin/flow-setup', { mode: 'quiz' }, H);           // «تشغيل اللعبة»
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.flow.stage, 'GAME_SETUP');
    assert.equal((await host('POST', '/api/admin/flow-start', {}, H)).status, 409, 'no round from the setup');
    assert.equal((await host('POST', '/api/admin/flow-settings', { settings: { questions: 1, seconds: 15 } }, H)).data.flow.settings.seconds, 15);
    assert.equal((await host('POST', '/api/admin/flow-settings', { settings: { seconds: 999 } }, H)).status, 400, 'only listed values');
    assert.equal((await host('POST', '/api/admin/flow-settings', { keyword: 'جاهز', autoOpen: false }, H)).status, 200);
    r = await host('POST', '/api/admin/flow-begin', {}, H);                          // «ابدأ اللعبة»
    assert.equal(r.data.flow.state, 'PREPARING_LOBBY', JSON.stringify(r.data));
    assert.equal(r.data.flow.status?.active, undefined);
    let st = await waitFor(async () => { const x = await flowOf(); return x.flow.state !== 'PREPARING_LOBBY' && x; }, 8000, 'lobby prepared');
    assert.equal(st.flow.state, 'LOBBY_READY', JSON.stringify(st.flow.lobby));
    assert.deepEqual(st.flow.lobby.steps.map((x) => [x.key, x.status]), [['auth', 'done'], ['game', 'done'], ['session', 'done'], ['lobby', 'done'], ['account', 'done'], ['listener', 'done'], ['sync', 'done']]);
    assert.match(st.flow.lobby.steps.find((x) => x.key === 'listener').detail, /لم يُنشأ اتصال جديد/, 'the working Kick connection is reused');
    assert.equal(st.status.active, false, '«ابدأ اللعبة» did not start the round'); assert.notEqual(st.registration.phase, 'open');
    await say(9201, 'Early', 'جاهز'); await sleep(200);
    assert.equal((await flowOf()).playerCount, 0, 'no joining before registration opens');
    r = await host('POST', '/api/admin/flow-open', {}, H);                           // «فتح التسجيل»
    assert.equal(r.data.flow.state, 'REGISTRATION_OPEN'); assert.equal(r.data.flow.stage, 'WAITING_FOR_PLAYERS');
    st = await flowOf(); assert.equal(st.registration.keyword, 'جاهز'); assert.equal(st.registration.phase, 'open');
    await say(9202, 'Mona', 'جاهز'); await say(9202, 'Mona', 'جاهز');                 // matching, twice
    await say(9203, 'Other', 'انضم');                                                  // a different word
    st = await waitFor(async () => { const x = await flowOf(); return x.roster.some((p) => p.name === 'Mona') && x; }, 5000, 'Mona joined');
    assert.equal(st.roster.filter((p) => p.name === 'Mona').length, 1, 'added once');
    assert.equal(st.roster.some((p) => p.name === 'Other'), false, 'other words ignored');
    assert.equal(st.status.active, false);
    // a refresh / WebSocket reconnect reads the same session back
    assert.equal(st.flow.stage, 'WAITING_FOR_PLAYERS'); assert.equal(st.flow.mode, 'quiz'); assert.ok(st.flow.sessionId);
    const sid = st.flow.sessionId;
    r = await host('POST', '/api/admin/flow-start', { requestId: 'click-0001' }, H);  // «بدء الجولة الآن»
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.flow.stage, 'GAME_RUNNING'); assert.equal(r.data.flow.state, 'ROUND_RUNNING');
    const twice = await host('POST', '/api/admin/flow-start', { requestId: 'click-0001' }, H);
    assert.equal(twice.data.duplicate, true, 'the same click twice'); assert.equal(twice.data.round.id, r.data.round.id);
    st = await flowOf(); assert.equal(st.status.active, true); assert.equal(st.status.mode, 'quiz');
    assert.equal(st.status.endsAt - st.status.startedAt, 15_000, 'saved answer time applied');
    assert.equal(st.flow.sessionId, sid, 'one session, no duplicate');
    assert.equal((await host('POST', '/api/admin/flow-start', {}, H)).status, 409, 'cannot start twice');
    assert.equal((await host('POST', '/api/admin/flow-setup', { mode: 'flag' }, H)).status, 409, 'no new game session while a round runs');
    await host('POST', '/api/admin/flow-end', {}, H);                                // «إنهاء اللعبة»
    st = await flowOf(); assert.equal(st.flow.stage, 'GAME_LIBRARY'); assert.equal(st.status.active, false);
    await host('POST', '/api/admin/heartbeat', { tab: T, screen: 'game' });
    await host('POST', '/api/admin/prepare', { mode: 'quiz' }, H); // back to the older join page flow used below
    // the faker's unverified room below plays too, but never reaches the board

    // 20. forging from the browser changes nothing
    const faker = await account(srv.base, 'faker_user');
    await faker('POST', '/api/admin/configure', { connection: { state: 'connected', verified: true }, verified: true, liveConfirmed: true });
    r = await faker('POST', '/api/admin/heartbeat', { tab: 'fake-tab-0001', screen: 'game', listed: true, verified: true });
    await faker('POST', '/api/admin/prepare', { mode: 'quiz' });
    assert.equal(r.data.listed, false); assert.ok(r.data.reasons.includes('not-verified'));
    r = await faker('POST', '/api/admin/connect', { platform: 'kick', username: 'hostchan' });
    assert.equal(r.status, 409); assert.equal(r.data.error, 'اربط حسابك على Kick من «الإعدادات» أولًا');
    assert.equal((await streams(anon)).totalStreams, 1);

    // 12. the LIVE ends on Kick → the official live check removes it
    fake.setKickLive(501, false);
    await waitFor(async () => (await streams(anon)).totalStreams === 0, 15000, 'live ended');
    fake.setKickLive(501, true);
    r = await host('POST', '/api/admin/connect', { platform: 'kick' });
    assert.equal(r.status, 200);
    await host('POST', '/api/admin/heartbeat', { tab: T, screen: 'game' });
    assert.equal((await streams(anon)).totalStreams, 1);
    // not live → the studio says so, nothing is listed
    fake.setKickLive(501, false);
    r = await host('POST', '/api/admin/connect', { platform: 'kick' });
    assert.equal(r.status, 409); assert.match(r.data.error, /غير مباشر/);
    fake.setKickLive(501, true);
    await host('POST', '/api/admin/connect', { platform: 'kick' });

    // 6. the same Kick account signed in from another SPONGE LIVE account moves there; the old room is closed
    r = await signIn(fake, other, 'kick', 501);
    assert.match(r.location, /linked=kick/);
    await waitFor(async () => (await anon('GET', '/api/state?room=' + host.room)).data.connection.state === 'disconnected', 5000, 'old room closed');
    assert.equal((await host('GET', '/api/me/profile')).data.linked.kick, undefined);
    assert.equal((await pool.query("SELECT count(*)::int n FROM linked_accounts WHERE platform='kick' AND verified")).rows[0].n, 1);
    r = await signIn(fake, host, 'kick', 501); // and back
    assert.match(r.location, /linked=kick/);

    // 7. after signing in again (another device) the platform links are there
    const again = browser(srv.base);
    assert.equal((await again('POST', '/api/auth/login', { identifier: 'host_user', password: 'reef2026go' })).status, 200);
    const l2 = (await again('GET', '/api/me/links')).data.linked;
    assert.equal(l2.kick.handle, 'hostchan'); assert.equal(l2.tiktok.handle, 'reef.host');

    // 8. expiring tokens are refreshed on the server; a refused refresh asks for a new sign-in
    await pool.query("UPDATE linked_accounts SET token_expires_at = now() - interval '1 minute' WHERE platform='kick'");
    const before = fake.refreshes;
    assert.equal((await host('POST', '/api/admin/connect', { platform: 'kick' })).status, 200);
    assert.equal(fake.refreshes, before + 1, 'refreshed');
    await pool.query("UPDATE linked_accounts SET token_expires_at = now() - interval '1 minute' WHERE platform='kick'");
    fake.refuseRefresh = true;
    r = await host('POST', '/api/admin/connect', { platform: 'kick' });
    assert.equal(r.status, 409); assert.match(r.data.error, /أعد/);
    assert.equal((await host('GET', '/api/me/links')).data.linked.kick.needsReauth, true);
    fake.refuseRefresh = false;
    assert.match((await signIn(fake, host, 'kick', 501)).location, /linked=kick/);
    assert.equal((await host('GET', '/api/me/links')).data.linked.kick.needsReauth, false);

    // 4. unlink: the connection stops, the platform token is revoked, the stored tokens are gone; account kept
    await host('POST', '/api/admin/connect', { platform: 'kick' });
    r = await host('POST', '/api/me/stream-unlink', { platform: 'kick' });
    assert.equal(r.data.removed, true); assert.equal(r.data.revoked, true);
    assert.ok(fake.revoked.some(([p]) => p === 'kick'));
    assert.equal((await pool.query("SELECT count(*)::int n FROM linked_accounts WHERE platform='kick' AND user_id=(SELECT id FROM users WHERE public_id=$1)", [host.publicId])).rows[0].n, 0);
    await waitFor(async () => (await anon('GET', '/api/state?room=' + host.room)).data.connection.state === 'disconnected', 5000, 'stopped');
    assert.equal((await host('GET', '/api/me/profile')).data.user.publicId, host.publicId, 'the account and its permanent ID stay');
    assert.equal((await host('POST', '/api/me/stream-unlink', { platform: 'tiktok' })).data.revoked, true);
    assert.ok(fake.revoked.some(([p]) => p === 'tiktok'));

    // subscription ends: no new sessions, but managing links stays possible
    assert.match((await signIn(fake, host, 'kick', 501)).location, /linked=kick/);
    assert.equal((await owner('POST', '/api/manage/stop', { publicId: host.publicId })).status, 200);
    assert.equal((await host('POST', '/api/admin/connect', { platform: 'kick' })).status, 402);
    assert.equal((await host('POST', '/api/admin/flow-setup', { mode: 'quiz' })).status, 402, 'an ended plan opens no game session');
    assert.equal((await host('POST', '/api/admin/flow-start', {})).status, 402);
    assert.match((await host('GET', '/api/oauth/kick/start')).location, /link_error=plan/);
    assert.equal((await host('POST', '/api/me/stream-unlink', { platform: 'kick' })).data.removed, true);

    // 18 + 19. the home page stays light: one poll every 20 s, no WebSocket
    const home = fs.readFileSync(new URL('../public/home.js', import.meta.url), 'utf8');
    assert.match(home, /liveTimer = setTimeout\(loadStreams, 20_000\)/);
    assert.doesNotMatch(home, /WebSocket/);
  } finally { await pool.end(); await srv.stop(); await fake.close(); }
});

test('no username-based linking is left in the product', () => {
  const pub = (f) => fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /stream-link'|newVerifyCode|proofMatches|live-chat-code'\)/, 'no code-in-chat or typed-name proof');
  assert.doesNotMatch(pub('me.html'), /name="handle"/, 'settings has no handle field');
  assert.match(pub('me.html'), /href="\/api\/oauth\/tiktok\/start"/); assert.match(pub('me.html'), /href="\/api\/oauth\/kick\/start"/);
  assert.match(pub('me.html'), /المتابعة باستخدام TikTok/); assert.match(pub('me.html'), /المتابعة باستخدام Kick/);
  assert.doesNotMatch(pub('home.html'), /id="connectHandle"/, 'home has no handle field');
  assert.match(pub('studio.html'), /id="linkedConnect"/);
  // the demo wheel says it is a demo, and the chat says it is simulated
  assert.match(pub('home.html'), /عرض توضيحي — ليس بثًا حقيقيًا/); assert.match(pub('home.html'), /محاكاة/);
});
