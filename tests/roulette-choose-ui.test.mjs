// «الروليت» in a real browser, driven by chat comments (the path TikTok and Kick use): the holder's wrong numbers get
// an answer on the stream screen, a valid number locks the target in («سارة تصوّب على أحمد»), and the sound is never
// silently lost — a browser that blocks sound says so (OBS never does), the OBS screen ignores a viewer's saved mute,
// and a viewer's sound switch reaches the embedded game screen at once.
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
const OWNER = 'owner-token-roulette-choose-ui-1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function boot() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, DATABASE_URL: '', PORT: String(port), ADMIN_TOKEN: OWNER, NODE_ENV: 'test', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-rrc-')) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await sleep(50); }
  const base = 'http://127.0.0.1:' + port, H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OWNER };
  const api = async (a, b = {}) => { const r = await fetch(base + '/api/admin/' + a, { method: 'POST', headers: H, body: JSON.stringify(b) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const state = async () => (await fetch(base + '/api/state')).json();
  const until = async (fn, ms, what) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(60); } };
  return { base, api, state, until, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
/** A match with viewers who joined from the chat (no trial players), started by the owner. */
async function chatMatch(s, variant, names = ['سارة', 'أحمد', 'Omar', 'لينا', 'يوسف']) {
  for (const [a, b] of [['configure', { mode: 'roulette', variant }], ['registration-open', { keyword: 'انضم' }]]) assert.equal((await s.api(a, b)).status, 200, a);
  for (const n of names) assert.equal((await s.api('simulate', { username: n, text: 'انضم' })).status, 200);
  await s.until(async () => (await s.state()).playerCount >= names.length, 8000, 'joins');
  assert.equal((await s.api('start')).status, 200);
  await s.until(async () => (await s.state()).party?.phase === 'ready', 8000, 'ready');
}
const say = (s, username, text) => s.api('simulate', { username, text });
/** Count every sound the page starts (Web Audio), and keep the audio engine so its state can be read. */
const soundProbe = () => { window.__snd = 0; const P = AudioScheduledSourceNode.prototype, st = P.start; P.start = function (...a) { window.__snd++; return st.apply(this, a); }; };

test('the holder\'s wrong numbers are answered on the stream screen; a valid number locks the target in', { skip, timeout: 120_000 }, async () => {
  const s = await boot();
  const browser = await playwright.chromium.launch();
  try {
    await chatMatch(s, { chooseSeconds: 45, drawSpeed: 'fast' });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(s.base + '/overlay', { waitUntil: 'networkidle' });
    await page.waitForSelector('#rouletteStage:not([hidden])');
    assert.equal((await s.api('roulette', { cmd: 'draw', requestId: 'ui-choose-0001' })).status, 200);
    const c = await s.until(async () => { const x = (await s.state()).party; return x?.phase === 'choose' && x; }, 12_000, 'choose');
    const roster = (await s.state()).roster, nameOf = (n) => roster.find((p) => p.number === n).name;
    const holder = nameOf(c.holder.number), others = c.players.filter((x) => x.a && x.n !== c.holder.number).map((x) => x.n);
    await page.waitForSelector('.rr-banner:not([hidden])');
    // another viewer writes a number: nothing on screen
    await say(s, nameOf(others[1]), String(others[0])); await sleep(500);
    assert.equal(await page.locator('.rr-banner-line.is-warn').count(), 0, 'only the holder gets an answer');
    const line = () => page.textContent('.rr-banner-line');
    for (const [text, expect] of [[String(c.holder.number), /رقمك/], ['99', /لا يوجد لاعب برقم 99/], [others[0] + ' أو ' + others[1], /رقمًا واحدًا/]]) {
      await say(s, holder, text);
      await page.waitForFunction((re) => new RegExp(re).test(document.querySelector('.rr-banner-line')?.textContent || ''), expect.source, { timeout: 5000 });
      assert.match(await line(), expect, text);
      assert.equal(await page.locator('.rr-banner-line.is-warn').count(), 1);
      assert.equal((await s.state()).party.phase, 'choose', 'still choosing after ' + text);
    }
    await page.screenshot({ path: path.join(os.tmpdir(), 'rr-p0-invalid.png') });
    // the valid number, written the way people write in a live chat
    await say(s, holder, 'اطلق على ' + others[0] + ' 🔫');
    await s.until(async () => (await s.state()).party?.phase === 'aim', 5000, 'aim');
    await page.waitForFunction(() => /يصوّب على/.test(document.querySelector('.rr-h1')?.textContent || ''), null, { timeout: 5000 });
    const h1 = await page.textContent('.rr-h1');
    assert.ok(h1.includes(holder) && h1.includes(nameOf(others[0])), 'shooter and target named: ' + h1);
    await page.screenshot({ path: path.join(os.tmpdir(), 'rr-p0-lockin.png') });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await s.stop(); }
});

test('sound: a browser that blocks sound says so (until a click); OBS, and the host\'s muted preview, never show it', { skip, timeout: 120_000 }, async () => {
  const s = await boot();
  try {
    await chatMatch(s, { chooseSeconds: 45, drawSpeed: 'fast' });
    const visible = (page) => page.locator('.rr-sound-hint:not([hidden])').count();
    // a normal browser tab: sound is blocked until the page is clicked
    const b1 = await playwright.chromium.launch();
    const tab = await b1.newPage(); await tab.goto(s.base + '/overlay', { waitUntil: 'networkidle' });
    await tab.waitForSelector('#rouletteStage:not([hidden])');
    await tab.waitForSelector('.rr-sound-hint:not([hidden])', { timeout: 5000 });
    assert.match(await tab.textContent('.rr-sound-hint'), /اضغط/);
    assert.equal(await tab.locator('#rouletteStage :is(button,a,input)').count(), 0, 'the hint is not a control on the OBS screen');
    await tab.mouse.click(400, 400);
    await tab.waitForSelector('.rr-sound-hint', { state: 'hidden', timeout: 5000 });
    // the host's preview (?mute=1) is silent on purpose: no hint
    const muted = await b1.newPage(); await muted.goto(s.base + '/overlay?embedded=1&mute=1', { waitUntil: 'networkidle' });
    await muted.waitForSelector('#rouletteStage:not([hidden])'); await sleep(800);
    assert.equal(await visible(muted), 0);
    await b1.close();
    // OBS (sound allowed without a click): no hint
    const b2 = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    const obs = await b2.newPage(); await obs.goto(s.base + '/overlay', { waitUntil: 'networkidle' });
    await obs.waitForSelector('#rouletteStage:not([hidden])'); await sleep(800);
    assert.equal(await visible(obs), 0);
    await b2.close();
  } finally { await s.stop(); }
});

test('sound: the OBS screen ignores a viewer\'s saved mute; a viewer\'s switch reaches the embedded screen at once', { skip, timeout: 120_000 }, async () => {
  const s = await boot();
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    await chatMatch(s, { chooseSeconds: 15, drawSpeed: 'fast', resultSeconds: 3 });
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => { try { localStorage.setItem('sponge_mute', '1'); } catch {} });
    await ctx.addInitScript(soundProbe);
    const obs = await ctx.newPage(); await obs.goto(s.base + '/overlay', { waitUntil: 'networkidle' });
    const viewer = await ctx.newPage(); await viewer.goto(s.base + '/overlay?embedded=1', { waitUntil: 'networkidle' });
    for (const p of [obs, viewer]) await p.waitForSelector('#rouletteStage:not([hidden])');
    assert.equal(await obs.evaluate(() => window.SpongeFx.muted), false, 'OBS: the host\'s «الأصوات» setting decides, not a saved site mute');
    assert.equal(await viewer.evaluate(() => window.SpongeFx.muted), true, 'a viewer\'s own mute is kept');
    // one turn: the OBS screen plays it, the muted viewer does not
    await s.api('roulette', { cmd: 'draw', requestId: 'ui-sound-0001' });
    await s.until(async () => { const x = (await s.state()).party; if (x?.phase === 'choose') await s.api('roulette', { cmd: 'random' }); return x?.phase === 'reveal'; }, 20_000, 'reveal');
    await sleep(1500);
    assert.ok(await obs.evaluate(() => window.__snd) > 5, 'the OBS screen played the turn');
    assert.equal(await viewer.evaluate(() => window.__snd), 0, 'the muted viewer heard nothing');
    // the viewer turns sound on in another tab of the site: the embedded screen follows without a reload
    const other = await ctx.newPage(); await other.goto(s.base + '/overlay?embedded=1', { waitUntil: 'domcontentloaded' });
    await other.waitForFunction(() => !!window.SpongeFx);
    await other.evaluate(() => window.SpongeFx.setMuted(false)); // what the site's «الصوت» switch does
    await viewer.waitForFunction(() => window.SpongeFx.muted === false, null, { timeout: 5000 });
  } finally { await browser.close(); await s.stop(); }
});
