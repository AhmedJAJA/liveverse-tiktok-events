// «عجلة السكنات»: server-side draws with stored odds, 100 / 900 earned coins (never purchased ones),
// idempotent keys (a retried or doubled request never charges twice), concurrent spins, published odds
// that always total 100%, and a statistical check over many draws. Real PostgreSQL; skipped without one.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPool, migrate, tx } from '../src/db.mjs';
import { Platform } from '../src/platform.mjs';
import { Economy } from '../src/economy.mjs';

const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_wheel_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let available = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); available = true; } catch {}
const skip = available ? false : 'no PostgreSQL at TEST_DATABASE_URL';
test.after(async () => { if (!available) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

let k = 0; const key = () => 'test-key-' + process.pid + '-' + (++k);

test('spins: cost, earned coins only, stored results, idempotency, concurrency, odds', { skip, timeout: 120_000 }, async () => {
  const pool = createPool(dbUrl); await migrate(pool, { log: null });
  const p = new Platform({ pool, hashCode: (c) => c, mail: { send: async () => ({ sent: false }) }, gateway: { configured: false } });
  const eco = new Economy({ pool, platform: p });
  const mk = (n) => p.register({ username: 'wh' + n, email: 'wh' + n + '@example.com', password: 'reef2026go', confirm: 'reef2026go' });
  const give = (u, amount, bucket = 'earned') => tx(pool, (c) => eco.move(c, u.id, { amount, bucket, kind: 'admin', ref: key() }));
  try {
    const a = await mk(1);
    // published odds total 100%
    const w0 = await eco.wheel(a.id);
    assert.deepEqual(w0.odds, { common: 55, rare: 27, epic: 12, legendary: 5, mythic: 1 });
    assert.deepEqual([w0.cost1, w0.cost10], [100, 900]);
    assert.equal(Object.values(w0.pool).flat().length, 10);

    // not enough coins; purchased coins do not pay for random prizes
    await assert.rejects(eco.spin(a.id, 1, key()), /تحتاج 100/);
    await give(a, 5000, 'purchased');
    await assert.rejects(eco.spin(a.id, 1, key()), /تحتاج 100/);
    assert.equal((await pool.query('SELECT count(*)::int n FROM wheel_spins')).rows[0].n, 0, 'nothing stored');
    await assert.rejects(eco.spin(a.id, 3, key()), /لفة واحدة أو 10/);

    // one spin: 100 earned coins, one stored prize, the skin is in the collection
    await give(a, 1000);
    const one = await eco.spin(a.id, 1, key());
    assert.deepEqual([one.count, one.cost, one.results.length, one.earned, one.balance], [1, 100, 1, 900, 5900]);
    const owned = await p.skins(a.id);
    assert.ok(owned.skins.find((s) => s.id === one.results[0].skin.id).owned);
    const snap = (await pool.query('SELECT odds FROM wheel_spins WHERE id=$1', [one.spin])).rows[0].odds;
    assert.equal(Object.values(snap.odds).reduce((x, y) => x + y, 0), 10000, 'the odds used are stored');

    // ten spins: 900 once, ten stored prizes
    const ten = await eco.spin(a.id, 10, key());
    assert.deepEqual([ten.count, ten.cost, ten.results.length, ten.earned], [10, 900, 10, 0]);
    // duplicates become extra copies
    const copies = (await pool.query('SELECT COALESCE(sum(copies),0)::int n FROM user_skins WHERE user_id=$1', [a.id])).rows[0].n;
    assert.equal(copies, 11);
    assert.equal(ten.results.filter((r) => r.duplicate).length + one.results.filter((r) => r.duplicate).length,
      11 - (await pool.query('SELECT count(*)::int n FROM user_skins WHERE user_id=$1', [a.id])).rows[0].n);

    // the same key again (lost connection, refresh, double click): same result, charged once
    const b = await mk(2); await give(b, 250);
    const kk = key();
    const tries = await Promise.allSettled(Array.from({ length: 6 }, () => eco.spin(b.id, 1, kk)));
    const ok = tries.filter((t) => t.status === 'fulfilled').map((t) => t.value);
    assert.ok(ok.length >= 1); assert.equal(new Set(ok.map((r) => r.spin)).size, 1, 'one stored spin');
    assert.equal((await eco.wallet(b.id)).earned, 150, 'charged once');
    assert.equal((await eco.spinByKey(b.id, kk)).results[0].skin.id, ok[0].results[0].skin.id, 'result can be fetched again');
    assert.equal(await eco.spinByKey(a.id, kk), null, 'not visible to another account');
    // different keys at once with coins for one spin only → exactly one succeeds
    const race = await Promise.allSettled([eco.spin(b.id, 1, key()), eco.spin(b.id, 1, key()), eco.spin(b.id, 1, key())]);
    assert.equal(race.filter((t) => t.status === 'fulfilled').length, 1);
    assert.equal((await eco.wallet(b.id)).earned, 50);

    // owner odds: must total 100%, versioned, used by the next spin
    await assert.rejects(eco.setWheelOdds({ common: 50, rare: 27, epic: 12, legendary: 5, mythic: 1 }, { actor: 'owner', reason: 'تجربة نسب' }), /100%/);
    await assert.rejects(eco.setWheelOdds({ common: 55, rare: 27, epic: 12, legendary: 5, mythic: 1 }, { actor: 'owner', reason: '' }), /سبب/);
    const cfg = await eco.setWheelOdds({ common: 60, rare: 25, epic: 10, legendary: 4, mythic: 1 }, { actor: 'owner', reason: 'تعديل تجريبي' });
    assert.equal(cfg.version, 1);
    assert.equal((await eco.wheel(a.id)).odds.common, 60);
    // a rarity with no skins in the wheel is dropped and the rest still total 100%
    await pool.query(`UPDATE skins SET in_wheel=false WHERE rarity='mythic'`); await p.catalog(true);
    const eff = await eco.effectiveOdds();
    assert.equal(eff.odds.mythic, undefined);
    assert.equal(Object.values(eff.odds).reduce((x, y) => x + y, 0), 10000);
    await pool.query(`UPDATE skins SET in_wheel=true WHERE rarity='mythic'`); await p.catalog(true);
    await eco.setWheelOdds({ common: 55, rare: 27, epic: 12, legendary: 5, mythic: 1 }, { actor: 'owner', reason: 'العودة للنسب المعلنة' });

    // statistics: 300,000 server draws match the published odds
    const sim = await eco.simulate(300000);
    const tol = { common: 0.5, rare: 0.45, epic: 0.35, legendary: 0.25, mythic: 0.1 };
    for (const [r, pct] of Object.entries(sim.expected)) assert.ok(Math.abs((sim.observed[r] || 0) - pct) <= tol[r], `${r}: ${sim.observed[r]} vs ${pct}`);
    // and the real spin path agrees over many stored spins (no hidden bias)
    const c = await mk(3); await give(c, 900 * 100);
    for (let i = 0; i < 100; i++) await eco.spin(c.id, 10, key());
    const dist = Object.fromEntries((await pool.query(`SELECT r.rarity, count(*)::int n FROM wheel_rewards r JOIN wheel_spins s ON s.id=r.spin_id WHERE s.user_id=$1 GROUP BY r.rarity`, [c.id])).rows.map((x) => [x.rarity, x.n / 10]));
    assert.ok(Math.abs(dist.common - 55) < 6 && Math.abs(dist.rare - 27) < 5.5 && (dist.mythic || 0) < 4, JSON.stringify(dist));
    assert.equal((await eco.wallet(c.id)).earned, 0);
    const rep = await eco.wheelReport();
    assert.ok(rep.totalPrizes >= 1000 && rep.spins.length > 0);
  } finally { await pool.end(); }
});
