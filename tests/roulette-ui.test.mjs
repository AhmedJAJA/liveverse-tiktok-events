// «الروليت» in a real browser: the OBS screen (1920×1080) follows every scene the server publishes — the grid, the
// names reel that stops on the holder, the holder's banner, the revolver scene, the result, the winner; a refresh lands
// in the same scene without replaying it; nothing grows turn after turn. A phone shows the portrait layout (and the
// light SVG prop on «منخفض»). The host's studio has the turn buttons: one click — even a double click — is one turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

let playwright = null;
for (const base of [process.cwd(), (() => { try { return execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } })()]) {
  try { playwright = createRequire(path.join(base, 'x.js'))('playwright'); break; } catch {}
}
const OWNER = 'owner-token-roulette-ui-1';
const dbUrl = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/visual';
let pgOk = false; try { const c = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 2000 }); await c.connect(); await c.end(); pgOk = true; } catch {}
const skip = !playwright ? 'no Playwright' : !pgOk ? 'no PostgreSQL' : false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function boot() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, SKY_GAMES_DEFAULT: '', PORT: String(port), ADMIN_TOKEN: OWNER, NODE_ENV: 'test', SKY_OPEN_SIGNUP: '1', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-rrui-')), DATABASE_URL: dbUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await sleep(50); }
  return { base: 'http://127.0.0.1:' + port, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
async function until(fn, ms, what) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(60); } }
function host(base) {
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OWNER };
  const api = async (a, b = {}) => { const r = await fetch(base + '/api/admin/' + a, { method: 'POST', headers: H, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const state = async () => (await fetch(base + '/api/state')).json();
  return { api, state };
}
/** A trial lobby (twelve test players) with the given rules, started. */
async function match(base, settings) {
  const { api, state } = host(base);
  await api('stop'); await api('flow-end');
  assert.equal((await api('flow-setup', { mode: 'roulette' })).status, 200);
  const s = await api('flow-settings', { settings: { trial: true, ...settings } }); assert.equal(s.status, 200, JSON.stringify(s));
  assert.equal((await api('flow-begin')).status, 200);
  await until(async () => { const x = await state(); return x.flow.state === 'REGISTRATION_OPEN' && x.playerCount >= 12; }, 20_000, 'trial lobby');
  return { api, state };
}

test('the OBS screen follows every scene of a match, a refresh lands in the same scene, nothing piles up', { skip, timeout: 240_000 }, async () => {
  const srv = await boot();
  const browser = await playwright.chromium.launch();
  try {
    const { api, state } = await match(srv.base, { targetMode: 'choose', chooseSeconds: 15, drawSpeed: 'fast', resultSeconds: 5, graphics: 'auto' });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(srv.base + '/overlay', { waitUntil: 'networkidle' });
    // before the start: the registration screen, not the stage
    assert.equal(await page.isVisible('#registrationOverlay'), true);
    assert.equal(await page.locator('#rouletteStage').count() === 0 || await page.locator('#rouletteStage').isHidden(), true);
    assert.equal((await api('flow-start', { requestId: 'ui-start-0001' })).status, 200);
    const party = () => page.evaluate(() => window.lastLiveverseState?.party || null);
    const scene = () => page.getAttribute('#rouletteStage', 'data-scene');
    await page.waitForSelector('#rouletteStage:not([hidden])', { timeout: 15_000 });
    await until(async () => (await scene()) === 'grid' && (await page.locator('.rr-tile').count()) === 12, 10_000, 'the grid');
    assert.equal(await page.isVisible('#roundResultsOverlay'), false);
    assert.equal(await page.textContent('.rr-stat.is-in b'), '12');
    assert.ok(await page.isVisible('.rr-pill.is-trial'), 'trial players are labelled as such');
    assert.match(await page.textContent('.rr-rules'), /1 من 2/, 'the odds are on screen');
    assert.equal(await page.locator('#rouletteStage :is(button,a,input)').count(), 0, 'the OBS screen has no host controls');
    const nodes = [];
    let seen = { out: 0, empty: 0 }, first = true;
    for (let turn = 0; turn < 30 && (!seen.out || !seen.empty || first); turn++) {
      await until(async () => (await party())?.phase === 'ready', 15_000, 'ready');
      nodes.push(await page.evaluate(() => document.getElementsByTagName('*').length));
      assert.equal((await api('roulette', { cmd: 'draw', requestId: 'ui-draw-' + String(turn).padStart(3, '0') })).status, 200);
      if (first) {
        await until(async () => (await scene()) === 'draw', 5000, 'the reel');
        // the reel stops exactly on the holder, in the window
        const p = await until(async () => { const x = await party(); return x?.phase === 'picked' && x; }, 8000, 'picked');
        await sleep(250);
        const hit = await page.evaluate(() => { const w = document.querySelector('.rr-window').getBoundingClientRect(), c = document.querySelector('.rr-card.is-stop').getBoundingClientRect(); return { dy: Math.abs((w.top + w.height / 2) - (c.top + c.height / 2)), n: Number(document.querySelector('.rr-card.is-stop .rr-card-num').textContent) }; });
        assert.equal(hit.n, p.holder.number); assert.ok(hit.dy < 6, 'centred in the window: ' + hit.dy);
        assert.match(await page.textContent('.rr-h1'), /الدور على/);
        // the holder chooses: banner, countdown, the holder's tile marked
        const c = await until(async () => { const x = await party(); return x?.phase === 'choose' && x; }, 6000, 'choose');
        assert.equal(await page.isVisible('.rr-banner'), true);
        assert.match(await page.textContent('.rr-banner-name'), new RegExp('#' + c.holder.number));
        assert.equal(await page.getAttribute('.rr-tile.is-holder .rr-num', 'class') !== null, true);
        assert.equal(await page.textContent('.rr-tile.is-holder .rr-num'), String(c.holder.number));
        const left = Number(await until(async () => (await page.textContent('.rr-ring b')) || null, 3000, 'countdown')); assert.ok(left >= 8 && left <= 15, 'countdown ' + left);
        await api('roulette', { cmd: 'random' });
        await until(async () => (await scene()) === 'shot', 5000, 'the revolver scene');
        assert.equal(await page.getAttribute('#rouletteStage', 'data-tone'), 'tense');
        assert.match(await page.textContent('.rr-cyl-text'), /الحجرة 1 من 2/);
        first = false;
      } else {
        const ph = await until(async () => { const x = await party(); return ['choose', 'aim', 'reveal'].includes(x?.phase) && x.phase; }, 12_000, 'turn');
        if (ph === 'choose') await api('roulette', { cmd: 'random' });
      }
      const r = await until(async () => { const x = await party(); return x?.phase === 'reveal' && x; }, 10_000, 'reveal');
      const outcome = r.result.outcome;
      await page.waitForSelector(outcome === 'out' ? '.rr-shot-scene.is-hit' : '.rr-shot-scene.is-safe', { timeout: 4000 });
      assert.equal(await page.getAttribute('#rouletteStage', 'data-tone'), outcome === 'out' ? 'out' : 'safe');
      assert.match(await page.textContent('.rr-h1'), outcome === 'out' ? /انطلقت الطلقة/ : /حجرة فارغة/);
      if (!seen[outcome]) {
        // a refresh in the middle of the result: the same scene, its end state, no replay
        await page.reload({ waitUntil: 'networkidle' });
        nodes.length = 0; // a new page: count again from here
        await page.waitForSelector('#rouletteStage:not([hidden])', { timeout: 10_000 });
        const landed = await until(() => page.evaluate((turn) => {
          const x = window.lastLiveverseState?.party, el = document.querySelector('.rr-shot-scene');
          if (!x || x.phase !== 'reveal' || x.turn !== turn) return 'moved on';
          return el && el.classList.contains('is-on') && el.classList.contains('is-settled') ? (el.classList.contains('is-hit') ? 'out' : el.classList.contains('is-safe') ? 'empty' : 'none') : null;
        }, r.turn), 6000, 'the same scene after a refresh');
        if (landed !== 'moved on') assert.equal(landed, outcome, 'the refreshed screen shows the same outcome, settled');
      }
      seen[outcome]++;
    }
    assert.ok(seen.out && seen.empty, 'both outcomes were shown: ' + JSON.stringify(seen));
    // the events log on the side, after the scene returns to the grid
    await until(async () => (await scene()) === 'grid', 8000, 'grid');
    assert.ok(await page.locator('.rr-log li').count() >= 2);
    // play to the end (counting the page at every new turn)
    let lastTurn = -1;
    for (let i = 0; i < 400; i++) {
      const x = await party(); if (!x || x.phase === 'finished') break;
      if (x.phase === 'ready' && x.turn !== lastTurn) { lastTurn = x.turn; nodes.push(await page.evaluate(() => document.getElementsByTagName('*').length)); }
      if (x.phase === 'ready') await api('roulette', { cmd: 'draw', requestId: 'ui-end-' + String(i).padStart(4, '0') });
      else if (x.phase === 'choose') await api('roulette', { cmd: 'random' });
      else await api('roulette', { cmd: 'skip' });
      await sleep(40);
    }
    const end = await until(async () => { const x = await party(); return x?.phase === 'finished' && x; }, 15_000, 'the winner');
    await until(async () => (await scene()) === 'win', 5000, 'the winner scene');
    const roster = (await state()).roster;
    assert.match(await page.textContent('.rr-win-name'), new RegExp(roster.find((p) => p.number === end.winner.number).name));
    assert.equal(await page.isVisible('#roundResultsOverlay'), false, 'the roulette shows its own winner screen');
    assert.equal(await page.isVisible('#winnerBanner'), false);
    assert.match(await page.textContent('.rr-win-note'), /تجريبية/);
    assert.ok(await page.locator('.rr-confetti i').count() > 0);
    assert.equal(await page.textContent('.rr-stat.is-in b'), '1');
    // turn after turn, the page does not grow
    // (the first turn of a page builds the reel and the prop once; after that the count stays flat)
    const steady = nodes.slice(1);
    assert.ok(steady.length >= 5 && Math.max(...steady) - Math.min(...steady) < 40, 'DOM nodes per turn: ' + nodes.join(','));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await srv.stop(); }
});

test('a phone shows the portrait stage; «منخفض» draws the light SVG prop; «عالٍ» the WebGL one', { skip, timeout: 180_000 }, async () => {
  const srv = await boot();
  const browser = await playwright.chromium.launch();
  try {
    const { api } = await match(srv.base, { targetMode: 'self', drawSpeed: 'fast', resultSeconds: 4, graphics: 'low' });
    const phone = await browser.newContext({ ...playwright.devices['Pixel 5'] });
    const page = await phone.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(srv.base + '/overlay', { waitUntil: 'networkidle' });
    assert.equal((await api('flow-start', {})).status, 200);
    await page.waitForSelector('#rouletteStage:not([hidden])', { timeout: 15_000 });
    const party = () => page.evaluate(() => window.lastLiveverseState?.party || null);
    await until(async () => (await party())?.phase === 'ready', 8000, 'ready');
    const geo = await page.evaluate(() => { const s = document.querySelector('.rr-side').getBoundingClientRect(), g = document.querySelector('.rr-grid').getBoundingClientRect(); return { sideTop: s.top, gridBottom: g.bottom, sw: document.documentElement.scrollWidth, w: innerWidth }; });
    assert.ok(geo.sideTop >= geo.gridBottom - 1, 'portrait: the panel is under the grid ' + JSON.stringify(geo));
    assert.ok(geo.sw <= geo.w, 'no sideways scroll');
    await api('roulette', { cmd: 'draw', requestId: 'ui-phone-0001' });
    await until(async () => (await page.getAttribute('#rouletteStage', 'data-scene')) === 'shot', 12_000, 'shot');
    await page.waitForSelector('#rouletteStage[data-gfx="2d"] .rr-shot-scene svg.rr-svg', { timeout: 8000 });
    // every tile fits the screen
    assert.deepEqual(errors, []);
    await phone.close();
    // a hundred players: every one of them on the grid, inside it, on OBS and on a phone
    await api('stop');
    const big = await match(srv.base, { maxPlayers: 100, graphics: 'low' });
    const added = await big.api('demo-players', { count: 88 });
    assert.equal(added.status, 200, JSON.stringify(added));
    await until(async () => (await big.state()).playerCount === 100, 8000, '100 players');
    assert.equal((await big.api('flow-start', {})).status, 200);
    for (const size of [{ width: 1920, height: 1080 }, { width: 393, height: 851 }]) {
      const pg100 = await browser.newPage({ viewport: size });
      await pg100.goto(srv.base + '/overlay', { waitUntil: 'networkidle' });
      await pg100.waitForSelector('#rouletteStage:not([hidden])', { timeout: 15_000 });
      await until(async () => (await pg100.locator('.rr-tile').count()) === 100, 8000, '100 tiles');
      await sleep(300);
      const fit = await pg100.evaluate(() => { const g = document.querySelector('.rr-grid').getBoundingClientRect(); return [...document.querySelectorAll('.rr-tile')].filter((t) => { const r = t.getBoundingClientRect(); return r.top < g.top - 1 || r.bottom > g.bottom + 1 || r.left < g.left - 1 || r.right > g.right + 1; }).length; });
      assert.equal(fit, 0, 'tiles outside the grid at ' + size.width + 'px');
      await pg100.close();
    }
    // «عالٍ»: a WebGL canvas when the browser has WebGL
    const desk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const webgl = await desk.evaluate(() => { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); });
    await api('stop');
    const m2 = await match(srv.base, { targetMode: 'self', drawSpeed: 'fast', resultSeconds: 4, graphics: 'high' });
    await desk.goto(srv.base + '/overlay', { waitUntil: 'networkidle' });
    assert.equal((await m2.api('flow-start', {})).status, 200);
    await desk.waitForSelector('#rouletteStage:not([hidden])', { timeout: 15_000 });
    await until(async () => (await desk.evaluate(() => window.lastLiveverseState?.party?.phase)) === 'ready', 8000, 'ready');
    await m2.api('roulette', { cmd: 'draw', requestId: 'ui-desk-0001' });
    await until(async () => (await desk.getAttribute('#rouletteStage', 'data-scene')) === 'shot', 15_000, 'shot');
    if (webgl) await desk.waitForSelector('#rouletteStage[data-gfx="3d"] .rr-shot-scene canvas.rr-gl', { timeout: 20_000 });
    else await desk.waitForSelector('#rouletteStage[data-gfx="2d"]', { timeout: 8000 });
  } finally { await browser.close(); await srv.stop(); }
});

test('the studio: the turn buttons follow the scene; a double click or Space draws one turn; Android width', { skip, timeout: 180_000 }, async () => {
  const srv = await boot();
  const browser = await playwright.chromium.launch();
  try {
    const { api, state } = await match(srv.base, { targetMode: 'choose', chooseSeconds: 15, drawSpeed: 'fast', resultSeconds: 3 });
    assert.equal((await api('flow-start', {})).status, 200);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { Authorization: 'Bearer ' + OWNER } });
    await ctx.addInitScript((t) => { try { sessionStorage.setItem('liveverse_admin', t); } catch {} }, OWNER);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(srv.base + '/game/roulette', { waitUntil: 'networkidle' });
    await page.waitForSelector('#rrControls:not([hidden])', { timeout: 20_000 });
    assert.equal(await page.isVisible('#advanceButton'), false, 'the roulette has its own «تخطي المشهد»');
    assert.equal(await page.getAttribute('#liveFrame', 'allow'), 'autoplay; fullscreen');
    await until(async () => !(await page.isDisabled('#rrDraw')), 8000, 'draw enabled');
    // a double click: one turn
    await page.dblclick('#rrDraw');
    await until(async () => (await state()).party.turn === 1, 6000, 'turn 1');
    await sleep(600);
    assert.equal((await state()).party.turn, 1, 'one turn for a double click');
    await until(async () => page.isDisabled('#rrDraw'), 3000, 'draw disabled during the turn');
    // the holder chooses: random target, cancel and «إقصاء صاحب الدور» appear
    await until(async () => (await state()).party.phase === 'choose', 10_000, 'choose');
    await until(async () => page.isVisible('#rrRandom'), 3000, 'random button');
    assert.ok(await page.isVisible('#rrCancel')); assert.ok(await page.isVisible('#rrOut'));
    assert.match(await page.textContent('#rrState'), /صاحب الدور يختار/);
    await page.click('#rrRandom');
    await until(async () => ['aim', 'reveal'].includes((await state()).party.phase), 5000, 'aim');
    await page.click('#rrSkip');
    await until(async () => ['reveal', 'ready'].includes((await state()).party.phase), 5000, 'skipped');
    await until(async () => (await state()).party.phase === 'ready', 8000, 'ready again');
    await until(async () => !(await page.isDisabled('#rrDraw')), 5000, 'draw enabled again');
    // Space draws (not while typing)
    await page.keyboard.press('Space');
    await until(async () => (await state()).party.turn === 2, 5000, 'turn 2 by Space');
    assert.deepEqual(errors, []);
    // Android width: the controls wrap, nothing scrolls sideways
    await page.setViewportSize({ width: 412, height: 915 });
    await sleep(400);
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, bar: document.getElementById('rrControls').getBoundingClientRect().width }));
    assert.ok(w.sw <= w.w && w.bar <= w.w, JSON.stringify(w));
    await ctx.close();
  } finally { await browser.close(); await srv.stop(); }
});
