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
  // one round of `min` minutes ending now; time moves on afterwards
  const round = async (args, min = 2) => { const r = await p.recordGameResult({ startedAt: now - min * 60_000, endedAt: now, streamerId: a.id, ...args }); now += min * 60_000 + 1000; return r; };
  try {
    const crowd = [{ id: 'v1', name: 'ليلى', avatar: 'https://p16-sign.tiktokcdn.com/a.jpeg', handle: 'layla' }, { id: 'v2', name: 'عمر' }, { id: 'v3', name: 'سارة', avatar: 'javascript:alert(1)' }];
    await round({ platform: 'tiktok', winnerId: 'v1', participants: crowd });
    await round({ platform: 'tiktok', winnerId: 'v1', participants: crowd });
    await round({ platform: 'tiktok', winnerId: 'v2', participants: crowd.slice(0, 2) });
    await round({ platform: 'tiktok', winnerId: null, participants: crowd.slice(2) });   // no winner: entries only
    await round({ platform: 'evil', winnerId: 'v1', participants: crowd });             // unknown platform: ignored
    assert.equal((await p.recordGameResult({ platform: 'tiktok', winnerId: 'v3', participants: crowd, startedAt: now - 5000, endedAt: now })).reason, 'short', 'a round under 15 s counts for nobody');

    const wins = await p.leaderboard('players', 'wins');
    assert.deepEqual(wins.rows.map((r) => [r.name, r.wins, r.entries]), [['ليلى', 2, 3], ['عمر', 1, 3]]);
    assert.equal(wins.weekStart, '2026-11-01');
    assert.equal(wins.rows[0].avatar, 'https://p16-sign.tiktokcdn.com/a.jpeg');
    assert.deepEqual(wins.prizes, [], 'no prizes unless the owner announces them');
    const entries = await p.leaderboard('players', 'entries');
    assert.deepEqual(entries.rows.map((r) => r.name), ['ليلى', 'عمر', 'سارة']);
    assert.equal(entries.rows[2].avatar, null, 'only https avatars are stored');
    const hours = await p.leaderboard('players', 'hours');
    assert.equal(hours.rows[0].hours, 0.1, '3 rounds × 2 min = 6 min = 0.1 h');

    // the same viewer in two simultaneous streams: the overlapping time is counted once (no extra entry or win)
    const t0 = now;
    await p.recordGameResult({ platform: 'tiktok', winnerId: 'v1', participants: crowd.slice(0, 1), startedAt: t0, endedAt: t0 + 600_000 });
    await p.recordGameResult({ platform: 'tiktok', winnerId: 'v1', participants: crowd.slice(0, 1), startedAt: t0 + 60_000, endedAt: t0 + 600_000 });
    const layla = (await p.leaderboard('players', 'wins')).rows[0];
    assert.deepEqual([layla.wins, layla.entries], [3, 4]);
    assert.equal((await p.leaderboard('players', 'hours')).rows[0].hours, 0.3, '6 + 10 minutes, not 6 + 10 + 9');
    now = t0 + 601_000;

    // a SPONGE LIVE account that linked the same TikTok account sees itself on the board and in the search
    await pool.query(`INSERT INTO linked_accounts (user_id, platform, handle, verified, verify_method, platform_user_id) VALUES ($1, 'tiktok', 'Layla', true, 'oauth', 'open-layla')`, [b.id]);
    assert.equal((await p.leaderboard('players', 'wins')).rows[0].publicId, b.public_id);
    const meAsPlayer = await p.leaderboardFind(b.public_id, 'wins', 'players');
    assert.deepEqual([meAsPlayer.kind, meAsPlayer.rank, meAsPlayer.wins], ['player', 1, 3]);

    await p.addWeeklyStreamer(a.id, { sessions: 1 }); await p.addWeeklyStreamer(a.id, { minutes: 90, players: 12 });
    await p.addWeeklyStreamer(b.id, { sessions: 2 }); await p.addWeeklyStreamer(b.id, { minutes: 30, players: 40 });
    const sh = await p.leaderboard('streamers', 'hours');
    assert.deepEqual(sh.rows.map((r) => [r.publicId, r.hours]), [[a.public_id, 1.5], [b.public_id, 0.5]]);
    const uniq = (await p.leaderboard('streamers', 'players')).rows[0];
    assert.deepEqual([uniq.publicId, uniq.players, uniq.rounds], [a.public_id, 3, 4], 'unique players and completed rounds');
    assert.deepEqual((await p.leaderboard('streamers', 'sessions')).rows.map((r) => r.publicId), [b.public_id, a.public_id]);
    assert.equal((await p.leaderboardFind(b.public_id.toLowerCase(), 'hours')).rank, 2);

    // a streamer who hides their statistics leaves the board and the search
    await pool.query(`UPDATE users SET privacy = '{"streamerStats":false}' WHERE id=$1`, [a.id]);
    assert.deepEqual((await p.leaderboard('streamers', 'hours')).rows.map((r) => r.publicId), [b.public_id]);
    assert.equal(await p.leaderboardFind(a.public_id, 'hours'), null);
    assert.equal((await p.leaderboardFind(b.public_id, 'hours')).rank, 1);

    // prizes: announced by the owner → shown; the closed week is frozen with its winners
    await p.savePrize({ board: 'players', metric: 'wins', rankFrom: 1, rankTo: 1, title: 'بطاقة هدايا 50 ريال', startsOn: '2026-11-01' });
    assert.equal((await p.leaderboard('players', 'wins')).prizes[0].title, 'بطاقة هدايا 50 ريال');
    now = Date.parse('2026-11-08T09:00:00Z');
    assert.equal((await p.leaderboard('players', 'wins')).rows.length, 0, 'next week starts empty');
    assert.equal((await p.leaderboardFind(b.public_id, 'hours')).rank, null);
    assert.equal(await p.closeWeeks(), 1); assert.equal(await p.closeWeeks(), 0, 'idempotent');
    const prev = await p.archivedBoard('2026-11-01', 'players', 'wins');
    assert.equal(prev.archived, true); assert.equal(prev.rows[0].name, 'ليلى');
    const { awards } = await p.listPrizes();
    assert.deepEqual([awards.length, awards[0].winner.name, awards[0].status], [1, 'ليلى', 'pending']);
    await p.setAwardStatus(awards[0].id, 'delivered');
    assert.equal((await p.listPrizes()).awards[0].status, 'delivered');

    // partners: none until added; the badge needs an officially linked account; photos are checked by their bytes
    assert.deepEqual(await p.partners(), []);
    await assert.rejects(p.savePartner({ name: 'براق', handle: 'nobody', platform: 'tiktok', official: true }), /شريك رسمي/);
    const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');
    await p.savePartner({ name: 'ليلى', handle: 'layla', platform: 'tiktok', official: true, description: 'صانعة محتوى على TikTok', photo: png, sort: 1 });
    await assert.rejects(p.savePartner({ name: 'x', handle: 'x', photo: 'data:image/png;base64,' + Buffer.from('<svg/>').toString('base64') }), /غير صالح/);
    const [partner] = await p.partners();
    assert.deepEqual([partner.official, partner.url, !!partner.photo], [true, 'https://www.tiktok.com/@layla', true]);
    assert.equal((await p.partnerPhoto(partner.id)).type, 'image/png');
    await p.savePartner({ ...partner, id: partner.id, active: false, photo: undefined });
    assert.deepEqual(await p.partners(), [], 'hidden partners are not shown');
  } finally { await pool.end(); }
});
