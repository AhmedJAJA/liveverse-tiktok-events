// «SpongePass»: a 50-tier season pass. XP from the server's weekly statistics inside the season only; each reward taken
// once (double clicks, parallel requests); the premium track bought once with coins (purchased first) or granted;
// frames won here are equipped like any frame and show in the lobby list; free wheel spins cost no coins; the season
// badge. Real PostgreSQL; skipped when none is reachable.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPool, migrate } from '../src/db.mjs';
import { Platform } from '../src/platform.mjs';
import { Economy } from '../src/economy.mjs';
import { FrameStore } from '../src/frames.mjs';
import { SpongePass, rewardsFor, PASS_FRAMES } from '../src/spongepass.mjs';

const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_pass_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let available = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); available = true; } catch {}
const skip = available ? false : 'no PostgreSQL at TEST_DATABASE_URL';
test.after(async () => { if (!available) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

let n = 0;
async function setup() {
  const pool = createPool(dbUrl); await migrate(pool, { log: null });
  const p = new Platform({ pool, hashCode: (c) => c, mail: { send: async () => ({ sent: false }) }, gateway: { configured: false } });
  const eco = new Economy({ pool, platform: p });
  const frames = new FrameStore({ pool });
  const pass = new SpongePass({ pool, economy: eco, frames });
  const season = (await pool.query(`SELECT *, (starts_at AT TIME ZONE 'Asia/Riyadh')::date wf FROM pass_seasons WHERE id='s1'`)).rows[0];
  const day = (d, k) => new Date(Date.parse(d) + k * 86400e3).toISOString().slice(0, 10);
  const weekIn = day(season.wf.toISOString(), 0), weekBefore = day(season.wf.toISOString(), -7), weekAfter = day(season.wf.toISOString(), 63);
  /** A verified account with a verified TikTok link (its games count). */
  const mk = async () => {
    const k = ++n, u = await p.register({ username: 'pass' + k, email: 'pass' + k + '@example.com', password: 'reef2026go', confirm: 'reef2026go' });
    await pool.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [u.id]);
    await pool.query(`INSERT INTO linked_accounts (user_id, platform, handle, verified) VALUES ($1,'tiktok',$2,true)`, [u.id, 'viewer' + k]);
    return { ...u, handle: 'viewer' + k };
  };
  /** Weekly statistics as the server counts them (entries × 10 XP, wins × 40, minutes played × 1). */
  const play = (u, week, { entries = 0, wins = 0, seconds = 0 }) => pool.query(`INSERT INTO weekly_player_stats (week_start, platform, player_id, name, handle, entries, wins, seconds)
    VALUES ($1,'tiktok',$2,$2,$2,$3,$4,$5) ON CONFLICT (week_start, platform, player_id) DO UPDATE SET entries=EXCLUDED.entries, wins=EXCLUDED.wins, seconds=EXCLUDED.seconds`,
    [week, u.handle, entries, wins, seconds]);
  return { pool, p, eco, frames, pass, mk, play, weekIn, weekBefore, weekAfter };
}

test('the reward table: 50 tiers, a premium reward on every tier, frames on key tiers, the badge at the end of the free track', () => {
  const r = rewardsFor('s1', 50);
  const prem = r.filter((x) => x.track === 'premium'), free = r.filter((x) => x.track === 'free');
  assert.equal(prem.length, 50, 'every premium tier has a reward');
  assert.deepEqual(free.filter((x) => x.kind === 'frame').map((x) => x.tier), [10, 25, 45]);
  assert.deepEqual(prem.filter((x) => x.kind === 'frame').map((x) => x.tier), [1, 8, 16, 24, 32, 50]);
  assert.deepEqual(free.find((x) => x.tier === 50), { tier: 50, track: 'free', kind: 'badge', value: 's1' });
  for (const x of r.filter((y) => y.kind === 'frame')) assert.ok(PASS_FRAMES.some((f) => f.id === x.value), x.value);
  assert.equal(new Set(r.filter((y) => y.kind === 'frame').map((y) => y.value)).size, 9, 'nine different frames');
  const premCoins = prem.filter((x) => x.kind === 'coins').reduce((s, x) => s + Number(x.value), 0);
  assert.ok(premCoins < 2000, 'the premium coins do not pay the pass back: ' + premCoins);
});

test('season XP: only the server\'s weekly statistics inside the season, tiers of 250 XP, capped at 50', { skip }, async () => {
  const t = await setup();
  try {
    const u = await t.mk();
    let s = await t.pass.status(u.id);
    assert.deepEqual([s.season.id, s.season.tiers, s.season.xpPerTier, s.season.premiumPrice, s.xp, s.tier, s.claimable], ['s1', 50, 250, 2000, 0, 0, 0]);
    assert.equal(s.rewards.length, 50 + 9 + 1); // 50 premium + the free ones
    await t.play(u, t.weekBefore, { entries: 100, wins: 50 }); // before the season: not counted
    await t.play(u, t.weekIn, { entries: 30, wins: 5, seconds: 600 }); // 300 + 200 + 10 = 510
    s = await t.pass.status(u.id);
    assert.deepEqual([s.xp, s.tier, s.tierXp], [510, 2, 10]);
    await t.play(u, t.weekIn, { entries: 5000, wins: 0, seconds: 0 }); // 50 000 XP → capped at the last tier
    s = await t.pass.status(u.id);
    assert.equal(s.tier, 50);
    // an unlinked account counts nothing from the viewers' table
    const v = await t.p.register({ username: 'nolink' + (++n), email: 'nolink' + n + '@example.com', password: 'reef2026go', confirm: 'reef2026go' });
    assert.equal((await t.pass.status(v.id)).xp, 0);
  } finally { await t.pool.end(); }
});

test('claims: once each (double click, 20 parallel requests), only reached tiers, premium only for members', { skip }, async () => {
  const t = await setup();
  try {
    const u = await t.mk();
    await t.play(u, t.weekIn, { entries: 100 }); // 1000 XP → tier 4
    await assert.rejects(t.pass.claim(u.id, { tier: 5, track: 'free' }), /تصل إلى المستوى 5/);
    await assert.rejects(t.pass.claim(u.id, { tier: 1, track: 'premium' }), (e) => e.status === 403);
    await assert.rejects(t.pass.claim(u.id, { tier: 3, track: 'free' }), (e) => e.status === 404, 'no free reward on tier 3');
    await t.play(u, t.weekIn, { entries: 125 }); // 1250 XP → tier 5: 50 coins on the free track
    const burst = await Promise.all(Array.from({ length: 20 }, () => t.pass.claim(u.id, { tier: 5, track: 'free' })));
    assert.equal(burst.reduce((s, r) => s + r.granted.length, 0), 1, 'one grant for twenty requests');
    assert.equal((await t.eco.wallet(u.id)).earned, 50, 'the coins once');
    const again = await t.pass.claim(u.id, { tier: 5, track: 'free' });
    assert.deepEqual(again.granted, []);
    assert.equal(again.rewards.find((r) => r.tier === 5 && r.track === 'free').claimed, true);
  } finally { await t.pool.end(); }
});

test('premium: bought once with coins (purchased first), refused without enough, granted by the owner; «claim all»', { skip }, async () => {
  const t = await setup();
  try {
    const u = await t.mk();
    await assert.rejects(t.pass.buyPremium(u.id), (e) => e.status === 402);
    await t.pool.query(`INSERT INTO wallets (user_id, earned, purchased) VALUES ($1, 1500, 800) ON CONFLICT (user_id) DO UPDATE SET earned=1500, purchased=800`, [u.id]);
    const burst = await Promise.allSettled(Array.from({ length: 5 }, () => t.pass.buyPremium(u.id)));
    assert.equal(burst.filter((r) => r.status === 'fulfilled').length, 1, 'one purchase');
    assert.ok(burst.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 409));
    const w = await t.eco.wallet(u.id);
    assert.deepEqual([w.purchased, w.earned], [0, 300], '800 purchased first, then 1200 earned');
    const s = await t.pass.status(u.id); assert.equal(s.premium, true); assert.equal(s.premiumSource, 'buy');
    await assert.rejects(t.pass.setPremium(u.id, false, 'owner'), /لا يُسحب/, 'a bought pass is never taken back');
    // claim everything reached: tier 8 → premium 1..8 + nothing on the free track before 5? (5 = coins)
    await t.play(u, t.weekIn, { entries: 200 }); // 2000 XP → tier 8
    const all = await t.pass.claim(u.id, { all: true });
    assert.deepEqual(all.granted.map((g) => g.tier + g.track[0]).sort(), ['1p', '2p', '3p', '4p', '5f', '5p', '6p', '7p', '8p'].sort());
    assert.equal((await t.pass.claim(u.id, { all: true })).granted.length, 0, 'nothing twice');
    const frames = (await t.frames.list(u.id)).frames.filter((f) => f.source === 'pass').map((f) => f.id).sort();
    assert.deepEqual(frames, ['sp1_abyss', 'sp1_tide']);
    // the owner grants the premium track to another account, and can take a granted one back
    const g = await t.mk();
    await t.pass.setPremium(g.id, true, 'owner');
    assert.equal((await t.pass.status(g.id)).premiumSource, 'grant');
    await t.pass.setPremium(g.id, false, 'owner');
    assert.equal((await t.pass.status(g.id)).premium, false);
  } finally { await t.pool.end(); }
});

test('a pass frame is equipped like any frame and shows in the lobby list; free spins cost no coins; the badge', { skip }, async () => {
  const t = await setup();
  try {
    const u = await t.mk();
    await t.play(u, t.weekIn, { entries: 1500 }); // 15 000 XP → tier 50 (capped)
    await t.pass.claim(u.id, { all: true }); // free track only: frames 10/25/45, spins 15/35, coins, the badge
    // equip the free tier-10 frame: the lobby lookup by the linked handle returns it
    await t.frames.equip(u.id, 'sp1_bubble');
    const seen = await t.frames.forHandles('tiktok', [u.handle]);
    assert.deepEqual([seen.get(u.handle)?.id, seen.get(u.handle)?.effect], ['sp1_bubble', 'bubble']);
    await assert.rejects(t.frames.equip(u.id, 'sp1_king'), /ليس في مجموعتك/, 'a premium frame is not owned without premium');
    // two free spins: a spin costs no coins and uses one
    const before = await t.eco.wallet(u.id);
    assert.equal(before.freeSpins, 2);
    const r = await t.eco.spin(u.id, 1, 'pass-free-spin-1');
    assert.equal(r.cost, 0); assert.equal(r.results.length, 1);
    const after = await t.eco.wallet(u.id);
    assert.deepEqual([after.freeSpins, after.earned], [1, before.earned], 'one free spin used, no coins');
    // the season badge
    const b = await t.pass.badges(u.id);
    assert.deepEqual(b.map((x) => x.id), ['s1']);
  } finally { await t.pool.end(); }
});
