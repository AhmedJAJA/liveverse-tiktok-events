// Shared bottom navigation: one component on home / «لوحة التحكم» / public profiles, and /go/<section> where the
// server — not the page — decides the destination from the session. Real server + PostgreSQL; skipped without one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

const read = (f) => fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');

test('one shared component, included by every page that shows the bar', () => {
  for (const page of ['home.html', 'me.html', 'profile.html']) {
    const html = read(page);
    assert.match(html, /<link rel="stylesheet" href="\/bottom-nav\.css">/, page);
    assert.match(html, /<script defer src="\/bottom-nav\.js"><\/script>\s*<script defer src="\/(home|me|profile)\.js">/, page + ': before the page script');
    assert.doesNotMatch(html, /class="ds-bottom"|class="bn"/, page + ': no copy of the markup in the page');
  }
  const js = read('bottom-nav.js'), css = read('bottom-nav.css');
  assert.deepEqual([...js.matchAll(/label: '([^']+)'/g)].map((m) => m[1]), ['ملفي', 'المجتمع', 'حقيبتي', 'ألعاب البث', 'التحديات']);
  assert.doesNotMatch(js, /fetch\(|new WebSocket|setInterval|getContext\(/, 'no network, sockets, timers or canvas');
  assert.doesNotMatch(js, /history\.(push|replace)State|preventDefault/, 'back / forward untouched, links stay links');
  assert.match(css, /@media \(max-width:980px\)/); assert.match(css, /^\.bn\{display:none\}/m, 'hidden on desktop');
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /prefers-reduced-motion/);
});

const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_bn_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let available = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); available = true; } catch {}
const skip = available ? false : 'no PostgreSQL at TEST_DATABASE_URL';
test.after(async () => { if (!available) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

async function boot() {
  const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const port = s.address().port; await new Promise((r) => s.close(r));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), ADMIN_TOKEN: 'owner-token-bottom-nav-1', NODE_ENV: 'test', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-bn-')), DATABASE_URL: dbUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await new Promise((r) => setTimeout(r, 50)); }
  return { base: 'http://127.0.0.1:' + port, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
function browser(base) {
  const jar = new Map();
  return async (method, route, body) => {
    const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const res = await fetch(base + route, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k); }
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, location: res.headers.get('location') };
  };
}

test('/go/<section>: the games list for everyone (all free), account sections or sign-in from the session', { skip, timeout: 60_000 }, async () => {
  const { base, stop } = await boot();
  try {
    const guest = browser(base);
    assert.equal((await guest('GET', '/go/studio')).location, '/games');
    assert.equal((await guest('GET', '/go/profile')).location, '/login?next=%2Faccount%23profile');
    assert.equal((await guest('GET', '/go/community')).location, '/login?next=%2Faccount%23community');
    assert.equal((await guest('GET', '/go/nope')).status, 404);
    assert.equal((await guest('GET', '/go/..%2Fadmin')).status, 404);

    const b = browser(base);
    const reg = await b('POST', '/api/auth/register', { username: 'bnuser', email: 'bn@example.com', password: 'reef2026go', confirm: 'reef2026go' });
    assert.equal(reg.status, 201);
    const publicId = reg.data.account.publicId;
    // signed in: every game is free → the games list; sections open directly
    assert.equal((await b('GET', '/go/studio')).location, '/games');
    for (const s of ['profile', 'community', 'bag', 'challenge']) assert.equal((await b('GET', '/go/' + s)).location, '/account#' + s);
    // no trial is created any more (nothing to start), and a game opens directly for a new account
    assert.equal((await b('POST', '/api/me/trial-start', {})).data.started, false);
    assert.equal((await b('GET', '/game/quiz')).status, 200);
    assert.equal((await b('GET', '/studio?mode=quiz')).location, '/game/quiz');
    // navigating never changes the account: same permanent ID, no subscription rows
    const me = await b('GET', '/api/me/profile');
    assert.equal(me.data.user.publicId, publicId);
    assert.equal(me.data.history.length, 0);
    assert.equal(me.data.access.active, true); assert.equal(me.data.access.plan, 'free');
    // the pages are served with the component
    const home = await (await fetch(base + '/')).text();
    assert.match(home, /\/bottom-nav\.js\?v=/); assert.match(home, /\/bottom-nav\.css\?v=/);
  } finally { await stop(); }
});
