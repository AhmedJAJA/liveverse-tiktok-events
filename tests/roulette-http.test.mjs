// «الروليت» through the real server: the developer gate, a trial lobby, «ابدأ السحب» clicked many times at once,
// scenes that follow the server clock, a page refresh and a WebSocket drop mid-match, the host leaving in automatic
// mode, the end of the match and the saved record. (The rules themselves: tests/roulette.test.mjs.)
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

const OWNER = 'owner-token-roulette-http-1';
const dbUrl = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/visual';
let pgOk = false; try { const c = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 2000 }); await c.connect(); await c.end(); pgOk = true; } catch {}
const skip = !pgOk ? 'no PostgreSQL' : false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function boot(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, SKY_GAMES_DEFAULT: '', PORT: String(port), ADMIN_TOKEN: OWNER, NODE_ENV: 'test', SKY_OPEN_SIGNUP: '1', SKY_HOST_TIMEOUT_MS: '5000', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-rr-')), DATABASE_URL: dbUrl, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await sleep(50); }
  return { base: 'http://127.0.0.1:' + port, port, log: () => out, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
function client(base, fixed = {}) {
  const jar = new Map();
  return async (method, route, body, headers = {}) => {
    const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const res = await fetch(base + route, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...fixed, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k); }
    const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch {}
    return { status: res.status, data, text };
  };
}
async function waitFor(fn, ms = 12_000, what = 'condition') { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(100); } }

test('the roulette on the server: gate, trial lobby, rapid clicks, scenes, refresh, reconnect, host away, the end and the record', { skip, timeout: 180_000 }, async () => {
  const srv = await boot();
  const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
  try {
    const owner = client(srv.base, { Authorization: 'Bearer ' + OWNER });
    const state = async () => (await owner('GET', '/api/state')).data;
    const rr = (cmd, extra = {}) => owner('POST', '/api/admin/roulette', { cmd, ...extra });

    // a player account cannot touch a game under development — not even its history
    const player = client(srv.base);
    const uname = 'rrp' + Date.now().toString(36);
    const reg = await player('POST', '/api/auth/register', { username: uname, email: uname + '@example.com', password: 'reef2026go', confirm: 'reef2026go' });
    assert.equal(reg.status, 201, JSON.stringify(reg.data));
    for (const [action, body] of [['roulette', { cmd: 'draw' }], ['roulette-history', {}], ['flow-setup', { mode: 'roulette' }]]) {
      const r = await player('POST', '/api/admin/' + action, body);
      assert.equal(r.status, 423, action + ' ' + JSON.stringify(r.data)); assert.equal(r.data.gameStatus, 'dev');
    }

    // the owner (a developer) prepares a trial lobby with the rules of the video: the holder chooses the target
    assert.equal((await owner('POST', '/api/admin/flow-setup', { mode: 'roulette' })).status, 200);
    const saved = await owner('POST', '/api/admin/flow-settings', { settings: { targetMode: 'choose', chooseSeconds: 15, timeoutRule: 'random', drawSpeed: 'fast', resultSeconds: 3, maxPlayers: 20, trial: true } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const begun = await owner('POST', '/api/admin/flow-begin', {});
    assert.equal(begun.status, 200, JSON.stringify(begun.data)); assert.equal(begun.data.trial, true, '«وضع التجربة» from the settings');
    let st = await waitFor(async () => { const x = await state(); return x.flow.state === 'REGISTRATION_OPEN' && x.playerCount >= 12 && x; }, 15_000, 'trial lobby');
    assert.equal(st.registration.maxPlayers, 20, '«الحد الأقصى للمشاركين» reached the lobby');
    assert.ok(st.roster.every((p) => p.bot), 'trial players are marked as such');
    // a viewer joins from the chat (simulated comment), and again: still one seat
    await owner('POST', '/api/admin/simulate', { username: 'Nour', text: 'انضم' });
    await owner('POST', '/api/admin/simulate', { username: 'Nour', text: 'انضم' });
    st = await waitFor(async () => { const x = await state(); return x.playerCount === 13 && x; }, 5000, 'Nour joined once');
    const start = await owner('POST', '/api/admin/flow-start', { requestId: 'rr-start-0001' });
    assert.equal(start.status, 200, JSON.stringify(start.data));
    st = await state();
    assert.equal(st.status.mode, 'roulette'); assert.equal(st.status.active, true);
    const match = st.party.match;
    assert.equal(st.party.phase, 'ready'); assert.equal(st.party.total, 13); assert.equal(st.party.demo, true);
    assert.equal(st.party.rules.targetMode, 'choose'); assert.equal(st.party.rules.drawSpeed, 'fast');

    // «ابدأ السحب» clicked five times at once (same click), then five different clicks at once: one turn
    const same = await Promise.all(Array.from({ length: 5 }, () => rr('draw', { requestId: 'rr-click-0001' })));
    assert.ok(same.every((r) => r.status === 200), JSON.stringify(same.map((r) => r.data)));
    assert.equal(same.filter((r) => !r.data.duplicate).length, 1); assert.ok(same.every((r) => r.data.turn === 1));
    const many = await Promise.all(Array.from({ length: 5 }, (_, i) => rr('draw', { requestId: 'rr-click-100' + i })));
    assert.deepEqual(many.map((r) => r.status).sort(), [409, 409, 409, 409, 409], 'a turn is running: no second draw');
    st = await state();
    assert.equal(st.party.turn, 1); assert.equal(st.party.phase, 'drawing');
    assert.equal(st.party.reel.list[st.party.reel.stop], st.party.holder.number, 'the reel stops on the holder');
    assert.equal(st.party.target, null); assert.equal(st.party.result, null);

    // a refresh mid-scene shows the same turn; the scenes follow the server clock (fast: 3.2 s reel, 1.7 s name)
    const again = await state();
    assert.deepEqual([again.party.match, again.party.turn, again.party.holder.number], [match, 1, st.party.holder.number]);
    st = await waitFor(async () => { const x = await state(); return x.party.phase === 'choose' && x; }, 8000, 'choose');
    assert.equal(st.party.endsAt - st.party.phaseStartedAt, 15_000);
    // the trial holder chooses by itself within a few seconds; the outcome stays hidden until the reveal
    st = await waitFor(async () => { const x = await state(); return ['aim', 'reveal'].includes(x.party.phase) && x; }, 8000, 'target chosen');
    if (st.party.phase === 'aim') { assert.ok(st.party.target); assert.equal(st.party.result, null); assert.ok(st.party.chamber.of === 2); }
    // «تخطي»: straight to the result, same turn
    const sk = await rr('skip'); assert.equal(sk.status, 200);
    st = await state();
    assert.ok(['reveal', 'ready'].includes(st.party.phase)); assert.equal(st.party.turn, 1);
    if (st.party.phase === 'reveal') assert.ok(['out', 'empty'].includes(st.party.result.outcome));

    // the WebSocket: states arrive, a drop and a reconnect continue the same match, later in its story
    const ws = new WebSocket('ws://127.0.0.1:' + srv.port + '/ws', { headers: { Authorization: 'Bearer ' + OWNER } });
    const seen = [];
    ws.on('message', (m) => { try { const p = JSON.parse(m); if (p.type === 'state' && p.data?.party) seen.push(p.data.party); } catch {} });
    await once(ws, 'open');
    await waitFor(async () => { const x = await state(); if (x.party.phase === 'ready') await rr('draw', { requestId: 'rr-click-2001' }); return seen.length >= 2; }, 10_000, 'live states');
    const before = seen.at(-1);
    ws.terminate(); // the connection drops
    await sleep(600);
    const ws2 = new WebSocket('ws://127.0.0.1:' + srv.port + '/ws', { headers: { Authorization: 'Bearer ' + OWNER } });
    const first = new Promise((resolve) => ws2.on('message', (m) => { try { const p = JSON.parse(m); if (p.type === 'state' && p.data?.party) resolve(p.data.party); } catch {} }));
    await once(ws2, 'open');
    const after = await Promise.race([first, sleep(6000).then(() => null)]) || (await state()).party;
    assert.equal(after.match, before.match, 'same match after the reconnect');
    assert.ok(after.seq >= before.seq, 'never back in time');
    ws2.close();

    // the host's window leaves while «تلقائي» is on: the match waits where it is
    st = await state();
    // (automatic mode is a rule of the match: here it is manual, so nothing moves without «ابدأ السحب»)
    await waitFor(async () => { const x = await state(); if (x.party.phase === 'choose') await rr('random'); else if (!['ready'].includes(x.party.phase)) await rr('skip'); return x.party.phase === 'ready' && x; }, 15_000, 'back to the grid');
    const t0 = (await state()).party.seq;
    await sleep(1500);
    assert.equal((await state()).party.seq, t0, 'manual: the grid waits for the host');

    // play to the end: draw, random target when asked, skip scenes
    for (let i = 0; i < 400; i++) {
      const x = await state();
      if (!x.status.active) break;
      const p = x.party;
      if (p.phase === 'ready') await rr('draw', { requestId: 'rr-loop-' + String(i).padStart(4, '0') });
      else if (p.phase === 'choose') await rr('random');
      else await rr('skip');
    }
    st = await state();
    assert.equal(st.status.active, false); assert.equal(st.party.phase, 'finished');
    assert.ok(st.party.winner); assert.equal(st.status.winner.id, st.party.winner.id);
    assert.equal(st.party.alive, 1); assert.equal(st.party.stats.out, 12);
    assert.equal((await rr('draw')).status, 409, 'nothing after the end');
    // the record: the match, every turn, the winner — marked as a trial
    const hist = await waitFor(async () => { const r = await owner('POST', '/api/admin/roulette-history', { limit: 3 }); return r.data?.matches?.[0]?.ended_at && r.data; }, 8000, 'history');
    const m = hist.matches[0];
    assert.equal(m.id, match); assert.equal(m.demo, true); assert.equal(m.winner.id, st.party.winner.id);
    assert.equal(m.turns.length, st.party.stats.turns);
    assert.equal(m.turns.filter((t) => t.outcome === 'out').length, 12);
    // «جولة جديدة»: the same lobby (the same players), then a brand-new match with fresh cylinders
    assert.equal((await owner('POST', '/api/admin/flow-again', {})).status, 200);
    await waitFor(async () => { const x = await state(); return ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'WAITING_FOR_PLAYERS'].includes(x.flow.state) && x; }, 8000, 'the lobby again');
    const replay = await owner('POST', '/api/admin/flow-start', { requestId: 'rr-start-0002' });
    assert.equal(replay.status, 200, JSON.stringify(replay.data));
    st = await state();
    assert.equal(st.status.active, true); assert.notEqual(st.party.match, match, 'a new match');
    assert.equal(st.party.total, 13); assert.equal(st.party.alive, 13); assert.equal(st.party.turn, 0);
    await owner('POST', '/api/admin/stop', {});
    await pool.query('DELETE FROM roulette_matches WHERE id = ANY($1::uuid[])', [[match, st.party.match]]);
  } finally { await pool.end(); await srv.stop(); }
});

test('«تلقائي» on the server: the next turn starts by itself while the host window beats, and waits when it goes away', { skip, timeout: 120_000 }, async () => {
  const srv = await boot();
  try {
    const owner = client(srv.base, { Authorization: 'Bearer ' + OWNER });
    const state = async () => (await owner('GET', '/api/state')).data;
    const beat = () => owner('POST', '/api/admin/heartbeat', { tab: 'rr-host-tab-01', screen: 'game' });
    await beat();
    await owner('POST', '/api/admin/flow-setup', { mode: 'roulette' });
    await owner('POST', '/api/admin/flow-settings', { settings: { autoRun: 'auto', drawSpeed: 'fast', resultSeconds: 3, trial: true } }, { 'X-Studio-Tab': 'rr-host-tab-01' });
    await owner('POST', '/api/admin/flow-begin', {}, { 'X-Studio-Tab': 'rr-host-tab-01' });
    await waitFor(async () => { await beat(); const x = await state(); return x.flow.state === 'REGISTRATION_OPEN' && x.playerCount >= 12; }, 15_000, 'trial lobby');
    assert.equal((await owner('POST', '/api/admin/flow-start', {}, { 'X-Studio-Tab': 'rr-host-tab-01' })).status, 200);
    // with the window beating, turns follow one another without a click
    await waitFor(async () => { await beat(); const x = await state(); return x.party.turn >= 2 && x; }, 30_000, 'two automatic turns');
    // the window closes: the match finishes its current turn, then waits on the grid
    await owner('POST', '/api/admin/heartbeat', { tab: 'rr-host-tab-01', closing: true });
    const waiting = await waitFor(async () => { const x = await state(); return x.party.phase === 'ready' && x.party.waitingHost && x; }, 30_000, 'waiting for the host');
    await sleep(2500);
    const still = await state();
    assert.equal(still.party.turn, waiting.party.turn, 'no turn without the host'); assert.equal(still.party.phase, 'ready');
    // the host is back: the match goes on from where it was
    await beat();
    await waitFor(async () => { await beat(); const x = await state(); return x.party.turn > waiting.party.turn; }, 10_000, 'resumed');
    await owner('POST', '/api/admin/stop', {}, { 'X-Studio-Tab': 'rr-host-tab-01' });
    const end = await state();
    assert.equal(end.status.active, false); assert.equal(end.status.winner, null, 'stopped early: no winner');
  } finally { await srv.stop(); }
});
