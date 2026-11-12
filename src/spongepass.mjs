/* سبونج لايف — «SpongePass»: a season pass of 50 tiers with a free track and a premium one.
   - Tiers come from the season's XP, counted by the server from the weekly statistics of real, listed game sessions
     (the same events and rules as the account's level, XP_RULES) — reloads and repeated requests add nothing.
   - Every reward is taken once: a claim inserts (user, season, tier, track) and only a new row grants anything, all in
     one transaction with the wallet row locked, so a double click, a second tab or a retried request cannot pay twice.
   - The premium track is bought once per season with Sponge Coins (purchased coins first, then earned ones, like a
     skin), or granted by the owner. Frames won here are ordinary frames (source «pass»): the player equips them and
     they show in every lobby list like any other frame. */
import { tx } from './db.mjs';
import { XP_RULES } from './platform.mjs';

export class PassError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const fail = (m, s) => { throw new PassError(m, s); };
const iso = (d) => (d ? new Date(d).toISOString() : null);

/** The SpongePass frames: drawn by CSS (public/frames.css, data-effect), no image to download. */
export const PASS_FRAMES = Object.freeze([
  { id: 'sp1_tide', name: 'المدّ', rarity: 'rare', effect: 'tide', sort: 200 },
  { id: 'sp1_bubble', name: 'فقاعات القاع', rarity: 'common', effect: 'bubble', sort: 201 },
  { id: 'sp1_abyss', name: 'الأعماق', rarity: 'epic', effect: 'abyss', sort: 202 },
  { id: 'sp1_sunken', name: 'كنز الغارقة', rarity: 'epic', effect: 'sunken', sort: 203 },
  { id: 'sp1_coral', name: 'المرجان', rarity: 'rare', effect: 'coral', sort: 204 },
  { id: 'sp1_kraken', name: 'الأخطبوط العملاق', rarity: 'legendary', effect: 'kraken', sort: 205 },
  { id: 'sp1_neon', name: 'إسفنجة النيون', rarity: 'legendary', effect: 'neon_sponge', sort: 206 },
  { id: 'sp1_pearl', name: 'اللؤلؤة', rarity: 'epic', effect: 'pearl', sort: 207 },
  { id: 'sp1_king', name: 'ملك الإسفنج', rarity: 'mythic', effect: 'sponge_king', sort: 208 },
]);
const FRAME_BY_ID = new Map(PASS_FRAMES.map((f) => [f.id, f]));

/** The season's badge (shown on the pass and on the profile). */
export const PASS_BADGES = Object.freeze({ s1: { id: 's1', name: 'SpongePass — الموسم 1' } });

/**
 * The reward of each tier, per track. Season 1: frames on the key tiers, free wheel spins, coins (earned coins) on the
 * others, the season badge at the end of the free track. Every premium tier has a reward.
 */
export function rewardsFor(seasonId, tiers = 50) {
  if (seasonId !== 's1') return [];
  const free = { 10: ['frame', 'sp1_bubble'], 25: ['frame', 'sp1_coral'], 45: ['frame', 'sp1_pearl'], 15: ['spins', '1'], 35: ['spins', '1'],
    5: ['coins', '50'], 20: ['coins', '75'], 30: ['coins', '75'], 40: ['coins', '100'], 50: ['badge', 's1'] };
  const premiumFrames = { 1: 'sp1_tide', 8: 'sp1_abyss', 16: 'sp1_sunken', 24: 'sp1_kraken', 32: 'sp1_neon', 50: 'sp1_king' };
  const out = [];
  for (let t = 1; t <= tiers; t++) {
    if (free[t]) out.push({ tier: t, track: 'free', kind: free[t][0], value: free[t][1] });
    const p = premiumFrames[t] ? ['frame', premiumFrames[t]] : t === 40 ? ['spins', '3'] : t % 4 === 0 ? ['spins', '1'] : ['coins', t < 25 ? '30' : '50'];
    out.push({ tier: t, track: 'premium', kind: p[0], value: p[1] });
  }
  return out;
}

/** What a page may know about one reward (names and frame looks, nothing secret). */
function publicReward(r) {
  const o = { tier: r.tier, track: r.track, kind: r.kind };
  if (r.kind === 'frame') { const f = FRAME_BY_ID.get(r.value); Object.assign(o, { frame: { id: f.id, name: f.name, rarity: f.rarity, effect: f.effect } }); }
  else if (r.kind === 'coins') o.amount = Number(r.value);
  else if (r.kind === 'spins') o.count = Number(r.value);
  else if (r.kind === 'badge') o.badge = PASS_BADGES[r.value] || { id: r.value, name: r.value };
  return o;
}

export class SpongePass {
  /** @param {{ pool: import('pg').Pool, economy: import('./economy.mjs').Economy, frames?: import('./frames.mjs').FrameStore }} o */
  constructor({ pool, economy, frames = null }) { this.pool = pool; this.economy = economy; this.frames = frames; this.seeded = null; }

  /** The pass frames exist in the frames table (once; an owner's later edits are kept). */
  seed() {
    if (!this.seeded) this.seeded = (async () => {
      for (const f of PASS_FRAMES) await this.pool.query(`INSERT INTO frames (id, name, rarity, access, effect, builtin, sort) VALUES ($1,$2,$3,'grant',$4,true,$5) ON CONFLICT (id) DO NOTHING`, [f.id, f.name, f.rarity, f.effect, f.sort]);
      if (this.frames) this.frames.cache = null;
    })().catch((err) => { this.seeded = null; throw err; });
    return this.seeded;
  }

  /** The running season, or the last one that ended (its rewards can still be claimed). */
  async season(c = this.pool) {
    const r = (await c.query(`SELECT *, now() AS server_now, (starts_at AT TIME ZONE 'Asia/Riyadh')::date AS week_from, (ends_at AT TIME ZONE 'Asia/Riyadh')::date AS week_to
      FROM pass_seasons WHERE starts_at <= now() ORDER BY starts_at DESC LIMIT 1`)).rows[0];
    return r || null;
  }

  /** The season's XP of one account, from the server's weekly statistics only (weeks inside the season). */
  async seasonXp(userId, s, c = this.pool) {
    const [pl, st] = await Promise.all([
      c.query(`SELECT COALESCE(sum(p.entries),0)::int entries, COALESCE(sum(p.wins),0)::int wins, COALESCE(sum(p.seconds),0)::int seconds
        FROM weekly_player_stats p JOIN linked_accounts la ON la.user_id = $1 AND la.verified AND la.platform = p.platform AND p.handle IS NOT NULL AND lower(la.handle) = p.handle
        WHERE p.week_start >= $2 AND p.week_start < $3`, [userId, s.week_from, s.week_to]),
      c.query(`SELECT COALESCE(sum(sessions),0)::int sessions, COALESCE(sum(minutes),0)::int minutes, COALESCE(sum(rounds),0)::int rounds
        FROM weekly_streamer_stats WHERE user_id=$1 AND week_start >= $2 AND week_start < $3`, [userId, s.week_from, s.week_to]),
    ]);
    const p = pl.rows[0], w = st.rows[0], R = XP_RULES;
    return p.entries * R.entry + p.wins * R.win + Math.floor(p.seconds / 60) * R.playMinute + w.sessions * R.session + w.minutes * R.streamMinute + w.rounds * R.streamRound;
  }

  /** Everything the pass page shows for one account. */
  async status(userId) {
    await this.seed();
    const s = await this.season();
    if (!s) return { season: null };
    const [xp, member, claims, wallet] = await Promise.all([
      this.seasonXp(userId, s),
      this.pool.query('SELECT source, created_at FROM pass_members WHERE user_id=$1 AND season_id=$2', [userId, s.id]),
      this.pool.query('SELECT tier, track FROM pass_claims WHERE user_id=$1 AND season_id=$2', [userId, s.id]),
      this.economy.wallet(userId),
    ]);
    const tier = Math.min(s.tiers, Math.floor(xp / s.xp_per_tier));
    const premium = !!member.rows[0];
    const taken = new Set(claims.rows.map((r) => r.tier + ':' + r.track));
    const rewards = rewardsFor(s.id, s.tiers).map((r) => {
      const claimed = taken.has(r.tier + ':' + r.track), reached = r.tier <= tier, locked = r.track === 'premium' && !premium;
      return { ...publicReward(r), claimed, claimable: reached && !claimed && !locked, reached, locked };
    });
    const ended = new Date(s.ends_at) <= new Date(s.server_now);
    return {
      season: { id: s.id, name: s.name, startsAt: iso(s.starts_at), endsAt: iso(s.ends_at), ended, tiers: s.tiers, xpPerTier: s.xp_per_tier, premiumPrice: s.premium_price },
      serverNow: iso(s.server_now),
      xp, tier, tierXp: tier >= s.tiers ? s.xp_per_tier : xp - tier * s.xp_per_tier, nextTierXp: s.xp_per_tier,
      premium, premiumSource: member.rows[0]?.source || null,
      claimable: rewards.filter((r) => r.claimable).length,
      rewards, rules: XP_RULES,
      wallet: { balance: wallet.balance, earned: wallet.earned, purchased: wallet.purchased, freeSpins: wallet.freeSpins ?? 0 },
      badges: await this.badges(userId),
    };
  }

  /** Grants one reward inside the open transaction; false when this reward was already taken. */
  async grant(c, userId, s, r) {
    const ins = await c.query(`INSERT INTO pass_claims (user_id, season_id, tier, track, kind, value) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING tier`,
      [userId, s.id, r.tier, r.track, r.kind, r.value]);
    if (!ins.rowCount) return false;
    const ref = `pass:${s.id}:${r.tier}:${r.track}`;
    if (r.kind === 'frame') await c.query(`INSERT INTO user_frames (user_id, frame_id, source) VALUES ($1,$2,'pass') ON CONFLICT DO NOTHING`, [userId, r.value]);
    else if (r.kind === 'coins') await this.economy.move(c, userId, { amount: Number(r.value), bucket: 'earned', kind: 'pass_reward', ref, note: `SpongePass — المستوى ${r.tier}` });
    else if (r.kind === 'spins') await c.query('UPDATE wallets SET free_spins = free_spins + $2, updated_at=now() WHERE user_id=$1', [userId, Number(r.value)]);
    // a badge is the claim itself (see badges())
    return true;
  }

  /** Takes one reward (tier + track), or every reward the account can take now (`all`). */
  async claim(userId, { tier = null, track = null, all = false } = {}) {
    await this.seed();
    const granted = await tx(this.pool, async (c) => {
      await this.economy.lock(c, userId); // one pass change of an account at a time
      const s = await this.season(c); if (!s) fail('لا يوجد موسم SpongePass حاليًا', 404);
      const xp = await this.seasonXp(userId, s, c);
      const reached = Math.min(s.tiers, Math.floor(xp / s.xp_per_tier));
      const premium = (await c.query('SELECT 1 FROM pass_members WHERE user_id=$1 AND season_id=$2', [userId, s.id])).rowCount > 0;
      const list = rewardsFor(s.id, s.tiers);
      let want;
      if (all) want = list.filter((r) => r.tier <= reached && (r.track === 'free' || premium));
      else {
        const t = Number(tier);
        const r = list.find((x) => x.tier === t && x.track === track);
        if (!r) fail('هذه المكافأة غير موجودة', 404);
        if (t > reached) fail(`تصل إلى المستوى ${t} بعد ${(t * s.xp_per_tier - xp)} نقطة خبرة`, 403);
        if (track === 'premium' && !premium) fail('مكافآت المسار المميز لأصحاب SpongePass المميز', 403);
        want = [r];
      }
      const out = [];
      for (const r of want) if (await this.grant(c, userId, s, r)) out.push(publicReward(r));
      return out;
    });
    return { granted, ...(await this.status(userId)) };
  }

  /** Buys the premium track of the running season (once), with purchased coins first, then earned ones. */
  async buyPremium(userId) {
    await tx(this.pool, async (c) => {
      const w = await this.economy.lock(c, userId);
      const s = await this.season(c); if (!s) fail('لا يوجد موسم SpongePass حاليًا', 404);
      if (new Date(s.ends_at) <= new Date(s.server_now)) fail('انتهى هذا الموسم — انتظر الموسم القادم', 409);
      if ((await c.query('SELECT 1 FROM pass_members WHERE user_id=$1 AND season_id=$2', [userId, s.id])).rowCount) fail('لديك SpongePass المميز لهذا الموسم بالفعل', 409);
      const price = Number(s.premium_price);
      const fromPurchased = Math.min(price, Number(w.purchased)), fromEarned = price - fromPurchased;
      if (fromEarned > Number(w.earned)) fail(`تحتاج ${price} عملة — رصيدك ${Number(w.earned) + Number(w.purchased)}`, 402);
      const ref = 'pass:' + s.id, note = 'SpongePass المميز — ' + s.name;
      if (fromPurchased) await this.economy.move(c, userId, { amount: -fromPurchased, bucket: 'purchased', kind: 'pass_buy', ref, note });
      if (fromEarned) await this.economy.move(c, userId, { amount: -fromEarned, bucket: 'earned', kind: 'pass_buy', ref, note });
      await c.query(`INSERT INTO pass_members (user_id, season_id, source, price) VALUES ($1,$2,'buy',$3)`, [userId, s.id, price]);
    });
    return this.status(userId);
  }

  /** Owner: gives (or takes back) the premium track of the running season. */
  async setPremium(userId, on, by) {
    const s = await this.season(); if (!s) fail('لا يوجد موسم SpongePass حاليًا', 404);
    if (on) await this.pool.query(`INSERT INTO pass_members (user_id, season_id, source, granted_by) VALUES ($1,$2,'grant',$3) ON CONFLICT DO NOTHING`, [userId, s.id, String(by || '').slice(0, 60)]);
    else {
      const r = (await this.pool.query('SELECT source FROM pass_members WHERE user_id=$1 AND season_id=$2', [userId, s.id])).rows[0];
      if (r?.source === 'buy') fail('اشتراه صاحب الحساب بعملاته — لا يُسحب', 409);
      await this.pool.query(`DELETE FROM pass_members WHERE user_id=$1 AND season_id=$2 AND source='grant'`, [userId, s.id]);
    }
    return { premium: !!on, season: s.id };
  }

  /** The season badges an account has won (public: shown on the profile). */
  async badges(userId) {
    const rows = (await this.pool.query(`SELECT value, claimed_at FROM pass_claims WHERE user_id=$1 AND kind='badge' ORDER BY claimed_at`, [userId])).rows;
    return rows.map((r) => ({ ...(PASS_BADGES[r.value] || { id: r.value, name: r.value }), at: iso(r.claimed_at) }));
  }

  /** Owner overview: members, claims and coins of the running season. */
  async adminOverview() {
    const s = await this.season(); if (!s) return { season: null };
    const [m, c] = await Promise.all([
      this.pool.query(`SELECT source, count(*)::int n, COALESCE(sum(price),0)::int coins FROM pass_members WHERE season_id=$1 GROUP BY source`, [s.id]),
      this.pool.query(`SELECT kind, count(*)::int n FROM pass_claims WHERE season_id=$1 GROUP BY kind`, [s.id]),
    ]);
    return { season: { id: s.id, name: s.name, startsAt: iso(s.starts_at), endsAt: iso(s.ends_at), premiumPrice: s.premium_price }, members: m.rows, claims: c.rows };
  }
}
