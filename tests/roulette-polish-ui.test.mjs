// «الروليت» P1 in a real browser, driven by chat comments only: the lock-in beat on the grid (a line from the shooter
// to the target), the kill feed («سارة أقصت أحمد»), the winner's screen (who eliminated whom), the answer when the
// previous target is protected, and the ticking of the holder's last five seconds.
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
const skip = !playwright && 'no Playwright';
const OWNER = 'owner-token-roulette-polish-ui-1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function boot() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, DATABASE_URL: '', PORT: String(port), ADMIN_TOKEN: OWNER, NODE_ENV: 'test', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-rrp-')) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await sleep(50); }
  const base = 'http://127.0.0.1:' + port, H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OWNER };
  const api = async (a, b = {}) => { const r = await fetch(base + '/api/admin/' + a, { method: 'POST', headers: H, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const state = async () => (await fetch(base + '/api/state')).json();
  const until = async (fn, ms, what) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(50); } };
  return { base, api, state, until, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
async function chatMatch(s, variant, names = ['سارة', 'أحمد', 'Omar', 'لينا', 'يوسف']) {
  await s.api('stop'); await s.api('reset');
  for (const [a, b] of [['configure', { mode: 'roulette', variant: { graphics: 'low', ...variant } }], ['registration-open', { keyword: 'انضم' }]]) assert.equal((await s.api(a, b)).status, 200, a);
  for (const n of names) assert.equal((await s.api('simulate', { username: n, text: 'انضم' })).status, 200);
  await s.until(async () => (await s.state()).playerCount >= names.length, 8000, 'joins');
  assert.equal((await s.api('start')).status, 200);
  await s.until(async () => (await s.state()).party?.phase === 'ready', 8000, 'ready');
}
const say = (s, username, text) => s.api('simulate', { username, text });
const nameOf = async (s, n) => (await s.state()).roster.find((p) => p.number === n).name;

test('lock-in beat, kill feed, protected target and the winner\'s screen — a whole match by chat', { skip, timeout: 240_000 }, async () => {
  const s = await boot();
  const browser = await playwright.chromium.launch();
  try {
    await chatMatch(s, { chooseSeconds: 45, drawSpeed: 'fast', resultSeconds: 3, repeatTarget: 'block' });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(s.base + '/overlay', { waitUntil: 'networkidle' });
    await page.waitForSelector('#rouletteStage:not([hidden])');
    let lockSeen = false, killSeen = false, protectedSeen = false, lastTarget = null, guard = 0;
    while ((await s.state()).party?.phase !== 'finished' && guard++ < 40) {
      const p0 = await s.until(async () => { const x = (await s.state()).party; return ['ready', 'finished'].includes(x?.phase) && x; }, 20_000, 'ready');
      if (p0.phase === 'finished') break;
      await s.api('roulette', { cmd: 'draw', requestId: 'polish-' + guard });
      const c = await s.until(async () => { const x = (await s.state()).party; return x?.phase === 'choose' && x; }, 15_000, 'choose');
      const holder = await nameOf(s, c.holder.number);
      const others = c.players.filter((x) => x.a && x.n !== c.holder.number).map((x) => x.n);
      // the previous target is protected: the stream answers, the holder writes another number
      if (lastTarget && others.includes(lastTarget) && others.length > 1 && !protectedSeen) {
        await say(s, holder, String(lastTarget));
        await page.waitForFunction(() => /الدور السابق/.test(document.querySelector('.rr-banner-line')?.textContent || ''), null, { timeout: 5000 });
        protectedSeen = true;
      }
      const target = others.find((n) => n !== lastTarget) ?? others[0];
      await say(s, holder, 'اطلق على ' + target);
      if (!lockSeen) {
        // the lock-in beat: the grid stays, a line goes from the shooter to the target, then the revolver scene
        await page.waitForSelector('#rouletteStage[data-scene="lock"]', { timeout: 2000 });
        assert.ok(await page.isVisible('.rr-lockline'), 'the line from the shooter to the target');
        assert.equal(await page.textContent('.rr-tile.is-target .rr-num'), String(target));
        assert.equal(await page.textContent('.rr-tile.is-holder .rr-num'), String(c.holder.number));
        assert.match(await page.textContent('.rr-h1'), /يصوّب على/);
        await page.screenshot({ path: path.join(os.tmpdir(), 'rr-p1-lock.png') });
        await page.waitForSelector('#rouletteStage[data-scene="shot"]', { timeout: 4000 });
        lockSeen = true;
      }
      const r = await s.until(async () => { const x = (await s.state()).party; return ['reveal', 'finished'].includes(x?.phase) && x; }, 20_000, 'reveal');
      lastTarget = target;
      if (r.result?.outcome === 'out' && !killSeen) {
        const t = await nameOf(s, target);
        await page.waitForFunction((txt) => [...document.querySelectorAll('.rr-log li.is-out')].some((li) => li.textContent.includes(txt)), holder + ' أقصى ' , { timeout: 8000 });
        assert.ok((await page.textContent('.rr-log')).includes(t));
        killSeen = true;
      }
    }
    await s.until(async () => (await s.state()).party?.phase === 'finished', 20_000, 'finished');
    await page.waitForSelector('#rouletteStage[data-scene="win"]');
    await sleep(800);
    assert.match(await page.textContent('.rr-win-rank'), /أقصاه/, 'the ranking says who eliminated each player');
    const w = (await s.state()).party.winner;
    if (w.kills) assert.match(await page.textContent('.rr-win-line'), /أقصى/);
    await page.screenshot({ path: path.join(os.tmpdir(), 'rr-p1-winner.png') });
    assert.ok(lockSeen && killSeen, 'lock-in and kill feed seen');
    // the protected-target answer needs a turn where the previous target is still in and does not hold the turn:
    // the draw is random, so a match may never offer one — play more matches until one does
    for (let m = 0; !protectedSeen && m < 6; m++) {
      await chatMatch(s, { chooseSeconds: 45, drawSpeed: 'fast', resultSeconds: 3, repeatTarget: 'block' });
      let prev = null, g2 = 0;
      while (!protectedSeen && g2++ < 40) {
        const p0 = await s.until(async () => { const x = (await s.state()).party; return ['ready', 'finished'].includes(x?.phase) && x; }, 20_000, 'ready');
        if (p0.phase === 'finished') break;
        await s.api('roulette', { cmd: 'draw', requestId: 'protect-' + m + '-' + g2 });
        const c = await s.until(async () => { const x = (await s.state()).party; return x?.phase === 'choose' && x; }, 15_000, 'choose');
        const holder = await nameOf(s, c.holder.number);
        const others = c.players.filter((x) => x.a && x.n !== c.holder.number).map((x) => x.n);
        if (prev && others.includes(prev) && others.length > 1) {
          await say(s, holder, String(prev));
          await page.waitForFunction(() => /الدور السابق/.test(document.querySelector('.rr-banner-line')?.textContent || ''), null, { timeout: 5000 });
          assert.equal((await s.state()).party.phase, 'choose', 'the protected number does not end the choice');
          protectedSeen = true;
        }
        const target = others.find((n) => n !== prev) ?? others[0];
        await say(s, holder, String(target));
        await s.until(async () => { const x = (await s.state()).party; return ['reveal', 'finished'].includes(x?.phase) && x; }, 20_000, 'reveal');
        prev = target;
      }
    }
    assert.ok(protectedSeen, 'the protected-target answer was seen');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await s.stop(); }
});

test('the holder\'s last five seconds tick (and nothing ticks before)', { skip, timeout: 120_000 }, async () => {
  const s = await boot();
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    await chatMatch(s, { chooseSeconds: 15, drawSpeed: 'fast' });
    const page = await browser.newPage();
    // every sound the page starts while the holder chooses, with the second shown at that moment (the only sounds then)
    await page.addInitScript(() => {
      window.__tickAt = [];
      const P = AudioScheduledSourceNode.prototype, st = P.start;
      P.start = function (...a) { if (document.querySelector('#rouletteStage')?.dataset.phase === 'choose') window.__tickAt.push(document.querySelector('.rr-ring b')?.textContent); return st.apply(this, a); };
    });
    await page.goto(s.base + '/overlay', { waitUntil: 'networkidle' });
    await page.waitForSelector('#rouletteStage:not([hidden])');
    await s.api('roulette', { cmd: 'draw', requestId: 'tick-1' });
    await s.until(async () => (await s.state()).party?.phase === 'choose', 15_000, 'choose');
    await s.until(async () => (await s.state()).party?.phase !== 'choose', 25_000, 'the countdown ends');
    const at = await page.evaluate(() => window.__tickAt);
    const seconds = [...new Set(at)];
    assert.ok(seconds.length >= 4 && seconds.length <= 5, 'one tick per second in the last five: ' + JSON.stringify(at));
    assert.ok(at.every((x) => Number(x) >= 1 && Number(x) <= 5), 'never before the last five seconds: ' + JSON.stringify(at));
  } finally { await browser.close(); await s.stop(); }
});
