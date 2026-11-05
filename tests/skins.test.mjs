// «السكنات»: the built 3D files, the default skin for every account, claiming, equipping (ownership checked
// on the server) and admin grants. Real PostgreSQL for the account part; skipped when none is reachable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { createPool, migrate } from '../src/db.mjs';
import { Platform } from '../src/platform.mjs';
import { SKINS, DEFAULT_SKIN, SKIN_ANIMATIONS } from '../src/skins.mjs';
import { readGlb } from '../scripts/build-skins.mjs';

const pub = (p) => new URL('../public' + p, import.meta.url);

test('every skin ships an optimized GLB (one loadout, four animations) and a poster', () => {
  assert.equal(SKINS.filter((s) => s.default).length, 1, 'exactly one default skin');
  for (const s of SKINS) {
    const buf = fs.readFileSync(pub(s.model));
    assert.ok(buf.length < 600_000, `${s.id}.glb stays small (${buf.length})`);
    const { json } = readGlb(buf);
    assert.deepEqual(json.animations.map((a) => a.name).sort(), Object.keys(SKIN_ANIMATIONS).sort(), s.id + ' animations');
    const shown = json.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name).sort();
    assert.deepEqual(shown, [...s.keep].sort(), s.id + ' keeps only its loadout');
    assert.equal(json.images.length, 1); assert.ok(json.images[0].bufferView !== undefined, 'texture embedded, no extra request');
    assert.equal(json.skins[0].joints.length, 41);
    assert.ok(fs.statSync(pub(s.thumb)).size > 4000, s.id + ' poster rendered');
  }
  // three.js is self-hosted and every module import stays on our origin
  for (const f of ['GLTFLoader.js', 'OrbitControls.js', 'BufferGeometryUtils.js', 'SkeletonUtils.js']) {
    const src = fs.readFileSync(pub('/vendor/three/' + f), 'utf8');
    for (const m of src.matchAll(/^(?:import\b.*|\}) from '([^']+)';/gm)) assert.match(m[1], /^\.\/[\w.]+\.js$/, f + ' imports ' + m[1]);
  }
});

const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_sk_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let available = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); available = true; } catch {}
const skip = available ? false : 'no PostgreSQL at TEST_DATABASE_URL';
test.after(async () => { if (!available) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

test('default skin, claim, equip and grant — saved in PostgreSQL', { skip }, async () => {
  const pool = createPool(dbUrl); await migrate(pool, { log: null });
  const p = new Platform({ pool, hashCode: (c) => c, mail: { send: async () => {} }, gateway: { configured: false } });
  const a = await p.register({ username: 'skina', email: 'ska@example.com', password: 'reef2026go', confirm: 'reef2026go' });
  const b = await p.register({ username: 'skinb', email: 'skb@example.com', password: 'reef2026go', confirm: 'reef2026go' });
  try {
    // a new account owns and shows the default skin
    let s = await p.skins(a.id);
    assert.equal(s.equipped, DEFAULT_SKIN);
    assert.deepEqual(s.skins.filter((x) => x.owned).map((x) => x.id), [DEFAULT_SKIN]);
    assert.equal((await p.profile(a.id)).skin.id, DEFAULT_SKIN);
    assert.equal((await p.publicProfile(a.public_id)).skin.model, '/skins/knight.glb');

    // equipping something not owned is refused; claiming a free skin adds it; then it can be equipped
    await assert.rejects(p.equipSkin(a.id, 'mage'), /ليس في مجموعتك/);
    await assert.rejects(p.equipSkin(a.id, '../etc'), /غير موجود/);
    s = await p.claimSkin(a.id, 'mage');
    assert.equal(s.skins.find((x) => x.id === 'mage').owned, true);
    s = await p.equipSkin(a.id, 'mage');
    assert.equal(s.equipped, 'mage');
    assert.equal((await pool.query('SELECT skin FROM users WHERE id=$1', [a.id])).rows[0].skin, 'mage', 'stored in the users table');
    assert.equal((await p.publicProfile(a.public_id)).skin.id, 'mage');
    assert.equal((await p.skins(b.id)).equipped, DEFAULT_SKIN, 'other accounts are untouched');

    // the choice survives a fresh Platform (server restart)
    const p2 = new Platform({ pool, hashCode: (c) => c, mail: { send: async () => {} }, gateway: { configured: false } });
    await p2.load?.();
    assert.equal((await p2.skins(a.id)).equipped, 'mage');

    // claiming twice is harmless; going back to the default always works
    await p.claimSkin(a.id, 'mage'); await p.equipSkin(a.id, DEFAULT_SKIN);
    assert.equal((await p.skins(a.id)).equipped, DEFAULT_SKIN);

    // owner grants (future packs / prizes) are recorded with their source
    await p.grantSkin(b.id, 'rogue_hooded', 'owner');
    assert.equal((await p.skins(b.id)).skins.find((x) => x.id === 'rogue_hooded').source, 'grant');
    await p.equipSkin(b.id, 'rogue_hooded');

    // a skin removed from the catalog later falls back to the default instead of breaking the profile
    await pool.query(`UPDATE users SET skin='retired_skin' WHERE id=$1`, [b.id]); await p.refresh(b.id);
    assert.equal((await p.skins(b.id)).equipped, DEFAULT_SKIN);
    assert.equal((await p.profile(b.id)).skin.id, DEFAULT_SKIN);
  } finally { await pool.end(); }
});

test('rarities: five tiers, ten new skins with real recoloured models, the originals unchanged', async () => {
  const { RARITIES, SKINS: ALL } = await import('../src/skins.mjs');
  assert.deepEqual(Object.keys(RARITIES), ['common', 'rare', 'epic', 'legendary', 'mythic']);
  const wheel = ALL.filter((s) => s.access === 'wheel');
  assert.equal(wheel.length, 10);
  assert.deepEqual(['common', 'rare', 'epic', 'legendary', 'mythic'].map((r) => wheel.filter((s) => s.rarity === r).length), [2, 2, 2, 2, 2]);
  const textureOf = (id) => { const { json, bin } = readGlb(fs.readFileSync(pub('/skins/' + id + '.glb'))); const v = json.bufferViews[json.images[0].bufferView]; return bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength); };
  for (const s of wheel) {
    assert.ok(s.recolor, s.id + ' has its own look');
    const base = ALL.find((o) => o.access === 'free' && o.source === s.source);
    assert.notDeepEqual(textureOf(s.id), textureOf(base.id), s.id + ' texture differs from ' + base.id);
    assert.ok(s.price === RARITIES[s.rarity].price, 'listed price');
  }
  // special clips are baked under the standard names
  const king = readGlb(fs.readFileSync(pub('/skins/deep_king.glb'))).json;
  assert.deepEqual(king.animations.map((a) => a.name).sort(), ['idle', 'lose', 'walk', 'win']);
});

test('catalog in PostgreSQL, owner edits survive restarts, direct purchase is atomic', { skip }, async () => {
  const { Economy } = await import('../src/economy.mjs');
  const { tx } = await import('../src/db.mjs');
  const pool = createPool(dbUrl); await migrate(pool, { log: null });
  const p = new Platform({ pool, hashCode: (c) => c, mail: { send: async () => ({ sent: false }) }, gateway: { configured: false } });
  const eco = new Economy({ pool, platform: p });
  const u = await p.register({ username: 'buyer1', email: 'buyer1@example.com', password: 'reef2026go', confirm: 'reef2026go' });
  try {
    await p.catalog(true);
    assert.equal((await pool.query('SELECT count(*)::int n FROM skins')).rows[0].n, SKINS.length);
    assert.equal(p.skinCatalog.wheelPool().length, 10);
    // the owner renames a skin: kept after a restart (the seed never overwrites)
    await pool.query(`UPDATE skins SET name='ملك البحار' WHERE id='deep_king'`);
    const p2 = new Platform({ pool, hashCode: (c) => c, mail: { send: async () => {} }, gateway: { configured: false } });
    await p2.catalog();
    assert.equal(p2.skinCatalog.byId('deep_king').name, 'ملك البحار');

    // wheel skins cannot be claimed for free nor equipped before they are owned
    await assert.rejects(p.claimSkin(u.id, 'sponge_gold'), /غير متاح/);
    await assert.rejects(p.equipSkin(u.id, 'sponge_gold'), /ليس في مجموعتك/);
    // not enough coins
    await assert.rejects(eco.buySkin(u.id, 'sponge_gold'), /لا يكفي/);
    // 500 purchased + 600 earned → a 900-coin rare takes the purchased coins first
    await tx(pool, (c) => eco.move(c, u.id, { amount: 500, bucket: 'purchased', kind: 'admin', ref: 't1' }));
    await tx(pool, (c) => eco.move(c, u.id, { amount: 600, bucket: 'earned', kind: 'admin', ref: 't2' }));
    const results = await Promise.allSettled([eco.buySkin(u.id, 'sponge_gold'), eco.buySkin(u.id, 'sponge_gold'), eco.buySkin(u.id, 'sponge_gold')]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'bought once');
    const w = await eco.wallet(u.id);
    assert.deepEqual([w.purchased, w.earned, w.balance], [0, 200, 200]);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM wallet_transactions WHERE user_id=$1 AND kind='skin_buy'`, [u.id])).rows[0].n, 2);
    const s = await p.equipSkin(u.id, 'sponge_gold');
    assert.deepEqual([s.equipped, s.skins.find((x) => x.id === 'sponge_gold').source, s.skins.find((x) => x.id === 'sponge_gold').rarity], ['sponge_gold', 'buy', 'rare']);
    // a skin switched off disappears and the account falls back to the default
    await pool.query(`UPDATE skins SET active=false WHERE id='sponge_gold'`); await p.catalog(true); await p.refresh(u.id);
    assert.equal((await p.skins(u.id)).equipped, 'knight');
    await assert.rejects(eco.buySkin(u.id, 'sponge_gold'), /غير موجود/);
  } finally { await pool.end(); }
});
