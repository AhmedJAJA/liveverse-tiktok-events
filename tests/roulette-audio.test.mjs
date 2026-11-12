// «الروليت» P3 — recorded sound effects (generated with ElevenLabs, see docs/ROULETTE_P3_AUDIO.md) for the dramatic
// moments: the shot, the dry click, the hammer, the heartbeat, the pick, OUT, relief and the winner's fanfare. Each one
// falls back to the synthesised sound if its file cannot be loaded, so the game is never silent because of a file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let playwright = null;
for (const base of [process.cwd(), (() => { try { return execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } })()]) {
  try { playwright = createRequire(path.join(base, 'x.js'))('playwright'); break; } catch {}
}
const SAMPLES = ['bang', 'click', 'cock', 'heartbeat', 'picked', 'out', 'relief', 'win'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function boot() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, DATABASE_URL: '', PORT: String(port), ADMIN_TOKEN: 'owner-token-roulette-audio-1', NODE_ENV: 'test', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-rra-')) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await sleep(50); }
  return { base: 'http://127.0.0.1:' + port, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}

test('every recorded sound is in the repository, small, documented with its source and prompt', () => {
  const doc = fs.readFileSync('docs/ROULETTE_P3_AUDIO.md', 'utf8');
  let total = 0;
  for (const n of SAMPLES) {
    const f = `public/roulette/audio/${n}.mp3`;
    assert.ok(fs.existsSync(f), f);
    const size = fs.statSync(f).size; total += size;
    assert.ok(size > 2000 && size < 80_000, `${f}: ${size} bytes`);
    assert.match(doc, new RegExp('`' + n + '\\.mp3`'), `${n}.mp3 is listed in the audio sheet`);
  }
  assert.ok(total < 300_000, 'all the sounds together stay light for OBS and phones: ' + total);
  assert.match(doc, /ElevenLabs/); assert.match(doc, /[Ll]icen[cs]e/);
});

test('the server sends the sounds as audio/mpeg', { timeout: 30_000 }, async () => {
  const s = await boot();
  try {
    for (const n of SAMPLES) {
      const r = await fetch(`${s.base}/roulette/audio/${n}.mp3`);
      assert.equal(r.status, 200, n); assert.equal(r.headers.get('content-type'), 'audio/mpeg', n);
      assert.ok((await r.arrayBuffer()).byteLength > 2000);
    }
  } finally { await s.stop(); }
});

test('in the browser: the recordings load and play on their events; a missing file falls back to the synthesised sound; muted plays nothing', { skip: !playwright && 'no Playwright', timeout: 120_000 }, async () => {
  const s = await boot();
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  // every sound the page starts: a recording (its duration) or a synthesised voice («synth»)
  const probe = () => {
    window.__played = [];
    // a recording is a buffer the browser decoded from a file; every other buffer (noise) is synthesised
    const decoded = new WeakSet(), D = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (data, ok, no) {
      return D.call(this, data, (buf) => { decoded.add(buf); ok?.(buf); }, no).then((buf) => { decoded.add(buf); return buf; });
    };
    const B = AudioBufferSourceNode.prototype.start, O = OscillatorNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) { window.__played.push(decoded.has(this.buffer) ? 'rec:' + this.buffer.duration.toFixed(2) : 'synth'); return B.apply(this, a); };
    OscillatorNode.prototype.start = function (...a) { window.__played.push('synth'); return O.apply(this, a); };
  };
  const run = (page) => page.evaluate(async (names) => {
    const { createSfx } = await import('/roulette/sfx.js');
    const fx = createSfx(); fx.status(); // creates the audio context (running: autoplay allowed here)
    await fx.ready(); // every recording loaded (or failed)
    const out = { loaded: fx.recordings(), events: {} };
    for (const [n, call] of [['bang', 'bang'], ['click', 'click'], ['cock', 'cock'], ['heartbeat', 'heartbeat'], ['picked', 'picked'], ['out', 'outSting'], ['relief', 'relief'], ['win', 'win']]) {
      window.__played = []; fx[call](); await new Promise((r) => setTimeout(r, 700)); out.events[n] = window.__played.slice();
    }
    fx.setEnabled(false); window.__played = []; fx.bang(); fx.win(); await new Promise((r) => setTimeout(r, 400)); out.muted = window.__played.slice();
    return out;
  }, SAMPLES);
  try {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(probe);
    await page.goto(s.base + '/overlay', { waitUntil: 'networkidle' });
    const r = await run(page);
    assert.deepEqual([...r.loaded].sort(), [...SAMPLES].sort(), 'all eight recordings decoded');
    for (const n of SAMPLES) assert.ok(r.events[n].some((x) => x.startsWith('rec:')), `${n} plays its recording: ${r.events[n]}`);
    assert.ok(!r.events.bang.includes('synth'), 'the shot is the recording only (no synthesised layer on top)');
    assert.deepEqual(r.muted, [], 'sounds off: nothing plays');
    assert.deepEqual(errors, []);
    // the files cannot be loaded (blocked, offline): every event still sounds, synthesised
    const p2 = await browser.newPage(); const errors2 = []; p2.on('pageerror', (e) => errors2.push(e.message));
    await p2.route('**/roulette/audio/**', (route) => route.fulfill({ status: 404, body: '' }));
    await p2.addInitScript(probe);
    await p2.goto(s.base + '/overlay', { waitUntil: 'networkidle' });
    const f = await run(p2);
    assert.deepEqual(f.loaded, []);
    for (const n of SAMPLES) assert.ok(f.events[n].includes('synth') && !f.events[n].some((x) => x.startsWith('rec:')), `${n} falls back to the synthesised sound: ${f.events[n]}`);
    assert.deepEqual(errors2, []);
  } finally { await browser.close(); await s.stop(); }
});

test('a whole match by chat on the OBS screen plays the recordings on their real events', { skip: !playwright && 'no Playwright', timeout: 240_000 }, async () => {
  const s = await boot();
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer owner-token-roulette-audio-1' };
  const api = async (a, b = {}) => (await fetch(s.base + '/api/admin/' + a, { method: 'POST', headers: H, body: JSON.stringify(b) })).json().catch(() => ({}));
  const party = async () => (await (await fetch(s.base + '/api/state')).json());
  const until = async (fn, ms, what) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(60); } };
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    await api('configure', { mode: 'roulette', variant: { graphics: 'low', drawSpeed: 'normal', resultSeconds: 4, chooseSeconds: 30 } });
    await api('registration-open', { keyword: 'انضم' });
    for (const n of ['سارة', 'أحمد', 'Omar']) await api('simulate', { username: n, text: 'انضم' });
    await until(async () => (await party()).playerCount >= 3, 8000, 'joins'); await api('start');
    const page = await browser.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    // each recording the page plays, by its file (the decoded buffer remembers the URL it came from)
    await page.addInitScript(() => {
      window.__rec = []; const src = new WeakMap(), F = window.fetch, D = BaseAudioContext.prototype.decodeAudioData;
      let last = '';
      window.fetch = function (u, ...a) { const s = String(u); if (s.includes('/roulette/audio/')) last = s.split('/').pop().split('.')[0]; return F.call(this, u, ...a); };
      const names = new WeakMap();
      ArrayBuffer.prototype.__tag = undefined;
      const R = Response.prototype.arrayBuffer;
      Response.prototype.arrayBuffer = function () { const n = this.url.includes('/roulette/audio/') ? this.url.split('/').pop().split('.')[0] : null; return R.call(this).then((b) => { if (n) names.set(b, n); return b; }); };
      BaseAudioContext.prototype.decodeAudioData = function (data, ok, no) { const n = names.get(data); return D.call(this, data, (buf) => { if (n) src.set(buf, n); ok?.(buf); }, no); };
      const B = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...a) { const n = src.get(this.buffer); if (n) window.__rec.push(n); return B.apply(this, a); };
    });
    await page.goto(s.base + '/overlay', { waitUntil: 'networkidle' });
    await page.waitForSelector('#rouletteStage:not([hidden])');
    await page.evaluate(() => { const st = document.querySelector('#rouletteStage'); new MutationObserver(() => { if (st.dataset.scene === 'win' && !window.__winAt) { const p = window.lastLiveverseState?.party; window.__winAt = { late: Date.now() - (p?.phaseStartedAt || 0), phase: p?.phase }; } }).observe(st, { attributes: true }); });
    const outcomes = new Set();
    for (let i = 0; i < 30; i++) {
      const p0 = await until(async () => { const x = (await party()).party; return ['ready', 'finished'].includes(x?.phase) && x; }, 20_000, 'ready');
      if (p0.phase === 'finished') break;
      await api('roulette', { cmd: 'draw', requestId: 'audio-' + i });
      const c = await until(async () => { const x = (await party()).party; return x?.phase === 'choose' && x; }, 15_000, 'choose');
      const holder = (await party()).roster.find((p) => p.number === c.holder.number).name;
      await api('simulate', { username: holder, text: String(c.players.find((x) => x.a && x.n !== c.holder.number).n) });
      const r = await until(async () => { const x = (await party()).party; return ['reveal', 'finished'].includes(x?.phase) && x; }, 20_000, 'reveal');
      outcomes.add(r.result?.outcome || (r.phase === 'finished' ? 'out' : ''));
    }
    await until(async () => (await party()).party?.phase === 'finished', 20_000, 'finished');
    await page.waitForSelector('#rouletteStage[data-scene="win"]'); await sleep(1500);
    const rec = await page.evaluate(() => window.__rec);
    console.log('# win scene: ' + JSON.stringify(await page.evaluate(() => window.__winAt)));
    for (const n of ['picked', 'cock', 'heartbeat', 'bang', 'out', 'win']) assert.ok(rec.includes(n), `${n} played during the match: ${rec}`);
    if (outcomes.has('empty')) { assert.ok(rec.includes('click') && rec.includes('relief'), 'an empty chamber: the dry click and relief: ' + rec); }
    assert.equal(rec.filter((n) => n === 'win').length, 1, 'the fanfare plays once');
    assert.deepEqual(errors, []);
    console.log('# recordings played: ' + rec.join(' '));
  } finally { await browser.close(); await s.stop(); }
});

test('the winner scene starts when the match ends (every screen times the fanfare and the trophy from it)', async () => {
  const { createPartyGame } = await import('../src/party.mjs');
  let t = 1_000_000; const now = () => t;
  const g = createPartyGame('roulette', { now, random: () => 0, resultSeconds: 4 });
  g.start([1, 2].map((n) => ({ id: 'p' + n, name: 'P' + n, number: n })));
  for (const p of g.roster.values()) p.cyl = [p.shots]; // the next pull fires
  const step = () => { if (g.endsAt != null) t = Math.max(t, g.endsAt); return g.tick(); };
  g.draw(); step(); step();
  const h = g.roster.get(g.holder); g.input(h.id, String([...g.roster.values()].find((p) => p.id !== h.id).number));
  step(); // the shot
  assert.equal(g.phase, 'reveal');
  const revealAt = g.phaseStartedAt;
  step(); // the result's time is over: the match ends
  const v = g.view();
  assert.equal(v.phase, 'finished');
  assert.ok(v.winner);
  assert.equal(v.phaseStartedAt, t, 'the winner scene starts now, not when the last result was shown');
  assert.ok(v.phaseStartedAt - revealAt >= 4000);
});
