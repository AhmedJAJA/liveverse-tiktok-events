// «متجر العملات»: the four final prices, server-priced orders, coins only after a trusted confirmation,
// failure / cancellation, repeated notifications credited once, spending limits, and the gateway path
// (a fake Moyasar). Real PostgreSQL; skipped without one.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPool, migrate } from '../src/db.mjs';
import { Platform } from '../src/platform.mjs';
import { Economy } from '../src/economy.mjs';

const ADMIN = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/postgres';
const dbName = 'sponge_store_' + process.pid;
const dbUrl = (() => { const u = new URL(ADMIN); u.pathname = '/' + dbName; return u.toString(); })();
let available = false;
try { const c = new pg.Client({ connectionString: ADMIN, connectionTimeoutMillis: 2000 }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName}`); await c.query(`CREATE DATABASE ${dbName}`); await c.end(); available = true; } catch {}
const skip = available ? false : 'no PostgreSQL at TEST_DATABASE_URL';
test.after(async () => { if (!available) return; const c = new pg.Client({ connectionString: ADMIN }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {}); await c.end(); });

function fakeGateway() {
  const invoices = new Map(); let n = 0;
  return {
    configured: true, name: 'moyasar', invoices,
    async createInvoice(o) { const id = 'inv_' + (++n); invoices.set(id, { id, status: 'initiated', amount: o.amount, currency: o.currency, metadata: o.metadata }); return { id, url: 'https://pay.example/' + id, status: 'initiated' }; },
    async fetchInvoice(id) { const i = invoices.get(id); return i && { id: i.id, status: i.status, amount: i.amount, currency: i.currency }; },
    checkWebhook: () => true,
  };
}

test('coin store: prices, WhatsApp orders confirmed by the owner, limits, gateway confirmations', { skip, timeout: 60_000 }, async () => {
  const pool = createPool(dbUrl); await migrate(pool, { log: null });
  const p = new Platform({ pool, hashCode: (c) => c, mail: { send: async () => ({ sent: false }) }, gateway: { configured: false }, appUrl: 'https://sponge.test' });
  const eco = new Economy({ pool, platform: p });
  const mk = (n) => p.register({ username: 'st' + n, email: 'st' + n + '@example.com', password: 'reef2026go', confirm: 'reef2026go' });
  try {
    // the final price list, the same in the database and the API
    const pk = await eco.packages();
    assert.deepEqual(pk.map((x) => [x.coins, x.price, x.badge]), [[500, 3.75, 'الباقة الصغيرة'], [2000, 9.99, 'باقة البداية'], [5000, 19.99, 'الأكثر توازناً'], [10000, 34.99, 'أفضل قيمة']]);
    assert.equal(pk.find((x) => x.featured).coins, 10000);

    const a = await mk(1);
    await assert.rejects(eco.createOrder(a.id, 'coins_500', {}), /18/);
    await assert.rejects(eco.createOrder(a.id, 'coins_999', { adult: true }), /غير متاحة/);
    // WhatsApp order: pending, nothing credited until the owner confirms the payment
    const o1 = await eco.createOrder(a.id, 'coins_2000', { adult: true });
    assert.deepEqual([o1.order.status, o1.order.amount, o1.order.coins, o1.order.provider], ['pending', 9.99, 2000, 'whatsapp']);
    assert.match(o1.order.ref, /^SC-[A-HJ-NP-Z2-9]{8}$/);
    assert.equal((await eco.wallet(a.id)).balance, 0);
    await assert.rejects(eco.decideOrder(o1.order.ref, 'paid', { actor: 'owner', reason: '' }), /مرجع/);
    const confirms = await Promise.allSettled(Array.from({ length: 5 }, () => eco.decideOrder(o1.order.ref, 'paid', { actor: 'owner', reason: 'تحويل بنكي 7781' })));
    assert.ok(confirms.every((r) => r.status === 'fulfilled'));
    let w = await eco.wallet(a.id);
    assert.deepEqual([w.purchased, w.earned, w.totalBought], [2000, 0, 2000], 'credited once, into the purchased bucket');
    assert.equal(w.transactions[0].kind, 'purchase');
    // later price changes never touch past orders
    await pool.query(`UPDATE coin_packages SET price_halalas=1299 WHERE id='coins_2000'`);
    assert.equal((await eco.store(a.id)).orders[0].amount, 9.99);
    await pool.query(`UPDATE coin_packages SET price_halalas=999 WHERE id='coins_2000'`);

    // cancelled and failed orders never pay
    const o2 = await eco.createOrder(a.id, 'coins_500', { adult: true });
    await eco.cancelOrder(a.id, o2.order.ref);
    await assert.rejects(eco.decideOrder(o2.order.ref, 'paid', { actor: 'owner', reason: 'محاولة' }), /cancelled/);
    const o3 = await eco.createOrder(a.id, 'coins_500', { adult: true });
    await eco.decideOrder(o3.order.ref, 'failed', { actor: 'owner', reason: 'لم يصل التحويل' });
    assert.equal((await eco.wallet(a.id)).purchased, 2000);

    // limits: 3 pending at most, 300 SAR per 30 days (pending included)
    const b = await mk(2);
    for (let i = 0; i < 3; i++) await eco.createOrder(b.id, 'coins_500', { adult: true });
    await assert.rejects(eco.createOrder(b.id, 'coins_500', { adult: true }), /بانتظار الدفع/);
    const c = await mk(3);
    for (let i = 0; i < 8; i++) { const o = await eco.createOrder(c.id, 'coins_10000', { adult: true }); await eco.decideOrder(o.order.ref, 'paid', { actor: 'owner', reason: 'دفع ' + i }); }
    await assert.rejects(eco.createOrder(c.id, 'coins_10000', { adult: true }), /حد الشراء 300/);
    assert.equal((await eco.wallet(c.id)).purchased, 80000);

    // gateway path: coins only when the gateway's own record says paid with the same amount and currency
    p.gateway = fakeGateway();
    const d = await mk(4);
    const g1 = await eco.createOrder(d.id, 'coins_5000', { adult: true });
    assert.match(g1.url, /^https:\/\/pay\.example\//);
    const inv = [...p.gateway.invoices.values()][0];
    assert.equal(inv.amount, 1999); assert.equal(inv.metadata.purchase_id, g1.order.id);
    assert.equal((await eco.confirmPurchase({ purchaseId: g1.order.id })).status, 'pending', 'opening the success page is not enough');
    inv.status = 'paid'; inv.amount = 100;
    assert.equal((await eco.confirmPurchase({ purchaseId: g1.order.id })).status, 'pending', 'a wrong amount is refused');
    assert.equal((await eco.wallet(d.id)).balance, 0);
    inv.amount = 1999;
    const hooks = await Promise.all([eco.confirmPurchase({ providerRef: inv.id }), eco.confirmPurchase({ providerRef: inv.id }), eco.confirmPurchase({ purchaseId: g1.order.id })]);
    assert.ok(hooks.every((h) => h.status === 'paid'));
    assert.equal((await eco.wallet(d.id)).purchased, 5000, 'repeated notifications credit once');
    await assert.rejects(eco.decideOrder(g1.order.ref, 'paid', { actor: 'owner', reason: 'يدوي' }), /البوابة/);
    // a declined payment
    const g2 = await eco.createOrder(d.id, 'coins_500', { adult: true });
    [...p.gateway.invoices.values()][1].status = 'failed';
    assert.equal((await eco.orderStatus(d.id, g2.order.id)).order.status, 'failed');
    assert.equal((await eco.wallet(d.id)).purchased, 5000);
    const log = (await eco.adminOverview()).logs.map((l) => l.action);
    assert.ok(log.includes('order-paid') && log.includes('order-failed'));
  } finally { await pool.end(); }
});
