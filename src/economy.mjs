/* SPONGE LIVE — «عملات الإسفنجة» (Sponge Coins): wallets, daily reward, invitations.
   The server is the only source of truth: every balance change runs in one database transaction with the
   wallet row locked, and every movement has a unique idempotency key (wallet_transactions UNIQUE), so a
   refresh, a second tab, a replayed request or a restart can never pay or charge twice.
   Time comes from PostgreSQL's clock (now()), never from the browser. */
import { createHash } from 'node:crypto';
import { tx } from './db.mjs';

export const DAILY_REWARD = 200;
export const DAILY_EVERY_HOURS = 24;
export const REFERRAL_REWARD = 50;
export const REFERRAL_CAP = 10;

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
