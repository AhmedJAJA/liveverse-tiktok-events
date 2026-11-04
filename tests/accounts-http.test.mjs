import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseKickChat, validKickSlug } from '../src/kick.mjs';

async function boot() {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise((r) => reservation.close(r));
  const token = randomBytes(24).toString('hex');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-acc-'));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), ADMIN_TOKEN: token, NODE_ENV: 'test', SKY_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', (c) => (errors += c));
  await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error(errors || 'exit'); }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000).unref())]);
  const base = 'http://127.0.0.1:' + port;
  const stop = () => { child.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); };
  return { base, token, stop };
}

/** Tiny cookie-jar client: each one is a separate browser. */
function client(base) {
  let cookie = '';
  return async (method, route, body, headers = {}) => {
    const res = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, cookie: set };
  };
}

test('accounts: register, session cookie, isolated rooms, plans and logout', async () => {
  const { base, token, stop } = await boot();
  try {
    const alice = client(base), bob = client(base), owner = client(base);
    const ownerH = { Authorization: 'Bearer ' + token };
    // validation is reported per field
    const bad = await alice('POST', '/api/account/register', { username: 'a', displayName: 'x', email: 'no', password: '123' });
    assert.equal(bad.status, 400); assert.ok(bad.data.fields.username && bad.data.fields.email && bad.data.fields.password);

    const reg = await alice('POST', '/api/account/register', { username: 'alice_1', displayName: 'أليس', email: 'alice@example.com', password: 'sky-pass-2026' });
    assert.equal(reg.status, 201);
    assert.match(reg.cookie, /HttpOnly/); assert.match(reg.cookie, /SameSite=Lax/);
    const me = await alice('GET', '/api/account/me');
    assert.equal(me.data.user.username, 'alice_1'); assert.equal(me.data.live, false);
    const aliceRoom = me.data.room; assert.match(aliceRoom, /^u[a-z0-9]{9}$/);
    assert.equal(JSON.stringify(me.data).includes('sky-pass'), false, 'password never echoed');

    // duplicate usernames are rejected
    const dup = await bob('POST', '/api/account/register', { username: 'ALICE_1', displayName: 'نسخة', email: 'b@example.com', password: 'other-pass-99' });
    assert.equal(dup.status, 400); assert.ok(dup.data.fields.username);

    // cross-origin writes are refused
    assert.equal((await bob('POST', '/api/account/guest', {}, { Origin: 'https://evil.example' })).status, 403);

    // free account: demo players work in its own room, live connect needs a plan
    assert.equal((await alice('POST', '/api/admin/demo-players', { count: 3 })).status, 200);
    const conn = await alice('POST', '/api/admin/connect', { username: 'someone' });
    assert.equal(conn.status, 403); assert.match(conn.data.error, /اشتراك/);
    const aliceState = (await alice('GET', '/api/state?room=' + aliceRoom)).data;
    const mainState = (await alice('GET', '/api/state')).data;
    assert.ok(aliceState.playerCount >= 3);
    assert.equal(mainState.playerCount, 0, 'the owner room is untouched by an account');

    // guests get their own room too
    const g = await bob('POST', '/api/account/guest', {});
    assert.equal(g.status, 200); assert.match(g.data.room, /^g[a-z0-9]{9}$/); assert.notEqual(g.data.room, aliceRoom);
    assert.equal((await bob('POST', '/api/admin/connect', { username: 'x' })).status, 403);
    // account-management actions belong to the owner only
    assert.equal((await alice('POST', '/api/admin/account-plan', { username: 'alice_1', plan: 'monthly' })).status, 403);
    const plan = await owner('POST', '/api/admin/account-plan', { username: 'alice_1', plan: 'monthly', days: 30 }, ownerH);
    assert.equal(plan.status, 200); assert.equal(plan.data.account.planActive, true);
    assert.equal((await alice('GET', '/api/account/me')).data.live, true);
    // kick names are validated before any network call
    assert.equal((await alice('POST', '/api/admin/connect', { username: 'bad name!', platform: 'kick' })).status, 400);

    // login / wrong password / logout
    const other = client(base);
    assert.equal((await other('POST', '/api/account/login', { username: 'alice_1', password: 'wrong-pass-1' })).status, 401);
    assert.equal((await other('POST', '/api/account/login', { username: 'alice_1', password: 'sky-pass-2026' })).status, 200);
    assert.equal((await other('GET', '/api/account/me')).data.user.username, 'alice_1');
    assert.equal((await other('POST', '/api/account/logout', {})).status, 200);
    assert.equal((await other('GET', '/api/account/me')).data.user, null);
    // forgot never reveals whether an account exists
    const f = await other('POST', '/api/account/forgot', { username: 'nobody' });
    assert.equal(f.status, 200); assert.equal(f.data.ok, true);

    // live streams list is public and empty without connected rooms
    const streams = (await other('GET', '/api/streams')).data;
    assert.deepEqual([streams.totalStreams, streams.totalPlayers], [0, 0]);
  } finally { stop(); }
});

test('draw hub over HTTP: create needs a subscriber, players join by code and finish the chain', async () => {
  const { base, token, stop } = await boot();
  try {
    const anon = client(base), host = client(base), guest = client(base);
    assert.equal((await anon('POST', '/api/draw/create', { name: 'ضيف' })).status, 403);
    const made = await host('POST', '/api/draw/create', { name: 'المضيف' }, { Authorization: 'Bearer ' + token });
    assert.equal(made.status, 200); assert.match(made.data.code, /^[A-Z0-9]{5}$/);
    const H = { 'X-Draw-Player': made.data.player.id, 'X-Draw-Secret': made.data.player.secret };
    const joined = await guest('POST', '/api/draw/join', { code: made.data.code.toLowerCase(), name: 'لاعب' });
    assert.equal(joined.status, 200);
    const G = { 'X-Draw-Player': joined.data.player.id, 'X-Draw-Secret': joined.data.player.secret };
    // another player's secret is never accepted
    assert.equal((await guest('GET', '/api/draw/state?code=' + made.data.code, null, { ...G, 'X-Draw-Secret': 'nope' })).status, 400);
    assert.equal((await guest('POST', '/api/draw/start', { code: made.data.code }, G)).status, 400, 'only the host starts');
    assert.equal((await host('POST', '/api/draw/start', { code: made.data.code }, H)).status, 200);
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    for (const [who, hdr] of [[host, H], [guest, G]]) assert.equal((await who('POST', '/api/draw/submit', { code: made.data.code, data: 'جملة البداية' }, hdr)).status, 200);
    let st = (await host('GET', '/api/draw/state?code=' + made.data.code, null, H)).data;
    assert.equal(st.task.kind, 'drawing'); assert.equal(st.task.prompt.kind, 'text');
    assert.equal((await host('POST', '/api/draw/submit', { code: made.data.code, data: 'data:image/png;base64,AAAA' }, H)).status, 400, 'non-PNG rejected');
    for (const [who, hdr] of [[host, H], [guest, G]]) assert.equal((await who('POST', '/api/draw/submit', { code: made.data.code, data: png }, hdr)).status, 200);
    for (const [who, hdr] of [[host, H], [guest, G]]) assert.equal((await who('POST', '/api/draw/submit', { code: made.data.code, data: 'وصف' }, hdr)).status, 200);
    st = (await guest('GET', '/api/draw/state?code=' + made.data.code, null, G)).data;
    assert.equal(st.phase, 'album'); assert.equal(st.album.entries.length, 1);
    assert.equal((await host('POST', '/api/draw/album', { code: made.data.code, action: 'all' }, H)).status, 200);
    st = (await guest('GET', '/api/draw/state?code=' + made.data.code, null, G)).data;
    assert.equal(st.album.entries.length, 3);
    for (const route of ['/draw', '/draw.js', '/draw.css', '/draw-mark.svg', '/session.js', '/account.js']) assert.equal((await fetch(base + route)).status, 200, route);
  } finally { stop(); }
});

test('kick chat parsing and channel validation', () => {
  assert.ok(validKickSlug('sky_live-1'));
  assert.ok(!validKickSlug('bad name'));
  const msg = parseKickChat({ id: 'm1', content: 'انضم [emote:1:wave]', sender: { id: 7, username: 'Omar', slug: 'omar', identity: { badges: [{ type: 'subscriber' }] } } });
  assert.equal(msg.id, 'kick:7'); assert.equal(msg.text, 'انضم'); assert.equal(msg.msgId, 'kick:m1');
  assert.equal(msg.isSubscriber, true); assert.equal(msg.isFollower, false);
  assert.equal(parseKickChat({ content: 'hi', sender: {} }), null);
  assert.equal(parseKickChat({ content: '[emote:1:x]', sender: { id: 1 } }), null);
});
