// Studio access by account state, one-click free trial, and Sign in with Google — against a real PostgreSQL
// and a stand-in for Google's key endpoint (tokens are signed here with a test RSA key).
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
import { GoogleVerifier } from '../src/google.mjs';

const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_gtest_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let available = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); available = true; } catch {}
const skip = available ? false : 'no PostgreSQL at TEST_DATABASE_URL';
test.after(async () => { if (!available) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

const OWNER = 'owner-token-for-google-tests-1';
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';
function idToken(claims, { key = privateKey, kid = KID } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT_ID, iat: now, exp: now + 3600, email_verified: true, ...claims })).toString('base64url');
  return h + '.' + p + '.' + createSign('RSA-SHA256').update(h + '.' + p).sign(key).toString('base64url');
}
async function jwksServer() {
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }); res.end(JSON.stringify({ keys: [jwk] })); });
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
  return { url: 'http://127.0.0.1:' + srv.address().port + '/certs', close: () => new Promise((r) => srv.close(r)) };
}
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function boot(env) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), ADMIN_TOKEN: OWNER, NODE_ENV: 'test', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-g-')), DATABASE_URL: dbUrl, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await new Promise((r) => setTimeout(r, 50)); }
  return { base: 'http://127.0.0.1:' + port, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
/** A browser: keeps every cookie it is given (session + Google nonce). */
function browser(base) {
  const jar = new Map();
  const call = async (method, route, body, headers = {}) => {
    const cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const res = await fetch(base + route, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k); }
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, location: res.headers.get('location') };
  };
  call.cookies = jar;
  return call;
}
async function googleSignIn(b, claims, extra = {}) {
  const { data } = await b('GET', '/api/auth/google');
  assert.equal(data.enabled, true); assert.equal(data.clientId, CLIENT_ID);
  return b('POST', extra.link ? '/api/me/link-google' : '/api/auth/google', { credential: idToken({ nonce: data.nonce, ...claims }), ...extra });
}

test('Google ID tokens: signature, issuer, audience, expiry and nonce are all checked', { skip }, async () => {
  const keys = await jwksServer();
  try {
    const v = new GoogleVerifier({ clientId: CLIENT_ID, jwksUrl: keys.url });
    const ok = await v.verify(idToken({ sub: '1001', email: 'a@gmail.com', nonce: 'n1' }), { nonce: 'n1' });
    assert.equal(ok.sub, '1001'); assert.equal(ok.emailVerified, true);
    await assert.rejects(v.verify(idToken({ sub: '1', nonce: 'other' }), { nonce: 'n1' }), /nonce/);
    await assert.rejects(v.verify(idToken({ sub: '1', aud: 'someone-else' }), {}), /audience/);
    await assert.rejects(v.verify(idToken({ sub: '1', iss: 'https://evil.example' }), {}), /issuer/);
    await assert.rejects(v.verify(idToken({ sub: '1', exp: Math.floor(Date.now() / 1000) - 600 }), {}), /expired/);
    const { privateKey: other } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await assert.rejects(v.verify(idToken({ sub: '1' }, { key: other }), {}), /signature/);
    const t = idToken({ sub: '1' }); const [h, p, sig] = t.split('.');
    const forged = h + '.' + Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), sub: '2' })).toString('base64url') + '.' + sig;
    await assert.rejects(v.verify(forged, {}), /signature/, 'changing the subject breaks the signature');
    await assert.rejects(new GoogleVerifier({}).verify(t), /not configured/);
  } finally { await keys.close(); }
});

test('studio access by account state, one-click trial, Google sign-in and linking', { skip, timeout: 120_000 }, async () => {
  const keys = await jwksServer();
  const env = { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_JWKS_URL: keys.url };
  let srv = await boot(env);
  try {
    // 3 + 9: not signed in — the studio, its API and its pages are closed
    const anon = browser(srv.base);
    for (const p of ['/studio', '/studio?mode=flag', '/dashboard', '/event', '/bomb']) assert.equal((await anon('GET', p)).status, 302, p);
    assert.equal((await anon('POST', '/api/admin/start', {})).status, 401);
    assert.equal((await anon('POST', '/api/me/trial-start', {})).status, 401);
    assert.equal((await anon('GET', '/api/auth/config')).data.google, true);

    // 4: new e-mail account starts its trial with one click and goes straight in
    const a = browser(srv.base);
    const reg = await a('POST', '/api/auth/register', { username: 'trial_fan', email: 'trial.fan@example.com', password: 'reef2026go', confirm: 'reef2026go' });
    assert.equal(reg.status, 201);
    const id = reg.data.account.publicId;
    assert.equal((await a('GET', '/studio')).location, '/account?need=plan', 'no access before the trial');
    assert.equal(reg.data.account.trial.status, 'available');
    // 7: many clicks at the same moment create exactly one trial
    const clicks = await Promise.all(Array.from({ length: 6 }, () => a('POST', '/api/me/trial-start', {})));
    assert.ok(clicks.every((r) => r.status === 200), clicks.map((r) => r.status).join());
    assert.equal(clicks.filter((r) => r.data.started).length, 1, 'only one click starts the trial');
    const started = clicks.find((r) => r.data.started).data;
    assert.equal(new Date(started.endsAt) - new Date(started.startedAt), 24 * 3600_000, 'exactly 24 hours');
    // 2: active trial — straight into the studio, no code
    assert.equal((await a('GET', '/studio')).status, 200);
    const me = (await a('GET', '/api/access/me')).data;
    assert.equal(me.signedIn, true); assert.equal(me.account.plan, 'trial'); assert.equal(me.account.trial.status, 'active');
    assert.equal((await a('POST', '/api/me/trial-start', {})).data.already, true, 'pressing again does not restart it');
    // 10: another device signs in to the same account: same access, same countdown
    const phone = browser(srv.base);
    const li = await phone('POST', '/api/auth/login', { identifier: 'trial.fan@example.com', password: 'reef2026go' });
    assert.equal(li.data.next, '/studio'); assert.equal(li.data.account.endsAt, me.account.endsAt);
    // 11: a request dropped mid-way, then retried: still one trial
    const ctl = new AbortController();
    const cookie = [...phone.cookies].map(([k, v]) => k + '=' + v).join('; ');
    const dropped = fetch(srv.base + '/api/me/trial-start', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}', signal: ctl.signal }).catch(() => null);
    ctl.abort(); await dropped;
    assert.equal((await phone('POST', '/api/me/trial-start', {})).status, 200);

    // 12: the WebSocket is a read-only screen: messages sent to it change nothing
    const room = me.room;
    const before = (await anon('GET', '/api/state?room=' + room)).data;
    const ws = new WebSocket(srv.base.replace('http', 'ws') + '/ws?room=' + room);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    for (const m of [{ action: 'start' }, { type: 'admin', action: 'reset' }, { action: 'connect', username: 'x' }]) ws.send(JSON.stringify(m));
    await new Promise((r) => setTimeout(r, 300)); ws.close();
    const after = (await anon('GET', '/api/state?room=' + room)).data;
    assert.equal(after.status.active, before.status.active); assert.equal(after.connection.state, before.connection.state);
    const bad = new WebSocket(srv.base.replace('http', 'ws') + '/ws?room=anothernope');
    assert.equal(await new Promise((r) => { bad.onerror = () => r('refused'); bad.onopen = () => r('open'); }), 'refused', 'unknown rooms are refused');

    // 5: a new Google user gets an account and a permanent ID
    const g = browser(srv.base);
    const g1 = await googleSignIn(g, { sub: 'google-sub-777', email: 'new.player@gmail.com', name: 'لاعب جديد' });
    assert.equal(g1.status, 200, JSON.stringify(g1.data));
    const gid = g1.data.account.publicId;
    assert.match(gid, /^SPG-[A-HJ-NP-Z2-9]{6}$/); assert.equal(g1.data.account.googleLinked, true); assert.equal(g1.data.account.verified, true);
    const gTrial = await g('POST', '/api/me/trial-start', {});
    assert.equal(gTrial.data.started, true);
    assert.equal((await g('GET', '/studio')).status, 200);
    // 6: signing in with Google again (another device) finds the same account, never a duplicate
    const g2 = await googleSignIn(browser(srv.base), { sub: 'google-sub-777', email: 'new.player@gmail.com' });
    assert.equal(g2.data.account.publicId, gid); assert.equal(g2.data.next, '/studio');
    // forged nonce / token for another site are refused
    const nb = browser(srv.base); await nb('GET', '/api/auth/google');
    assert.equal((await nb('POST', '/api/auth/google', { credential: idToken({ sub: 'x', email: 'x@gmail.com', nonce: 'guessed' }) })).status, 401);
    assert.equal((await googleSignIn(browser(srv.base), { sub: 'y', email: 'y@gmail.com', aud: 'other-app' })).status, 401);
    // same e-mail as an existing password account but not verified by Google: no automatic merge
    const clash = await googleSignIn(browser(srv.base), { sub: 'google-sub-888', email: 'Trial.Fan@example.com', email_verified: false });
    assert.equal(clash.status, 409); assert.equal(clash.data.needsLink, true);
    // 14: linking Google from the signed-in account keeps the permanent ID; then Google opens that same account
    const link = await googleSignIn(a, { sub: 'google-sub-888', email: 'trial.fan@example.com' }, { link: true });
    assert.equal(link.status, 200); assert.equal(link.data.account.publicId, id); assert.equal(link.data.account.googleLinked, true);
    const viaGoogle = await googleSignIn(browser(srv.base), { sub: 'google-sub-888', email: 'trial.fan@example.com' });
    assert.equal(viaGoogle.data.account.publicId, id);
    assert.equal((await googleSignIn(g, { sub: 'google-sub-888', email: 'x@x.io' }, { link: true })).status, 409, 'a Google account links to one SPONGE account only');
    const pool = new pg.Pool({ connectionString: dbUrl });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM users WHERE google_sub IN ('google-sub-777','google-sub-888')")).rows[0].n, 2);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM trial_activations WHERE user_id=(SELECT id FROM users WHERE public_id=$1)', [id])).rows[0].n, 1);
    const view = (await pool.query('SELECT * FROM account_access WHERE public_id=$1', [id])).rows[0];
    assert.equal(view.trial_used, true); assert.equal(view.google_linked, true); assert.equal(view.subscription_status, 'active');

    // 1: a subscriber goes straight in
    const owner = browser(srv.base); await owner('POST', '/api/access/redeem', { code: OWNER });
    const sub = browser(srv.base);
    const subReg = await sub('POST', '/api/auth/register', { username: 'month_sub', email: 'month@example.com', password: 'reef2026go', confirm: 'reef2026go' });
    await owner('POST', '/api/manage/grant', { publicId: subReg.data.account.publicId, days: 30, plan: 'monthly' });
    assert.equal((await sub('GET', '/studio')).status, 200);
    assert.equal((await sub('POST', '/api/me/trial-start', {})).data.entitled, true, 'a subscriber is sent in without spending the trial');

    // 8 + 13 + 15: after the trial ends (and a restart), the studio closes, renewal is offered, no second trial
    await pool.query("UPDATE trial_activations SET activated_at=now()-interval '25 hours', ends_at=now()-interval '1 hour' WHERE user_id=(SELECT id FROM users WHERE public_id=$1)", [id]);
    await pool.query("UPDATE subscriptions SET starts_at=now()-interval '25 hours', ends_at=now()-interval '1 hour' WHERE user_id=(SELECT id FROM users WHERE public_id=$1)", [id]);
    await pool.end();
    await srv.stop(); srv = await boot(env);
    const back = async (b, ...x) => { const r = await fetch(srv.base + x[1], { method: x[0], redirect: 'manual', headers: { 'Content-Type': 'application/json', Cookie: [...b.cookies].map(([k, v]) => k + '=' + v).join('; ') }, ...(x[2] ? { body: JSON.stringify(x[2]) } : {}) }); let d = null; try { d = await r.json(); } catch {} return { status: r.status, data: d, location: r.headers.get('location') }; };
    assert.equal((await back(a, 'GET', '/studio')).location, '/account?need=plan');
    const ended = (await back(a, 'GET', '/api/access/me')).data.account;
    assert.equal(ended.expired, true); assert.equal(ended.trial.status, 'expired'); assert.equal(ended.publicId, id);
    assert.equal((await back(a, 'POST', '/api/me/trial-start', {})).status, 409, 'an expired trial cannot be used again');
    assert.equal((await back(a, 'POST', '/api/admin/start', {})).status, 402, 'studio commands are refused with a renewal hint');
    assert.equal((await back(sub, 'GET', '/studio')).status, 200, 'the subscriber survived the restart');
    assert.equal((await back(g, 'GET', '/studio')).status, 200, 'the Google user and trial survived the restart');
  } finally { await srv.stop(); await keys.close(); }
});
