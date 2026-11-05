/* SPONGE LIVE — «عملات الإسفنجة» (Sponge Coins): wallets, daily reward, invitations.
   The server is the only source of truth: every balance change runs in one database transaction with the
   wallet row locked, and every movement has a unique idempotency key (wallet_transactions UNIQUE), so a
   refresh, a second tab, a replayed request or a restart can never pay or charge twice.
   Time comes from PostgreSQL's clock (now()), never from the browser. */
import { createHash, randomInt } from 'node:crypto';
import { tx } from './db.mjs';

export const DAILY_REWARD = 200;
export const DAILY_EVERY_HOURS = 24;
export const REFERRAL_REWARD = 50;
export const REFERRAL_CAP = 10;
/* «عجلة السكنات» — published odds in basis points (10000 = 100%). Spins use earned coins only: random
   prizes are never bought with money (see the notes shown next to the wheel). */
export const WHEEL_DEFAULT = Object.freeze({ odds: { common: 5500, rare: 2700, epic: 1200, legendary: 500, mythic: 100 }, cost1: 100, cost10: 900 });
const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];
/* «متجر العملات»: spending limits that protect buyers (owner-adjustable in economy_settings 'store'). */
export const STORE_DEFAULT = Object.freeze({ monthlyCapHalalas: 30000, maxPending: 3 });
export const WHATSAPP_URL = 'https://wa.me/qr/7GOY3ACMFYQCK1';
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRef = () => 'SC-' + Array.from({ length: 8 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join('');

export class EconomyError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const fail = (m, s) => { throw new EconomyError(m, s); };
const iso = (d) => (d ? new Date(d).toISOString() : null);
const hash = (v) => createHash('sha256').update('sl-dev:' + String(v)).digest('base64url').slice(0, 32);
export const hashDevice = (raw) => (/^[A-Za-z0-9_-]{16,64}$/.test(String(raw || '')) ? hash(raw) : null);
export const hashIp = (ip) => (ip ? createHash('sha256').update('net:' + ip).digest('base64url').slice(0, 16) : null);

export class Economy {
  constructor({ pool, platform = null }) { this.pool = pool; this.platform = platform; }

  /* ---------------------------------------------------------------- wallet */
  async ensure(c, userId) { await c.query('INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]); }
  /** Locks the wallet row for the rest of the transaction (serializes every change of one account). */
  async lock(c, userId) { await this.ensure(c, userId); return (await c.query('SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [userId])).rows[0]; }
  /**
   * Moves coins inside an open transaction. `ref` is the idempotency key: the same (kind, ref, bucket) is
   * applied once; a repeat returns { duplicate: true } and changes nothing.
   */
  async move(c, userId, { amount, bucket, kind, ref, note = '' }) {
    if (!Number.isInteger(amount) || amount === 0) fail('مبلغ غير صالح');
    if (!['earned', 'purchased'].includes(bucket)) fail('نوع رصيد غير معروف');
    const w = await this.lock(c, userId);
    const seen = (await c.query('SELECT id FROM wallet_transactions WHERE user_id=$1 AND kind=$2 AND ref=$3 AND bucket=$4', [userId, kind, String(ref), bucket])).rows[0];
    if (seen) return { duplicate: true, wallet: w };
    const now = Number(w[bucket]) + amount;
    if (now < 0) fail('رصيدك لا يكفي', 402);
    const up = (await c.query(
      `UPDATE wallets SET ${bucket}=$2,
         total_earned = total_earned + CASE WHEN $3 > 0 AND $4 = 'earned' THEN $3 ELSE 0 END,
         total_bought = total_bought + CASE WHEN $3 > 0 AND $4 = 'purchased' THEN $3 ELSE 0 END,
         total_spent  = total_spent  + CASE WHEN $3 < 0 THEN -$3 ELSE 0 END,
         updated_at=now() WHERE user_id=$1 RETURNING *`, [userId, now, amount, bucket])).rows[0];
    await c.query('INSERT INTO wallet_transactions (user_id, amount, bucket, kind, ref, balance_after, note) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [userId, amount, bucket, kind, String(ref), Number(up.earned) + Number(up.purchased), String(note).slice(0, 200)]);
    return { duplicate: false, wallet: up };
  }
  view(w, serverNow) {
    const earned = Number(w?.earned || 0), purchased = Number(w?.purchased || 0);
    return {
      balance: earned + purchased, earned, purchased,
      totalEarned: Number(w?.total_earned || 0), totalBought: Number(w?.total_bought || 0), totalSpent: Number(w?.total_spent || 0),
      shards: Number(w?.shards || 0),
      daily: { amount: DAILY_REWARD, nextAt: iso(w?.next_daily_at), count: Number(w?.daily_count || 0) },
      serverNow: iso(serverNow),
    };
  }
  async wallet(userId) {
    await this.ensure(this.pool, userId);
    const r = (await this.pool.query('SELECT w.*, now() AS server_now FROM wallets w WHERE user_id=$1', [userId])).rows[0];
    const txs = (await this.pool.query('SELECT amount, bucket, kind, note, balance_after, created_at FROM wallet_transactions WHERE user_id=$1 ORDER BY id DESC LIMIT 30', [userId])).rows;
    return { ...this.view(r, r.server_now), transactions: txs.map((t) => ({ amount: t.amount, bucket: t.bucket, kind: t.kind, note: t.note, balanceAfter: Number(t.balance_after), at: iso(t.created_at) })) };
  }

  /* ---------------------------------------------------------------- daily reward
     200 coins, then again 24 full hours after the last one (no catching up on missed days). Verified accounts
     only (e-mail or Google) — the same rule as the free trial — so throw-away sign-ups cannot farm coins. */
  async claimDaily(userId) {
    const u = (await this.pool.query('SELECT email_verified_at, disabled_at FROM users WHERE id=$1', [userId])).rows[0];
    if (!u || u.disabled_at) fail('الحساب غير متاح', 403);
    if (!u.email_verified_at) return { granted: false, reason: 'verify', ...(await this.wallet(userId)) };
    const out = await tx(this.pool, async (c) => {
      await this.lock(c, userId);
      // the single winner of any race: the row only changes while the reward is due (server clock)
      const due = (await c.query(
        `UPDATE wallets SET next_daily_at = now() + make_interval(hours => $2), daily_count = daily_count + 1
         WHERE user_id=$1 AND (next_daily_at IS NULL OR next_daily_at <= now()) RETURNING daily_count`, [userId, DAILY_EVERY_HOURS])).rows[0];
      if (!due) return { granted: false, reason: 'wait' };
      const n = due.daily_count;
      await c.query('INSERT INTO daily_rewards (user_id, n, amount) VALUES ($1,$2,$3)', [userId, n, DAILY_REWARD]);
      await this.move(c, userId, { amount: DAILY_REWARD, bucket: 'earned', kind: 'daily', ref: 'daily:' + n, note: 'مكافأة الدخول اليومية #' + n });
      return { granted: true, amount: DAILY_REWARD, n };
    });
    return { ...out, ...(await this.wallet(userId)) };
  }

  /* ---------------------------------------------------------------- invitations
     A link /signup?ref=SPG-XXXXXX remembers the inviter (cookie) until the new account is created. The inviter
     earns 50 coins only once the new account proves its e-mail (or signs in with a verified Google account),
     for at most 10 accounts. Same browser or same sign-up network as the inviter → held for the owner's review. */
  async attachReferral(refereeId, referrerPublicId, { device = null, ipHash = null } = {}) {
    const id = String(referrerPublicId || '').toUpperCase();
    if (!/^SPG-[A-HJ-NP-Z2-9]{6}$/.test(id)) return null;
    const ref = (await this.pool.query('SELECT id, disabled_at FROM users WHERE public_id=$1', [id])).rows[0];
    if (!ref || ref.disabled_at || ref.id === refereeId) return null;
    await this.pool.query('UPDATE users SET referred_by=$2 WHERE id=$1 AND referred_by IS NULL', [refereeId, ref.id]);
    await this.pool.query('INSERT INTO referrals (referee_id, referrer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [refereeId, ref.id]);
    if (device || ipHash) await this.pool.query('UPDATE users SET signup_device=COALESCE(signup_device,$2), signup_ip_hash=COALESCE(signup_ip_hash,$3) WHERE id=$1', [refereeId, device, ipHash]);
    return ref.id;
  }
  async noteDevice(userId, device) {
    if (!device) return;
    await this.pool.query(`INSERT INTO account_devices (user_id, device) VALUES ($1,$2)
      ON CONFLICT (user_id, device) DO UPDATE SET last_seen=now()`, [userId, device]);
  }
  /** Called when an account becomes verified. Safe to call any number of times. */
  async settleReferral(refereeId) {
    return tx(this.pool, async (c) => {
      const r = (await c.query('SELECT * FROM referrals WHERE referee_id=$1 FOR UPDATE', [refereeId])).rows[0];
      if (!r || r.status !== 'pending') return r?.status || null;
      const who = (await c.query('SELECT id, email_verified_at, disabled_at, signup_device, signup_ip_hash, created_at FROM users WHERE id = ANY($1)', [[r.referee_id, r.referrer_id]])).rows;
      const referee = who.find((x) => x.id === r.referee_id), referrer = who.find((x) => x.id === r.referrer_id);
      if (!referee?.email_verified_at) return 'pending';
      const decide = (status, reason) => c.query('UPDATE referrals SET status=$2, reason=$3, decided_at=now() WHERE referee_id=$1', [refereeId, status, reason]).then(() => status);
      if (!referrer || referrer.disabled_at) return decide('rejected', 'inviter unavailable');
      if (new Date(referee.created_at) < new Date(referrer.created_at)) return decide('rejected', 'account older than inviter');
      await this.lock(c, r.referrer_id); // one inviter's rewards are counted one at a time
      const used = Number((await c.query(`SELECT count(*)::int n FROM referrals WHERE referrer_id=$1 AND status IN ('granted','held')`, [r.referrer_id])).rows[0].n);
      if (used >= REFERRAL_CAP) return decide('capped', 'limit reached');
      // signals that the "friend" may be the inviter: the same browser, or the same sign-up network as one of theirs
      const sameDevice = referee.signup_device && (await c.query('SELECT 1 FROM account_devices WHERE user_id=$1 AND device=$2', [r.referrer_id, referee.signup_device])).rowCount;
      const sameNet = referee.signup_ip_hash && referee.signup_ip_hash === referrer.signup_ip_hash;
      if (sameDevice || sameNet) return decide('held', sameDevice ? 'same browser as inviter' : 'same sign-up network as inviter');
      await this.move(c, r.referrer_id, { amount: REFERRAL_REWARD, bucket: 'earned', kind: 'referral', ref: 'referral:' + refereeId, note: 'دعوة صديق' });
      return decide('granted', '');
    });
  }
  /** Owner decision on a held invitation (still subject to the cap). */
  async decideReferral(refereeId, approve, actor, reason) {
    const why = String(reason || '').trim();
    if (why.length < 3) fail('اكتب سبب القرار');
    const out = await tx(this.pool, async (c) => {
      const r = (await c.query('SELECT * FROM referrals WHERE referee_id=$1 FOR UPDATE', [refereeId])).rows[0];
      if (!r || r.status !== 'held') fail('لا توجد دعوة معلّقة', 404);
      if (!approve) { await c.query(`UPDATE referrals SET status='rejected', reason=$2, decided_at=now() WHERE referee_id=$1`, [refereeId, why]); return 'rejected'; }
      await this.lock(c, r.referrer_id);
      const granted = Number((await c.query(`SELECT count(*)::int n FROM referrals WHERE referrer_id=$1 AND status='granted'`, [r.referrer_id])).rows[0].n);
      if (granted >= REFERRAL_CAP) { await c.query(`UPDATE referrals SET status='capped', reason=$2, decided_at=now() WHERE referee_id=$1`, [refereeId, why]); return 'capped'; }
      await this.move(c, r.referrer_id, { amount: REFERRAL_REWARD, bucket: 'earned', kind: 'referral', ref: 'referral:' + refereeId, note: 'دعوة صديق (بعد المراجعة)' });
      await c.query(`UPDATE referrals SET status='granted', reason=$2, decided_at=now() WHERE referee_id=$1`, [refereeId, why]);
      return 'granted';
    });
    await this.log(actor, 'referral-' + (approve ? 'approve' : 'reject'), refereeId, why, { result: out });
    return out;
  }
  async invitations(userId, publicId, appUrl) {
    const rows = (await this.pool.query(`SELECT r.status, r.created_at, r.decided_at, u.display_name, u.public_id
      FROM referrals r JOIN users u ON u.id=r.referee_id WHERE r.referrer_id=$1 ORDER BY r.created_at DESC LIMIT 50`, [userId])).rows;
    const granted = rows.filter((r) => r.status === 'granted').length;
    return {
      link: `${appUrl}/signup?ref=${publicId}`, reward: REFERRAL_REWARD, cap: REFERRAL_CAP,
      completed: granted, remaining: Math.max(0, REFERRAL_CAP - granted), earned: granted * REFERRAL_REWARD,
      pending: rows.filter((r) => r.status === 'pending').length, held: rows.filter((r) => r.status === 'held').length,
      list: rows.map((r) => ({ name: r.display_name, publicId: r.public_id, status: r.status, at: iso(r.decided_at || r.created_at) })),
    };
  }

  /* ---------------------------------------------------------------- direct skin purchase (fixed, listed price)
     Paid from purchased coins first, then earned ones. Owned skins cannot be bought twice; one transaction. */
  async buySkin(userId, skinId) {
    const p = this.platform; await p.catalog();
    const skin = p.skinCatalog.byId(String(skinId || ''));
    if (!skin) fail('السكن غير موجود', 404);
    if (!skin.price || skin.access === 'grant' || skin.default) fail('هذا السكن غير معروض للشراء', 403);
    const price = Number(skin.price);
    await tx(this.pool, async (c) => {
      const w = await this.lock(c, userId);
      if ((await c.query('SELECT 1 FROM user_skins WHERE user_id=$1 AND skin_id=$2', [userId, skin.id])).rowCount) fail('السكن في مجموعتك بالفعل', 409);
      const fromPurchased = Math.min(price, Number(w.purchased)), fromEarned = price - fromPurchased;
      if (fromEarned > Number(w.earned)) fail('رصيدك لا يكفي لشراء هذا السكن', 402);
      if (fromPurchased) await this.move(c, userId, { amount: -fromPurchased, bucket: 'purchased', kind: 'skin_buy', ref: 'skin:' + skin.id, note: 'شراء سكن: ' + skin.name });
      if (fromEarned) await this.move(c, userId, { amount: -fromEarned, bucket: 'earned', kind: 'skin_buy', ref: 'skin:' + skin.id, note: 'شراء سكن: ' + skin.name });
      await c.query(`INSERT INTO user_skins (user_id, skin_id, source) VALUES ($1,$2,'buy')`, [userId, skin.id]);
    });
    return { ok: true, skin: skin.id, price };
  }

  /* ---------------------------------------------------------------- «عجلة السكنات»
     The server alone draws the prizes (crypto randomInt), stores them with a snapshot of the odds, takes the
     coins and adds the skins — all in one transaction — and only then returns the result for the animation.
     A rarity with no skin in the wheel is left out and the others are re-weighted; the shown odds say so. */
  async wheelConfig(c = this.pool) {
    const r = (await c.query(`SELECT value, version FROM economy_settings WHERE key='wheel'`)).rows[0];
    const v = r?.value || WHEEL_DEFAULT;
    return { odds: { ...WHEEL_DEFAULT.odds, ...(v.odds || {}) }, cost1: v.cost1 || WHEEL_DEFAULT.cost1, cost10: v.cost10 || WHEEL_DEFAULT.cost10, version: r?.version || 0 };
  }
  /** The odds that apply right now: rarities without skins in the wheel are dropped and the rest scaled to 100%. */
  async effectiveOdds(c = this.pool) {
    const cfg = await this.wheelConfig(c), p = this.platform; await p.catalog();
    const pool = p.skinCatalog.wheelPool(), byRarity = {};
    for (const s of pool) (byRarity[s.rarity] ||= []).push(s);
    const live = RARITY_ORDER.filter((r) => byRarity[r]?.length && cfg.odds[r] > 0);
    const total = live.reduce((n, r) => n + cfg.odds[r], 0);
    const odds = {}; let acc = 0;
    live.forEach((r, i) => { const bp = i === live.length - 1 ? 10000 - acc : Math.round((cfg.odds[r] * 10000) / total); odds[r] = bp; acc += bp; });
    return { ...cfg, odds, configured: cfg.odds, pool: Object.fromEntries(live.map((r) => [r, byRarity[r].map((s) => s.id)])) };
  }
  draw(eff) {
    let roll = randomInt(10000), rarity = null;
    for (const r of RARITY_ORDER) { const bp = eff.odds[r] || 0; if (roll < bp) { rarity = r; break; } roll -= bp; }
    const ids = eff.pool[rarity];
    return { rarity, skinId: ids[randomInt(ids.length)] };
  }
  async wheel(userId) {
    const eff = await this.effectiveOdds(), p = this.platform;
    const spins = (await this.pool.query(`SELECT s.id, s.count, s.cost, s.created_at, json_agg(json_build_object('skin', r.skin_id, 'rarity', r.rarity, 'duplicate', r.duplicate) ORDER BY r.idx) results
      FROM wheel_spins s JOIN wheel_rewards r ON r.spin_id=s.id WHERE s.user_id=$1 GROUP BY s.id ORDER BY s.id DESC LIMIT 10`, [userId])).rows;
    const w = await this.wallet(userId);
    return {
      cost1: eff.cost1, cost10: eff.cost10, earned: w.earned, balance: w.balance, version: eff.version,
      odds: Object.fromEntries(Object.entries(eff.odds).map(([r, bp]) => [r, bp / 100])),
      pool: Object.fromEntries(Object.entries(eff.pool).map(([r, ids]) => [r, ids.map((id) => { const s = p.skinCatalog.byId(id); return { id, name: s.name, thumb: s.thumb }; })])),
      recent: spins.map((s) => ({ id: s.id, count: s.count, cost: s.cost, at: iso(s.created_at), results: s.results })),
    };
  }
  async spin(userId, count, key) {
    const n = Number(count);
    if (n !== 1 && n !== 10) fail('اختر لفة واحدة أو 10 لفات');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(key || ''))) fail('طلب غير صالح');
    const p = this.platform;
    const out = await tx(this.pool, async (c) => {
      await this.lock(c, userId); // one spin of an account at a time
      const done = (await c.query('SELECT id FROM wheel_spins WHERE user_id=$1 AND idem_key=$2', [userId, key])).rows[0];
      if (done) return { id: done.id, replay: true };
      const eff = await this.effectiveOdds(c);
      if (!Object.keys(eff.pool).length) fail('العجلة متوقفة مؤقتًا', 503);
      const cost = n === 10 ? eff.cost10 : eff.cost1;
      const w = (await c.query('SELECT earned FROM wallets WHERE user_id=$1', [userId])).rows[0];
      if (Number(w.earned) < cost) fail(`تحتاج ${cost} عملة مكتسبة — رصيدك المكتسب ${Number(w.earned)}`, 402);
      const spin = (await c.query('INSERT INTO wheel_spins (user_id, idem_key, count, cost, odds, odds_version) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [userId, key, n, cost, { odds: eff.odds, configured: eff.configured, pool: eff.pool }, eff.version])).rows[0];
      await this.move(c, userId, { amount: -cost, bucket: 'earned', kind: 'spin', ref: 'spin:' + spin.id, note: n === 10 ? '10 لفات' : 'لفة واحدة' });
      for (let i = 0; i < n; i++) {
        const d = this.draw(eff);
        const ins = (await c.query(`INSERT INTO user_skins (user_id, skin_id, source) VALUES ($1,$2,'wheel')
          ON CONFLICT (user_id, skin_id) DO UPDATE SET copies = user_skins.copies + 1 RETURNING (xmax = 0) AS fresh`, [userId, d.skinId])).rows[0];
        const isDefault = p.skinCatalog.byId(d.skinId)?.default;
        await c.query('INSERT INTO wheel_rewards (spin_id, idx, skin_id, rarity, duplicate) VALUES ($1,$2,$3,$4,$5)', [spin.id, i, d.skinId, d.rarity, !ins.fresh || !!isDefault]);
      }
      return { id: spin.id, replay: false };
    });
    return { ...(await this.spinResult(userId, out.id)), replay: out.replay };
  }
  async spinResult(userId, spinId) {
    const s = (await this.pool.query('SELECT id, count, cost, created_at FROM wheel_spins WHERE id=$1 AND user_id=$2', [spinId, userId])).rows[0];
    if (!s) fail('لا توجد عملية بهذا المعرف', 404);
    const p = this.platform; await p.catalog();
    const rows = (await this.pool.query('SELECT idx, skin_id, rarity, duplicate FROM wheel_rewards WHERE spin_id=$1 ORDER BY idx', [s.id])).rows;
    const w = await this.wallet(userId);
    return {
      spin: s.id, count: s.count, cost: s.cost, at: iso(s.created_at), earned: w.earned, balance: w.balance,
      results: rows.map((r) => { const sk = p.skinCatalog.anyById(r.skin_id); return { idx: r.idx, rarity: r.rarity, duplicate: r.duplicate, skin: sk ? { id: sk.id, name: sk.name, thumb: sk.thumb, model: sk.model, accent: sk.accent, rarity: sk.rarity } : { id: r.skin_id } }; }),
    };
  }
  async spinByKey(userId, key) {
    const r = (await this.pool.query('SELECT id FROM wheel_spins WHERE user_id=$1 AND idem_key=$2', [userId, String(key || '')])).rows[0];
    return r ? this.spinResult(userId, r.id) : null;
  }
  /** Owner: new odds (basis points, must total exactly 10000), versioned and logged with a reason. */
  async setWheelOdds(odds, { cost1, cost10, actor, reason }) {
    const why = String(reason || '').trim(); if (why.length < 5) fail('سبب التعديل مطلوب');
    const clean = {}; let sum = 0;
    for (const r of RARITY_ORDER) { const v = Math.round(Number(odds?.[r]) * 100); if (!Number.isInteger(v) || v < 0 || v > 10000) fail('نسبة غير صالحة: ' + r); clean[r] = v; sum += v; }
    if (sum !== 10000) fail(`مجموع النسب يجب أن يكون 100% (الحالي ${(sum / 100).toFixed(2)}%)`);
    const c1 = Number(cost1 ?? WHEEL_DEFAULT.cost1), c10 = Number(cost10 ?? WHEEL_DEFAULT.cost10);
    if (!Number.isInteger(c1) || c1 < 1 || !Number.isInteger(c10) || c10 < 1) fail('تكلفة غير صالحة');
    await this.pool.query(`INSERT INTO economy_settings (key, value, updated_by) VALUES ('wheel', $1, $2)
      ON CONFLICT (key) DO UPDATE SET value=$1, version=economy_settings.version+1, updated_by=$2, updated_at=now()`, [{ odds: clean, cost1: c1, cost10: c10 }, String(actor).slice(0, 60)]);
    await this.log(actor, 'wheel-odds', null, why, { odds: clean, cost1: c1, cost10: c10 });
    return this.wheelConfig();
  }
  /** Owner: what the current odds produce over n draws (nothing is saved or charged). */
  async simulate(n = 100000) {
    const eff = await this.effectiveOdds(), N = Math.min(1_000_000, Math.max(100, Number(n) || 100000)), hits = {};
    for (let i = 0; i < N; i++) { const d = this.draw(eff); hits[d.rarity] = (hits[d.rarity] || 0) + 1; }
    return { n: N, expected: Object.fromEntries(Object.entries(eff.odds).map(([r, bp]) => [r, bp / 100])), observed: Object.fromEntries(Object.entries(hits).map(([r, h]) => [r, Math.round((h / N) * 10000) / 100])) };
  }
  async wheelReport() {
    const [dist, spins] = await Promise.all([
      this.pool.query('SELECT rarity, count(*)::int n, sum(CASE WHEN duplicate THEN 1 ELSE 0 END)::int dups FROM wheel_rewards GROUP BY rarity'),
      this.pool.query(`SELECT s.id, s.count, s.cost, s.created_at, u.public_id FROM wheel_spins s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 100`),
    ]);
    const total = dist.rows.reduce((n, r) => n + r.n, 0);
    return {
      config: await this.effectiveOdds(), totalPrizes: total,
      distribution: dist.rows.map((r) => ({ rarity: r.rarity, n: r.n, pct: total ? Math.round((r.n / total) * 10000) / 100 : 0, duplicates: r.dups })),
      spins: spins.rows.map((s) => ({ id: s.id, count: s.count, cost: s.cost, at: iso(s.created_at), publicId: s.public_id })),
    };
  }

  /* ---------------------------------------------------------------- «متجر العملات»
     Prices come only from coin_packages; an order copies them at creation. Coins are added only after a
     trusted confirmation — the payment gateway's own record (amount, currency, reference all match) or the
     owner confirming a WhatsApp payment — never because a "success" page was opened. Crediting is idempotent
     (wallet ref 'purchase:<id>' + the order row locked), so a repeated webhook or click pays once. */
  async packages() {
    return (await this.pool.query('SELECT id, coins, price_halalas, currency, label, badge, blurb, featured FROM coin_packages WHERE active ORDER BY sort')).rows
      .map((p) => ({ id: p.id, coins: p.coins, price: p.price_halalas / 100, priceHalalas: p.price_halalas, currency: p.currency, label: p.label, badge: p.badge, blurb: p.blurb, featured: p.featured }));
  }
  async storeConfig() { const r = (await this.pool.query(`SELECT value FROM economy_settings WHERE key='store'`)).rows[0]; return { ...STORE_DEFAULT, ...(r?.value || {}) }; }
  purchaseView(p) { return { id: p.id, ref: p.ref, packageId: p.package_id, coins: p.coins, amount: p.amount_halalas / 100, currency: p.currency, status: p.status, provider: p.provider, createdAt: iso(p.created_at), paidAt: iso(p.paid_at) }; }
  async store(userId) {
    const [pk, cfg, rows, spent] = await Promise.all([
      this.packages(), this.storeConfig(),
      this.pool.query('SELECT * FROM purchases WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [userId]),
      this.pool.query(`SELECT COALESCE(sum(amount_halalas),0)::int n FROM purchases WHERE user_id=$1 AND (status='paid' AND paid_at > now() - interval '30 days' OR status='pending')`, [userId]),
    ]);
    const gw = this.platform?.gateway;
    return {
      packages: pk, payment: gw?.configured ? 'online' : 'whatsapp', whatsapp: WHATSAPP_URL,
      limits: { monthlyCap: cfg.monthlyCapHalalas / 100, used30d: spent.rows[0].n / 100, maxPending: cfg.maxPending },
      orders: rows.rows.map((p) => this.purchaseView(p)),
    };
  }
  async createOrder(userId, packageId, { adult } = {}) {
    if (adult !== true) fail('أكّد أن عمرك 18 سنة أو أكثر، أو أن ولي أمرك وافق على الشراء', 400);
    const pkg = (await this.pool.query('SELECT * FROM coin_packages WHERE id=$1 AND active', [String(packageId || '')])).rows[0];
    if (!pkg) fail('الباقة غير متاحة', 404);
    const cfg = await this.storeConfig(), gw = this.platform?.gateway;
    const u = (await this.pool.query('SELECT disabled_at FROM users WHERE id=$1', [userId])).rows[0];
    if (!u || u.disabled_at) fail('الحساب غير متاح', 403);
    const order = await tx(this.pool, async (c) => {
      await this.lock(c, userId); // one order of an account at a time (limits are checked consistently)
      const st = (await c.query(`SELECT count(*) FILTER (WHERE status='pending')::int pending,
          COALESCE(sum(amount_halalas) FILTER (WHERE status='paid' AND paid_at > now() - interval '30 days' OR status='pending'),0)::int used
        FROM purchases WHERE user_id=$1`, [userId])).rows[0];
      if (st.pending >= cfg.maxPending) fail(`لديك ${st.pending} طلبات بانتظار الدفع — أكملها أو ألغِها أولًا`, 409);
      if (st.used + pkg.price_halalas > cfg.monthlyCapHalalas) fail(`حد الشراء ${cfg.monthlyCapHalalas / 100} ريال كل 30 يومًا لحماية حسابك — المتاح الآن ${Math.max(0, (cfg.monthlyCapHalalas - st.used) / 100)} ريال`, 409);
      for (let i = 0; i < 5; i++) {
        try {
          return (await c.query(`INSERT INTO purchases (ref, user_id, package_id, coins, amount_halalas, currency, provider) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [newRef(), userId, pkg.id, pkg.coins, pkg.price_halalas, pkg.currency, gw?.configured ? 'moyasar' : 'whatsapp'])).rows[0];
        } catch (err) { if (err.code !== '23505') throw err; }
      }
      fail('تعذر إنشاء الطلب، حاول مرة أخرى', 500);
    });
    if (order.provider === 'moyasar') {
      const app = this.platform.appUrl;
      try {
        const inv = await gw.createInvoice({ amount: order.amount_halalas, currency: order.currency, description: `SPONGE LIVE — ${pkg.coins} عملة إسفنجة (${order.ref})`,
          callback_url: `${app}/api/billing/webhook`, success_url: `${app}/account?coins=${order.id}#store`, back_url: `${app}/account#store`, metadata: { purchase_id: order.id } });
        await this.pool.query('UPDATE purchases SET provider_ref=$2, raw_status=$3, updated_at=now() WHERE id=$1', [order.id, inv.id, String(inv.status || '')]);
        return { order: this.purchaseView(order), url: inv.url };
      } catch (err) {
        await this.pool.query(`UPDATE purchases SET status='failed', note=$2, updated_at=now() WHERE id=$1`, [order.id, 'gateway: ' + String(err.message).slice(0, 150)]);
        fail('تعذر فتح صفحة الدفع الآن — لم يُخصم شيء. حاول لاحقًا.', 502);
      }
    }
    return { order: this.purchaseView(order), whatsapp: WHATSAPP_URL };
  }
  /** Credits a confirmed order exactly once. */
  async creditOrder(c, p, by) {
    const locked = (await c.query('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [p.id])).rows[0];
    if (locked.status === 'paid') return { status: 'paid', already: true };
    await c.query(`UPDATE purchases SET status='paid', paid_at=now(), raw_status='paid', confirmed_by=$2, updated_at=now() WHERE id=$1`, [p.id, by]);
    await this.move(c, p.user_id, { amount: locked.coins, bucket: 'purchased', kind: 'purchase', ref: 'purchase:' + p.id, note: `شراء ${locked.coins} عملة (${locked.ref})` });
    return { status: 'paid' };
  }
  /** Gateway path: the gateway's own record decides (webhook or the buyer coming back). */
  async confirmPurchase({ purchaseId = null, providerRef = null } = {}) {
    const p = (await this.pool.query('SELECT * FROM purchases WHERE ' + (purchaseId ? 'id=$1' : 'provider_ref=$1'), [purchaseId || providerRef])).rows[0];
    if (!p) return { status: 'unknown' };
    if (p.status === 'paid') return { status: 'paid', already: true };
    const gw = this.platform?.gateway;
    if (p.provider !== 'moyasar' || !p.provider_ref || !gw?.configured) return { status: p.status };
    const inv = await gw.fetchInvoice(p.provider_ref);
    const paid = inv && inv.status === 'paid' && Number(inv.amount) === p.amount_halalas && String(inv.currency || '').toUpperCase() === p.currency && String(inv.id) === p.provider_ref;
    if (!paid) {
      const status = inv?.status === 'expired' ? 'expired' : inv?.status === 'failed' ? 'failed' : 'pending';
      await this.pool.query(`UPDATE purchases SET status=$2, raw_status=$3, updated_at=now() WHERE id=$1 AND status<>'paid'`, [p.id, status, String(inv?.status || '')]);
      return { status };
    }
    return tx(this.pool, (c) => this.creditOrder(c, p, 'gateway'));
  }
  async orderStatus(userId, id) {
    const p = (await this.pool.query('SELECT * FROM purchases WHERE id=$1 AND user_id=$2', [String(id || ''), userId])).rows[0];
    if (!p) fail('الطلب غير موجود', 404);
    if (p.status === 'pending' && p.provider === 'moyasar') { try { await this.confirmPurchase({ purchaseId: p.id }); } catch {} }
    const fresh = (await this.pool.query('SELECT * FROM purchases WHERE id=$1', [p.id])).rows[0];
    return { order: this.purchaseView(fresh), wallet: await this.wallet(userId) };
  }
  /** The buyer cancels a WhatsApp order they have not paid (gateway orders simply expire). */
  async cancelOrder(userId, ref) {
    const r = await this.pool.query(`UPDATE purchases SET status='cancelled', note='cancelled by buyer', updated_at=now() WHERE ref=$1 AND user_id=$2 AND status='pending' AND provider='whatsapp' RETURNING id`, [String(ref || ''), userId]);
    if (!r.rowCount) fail('لا يوجد طلب معلّق بهذا الرقم', 404);
    return this.store(userId);
  }
  /** Owner: a WhatsApp payment received (or refused). A reason / reference is always recorded. */
  async decideOrder(ref, decision, { actor, reason }) {
    const why = String(reason || '').trim(); if (why.length < 3) fail('اكتب مرجع الدفع أو سبب القرار');
    const p = (await this.pool.query('SELECT * FROM purchases WHERE ref=$1', [String(ref || '').toUpperCase()])).rows[0];
    if (!p) fail('لا يوجد طلب بهذا الرقم', 404);
    let out;
    if (decision === 'paid') {
      if (p.provider !== 'whatsapp') fail('طلبات الدفع الإلكتروني تؤكدها البوابة فقط', 409);
      if (!['pending', 'expired'].includes(p.status) && p.status !== 'paid') fail('لا يمكن تأكيد طلب ' + p.status, 409);
      out = await tx(this.pool, (c) => this.creditOrder(c, p, actor));
    } else if (decision === 'failed' || decision === 'cancelled') {
      const r = await this.pool.query(`UPDATE purchases SET status=$2, note=$3, confirmed_by=$4, updated_at=now() WHERE id=$1 AND status='pending' RETURNING id`, [p.id, decision, why, actor]);
      if (!r.rowCount) fail('الطلب ليس معلّقًا', 409);
      out = { status: decision };
    } else fail('قرار غير معروف');
    await this.log(actor, 'order-' + decision, p.user_id, why, { ref: p.ref, coins: p.coins, amount: p.amount_halalas / 100 });
    return out;
  }
  async adminPurchases(status = '') {
    const r = await this.pool.query(`SELECT p.*, u.public_id FROM purchases p JOIN users u ON u.id=p.user_id ${status ? 'WHERE p.status=$1' : ''} ORDER BY p.created_at DESC LIMIT 200`, status ? [status] : []);
    return r.rows.map((p) => ({ ...this.purchaseView(p), publicId: p.public_id, confirmedBy: p.confirmed_by, note: p.note }));
  }

  /* ---------------------------------------------------------------- owner tools */
  async log(actor, action, target, reason, details = {}) {
    await this.pool.query('INSERT INTO economy_admin_logs (actor, action, target, reason, details) VALUES ($1,$2,$3,$4,$5)', [String(actor).slice(0, 60), action, target, String(reason || '').slice(0, 300), details]);
  }
  /** Owner adjustment: always with a written reason, always logged. */
  async adjust(userId, { amount, bucket = 'earned', reason, actor }) {
    const why = String(reason || '').trim();
    if (why.length < 5) fail('سبب التعديل مطلوب (5 أحرف على الأقل)');
    const n = Number(amount);
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 1_000_000) fail('مبلغ غير صالح');
    const ref = 'admin:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
    await tx(this.pool, (c) => this.move(c, userId, { amount: n, bucket, kind: 'admin', ref, note: why }));
    await this.log(actor, 'wallet-adjust', userId, why, { amount: n, bucket });
    return this.wallet(userId);
  }
  async adminOverview() {
    const [tot, daily, refs, logs] = await Promise.all([
      this.pool.query('SELECT count(*)::int wallets, COALESCE(sum(earned),0)::bigint earned, COALESCE(sum(purchased),0)::bigint purchased FROM wallets'),
      this.pool.query(`SELECT count(*)::int claims, count(DISTINCT user_id)::int users FROM daily_rewards WHERE claimed_at > now() - interval '1 day'`),
      this.pool.query(`SELECT r.status, r.reason, r.created_at, a.public_id referee, a.display_name referee_name, b.public_id referrer
        FROM referrals r JOIN users a ON a.id=r.referee_id JOIN users b ON b.id=r.referrer_id ORDER BY (r.status='held') DESC, r.created_at DESC LIMIT 100`),
      this.pool.query(`SELECT l.actor, l.action, l.reason, l.details, l.created_at, u.public_id target FROM economy_admin_logs l LEFT JOIN users u ON u.id=l.target ORDER BY l.id DESC LIMIT 50`),
    ]);
    return {
      totals: { wallets: tot.rows[0].wallets, earned: Number(tot.rows[0].earned), purchased: Number(tot.rows[0].purchased) },
      daily24h: daily.rows[0],
      referrals: refs.rows.map((r) => ({ status: r.status, reason: r.reason, at: iso(r.created_at), referee: r.referee, refereeName: r.referee_name, referrer: r.referrer })),
      logs: logs.rows.map((l) => ({ actor: l.actor, action: l.action, reason: l.reason, details: l.details, at: iso(l.created_at), target: l.target })),
    };
  }
}
