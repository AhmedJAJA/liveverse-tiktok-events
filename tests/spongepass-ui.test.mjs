// «SpongePass» in a real browser: an account with season statistics opens /pass, sees its tier, claims everything
// reached, equips a pass frame from the page — and the room's frame lookup (the lobby list) returns that frame for its
// linked TikTok handle. A premium frame stays locked without the premium track; the page fits a phone.
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
const OWNER = 'owner-token-pass-ui-1';
const dbUrl = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/visual';
let pgOk = false; try { const c = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 2000 }); await c.connect(); await c.end(); pgOk = true; } catch {}
const skip = !playwright ? 'no Playwright' : !pgOk ? 'no PostgreSQL' : false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function boot() {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, SKY_GAMES_DEFAULT: '', PORT: String(port), ADMIN_TOKEN: OWNER, NODE_ENV: 'test', SKY_OPEN_SIGNUP: '1', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-spui-')), DATABASE_URL: dbUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await sleep(50); }
  return { base: 'http://127.0.0.1:' + port, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
async function until(fn, ms, what) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(60); } }
import { FrameStore } from '../src/frames.mjs';

test('SpongePass page: tier from the server, claim all, equip a pass frame, the lobby lookup shows it; phone fits', { skip, timeout: 180_000 }, async () => {
  const srv = await boot();
  const pool = new pg.Pool({ connectionString: dbUrl });
  const browser = await playwright.chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    // a guest is sent to sign in, and comes back to the pass
    const g = await ctx.request.get(srv.base + '/pass', { maxRedirects: 0 });
    assert.equal(g.status(), 302); assert.match(g.headers().location, /\/login\?next=\/pass/);
    const name = 'pass' + Date.now().toString(36);
    const r = await ctx.request.post(srv.base + '/api/auth/register', { data: { username: name, email: name + '@example.com', password: 'reef2026go', confirm: 'reef2026go' } });
    assert.equal(r.status(), 201);
    const uid = (await pool.query('SELECT id FROM users WHERE username=$1', [name])).rows[0].id;
    const handle = 'v_' + name;
    await pool.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [uid]);
    await pool.query(`INSERT INTO linked_accounts (user_id, platform, handle, verified) VALUES ($1,'tiktok',$2,true)`, [uid, handle]);
    // the season's games, as the server counts them: 330 entries + 2 wins = 3380 XP → tier 13
    const week = (await pool.query(`SELECT (starts_at AT TIME ZONE 'Asia/Riyadh')::date::text d FROM pass_seasons WHERE id='s1'`)).rows[0].d;
    await pool.query(`INSERT INTO weekly_player_stats (week_start, platform, player_id, name, handle, entries, wins) VALUES ($1,'tiktok',$2,$2,$2,330,2)`, [week, handle]);
    await page.goto(srv.base + '/pass', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#spTier').textContent.trim() !== '٠');
    assert.equal(await page.textContent('#spTier'), (13).toLocaleString('ar-SA'));
    assert.equal(await page.locator('#spTrack .sp-col').count(), 50);
    assert.equal(await page.locator('#spTrack .sp-col.is-reached').count(), 13);
    // free rewards reached: 5 (coins), 10 (frame) → «استلم كل الجاهز (2)»
    assert.equal(await page.isVisible('#spClaimAll'), true);
    assert.equal(await page.locator('#spTrack .sp-cell.is-ready').count(), 2);
    assert.equal(await page.locator('#spTrack .sp-cell.is-premium.is-locked').count(), 50, 'premium locked without the premium track');
    await page.click('#spClaimAll');
    await page.waitForFunction(() => /استلمت/.test(document.querySelector('#spMsg').textContent));
    assert.equal(await page.locator('#spTrack .sp-cell.is-ready').count(), 0);
    assert.equal(await page.locator('#spTrack .sp-cell.is-claimed').count(), 2);
    assert.equal((await pool.query('SELECT earned FROM wallets WHERE user_id=$1', [uid])).rows[0].earned, '50');
    // equip «فقاعات القاع» from the page; the premium «المدّ» has no equip button
    const bubble = page.locator('#spFrames .sp-frame:has(b:text-is("فقاعات القاع")) [data-equip]');
    await bubble.click();
    await page.waitForFunction(() => /جُهّز الإطار/.test(document.querySelector('#spMsg').textContent));
    assert.equal(await page.locator('#spFrames .sp-frame:has(b:text-is("المدّ")) [data-equip]').count(), 0);
    // the room's lookup for the lobby list: this TikTok handle wears the pass frame
    const seen = await new FrameStore({ pool }).forHandles('tiktok', [handle]);
    assert.deepEqual([seen.get(handle)?.id, seen.get(handle)?.effect], ['sp1_bubble', 'bubble']);
    // the bar links to the pass on every page
    assert.equal(await page.getAttribute('.sl-nav [data-nav=pass]', 'aria-current'), 'page');
    await page.screenshot({ path: path.join(os.tmpdir(), 'spongepass-desktop.png'), fullPage: true });
    // a phone: no sideways scroll of the page (the track scrolls inside itself)
    await page.setViewportSize({ width: 360, height: 780 }); await sleep(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, 'no sideways page scroll: ' + overflow);
    await page.screenshot({ path: path.join(os.tmpdir(), 'spongepass-phone.png') });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await pool.end(); await srv.stop(); }
});
