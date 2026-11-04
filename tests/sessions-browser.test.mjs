// Staying signed in: «تذكرني لمدة 30 يوماً», sliding renewal, restarts and logout — checked with real
// browser cookies (Playwright/Chromium) against a real PostgreSQL. Skipped when either is unavailable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { generateKeyPairSync, createSign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { Sessions } from '../src/accounts.mjs';

const DAY = 86_400_000;
let chromium = null;
for (const base of [process.cwd(), (() => { try { return execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } })()]) {
  try { chromium = createRequire(path.join(base, 'x.js'))('playwright').chromium; break; } catch {}
}
const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_stest_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let db = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); db = true; } catch {}
test.after(async () => { if (!db) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

test('session store: 30-day remembered sessions, browser-only sessions, sliding renewal, logout', () => {
  let t = 1_000_000_000_000;
  const s = new Sessions({ now: () => t });
  const kept = s.create('acct', { userId: 'u1' }), brief = s.create('acct', { userId: 'u1', remember: false });
  assert.ok(s.get(kept) && s.get(brief));
  t += 2 * DAY;
  assert.equal(s.get(brief), null, 'a session without «تذكرني» ends within a day');
  assert.ok(s.get(kept));
  assert.equal(s.renew(kept), true, 'used after a day: pushed back to 30 days');
  assert.equal(s.renew(kept), false, 'at most once a day');
  t += 29 * DAY;
  assert.ok(s.get(kept), 'still valid 31 days after sign-in because it was used on day 2');
  const stale = s.create('acct', { userId: 'u2' }); t += 31 * DAY;
  assert.equal(s.renew(stale), false, 'an expired session cannot be renewed'); t -= 31 * DAY;
  t += 2 * DAY;
  assert.equal(s.get(kept), null, 'expires 30 days after the last use');
  const again = s.create('acct', { userId: 'u1' });
  s.destroy(again);
  assert.equal(s.get(again), null, 'logout ends it for good');
});

const CLIENT_ID = 'session-test.apps.googleusercontent.com';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
function idToken(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT_ID, iat: now, exp: now + 3600, email_verified: true, ...claims })).toString('base64url');
  return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url');
}
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }

test('in a real browser: Google sign-in is remembered across tabs, browser restarts, server restarts and days', { skip: !db ? 'no PostgreSQL' : !chromium ? 'no Playwright' : false, timeout: 180_000 }, async () => {
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
  const keys = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ keys: [jwk] })); });
  keys.listen(0, '127.0.0.1'); await once(keys, 'listening');
  const port = await freePort(), base = 'http://127.0.0.1:' + port;
  let child = null;
  const start = async (offsetMs = 0) => {
    child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), ADMIN_TOKEN: 'owner-token-for-session-tests', NODE_ENV: 'test', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-s-')), DATABASE_URL: dbUrl, GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_JWKS_URL: 'http://127.0.0.1:' + keys.address().port, SKY_TEST_CLOCK_OFFSET_MS: String(offsetMs) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
    const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error(out); await new Promise((r) => setTimeout(r, 50)); }
  };
  const stop = () => new Promise((r) => { if (!child || child.exitCode !== null) return r(); child.once('exit', r); child.kill(); });
  const browser = await chromium.launch();
  /** what the page itself sees after restoring the session */
  const whoAmI = (page) => page.evaluate(() => fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json()));
  try {
    await start();
    // 1. first Google sign-in, inside the browser (the browser stores the cookie it was given)
    const ctx = await browser.newContext();
    await ctx.exposeFunction('tokenFor', (claims) => idToken(claims));
    const page = await ctx.newPage();
    await page.goto(base + '/');
    const first = await page.evaluate(async () => {
      const { nonce } = await fetch('/api/auth/google').then((r) => r.json());
      const credential = await window.tokenFor({ sub: 'g-sub-1', email: 'remember.me@gmail.com', name: 'لاعب', nonce });
      const r = await fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential, remember: true }) });
      return { status: r.status, data: await r.json() };
    });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    const id = first.data.account.publicId;
    const cookie = (await ctx.cookies()).find((c) => c.name === 'sky_session');
    assert.ok(cookie.httpOnly, 'HttpOnly'); assert.equal(cookie.sameSite, 'Lax');
    assert.ok(cookie.expires > Date.now() / 1000 + 29 * 86400, 'a persistent 30-day cookie');
    assert.equal(await page.evaluate(() => document.cookie.includes('sky_session')), false, 'scripts cannot read it');
    // 5 + 6. refresh several times and move between pages: still signed in, the home page shows the account
    for (let i = 0; i < 3; i++) { await page.reload(); assert.equal((await whoAmI(page)).account.publicId, id); }
    await page.goto(base + '/account'); assert.equal(new URL(page.url()).pathname, '/account');
    await page.goto(base + '/login'); assert.equal(new URL(page.url()).pathname, '/account', 'the login form is skipped when already signed in');
    await page.goto(base + '/'); await page.waitForFunction(() => !document.documentElement.classList.contains('me-pending'));
    assert.equal(await page.textContent('#barAccountLabel'), 'لاعب');
    // 2. close the tab and open a new one
    await page.close();
    const tab2 = await ctx.newPage(); await tab2.goto(base + '/');
    assert.equal((await whoAmI(tab2)).account.publicId, id);
    // 3. close the browser and open it again: only persistent cookies survive
    const saved = await ctx.storageState(); await ctx.close();
    const reopened = await browser.newContext({ storageState: { ...saved, cookies: saved.cookies.filter((c) => c.expires > 0) } });
    const p3 = await reopened.newPage(); await p3.goto(base + '/');
    assert.equal((await whoAmI(p3)).account.publicId, id, 'remembered after a browser restart');
    // without «تذكرني»: a browser-session cookie that does not survive a restart
    const ctxB = await browser.newContext(); await ctxB.exposeFunction('tokenFor', (claims) => idToken(claims));
    const pb = await ctxB.newPage(); await pb.goto(base + '/');
    await pb.evaluate(async () => {
      const { nonce } = await fetch('/api/auth/google').then((r) => r.json());
      const credential = await window.tokenFor({ sub: 'g-sub-2', email: 'brief.visit@gmail.com', nonce });
      await fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential, remember: false }) });
    });
    const briefCookie = (await ctxB.cookies()).find((c) => c.name === 'sky_session');
    assert.equal(briefCookie.expires, -1, 'no Max-Age: gone when the browser closes');
    const savedB = await ctxB.storageState(); await ctxB.close();
    const reopenedB = await browser.newContext({ storageState: { ...savedB, cookies: savedB.cookies.filter((c) => c.expires > 0) } });
    const pb2 = await reopenedB.newPage(); await pb2.goto(base + '/');
    assert.equal((await whoAmI(pb2)).account, undefined);
    await reopenedB.close();

    // 7 + 8. server restart / redeploy (new process, empty local disk): the session comes back from PostgreSQL
    await stop(); await start();
    await p3.reload(); assert.equal((await whoAmI(p3)).account.publicId, id);
    // 4. a day later: still signed in, and the session is renewed for another 30 days
    await stop(); await start(25 * 3600_000);
    await p3.reload();
    const later = await whoAmI(p3);
    assert.equal(later.account.publicId, id);
    assert.ok(new Date(later.session.expiresAt) - (Date.now() + 25 * 3600_000) > 29 * DAY, 'renewed to 30 days from now');
    const renewedCookie = (await reopened.cookies()).find((c) => c.name === 'sky_session');
    assert.ok(renewedCookie.expires * 1000 > Date.now() + 29 * DAY, 'the browser cookie was renewed too');
    // 9. 31 days with no visit: the session is over
    await stop(); await start(25 * 3600_000 + 31 * DAY);
    await p3.reload(); assert.equal((await whoAmI(p3)).account, undefined, 'expired after 30 days without use');
    await stop(); await start();

    // 11 + 12 + 13. signing in again finds the same account, ID and trial history
    const ctx2 = await browser.newContext(); await ctx2.exposeFunction('tokenFor', (claims) => idToken(claims));
    const p4 = await ctx2.newPage(); await p4.goto(base + '/');
    const signIn = () => p4.evaluate(async () => {
      const { nonce } = await fetch('/api/auth/google').then((r) => r.json());
      const credential = await window.tokenFor({ sub: 'g-sub-1', email: 'remember.me@gmail.com', nonce });
      return fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential, remember: true }) }).then((r) => r.json());
    });
    const again = await signIn();
    assert.equal(again.account.publicId, id, 'same permanent ID');
    const t1 = await p4.evaluate(() => fetch('/api/me/trial-start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json()));
    assert.equal(t1.started, true);
    const relog = await signIn();
    assert.equal(relog.account.publicId, id); assert.equal(relog.account.plan, 'trial');
    const t2 = await p4.evaluate(() => fetch('/api/me/trial-start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json()));
    assert.notEqual(t2.started, true, 'no second trial after signing in again');
    const pool = new pg.Pool({ connectionString: dbUrl });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM users WHERE google_sub='g-sub-1'")).rows[0].n, 1, 'no duplicate account');
    assert.ok((await pool.query("SELECT last_login_at FROM users WHERE google_sub='g-sub-1'")).rows[0].last_login_at, 'last sign-in is recorded');
    await pool.end();

    // 14 (part): a request sent from another site with this browser's cookie is refused
    const live = (await ctx2.cookies()).find((c) => c.name === 'sky_session').value;
    const csrf = await fetch(base + '/api/me/update', { method: 'POST', headers: { Cookie: 'sky_session=' + live, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, body: JSON.stringify({ displayName: 'hacked' }) });
    assert.equal(csrf.status, 403, 'requests sent from other sites are refused');
    // 10. logout: the cookie is cleared and the old session id is dead even if replayed
    const before = (await ctx2.cookies()).find((c) => c.name === 'sky_session').value;
    await p4.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    assert.equal((await ctx2.cookies()).find((c) => c.name === 'sky_session'), undefined);
    const replay = await fetch(base + '/api/auth/me', { headers: { Cookie: 'sky_session=' + before } }).then((r) => r.json());
    assert.equal(replay.account, undefined, 'a logged-out session cannot be reused');
    // 14. forged and cross-site requests get nothing
    assert.equal((await fetch(base + '/api/auth/me', { headers: { Cookie: 'sky_session=' + 'x'.repeat(43) } }).then((r) => r.json())).account, undefined);
    await reopened.close(); await ctx2.close();
  } finally { await browser.close(); await stop(); keys.close(); }
});
