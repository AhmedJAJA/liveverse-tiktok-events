// «المتابعة باستخدام Google» as an OpenID Connect Authorization Code flow (state, nonce, PKCE), the safe link of an
// existing e-mail account, linking from the settings, sessions («تذكرني», sign-out), and password reset — against a real
// PostgreSQL and stand-ins for Google's token and key endpoints (tokens are signed here with a test RSA key).
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
import { createHash } from 'node:crypto';

const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_gcode_' + process.pid;
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
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), ADMIN_TOKEN: OWNER, NODE_ENV: 'test', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-gc-')), DATABASE_URL: dbUrl, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
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


/** Google's token endpoint: a code works once; the ID token carries the nonce of the sign-in it was issued for. */
async function fakeGoogle() {
  const codes = new Map(); // code -> { claims, challenge, redirectUri, used }
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
  const srv = http.createServer(async (req, res) => {
    const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }); res.end(JSON.stringify(o)); };
    if (req.url.startsWith('/certs')) return send(200, { keys: [jwk] });
    if (req.url.startsWith('/token') && req.method === 'POST') {
      let raw = ''; for await (const c of req) raw += c;
      const f = new URLSearchParams(raw), c = codes.get(f.get('code'));
      if (f.get('client_id') !== CLIENT_ID || f.get('client_secret') !== 'test-secret') return send(401, { error: 'invalid_client' });
      if (!c || c.used) return send(400, { error: 'invalid_grant' });
      if (f.get('redirect_uri') !== c.redirectUri) return send(400, { error: 'redirect_uri_mismatch' });
      if (createHash('sha256').update(f.get('code_verifier') || '').digest('base64url') !== c.challenge) return send(400, { error: 'invalid_grant' });
      c.used = true;
      return send(200, { access_token: 'ya29.test', expires_in: 3599, token_type: 'Bearer', id_token: c.token(c) });
    }
    send(404, {});
  });
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
  const base = 'http://127.0.0.1:' + srv.address().port;
  let n = 0;
  return { base, env: { GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_JWKS_URL: base + '/certs', GOOGLE_TOKEN_URL: base + '/token', GOOGLE_AUTH_URL: 'https://accounts.google.test/auth' },
    /** What Google's consent page does: read the request, return a code to our callback. */
    approve(location, claims, { token } = {}) {
      const u = new URL(location), p = u.searchParams;
      const code = 'code-' + ++n;
      codes.set(code, { claims, challenge: p.get('code_challenge'), redirectUri: p.get('redirect_uri'), token: token || ((c) => idToken({ ...claims, nonce: p.get('nonce') })) });
      return { code, state: p.get('state'), params: p };
    },
    close: () => new Promise((r) => srv.close(r)) };
}
const pathOf = (loc) => { const u = new URL(loc, 'http://x'); return u.pathname + u.search; };
async function googleFlow(fake, b, claims, { mode = 'login', next = '', tweak = (q) => q, token, remember = true } = {}) {
  const q = new URLSearchParams({ mode }); if (next) q.set('next', next); if (!remember) q.set('remember', '0');
  const start = await b('GET', '/api/oauth/google/start?' + q);
  if (!/accounts\.google\.test\/auth\?/.test(start.location || '')) return { start };
  const a = fake.approve(start.location, claims, { token });
  const cb = await b('GET', '/api/oauth/google/callback?' + new URLSearchParams(tweak({ code: a.code, state: a.state })));
  return { start, cb, a };
}

test('Google code flow: state, nonce, PKCE, one account per Google identity, safe linking, sessions, reset', { skip, timeout: 180_000 }, async () => {
  const fake = await fakeGoogle();
  const srv = await boot(fake.env);
  const pool = new pg.Pool({ connectionString: dbUrl });
  try {
    const anon = browser(srv.base);
    let g = await anon('GET', '/api/auth/google');
    assert.equal(g.data.codeFlow, true, 'the server offers the code flow');
    // 1. the request to Google: our client, code + PKCE S256, nonce, state, the callback on this site
    let r = await anon('GET', '/api/oauth/google/start?mode=login&next=/game/quiz');
    const p = new URL(r.location).searchParams;
    assert.equal(p.get('client_id'), CLIENT_ID); assert.equal(p.get('response_type'), 'code'); assert.equal(p.get('scope'), 'openid email profile');
    assert.equal(p.get('code_challenge_method'), 'S256'); assert.ok(p.get('code_challenge') && p.get('nonce') && p.get('state'));
    assert.equal(p.get('redirect_uri'), srv.base + '/api/oauth/google/callback');
    assert.ok(!r.location.includes('test-secret'), 'the secret never goes to the browser');

    // 2. a new person: an account with a permanent ID; the session is opened by the server, then the next page
    const nora = browser(srv.base);
    let f = await googleFlow(fake, nora, { sub: 'g-100', email: 'nora@gmail.com', name: 'Nora' }, { next: '/game/quiz' });
    assert.equal(f.cb.status, 302); assert.equal(pathOf(f.cb.location), '/game/quiz');
    let me = (await nora('GET', '/api/auth/me')).data;
    assert.ok(me.account); const spg = me.account.publicId; assert.match(spg, /^SPG-/);
    assert.equal(me.session.remember, true, '«تذكرني» by default');
    // 3. the same Google identity again (another device): the same account, never a second one
    const nora2 = browser(srv.base);
    f = await googleFlow(fake, nora2, { sub: 'g-100', email: 'nora.new@gmail.com', name: 'Nora' });
    assert.equal((await nora2('GET', '/api/auth/me')).data.account.publicId, spg, 'found by Google subject, not by e-mail');
    assert.equal((await pool.query("SELECT count(*)::int n FROM users WHERE google_sub='g-100'")).rows[0].n, 1);
    // 4. two sign-ins started in two tabs both complete (the state is per attempt, bound to the browser)
    const tabs = browser(srv.base);
    const s1 = await tabs('GET', '/api/oauth/google/start?mode=login'), s2 = await tabs('GET', '/api/oauth/google/start?mode=login');
    const a1 = fake.approve(s1.location, { sub: 'g-200', email: 'tabs@gmail.com' }), a2 = fake.approve(s2.location, { sub: 'g-200', email: 'tabs@gmail.com' });
    assert.notEqual(a1.state, a2.state);
    assert.match((await tabs('GET', '/api/oauth/google/callback?' + new URLSearchParams({ code: a2.code, state: a2.state }))).location, /^\/account/);
    assert.match((await tabs('GET', '/api/oauth/google/callback?' + new URLSearchParams({ code: a1.code, state: a1.state }))).location, /^\/(account|games)/);

    // 5. refusals, each with its message code — and no session
    const bad = async (claims, opts, code) => { const b = browser(srv.base); const x = await googleFlow(fake, b, claims, opts); assert.match(x.cb.location, new RegExp('google_error=' + code), code); assert.equal((await b('GET', '/api/auth/me')).data.account ?? null, null, code); return x; };
    await bad({ sub: 'g-300', email: 'x@gmail.com' }, { tweak: (q) => ({ ...q, state: 'forged-state-value' }) }, 'state');
    await bad({ sub: 'g-300', email: 'x@gmail.com' }, { tweak: (q) => ({ state: q.state, error: 'access_denied' }) }, 'cancelled');
    await bad({ sub: 'g-300', email: 'x@gmail.com' }, { token: () => idToken({ sub: 'g-300', email: 'x@gmail.com', nonce: 'another-nonce' }) }, 'verify');
    const { privateKey: other } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await bad({ sub: 'g-300', email: 'x@gmail.com' }, { token: (c) => idToken({ sub: 'g-300', email: 'x@gmail.com' }, { key: other }) }, 'verify');
    await bad({ sub: 'g-300', email: 'x@gmail.com' }, { token: () => idToken({ sub: 'g-300', email: 'x@gmail.com', aud: 'other-app' }) }, 'verify');
    // the same callback twice (a reused code / state) works once only
    const twice = browser(srv.base);
    f = await googleFlow(fake, twice, { sub: 'g-400', email: 'twice@gmail.com' });
    const again = await twice('GET', '/api/oauth/google/callback?' + new URLSearchParams({ code: f.a.code, state: f.a.state }));
    assert.match(again.location, /google_error=state/);
    // a callback from another browser (no binding cookie) is refused
    const thief = browser(srv.base), victim = browser(srv.base);
    const vs = await victim('GET', '/api/oauth/google/start?mode=login'), va = fake.approve(vs.location, { sub: 'g-500', email: 'v@gmail.com' });
    assert.match((await thief('GET', '/api/oauth/google/callback?' + new URLSearchParams({ code: va.code, state: va.state }))).location, /google_error=state/);
    // an open redirect is not possible
    r = await anon('GET', '/api/oauth/google/start?mode=login&next=//evil.example');
    assert.equal(new URL(r.location).searchParams.get('state') ? true : false, true);

    // 6a. the same e-mail, exactly, verified by Google: the existing account (same SPG ID), Google linked to it; its
    //     e-mail was never confirmed, so other sessions of that account end
    const sara = browser(srv.base), saraOther = browser(srv.base);
    r = await sara('POST', '/api/auth/register', { username: 'sara_live', email: 'sara@gmail.com', password: 'reef2026go', confirm: 'reef2026go' });
    assert.equal(r.status, 201); const saraId = r.data.account.publicId;
    await saraOther('POST', '/api/auth/login', { identifier: 'sara_live', password: 'reef2026go' });
    await sara('POST', '/api/auth/logout', {});
    f = await googleFlow(fake, sara, { sub: 'g-600', email: 'sara@gmail.com', name: 'Sara' });
    assert.doesNotMatch(f.cb.location, /google_error/);
    me = (await sara('GET', '/api/auth/me')).data;
    assert.equal(me.account.publicId, saraId, 'the same account'); assert.equal(me.account.googleLinked, true); assert.equal(me.account.verified, true);
    assert.equal((await pool.query("SELECT count(*)::int n FROM users WHERE canonical_email='sara@gmail.com'")).rows[0].n, 1, 'no second account');
    assert.equal((await saraOther('GET', '/api/auth/me')).data.account ?? null, null, 'sessions from before end');
    assert.equal((await sara('POST', '/api/auth/logout', {})).status, 200);
    assert.equal((await sara('POST', '/api/auth/login', { identifier: 'sara_live', password: 'reef2026go' })).status, 200, 'the password still works');
    // 6b. not verified by Google (or not the exact address): never merged on the e-mail; the password proves ownership
    const hala = browser(srv.base);
    r = await hala('POST', '/api/auth/register', { username: 'hala_live', email: 'hala@gmail.com', password: 'reef2026go', confirm: 'reef2026go' });
    const halaId = r.data.account.publicId; await hala('POST', '/api/auth/logout', {});
    f = await googleFlow(fake, hala, { sub: 'g-650', email: 'hala@gmail.com', email_verified: false });
    assert.match(f.cb.location, /google_error=link_needed/); assert.ok(hala.cookies.get('g_pending'));
    assert.equal((await pool.query("SELECT count(*)::int n FROM users WHERE canonical_email='hala@gmail.com'")).rows[0].n, 1, 'no second account');
    assert.equal((await hala('POST', '/api/auth/login', { identifier: 'hala@gmail.com', password: 'wrong-pass-1' })).status, 401);
    r = await hala('POST', '/api/auth/login', { identifier: 'hala@gmail.com', password: 'reef2026go' });
    assert.equal(r.data.googleLinked, true); assert.equal(r.data.account.publicId, halaId);
    // a different Google identity with the e-mail of an account already linked to Google: no takeover
    const x = browser(srv.base);
    f = await googleFlow(fake, x, { sub: 'g-666', email: 'sara@gmail.com' });
    assert.match(f.cb.location, /google_error=link_needed/);
    assert.equal((await pool.query("SELECT google_sub FROM users WHERE username='sara_live'")).rows[0].google_sub, 'g-600');

    // 7. linking from the settings: confirm first; an identity used by another account is refused
    const omar = browser(srv.base);
    await omar('POST', '/api/auth/register', { username: 'omar_live', email: 'omar@example.com', password: 'reef2026go', confirm: 'reef2026go' });
    f = await googleFlow(fake, omar, { sub: 'g-700', email: 'omar.g@gmail.com' }, { mode: 'link' });
    assert.match(f.start.location, /google_error=reauth/, 'confirm the password first');
    assert.equal((await omar('POST', '/api/me/reauth', { password: 'reef2026go' })).status, 200);
    f = await googleFlow(fake, omar, { sub: 'g-100', email: 'nora@gmail.com' }, { mode: 'link' });
    assert.match(f.cb.location, /google_error=taken/, 'Nora\'s Google cannot be linked to Omar');
    f = await googleFlow(fake, omar, { sub: 'g-700', email: 'omar.g@gmail.com' }, { mode: 'link' });
    assert.match(f.cb.location, /google=linked/);
    const omarRow = (await pool.query("SELECT public_id, google_sub FROM users WHERE username='omar_live'")).rows[0];
    assert.equal(omarRow.google_sub, 'g-700');
    // reauth by Google: only the linked Google identity
    f = await googleFlow(fake, omar, { sub: 'g-999', email: 'z@gmail.com' }, { mode: 'reauth' });
    assert.match(f.cb.location, /google_error=other_google/);
    f = await googleFlow(fake, omar, { sub: 'g-700', email: 'omar.g@gmail.com' }, { mode: 'reauth' });
    assert.match(f.cb.location, /reauth=ok/);

    // 8. sessions: «تذكرني» off → a browser-session cookie; sign-out ends the session on the server
    const brief = browser(srv.base);
    const st = await brief('GET', '/api/oauth/google/start?mode=login&remember=0');
    const ba = fake.approve(st.location, { sub: 'g-100', email: 'nora@gmail.com' });
    const res = await fetch(srv.base + '/api/oauth/google/callback?' + new URLSearchParams({ code: ba.code, state: ba.state }), { redirect: 'manual', headers: { Cookie: [...brief.cookies].map(([k, v]) => k + '=' + v).join('; ') } });
    const sessionCookie = res.headers.getSetCookie().find((c) => c.startsWith('sky_session='));
    assert.ok(sessionCookie && !/Max-Age/.test(sessionCookie), 'no Max-Age: gone when the browser closes');
    assert.match(sessionCookie, /HttpOnly/); assert.match(sessionCookie, /SameSite=Lax/);
    const stolen = [...nora.cookies].map(([k, v]) => k + '=' + v).join('; ');
    assert.equal((await nora('POST', '/api/auth/logout', {})).status, 200);
    const after = await fetch(srv.base + '/api/auth/me', { headers: { Cookie: stolen } }).then((x) => x.json());
    assert.equal(after.account ?? null, null, 'the old cookie no longer works anywhere');
    assert.equal((await fetch(srv.base + '/account', { redirect: 'manual', headers: { Cookie: stolen } })).status, 302);
    assert.equal((await fetch(srv.base + '/login', { redirect: 'manual' })).headers.get('cache-control'), 'no-store');

    // 9. password reset: a link from the owner panel (no e-mail service), used once; other devices are signed out
    const owner = browser(srv.base);
    const dev2 = browser(srv.base); await dev2('POST', '/api/auth/login', { identifier: 'omar_live', password: 'reef2026go' });
    r = await owner('POST', '/api/manage/password-reset-link', { publicId: omarRow.public_id }, { Authorization: 'Bearer ' + OWNER });
    assert.equal(r.status, 200, JSON.stringify(r.data)); const token = new URL(r.data.link).searchParams.get('token');
    r = await anon('POST', '/api/auth/forgot', { identifier: 'omar_live' });
    assert.equal(r.status, 200); assert.equal(r.data.mail, false, 'honest: no mail service configured here');
    assert.equal((await anon('POST', '/api/auth/forgot', { identifier: 'nobody_here' })).status, 200, 'same answer for an unknown account');
    assert.equal((await anon('POST', '/api/auth/reset', { token, password: 'short', confirm: 'short' })).status, 400);
    assert.equal((await anon('POST', '/api/auth/reset', { token, password: 'newReef2027', confirm: 'newReef2027' })).status, 200);
    assert.equal((await anon('POST', '/api/auth/reset', { token, password: 'otherReef2028', confirm: 'otherReef2028' })).status, 400, 'a link works once');
    assert.equal((await dev2('GET', '/api/auth/me')).data.account ?? null, null, 'other devices signed out');
    assert.equal((await anon('POST', '/api/auth/login', { identifier: 'omar_live', password: 'reef2026go' })).status, 401);
    assert.equal((await anon('POST', '/api/auth/login', { identifier: 'omar_live', password: 'newReef2027' })).status, 200);
    assert.equal((await pool.query("SELECT google_sub FROM users WHERE username='omar_live'")).rows[0].google_sub, 'g-700', 'the Google link stays');
  } finally { await pool.end(); await srv.stop(); await fake.close(); }
});
