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

    // trial expiry is decided on the server clock
    await p.setVerified(u.id);
    await p.claimTrial(u.id);
    const started = await p.activateTrial(u.id);
    assert.equal(new Date(started.endsAt) - new Date(started.startedAt), 24 * 3600_000);
    assert.equal(p.entitlement(u.id).active, true);
    const real = p.now; p.now = () => real() + 24 * 3600_000 + 1000;
    assert.equal(p.entitlement(u.id).active, false, 'access ends exactly after 24 hours');
    assert.equal((await p.trialState(u.id)).status, 'expired');
    await assert.rejects(p.claimTrial(u.id), /من قبل/, 'an expired trial cannot be claimed again');
    p.now = real;
    // a monthly period is one calendar month, starting after current access
    const per = p.periodFor(u.id, 'monthly', Date.UTC(2026, 0, 31));
    assert.equal(per.ends.toISOString().slice(0, 10), '2026-02-28');
  } finally { await pool.end(); }
});

test('accounts over HTTP: sign-up, ID, verification, trial, studio gate, payments, admin, restart', { skip, timeout: 120_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-platform-'));
  const gw = await fakeGateway();
  const env = { MOYASAR_SECRET_KEY: 'sk_test_x', MOYASAR_WEBHOOK_SECRET: 'whsec_test_123', MOYASAR_API_BASE: gw.base, SPONGE_PROMO_CODES: 'BIKINI2026' };
  let srv = await boot(dir, env);
  try {
    const u = browser(srv.base);
    // sign up — the new sections and links are on the home page
    const home = await (await fetch(srv.base + '/')).text();
    for (const s of ['إنشاء حساب جديد', 'تسجيل الدخول', 'تجربة مجانية لمدة 24 ساعة', 'عرض باقات الاشتراك', 'حوّل بثك المباشر إلى عالم من الألعاب!', 'كيف تبدأ؟', 'شفيق العادي', 'أمير الهامور', '44.99', 'الأسئلة الشائعة', 'href="/privacy"', 'href="/terms"']) assert.ok(home.includes(s), s);
    for (const pg of ['/signup', '/login', '/privacy', '/terms']) assert.equal((await fetch(srv.base + pg)).status, 200, pg);
    const bad = await u('POST', '/api/auth/register', { username: 'x', email: 'no', password: '1', confirm: '2' });
    assert.equal(bad.status, 400); assert.ok(bad.data.fields.username && bad.data.fields.confirm);
    const reg = await u('POST', '/api/auth/register', { username: 'streamer_1', email: 'streamer@example.com', password: 'reef2026go', confirm: 'reef2026go', isAdmin: true, publicId: 'SPG-AAAAAA' });
    assert.equal(reg.status, 201);
    const id = reg.data.account.publicId;
    assert.match(id, /^SPG-[A-HJ-NP-Z2-9]{6}$/); assert.notEqual(id, 'SPG-AAAAAA'); assert.equal(reg.data.account.isAdmin, false, 'body fields cannot grant admin');
    assert.equal((await u('GET', '/account')).status, 200);
    assert.equal((await browser(srv.base)('GET', '/account')).status, 302, 'account page needs a session');
    // unverified: no trial, no studio
    assert.equal((await u('POST', '/api/me/trial-claim', {})).status, 403);
    const gate = await u('GET', '/studio'); assert.equal(gate.status, 302); assert.equal(gate.location, '/account?need=plan');
    assert.equal((await u('POST', '/api/admin/prepare', { mode: 'quiz' })).status, 402);
    // verify through the link sent by e-mail (dev mode returns it)
    const link = (await u('POST', '/api/auth/resend', {})).data.devLink;
    assert.match(link, /\/verify\?token=/);
    assert.equal((await u('GET', '/verify?token=forged')).location, '/account?verified=0');
    assert.equal((await u('GET', new URL(link).pathname + new URL(link).search)).location, '/account?verified=1');
    // edits never touch the ID, and plan/expiry cannot be sent from the browser
    await u('POST', '/api/me/update', { displayName: 'نجم البث', avatar: 'star', publicId: 'SPG-ZZZZZZ', plan: 'monthly', endsAt: '2099-01-01' });
    let prof = (await u('GET', '/api/me/profile')).data;
    assert.equal(prof.user.publicId, id); assert.equal(prof.user.displayName, 'نجم البث'); assert.equal(prof.access.active, false);
    // logout / login
    assert.equal((await u('POST', '/api/auth/logout', {})).status, 200);
    assert.equal((await u('GET', '/api/me/profile')).status, 401);
    assert.equal((await u('POST', '/api/auth/login', { identifier: 'streamer_1', password: 'wrong-pass1' })).status, 401);
    const li = await u('POST', '/api/auth/login', { identifier: 'Streamer@Example.com', password: 'reef2026go' });
    assert.equal(li.status, 200); assert.equal(li.data.account.publicId, id);
    // trial: a code made on the server, bound to this account
    const claim = await u('POST', '/api/me/trial-claim', {});
    const code = claim.data.trial.code; assert.match(code, /^[A-HJ-NP-Z2-9]{10}$/);
    const other = browser(srv.base);
    assert.equal((await other('POST', '/api/access/redeem', { code })).status, 401, 'the code is useless without its account');
    const act = await u('POST', '/api/access/redeem', { code });
    assert.equal(act.status, 200); assert.equal(act.data.next, '/studio');
    assert.equal((await u('GET', '/studio')).status, 200);
    prof = (await u('GET', '/api/me/profile')).data;
    assert.equal(prof.trial.status, 'active'); assert.equal(prof.access.plan, 'trial');
    assert.ok(prof.access.remainingMs > 23.9 * 3600_000 && prof.access.remainingMs <= 24 * 3600_000);
    assert.equal((await u('POST', '/api/me/trial-activate', {})).status, 409, 'no second trial');
    assert.equal((await u('POST', '/api/me/trial-claim', {})).status, 409);
    assert.equal((await u('POST', '/api/admin/prepare', { mode: 'flag' })).status, 200, 'studio API works during the trial');
    const me = (await u('GET', '/api/access/me')).data; assert.equal(me.account.publicId, id); assert.match(me.room, /^a[a-z0-9]{9}$/);
    assert.equal((await fetch(srv.base + '/api/state?room=' + me.room)).status, 200, 'the account room has a public OBS state');

    // payments: nothing is activated until the gateway itself says "paid"
    const co = await u('POST', '/api/me/checkout', { plan: 'monthly' });
    assert.equal(co.status, 200); assert.match(co.data.url, /^https:\/\/pay\.example\//);
    const inv = [...gw.invoices.values()].at(-1); assert.equal(inv.amount, 4499); assert.equal(inv.currency, 'SAR');
    assert.equal((await u('GET', '/api/me/payment?id=' + co.data.paymentId)).data.status, 'pending', 'returning to the success page proves nothing');
    const hook = (secret) => fetch(srv.base + '/api/billing/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'payment_paid', secret_token: secret, data: { id: 'pay_1', status: 'paid', amount: 4499, invoice_id: inv.id } }) });
    assert.equal((await hook('forged')).status, 401);
    assert.equal((await (await hook('whsec_test_123')).json()).status, 'pending', 'a webhook claiming success is checked with the gateway');
    assert.equal((await u('GET', '/api/me/profile')).data.history.filter((h) => h.plan === 'monthly').length, 0);
    inv.status = 'paid';
    assert.equal((await (await hook('whsec_test_123')).json()).status, 'paid');
    await hook('whsec_test_123'); await u('GET', '/api/me/payment?id=' + co.data.paymentId); // replays
    prof = (await u('GET', '/api/me/profile')).data;
    const monthly = prof.history.filter((h) => h.plan === 'monthly');
    assert.equal(monthly.length, 1, 'one payment activates exactly one subscription');
    const trialEnd = prof.history.find((h) => h.plan === 'trial').endsAt;
    assert.equal(monthly[0].startsAt, trialEnd, 'the paid month starts when current access ends');
    assert.equal(monthly[0].price, 44.99);
    // a failed payment activates nothing
    const co2 = await u('POST', '/api/me/checkout', { plan: 'weekly' });
    [...gw.invoices.values()].at(-1).status = 'failed';
    assert.equal((await u('GET', '/api/me/payment?id=' + co2.data.paymentId)).data.status, 'failed');
    assert.equal((await u('GET', '/api/me/profile')).data.history.filter((h) => h.plan === 'weekly').length, 0);
    // amount tampering at the gateway is rejected
    const co3 = await u('POST', '/api/me/checkout', { plan: 'weekly' });
    Object.assign([...gw.invoices.values()].at(-1), { status: 'paid', amount: 100 });
    assert.notEqual((await u('GET', '/api/me/payment?id=' + co3.data.paymentId)).data.status, 'paid');

    // admin panel: closed to accounts, open to the owner, every action audited
    assert.equal((await u('GET', '/api/manage/users')).status, 403);
    assert.equal((await u('POST', '/api/manage/grant', { publicId: id, days: 30 })).status, 403);
    assert.equal((await u('GET', '/admin')).status, 302);
    const owner = browser(srv.base);
    await owner('POST', '/api/access/redeem', { code: OWNER });
    assert.equal((await owner('GET', '/admin')).status, 200);
    const found = (await owner('GET', '/api/manage/users?q=' + id)).data.users;
    assert.equal(found.length, 1); assert.equal(found[0].publicId, id); assert.equal(found[0].access.active, true);
    const second = browser(srv.base);
    const reg2 = await second('POST', '/api/auth/register', { username: 'viewer_2', email: 'viewer2@example.com', password: 'reef2026go', confirm: 'reef2026go' });
    const id2 = reg2.data.account.publicId;
    assert.equal((await owner('POST', '/api/manage/grant', { publicId: id2, days: 7 })).status, 200);
    assert.equal((await owner('POST', '/api/manage/verify', { publicId: id2 })).status, 200);
    assert.equal((await second('GET', '/studio')).status, 200, 'a granted subscription opens the studio');
    assert.equal((await owner('POST', '/api/manage/extend', { publicId: id2, days: 3 })).status, 200);
    assert.equal((await owner('POST', '/api/manage/stop', { publicId: id2 })).status, 200);
    assert.equal((await second('GET', '/studio')).status, 302, 'stopped subscription closes the studio');
    const made = await owner('POST', '/api/manage/code-create', { label: 'ضيف', maxUses: 1 });
    assert.equal(made.status, 200);
    assert.equal((await owner('POST', '/api/manage/code-revoke', { id: made.data.code.id })).status, 200);
    assert.equal((await browser(srv.base)('POST', '/api/access/redeem', { code: made.data.code.code })).status, 401, 'revoked code');
    const log = (await owner('GET', '/api/manage/audit')).data.log.map((l) => l.action);
    for (const a of ['subscription-grant', 'subscription-extend', 'subscription-stop', 'email-verify-manual', 'promo-create', 'promo-revoke']) assert.ok(log.includes(a), a);

    // restart (new process, local files wiped): accounts, IDs, subscriptions, sessions and promo codes come back from PostgreSQL
    const keep = u.cookie();
    await srv.stop();
    fs.rmSync(dir, { recursive: true, force: true });
    srv = await boot(fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-platform2-')), env);
    const again = await fetch(srv.base + '/api/me/profile', { headers: { Cookie: keep } });
    assert.equal(again.status, 200, 'the login survives a redeploy');
    const p2 = await again.json();
    assert.equal(p2.user.publicId, id); assert.equal(p2.access.active, true);
    assert.equal(p2.history.filter((h) => h.plan === 'monthly').length, 1);
    assert.equal((await browser(srv.base)('POST', '/api/access/redeem', { code: 'BIKINI2026' })).status, 200);

    // expiry: once every period has ended, the studio closes again (checked by the server)
    const pool = createPool(dbUrl);
    await pool.query("UPDATE subscriptions SET starts_at = now() - interval '26 hours', ends_at = now() - interval '1 hour' WHERE user_id = (SELECT id FROM users WHERE public_id=$1)", [id]);
    await pool.query("UPDATE trial_activations SET activated_at = now() - interval '26 hours', ends_at = now() - interval '2 hours' WHERE user_id = (SELECT id FROM users WHERE public_id=$1)", [id]);
    await pool.end();
    await srv.stop();
    srv = await boot(fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-platform3-')), env);
    const after = await fetch(srv.base + '/studio', { redirect: 'manual', headers: { Cookie: keep } });
    assert.equal(after.status, 302); assert.equal(after.headers.get('location'), '/account?need=plan');
    const p3 = await (await fetch(srv.base + '/api/me/profile', { headers: { Cookie: keep } })).json();
    assert.equal(p3.access.active, false); assert.equal(p3.trial.status, 'expired');
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

test('subscription vouchers: one code, one plan period, for the account that redeems it', { skip, timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-voucher-'));
  const srv = await boot(dir);
  try {
    const pool = createPool(dbUrl);
    const seeded = (await pool.query("SELECT plan, count(*)::int AS n FROM promo_codes WHERE kind='plan' AND label='دفعة نوفمبر 2026' GROUP BY plan ORDER BY plan")).rows;
    assert.deepEqual(seeded, [{ plan: 'monthly', n: 100 }, { plan: 'weekly', n: 100 }], 'the November batch is installed by migration');
    const raw = fs.readFileSync(new URL('../migrations/003_vouchers_2026_11.sql', import.meta.url), 'utf8');
    assert.doesNotMatch(raw, /(AMIR|SHFQ)-[A-Z0-9]{4}/, 'no plain codes in the repository');
    await pool.end();
    const owner = browser(srv.base);
    await owner('POST', '/api/access/redeem', { code: OWNER });
    const made = await owner('POST', '/api/manage/voucher-create', { plan: 'monthly', count: 2, label: 'اختبار' });
    assert.equal(made.status, 200);
    const [a, b] = made.data.codes; assert.match(a, /^AMIR(-[A-HJ-NP-Z2-9]{4}){4}$/);
    const weekly = (await owner('POST', '/api/manage/voucher-create', { plan: 'weekly', count: 1 })).data.codes[0];
    assert.match(weekly, /^SHFQ-/);
    const guest = browser(srv.base);
    const anon = await guest('POST', '/api/access/redeem', { code: a });
    assert.equal(anon.status, 401); assert.equal(anon.data.voucher, true);
    const u = browser(srv.base);
    await u('POST', '/api/auth/register', { username: 'voucher_user', email: 'voucher@example.com', password: 'reef2026go', confirm: 'reef2026go' });
    const r1 = await u('POST', '/api/access/redeem', { code: a.toLowerCase() });
    assert.equal(r1.status, 200); assert.equal(r1.data.voucher.plan, 'monthly'); assert.equal(r1.data.next, '/studio');
    assert.equal((await browser(srv.base)('POST', '/api/access/redeem', { code: a })).status, 401, 'used code is still a voucher but needs an account');
    assert.equal((await u('POST', '/api/me/redeem', { code: a })).status, 409, 'single use');
    const r2 = await u('POST', '/api/me/redeem', { code: weekly });
    assert.equal(r2.status, 200);
    assert.equal(r2.data.voucher.startsAt, r1.data.voucher.endsAt, 'the week is added after the month');
    assert.equal((await owner('POST', '/api/manage/voucher-revoke', { code: b })).status, 200);
    assert.equal((await u('POST', '/api/me/redeem', { code: b })).status, 409, 'revoked');
    assert.equal((await u('POST', '/api/me/redeem', { code: 'AMIR-AAAA-BBBB-CCCC-DDDD' })).status, 401);
    const prof = (await u('GET', '/api/me/profile')).data;
    assert.equal(prof.access.plan, 'monthly'); assert.equal(prof.history.length, 2);
    assert.equal(prof.user.verified, false);
    assert.equal((await u('GET', '/studio')).status, 200, 'a redeemed voucher opens the studio without e-mail verification');
    const log = (await owner('GET', '/api/manage/audit')).data.log.map((l) => l.action);
    assert.ok(log.includes('voucher-create') && log.includes('voucher-revoke'));
  } finally { await srv.stop(); }
});
