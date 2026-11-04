// SPONGE LIVE — accounts with a permanent ID, the 24-hour free trial, paid subscriptions and admin tools.
// Every rule that decides access (eligibility, expiry, payment status) is checked here, on the server,
// against PostgreSQL. The browser only displays what these functions return.
import { randomBytes, randomInt, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { tx } from './db.mjs';
import { generateCode, normalizeCode } from './promo.mjs';

export const PLANS = Object.freeze({
  trial:   { id: 'trial',   name: 'التجربة المجانية', priceHalalas: 0,    duration: '24 ساعة', hours: 24 },
  weekly:  { id: 'weekly',  name: 'شفيق العادي',      priceHalalas: 2900, duration: '7 أيام',  days: 7 },
  monthly: { id: 'monthly', name: 'أمير الهامور',     priceHalalas: 4499, duration: 'شهر واحد', months: 1 },
  manual:  { id: 'manual',  name: 'اشتراك من الإدارة', priceHalalas: 0 },
});
export const AVATARS = Object.freeze(['sponge', 'star', 'crab', 'squid', 'shell', 'fish', 'whale', 'jelly']);
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const HOUR = 3_600_000;
const TRIAL_MS = 24 * HOUR;
const VERIFY_TTL_MS = 48 * HOUR;
const TRIAL_CODE_TTL_MS = 30 * 24 * HOUR;
const TRIALS_PER_NETWORK_PER_DAY = 3; // a soft signal only; never treated as proof of identity
const COMMON_PASSWORDS = new Set(['12345678', '123456789', '1234567890', 'password', 'password1', 'qwerty123', '11111111', '00000000', 'abcd1234', 'sponge123', 'spongelive']);

export class PlatformError extends Error {
  constructor(message, status = 400, fields = null) { super(message); this.status = status; if (fields) this.fields = fields; }
}
const fail = (message, status, fields) => { throw new PlatformError(message, status, fields); };

export const newPublicId = () => 'SPG-' + Array.from({ length: 6 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('');
const newRoom = () => 'a' + Array.from({ length: 9 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('');
const sha = (v) => createHash('sha256').update(String(v)).digest('base64url');
/** Subscription vouchers: PREFIX-XXXX-XXXX-XXXX-XXXX, 16 random characters (80 bits) after the plan prefix. */
export const VOUCHER_PREFIX = Object.freeze({ weekly: 'SHFQ', monthly: 'AMIR' });
export function newVoucher(plan) {
  const body = Array.from({ length: 16 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('');
  return [VOUCHER_PREFIX[plan], body.slice(0, 4), body.slice(4, 8), body.slice(8, 12), body.slice(12)].join('-');
}
export const voucherHash = (plain) => 'v1:' + createHash('sha256').update(normalizeCode(plain)).digest('hex');

/** One mailbox = one account: lower-case, drop "+tag", and dots for Gmail. */
export function canonicalEmail(raw) {
  const email = String(raw ?? '').trim().toLowerCase();
  const at = email.lastIndexOf('@'); if (at < 1) return email;
  let local = email.slice(0, at), domain = email.slice(at + 1);
  local = local.split('+')[0];
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return local + '@' + domain;
}

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const scryptAsync = (pw, salt) => new Promise((res, rej) => scrypt(pw, salt, 64, SCRYPT, (e, k) => (e ? rej(e) : res(k))));
export async function hashPassword(pw) { const salt = randomBytes(16); const key = await scryptAsync(String(pw).normalize('NFKC'), salt); return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`; }
export async function checkPassword(pw, stored) {
  const [alg, , , , salt, key] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !key) { await scryptAsync('x', 'decoy-salt-16byt'); return false; }
  const expected = Buffer.from(key, 'base64');
  const got = await scryptAsync(String(pw).normalize('NFKC'), Buffer.from(salt, 'base64'));
  return got.length === expected.length && timingSafeEqual(got, expected);
}
const DECOY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

/** Sign-up checks. Messages are shown next to the field they belong to. */
export function validateSignup({ username, email, password, confirm } = {}) {
  const fields = {};
  const u = String(username ?? '').trim().toLowerCase();
  const e = String(email ?? '').trim();
  const p = String(password ?? '');
  if (!/^[a-z0-9_.]{3,24}$/.test(u)) fields.username = 'من 3 إلى 24 حرفًا إنجليزيًا صغيرًا أو رقمًا أو _ .';
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(e)) fields.email = 'أدخل بريدًا إلكترونيًا صحيحًا';
  if (p.length < 8 || p.length > 128) fields.password = 'كلمة المرور من 8 إلى 128 حرفًا';
  else if (!/[A-Za-z؀-ۿ]/.test(p) || !/\d/.test(p)) fields.password = 'استخدم حروفًا وأرقامًا معًا';
  else if (COMMON_PASSWORDS.has(p.toLowerCase()) || p.toLowerCase() === u) fields.password = 'كلمة المرور سهلة التخمين';
  if (confirm !== undefined && String(confirm) !== p) fields.confirm = 'كلمتا المرور غير متطابقتين';
  if (Object.keys(fields).length) fail('راجع الحقول المظللة', 400, fields);
  return { username: u, email: e, password: p };
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

export class Platform {
  /**
   * @param {object} o
   * @param {import('pg').Pool} o.pool
   * @param {(plain:string)=>string} o.hashCode   same salted hash as the promo store
   * @param {{send(m:object):Promise<object>, configured:boolean}} o.mail
   * @param {{createInvoice(o:object):Promise<object>, fetchInvoice(id:string):Promise<object>, configured:boolean, name:string}} o.gateway
   */
  constructor({ pool, hashCode, mail, gateway, appUrl = '', now = () => Date.now() }) {
    this.pool = pool; this.hashCode = hashCode; this.mail = mail; this.gateway = gateway; this.appUrl = appUrl.replace(/\/$/, ''); this.now = now;
    this.cache = new Map();   // user id → { user, subs, loadedAt }
    this.byRoom = new Map();  // room → user id
  }

  /* ------------------------------------------------------------ cache
     Studio checks run on every request, so each user's row and subscription periods are kept in memory.
     Every write below refreshes the cache; entries older than 30 s are also refreshed in the background. */
  async init() {
    const users = (await this.pool.query('SELECT * FROM users')).rows;
    const subs = (await this.pool.query("SELECT user_id, plan, starts_at, ends_at, status FROM subscriptions WHERE status='active' AND ends_at > now()")).rows;
    for (const u of users) this.store(u, subs.filter((s) => s.user_id === u.id));
  }
  store(u, subs) {
    const entry = { user: u, subs: subs.map((s) => ({ plan: s.plan, starts: +new Date(s.starts_at), ends: +new Date(s.ends_at), status: s.status })), loadedAt: this.now() };
    this.cache.set(u.id, entry); this.byRoom.set(u.room, u.id);
    return entry;
  }
  async refresh(userId, client = this.pool) {
    const u = (await client.query('SELECT * FROM users WHERE id=$1', [userId])).rows[0];
    if (!u) { const old = this.cache.get(userId); if (old) this.byRoom.delete(old.user.room); this.cache.delete(userId); return null; }
    const subs = (await client.query("SELECT plan, starts_at, ends_at, status FROM subscriptions WHERE user_id=$1 AND status='active' AND ends_at > now()", [userId])).rows;
    return this.store(u, subs);
  }
  cached(userId) {
    const e = this.cache.get(userId);
    if (e && this.now() - e.loadedAt > 30_000 && !e.refreshing) { e.refreshing = true; this.refresh(userId).catch(() => { e.refreshing = false; }); }
    return e || null;
  }
  userForRoom(room) { const id = this.byRoom.get(room); return id ? this.cached(id)?.user || null : null; }

  /** The access a user has right now. Expiry is a server-side time comparison; nothing in the browser can extend it. */
  entitlement(userId) {
    const e = this.cached(userId);
    if (!e || e.user.disabled_at) return { active: false, plan: null, endsAt: null };
    const t = this.now();
    const current = e.subs.filter((s) => s.status === 'active' && s.starts <= t && s.ends > t).sort((a, b) => b.ends - a.ends)[0];
    if (!current) return { active: false, plan: null, endsAt: null };
    // back-to-back periods (a renewal bought early) count as one stretch of access
    let endsAt = current.ends;
    for (const s of [...e.subs].sort((a, b) => a.starts - b.starts)) if (s.status === 'active' && s.starts <= endsAt && s.ends > endsAt) endsAt = s.ends;
    return { active: true, plan: current.plan, endsAt };
  }
  verified(userId) { return !!this.cached(userId)?.user.email_verified_at; }
  isAdmin(userId) { const u = this.cached(userId)?.user; return !!(u && u.is_admin && u.email_verified_at && !u.disabled_at); }

  publicUser(u) {
    return { publicId: u.public_id, username: u.username, displayName: u.display_name, email: u.email, avatar: u.avatar, room: u.room,
      verified: !!u.email_verified_at, isAdmin: !!u.is_admin, createdAt: iso(u.created_at) };
  }

  /* ----------------------------------------------------------- accounts */
  async register(input, { ip = '' } = {}) {
    const { username, email, password } = validateSignup(input);
    const canonical = canonicalEmail(email);
    const hash = await hashPassword(password);
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const u = (await this.pool.query(
          `INSERT INTO users (public_id, username, display_name, email, canonical_email, password_hash, room) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [newPublicId(), username, username, email, canonical, hash, newRoom()])).rows[0];
        this.store(u, []);
        await this.sendVerification(u.id).catch((err) => console.error('[mail] verification not sent:', err.message));
        return u;
      } catch (err) {
        if (err.code !== '23505') throw err;
        if (/username/.test(err.constraint || '')) fail('اسم المستخدم مستخدم بالفعل', 409, { username: 'اختر اسمًا آخر' });
        if (/email/.test(err.constraint || '')) fail('هذا البريد مسجل بالفعل — سجّل الدخول', 409, { email: 'البريد مسجل بالفعل' });
        // public_id or room collided with an existing one: generate new values and retry
      }
    }
    fail('تعذر إنشاء الحساب، حاول مرة أخرى', 500);
  }
  async login(identifier, password) {
    const id = String(identifier ?? '').trim().toLowerCase();
    const u = id ? (await this.pool.query('SELECT * FROM users WHERE lower(username)=$1 OR canonical_email=$2 LIMIT 1', [id, canonicalEmail(id)])).rows[0] : null;
    const ok = await checkPassword(password, u?.password_hash || DECOY_HASH); // same work whether or not the account exists
    if (!u || !ok) return null;
    if (u.disabled_at) fail('هذا الحساب موقوف. تواصل مع الدعم.', 403);
    await this.refresh(u.id);
    return u;
  }
  async sendVerification(userId) {
    const u = this.cached(userId)?.user || (await this.refresh(userId))?.user;
    if (!u || u.email_verified_at) return { sent: false, already: !!u };
    const token = randomBytes(32).toString('base64url');
    await this.pool.query('UPDATE email_tokens SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL', [userId, 'verify']);
    await this.pool.query('INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1,$2,$3,$4)', [sha(token), userId, 'verify', new Date(this.now() + VERIFY_TTL_MS)]);
    const link = `${this.appUrl}/verify?token=${token}`;
    const result = await this.mail.send({
      to: u.email, subject: 'تأكيد بريدك في SPONGE LIVE',
      text: `مرحبًا ${u.display_name}،\n\nلتأكيد بريدك وتفعيل حسابك (${u.public_id}) افتح الرابط التالي خلال 48 ساعة:\n${link}\n\nإذا لم تنشئ هذا الحساب فتجاهل الرسالة.`,
      html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8"><p>مرحبًا ${escapeHtml(u.display_name)}،</p><p>لتأكيد بريدك وتفعيل حسابك <b dir="ltr">${u.public_id}</b> اضغط الزر خلال 48 ساعة:</p><p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:#FFD62A;color:#0A1A3D;font-weight:bold;text-decoration:none">تأكيد البريد</a></p><p style="color:#666">إذا لم تنشئ هذا الحساب فتجاهل الرسالة.</p></div>`,
    });
    return { sent: !!result.sent, devLink: result.sent ? null : link };
  }
  async verifyEmail(token) {
    const row = (await this.pool.query('SELECT * FROM email_tokens WHERE token_hash=$1 AND purpose=$2', [sha(token), 'verify'])).rows[0];
    if (!row || row.used_at || new Date(row.expires_at).getTime() < this.now()) return null;
    await tx(this.pool, async (c) => {
      await c.query('UPDATE email_tokens SET used_at=now() WHERE token_hash=$1', [row.token_hash]);
      await c.query('UPDATE users SET email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1', [row.user_id]);
    });
    return (await this.refresh(row.user_id))?.user || null;
  }
  async updateProfile(userId, { displayName, avatar } = {}) {
    const sets = [], vals = [];
    if (displayName !== undefined) {
      const name = String(displayName).replace(/[\u0000-\u001f<>]/g, '').trim();
      if (name.length < 2 || name.length > 40) fail('الاسم من 2 إلى 40 حرفًا', 400, { displayName: 'من 2 إلى 40 حرفًا' });
      vals.push(name); sets.push('display_name=$' + vals.length);
    }
    if (avatar !== undefined) {
      if (!AVATARS.includes(avatar)) fail('الصورة غير متاحة', 400, { avatar: 'اختر من الصور المتاحة' });
      vals.push(avatar); sets.push('avatar=$' + vals.length);
    }
    if (!sets.length) fail('لا يوجد ما يُحدّث');
    vals.push(userId);
    await this.pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
    return (await this.refresh(userId)).user;
  }

  /* -------------------------------------------------------------- trial */
  async trialState(userId) {
    const used = (await this.pool.query('SELECT activated_at, ends_at FROM trial_activations WHERE user_id=$1', [userId])).rows[0];
    const code = (await this.pool.query("SELECT code_plain, expires_at, uses, active FROM promo_codes WHERE user_id=$1 AND kind='trial'", [userId])).rows[0];
    if (used) {
      const ends = +new Date(used.ends_at);
      return { status: ends > this.now() ? 'active' : 'expired', startedAt: iso(used.activated_at), endsAt: iso(used.ends_at), remainingMs: Math.max(0, ends - this.now()), code: null };
    }
    if (code && code.active && !code.uses && (!code.expires_at || +new Date(code.expires_at) > this.now())) return { status: 'ready', code: code.code_plain, codeExpiresAt: iso(code.expires_at) };
    return { status: 'available', code: null };
  }
  /** Step 1: an eligible, verified account gets its own single-use code (generated on the server). */
  async claimTrial(userId) {
    if (!this.verified(userId)) fail('أكّد بريدك الإلكتروني أولًا لتحصل على التجربة المجانية', 403);
    if ((await this.pool.query('SELECT 1 FROM trial_activations WHERE user_id=$1', [userId])).rowCount) fail('استخدمت التجربة المجانية من قبل — يمكنك الاشتراك في إحدى الباقات', 409);
    const existing = await this.trialState(userId);
    if (existing.status === 'ready') return existing;
    for (let attempt = 0; attempt < 5; attempt++) {
      const plain = generateCode(10);
      try {
        await this.pool.query(
          `INSERT INTO promo_codes (id, code_hash, hint, kind, label, level, max_uses, expires_at, user_id, code_plain, created_by)
           VALUES ($1,$2,$3,'trial','تجربة مجانية 24 ساعة','live',1,$4,$5,$6,'system')
           ON CONFLICT (user_id) WHERE kind='trial' DO UPDATE SET code_hash=EXCLUDED.code_hash, hint=EXCLUDED.hint, code_plain=EXCLUDED.code_plain, expires_at=EXCLUDED.expires_at, uses=0, active=true`,
          ['tc_' + randomBytes(6).toString('hex'), this.hashCode(plain), plain.slice(0, 2) + '•••' + plain.slice(-2), new Date(this.now() + TRIAL_CODE_TTL_MS), userId, plain]);
        return this.trialState(userId);
      } catch (err) { if (err.code !== '23505') throw err; }
    }
    fail('تعذر إنشاء الرمز، حاول مرة أخرى', 500);
  }
  /** Step 2: activation. The 24 hours start now. Runs in one transaction with the user row locked, so two clicks cannot start two trials. */
  async activateTrial(userId, { code = null, ip = '' } = {}) {
    if (!this.verified(userId)) fail('أكّد بريدك الإلكتروني أولًا', 403);
    const ipHash = ip ? sha('net:' + ip) : null;
    const result = await tx(this.pool, async (c) => {
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      if ((await c.query('SELECT 1 FROM trial_activations WHERE user_id=$1', [userId])).rowCount) fail('استخدمت التجربة المجانية من قبل — لا يمكن تفعيلها مرة ثانية', 409);
      const row = (await c.query("SELECT * FROM promo_codes WHERE user_id=$1 AND kind='trial' FOR UPDATE", [userId])).rows[0];
      if (!row || !row.active || row.uses >= 1 || (row.expires_at && +new Date(row.expires_at) <= this.now())) fail('احصل على رمز التجربة أولًا', 409);
      if (code !== null && this.hashCode(code) !== row.code_hash) fail('الرمز غير صحيح أو انتهت صلاحيته', 401);
      const t = this.now();
      if (this.entitlement(userId).active) fail('لديك اشتراك فعّال الآن — احتفظ بالتجربة لوقت لاحق', 409);
      if (ipHash) {
        const n = (await c.query("SELECT count(*)::int AS n FROM trial_activations WHERE ip_hash=$1 AND activated_at > now() - interval '24 hours'", [ipHash])).rows[0].n;
        if (n >= TRIALS_PER_NETWORK_PER_DAY) fail('فُعّلت تجارب كثيرة من هذه الشبكة اليوم. حاول لاحقًا أو تواصل مع الدعم.', 429);
      }
      const ends = new Date(t + TRIAL_MS);
      await c.query('INSERT INTO trial_activations (user_id, code_id, activated_at, ends_at, ip_hash) VALUES ($1,$2,$3,$4,$5)', [userId, row.id, new Date(t), ends, ipHash]);
      await c.query("INSERT INTO subscriptions (user_id, plan, price_halalas, starts_at, ends_at, source) VALUES ($1,'trial',0,$2,$3,'trial')", [userId, new Date(t), ends]);
      await c.query('UPDATE promo_codes SET uses=uses+1, last_used_at=now(), code_plain=NULL WHERE id=$1', [row.id]);
      return { startedAt: iso(t), endsAt: iso(ends) };
    });
    await this.refresh(userId);
    return result;
  }
  /** A code typed in the home page field: is it someone's trial code? */
  async findTrialCode(plain) {
    if (normalizeCode(plain).length < 6) return null;
    return (await this.pool.query("SELECT id, user_id FROM promo_codes WHERE code_hash=$1 AND kind='trial'", [this.hashCode(plain)])).rows[0] || null;
  }

  /* -------------------------------------------------- plan vouchers */
  async findVoucher(plain) {
    const n = normalizeCode(plain);
    if (!/^(SHFQ|AMIR)[A-Z0-9]{16}$/.test(n)) return null;
    return (await this.pool.query("SELECT id, plan, uses, active FROM promo_codes WHERE code_hash=$1 AND kind='plan'", [voucherHash(n)])).rows[0] || null;
  }
  /** One voucher → one plan period for the signed-in account, starting when its current access ends. */
  async redeemVoucher(userId, plain) {
    const n = normalizeCode(plain);
    const out = await tx(this.pool, async (c) => {
      const v = (await c.query("SELECT * FROM promo_codes WHERE code_hash=$1 AND kind='plan' FOR UPDATE", [voucherHash(n)])).rows[0];
      if (!v) fail('رمز الاشتراك غير صحيح', 401);
      if (!v.active) fail('هذا الرمز ملغى', 409);
      if (v.uses >= 1) fail('هذا الرمز مستخدم من قبل', 409);
      if (v.expires_at && +new Date(v.expires_at) <= this.now()) fail('انتهت صلاحية هذا الرمز', 409);
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      await this.refresh(userId, c);
      const { starts, ends } = this.periodFor(userId, v.plan);
      await c.query("INSERT INTO subscriptions (user_id, plan, price_halalas, starts_at, ends_at, source, voucher_id, note) VALUES ($1,$2,0,$3,$4,'voucher',$5,$6)",
        [userId, v.plan, starts, ends, v.id, 'رمز ' + v.hint]);
      await c.query('UPDATE promo_codes SET uses=1, user_id=$2, last_used_at=now() WHERE id=$1', [v.id, userId]);
      return { plan: v.plan, planName: PLANS[v.plan].name, startsAt: iso(starts), endsAt: iso(ends) };
    });
    await this.refresh(userId);
    return out;
  }
  async createVouchers(plan, count, { label = '', createdBy = 'owner' } = {}) {
    if (!VOUCHER_PREFIX[plan]) fail('الباقة غير معروفة');
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 500) fail('العدد من 1 إلى 500');
    const codes = [];
    await tx(this.pool, async (c) => {
      for (let i = 0; i < n; i++) {
        const code = newVoucher(plan);
        await c.query("INSERT INTO promo_codes (id, code_hash, hint, kind, label, plan, max_uses, created_by) VALUES ($1,$2,$3,'plan',$4,$5,1,$6)",
          ['pv_' + randomBytes(8).toString('hex'), voucherHash(code), code.slice(0, 4) + '…' + code.slice(-4), String(label).slice(0, 60), plan, createdBy]);
        codes.push(code);
      }
    });
    return codes;
  }
  async voucherStats() {
    return (await this.pool.query("SELECT plan, count(*)::int AS total, count(*) FILTER (WHERE uses>0)::int AS used, count(*) FILTER (WHERE NOT active)::int AS revoked FROM promo_codes WHERE kind='plan' GROUP BY plan")).rows;
  }
  async revokeVoucher(plain) {
    const r = await this.pool.query("UPDATE promo_codes SET active=false WHERE code_hash=$1 AND kind='plan' AND uses=0 RETURNING id", [voucherHash(plain)]);
    if (!r.rowCount) fail('الرمز غير موجود أو مستخدم', 404);
    return { revoked: 1 };
  }

  /* ---------------------------------------------------- subscriptions */
  /** Start of a new paid period: right after the current access ends, so buying early never loses days. */
  periodFor(userId, plan, from = null) {
    const ent = this.entitlement(userId);
    const start = from ?? (ent.active ? ent.endsAt : this.now());
    const d = new Date(start);
    if (PLANS[plan].months) { const day = d.getUTCDate(); d.setUTCMonth(d.getUTCMonth() + PLANS[plan].months); if (d.getUTCDate() !== day) d.setUTCDate(0); }
    else d.setTime(d.getTime() + PLANS[plan].days * 24 * HOUR);
    return { starts: new Date(start), ends: d };
  }
  async checkout(userId, planId) {
    const plan = PLANS[planId];
    if (!plan || !['weekly', 'monthly'].includes(planId)) fail('الباقة غير معروفة');
    if (!this.verified(userId)) fail('أكّد بريدك الإلكتروني أولًا', 403);
    if (!this.gateway.configured) fail('الدفع الإلكتروني غير مفعّل بعد. سيتاح قريبًا — يمكنك الآن تفعيل التجربة المجانية.', 503);
    const u = this.cached(userId).user;
    const pay = (await this.pool.query("INSERT INTO payments (user_id, plan, amount_halalas, provider) VALUES ($1,$2,$3,$4) RETURNING id", [userId, planId, plan.priceHalalas, this.gateway.name])).rows[0];
    let invoice;
    try {
      invoice = await this.gateway.createInvoice({
        amount: plan.priceHalalas, currency: 'SAR', description: `SPONGE LIVE — ${plan.name} (${plan.duration}) — ${u.public_id}`,
        callback_url: `${this.appUrl}/api/billing/webhook`, success_url: `${this.appUrl}/account?payment=${pay.id}`, back_url: `${this.appUrl}/account#plans`,
        metadata: { payment_id: pay.id, public_id: u.public_id, plan: planId },
      });
    } catch (err) {
      await this.pool.query("UPDATE payments SET status='failed', raw_status=$2, updated_at=now() WHERE id=$1", [pay.id, 'create_error']);
      console.error('[billing] invoice creation failed:', err.message);
      fail('تعذر إنشاء طلب الدفع الآن، حاول بعد قليل', 502);
    }
    await this.pool.query('UPDATE payments SET provider_ref=$2, checkout_url=$3, raw_status=$4, updated_at=now() WHERE id=$1', [pay.id, invoice.id, invoice.url, invoice.status]);
    return { paymentId: pay.id, url: invoice.url };
  }
  /**
   * Ask the payment provider (server to server) whether the invoice is paid; activate the subscription
   * only then. Safe to call any number of times, from the webhook or when the buyer comes back.
   */
  async confirmPayment({ paymentId = null, providerRef = null } = {}) {
    const p = (await this.pool.query('SELECT * FROM payments WHERE ' + (paymentId ? 'id=$1' : 'provider_ref=$1'), [paymentId || providerRef])).rows[0];
    if (!p) return { status: 'unknown' };
    if (p.status === 'paid') return { status: 'paid', userId: p.user_id, already: true };
    if (!p.provider_ref || !this.gateway.configured) return { status: p.status };
    const inv = await this.gateway.fetchInvoice(p.provider_ref);
    const paid = inv && inv.status === 'paid' && Number(inv.amount) === p.amount_halalas && String(inv.currency || '').toUpperCase() === p.currency && String(inv.id) === p.provider_ref;
    if (!paid) {
      const status = inv?.status === 'expired' ? 'expired' : inv?.status === 'failed' ? 'failed' : 'pending';
      if (status !== p.status || inv?.status !== p.raw_status) await this.pool.query('UPDATE payments SET status=$2, raw_status=$3, updated_at=now() WHERE id=$1 AND status<>$4', [p.id, status, String(inv?.status || ''), 'paid']);
      return { status };
    }
    const out = await tx(this.pool, async (c) => {
      const locked = (await c.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [p.id])).rows[0];
      if (locked.status === 'paid') return { status: 'paid', already: true };
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [p.user_id]);
      await this.refresh(p.user_id, c);
      const { starts, ends } = this.periodFor(p.user_id, p.plan);
      await c.query("UPDATE payments SET status='paid', verified_at=now(), raw_status='paid', updated_at=now() WHERE id=$1", [p.id]);
      await c.query("INSERT INTO subscriptions (user_id, plan, price_halalas, currency, starts_at, ends_at, source, payment_id) VALUES ($1,$2,$3,$4,$5,$6,'payment',$7)",
        [p.user_id, p.plan, p.amount_halalas, p.currency, starts, ends, p.id]);
      return { status: 'paid', startsAt: iso(starts), endsAt: iso(ends) };
    });
    await this.refresh(p.user_id);
    return { ...out, userId: p.user_id };
  }
  async paymentStatus(userId, paymentId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(paymentId))) fail('طلب غير صالح');
    const p = (await this.pool.query('SELECT id, user_id, status FROM payments WHERE id=$1', [paymentId])).rows[0];
    if (!p || p.user_id !== userId) fail('طلب الدفع غير موجود', 404);
    if (p.status === 'pending') { try { return { status: (await this.confirmPayment({ paymentId })).status }; } catch { return { status: 'pending' }; } }
    return { status: p.status };
  }

  /* --------------------------------------------------- linked streams */
  async linkAccount(userId, platform, handle, connected) {
    await this.pool.query(`INSERT INTO linked_accounts (user_id, platform, handle, last_connected_at) VALUES ($1,$2,$3,$4)
      ON CONFLICT (user_id, platform) DO UPDATE SET handle=EXCLUDED.handle, verified=false, last_connected_at=COALESCE(EXCLUDED.last_connected_at, CASE WHEN linked_accounts.handle=EXCLUDED.handle THEN linked_accounts.last_connected_at END)`,
    [userId, platform, String(handle).slice(0, 64), connected ? new Date(this.now()) : null]);
  }

  /* ------------------------------------------------------------ profile */
  async profile(userId) {
    const e = this.cached(userId) || await this.refresh(userId);
    if (!e) return null;
    const ent = this.entitlement(userId);
    const [subs, pays, links, trial] = await Promise.all([
      this.pool.query('SELECT id, plan, price_halalas, currency, starts_at, ends_at, status, source, created_at FROM subscriptions WHERE user_id=$1 ORDER BY starts_at DESC LIMIT 50', [userId]),
      this.pool.query('SELECT id, plan, amount_halalas, currency, status, created_at, verified_at FROM payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [userId]),
      this.pool.query('SELECT platform, handle, verified, last_connected_at FROM linked_accounts WHERE user_id=$1', [userId]),
      this.trialState(userId),
    ]);
    const t = this.now();
    return {
      user: this.publicUser(e.user),
      access: { ...ent, planName: ent.plan ? PLANS[ent.plan].name : null, endsAt: iso(ent.endsAt), remainingMs: ent.active ? ent.endsAt - t : 0 },
      trial,
      linked: Object.fromEntries(links.rows.map((l) => [l.platform, { handle: l.handle, verified: l.verified, lastConnectedAt: iso(l.last_connected_at) }])),
      history: subs.rows.map((s) => ({ id: s.id, plan: s.plan, planName: PLANS[s.plan]?.name || s.plan, price: s.price_halalas / 100, currency: s.currency, startsAt: iso(s.starts_at), endsAt: iso(s.ends_at), source: s.source,
        status: s.status === 'cancelled' ? 'cancelled' : +new Date(s.ends_at) <= t ? 'expired' : +new Date(s.starts_at) > t ? 'scheduled' : 'active' })),
      payments: pays.rows.map((p) => ({ id: p.id, plan: p.plan, amount: p.amount_halalas / 100, currency: p.currency, status: p.status, createdAt: iso(p.created_at) })),
      billing: { enabled: !!this.gateway.configured, provider: this.gateway.configured ? this.gateway.name : null },
      mail: { enabled: !!this.mail.configured },
    };
  }

  /* -------------------------------------------------------------- admin */
  async audit(actor, action, { target = null, details = {}, ip = '' } = {}) {
    await this.pool.query('INSERT INTO admin_audit_logs (actor, action, target_user_id, details, ip_hash) VALUES ($1,$2,$3,$4,$5)', [actor, action, target, details, ip ? sha('net:' + ip).slice(0, 16) : null]);
  }
  async searchUsers(q = '') {
    const s = String(q).trim().slice(0, 80);
    const rows = s
      ? (await this.pool.query(`SELECT * FROM users WHERE public_id=upper($1) OR lower(username) LIKE lower($2) OR canonical_email LIKE lower($2) ORDER BY created_at DESC LIMIT 50`, [s, '%' + s.replace(/[%_\\]/g, '\\$&') + '%'])).rows
      : (await this.pool.query('SELECT * FROM users ORDER BY created_at DESC LIMIT 50')).rows;
    for (const u of rows) if (!this.cache.has(u.id)) await this.refresh(u.id);
    return rows.map((u) => { const ent = this.entitlement(u.id); return { id: u.id, ...this.publicUser(u), disabled: !!u.disabled_at, access: { active: ent.active, plan: ent.plan, planName: ent.plan ? PLANS[ent.plan].name : null, endsAt: iso(ent.endsAt) } }; });
  }
  async userByPublicId(publicId) { return (await this.pool.query('SELECT id FROM users WHERE public_id=upper($1)', [String(publicId).trim()])).rows[0]?.id || null; }
  async adminUser(userId) { const p = await this.profile(userId); if (!p) fail('الحساب غير موجود', 404); delete p.trial.code; return { id: userId, ...p }; }
  async grant(userId, { days, plan = 'manual', note = '' } = {}) {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 366) fail('عدد الأيام من 1 إلى 366');
    if (!['manual', 'weekly', 'monthly'].includes(plan)) fail('الباقة غير معروفة');
    await tx(this.pool, async (c) => {
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      await this.refresh(userId, c);
      const ent = this.entitlement(userId);
      const start = ent.active ? ent.endsAt : this.now();
      await c.query("INSERT INTO subscriptions (user_id, plan, starts_at, ends_at, source, note) VALUES ($1,$2,$3,$4,'admin',$5)", [userId, plan, new Date(start), new Date(start + n * 24 * HOUR), String(note).slice(0, 200)]);
    });
    await this.refresh(userId);
    return this.entitlement(userId);
  }
  async extend(userId, { days } = {}) {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 366) fail('عدد الأيام من 1 إلى 366');
    const row = (await this.pool.query("SELECT id FROM subscriptions WHERE user_id=$1 AND status='active' AND ends_at > now() ORDER BY ends_at DESC LIMIT 1", [userId])).rows[0];
    if (!row) fail('لا يوجد اشتراك فعّال لتمديده — استخدم «منح اشتراك»', 409);
    await this.pool.query("UPDATE subscriptions SET ends_at = ends_at + make_interval(days => $2) WHERE id=$1", [row.id, n]);
    await this.refresh(userId);
    return this.entitlement(userId);
  }
  async stop(userId) {
    const r = await this.pool.query("UPDATE subscriptions SET status='cancelled' WHERE user_id=$1 AND status='active' AND ends_at > now()", [userId]);
    await this.refresh(userId);
    return { stopped: r.rowCount };
  }
  async setVerified(userId) { await this.pool.query('UPDATE users SET email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1', [userId]); await this.refresh(userId); }
  async setDisabled(userId, disabled) { await this.pool.query('UPDATE users SET disabled_at=$2 WHERE id=$1', [userId, disabled ? new Date() : null]); await this.refresh(userId); }
  async revokeTrialCode(userId) { const r = await this.pool.query("UPDATE promo_codes SET active=false WHERE user_id=$1 AND kind='trial' AND uses=0", [userId]); return { revoked: r.rowCount }; }
  async auditLog(limit = 100) {
    return (await this.pool.query(`SELECT l.id, l.actor, l.action, l.details, l.created_at, u.public_id AS target FROM admin_audit_logs l LEFT JOIN users u ON u.id=l.target_user_id ORDER BY l.id DESC LIMIT $1`, [Math.min(500, limit)])).rows
      .map((r) => ({ id: Number(r.id), actor: r.actor, action: r.action, target: r.target, details: r.details, at: iso(r.created_at) }));
  }
  async stats() {
    const r = (await this.pool.query(`SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM users WHERE email_verified_at IS NOT NULL)::int AS verified,
      (SELECT count(DISTINCT user_id) FROM subscriptions WHERE status='active' AND starts_at<=now() AND ends_at>now() AND plan<>'trial')::int AS paid,
      (SELECT count(*) FROM subscriptions WHERE status='active' AND starts_at<=now() AND ends_at>now() AND plan='trial')::int AS trials`)).rows[0];
    return r;
  }
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
