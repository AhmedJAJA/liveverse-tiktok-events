import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PromoStore, normalizeCode, generateCode } from '../src/promo.mjs';

test('promo store: hashed codes, limits, expiry, disable and persistence', () => {
  let t = 1_000_000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-'));
  const file = path.join(dir, 'codes.json');
  const store = new PromoStore({ file, now: () => t });
  const a = store.create({ label: 'ستريمر', maxUses: 2 });
  assert.match(a.code, /^[A-HJ-NP-Z2-9]{10}$/);
  assert.equal(a.hash, undefined, 'hash never leaves the store');
  assert.equal(normalizeCode(' ab-cd ef '), 'ABCDEF');
  assert.ok(store.redeem(a.code.toLowerCase()), 'case-insensitive');
  assert.ok(store.redeem(a.code));
  assert.equal(store.redeem(a.code), null, 'use limit reached');
  const b = store.create({ code: 'SPONGE2026', maxUses: 0, expiresAt: new Date(t + 60_000).toISOString(), level: 'demo' });
  assert.equal(store.redeem('sponge2026').level, 'demo');
  t += 61_000;
  assert.equal(store.redeem('SPONGE2026'), null, 'expired');
  assert.throws(() => store.create({ code: 'SPONGE2026' }), /موجود/);
  assert.throws(() => store.create({ code: 'abc' }), /6 إلى 32/);
  const c = store.create({ maxUses: 0 });
  store.update(c.id, { active: false });
  assert.equal(store.redeem(c.code), null, 'disabled');
  assert.equal(store.stillValid(c.id), false);
  store.flush();
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes(a.code) && !raw.includes('SPONGE2026'), 'plain codes are not written to disk');
  const reloaded = new PromoStore({ file, now: () => t });
  assert.equal(reloaded.list().length, 3);
  reloaded.update(c.id, { active: true });
  assert.ok(reloaded.redeem(c.code), 'same pepper after reload, so codes still match');
  assert.equal(generateCode().length, 10);
});

async function boot(dataDir, extraEnv = {}) {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise((r) => reservation.close(r));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), ADMIN_TOKEN: 'owner-token-for-tests-1234567', NODE_ENV: 'test', SKY_DATA_DIR: dataDir, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  await Promise.race([once(child.stdout, 'data'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000).unref())]);
  return { base: 'http://127.0.0.1:' + port, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
const jar = (base) => {
  let cookie = '';
  const call = async (method, route, body, headers = {}) => {
    const res = await fetch(base + route, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, location: res.headers.get('location'), cookie: set };
  };
  call.cookie = () => cookie;
  return call;
};

test('promo access over HTTP: studio gated, codes checked on the server, sessions survive a restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-access-'));
  let srv = await boot(dir, { SPONGE_PROMO_CODES: 'BIKINI2026' });
  try {
    const visitor = jar(srv.base);
    // home is public and contains no codes
    const home = await (await fetch(srv.base + '/')).text();
    assert.match(home, /الدخول باستخدام الرمز الترويجي/);
    assert.ok(!home.includes('BIKINI2026'));
    const homeJs = await (await fetch(srv.base + '/home.js')).text();
    assert.ok(!homeJs.includes('BIKINI2026'));
    // no session: every studio page redirects home
    for (const p of ['/studio', '/dashboard', '/event?mode=quiz', '/bomb', '/play?mode=quiz']) {
      const r = await visitor('GET', p);
      assert.equal(r.status, 302, p); assert.match(r.location, /^\/\?next=/);
    }
    assert.equal((await visitor('GET', '/play?mode=quiz&room=main')).status, 200, 'viewers can still watch a room');
    assert.equal((await visitor('GET', '/overlay')).status, 200);
    assert.equal((await visitor('POST', '/api/admin/prepare', { mode: 'quiz' })).status, 401);
    // wrong, empty, then the right code
    assert.equal((await visitor('POST', '/api/access/redeem', { code: '' })).status, 400);
    const wrong = await visitor('POST', '/api/access/redeem', { code: 'NOPE1234' });
    assert.equal(wrong.status, 401); assert.match(wrong.data.error, /غير صحيح/);
    assert.equal((await visitor('POST', '/api/access/redeem', { code: 'BIKINI2026' }, { Origin: 'https://evil.example' })).status, 403);
    const ok = await visitor('POST', '/api/access/redeem', { code: 'bikini2026' });
    assert.equal(ok.status, 200); assert.equal(ok.data.next, '/studio');
    assert.match(ok.cookie, /HttpOnly/); assert.match(ok.cookie, /SameSite=Lax/);
    assert.equal((await visitor('GET', '/studio')).status, 200);
    const me = (await visitor('GET', '/api/access/me')).data;
    assert.equal(me.signedIn, true); assert.equal(me.access, 'promo'); assert.match(me.room, /^p[a-z0-9]{9}$/);
    assert.equal((await visitor('POST', '/api/admin/prepare', { mode: 'flag' })).status, 200);
    assert.equal((await visitor('POST', '/api/admin/promo-list', {})).status, 403, 'only the owner manages codes');
    // owner signs in with the admin token through the same field and manages codes
    const owner = jar(srv.base);
    assert.equal((await owner('POST', '/api/access/redeem', { code: 'owner-token-for-tests-1234567' })).data.access, 'owner');
    const made = await owner('POST', '/api/admin/promo-create', { label: 'تجربة', maxUses: 1, level: 'demo' });
    assert.equal(made.status, 200);
    const demoCode = made.data.code.code;
    const list = (await owner('POST', '/api/admin/promo-list', {})).data.codes;
    assert.ok(list.every((c) => !('hash' in c) && !('code' in c)), 'listing never shows codes');
    const demo = jar(srv.base);
    assert.equal((await demo('POST', '/api/access/redeem', { code: demoCode })).status, 200);
    assert.equal((await jar(srv.base)('POST', '/api/access/redeem', { code: demoCode })).status, 401, 'single-use code');
    const conn = await demo('POST', '/api/admin/connect', { username: 'someone' });
    assert.equal(conn.status, 403, 'demo level cannot connect a real stream');
    // disabling a code closes its sessions
    await owner('POST', '/api/admin/promo-update', { id: made.data.code.id, active: false });
    assert.equal((await demo('GET', '/studio')).status, 302);
    // the promo session survives a server restart
    const kept = visitor.cookie();
    await srv.stop();
    srv = await boot(dir, { SPONGE_PROMO_CODES: 'BIKINI2026' });
    const again = await fetch(srv.base + '/studio', { redirect: 'manual', headers: { Cookie: kept } });
    assert.equal(again.status, 200, 'no need to type the code again after a restart');
    // repeated guessing is throttled
    const guesser = jar(srv.base); let limited = false;
    for (let i = 0; i < 12; i++) { const r = await guesser('POST', '/api/access/redeem', { code: 'WRONG' + i + 'XX' }); if (r.status === 429) { limited = true; break; } }
    assert.ok(limited, 'brute force is rate limited');
    // logout ends the session
    const out = jar(srv.base); await out('POST', '/api/access/redeem', { code: 'BIKINI2026' });
    await out('POST', '/api/access/logout', {});
    assert.equal((await out('GET', '/studio')).status, 302);
  } finally { await srv.stop(); }
});

test('static files: gzip, ETag revalidation and content-hashed links in HTML', async () => {
  const srv = await boot(fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-static-')));
  try {
    const html = await (await fetch(srv.base + '/')).text();
    const link = html.match(/href="\/home\.css\?v=([\w-]{8})"/);
    assert.ok(link, 'stylesheet link carries a content hash');
    const css = await fetch(srv.base + '/home.css?v=' + link[1], { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(css.headers.get('content-encoding'), 'gzip');
    assert.match(css.headers.get('cache-control'), /immutable/);
    const etag = css.headers.get('etag');
    assert.equal((await fetch(srv.base + '/home.css', { headers: { 'If-None-Match': etag } })).status, 304);
    assert.equal((await fetch(srv.base + '/')).headers.get('cache-control'), 'no-cache', 'pages always revalidate so a deploy shows at once');
    for (const f of ['/games/01-knowledge-challenge-120.webp', '/games/12-guess-flag-200.webp', '/brand/sponge-256.webp']) {
      const r = await fetch(srv.base + f); assert.equal(r.status, 200, f); assert.ok((await r.arrayBuffer()).byteLength < 30000, f + ' is small');
    }
  } finally { await srv.stop(); }
});
