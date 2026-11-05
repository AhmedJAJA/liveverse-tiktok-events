// Weekly leaderboard: players (wins / entries) and streamers (hours / players / sessions), counted by the server,
// week boundaries in Riyadh time, privacy respected, SPG ID search. Real PostgreSQL; skipped when none is reachable.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPool, migrate } from '../src/db.mjs';
import { Platform, weekOf } from '../src/platform.mjs';

const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_lb_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let available = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); available = true; } catch {}
const skip = available ? false : 'no PostgreSQL at TEST_DATABASE_URL';
test.after(async () => { if (!available) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

test('the week runs Sunday 00:00 to Sunday 00:00 in Riyadh time', () => {
  // Saturday 2026-11-07 20:59 UTC = 23:59 Riyadh (still the week of Sunday 2026-11-01)
  assert.equal(weekOf(Date.parse('2026-11-07T20:59:00Z')).start, '2026-11-01');
  // Saturday 21:00 UTC = Sunday 00:00 Riyadh: a new week
  const w = weekOf(Date.parse('2026-11-07T21:00:00Z'));
  assert.equal(w.start, '2026-11-08');
  assert.equal(w.endsAt, '2026-11-14T21:00:00.000Z');
});

test('players and streamers boards, privacy and SPG search', { skip }, async () => {
  const pool = createPool(dbUrl); await migrate(pool, { log: null });
  let now = Date.parse('2026-11-04T12:00:00Z');
  const p = new Platform({ pool, hashCode: (c) => c, mail: { send: async () => {} }, gateway: { configured: false }, now: () => now });
  const a = await p.register({ username: 'reefa', email: 'a@example.com', password: 'reef2026go', confirm: 'reef2026go' });
  const b = await p.register({ username: 'reefb', email: 'b@example.com', password: 'reef2026go', confirm: 'reef2026go' });
  try {
    const crowd = [{ id: 'v1', name: 'ليلى', avatar: 'https://p16-sign.tiktokcdn.com/a.jpeg' }, { id: 'v2', name: 'عمر' }, { id: 'v3', name: 'سارة', avatar: 'javascript:alert(1)' }];
    await p.recordGameResult({ platform: 'tiktok', winnerId: 'v1', participants: crowd });
    await p.recordGameResult({ platform: 'tiktok', winnerId: 'v1', participants: crowd });
    await p.recordGameResult({ platform: 'tiktok', winnerId: 'v2', participants: crowd.slice(0, 2) });
    await p.recordGameResult({ platform: 'tiktok', winnerId: null, participants: crowd.slice(2) });   // no winner: entries only
    await p.recordGameResult({ platform: 'evil', winnerId: 'v1', participants: crowd });             // unknown platform: ignored

    const wins = await p.leaderboard('players', 'wins');
    assert.deepEqual(wins.rows.map((r) => [r.name, r.wins, r.entries]), [['ليلى', 2, 3], ['عمر', 1, 3]]);
    assert.equal(wins.weekStart, '2026-11-01');
    assert.equal(wins.rows[0].avatar, 'https://p16-sign.tiktokcdn.com/a.jpeg');
    const entries = await p.leaderboard('players', 'entries');
    assert.deepEqual(entries.rows.map((r) => r.name), ['ليلى', 'عمر', 'سارة']);
    assert.equal(entries.rows[2].avatar, null, 'only https avatars are stored');

    await p.addWeeklyStreamer(a.id, { sessions: 1 }); await p.addWeeklyStreamer(a.id, { minutes: 90, players: 12 });
    await p.addWeeklyStreamer(b.id, { sessions: 2 }); await p.addWeeklyStreamer(b.id, { minutes: 30, players: 40 });
    const hours = await p.leaderboard('streamers', 'hours');
    assert.deepEqual(hours.rows.map((r) => [r.publicId, r.hours]), [[a.public_id, 1.5], [b.public_id, 0.5]]);
    assert.deepEqual((await p.leaderboard('streamers', 'players')).rows.map((r) => r.publicId), [b.public_id, a.public_id]);
    const found = await p.leaderboardFind(b.public_id.toLowerCase(), 'hours');
    assert.equal(found.rank, 2);

    // a streamer who hides their statistics leaves the board and the search
    await pool.query(`UPDATE users SET privacy = '{"streamerStats":false}' WHERE id=$1`, [a.id]);
    assert.deepEqual((await p.leaderboard('streamers', 'hours')).rows.map((r) => r.publicId), [b.public_id]);
    assert.equal(await p.leaderboardFind(a.public_id, 'hours'), null);
    assert.equal((await p.leaderboardFind(b.public_id, 'hours')).rank, 1);

    // next week starts empty
    now = Date.parse('2026-11-08T09:00:00Z');
    assert.equal((await p.leaderboard('players', 'wins')).rows.length, 0);
    assert.equal((await p.leaderboardFind(b.public_id, 'hours')).rank, null);
  } finally { await pool.end(); }
});
