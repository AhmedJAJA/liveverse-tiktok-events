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
    await assert.rejects(p.equipSkin(a.id, 'mage'), /أضف السكن/);
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
