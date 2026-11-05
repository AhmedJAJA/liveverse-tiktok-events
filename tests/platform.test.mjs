// Accounts, permanent IDs, trial, subscriptions, payments and admin — against a real PostgreSQL.
// Uses TEST_DATABASE_URL (a server where a throwaway database can be created); skipped when none is reachable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { createPool, migrate } from '../src/db.mjs';
import { Platform, canonicalEmail, validateSignup } from '../src/platform.mjs';
import { PromoStore } from '../src/promo.mjs';

const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_test_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let available = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); available = true; }
catch { /* no database here: these tests are skipped */ }
const skip = available ? false : 'no PostgreSQL at TEST_DATABASE_URL';
test.after(async () => { if (!available) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

const OWNER = 'owner-token-for-platform-tests-1';
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function boot(dataDir, env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), ADMIN_TOKEN: OWNER, NODE_ENV: 'test', SKY_DATA_DIR: dataDir, DATABASE_URL: dbUrl, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await new Promise((r) => setTimeout(r, 50)); }
  return { base: 'http://127.0.0.1:' + port, log: () => out, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
function browser(base) {
  let cookie = '';
  const call = async (method, route, body, headers = {}) => {
    const res = await fetch(base + route, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, location: res.headers.get('location') };
  };
  call.cookie = () => cookie;
  return call;
}
/** A stand-in for Moyasar's invoice API: invoices start "initiated"; the test decides when one is paid. */
async function fakeGateway() {
  const invoices = new Map(); let n = 0;
  const srv = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    if (req.headers.authorization !== 'Basic ' + Buffer.from('sk_test_x:').toString('base64')) { res.writeHead(401); return res.end('{}'); }
    if (req.method === 'POST' && req.url === '/v1/invoices') {
      const o = JSON.parse(body); const id = 'inv_' + (++n);
      invoices.set(id, { id, status: 'initiated', amount: o.amount, currency: o.currency, metadata: o.metadata, url: 'https://pay.example/' + id });
      res.writeHead(201, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(invoices.get(id)));
    }
    const m = req.url.match(/^\/v1\/invoices\/(\w+)$/);
    if (req.method === 'GET' && m && invoices.has(m[1])) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(invoices.get(m[1]))); }
    res.writeHead(404); res.end('{}');
  });
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
  return { base: 'http://127.0.0.1:' + srv.address().port + '/v1', invoices, close: () => new Promise((r) => srv.close(r)) };
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test('sign-up rules and one mailbox per account', () => {
  assert.equal(canonicalEmail('A.B.C+promo@GoogleMail.com'), 'abc@gmail.com');
  assert.equal(canonicalEmail('Sara+x@example.com'), 'sara@example.com');
  assert.throws(() => validateSignup({ username: 'ab', email: 'x', password: 'short', confirm: 'nope' }), (e) => !!(e.fields.username && e.fields.email && e.fields.password && e.fields.confirm));
  assert.throws(() => validateSignup({ username: 'sara', email: 's@e.com', password: '12345678', confirm: '12345678' }), (e) => !!e.fields.password);
  assert.deepEqual(validateSignup({ username: ' Sara_1 ', email: 's@e.com', password: 'reef2026go', confirm: 'reef2026go' }).username, 'sara_1');
});

test('permanent IDs are unique, generated by the server and can never change', { skip }, async () => {
  const pool = createPool(dbUrl); await migrate(pool, { log: null });
  const promos = new PromoStore();
  const mail = { configured: false, send: async () => ({ sent: false }) };
  const p = new Platform({ pool, hashCode: (c) => promos.hash(c), mail, gateway: { configured: false } });
  await p.init();
  try {
    const ids = new Set();
    for (let i = 0; i < 25; i++) { const u = await p.register({ username: 'unit' + i, email: `unit${i}@example.com`, password: 'reef2026go', confirm: 'reef2026go', publicId: 'SPG-AAAAAA' }); assert.match(u.public_id, /^SPG-[A-HJ-NP-Z2-9]{6}$/); ids.add(u.public_id); }
    assert.equal(ids.size, 25, 'every account gets its own ID (the body cannot choose it)');
    await assert.rejects(p.register({ username: 'Unit0', email: 'other@example.com', password: 'reef2026go', confirm: 'reef2026go' }), /اسم المستخدم/);
    await assert.rejects(p.register({ username: 'dup', email: 'UNIT0+promo@example.com', password: 'reef2026go', confirm: 'reef2026go' }), /مسجل/);
    const u = (await pool.query("SELECT * FROM users WHERE username='unit1'")).rows[0];
    await p.updateProfile(u.id, { displayName: 'اسم جديد', avatar: 'crab' });
    await pool.query('UPDATE users SET email=$2, canonical_email=$2 WHERE id=$1', [u.id, 'new@example.com']);
    assert.equal((await pool.query('SELECT public_id FROM users WHERE id=$1', [u.id])).rows[0].public_id, u.public_id, 'same ID after name, avatar and email changes');
    await assert.rejects(pool.query("UPDATE users SET public_id='SPG-ZZZZZZ' WHERE id=$1", [u.id]), /permanent/, 'the database itself refuses to change an ID');
    await assert.rejects(pool.query("INSERT INTO users (public_id, username, display_name, email, canonical_email, password_hash, room) VALUES ($1,'clash','clash','c@x.io','c@x.io','x','aaaaaaaaaa')", [u.public_id]), /duplicate key/);

    // every game is free: access never ends on the clock, and no trial can be activated any more
    await p.setVerified(u.id);
    assert.deepEqual(p.entitlement(u.id), { active: true, plan: 'free', endsAt: null });
    await assert.rejects(p.activateTrial(u.id), /مجانية/);
    const real = p.now; p.now = () => real() + 400 * 24 * 3600_000;
    assert.equal(p.entitlement(u.id).active, true, 'free access has no end');
    p.now = real;
    await pool.query('UPDATE users SET disabled_at=now() WHERE id=$1', [u.id]); await p.refresh(u.id);
    assert.equal(p.entitlement(u.id).active, false, 'a stopped account has no access');
    await pool.query('UPDATE users SET disabled_at=NULL WHERE id=$1', [u.id]); await p.refresh(u.id);
    // a monthly period is one calendar month, starting after current access
    const per = p.periodFor(u.id, 'monthly', Date.UTC(2026, 0, 31));
    assert.equal(per.ends.toISOString().slice(0, 10), '2026-02-28');
  } finally { await pool.end(); }
});

test('accounts over HTTP: sign-up, ID, verification, free games, no subscription sales, admin, restart', { skip, timeout: 120_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-platform-'));
  const gw = await fakeGateway();
  const env = { MOYASAR_SECRET_KEY: 'sk_test_x', MOYASAR_WEBHOOK_SECRET: 'whsec_test_123', MOYASAR_API_BASE: gw.base, SPONGE_PROMO_CODES: 'BIKINI2026' };
  let srv = await boot(dir, env);
  try {
    const u = browser(srv.base);
    // the home page: games list, store, no plans or trial
    const home = await (await fetch(srv.base + '/')).text();
    for (const s of ['إنشاء حساب جديد', 'تسجيل الدخول', 'كل الألعاب مجانية', 'المتجر', 'عملات الإسفنجة', '34.99', 'حوّل بثك إلى لعبة.', 'اربط بثك بتسجيل الدخول الرسمي', 'كيف تبدأ؟', 'الأسئلة الشائعة', 'href="/privacy"', 'href="/terms"']) assert.ok(home.includes(s), s);
    for (const s of ['شفيق العادي', 'أمير الهامور', '44.99', 'تجربة مجانية لمدة 24 ساعة', 'باقات الاشتراك']) assert.ok(!home.includes(s), s);
    for (const pg of ['/signup', '/login', '/privacy', '/terms']) assert.equal((await fetch(srv.base + pg)).status, 200, pg);
    const bad = await u('POST', '/api/auth/register', { username: 'x', email: 'no', password: '1', confirm: '2' });
    assert.equal(bad.status, 400); assert.ok(bad.data.fields.username && bad.data.fields.confirm);
    const reg = await u('POST', '/api/auth/register', { username: 'streamer_1', email: 'streamer@example.com', password: 'reef2026go', confirm: 'reef2026go', isAdmin: true, publicId: 'SPG-AAAAAA' });
    assert.equal(reg.status, 201);
    const id = reg.data.account.publicId;
    assert.match(id, /^SPG-[A-HJ-NP-Z2-9]{6}$/); assert.notEqual(id, 'SPG-AAAAAA'); assert.equal(reg.data.account.isAdmin, false, 'body fields cannot grant admin');
    assert.equal((await u('GET', '/account')).status, 200);
    assert.equal((await browser(srv.base)('GET', '/account')).status, 302, 'account page needs a session');
    // every game is free from the first minute: a game page and the game API open, no trial to claim
    assert.equal((await u('GET', '/game/quiz')).status, 200);
    assert.equal((await u('GET', '/studio')).location, '/#games');
    assert.equal((await u('POST', '/api/admin/prepare', { mode: 'quiz' })).status, 200);
    assert.equal((await u('POST', '/api/me/trial-claim', {})).status, 410);
    // verify through the link sent by e-mail (dev mode returns it)
    const link = (await u('POST', '/api/auth/resend', {})).data.devLink;
    assert.match(link, /\/verify\?token=/);
    assert.equal((await u('GET', '/verify?token=forged')).location, '/account?verified=0');
    assert.equal((await u('GET', new URL(link).pathname + new URL(link).search)).location, '/account?verified=1');
    // edits never touch the ID, and plan/expiry cannot be sent from the browser
    await u('POST', '/api/me/update', { displayName: 'نجم البث', avatar: 'star', publicId: 'SPG-ZZZZZZ', plan: 'monthly', endsAt: '2099-01-01' });
    let prof = (await u('GET', '/api/me/profile')).data;
    assert.equal(prof.user.publicId, id); assert.equal(prof.user.displayName, 'نجم البث');
    assert.equal(prof.access.plan, 'free'); assert.equal(prof.access.endsAt, null); assert.equal(prof.history.length, 0);
    // logout / login
    assert.equal((await u('POST', '/api/auth/logout', {})).status, 200);
    assert.equal((await u('GET', '/api/me/profile')).status, 401);
    assert.equal((await u('POST', '/api/auth/login', { identifier: 'streamer_1', password: 'wrong-pass1' })).status, 401);
    const li = await u('POST', '/api/auth/login', { identifier: 'Streamer@Example.com', password: 'reef2026go' });
    assert.equal(li.status, 200); assert.equal(li.data.account.publicId, id); assert.equal(li.data.next, '/#games');
    assert.equal((await u('POST', '/api/admin/prepare', { mode: 'flag' })).status, 200);
    const me = (await u('GET', '/api/access/me')).data; assert.equal(me.account.publicId, id); assert.match(me.room, /^a[a-z0-9]{9}$/);
    assert.equal((await fetch(srv.base + '/api/state?room=' + me.room)).status, 200, 'the account room has a public OBS state');

    // no subscription is sold: checkout refuses before any invoice is made
    const invoicesBefore = gw.invoices.size;
    const co = await u('POST', '/api/me/checkout', { plan: 'monthly' });
    assert.equal(co.status, 410); assert.equal(gw.invoices.size, invoicesBefore);
    assert.notEqual((await u('POST', '/api/me/redeem', { code: 'AMIR-AAAA-BBBB-CCCC-DDDD' })).status, 200);
    // the public price list is the coin packages only
    const store = await (await fetch(srv.base + '/api/store/packages')).json();
    assert.deepEqual(store.packages.map((p) => [p.coins, p.price]), [[500, 3.75], [2000, 9.99], [5000, 19.99], [10000, 34.99]]);
    assert.equal(store.dailyReward, 200); assert.equal(store.referralReward, 50); assert.equal(store.referralCap, 10);

    // admin panel: closed to accounts, open to the owner; grants and extensions refused, the rest audited
    assert.equal((await u('GET', '/api/manage/users')).status, 403);
    assert.equal((await u('POST', '/api/manage/grant', { publicId: id, days: 30 })).status, 403);
    assert.equal((await u('GET', '/admin')).status, 302);
    const owner = browser(srv.base);
    await owner('POST', '/api/access/redeem', { code: OWNER });
    assert.equal((await owner('GET', '/admin')).status, 200);
    const found = (await owner('GET', '/api/manage/users?q=' + id)).data.users;
    assert.equal(found.length, 1); assert.equal(found[0].publicId, id); assert.equal(found[0].access.active, false, 'the owner sees subscription records, not the free access');
    const second = browser(srv.base);
    const reg2 = await second('POST', '/api/auth/register', { username: 'viewer_2', email: 'viewer2@example.com', password: 'reef2026go', confirm: 'reef2026go' });
    const id2 = reg2.data.account.publicId;
    assert.equal((await owner('POST', '/api/manage/grant', { publicId: id2, days: 7 })).status, 410);
    assert.equal((await owner('POST', '/api/manage/extend', { publicId: id2, days: 3 })).status, 410);
    assert.equal((await owner('POST', '/api/manage/verify', { publicId: id2 })).status, 200);
    assert.equal((await owner('POST', '/api/manage/stop', { publicId: id2 })).status, 200);
    assert.equal((await second('GET', '/game/quiz')).status, 200, 'stopping old subscriptions never closes the free games');
    const made = await owner('POST', '/api/manage/code-create', { label: 'ضيف', maxUses: 1 });
    assert.equal(made.status, 200);
    assert.equal((await owner('POST', '/api/manage/code-revoke', { id: made.data.code.id })).status, 200);
    assert.equal((await browser(srv.base)('POST', '/api/access/redeem', { code: made.data.code.code })).status, 401, 'revoked code');
    const log = (await owner('GET', '/api/manage/audit')).data.log.map((l) => l.action);
    for (const a of ['subscription-stop', 'email-verify-manual', 'promo-create', 'promo-revoke']) assert.ok(log.includes(a), a);

    // restart (new process, local files wiped): accounts, IDs, sessions and promo codes come back from PostgreSQL
    const keep = u.cookie();
    await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
    srv = await boot(fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-platform2-')), env);
    const again = await fetch(srv.base + '/api/me/profile', { headers: { Cookie: keep } });
    assert.equal(again.status, 200, 'the login survives a redeploy');
    const p2 = await again.json();
    assert.equal(p2.user.publicId, id); assert.equal(p2.access.active, true); assert.equal(p2.access.plan, 'free');
    assert.equal((await fetch(srv.base + '/game/bomb', { redirect: 'manual', headers: { Cookie: keep } })).status, 200);
    assert.equal((await browser(srv.base)('POST', '/api/access/redeem', { code: 'BIKINI2026' })).status, 200);
  } finally { await srv.stop(); await gw.close(); }
});

test('without a database the games and promo codes still work and accounts say so', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-nodb-'));
  const port = await freePort();
  const { DATABASE_URL, ...rest } = process.env;
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...rest, PORT: String(port), ADMIN_TOKEN: OWNER, NODE_ENV: 'test', SKY_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c));
  while (!/ready on/.test(out)) await pause(50);
  try {
    const base = 'http://127.0.0.1:' + port;
    const r = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 503); assert.match((await r.json()).error, /غير مفعّلة/);
    assert.equal((await (await fetch(base + '/api/auth/config')).json()).enabled, false);
    assert.equal((await fetch(base + '/')).status, 200);
  } finally { child.kill(); }
});

test('subscription vouchers: the old batches stay as records, no new code is made or redeemed', { skip, timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-voucher-'));
  const srv = await boot(dir);
  try {
    const pool = createPool(dbUrl);
    const seeded = (await pool.query("SELECT plan, count(*)::int AS n FROM promo_codes WHERE kind='plan' AND label='دفعة نوفمبر 2026' GROUP BY plan ORDER BY plan")).rows;
    assert.deepEqual(seeded, [{ plan: 'monthly', n: 100 }, { plan: 'weekly', n: 100 }], 'the November batch stays in the database');
    const raw = fs.readFileSync(new URL('../migrations/003_vouchers_2026_11.sql', import.meta.url), 'utf8');
    assert.doesNotMatch(raw, /(AMIR|SHFQ)-[A-Z0-9]{4}/, 'no plain codes in the repository');
    const owner = browser(srv.base);
    await owner('POST', '/api/access/redeem', { code: OWNER });
    const made = await owner('POST', '/api/manage/voucher-create', { plan: 'monthly', count: 2, label: 'اختبار' });
    assert.equal(made.status, 410, 'no new subscription codes');
    const u = browser(srv.base);
    await u('POST', '/api/auth/register', { username: 'voucher_user', email: 'voucher@example.com', password: 'reef2026go', confirm: 'reef2026go' });
    assert.notEqual((await u('POST', '/api/me/redeem', { code: 'AMIR-AAAA-BBBB-CCCC-DDDD' })).status, 200);
    const prof = (await u('GET', '/api/me/profile')).data;
    assert.equal(prof.access.plan, 'free'); assert.equal(prof.history.length, 0);
    assert.equal((await u('GET', '/game/quiz')).status, 200, 'no code needed to play');
    assert.equal((await pool.query("SELECT count(*)::int n FROM promo_codes WHERE kind='plan'")).rows[0].n, 200, 'nothing was added');
    await pool.end();
  } finally { await srv.stop(); }
});
