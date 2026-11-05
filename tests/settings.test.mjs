// «لوحة التحكم / الإعدادات»: redeem codes, platform linking with proof of ownership, subscription and invoices,
// e-mail & password with re-authentication (password or Google), privacy enforced on the server, sessions, permanent ID.
// Real server + PostgreSQL + local stand-ins for Google's key endpoint and for Kick.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { createServer } from 'node:net';
import { generateKeyPairSync, createSign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { fakePlatforms } from './fake-platforms.mjs';
/** Official sign-in round trip: our start → the platform's page (approved as uid) → our callback. */
async function signIn(fake, b, p, uid) { const s = await b('GET', '/api/oauth/' + p + '/start'); const { code, state } = fake.approve(s.location, uid); return b('GET', '/api/oauth/' + p + '/callback?' + new URLSearchParams({ code, state })); }

const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_settings_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let available = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); available = true; } catch {}
const skip = available ? false : 'no PostgreSQL at TEST_DATABASE_URL';
test.after(async () => { if (!available) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

const OWNER = 'owner-token-for-settings-tests-1';
const CLIENT_ID = 'settings-test.apps.googleusercontent.com';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 10_000, what = 'condition') { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(150); } }
function idToken(claims) {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT_ID, iat: now, exp: now + 3600, email_verified: true, ...claims })).toString('base64url');
  return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(privateKey).toString('base64url');
}
async function jwks() {
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] })); });
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
  return { url: 'http://127.0.0.1:' + srv.address().port + '/certs', close: () => new Promise((r) => srv.close(r)) };
}
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function boot(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), ADMIN_TOKEN: OWNER, NODE_ENV: 'test', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-s-')), DATABASE_URL: dbUrl, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await sleep(50); }
  return { base: 'http://127.0.0.1:' + port, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
function browser(base, fixed = {}) {
  const jar = new Map();
  const call = async (method, route, body, headers = {}) => {
    const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const res = await fetch(base + route, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'User-Agent': fixed.ua || 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k); }
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, location: res.headers.get('location') };
  };
  return call;
}
const ownerOf = (base) => browser(base, {});
const ownerCall = (b) => (m, r, body) => b(m, r, body, { Authorization: 'Bearer ' + OWNER });

test('settings dashboard: free games, platforms, billing records, e-mail/password, Google re-auth, privacy, sessions, permanent ID', { skip, timeout: 180_000 }, async () => {
  const keys = await jwks();
  const kick = await fakePlatforms();
  kick.addKick(801, { slug: 'reefking' });
  const srv = await boot({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_JWKS_URL: keys.url, ...kick.env, SKY_HOST_TIMEOUT_MS: '5000' });
  const pool = new pg.Pool({ connectionString: dbUrl });
  const owner = ownerCall(ownerOf(srv.base));
  const anon = browser(srv.base);
  try {
    // 1. the settings page opens for a signed-in account (and only for one)
    assert.equal((await anon('GET', '/account')).status, 302);
    const u = browser(srv.base);
    const reg = await u('POST', '/api/auth/register', { username: 'reef_host', email: 'reef.host@example.com', password: 'reef2026go', confirm: 'reef2026go' });
    assert.equal(reg.status, 201);
    const pid = reg.data.account.publicId;
    assert.equal((await u('GET', '/account')).status, 200);
    for (const f of ['/dash.css', '/me.js', '/profile.js']) assert.equal((await anon('GET', f)).status, 200, f);
    let prof = (await u('GET', '/api/me/profile')).data;
    assert.equal(prof.access.active, true); assert.equal(prof.access.plan, 'free'); assert.deepEqual(prof.payments, []); assert.equal(prof.privacy.hideStream, false);

    // 2 + 3 + 7. no codes or subscriptions any more: the account already plays every game for free
    assert.equal((await owner('POST', '/api/manage/voucher-create', { plan: 'weekly', count: 2 })).status, 410);
    assert.notEqual((await u('POST', '/api/me/redeem', { code: 'SHFQ-0000-0000-0000-0000' })).status, 200);
    prof = (await u('GET', '/api/me/profile')).data;
    assert.equal(prof.access.planName, 'مجاني'); assert.equal(prof.history.length, 0);

    // 4. link Kick from settings: official sign-in with Kick (no typed name), stored as verified
    let r = await signIn(kick, u, 'kick', 801);
    assert.match(r.location, /linked=kick/);
    assert.equal((await u('GET', '/api/me/profile')).data.linked.kick.verified, true);
    // 6. after signing in again (another device) the link is still there
    const again = browser(srv.base, { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1' });
    assert.equal((await again('POST', '/api/auth/login', { identifier: 'reef_host', password: 'reef2026go' })).status, 200);
    assert.equal((await again('GET', '/api/me/profile')).data.linked.kick.handle, 'reefking');
    // 5. unlink removes it (and closes a running connection to it)
    assert.equal((await again('POST', '/api/me/stream-unlink', { platform: 'kick' })).data.removed, true);
    assert.equal((await u('GET', '/api/me/profile')).data.linked.kick, undefined);
    await waitFor(async () => (await anon('GET', '/api/state?room=' + reg.data.account.room)).data.connection.state === 'disconnected', 5000, 'connection closed');
    assert.equal((await pool.query("SELECT count(*)::int n FROM admin_audit_logs WHERE action IN ('stream-oauth-link','stream-unlink')")).rows[0].n, 2);

    // sessions: both devices listed with a label; sign out the other one
    let ses = (await u('GET', '/api/me/sessions')).data.sessions;
    assert.equal(ses.length, 2); assert.equal(ses.filter((x) => x.current).length, 1);
    assert.ok(ses.some((x) => /Chrome — Windows/.test(x.device)) && ses.some((x) => /Safari — iPhone/.test(x.device)));
    assert.equal(ses.some((x) => 'key' in x || 'id' in x && x.id.length > 16), false, 'only short handles, never the cookie');
    const mine = ses.find((x) => x.current);
    assert.equal((await u('POST', '/api/me/sessions-revoke', { id: mine.id })).status, 400, 'the current session is ended with «تسجيل الخروج»');
    assert.equal((await u('POST', '/api/me/sessions-revoke', { others: true })).data.removed, 1);
    assert.equal((await again('GET', '/api/me/profile')).status, 401, 'the other device is signed out');

    // 9. real invoices only: a payment row written by the billing system appears, nothing else
    await pool.query("INSERT INTO payments (user_id, plan, amount_halalas, provider, provider_ref, status, verified_at) SELECT id, 'monthly', 4499, 'moyasar', 'inv_test_1', 'paid', now() FROM users WHERE public_id=$1", [pid]);
    prof = (await u('GET', '/api/me/profile')).data;
    assert.deepEqual(prof.payments.map((p) => [p.plan, p.amount, p.status]), [['monthly', 44.99, 'paid']]);

    // e-mail change needs a fresh proof of identity
    assert.equal((await u('POST', '/api/me/email', { email: 'new.reef@example.com' })).status, 403);
    assert.equal((await u('POST', '/api/me/reauth', { password: 'wrong-pass-9' })).status, 401);
    assert.equal((await u('POST', '/api/me/reauth', { password: 'reef2026go' })).status, 200);
    const other = browser(srv.base);
    await other('POST', '/api/auth/register', { username: 'reef_other', email: 'other.reef@example.com', password: 'reef2026go', confirm: 'reef2026go' });
    assert.equal((await u('POST', '/api/me/email', { email: 'OTHER.reef@example.com' })).status, 409, 'an address used by another account');
    r = await u('POST', '/api/me/email', { email: 'new.reef@example.com' });
    assert.equal(r.status, 200); assert.equal(r.data.account.email, 'new.reef@example.com'); assert.equal(r.data.account.verified, false, 'a new address is unverified');

    // 12 + 13. privacy: saved, survives a new sign-in, and hides the stream from the public list for real
    assert.equal((await u('POST', '/api/me/privacy', { key: 'isAdmin', value: true })).status, 400, 'only known switches');
    assert.equal((await u('POST', '/api/me/privacy', { key: 'hideStream', value: 'yes' })).status, 400);
    r = await u('POST', '/api/me/privacy', { key: 'hideStream', value: true });
    assert.equal(r.data.privacy.hideStream, true);
    const back = browser(srv.base);
    assert.equal((await back('POST', '/api/auth/login', { identifier: 'new.reef@example.com', password: 'reef2026go' })).status, 200);
    assert.equal((await back('GET', '/api/me/profile')).data.privacy.hideStream, true, 'kept after signing in again');
    // a real listed stream: verified Kick + studio heartbeat + open game
    assert.match((await signIn(kick, back, 'kick', 801)).location, /linked=kick/);
    assert.equal((await back('POST', '/api/admin/connect', { platform: 'kick' })).status, 200);
    await back('POST', '/api/admin/heartbeat', { tab: 'settings-tab-1', screen: 'game' });
    await back('POST', '/api/admin/prepare', { mode: 'quiz' });
    let hb = (await back('POST', '/api/admin/heartbeat', { tab: 'settings-tab-1', screen: 'game' })).data;
    assert.equal(hb.listed, false); assert.deepEqual(hb.reasons, ['hidden']);
    assert.equal((await anon('GET', '/api/streams')).data.totalStreams, 0, 'hidden from the home page');
    await back('POST', '/api/admin/demo-players', { count: 2 });
    assert.equal((await back('POST', '/api/admin/start', {})).status, 200, 'the game still runs');
    await back('POST', '/api/admin/stop', {}); await back('POST', '/api/admin/prepare', { mode: 'quiz' });
    await back('POST', '/api/me/privacy', { key: 'hideStream', value: false });
    hb = (await back('POST', '/api/admin/heartbeat', { tab: 'settings-tab-1', screen: 'game' })).data;
    assert.equal(hb.listed, true);
    assert.equal((await anon('GET', '/api/streams')).data.totalStreams, 1);
    // streamer statistics come from that real session
    await waitFor(async () => (await back('GET', '/api/me/profile')).data.streamer.sessions >= 1, 8000, 'session counted');

    // 14. the public profile follows the switches; private data never leaves
    let pub = (await anon('GET', '/api/u/' + pid)).data;
    assert.equal(pub.publicId, pid); assert.equal(pub.email, undefined); assert.equal(pub.username, undefined);
    assert.deepEqual(pub.linked, [{ platform: 'kick', handle: 'reefking' }]); assert.ok(pub.streamer.sessions >= 1);
    await back('POST', '/api/me/privacy', { key: 'linkedAccounts', value: false });
    await back('POST', '/api/me/privacy', { key: 'streamerStats', value: false });
    await back('POST', '/api/me/privacy', { key: 'playerStats', value: false });
    pub = (await anon('GET', '/api/u/' + pid)).data;
    assert.equal(pub.linked, null); assert.equal(pub.streamer, null); assert.equal(pub.player, null);
    assert.equal((await anon('GET', '/u/' + pid)).status, 200);
    assert.equal((await anon('GET', '/api/u/SPG-NOPE00')).status, 404);
    assert.equal((await anon('POST', '/api/me/privacy', { key: 'hideStream', value: true })).status, 401);
    assert.equal((await back('POST', '/api/me/privacy', { key: 'hideStream', value: true }, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' })).status, 403);

    // 8. stopping old subscription rows changes nothing: games and platform linking stay free
    assert.equal((await owner('POST', '/api/manage/stop', { publicId: pid })).status, 200);
    prof = (await back('GET', '/api/me/profile')).data;
    assert.equal(prof.access.active, true);
    r = await back('POST', '/api/admin/connect', { platform: 'kick' });
    assert.notEqual(r.status, 402);
    assert.doesNotMatch((await back('GET', '/api/oauth/kick/start')).location, /link_error=plan/);

    // 10 + 11. Google account: re-auth with Google (the same Google account only), then add a local password
    const g = browser(srv.base);
    const nonce = async (b) => (await b('GET', '/api/auth/google')).data.nonce;
    r = await g('POST', '/api/auth/google', { credential: idToken({ sub: 'g-settings-1', email: 'g.settings@gmail.com', name: 'Google Reef', nonce: await nonce(g) }) });
    assert.equal(r.status, 200);
    const gid = r.data.account.publicId;
    assert.equal(r.data.account.hasPassword, false);
    assert.equal((await g('POST', '/api/me/password', { password: 'coral2026go', confirm: 'coral2026go' })).status, 403, 'needs identity first');
    assert.equal((await g('POST', '/api/me/reauth', { credential: idToken({ sub: 'someone-else', email: 'x@gmail.com', nonce: await nonce(g) }) })).status, 403, 'another Google account');
    assert.equal((await g('POST', '/api/me/google-unlink', {})).status, 403);
    assert.equal((await g('POST', '/api/me/reauth', { credential: idToken({ sub: 'g-settings-1', email: 'g.settings@gmail.com', nonce: await nonce(g) }) })).status, 200);
    assert.equal((await g('POST', '/api/me/google-unlink', {})).status, 409, 'the last way in cannot be removed');
    assert.equal((await g('POST', '/api/me/password', { password: '12345678', confirm: '12345678' })).status, 400, 'weak password');
    r = await g('POST', '/api/me/password', { password: 'coral2026go', confirm: 'coral2026go' });
    assert.equal(r.status, 200); assert.equal(r.data.account.hasPassword, true);
    const viaPw = browser(srv.base);
    assert.equal((await viaPw('POST', '/api/auth/login', { identifier: 'g.settings@gmail.com', password: 'coral2026go' })).data.account.publicId, gid, 'local password signs in to the same account');
    // now Google can be unlinked safely, and linked again; the permanent ID never changes
    assert.equal((await g('POST', '/api/me/google-unlink', {})).status, 200);
    assert.equal((await g('GET', '/api/me/profile')).data.user.googleLinked, false);

    // 15. permanent ID: unchanged by name, e-mail and Google changes, and the database refuses to change it
    await u('POST', '/api/me/update', { displayName: 'اسم جديد' });
    assert.equal((await back('GET', '/api/me/profile')).data.user.publicId, pid);
    await assert.rejects(pool.query("UPDATE users SET public_id='SPG-AAAAAA' WHERE public_id=$1", [pid]));
    assert.equal((await g('GET', '/api/me/profile')).data.user.publicId, gid);
  } finally { await pool.end(); await srv.stop(); await kick.close(); await keys.close(); }
});

// 16. layout: one column on phones, side menu becomes a drawer, no fixed element over the buttons
test('dashboard layout rules for phone and desktop', () => {
  const css = fs.readFileSync(new URL('../public/dash.css', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../public/me.html', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width:980px\)\{[^]*\.ds-side\{position:fixed/);
  assert.match(css, /@media \(max-width:700px\)\{[^]*\.ds-platforms,\.ds-toggles,\.ds-actions,\.ds-stats\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css, /prefers-reduced-motion/);
  for (const id of ['voucherForm', 'platforms', 'loginCard', 'subCard', 'privacyCard', 'securityCard', 'publicId', 'copyId', 'sessionList', 'signOutOthers']) assert.match(html, new RegExp('id="' + id + '"'), id);
  assert.doesNotMatch(html, /style="/, 'no inline styles (CSP)');
  assert.doesNotMatch(fs.readFileSync(new URL('../public/me.js', import.meta.url), 'utf8'), /innerHTML|WebSocket/);
});
