// «عملات الإسفنجة»: wallet movements, the 200-coin daily reward (server clock, once per 24 h, no catch-up,
// race-safe, restart-safe) and invitations (50 coins, verified friends only, max 10, self-invite signals).
// Real PostgreSQL (+ a real server for the HTTP part); skipped when none is reachable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { createPool, migrate, tx } from '../src/db.mjs';
import { Platform } from '../src/platform.mjs';
import { Economy, DAILY_REWARD, REFERRAL_REWARD, REFERRAL_CAP } from '../src/economy.mjs';

const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_eco_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let available = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); available = true; } catch {}
const skip = available ? false : 'no PostgreSQL at TEST_DATABASE_URL';
test.after(async () => { if (!available) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

let n = 0;
const mk = (p, verified = true) => p.register({ username: 'eco' + (++n), email: 'eco' + n + '@example.com', password: 'reef2026go', confirm: 'reef2026go' })
  .then(async (u) => { if (verified) await p.pool.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [u.id]); return u; });

test('daily reward: 200 once per 24 h on the server clock, race- and restart-safe', { skip }, async () => {
  const pool = createPool(dbUrl); await migrate(pool, { log: null });
  const p = new Platform({ pool, hashCode: (c) => c, mail: { send: async () => ({ sent: false }) }, gateway: { configured: false } });
  const eco = new Economy({ pool });
  try {
    const guest = await mk(p, false);
    const r0 = await eco.claimDaily(guest.id);
    assert.deepEqual([r0.granted, r0.reason, r0.balance], [false, 'verify', 0], 'unverified accounts get nothing');

    const u = await mk(p);
    const first = await eco.claimDaily(u.id);
    assert.deepEqual([first.granted, first.amount, first.balance, first.earned], [true, DAILY_REWARD, 200, 200]);
    const left = Date.parse(first.daily.nextAt) - Date.parse(first.serverNow);
    assert.ok(left > 23.9 * 3600e3 && left <= 24 * 3600e3, 'next one in 24 h of server time');
    // refresh / second tab / replayed request
    for (let i = 0; i < 3; i++) assert.equal((await eco.claimDaily(u.id)).granted, false);
    assert.equal((await eco.wallet(u.id)).balance, 200);

    // due again: 25 simultaneous requests → exactly one reward
    await pool.query(`UPDATE wallets SET next_daily_at = now() - interval '1 second' WHERE user_id=$1`, [u.id]);
    const burst = await Promise.all(Array.from({ length: 25 }, () => eco.claimDaily(u.id)));
    assert.equal(burst.filter((r) => r.granted).length, 1);
    assert.equal((await eco.wallet(u.id)).balance, 400);

    // missed days do not pile up
    await pool.query(`UPDATE wallets SET next_daily_at = now() - interval '6 days' WHERE user_id=$1`, [u.id]);
    assert.equal((await eco.claimDaily(u.id)).balance, 600, 'one reward, not six');

    // a restarted server (new instances) sees the same state
    const eco2 = new Economy({ pool });
    const after = await eco2.claimDaily(u.id);
    assert.deepEqual([after.granted, after.balance, after.daily.count], [false, 600, 3]);
    const rows = (await pool.query(`SELECT count(*)::int n FROM wallet_transactions WHERE user_id=$1 AND kind='daily'`, [u.id])).rows[0].n;
    assert.equal(rows, 3);

    // wallet movements: idempotent by key, never negative
    await tx(pool, (c) => eco.move(c, u.id, { amount: 5, bucket: 'earned', kind: 'admin', ref: 'k1' }));
    assert.equal((await tx(pool, (c) => eco.move(c, u.id, { amount: 5, bucket: 'earned', kind: 'admin', ref: 'k1' }))).duplicate, true);
    await assert.rejects(tx(pool, (c) => eco.move(c, u.id, { amount: -10_000, bucket: 'earned', kind: 'admin', ref: 'k2' })), /لا يكفي/);
    assert.equal((await eco.wallet(u.id)).balance, 605);
    await assert.rejects(eco.adjust(u.id, { amount: 100, reason: 'x', actor: 'owner' }), /سبب/);
    const adj = await eco.adjust(u.id, { amount: 100, reason: 'تعويض عن عطل', actor: 'owner' });
    assert.equal(adj.balance, 705);
    assert.equal((await eco.adminOverview()).logs[0].action, 'wallet-adjust');
  } finally { await pool.end(); }
});

test('invitations: 50 per verified friend, max 10, self-invite signals held', { skip }, async () => {
  const pool = createPool(dbUrl); await migrate(pool, { log: null });
  const p = new Platform({ pool, hashCode: (c) => c, mail: { send: async () => ({ sent: false }) }, gateway: { configured: false } });
  const eco = new Economy({ pool });
  try {
    const host = await mk(p);
    await eco.noteDevice(host.id, 'dev-host');
    await pool.query(`UPDATE users SET signup_ip_hash='net-host' WHERE id=$1`, [host.id]);
    assert.equal(await eco.attachReferral(host.id, host.public_id), null, 'no self-invitation');
    assert.equal(await eco.attachReferral(host.id, 'SPG-??'), null);

    // an unverified friend earns the inviter nothing yet; verifying settles it once
    const f1 = await mk(p, false);
    await eco.attachReferral(f1.id, host.public_id.toLowerCase(), { device: 'dev-f1', ipHash: 'net-f1' });
    assert.equal(await eco.settleReferral(f1.id), 'pending');
    assert.equal((await eco.wallet(host.id)).balance, 0);
    await pool.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [f1.id]);
    const twice = await Promise.all([eco.settleReferral(f1.id), eco.settleReferral(f1.id), eco.settleReferral(f1.id)]);
    assert.ok(twice.includes('granted'));
    assert.equal((await eco.wallet(host.id)).balance, REFERRAL_REWARD, 'paid once');
    // the same account cannot be counted for a second inviter
    const other = await mk(p);
    await eco.attachReferral(f1.id, other.public_id);
    assert.equal((await pool.query('SELECT referrer_id FROM referrals WHERE referee_id=$1', [f1.id])).rows[0].referrer_id, host.id);

    // same browser as the inviter → held for review, no coins
    const sneaky = await mk(p, false);
    await eco.attachReferral(sneaky.id, host.public_id, { device: 'dev-host', ipHash: 'net-x' });
    await pool.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [sneaky.id]);
    assert.equal(await eco.settleReferral(sneaky.id), 'held');
    // same sign-up network → held as well
    const sameNet = await mk(p, false);
    await eco.attachReferral(sameNet.id, host.public_id, { device: 'dev-y', ipHash: 'net-host' });
    await pool.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [sameNet.id]);
    assert.equal(await eco.settleReferral(sameNet.id), 'held');
    assert.equal((await eco.wallet(host.id)).balance, 50);
    await assert.rejects(eco.decideReferral(sameNet.id, true, 'owner', ''), /سبب/);
    assert.equal(await eco.decideReferral(sameNet.id, true, 'owner', 'أخوان في نفس البيت'), 'granted');
    assert.equal(await eco.decideReferral(sneaky.id, false, 'owner', 'نفس المتصفح'), 'rejected');
    assert.equal((await eco.wallet(host.id)).balance, 100);

    // up to the cap: 10 rewarded friends = 500, the 11th and later earn nothing
    for (let i = 0; i < 10; i++) {
      const f = await mk(p, false);
      await eco.attachReferral(f.id, host.public_id, { device: 'dev-f' + i, ipHash: 'net-f' + i });
      await pool.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [f.id]);
      await eco.settleReferral(f.id);
    }
    const inv = await eco.invitations(host.id, host.public_id, 'https://x');
    assert.deepEqual([inv.completed, inv.remaining, inv.earned], [REFERRAL_CAP, 0, 500]);
    assert.equal((await eco.wallet(host.id)).balance, 500);
    assert.equal(inv.link, 'https://x/signup?ref=' + host.public_id);
    assert.ok(inv.list.some((r) => r.status === 'capped'));
  } finally { await pool.end(); }
});

async function boot() {
  const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const port = s.address().port; await new Promise((r) => s.close(r));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), ADMIN_TOKEN: 'owner-token-economy-1', NODE_ENV: 'test', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-eco-')), DATABASE_URL: dbUrl, APP_URL: 'http://127.0.0.1:' + port }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await new Promise((r) => setTimeout(r, 50)); }
  return { base: 'http://127.0.0.1:' + port, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
function browser(base) {
  const jar = new Map();
  const call = async (method, route, body) => {
    const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const res = await fetch(base + route, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k); }
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, location: res.headers.get('location') };
  };
  call.jar = jar; return call;
}

test('HTTP: invitation link → sign-up → e-mail verified → inviter paid; daily reward endpoint', { skip, timeout: 60_000 }, async () => {
  const { base, stop } = await boot();
  try {
    const host = browser(base);
    const h = await host('POST', '/api/auth/register', { username: 'hostweb', email: 'hostweb@example.com', password: 'reef2026go', confirm: 'reef2026go' });
    assert.equal(h.status, 201);
    const hostId = h.data.account.publicId;
    // the inviter is not verified yet → no daily reward
    assert.equal((await host('POST', '/api/me/daily-claim', {})).data.reason, 'verify');

    const friend = browser(base);
    await friend('GET', '/signup?ref=' + hostId);
    assert.ok(friend.jar.has('sl_ref'), 'the link is remembered');
    assert.ok(!(await friend('GET', '/api/me/wallet')).data?.balance, 'visiting the link pays nothing');
    const f = await friend('POST', '/api/auth/register', { username: 'friendweb', email: 'friendweb@example.com', password: 'reef2026go', confirm: 'reef2026go' });
    assert.equal(f.status, 201);
    assert.ok(!friend.jar.has('sl_ref'), 'used once');
    let inv = (await host('GET', '/api/me/invites')).data;
    assert.deepEqual([inv.completed, inv.pending], [0, 1]);
    // the friend verifies the e-mail (dev link in test mode)
    const link = (await friend('POST', '/api/auth/resend', {})).data.devLink;
    assert.match(link, /\/verify\?token=/);
    assert.equal((await friend('GET', new URL(link).pathname + new URL(link).search)).location, '/account?verified=1');
    inv = (await host('GET', '/api/me/invites')).data;
    assert.deepEqual([inv.completed, inv.earned], [1, 50]);
    assert.equal((await host('GET', '/api/me/wallet')).data.balance, 50);

    // the friend, now verified, gets the daily reward once; the body cannot change the amount
    const d1 = await friend('POST', '/api/me/daily-claim', { amount: 999999 });
    assert.deepEqual([d1.data.granted, d1.data.balance], [true, 200]);
    assert.equal((await friend('POST', '/api/me/daily-claim', {})).data.granted, false);
    assert.equal((await friend('GET', '/api/me/wallet')).data.transactions[0].kind, 'daily');
    // guests get nothing
    assert.equal((await browser(base)('POST', '/api/me/daily-claim', {})).status, 401);
  } finally { await stop(); }
});
