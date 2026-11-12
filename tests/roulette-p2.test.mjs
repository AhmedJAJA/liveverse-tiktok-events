// «الروليت» P2 in a real browser: a revolver without the sponge (WebGL and SVG props), the light trophy never covers the
// winner's card, and the duel table (shooter and target face each other across the revolver, with their skins).
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
const OWNER = 'owner-token-roulette-p2-1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function boot() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, DATABASE_URL: '', PORT: String(port), ADMIN_TOKEN: OWNER, NODE_ENV: 'test', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-rr2-')) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await sleep(50); }
  const base = 'http://127.0.0.1:' + port, H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OWNER };
  const api = async (a, b = {}) => { const r = await fetch(base + '/api/admin/' + a, { method: 'POST', headers: H, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const state = async () => (await fetch(base + '/api/state')).json();
  const until = async (fn, ms, what) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(50); } };
  return { base, api, state, until, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
async function chatMatch(s, variant, names = ['سارة', 'أحمد', 'Omar']) {
  await s.api('stop'); await s.api('reset');
  for (const [a, b] of [['configure', { mode: 'roulette', variant }], ['registration-open', { keyword: 'انضم' }]]) assert.equal((await s.api(a, b)).status, 200, a);
  for (const n of names) assert.equal((await s.api('simulate', { username: n, text: 'انضم' })).status, 200);
  await s.until(async () => (await s.state()).playerCount >= names.length, 8000, 'joins');
  assert.equal((await s.api('start')).status, 200);
  await s.until(async () => (await s.state()).party?.phase === 'ready', 8000, 'ready');
}
const nameOf = async (s, n) => (await s.state()).roster.find((p) => p.number === n).name;
/** Plays every turn by chat (the holder names the first other player) until the match has a winner. */
async function playToWinner(s) {
  for (let i = 0; i < 40; i++) {
    const p0 = await s.until(async () => { const x = (await s.state()).party; return ['ready', 'finished'].includes(x?.phase) && x; }, 20_000, 'ready');
    if (p0.phase === 'finished') return;
    await s.api('roulette', { cmd: 'draw', requestId: 'p2-' + i });
    const c = await s.until(async () => { const x = (await s.state()).party; return x?.phase === 'choose' && x; }, 15_000, 'choose');
    const other = c.players.find((x) => x.a && x.n !== c.holder.number).n;
    await s.api('simulate', { username: await nameOf(s, c.holder.number), text: String(other) });
    await s.api('roulette', { cmd: 'skip' }).catch(() => {});
  }
  throw new Error('no winner');
}

/** Hue (0–360), saturation and lightness (0–1) of a CSS colour. */
const HSL = `(c) => { const m = c.match(/[\\d.]+/g).map(Number); let [r, g, b] = m.slice(0, 3).map((x) => x / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return { h: 0, s: 0, l }; const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return { h: (h * 60 + 360) % 360, s, l }; }`;
/** «sponge yellow»: a bright, saturated yellow (the old grip). */
const isSpongeYellow = ({ h, s, l }) => h >= 40 && h <= 62 && s > 0.6 && l > 0.45;

test('the revolver has no sponge: WebGL prop and light SVG prop have a dark, solid grip', { skip, timeout: 120_000 }, async () => {
  for (const f of ['public/roulette/revolver3d.js', 'public/roulette/revolver2d.js']) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /sponge|pores/i, f + ' still builds a sponge');
  const s = await boot();
  const browser = await playwright.chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(s.base + '/overlay', { waitUntil: 'networkidle' });
    // the light SVG prop: the grip is a named part, filled with a dark (wood/rubber) gradient, never yellow
    const grip2d = await page.evaluate(async (hsl) => {
      const toHsl = eval(hsl);
      const { createStage2D } = await import('/roulette/revolver2d.js');
      const g = createStage2D({ chambers: 3 }); document.body.append(g.canvas); g.frame({ scene: 'revolver', phase: 'reveal', ms: 0, chambers: 3 });
      const grip = g.canvas.querySelector('[data-part="grip"]'); if (!grip) return null;
      const id = (grip.getAttribute('fill').match(/#([^)]+)\)/) || [])[1];
      const paint = id && g.canvas.getElementById(id);
      const stops = paint ? [...paint.querySelectorAll('stop')].map((x) => getComputedStyle(x).stopColor) : [getComputedStyle(grip).fill];
      const rect = paint?.tagName === 'pattern' ? [...paint.querySelectorAll('rect,path')].map((x) => getComputedStyle(x).fill).filter((c) => c.startsWith('rgb')) : [];
      return { colours: [...stops, ...rect].map(toHsl), pattern: paint?.tagName };
    }, HSL);
    assert.ok(grip2d, 'the SVG prop names its grip (data-part="grip")');
    assert.ok(grip2d.colours.length >= 2, 'the grip is shaded, not flat');
    for (const c of grip2d.colours) assert.ok(!isSpongeYellow(c), 'no sponge-yellow on the SVG grip: ' + JSON.stringify(c));
    assert.ok(grip2d.colours.every((c) => c.l < 0.5), 'a dark grip (wood/rubber): ' + JSON.stringify(grip2d.colours));
    // the WebGL prop: no sponge material; the grip is dark and has a surface relief (checkering)
    const webgl = await page.evaluate(() => { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); });
    if (webgl) {
      const grip3d = await page.evaluate(async () => {
        const { createStage3D } = await import('/roulette/revolver3d.js');
        const g = await createStage3D({ chambers: 3, quality: 'high' });
        const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0'; document.body.append(host); g.attach(host);
        g.frame({ scene: 'revolver', phase: 'reveal', ms: 0, chambers: 3, at: 0.5 });
        const d = g.describe();
        g.dispose(); host.remove();
        return d;
      });
      assert.ok(!grip3d.materials.some((m) => /sponge/i.test(m)), 'no sponge material: ' + grip3d.materials);
      assert.ok(grip3d.grip, 'the revolver has a grip part');
      const [r, g, b] = grip3d.grip.color; const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
      assert.ok(l < 0.5, 'a dark grip: ' + grip3d.grip.color);
      assert.ok(!(r > 0.8 && g > 0.6 && b < 0.4), 'not sponge-yellow: ' + grip3d.grip.color);
      assert.ok(grip3d.grip.relief, 'the grip has a relief map (checkering)');
    } else test.diagnostic('no WebGL here: the 3D prop was checked from its source only');
  } finally { await browser.close(); await s.stop(); }
});

for (const [label, viewport] of [['landscape', { width: 1920, height: 1080 }], ['portrait', { width: 1080, height: 1920 }]]) {
  test(`«منخفض»: the winner's trophy never covers the winner's card or the ranking (${label})`, { skip, timeout: 180_000 }, async () => {
    const s = await boot();
    const browser = await playwright.chromium.launch();
    try {
      await chatMatch(s, { graphics: 'low', drawSpeed: 'fast', resultSeconds: 3, chooseSeconds: 30 });
      const page = await browser.newPage({ viewport });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(s.base + '/overlay', { waitUntil: 'networkidle' });
      await page.waitForSelector('#rouletteStage:not([hidden])');
      await playToWinner(s);
      await page.waitForSelector('#rouletteStage[data-scene="win"][data-gfx="2d"]', { timeout: 20_000 });
      await sleep(2600); // the trophy has risen and the ranking has come in
      const boxes = await page.evaluate(() => {
        const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const svg = document.querySelector('.rr-win-gl svg.rr-svg');
        const trophy = svg && svg.querySelector('[data-part="trophy"]');
        const card = ['.rr-win-name', '.rr-win-line', '.rr-win-stats', '.rr-win-rank', '.rr-win-avbox'].map((q) => [q, document.querySelector(q)]).filter(([, el]) => el && el.offsetParent);
        return { trophy: trophy && r(trophy), card: card.map(([q, el]) => [q, r(el)]) };
      });
      assert.ok(boxes.trophy, 'the light trophy is named (data-part="trophy")');
      assert.ok(boxes.trophy.r - boxes.trophy.l > 120, 'the trophy is on screen and not tiny');
      for (const [q, b] of boxes.card) {
        const ix = Math.min(b.r, boxes.trophy.r) - Math.max(b.l, boxes.trophy.l), iy = Math.min(b.b, boxes.trophy.b) - Math.max(b.t, boxes.trophy.t);
        assert.ok(ix <= 2 || iy <= 2, `the trophy covers ${q}: ${JSON.stringify({ trophy: boxes.trophy, [q]: b })}`);
      }
      await page.screenshot({ path: path.join(os.tmpdir(), `rr-p2-trophy-${label}.png`) });
      assert.deepEqual(errors, []);
    } finally { await browser.close(); await s.stop(); }
  });
}

for (const [label, viewport] of [['landscape', { width: 1920, height: 1080 }], ['portrait', { width: 1080, height: 1920 }]]) {
  test(`the duel: the shooter faces the target across the revolver, both with their photo/skin, nothing overlaps (${label})`, { skip, timeout: 180_000 }, async () => {
    const s = await boot();
    const browser = await playwright.chromium.launch();
    try {
      await chatMatch(s, { graphics: 'low', drawSpeed: 'normal', resultSeconds: 4, chooseSeconds: 30 }, ['سارة', 'أحمد', 'Omar', 'لينا']);
      const page = await browser.newPage({ viewport });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(s.base + '/overlay', { waitUntil: 'networkidle' });
      await page.waitForSelector('#rouletteStage:not([hidden])');
      await s.api('roulette', { cmd: 'draw', requestId: 'duel-1' });
      const c = await s.until(async () => { const x = (await s.state()).party; return x?.phase === 'choose' && x; }, 15_000, 'choose');
      const holder = await nameOf(s, c.holder.number);
      const target = c.players.find((x) => x.a && x.n !== c.holder.number).n;
      await s.api('simulate', { username: holder, text: 'اطلق على ' + target });
      await page.waitForSelector('#rouletteStage[data-scene="shot"]', { timeout: 6000 });
      await sleep(400);
      const d = await page.evaluate(() => {
        const r = (el) => { if (!el || !el.offsetParent) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const sh = document.querySelector('.rr-shooter');
        return {
          shooter: r(sh), num: sh?.querySelector('.rr-shooter-num')?.textContent, name: sh?.querySelector('.rr-shooter-name')?.textContent, photo: !!sh?.querySelector('.rr-av'),
          others: Object.fromEntries(['.rr-target-ring', '.rr-target-name', '.rr-hud', '.rr-target-by'].map((q) => [q, r(document.querySelector(q))])),
          table: !!document.querySelector('.rr-shot-scene [data-part="table"]'),
        };
      });
      assert.ok(d.shooter, 'the shooter (the holder who chose) is on screen');
      assert.equal(d.num, '#' + c.holder.number); assert.ok(d.name.includes(holder)); assert.ok(d.photo, 'with their photo or equipped skin');
      for (const [q, b] of Object.entries(d.others)) {
        if (!b) continue;
        const ix = Math.min(b.r, d.shooter.r) - Math.max(b.l, d.shooter.l), iy = Math.min(b.b, d.shooter.b) - Math.max(b.t, d.shooter.t);
        assert.ok(ix <= 2 || iy <= 2, `the shooter covers ${q}: ${JSON.stringify({ shooter: d.shooter, [q]: b })}`);
      }
      assert.ok(d.table, 'the revolver lies on the duel table (light prop)');
      await page.screenshot({ path: path.join(os.tmpdir(), `rr-p2-duel-${label}.png`) });
      assert.deepEqual(errors, []);
    } finally { await browser.close(); await s.stop(); }
  });
}

test('the 3D duel table and camera: a table under the revolver; the camera moves with the server clock, the same moment looks the same; calm with reduced motion', { skip, timeout: 120_000 }, async () => {
  const s = await boot();
  const browser = await playwright.chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(s.base + '/overlay', { waitUntil: 'networkidle' });
    const webgl = await page.evaluate(() => { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); });
    if (!webgl) { test.diagnostic('no WebGL here'); return; }
    const r = await page.evaluate(async () => {
      const { createStage3D } = await import('/roulette/revolver3d.js');
      const g = await createStage3D({ chambers: 6, quality: 'high' });
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0'; document.body.append(host); g.attach(host);
      const at = (o) => { g.frame({ scene: 'revolver', phase: 'aim', chambers: 6, chamberTop: 1, at: 0.5, clock: 0, ...o }); return g.describe(); };
      const a = at({ u: 0.15 }), b = at({ u: 0.8 }), a2 = at({ u: 0.15 }), ca = at({ u: 0.15, reduced: true }), cb = at({ u: 0.8, reduced: true });
      g.frame({ scene: 'revolver', phase: 'reveal', ms: 140, outcome: 'out', chambers: 6, chamberTop: 1, at: 0.5, clock: 0 });
      const shot = g.describe();
      const calls = g.info().render.calls;
      g.dispose(); host.remove();
      return { a, b, a2, ca, cb, shot, calls };
    });
    assert.ok(r.a.materials.includes('felt') && r.a.materials.includes('wood'), 'the duel table: felt and a wooden rim — ' + r.a.materials);
    assert.notDeepEqual(r.a.camera, r.b.camera, 'the camera moves during the aim');
    assert.deepEqual(r.a.camera, r.a2.camera, 'the same moment on the clock gives the same shot (every screen in sync)');
    const yaw = (c) => Math.atan2(c.position[0] - c.target[0], c.position[2] - c.target[2]);
    assert.ok(Math.abs(yaw(r.a.camera) - yaw(r.b.camera)) > 0.15, 'the camera swings round the table during the aim');
    assert.ok(Math.abs(yaw(r.ca.camera) - yaw(r.cb.camera)) < 0.02, 'reduced motion: no orbit (only the slow push-in)');
    assert.ok(r.shot.camera.position[2] < r.b.camera.position[2], 'the shot punches in');
    assert.ok(r.calls < 90, 'draw calls stay small: ' + r.calls);
  } finally { await browser.close(); await s.stop(); }
});
