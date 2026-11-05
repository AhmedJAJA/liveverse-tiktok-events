// «المجتمع»: friend requests by SPG ID only, accept / decline / cancel / remove, blocking, reports, privacy switches.
// Real PostgreSQL; skipped when none is reachable.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPool, migrate } from '../src/db.mjs';
import { Platform } from '../src/platform.mjs';

const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_cm_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let available = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); available = true; } catch {}
const skip = available ? false : 'no PostgreSQL at TEST_DATABASE_URL';
test.after(async () => { if (!available) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

test('friends, blocks and reports', { skip }, async () => {
  const pool = createPool(dbUrl); await migrate(pool, { log: null });
  const p = new Platform({ pool, hashCode: (c) => c, mail: { send: async () => {} }, gateway: { configured: false } });
  const mk = (n) => p.register({ username: 'cm' + n, email: n + '@example.com', password: 'reef2026go', confirm: 'reef2026go' });
  const [a, b, c] = [await mk('a'), await mk('b'), await mk('c')];
  try {
    // only an exact SPG ID finds someone
    await assert.rejects(p.findMember(a.id, 'cmb'), /SPG-XXXXXX/);
    assert.equal(await p.findMember(a.id, 'SPG-ZZZZZZ'), null);
    assert.equal((await p.findMember(a.id, b.public_id.toLowerCase())).relation, 'none');
    assert.equal((await p.findMember(a.id, a.public_id)).relation, 'self');
    await assert.rejects(p.friendRequest(a.id, a.public_id), /حسابك/);

    // request → the other side sees it incoming → accept
    assert.equal((await p.friendRequest(a.id, b.public_id)).relation, 'outgoing');
    await assert.rejects(p.friendRequest(a.id, b.public_id), /ينتظر الرد/);
    await assert.rejects(p.friendRespond(a.id, b.public_id, true), /لا يوجد طلب/, 'the sender cannot accept their own request');
    assert.equal((await p.community(b.id)).incoming[0].publicId, a.public_id);
    assert.equal((await p.friendRespond(b.id, a.public_id, true)).relation, 'friends');
    assert.deepEqual([(await p.community(a.id)).friends.length, (await p.community(b.id)).friends.length], [1, 1]);
    assert.equal((await p.publicProfile(a.public_id)).friendsCount, 1);
    assert.equal((await p.publicProfile(a.public_id, b.id)).relation, 'friends');
    assert.equal((await p.publicProfile(a.public_id)).relation, undefined, 'a guest gets no relation');

    // asking someone who already asked you means yes
    await p.friendRequest(c.id, a.public_id);
    assert.equal((await p.friendRequest(a.id, c.public_id)).relation, 'friends');
    await p.friendRemove(a.id, c.public_id);
    assert.equal((await p.community(c.id)).friends.length, 0);

    // decline and cancel
    await p.friendRequest(c.id, b.public_id);
    assert.equal((await p.friendRespond(b.id, c.public_id, false)).relation, 'none');
    await p.friendRequest(c.id, b.public_id); await p.friendRemove(c.id, b.public_id);
    assert.equal((await p.community(b.id)).incoming.length, 0);

    // privacy: no new requests, count hidden
    await p.setPrivacy(b.id, 'friendRequests', false); await p.setPrivacy(b.id, 'friendCount', false);
    await assert.rejects(p.friendRequest(c.id, b.public_id), /لا يستقبل/);
    assert.equal((await p.findMember(c.id, b.public_id)).relation, 'unavailable');
    assert.equal((await p.publicProfile(b.public_id)).friendsCount, null);
    assert.equal((await p.community(b.id)).friends.length, 1, 'existing friendships stay');

    // block: ends the friendship, the blocked side cannot find or ask the blocker
    await p.friendRequest(c.id, a.public_id);
    assert.equal((await p.block(a.id, c.public_id)).relation, 'blocked');
    assert.equal((await p.community(a.id)).incoming.length, 0, 'the pending request is gone');
    assert.equal(await p.findMember(c.id, a.public_id), null);
    assert.equal(await p.publicProfile(a.public_id, c.id), null);
    await assert.rejects(p.friendRequest(c.id, a.public_id), /لا يوجد حساب/);
    await assert.rejects(p.friendRequest(a.id, c.public_id), /ألغِ حظر/);
    assert.equal((await p.community(a.id)).blocked[0].publicId, c.public_id);
    assert.equal((await p.unblock(a.id, c.public_id)).relation, 'none');

    // reports: a reason is required, once a day per account, visible to the owner
    await assert.rejects(p.report(c.id, a.public_id, 'nope', ''), /سبب/);
    await p.report(c.id, a.public_id, 'spam', 'رسائل <b>كثيرة</b>');
    await assert.rejects(p.report(c.id, a.public_id, 'abuse', ''), /24 ساعة/);
    const [rep] = await p.listReports();
    assert.deepEqual([rep.target, rep.reporter, rep.reason, rep.note], [a.public_id, c.public_id, 'spam', 'رسائل <b>كثيرة</b>']);
    await p.setReportStatus(rep.id, 'reviewed');
    assert.equal((await p.listReports()).length, 0);

    // a disabled account disappears
    await pool.query('UPDATE users SET disabled_at=now() WHERE id=$1', [b.id]);
    assert.equal((await p.community(a.id)).friends.length, 0);
    assert.equal(await p.findMember(a.id, b.public_id), null);
  } finally { await pool.end(); }
});
