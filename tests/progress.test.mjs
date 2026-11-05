// «ملفي»: XP, levels and statistics are derived only from what the server counted.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPool, migrate } from '../src/db.mjs';
import { Platform, levelFor, XP_RULES } from '../src/platform.mjs';

const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_xp_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let available = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); available = true; } catch {}
const skip = available ? false : 'no PostgreSQL at TEST_DATABASE_URL';
test.after(async () => { if (!available) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

test('levels: 500 XP for level 2, then 250 more for each next level', () => {
  assert.deepEqual(levelFor(0), { level: 1, levelXp: 0, nextXp: 500, pct: 0 });
  assert.equal(levelFor(499).pct, 99);
  assert.equal(levelFor(500).level, 2);
  assert.equal(levelFor(1250).level, 3);
});

test('XP comes from counted play and streaming only; a fresh account starts at level 1', { skip }, async () => {
  const pool = createPool(dbUrl); await migrate(pool, { log: null });
  let now = Date.parse('2026-11-04T12:00:00Z');
  const p = new Platform({ pool, hashCode: (c) => c, mail: { send: async () => {} }, gateway: { configured: false }, now: () => now });
  const u = await p.register({ username: 'xpuser', email: 'xp@example.com', password: 'reef2026go', confirm: 'reef2026go' });
  try {
    let g = await p.progress(u.id);
    assert.deepEqual([g.xp, g.level, g.player.entries, g.streamer.sessions], [0, 1, 0, 0]);
    // as a streamer
    await p.recordStreamSession(u.id, 'quiz'); await p.addWeeklyStreamer(u.id, { sessions: 1, minutes: 30 });
    await p.noteSessionLength(u.id, 30);
    await p.recordGameResult({ platform: 'kick', winnerId: 'kick:1', participants: [{ id: 'kick:1', name: 'Viewer', handle: 'viewer1' }], startedAt: now - 120_000, endedAt: now, streamerId: u.id });
    // as a player: their Kick account (linked officially) played and won in someone's stream
    await pool.query(`INSERT INTO linked_accounts (user_id, platform, handle, verified, verify_method, platform_user_id) VALUES ($1, 'kick', 'viewer1', true, 'oauth', '1')`, [u.id]);
    g = await p.progress(u.id);
    assert.deepEqual(g.player, { entries: 1, wins: 1, hours: 0, weeks: 1 });
    assert.deepEqual([g.streamer.sessions, g.streamer.hours, g.streamer.longestHours, g.streamer.players, g.streamer.games, g.streamer.rounds], [1, 0.5, 0.5, 1, 1, 1]);
    const R = XP_RULES;
    assert.equal(g.xp, R.entry + R.win + 2 * R.playMinute + R.session + 30 * R.streamMinute + R.streamRound);
    // asking again changes nothing
    assert.equal((await p.progress(u.id)).xp, g.xp);
    assert.equal((await p.profile(u.id)).progress.level, g.level);
  } finally { await pool.end(); }
});
