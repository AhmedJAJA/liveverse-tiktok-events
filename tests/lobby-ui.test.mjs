// The studio's waiting room («غرفة الانتظار»): slim nameplates (photo or frame, name, where the player comes from, number),
// the remove button beside each plate, one main action in the bar — and on a phone the bar stays one row.
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
const OWNER = 'owner-token-lobby-ui-1';
const dbUrl = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/visual';
let pgOk = false; try { const c = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 2000 }); await c.connect(); await c.end(); pgOk = true; } catch {}
const skip = !playwright ? 'no Playwright' : !pgOk ? 'no PostgreSQL' : false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function boot() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, SKY_GAMES_DEFAULT: '', PORT: String(port), ADMIN_TOKEN: OWNER, NODE_ENV: 'test', SKY_OPEN_SIGNUP: '1', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-lbui-')), DATABASE_URL: dbUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
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

async function openLobby(browser, base, viewport) {
  const ctx = await browser.newContext({ viewport, extraHTTPHeaders: { Authorization: 'Bearer ' + OWNER } });
  await ctx.addInitScript((t) => { try { sessionStorage.setItem('liveverse_admin', t); } catch {} }, OWNER);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/game/roulette', { waitUntil: 'networkidle' });
  await page.waitForSelector('#lobbyView', { state: 'visible', timeout: 20_000 });
  await page.waitForSelector('#lbList .lb-player', { timeout: 10_000 });
  return { page, errors, close: () => ctx.close() };
}

test('the waiting room: a nameplate per player, remove beside it, registration button says what it does', { skip, timeout: 180_000 }, async () => {
  const srv = await boot();
  const browser = await playwright.chromium.launch();
  try {
    const { api, state } = await match(srv.base, {});
    await api('simulate', { username: 'ريوف', text: (await state()).registration.keyword });
    await until(async () => (await state()).playerCount >= 13, 8000, 'a viewer joined');
    const { page, errors, close } = await openLobby(browser, srv.base, { width: 1280, height: 720 });
    const plates = await page.evaluate(() => [...document.querySelectorAll('#lbList .lb-player')].map((li) => ({
      name: li.querySelector('.lb-plate .fr-plate bdi')?.textContent, num: li.querySelector('.lb-plate .lb-num')?.textContent,
      tag: li.querySelector('.lb-plate .lb-tag')?.textContent, av: !!li.querySelector('.lb-plate .lb-av'), rm: !!li.querySelector(':scope > .lb-rm'),
      bot: li.classList.contains('is-bot'), h: Math.round(li.querySelector('.lb-plate').getBoundingClientRect().height),
    })));
    assert.equal(plates.length, 13);
    for (const p of plates) { assert.ok(p.name && p.num && p.av && p.rm, JSON.stringify(p)); assert.ok(p.h <= 56, 'slim: ' + p.h); }
    assert.equal(plates.filter((p) => p.bot).every((p) => p.tag === 'تجريبي'), true, 'trial players are marked');
    const viewer = plates.find((p) => p.name === 'ريوف'); assert.ok(viewer && !viewer.bot);
    // remove the viewer from the list
    await page.click('#lbList .lb-player:has(bdi:text-is("ريوف")) .lb-rm');
    await until(async () => (await state()).playerCount === 12, 6000, 'removed');
    await page.waitForFunction(() => ![...document.querySelectorAll('#lbList bdi')].some((b) => b.textContent === 'ريوف'));
    // the registration button names its action and follows the state
    assert.equal(await page.textContent('#lbRegToggleText'), 'إغلاق التسجيل');
    await page.click('#lbRegToggle');
    await until(async () => (await state()).registration.phase !== 'open', 6000, 'closed');
    await page.waitForFunction(() => document.querySelector('#lbRegToggleText').textContent === 'فتح التسجيل' && document.querySelector('#lbRegToggle').dataset.open === 'false');
    // one main action
    const mains = await page.evaluate(() => [...document.querySelectorAll('.lb-bar .lb-main')].map((b) => b.id));
    assert.deepEqual(mains, ['lbStart']);
    assert.deepEqual(errors, []);
    await close();
  } finally { await browser.close(); await srv.stop(); }
});

test('the waiting room on a phone: the bar is one row, nothing scrolls sideways, every button keeps its name', { skip, timeout: 180_000 }, async () => {
  const srv = await boot();
  const browser = await playwright.chromium.launch();
  try {
    await match(srv.base, {});
    const { page, errors, close } = await openLobby(browser, srv.base, { width: 360, height: 760 });
    const m = await page.evaluate(() => {
      const bar = document.querySelector('.lb-bar').getBoundingClientRect();
      const btns = [...document.querySelectorAll('.lb-bar button')].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return { id: b.id, mid: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), name: b.textContent.trim() }; });
      return { barH: Math.round(bar.height), btns, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert.ok(m.barH <= 84, 'the bar stays small: ' + m.barH);
    assert.ok(Math.max(...m.btns.map((b) => b.mid)) - Math.min(...m.btns.map((b) => b.mid)) <= 2, 'one row: ' + JSON.stringify(m.btns));
    for (const b of m.btns) { assert.ok(b.name.length > 2, 'named for screen readers: ' + b.id); assert.ok(b.h >= 44 && b.w >= 44, 'big enough to tap: ' + JSON.stringify(b)); }
    assert.ok(m.overflow <= 0, 'no sideways scroll: ' + m.overflow);
    assert.deepEqual(errors, []);
    await close();
  } finally { await browser.close(); await srv.stop(); }
});
