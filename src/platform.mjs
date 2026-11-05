// سبونج لايف — accounts with a permanent ID, the 24-hour free trial, paid subscriptions and admin tools.
// Every rule that decides access (eligibility, expiry, payment status) is checked here, on the server,
// against PostgreSQL. The browser only displays what these functions return.
import { SKIN_PACKS, SKIN_ANIMATIONS, SKIN_ANIMATION_LABELS, RARITIES, publicSkin, SkinCatalog } from './skins.mjs';
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
const TRIALS_PER_NETWORK_PER_DAY = 10; // a soft brake only (mobile networks share addresses); never treated as proof of identity
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
/** Password rules (same as sign-up). Returns an error message or ''. */
export function passwordProblem(p, username = '') {
  p = String(p ?? '');
  if (p.length < 8 || p.length > 128) return 'كلمة المرور من 8 إلى 128 حرفًا';
  if (!/[A-Za-z\u0600-\u06FF]/.test(p) || !/\d/.test(p)) return 'استخدم حروفًا وأرقامًا معًا';
  if (COMMON_PASSWORDS.has(p.toLowerCase()) || p.toLowerCase() === String(username).toLowerCase()) return 'كلمة المرور سهلة التخمين';
  return '';
}
/** Privacy switches stored per account; anything else in a request is ignored. */
export const PRIVACY_DEFAULTS = Object.freeze({ hideStream: false, playerStats: true, streamerStats: true, linkedAccounts: true, friendRequests: true, friendCount: true });
export const REPORT_REASONS = Object.freeze({ spam: 'إزعاج أو رسائل مزعجة', abuse: 'إساءة أو تنمّر', impersonation: 'انتحال شخصية', inappropriate: 'محتوى غير لائق', other: 'سبب آخر' });
const MAX_FRIENDS = 500, MAX_PENDING_OUT = 50;
export const privacyOf = (u) => ({ ...PRIVACY_DEFAULTS, ...Object.fromEntries(Object.entries(u?.privacy || {}).filter(([k, v]) => k in PRIVACY_DEFAULTS && typeof v === 'boolean')) });
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
const MIN_ROUND_MS = 15_000, MAX_ROUND_S = 3600;
/** XP for counted events only (editable here). A level needs 500 XP, then 250 more for each next level. */
export const XP_RULES = Object.freeze({ entry: 10, win: 40, playMinute: 1, session: 50, streamMinute: 2, streamRound: 5 });
export function levelFor(xp) {
  let level = 1, need = 500, floor = 0;
  while (xp >= floor + need && level < 200) { floor += need; level++; need = 500 + 250 * (level - 1); }
  return { level, levelXp: xp - floor, nextXp: need, pct: Math.min(100, Math.floor(((xp - floor) / need) * 100)) };
}
/** A partner photo the owner uploaded: PNG, JPEG or WebP (checked by its bytes), at most 400 KB. */
function parsePhoto(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(String(dataUrl || ''));
  if (!m) fail('الصورة يجب أن تكون PNG أو JPEG أو WebP');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 400_000) fail('حجم الصورة أكبر من 400 كيلوبايت');
  const type = buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
  if (type !== m[1]) fail('ملف الصورة غير صالح');
  return { buf, type };
}
/** Leaderboard columns (SQL over weekly_player_stats p / the streamer subquery). */
const PLAYER_METRICS = { wins: 'p.wins', entries: 'p.entries', hours: 'p.seconds' };
const STREAMER_METRICS = { hours: 'minutes', players: 'uniq', sessions: 'sessions', rounds: 'rounds' };
/** The leaderboard week: Sunday 00:00 to the next Sunday 00:00, Riyadh time (UTC+3, no daylight saving). */
export function weekOf(now) {
  const RIYADH = 3 * 3600_000, DAY = 86400_000;
  const local = new Date(now + RIYADH);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - local.getUTCDay() * DAY;
  return { start: new Date(startLocal).toISOString().slice(0, 10), endsAt: new Date(startLocal + 7 * DAY - RIYADH).toISOString() };
}

export class Platform {
  /**
   * @param {object} o
   * @param {import('pg').Pool} o.pool
   * @param {(plain:string)=>string} o.hashCode   same salted hash as the promo store
   * @param {{send(m:object):Promise<object>, configured:boolean}} o.mail
   * @param {{createInvoice(o:object):Promise<object>, fetchInvoice(id:string):Promise<object>, configured:boolean, name:string}} o.gateway
   */
  constructor({ pool, hashCode, mail, gateway, appUrl = '', now = () => Date.now(), minRoundMs = MIN_ROUND_MS }) {
    this.skinCatalog = new SkinCatalog(); this.catalogLoad = null;
    this.minRoundMs = minRoundMs;
    this.pool = pool; this.hashCode = hashCode; this.mail = mail; this.gateway = gateway; this.appUrl = appUrl.replace(/\/$/, ''); this.now = now;
    this.cache = new Map();   // user id → { user, subs, loadedAt }
    this.byRoom = new Map();  // room → user id
  }

  /* ------------------------------------------------------------ cache
     Studio checks run on every request, so each user's row and subscription periods are kept in memory.
     Every write below refreshes the cache; entries older than 30 s are also refreshed in the background. */
  /** The skins table, read once (and again after the owner edits it). Built-in skins work before that. */
  catalog(force = false) { if (force || !this.catalogLoad) this.catalogLoad = this.skinCatalog.load(this.pool).catch((err) => { this.catalogLoad = null; throw err; }); return this.catalogLoad; }
  async init() {
    await this.catalog();
    const users = (await this.pool.query('SELECT * FROM users')).rows;
    const subs = (await this.pool.query("SELECT user_id, plan, starts_at, ends_at, status FROM subscriptions WHERE status='active' AND ends_at > now()")).rows;
    const trials = new Map((await this.pool.query('SELECT user_id, activated_at, ends_at FROM trial_activations')).rows.map((t) => [t.user_id, t]));
    const had = new Set((await this.pool.query('SELECT DISTINCT user_id FROM subscriptions')).rows.map((r) => r.user_id));
    for (const u of users) this.store(u, subs.filter((s) => s.user_id === u.id), { trial: trials.get(u.id), hadAccess: had.has(u.id) });
  }
  store(u, subs, { trial = null, hadAccess = false } = {}) {
    const entry = { user: u, subs: subs.map((s) => ({ plan: s.plan, starts: +new Date(s.starts_at), ends: +new Date(s.ends_at), status: s.status })), loadedAt: this.now(),
      trial: trial ? { startedAt: +new Date(trial.activated_at), endsAt: +new Date(trial.ends_at) } : null, hadAccess: hadAccess || subs.length > 0 };
    this.cache.set(u.id, entry); this.byRoom.set(u.room, u.id);
    return entry;
  }
  async refresh(userId, client = this.pool) {
    const u = (await client.query('SELECT * FROM users WHERE id=$1', [userId])).rows[0];
    if (!u) { const old = this.cache.get(userId); if (old) this.byRoom.delete(old.user.room); this.cache.delete(userId); return null; }
    const subs = (await client.query("SELECT plan, starts_at, ends_at, status FROM subscriptions WHERE user_id=$1 AND status='active' AND ends_at > now()", [userId])).rows;
    const trial = (await client.query('SELECT activated_at, ends_at FROM trial_activations WHERE user_id=$1', [userId])).rows[0];
    const hadAccess = (await client.query('SELECT 1 FROM subscriptions WHERE user_id=$1 LIMIT 1', [userId])).rowCount > 0;
    return this.store(u, subs, { trial, hadAccess });
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
  /** Free-trial status from the server's records: available | active | expired. */
  trialStatus(userId) {
    const tr = this.cached(userId)?.trial;
    if (!tr) return { status: 'available' };
    return { status: tr.endsAt > this.now() ? 'active' : 'expired', startedAt: iso(tr.startedAt), endsAt: iso(tr.endsAt) };
  }
  /** Can this account start its trial right now? (one per account; e-mail proof when a mail service exists) */
  get trialNeedsVerifiedEmail() { return process.env.TRIAL_REQUIRE_VERIFIED_EMAIL ? process.env.TRIAL_REQUIRE_VERIFIED_EMAIL === '1' : !!this.mail.configured; }
  isAdmin(userId) { const u = this.cached(userId)?.user; return !!(u && u.is_admin && u.email_verified_at && !u.disabled_at); }

  publicUser(u) {
    return { publicId: u.public_id, username: u.username, displayName: u.display_name, email: u.email, avatar: u.avatar, room: u.room,
      verified: !!u.email_verified_at, isAdmin: !!u.is_admin, createdAt: iso(u.created_at), googleLinked: !!u.google_sub, picture: u.picture_url || null, lastLoginAt: iso(u.last_login_at), hasPassword: String(u.password_hash || '').startsWith('scrypt$') };
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
      to: u.email, subject: 'تأكيد بريدك في سبونج لايف',
      text: `مرحبًا ${u.display_name}،\n\nلتأكيد بريدك وتفعيل حسابك (${u.public_id}) افتح الرابط التالي خلال 48 ساعة:\n${link}\n\nإذا لم تنشئ هذا الحساب فتجاهل الرسالة.`,
      html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8"><p>مرحبًا ${escapeHtml(u.display_name)}،</p><p>لتأكيد بريدك وتفعيل حسابك <b dir="ltr">${u.public_id}</b> اضغط الزر خلال 48 ساعة:</p><p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:#FFD62A;color:#0A1A3D;font-weight:bold;text-decoration:none">تأكيد البريد</a></p><p style="color:#666">إذا لم تنشئ هذا الحساب فتجاهل الرسالة.</p></div>`,
    });
    return { sent: !!result.sent, devLink: result.sent ? null : link };
  }
  /** «نسيت كلمة المرور»: a one-time link (30 minutes). Sent by e-mail when a mail service exists; otherwise the
      site owner creates it from the owner panel and sends it to the person (by WhatsApp). */
  async createPasswordReset(userId) {
    const token = randomBytes(32).toString('base64url');
    await this.pool.query("UPDATE email_tokens SET used_at=now() WHERE user_id=$1 AND purpose='reset' AND used_at IS NULL", [userId]);
    await this.pool.query("INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1,$2,'reset',$3)", [sha(token), userId, new Date(this.now() + 30 * 60_000)]);
    return token;
  }
  async requestPasswordReset(identifier, base) {
    const id = String(identifier ?? '').trim().toLowerCase().slice(0, 254);
    const u = id ? (await this.pool.query('SELECT * FROM users WHERE lower(username)=$1 OR canonical_email=$2 LIMIT 1', [id, canonicalEmail(id)])).rows[0] : null;
    if (!u || u.disabled_at || !this.mail.configured) return { sent: false }; // the answer never says whether an account exists
    const link = `${(base || this.appUrl).replace(/\/$/, '')}/reset?token=${await this.createPasswordReset(u.id)}`;
    const r = await this.mail.send({ to: u.email, subject: 'إعادة تعيين كلمة المرور — سبونج لايف',
      text: `مرحبًا ${u.display_name}،\n\nلإعادة تعيين كلمة مرور حسابك (${u.public_id}) افتح الرابط خلال 30 دقيقة:\n${link}\n\nإذا لم تطلب ذلك فتجاهل الرسالة — كلمة مرورك لم تتغير.`,
      html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8"><p>مرحبًا ${escapeHtml(u.display_name)}،</p><p>لإعادة تعيين كلمة مرور حسابك <b dir="ltr">${u.public_id}</b> اضغط الزر خلال 30 دقيقة:</p><p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:#FFD62A;color:#0A1A3D;font-weight:bold;text-decoration:none">تعيين كلمة مرور جديدة</a></p><p style="color:#666">إذا لم تطلب ذلك فتجاهل الرسالة — كلمة مرورك لم تتغير.</p></div>` });
    return { sent: !!r.sent };
  }
  /** Uses the link once: sets the new password and returns the account (the caller signs out its other devices). */
  async resetPassword(token, password) {
    const row = (await this.pool.query("SELECT * FROM email_tokens WHERE token_hash=$1 AND purpose='reset'", [sha(String(token || ''))])).rows[0];
    if (!row || row.used_at || new Date(row.expires_at).getTime() < this.now()) fail('الرابط غير صالح أو انتهت صلاحيته — اطلب رابطًا جديدًا', 400);
    const me = (await this.refresh(row.user_id))?.user;
    if (!me || me.disabled_at) fail('تعذر التحقق من الحساب', 400);
    const problem = passwordProblem(password, me.username);
    if (problem) fail(problem, 400, { password: problem });
    const hash = await hashPassword(password);
    await tx(this.pool, async (c) => {
      const used = await c.query("UPDATE email_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL", [row.token_hash]);
      if (!used.rowCount) fail('الرابط استُخدم بالفعل', 400);
      await c.query('UPDATE users SET password_hash=$2 WHERE id=$1', [row.user_id, hash]);
    });
    await this.audit('system', 'password-reset', { target: row.user_id });
    return (await this.refresh(row.user_id)).user;
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
  /**
   * One click: start this account's 24-hour trial now. Safe against double clicks and parallel requests
   * (the user row is locked and trial_activations.user_id is the primary key). If the trial is already
   * running it is returned unchanged; an expired trial is never restarted.
   */
  async startTrial(userId, { ip = '' } = {}) {
    if (this.trialNeedsVerifiedEmail && !this.verified(userId)) fail('أكّد بريدك الإلكتروني أو سجّل الدخول باستخدام Google لتفعيل التجربة المجانية', 403);
    const ipHash = ip ? sha('net:' + ip) : null;
    const out = await tx(this.pool, async (c) => {
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const used = (await c.query('SELECT activated_at, ends_at FROM trial_activations WHERE user_id=$1', [userId])).rows[0];
      if (used) {
        if (+new Date(used.ends_at) > this.now()) return { started: false, already: true, startedAt: iso(used.activated_at), endsAt: iso(used.ends_at) };
        fail('انتهت تجربتك المجانية ولا يمكن تفعيلها مرة أخرى — اختر باقة للمتابعة', 409);
      }
      await this.refresh(userId, c);
      if (this.entitlement(userId).active) return { started: false, entitled: true };
      if (ipHash) {
        const limit = this.trialNeedsVerifiedEmail ? TRIALS_PER_NETWORK_PER_DAY : 5;
        const n = (await c.query("SELECT count(*)::int AS n FROM trial_activations WHERE ip_hash=$1 AND activated_at > now() - interval '24 hours'", [ipHash])).rows[0].n;
        if (n >= limit) fail('فُعّلت تجارب كثيرة من هذه الشبكة اليوم. حاول لاحقًا أو تواصل مع الدعم.', 429);
      }
      const t = this.now(), ends = new Date(t + TRIAL_MS);
      await c.query('INSERT INTO trial_activations (user_id, activated_at, ends_at, ip_hash) VALUES ($1,$2,$3,$4)', [userId, new Date(t), ends, ipHash]);
      await c.query("INSERT INTO subscriptions (user_id, plan, price_halalas, starts_at, ends_at, source) VALUES ($1,'trial',0,$2,$3,'trial')", [userId, new Date(t), ends]);
      await c.query("UPDATE promo_codes SET active=false, code_plain=NULL WHERE user_id=$1 AND kind='trial' AND uses=0", [userId]);
      return { started: true, startedAt: iso(t), endsAt: iso(ends) };
    });
    await this.refresh(userId);
    return out;
  }

  /** Record a successful sign-in (and refresh the Google picture when one was given). */
  async touchLogin(userId, { picture = null } = {}) {
    const pic = typeof picture === 'string' && /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//.test(picture) ? picture.slice(0, 500) : null;
    await this.pool.query('UPDATE users SET last_login_at=now(), picture_url=COALESCE($2, picture_url) WHERE id=$1', [userId, pic]);
    await this.refresh(userId);
  }

  /* ----------------------------------------------------- Google accounts */
  async findByGoogle(sub) { return (await this.pool.query('SELECT * FROM users WHERE google_sub=$1', [sub])).rows[0] || null; }
  async findByEmail(email) { return (await this.pool.query('SELECT id FROM users WHERE canonical_email=$1', [canonicalEmail(email)])).rows[0] || null; }
  /** New account from a verified Google identity. The permanent ID is created once, exactly as for e-mail sign-up. */
  async createFromGoogle(g) {
    if (!g.email) fail('حساب Google لا يشارك بريدًا إلكترونيًا', 400);
    const base = (canonicalEmail(g.email).split('@')[0].toLowerCase().replace(/[^a-z0-9_.]/g, '').replace(/^[._]+|[._]+$/g, '') || 'player').slice(0, 18).padEnd(3, '0');
    const name = (g.name || base).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40).padEnd(2, '.');
    for (let attempt = 0; attempt < 12; attempt++) {
      const username = attempt === 0 ? base : (base.slice(0, 18) + '_' + randomInt(100, 99999)).slice(0, 24);
      try {
        const u = (await this.pool.query(
          `INSERT INTO users (public_id, username, display_name, email, canonical_email, password_hash, room, google_sub, google_linked_at, email_verified_at)
           VALUES ($1,$2,$3,$4,$5,'!google',$6,$7,now(),$8) RETURNING *`,
          [newPublicId(), username, name, g.email, canonicalEmail(g.email), newRoom(), g.sub, g.emailVerified ? new Date(this.now()) : null])).rows[0];
        this.store(u, []);
        return u;
      } catch (err) {
        if (err.code !== '23505') throw err;
        if (/google_sub/.test(err.constraint || '')) return this.findByGoogle(g.sub); // created by a parallel request
        if (/email/.test(err.constraint || '')) fail('يوجد حساب بهذا البريد. سجّل الدخول بكلمة المرور ثم اربط Google من صفحة «حسابي».', 409, { needsLink: true });
      }
    }
    fail('تعذر إنشاء الحساب، حاول مرة أخرى', 500);
  }
  /** Google sign-in with no linked account: when Google has verified the e-mail and it is exactly the e-mail of an
   *  account not linked to any Google identity, that account is the one — Google is linked to it (same SPG ID and
   *  data). Returns { user, wasVerified } or null (no exact match, unverified at Google, or linked elsewhere). */
  async linkByExactEmail(g) {
    if (!g?.emailVerified || !g.email || !g.sub) return null;
    const email = String(g.email).trim().toLowerCase();
    const row = (await this.pool.query('SELECT id, email_verified_at FROM users WHERE lower(email)=$1 AND google_sub IS NULL', [email])).rows;
    if (row.length !== 1) return null;
    try {
      const r = await this.pool.query('UPDATE users SET google_sub=$2, google_linked_at=now(), email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1 AND google_sub IS NULL RETURNING id', [row[0].id, g.sub]);
      if (!r.rowCount) return null;
    } catch (err) {
      if (/google_sub/.test(err.constraint || '')) { const u = await this.findByGoogle(g.sub); return u ? { user: u, wasVerified: true } : null; }
      throw err;
    }
    return { user: (await this.refresh(row[0].id)).user, wasVerified: !!row[0].email_verified_at };
  }

  /** Link Google to the signed-in account (ownership of both is proven: the session and the Google token). */
  async linkGoogle(userId, g) {
    const owner = await this.findByGoogle(g.sub);
    if (owner && owner.id !== userId) fail('حساب Google هذا مرتبط بحساب سبونج لايف آخر', 409);
    const me = this.cached(userId)?.user || (await this.refresh(userId))?.user;
    if (me.google_sub && me.google_sub !== g.sub) fail('حسابك مرتبط بحساب Google آخر', 409);
    const sameMail = g.emailVerified && canonicalEmail(g.email) === me.canonical_email;
    await this.pool.query('UPDATE users SET google_sub=$2, google_linked_at=COALESCE(google_linked_at, now()), email_verified_at=CASE WHEN $3 THEN COALESCE(email_verified_at, now()) ELSE email_verified_at END WHERE id=$1', [userId, g.sub, sameMail]);
    return (await this.refresh(userId)).user;
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
        amount: plan.priceHalalas, currency: 'SAR', description: `سبونج لايف — ${plan.name} (${plan.duration}) — ${u.public_id}`,
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
  /** The platform account this user signed in with (null when none). Tokens stay sealed here. */
  async verifiedStream(userId, platform) {
    const r = (await this.pool.query('SELECT * FROM linked_accounts WHERE user_id=$1 AND platform=$2 AND verified', [userId, platform])).rows[0];
    return r ? { handle: r.handle, platformUserId: r.platform_user_id, displayName: r.display_name, avatar: r.avatar_url, verifiedAt: iso(r.verified_at),
      needsReauth: r.needs_reauth, accessTokenEnc: r.access_token_enc, refreshTokenEnc: r.refresh_token_enc,
      tokenExpiresAt: r.token_expires_at ? +r.token_expires_at : 0, refreshExpiresAt: r.refresh_expires_at ? +r.refresh_expires_at : 0 } : null;
  }
  /** Record an official sign-in with the platform. The same platform account (by its own id) belongs to one
      سبونج لايف account: a newer sign-in moves it, and the previous owner is returned so their room can be closed. */
  async saveOAuthLink(userId, platform, { platformUserId, handle, displayName, avatar, scope, accessTokenEnc, refreshTokenEnc, expiresAt, refreshExpiresAt }) {
    const pid = String(platformUserId || '');
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(pid)) fail('معرف حساب المنصة غير صالح');
    const h = String(handle || '').replace(/^@/, '').slice(0, 64);
    const pic = /^https:\/\//.test(String(avatar || '')) ? String(avatar).slice(0, 1000) : null;
    return tx(this.pool, async (c) => {
      const prev = (await c.query('SELECT user_id FROM linked_accounts WHERE platform=$1 AND verified AND user_id<>$3 AND (platform_user_id=$2 OR ($4<>\'\' AND lower(handle)=lower($4))) FOR UPDATE', [platform, pid, userId, h])).rows.map((r) => r.user_id);
      if (prev.length) await c.query('UPDATE linked_accounts SET verified=false, access_token_enc=NULL, refresh_token_enc=NULL WHERE platform=$1 AND user_id = ANY($2::uuid[])', [platform, prev]);
      await c.query(`INSERT INTO linked_accounts (user_id, platform, handle, verified, platform_user_id, verified_at, verify_method, display_name, avatar_url, scopes,
          access_token_enc, refresh_token_enc, token_expires_at, refresh_expires_at, needs_reauth)
        VALUES ($1,$2,$3,true,$4,now(),'oauth',$5,$6,$7,$8,$9,$10,$11,false)
        ON CONFLICT (user_id, platform) DO UPDATE SET handle=EXCLUDED.handle, verified=true, platform_user_id=EXCLUDED.platform_user_id, verified_at=now(),
          verify_method='oauth', display_name=EXCLUDED.display_name, avatar_url=EXCLUDED.avatar_url, scopes=EXCLUDED.scopes, access_token_enc=EXCLUDED.access_token_enc,
          refresh_token_enc=EXCLUDED.refresh_token_enc, token_expires_at=EXCLUDED.token_expires_at, refresh_expires_at=EXCLUDED.refresh_expires_at, needs_reauth=false`,
      [userId, platform, h || pid, pid, String(displayName || '').slice(0, 80) || null, pic, String(scope || '').slice(0, 200) || null, accessTokenEnc, refreshTokenEnc,
        expiresAt ? new Date(expiresAt) : null, refreshExpiresAt ? new Date(refreshExpiresAt) : null]);
      await c.query('INSERT INTO admin_audit_logs (actor, action, target_user_id, details) VALUES ($1,$2,$3,$4)',
        ['system', 'stream-oauth-link', userId, { platform, handle: h, platformUserId: pid, movedFrom: prev }]);
      return { previousOwners: prev };
    });
  }
  /** New tokens after a refresh, or a fresh profile (name, picture, username) read with the token. */
  async updateOAuthLink(userId, platform, { accessTokenEnc, refreshTokenEnc, expiresAt, refreshExpiresAt, handle, displayName, avatar, needsReauth } = {}) {
    const sets = [], vals = [userId, platform];
    const add = (col, v) => { vals.push(v); sets.push(col + '=$' + vals.length); };
    if (accessTokenEnc !== undefined) add('access_token_enc', accessTokenEnc);
    if (refreshTokenEnc !== undefined) add('refresh_token_enc', refreshTokenEnc);
    if (expiresAt !== undefined) add('token_expires_at', expiresAt ? new Date(expiresAt) : null);
    if (refreshExpiresAt !== undefined) add('refresh_expires_at', refreshExpiresAt ? new Date(refreshExpiresAt) : null);
    if (handle) add('handle', String(handle).replace(/^@/, '').slice(0, 64));
    if (displayName !== undefined) add('display_name', String(displayName || '').slice(0, 80) || null);
    if (avatar !== undefined) add('avatar_url', /^https:\/\//.test(String(avatar || '')) ? String(avatar).slice(0, 1000) : null);
    if (needsReauth !== undefined) add('needs_reauth', !!needsReauth);
    if (!sets.length) return;
    await this.pool.query('UPDATE linked_accounts SET ' + sets.join(', ') + ' WHERE user_id=$1 AND platform=$2 AND verified', vals);
  }
  async touchStream(userId, platform) {
    await this.pool.query('UPDATE linked_accounts SET last_connected_at=now(), last_live_at=now() WHERE user_id=$1 AND platform=$2 AND verified', [userId, platform]);
  }
  /** Server-kept live session row (one per host). */
  async saveLiveSession(userId, v) {
    await this.pool.query(`INSERT INTO live_sessions (user_id, room, game_session_id, platform, handle, platform_user_id, verified, subscription_active, state, listed, current_game, players, last_heartbeat_at, last_live_check_at, live_confirmed, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
      ON CONFLICT (user_id) DO UPDATE SET room=EXCLUDED.room, game_session_id=EXCLUDED.game_session_id, platform=EXCLUDED.platform, handle=EXCLUDED.handle,
        platform_user_id=EXCLUDED.platform_user_id, verified=EXCLUDED.verified, subscription_active=EXCLUDED.subscription_active, state=EXCLUDED.state, listed=EXCLUDED.listed,
        current_game=EXCLUDED.current_game, players=EXCLUDED.players, last_heartbeat_at=EXCLUDED.last_heartbeat_at, last_live_check_at=EXCLUDED.last_live_check_at,
        live_confirmed=EXCLUDED.live_confirmed, updated_at=now()`,
    [userId, v.room, v.gameSessionId || null, v.platform || null, v.handle || null, v.platformUserId || null, !!v.verified, !!v.subscriptionActive, v.state, !!v.listed,
      v.currentGame || null, Math.max(0, v.players | 0), v.lastHeartbeatAt ? new Date(v.lastHeartbeatAt) : null, v.lastLiveCheckAt ? new Date(v.lastLiveCheckAt) : null, !!v.liveConfirmed]);
  }

  /* ----------------------------------------------------------- settings */
  async setPrivacy(userId, key, value) {
    if (!(key in PRIVACY_DEFAULTS) || typeof value !== 'boolean') fail('إعداد غير معروف');
    await this.pool.query('UPDATE users SET privacy = privacy || jsonb_build_object($2::text, $3::boolean) WHERE id=$1', [userId, key, value]);
    return privacyOf((await this.refresh(userId)).user);
  }
  async checkUserPassword(userId, password) {
    const u = (await this.pool.query('SELECT password_hash FROM users WHERE id=$1', [userId])).rows[0];
    return checkPassword(String(password || ''), u?.password_hash || DECOY_HASH);
  }
  async setPassword(userId, password) {
    const me = this.cached(userId)?.user || (await this.refresh(userId)).user;
    const problem = passwordProblem(password, me.username);
    if (problem) fail(problem, 400, { password: problem });
    await this.pool.query('UPDATE users SET password_hash=$2 WHERE id=$1', [userId, await hashPassword(password)]);
    await this.audit('system', 'password-set', { target: userId });
    return (await this.refresh(userId)).user;
  }
  /** New address: unverified until its link is opened (when e-mail sending is configured). */
  async changeEmail(userId, email) {
    const e = String(email ?? '').trim();
    if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(e)) fail('أدخل بريدًا إلكترونيًا صحيحًا', 400, { email: 'أدخل بريدًا إلكترونيًا صحيحًا' });
    const canonical = canonicalEmail(e);
    const me = this.cached(userId)?.user || (await this.refresh(userId)).user;
    if (canonical === me.canonical_email) fail('هذا هو بريدك الحالي', 400, { email: 'هذا هو بريدك الحالي' });
    try { await this.pool.query('UPDATE users SET email=$2, canonical_email=$3, email_verified_at=NULL WHERE id=$1', [userId, e, canonical]); }
    catch (err) { if (err.code === '23505') fail('هذا البريد مستخدم في حساب آخر', 409, { email: 'هذا البريد مستخدم في حساب آخر' }); throw err; }
    await this.audit('system', 'email-change', { target: userId, details: { from: me.email.replace(/^(.).*(@.*)$/, '$1…$2'), to: e.replace(/^(.).*(@.*)$/, '$1…$2') } });
    await this.refresh(userId);
    return this.mail.configured ? this.sendVerification(userId) : { sent: false };
  }
  /** Google can be removed only when a password remains as a way in. */
  async unlinkGoogle(userId) {
    const me = (await this.refresh(userId)).user;
    if (!me.google_sub) fail('حسابك غير مرتبط بـ Google');
    if (!String(me.password_hash || '').startsWith('scrypt$')) fail('أضف كلمة مرور أولًا — لا يمكن إزالة آخر وسيلة لتسجيل الدخول', 409);
    await this.pool.query('UPDATE users SET google_sub=NULL, google_linked_at=NULL WHERE id=$1', [userId]);
    await this.audit('system', 'google-unlink', { target: userId });
    return (await this.refresh(userId)).user;
  }
  async unlinkStream(userId, platform) {
    if (!['tiktok', 'kick'].includes(platform)) fail('منصة غير معروفة');
    // the sealed tokens are returned once so the caller can revoke them at the platform; the row (and the tokens) are gone
    const r = await this.pool.query('DELETE FROM linked_accounts WHERE user_id=$1 AND platform=$2 RETURNING handle, access_token_enc', [userId, platform]);
    if (r.rowCount) await this.audit('system', 'stream-unlink', { target: userId, details: { platform, handle: r.rows[0].handle } });
    return { removed: r.rowCount > 0, accessTokenEnc: r.rows[0]?.access_token_enc || null };
  }
  /** Counted by the server when a verified, listed game session starts / ends. */
  async recordStreamSession(userId, mode) {
    await this.pool.query(`INSERT INTO streamer_stats (user_id, sessions, games, last_session_at) VALUES ($1, 1, jsonb_build_object($2::text, 1), now())
      ON CONFLICT (user_id) DO UPDATE SET sessions = streamer_stats.sessions + 1, last_session_at = now(),
        games = streamer_stats.games || jsonb_build_object($2::text, COALESCE((streamer_stats.games->>$2)::int, 0) + 1)`, [userId, String(mode).slice(0, 20)]);
  }
  async noteSessionLength(userId, minutes) {
    if (!(minutes > 0)) return;
    await this.pool.query('UPDATE streamer_stats SET longest_minutes = GREATEST(longest_minutes, $2) WHERE user_id=$1', [userId, Math.min(100000, minutes | 0)]);
  }
  async addStreamPlayers(userId, n) {
    if (!(n > 0)) return;
    await this.pool.query('UPDATE streamer_stats SET players_total = players_total + $2 WHERE user_id=$1', [userId, Math.min(100000, n | 0)]);
  }
  /* ------------------------------------------------------------ weekly leaderboard */
  /** One finished round in a real, listed session.
      Rules: a round shorter than 15 s counts for nobody; a player's time is the round's length (max 60 min),
      and time already counted for that player in a simultaneous round of another stream is not counted again —
      a fully overlapping round gives no entry and no win either. */
  async recordGameResult({ platform, winnerId = null, participants = [], startedAt = null, endedAt = null, streamerId = null }) {
    if (!['tiktok', 'kick'].includes(platform) || !participants.length) return { counted: false };
    const end = Number(endedAt) || this.now(), start = Number(startedAt) || end - 60_000;
    if (end - start < this.minRoundMs) return { counted: false, reason: 'short' };
    const week = weekOf(this.now()).start;
    const list = participants.slice(0, 500).map((p) => ({
      id: String(p.id).slice(0, 80), name: String(p.name || 'مشاهد').slice(0, 40),
      avatar: /^https:\/\//.test(p.avatar || '') ? String(p.avatar).slice(0, 500) : null,
      handle: /^[A-Za-z0-9_.]{1,40}$/.test(String(p.handle || '').replace(/^@/, '')) ? String(p.handle).replace(/^@/, '').toLowerCase() : null,
    }));
    // seconds of this round not yet counted for the player (another stream may have covered part of it)
    const fresh = `LEAST(${MAX_ROUND_S}, GREATEST(0, EXTRACT(EPOCH FROM (to_timestamp($6::bigint / 1000.0) - GREATEST(to_timestamp($5::bigint / 1000.0), COALESCE(weekly_player_stats.last_until, '-infinity'::timestamptz))))))::int`;
    await this.pool.query(`INSERT INTO weekly_player_stats (week_start, platform, player_id, name, avatar, handle, wins, entries, seconds, last_until)
      SELECT $1::date, $2, x.id, x.name, x.avatar, x.handle, CASE WHEN x.id = $3 THEN 1 ELSE 0 END, 1, LEAST(${MAX_ROUND_S}, ($6::bigint - $5::bigint) / 1000)::int, to_timestamp($6::bigint / 1000.0)
        FROM jsonb_to_recordset($4::jsonb) AS x(id text, name text, avatar text, handle text)
      ON CONFLICT (week_start, platform, player_id) DO UPDATE SET
        wins = weekly_player_stats.wins + CASE WHEN ${fresh} > 0 THEN EXCLUDED.wins ELSE 0 END,
        entries = weekly_player_stats.entries + CASE WHEN ${fresh} > 0 THEN 1 ELSE 0 END,
        seconds = weekly_player_stats.seconds + ${fresh},
        last_until = GREATEST(COALESCE(weekly_player_stats.last_until, EXCLUDED.last_until), EXCLUDED.last_until),
        name = EXCLUDED.name, avatar = COALESCE(EXCLUDED.avatar, weekly_player_stats.avatar), handle = COALESCE(EXCLUDED.handle, weekly_player_stats.handle), updated_at = now()`,
    [week, platform, winnerId == null ? null : String(winnerId), JSON.stringify(list), start, end]);
    if (streamerId) {
      await this.pool.query(`INSERT INTO weekly_streamer_stats (week_start, user_id, rounds) VALUES ($1, $2, 1)
        ON CONFLICT (week_start, user_id) DO UPDATE SET rounds = weekly_streamer_stats.rounds + 1`, [week, streamerId]);
      await this.pool.query(`INSERT INTO weekly_streamer_players (week_start, user_id, platform, player_id)
        SELECT $1, $2, $3, x.id FROM jsonb_to_recordset($4::jsonb) AS x(id text) ON CONFLICT DO NOTHING`, [week, streamerId, platform, JSON.stringify(list)]);
    }
    return { counted: true };
  }
  /** Streamer side of the week: a session started, players reached, minutes played (all counted by the server). */
  async addWeeklyStreamer(userId, { sessions = 0, players = 0, minutes = 0 }) {
    if (!(sessions > 0 || players > 0 || minutes > 0)) return;
    await this.pool.query(`INSERT INTO weekly_streamer_stats (week_start, user_id, sessions, players, minutes) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (week_start, user_id) DO UPDATE SET sessions = weekly_streamer_stats.sessions + $3,
        players = weekly_streamer_stats.players + $4, minutes = weekly_streamer_stats.minutes + $5`,
    [weekOf(this.now()).start, userId, sessions | 0, Math.min(100000, players | 0), Math.min(10080, minutes | 0)]);
  }
  /** Top five of a week. Accounts that hid their statistics are left out; a player shows an SPG ID only when
      their platform account is linked to a سبونج لايف account that allows it. */
  async leaderboard(board, metric, { week = weekOf(this.now()).start } = {}) {
    const w = weekOf(this.now());
    const out = { board: board === 'streamers' ? 'streamers' : 'players', weekStart: week, endsAt: w.endsAt, current: week === w.start };
    if (out.board === 'players') {
      const col = PLAYER_METRICS[metric] ? metric : 'wins';
      out.metric = col;
      const order = { wins: 'p.wins DESC, p.entries DESC', entries: 'p.entries DESC, p.wins DESC', hours: 'p.seconds DESC, p.entries DESC' }[col];
      const rows = (await this.pool.query(`SELECT p.platform, p.name, p.avatar, p.handle, p.wins, p.entries, p.seconds, u.public_id, u.picture_url
        FROM weekly_player_stats p
        LEFT JOIN linked_accounts la ON la.verified AND la.platform = p.platform AND p.handle IS NOT NULL AND lower(la.handle) = p.handle
        LEFT JOIN users u ON u.id = la.user_id AND u.disabled_at IS NULL AND COALESCE((u.privacy->>'playerStats')::boolean, true)
        WHERE p.week_start=$1 AND ${PLAYER_METRICS[col]} > 0 ORDER BY ${order}, p.updated_at ASC LIMIT 5`, [week])).rows;
      out.rows = rows.map((r, i) => ({ rank: i + 1, platform: r.platform, name: r.name, avatar: r.avatar, handle: r.handle, publicId: r.public_id || null,
        wins: r.wins, entries: r.entries, hours: Math.round(r.seconds / 360) / 10 }));
    } else {
      const col = STREAMER_METRICS[metric] ? metric : 'hours';
      out.metric = col;
      const rows = (await this.pool.query(`SELECT * FROM (SELECT u.public_id, u.display_name, u.avatar, u.picture_url, s.sessions, s.minutes, s.rounds,
          (SELECT count(*)::int FROM weekly_streamer_players x WHERE x.week_start = s.week_start AND x.user_id = s.user_id) AS uniq,
          (SELECT la.handle FROM linked_accounts la WHERE la.user_id = u.id AND la.verified ORDER BY la.platform LIMIT 1) AS handle
        FROM weekly_streamer_stats s JOIN users u ON u.id = s.user_id
        WHERE s.week_start=$1 AND u.disabled_at IS NULL AND COALESCE((u.privacy->>'streamerStats')::boolean, true)) t
        WHERE ${STREAMER_METRICS[col]} > 0 ORDER BY ${STREAMER_METRICS[col]} DESC, sessions DESC LIMIT 5`, [week])).rows;
      out.rows = rows.map((r, i) => ({ rank: i + 1, publicId: r.public_id, name: r.display_name, avatar: r.avatar, picture: r.picture_url || null, handle: r.handle || null,
        sessions: r.sessions, players: r.uniq, rounds: r.rounds, hours: Math.round(r.minutes / 6) / 10 }));
    }
    out.prizes = await this.prizesFor(out.board, out.metric, week);
    return out;
  }
  /** Where one account (by SPG ID) stands this week, as a streamer and — through its linked platform accounts — as a player. */
  async leaderboardFind(publicId, metric, board = 'streamers') {
    const w = weekOf(this.now()).start;
    const u = (await this.pool.query(`SELECT id, public_id, display_name, avatar, picture_url, privacy FROM users WHERE public_id = upper($1) AND disabled_at IS NULL`, [String(publicId || '').slice(0, 12)])).rows[0];
    if (!u) return null;
    const pv = privacyOf(u);
    const base = { publicId: u.public_id, name: u.display_name, avatar: u.avatar, picture: u.picture_url || null };
    if (board === 'players') {
      if (!pv.playerStats) return null;
      const col = PLAYER_METRICS[metric] ? metric : 'wins', expr = PLAYER_METRICS[col];
      const r = (await this.pool.query(`WITH mine AS (
          SELECT p.* FROM weekly_player_stats p JOIN linked_accounts la ON la.verified AND la.user_id = $2 AND la.platform = p.platform AND lower(la.handle) = p.handle
          WHERE p.week_start = $1)
        SELECT COALESCE(sum(wins),0)::int wins, COALESCE(sum(entries),0)::int entries, COALESCE(sum(seconds),0)::int seconds,
          (SELECT count(*) FROM weekly_player_stats o WHERE o.week_start = $1 AND ${expr.replace(/p\./g, 'o.')} > (SELECT COALESCE(max(${expr}),0) FROM mine p))::int + 1 AS rank,
          (SELECT COALESCE(max(${expr}),0) FROM mine p) AS best FROM mine`, [w, u.id])).rows[0];
      return { ...base, kind: 'player', rank: r.best > 0 ? r.rank : null, wins: r.wins, entries: r.entries, hours: Math.round(r.seconds / 360) / 10 };
    }
    if (!pv.streamerStats) return null;
    const col = STREAMER_METRICS[metric] ? metric : 'hours', expr = STREAMER_METRICS[col];
    const all = (await this.pool.query(`SELECT user_id, sessions, minutes, rounds,
        (SELECT count(*)::int FROM weekly_streamer_players x WHERE x.week_start = s.week_start AND x.user_id = s.user_id) AS uniq
      FROM weekly_streamer_stats s JOIN users ou ON ou.id = s.user_id WHERE s.week_start = $1 AND COALESCE((ou.privacy->>'streamerStats')::boolean, true)`, [w])).rows;
    const val = (r) => ({ hours: r.minutes, players: r.uniq, sessions: r.sessions, rounds: r.rounds }[col]);
    const mine = all.find((r) => r.user_id === u.id);
    const rank = mine && val(mine) > 0 ? all.filter((r) => val(r) > val(mine)).length + 1 : null;
    void expr;
    return { ...base, kind: 'streamer', rank, sessions: mine?.sessions || 0, players: mine?.uniq || 0, rounds: mine?.rounds || 0, hours: Math.round((mine?.minutes || 0) / 6) / 10 };
  }
  /* ---- prizes: shown only when the owner has announced real ones ---- */
  async prizesFor(board, metric, week) {
    return (await this.pool.query(`SELECT id, rank_from, rank_to, title, conditions FROM leaderboard_prizes
      WHERE active AND board = $1 AND metric = $2 AND starts_on <= $3 AND (ends_on IS NULL OR ends_on >= $3) ORDER BY rank_from`, [board, metric, week])).rows
      .map((r) => ({ id: r.id, rankFrom: r.rank_from, rankTo: r.rank_to, title: r.title, conditions: r.conditions }));
  }
  async listPrizes() {
    const prizes = (await this.pool.query('SELECT *, starts_on::text AS starts, ends_on::text AS ends FROM leaderboard_prizes ORDER BY active DESC, starts_on DESC, id DESC LIMIT 100')).rows;
    const awards = (await this.pool.query('SELECT a.*, a.week_start::text AS week, p.title FROM leaderboard_awards a JOIN leaderboard_prizes p ON p.id = a.prize_id ORDER BY a.week_start DESC, a.rank LIMIT 200')).rows;
    return { prizes: prizes.map((p) => ({ id: p.id, board: p.board, metric: p.metric, rankFrom: p.rank_from, rankTo: p.rank_to, title: p.title, conditions: p.conditions, startsOn: p.starts, endsOn: p.ends || null, active: p.active })),
      awards: awards.map((a) => ({ id: a.id, weekStart: a.week, title: a.title, rank: a.rank, winner: a.winner, status: a.status })) };
  }
  async savePrize(input = {}) {
    const board = input.board === 'streamers' ? 'streamers' : 'players';
    const metric = (board === 'players' ? PLAYER_METRICS : STREAMER_METRICS)[input.metric] ? input.metric : fail('اختر نوع الترتيب');
    const from = Number(input.rankFrom), to = Number(input.rankTo ?? input.rankFrom);
    if (!(from >= 1 && from <= 5 && to >= from && to <= 5)) fail('المراكز من 1 إلى 5');
    const title = String(input.title || '').trim().slice(0, 80); if (!title) fail('اكتب الجائزة');
    const starts = /^\d{4}-\d{2}-\d{2}$/.test(input.startsOn || '') ? input.startsOn : weekOf(this.now()).start;
    const ends = /^\d{4}-\d{2}-\d{2}$/.test(input.endsOn || '') ? input.endsOn : null;
    const vals = [board, metric, from, to, title, String(input.conditions || '').trim().slice(0, 300), starts, ends, input.active !== false];
    if (input.id) await this.pool.query('UPDATE leaderboard_prizes SET board=$1, metric=$2, rank_from=$3, rank_to=$4, title=$5, conditions=$6, starts_on=$7, ends_on=$8, active=$9 WHERE id=$10', [...vals, Number(input.id)]);
    else await this.pool.query('INSERT INTO leaderboard_prizes (board, metric, rank_from, rank_to, title, conditions, starts_on, ends_on, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', vals);
    await this.audit('system', 'prize-save', { details: { title } });
    return this.listPrizes();
  }
  async setAwardStatus(id, status) {
    if (!['pending', 'delivered', 'void'].includes(status)) fail('حالة غير صالحة');
    await this.pool.query('UPDATE leaderboard_awards SET status=$2, updated_at=now() WHERE id=$1', [Number(id), status]);
    return this.listPrizes();
  }
  /** When a week ends: freeze its top five per board and metric, and record who won the announced prizes. Idempotent. */
  async closeWeeks() {
    const current = weekOf(this.now()).start;
    const weeks = (await this.pool.query(`SELECT DISTINCT week_start::text AS week FROM (SELECT week_start FROM weekly_player_stats UNION SELECT week_start FROM weekly_streamer_stats) w
      WHERE week_start < $1 AND NOT EXISTS (SELECT 1 FROM leaderboard_archive a WHERE a.week_start = w.week_start) ORDER BY 1 LIMIT 8`, [current])).rows;
    for (const { week } of weeks) {
      for (const [board, metrics] of [['players', PLAYER_METRICS], ['streamers', STREAMER_METRICS]]) for (const metric of Object.keys(metrics)) {
        const lb = await this.leaderboard(board, metric, { week });
        await this.pool.query('INSERT INTO leaderboard_archive (week_start, board, metric, rows) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [week, board, metric, JSON.stringify(lb.rows)]);
        for (const prize of lb.prizes) for (const row of lb.rows.filter((r) => r.rank >= prize.rankFrom && r.rank <= prize.rankTo)) {
          await this.pool.query('INSERT INTO leaderboard_awards (week_start, prize_id, rank, winner) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
            [week, prize.id, row.rank, JSON.stringify({ name: row.name, publicId: row.publicId || null, handle: row.handle || null, platform: row.platform || null })]);
        }
      }
    }
    return weeks.length;
  }
  /** A closed week as it was frozen (or computed, if it was never archived). */
  async archivedBoard(week, board, metric) {
    const r = (await this.pool.query('SELECT rows FROM leaderboard_archive WHERE week_start=$1 AND board=$2 AND metric=$3', [week, board, metric])).rows[0];
    if (!r) return this.leaderboard(board, metric, { week });
    return { board, metric, weekStart: week, current: false, archived: true, rows: r.rows, prizes: await this.prizesFor(board, metric, week) };
  }

  /* ------------------------------------------------------------ «شركاء النجاح» */
  async partners({ all = false } = {}) {
    const rows = (await this.pool.query(`SELECT id, name, handle, platform, description, photo IS NOT NULL AS has_photo, photo_v, sort, active, official, user_id
      FROM partners ${all ? '' : 'WHERE active'} ORDER BY sort, id LIMIT 60`)).rows;
    return rows.map((p) => ({ id: p.id, name: p.name, handle: p.handle, platform: p.platform, description: p.description, official: p.official,
      url: p.platform === 'kick' ? 'https://kick.com/' + p.handle : 'https://www.tiktok.com/@' + p.handle,
      photo: p.has_photo ? '/api/partners/' + p.id + '/photo?v=' + p.photo_v : null, ...(all ? { sort: p.sort, active: p.active, linked: !!p.user_id } : {}) }));
  }
  async savePartner(input = {}) {
    const name = String(input.name || '').trim().slice(0, 40); if (!name) fail('اكتب اسم الشريك');
    const handle = String(input.handle || '').trim().replace(/^@/, ''); if (!/^[A-Za-z0-9_.]{1,40}$/.test(handle)) fail('اسم الحساب غير صالح');
    const platform = input.platform === 'kick' ? 'kick' : 'tiktok';
    const description = String(input.description || '').trim().slice(0, 120);
    const sort = Number.isInteger(Number(input.sort)) ? Number(input.sort) : 0;
    // «شريك رسمي» only for a partner whose platform account is linked (officially signed in) to a سبونج لايف account
    const owner = (await this.pool.query('SELECT user_id FROM linked_accounts WHERE verified AND platform=$1 AND lower(handle)=lower($2)', [platform, handle])).rows[0]?.user_id || null;
    if (input.official && !owner) fail('شارة «شريك رسمي» تحتاج أن يربط الشريك حسابه على المنصة رسميًا بحساب سبونج لايف');
    const photo = input.photo ? parsePhoto(input.photo) : null; // checked before anything is written
    const vals = [name, handle, platform, description, sort, input.active !== false, !!input.official && !!owner, owner];
    let id = Number(input.id) || null;
    if (id) await this.pool.query('UPDATE partners SET name=$1, handle=$2, platform=$3, description=$4, sort=$5, active=$6, official=$7, user_id=$8, updated_at=now() WHERE id=$9', [...vals, id]);
    else id = (await this.pool.query('INSERT INTO partners (name, handle, platform, description, sort, active, official, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', vals)).rows[0].id;
    if (photo) await this.pool.query('UPDATE partners SET photo=$2, photo_type=$3, photo_v=photo_v+1, updated_at=now() WHERE id=$1', [id, photo.buf, photo.type]);
    await this.audit('system', 'partner-save', { details: { id, name } });
    return this.partners({ all: true });
  }
  async partnerPhoto(id) {
    const r = (await this.pool.query('SELECT photo, photo_type FROM partners WHERE id=$1 AND active AND photo IS NOT NULL', [Number(id) || 0])).rows[0];
    return r ? { data: r.photo, type: r.photo_type } : null;
  }
  async deletePartner(id) { await this.pool.query('DELETE FROM partners WHERE id=$1', [Number(id)]); await this.audit('system', 'partner-delete', { details: { id } }); return this.partners({ all: true }); }
  async streamerStats(userId) {
    const r = (await this.pool.query('SELECT sessions, players_total, games, last_session_at FROM streamer_stats WHERE user_id=$1', [userId])).rows[0];
    return r ? { sessions: r.sessions, playersTotal: r.players_total, games: r.games, lastSessionAt: iso(r.last_session_at) } : { sessions: 0, playersTotal: 0, games: {}, lastSessionAt: null };
  }
  /** What anyone may see about an account: the privacy switches decide, here on the server. */
  async publicProfile(publicId, viewerId = null) {
    const u = (await this.pool.query('SELECT * FROM users WHERE public_id=upper($1) AND disabled_at IS NULL', [String(publicId || '').slice(0, 12)])).rows[0];
    if (!u) return null;
    // someone who blocked the viewer is simply not found by them
    if (viewerId && viewerId !== u.id && (await this.pool.query('SELECT 1 FROM user_blocks WHERE blocker=$1 AND blocked=$2', [u.id, viewerId])).rowCount) return null;
    const pv = privacyOf(u);
    const out = { publicId: u.public_id, displayName: u.display_name, avatar: u.avatar, picture: u.picture_url || null, memberSince: iso(u.created_at), skin: publicSkin(this.skinCatalog.byId(this.equippedSkin(u))), skinAnimations: SKIN_ANIMATIONS };
    out.friendsCount = pv.friendCount ? Number((await this.pool.query(`SELECT count(*)::int n FROM friendships WHERE status='accepted' AND (user_a=$1 OR user_b=$1)`, [u.id])).rows[0].n) : null;
    if (viewerId) out.relation = viewerId === u.id ? 'self' : await this.relation(viewerId, u.id, pv);
    out.streamer = pv.streamerStats ? await this.streamerStats(u.id) : null;
    if (pv.linkedAccounts) {
      const links = (await this.pool.query('SELECT platform, handle FROM linked_accounts WHERE user_id=$1 AND verified ORDER BY platform', [u.id])).rows;
      out.linked = links.map((l) => ({ platform: l.platform, handle: l.handle }));
    } else out.linked = null;
    out.player = pv.playerStats ? { available: false } : null; // viewers' game stats are not tied to accounts yet
    return out;
  }

  /* ------------------------------------------------------------ «السكنات»: 3D characters (SkinCatalog: the skins table) */
  /** The equipped skin, falling back to the default if the stored one was removed or switched off. */
  equippedSkin(u) { return this.skinCatalog.byId(u?.skin)?.id || this.skinCatalog.defaultId; }
  async ownedSkins(userId, c = this.pool) {
    await this.catalog();
    const rows = (await c.query('SELECT skin_id, source, acquired_at, copies FROM user_skins WHERE user_id=$1', [userId])).rows;
    const owned = new Map(this.skinCatalog.list().filter((x) => x.default).map((x) => [x.id, { source: 'default', acquiredAt: null, copies: 1 }]));
    for (const r of rows) if (this.skinCatalog.anyById(r.skin_id)) owned.set(r.skin_id, { source: owned.has(r.skin_id) ? 'default' : r.source, acquiredAt: iso(r.acquired_at), copies: r.copies });
    return owned;
  }
  async skins(userId) {
    await this.catalog();
    const u = (await this.pool.query('SELECT skin FROM users WHERE id=$1', [userId])).rows[0];
    const owned = await this.ownedSkins(userId), equipped = this.equippedSkin(u);
    const list = this.skinCatalog.list().filter((x) => x.access !== 'grant' || owned.has(x.id)); // grant-only skins appear once given
    return {
      equipped, animations: SKIN_ANIMATIONS, animationLabels: SKIN_ANIMATION_LABELS, packs: SKIN_PACKS,
      rarities: Object.fromEntries(Object.entries(RARITIES).map(([k, r]) => [k, { name: r.name, color: r.color, order: r.order }])),
      shards: [...owned.values()].reduce((n, o) => n + Math.max(0, (o.copies || 1) - 1), 0),
      skins: list.map((x) => { const o = owned.get(x.id); return { ...publicSkin(x), owned: !!o, source: o?.source || null, acquiredAt: o?.acquiredAt || null, copies: o?.copies || 0, equipped: x.id === equipped }; }),
    };
  }
  /** Adds a free skin to the account's collection. Wheel / paid / granted skins can never be claimed this way. */
  async claimSkin(userId, id) {
    await this.catalog();
    const skin = this.skinCatalog.byId(String(id || ''));
    if (!skin) fail('السكن غير موجود', 404);
    if (skin.default) return this.skins(userId);
    if (skin.access !== 'free') fail('هذا السكن غير متاح للإضافة المجانية', 403);
    await this.pool.query(`INSERT INTO user_skins (user_id, skin_id, source) VALUES ($1,$2,'claim') ON CONFLICT DO NOTHING`, [userId, skin.id]);
    return this.skins(userId);
  }
  /** Equips a skin the account owns — ownership is checked here, never taken from the browser. */
  async equipSkin(userId, id) {
    await this.catalog();
    const skin = this.skinCatalog.byId(String(id || ''));
    if (!skin) fail('السكن غير موجود', 404);
    if (!(await this.ownedSkins(userId)).has(skin.id)) fail('هذا السكن ليس في مجموعتك', 403);
    await this.pool.query('UPDATE users SET skin=$2 WHERE id=$1', [userId, skin.id]);
    await this.refresh(userId);
    return this.skins(userId);
  }
  /** Skins of viewers playing in a stream: their platform handle → the equipped skin of the سبونج لايف account
      that officially linked that same platform account (verified). Used by the game screens. */
  async skinsForHandles(platformName, handles) {
    await this.catalog();
    const list = [...new Set(handles.map((h) => String(h || '').toLowerCase()).filter((h) => /^[a-z0-9_.]{1,40}$/.test(h)))].slice(0, 300);
    const out = new Map(list.map((h) => [h, null]));
    if (!list.length || !['tiktok', 'kick'].includes(platformName)) return out;
    const rows = (await this.pool.query(`SELECT lower(la.handle) handle, u.skin FROM linked_accounts la JOIN users u ON u.id = la.user_id
      WHERE la.platform=$1 AND la.verified AND lower(la.handle) = ANY($2) AND u.disabled_at IS NULL`, [platformName, list])).rows;
    for (const r of rows) {
      const s = this.skinCatalog.byId(this.equippedSkin({ skin: r.skin }));
      if (s) out.set(r.handle, { id: s.id, name: s.name, rarity: s.rarity, accent: s.accent, thumb: s.thumb, model: s.model, lose: s.model.startsWith('/skins/u/') ? s.thumb : `/skins/${s.id}-lose.webp` });
    }
    return out;
  }
  /* ---- owner: the skins table ---- */
  async adminSkins() {
    await this.catalog(true);
    const counts = Object.fromEntries((await this.pool.query('SELECT skin_id, count(*)::int n FROM user_skins GROUP BY skin_id')).rows.map((r) => [r.skin_id, r.n]));
    const rows = (await this.pool.query('SELECT id, name, blurb, rarity, access, is_default, accent, in_wheel, price_coins, active, sort, builtin, (model IS NOT NULL) has_model, (thumb IS NOT NULL) has_thumb FROM skins ORDER BY sort, id')).rows;
    return rows.map((r) => ({ id: r.id, name: r.name, blurb: r.blurb, rarity: r.rarity, access: r.access, default: r.is_default, accent: r.accent, inWheel: r.in_wheel, price: r.price_coins, active: r.active, sort: r.sort,
      builtin: r.builtin, uploaded: r.has_model, ready: !!(r.builtin || (r.has_model && r.has_thumb)), owners: counts[r.id] || 0, thumb: this.skinCatalog.anyById(r.id)?.thumb || null }));
  }
  async saveSkin(input) {
    const id = String(input.id || '');
    const cur = (await this.pool.query('SELECT * FROM skins WHERE id=$1', [id])).rows[0];
    if (!cur) fail('السكن غير موجود', 404);
    const name = String(input.name ?? cur.name).replace(/[\u0000-\u001f<>]/g, '').trim();
    if (name.length < 2 || name.length > 40) fail('الاسم من 2 إلى 40 حرفًا');
    const blurb = String(input.blurb ?? cur.blurb).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 160);
    const rarity = String(input.rarity ?? cur.rarity); if (!(rarity in RARITIES)) fail('درجة ندرة غير معروفة');
    const raw = input.price === undefined ? cur.price_coins : input.price;
    const price = raw === null || raw === '' ? null : Number(raw);
    if (price !== null && (!Number.isInteger(price) || price < 1 || price > 1000000)) fail('سعر غير صالح');
    const access = ['free', 'wheel', 'grant'].includes(input.access) ? input.access : cur.access;
    if (cur.is_default && (input.active === false || access !== 'free')) fail('السكن الافتراضي يبقى متاحًا مجانًا للجميع');
    await this.pool.query(`UPDATE skins SET name=$2, blurb=$3, rarity=$4, access=$5, in_wheel=$6, price_coins=$7, active=$8, updated_at=now() WHERE id=$1`,
      [id, name, blurb, rarity, access, input.inWheel === undefined ? cur.in_wheel : !!input.inWheel && access === 'wheel', access === 'wheel' ? price : null, input.active === undefined ? cur.active : !!input.active]);
    await this.audit('owner', 'skin-save', { details: { id, name, rarity, inWheel: !!input.inWheel, price, active: input.active } });
    return this.adminSkins();
  }
  /** Owner upload: a GLB (checked by its header, ≤ 4 MB) and a poster (WebP / PNG by its bytes, ≤ 400 KB). */
  async uploadSkin(input) {
    const id = String(input.id || '').toLowerCase();
    if (!SkinCatalog.validId(id)) fail('المعرّف: حروف إنجليزية صغيرة وأرقام و _ (2–32)');
    const decode = (d, max) => { const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(d || '')); if (!m) return null; const b = Buffer.from(m[2], 'base64'); if (b.length > max) fail('الملف أكبر من المسموح'); return b; };
    const model = decode(input.model, 4 * 1024 * 1024), thumb = decode(input.thumb, 400 * 1024);
    if (model && !(model.readUInt32LE(0) === 0x46546c67 && model.readUInt32LE(4) === 2)) fail('ملف النموذج ليس GLB صالحًا');
    let thumbType = null;
    if (thumb) {
      if (thumb.subarray(0, 4).toString('latin1') === 'RIFF' && thumb.subarray(8, 12).toString('latin1') === 'WEBP') thumbType = 'image/webp';
      else if (thumb.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) thumbType = 'image/png';
      else fail('صورة المعاينة يجب أن تكون WebP أو PNG');
    }
    const exists = (await this.pool.query('SELECT builtin FROM skins WHERE id=$1', [id])).rows[0];
    if (!exists) {
      if (!model || !thumb) fail('سكن جديد يحتاج النموذج وصورة المعاينة معًا');
      const name = String(input.name || '').trim(); if (name.length < 2 || name.length > 40) fail('الاسم من 2 إلى 40 حرفًا');
      const rarity = String(input.rarity || 'common'); if (!(rarity in RARITIES)) fail('درجة ندرة غير معروفة');
      await this.pool.query(`INSERT INTO skins (id, name, blurb, rarity, access, accent, in_wheel, price_coins, active, sort, model, thumb, thumb_type, model_v, thumb_v)
        VALUES ($1,$2,$3,$4,'wheel',$5,false,$6,false,200,$7,$8,$9,1,1)`, [id, name, String(input.blurb || '').slice(0, 160), rarity, /^#[0-9A-Fa-f]{6}$/.test(input.accent || '') ? input.accent : RARITIES[rarity].color, RARITIES[rarity].price, model, thumb, thumbType]);
    } else {
      if (model) await this.pool.query('UPDATE skins SET model=$2, model_v=model_v+1, updated_at=now() WHERE id=$1', [id, model]);
      if (thumb) await this.pool.query('UPDATE skins SET thumb=$2, thumb_type=$3, thumb_v=thumb_v+1, updated_at=now() WHERE id=$1', [id, thumb, thumbType]);
    }
    await this.audit('owner', 'skin-upload', { details: { id, model: model?.length || 0, thumb: thumb?.length || 0 } });
    return this.adminSkins();
  }
  async skinFile(id, kind) {
    const r = (await this.pool.query(kind === 'model' ? 'SELECT model AS data, model_v AS v FROM skins WHERE id=$1' : 'SELECT thumb AS data, thumb_type AS type, thumb_v AS v FROM skins WHERE id=$1', [String(id)])).rows[0];
    return r?.data ? { data: r.data, type: kind === 'model' ? 'model/gltf-binary' : r.type, v: r.v } : null;
  }
  async grantSkin(userId, id, by) {
    await this.catalog();
    const skin = this.skinCatalog.anyById(String(id || ''));
    if (!skin) fail('السكن غير موجود', 404);
    await this.pool.query(`INSERT INTO user_skins (user_id, skin_id, source, granted_by) VALUES ($1,$2,'grant',$3) ON CONFLICT DO NOTHING`, [userId, skin.id, String(by || '').slice(0, 60)]);
    return { ok: true, skin: skin.id };
  }

  /* ------------------------------------------------------------ «المجتمع»: friends, blocks, reports */
  // Accounts are found only by their exact permanent SPG ID — there is no browsing or name search, so nobody can be listed.
  async userRowByPublicId(publicId) {
    const id = String(publicId || '').trim().toUpperCase();
    if (!/^SPG-[A-HJ-NP-Z2-9]{6}$/.test(id)) fail('اكتب المعرف كاملًا بهذا الشكل: SPG-XXXXXX', 400);
    return (await this.pool.query('SELECT id, public_id, display_name, avatar, picture_url, privacy FROM users WHERE public_id=$1 AND disabled_at IS NULL', [id])).rows[0] || null;
  }
  /** none | friends | outgoing | incoming | blocked (I blocked them) | unavailable (they don't take requests) */
  async relation(me, other, otherPrivacy) {
    if ((await this.pool.query('SELECT 1 FROM user_blocks WHERE blocker=$1 AND blocked=$2', [me, other])).rowCount) return 'blocked';
    const [a, b] = me < other ? [me, other] : [other, me];
    const f = (await this.pool.query('SELECT status, requested_by FROM friendships WHERE user_a=$1 AND user_b=$2', [a, b])).rows[0];
    if (f) return f.status === 'accepted' ? 'friends' : f.requested_by === me ? 'outgoing' : 'incoming';
    return (otherPrivacy || PRIVACY_DEFAULTS).friendRequests ? 'none' : 'unavailable';
  }
  async findMember(me, publicId) {
    const u = await this.userRowByPublicId(publicId);
    if (!u || (await this.pool.query('SELECT 1 FROM user_blocks WHERE blocker=$1 AND blocked=$2', [u.id, me])).rowCount) return null;
    return { ...this.memberCard(u), relation: u.id === me ? 'self' : await this.relation(me, u.id, privacyOf(u)) };
  }
  memberCard(u, since) { return { publicId: u.public_id, displayName: u.display_name, avatar: u.avatar, picture: u.picture_url || null, ...(since ? { since: iso(since) } : {}) }; }
  async friendTarget(me, publicId) {
    const u = await this.userRowByPublicId(publicId);
    if (!u) fail('لا يوجد حساب بهذا المعرف', 404);
    if (u.id === me) fail('لا يمكنك تنفيذ هذا على حسابك', 400);
    return u;
  }
  async friendRequest(me, publicId) {
    const u = await this.friendTarget(me, publicId);
    const blocked = (await this.pool.query('SELECT blocker FROM user_blocks WHERE (blocker=$1 AND blocked=$2) OR (blocker=$2 AND blocked=$1)', [me, u.id])).rows;
    if (blocked.some((r) => r.blocker === me)) fail('ألغِ حظر هذا الحساب أولًا', 409);
    if (blocked.length) fail('لا يوجد حساب بهذا المعرف', 404);
    const [a, b] = me < u.id ? [me, u.id] : [u.id, me];
    const row = (await this.pool.query('SELECT status, requested_by FROM friendships WHERE user_a=$1 AND user_b=$2', [a, b])).rows[0];
    if (row?.status === 'accepted') fail('أنتما صديقان بالفعل', 409);
    if (row && row.requested_by === me) fail('أرسلت طلبًا لهذا الحساب وينتظر الرد', 409);
    if (row) return this.friendRespond(me, publicId, true); // they already asked me: sending back means yes
    if (!privacyOf(u).friendRequests) fail('هذا الحساب لا يستقبل طلبات صداقة', 403);
    const counts = (await this.pool.query(`SELECT count(*) FILTER (WHERE status='accepted')::int friends, count(*) FILTER (WHERE status='pending' AND requested_by=$1)::int pending
      FROM friendships WHERE user_a=$1 OR user_b=$1`, [me])).rows[0];
    if (counts.friends >= MAX_FRIENDS) fail(`وصلت للحد الأعلى (${MAX_FRIENDS} صديق)`, 409);
    if (counts.pending >= MAX_PENDING_OUT) fail(`لديك ${MAX_PENDING_OUT} طلبًا بانتظار الرد — انتظر الردود أو ألغِ بعضها`, 409);
    await this.pool.query('INSERT INTO friendships (user_a, user_b, requested_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [a, b, me]);
    return { relation: 'outgoing' };
  }
  async friendRespond(me, publicId, accept) {
    const u = await this.friendTarget(me, publicId);
    const [a, b] = me < u.id ? [me, u.id] : [u.id, me];
    if (accept) {
      const r = await this.pool.query(`UPDATE friendships SET status='accepted', accepted_at=now() WHERE user_a=$1 AND user_b=$2 AND status='pending' AND requested_by=$3`, [a, b, u.id]);
      if (!r.rowCount) fail('لا يوجد طلب صداقة من هذا الحساب', 404);
      return { relation: 'friends' };
    }
    const r = await this.pool.query(`DELETE FROM friendships WHERE user_a=$1 AND user_b=$2 AND status='pending' AND requested_by=$3`, [a, b, u.id]);
    if (!r.rowCount) fail('لا يوجد طلب صداقة من هذا الحساب', 404);
    return { relation: privacyOf(u).friendRequests ? 'none' : 'unavailable' };
  }
  /** Cancels my pending request, or ends a friendship. */
  async friendRemove(me, publicId) {
    const u = await this.friendTarget(me, publicId);
    const [a, b] = me < u.id ? [me, u.id] : [u.id, me];
    const r = await this.pool.query(`DELETE FROM friendships WHERE user_a=$1 AND user_b=$2 AND (status='accepted' OR requested_by=$3)`, [a, b, me]);
    if (!r.rowCount) fail('لا توجد صداقة أو طلب لإلغائه', 404);
    return { relation: privacyOf(u).friendRequests ? 'none' : 'unavailable' };
  }
  async block(me, publicId) {
    const u = await this.friendTarget(me, publicId);
    const [a, b] = me < u.id ? [me, u.id] : [u.id, me];
    await this.pool.query('DELETE FROM friendships WHERE user_a=$1 AND user_b=$2', [a, b]);
    await this.pool.query('INSERT INTO user_blocks (blocker, blocked) VALUES ($1,$2) ON CONFLICT DO NOTHING', [me, u.id]);
    return { relation: 'blocked' };
  }
  async unblock(me, publicId) {
    const u = await this.friendTarget(me, publicId);
    await this.pool.query('DELETE FROM user_blocks WHERE blocker=$1 AND blocked=$2', [me, u.id]);
    return { relation: await this.relation(me, u.id, privacyOf(u)) };
  }
  async report(me, publicId, reason, note) {
    const u = await this.friendTarget(me, publicId);
    if (!(reason in REPORT_REASONS)) fail('اختر سبب البلاغ', 400);
    const text = String(note || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
    const recent = (await this.pool.query(`SELECT 1 FROM user_reports WHERE reporter=$1 AND target=$2 AND created_at > now() - interval '1 day'`, [me, u.id])).rowCount;
    if (recent) fail('أرسلت بلاغًا عن هذا الحساب خلال آخر 24 ساعة، والإدارة تراجعه', 429);
    const today = (await this.pool.query(`SELECT count(*)::int n FROM user_reports WHERE reporter=$1 AND created_at > now() - interval '1 day'`, [me])).rows[0].n;
    if (today >= 10) fail('وصلت للحد اليومي من البلاغات', 429);
    await this.pool.query('INSERT INTO user_reports (reporter, target, reason, note) VALUES ($1,$2,$3,$4)', [me, u.id, reason, text]);
    return { ok: true };
  }
  async community(me) {
    const [fr, bl] = await Promise.all([
      this.pool.query(`SELECT f.status, f.requested_by, f.created_at, f.accepted_at, u.id, u.public_id, u.display_name, u.avatar, u.picture_url
        FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a=$1 THEN f.user_b ELSE f.user_a END
        WHERE (f.user_a=$1 OR f.user_b=$1) AND u.disabled_at IS NULL ORDER BY COALESCE(f.accepted_at, f.created_at) DESC`, [me]),
      this.pool.query(`SELECT b.created_at, u.public_id, u.display_name, u.avatar, u.picture_url FROM user_blocks b JOIN users u ON u.id=b.blocked WHERE b.blocker=$1 ORDER BY b.created_at DESC`, [me]),
    ]);
    const out = { friends: [], incoming: [], outgoing: [], blocked: bl.rows.map((r) => this.memberCard(r, r.created_at)), limits: { friends: MAX_FRIENDS, pending: MAX_PENDING_OUT } };
    for (const r of fr.rows) {
      if (r.status === 'accepted') out.friends.push(this.memberCard(r, r.accepted_at));
      else (r.requested_by === me ? out.outgoing : out.incoming).push(this.memberCard(r, r.created_at));
    }
    return out;
  }
  async listReports(status = 'open') {
    const st = ['open', 'reviewed', 'dismissed'].includes(status) ? status : 'open';
    const r = await this.pool.query(`SELECT r.id, r.reason, r.note, r.status, r.created_at, a.public_id reporter, b.public_id target, b.display_name target_name,
        (SELECT count(*)::int FROM user_reports x WHERE x.target = r.target) total
      FROM user_reports r JOIN users a ON a.id=r.reporter JOIN users b ON b.id=r.target WHERE r.status=$1 ORDER BY r.created_at DESC LIMIT 200`, [st]);
    return r.rows.map((x) => ({ id: x.id, reason: x.reason, reasonText: REPORT_REASONS[x.reason], note: x.note, status: x.status, createdAt: iso(x.created_at), reporter: x.reporter, target: x.target, targetName: x.target_name, total: x.total }));
  }
  async setReportStatus(id, status) {
    if (!['open', 'reviewed', 'dismissed'].includes(status)) fail('حالة غير معروفة', 400);
    const r = await this.pool.query('UPDATE user_reports SET status=$2, updated_at=now() WHERE id=$1', [Number(id), status]);
    if (!r.rowCount) fail('البلاغ غير موجود', 404);
    return { ok: true };
  }

  /* ------------------------------------------------------------ profile */
  async profile(userId) {
    const e = this.cached(userId) || await this.refresh(userId);
    if (!e) return null;
    const ent = this.entitlement(userId);
    const [subs, pays, links, trial] = await Promise.all([
      this.pool.query('SELECT id, plan, price_halalas, currency, starts_at, ends_at, status, source, created_at FROM subscriptions WHERE user_id=$1 ORDER BY starts_at DESC LIMIT 50', [userId]),
      this.pool.query('SELECT id, plan, amount_halalas, currency, status, created_at, verified_at FROM payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [userId]),
      this.pool.query('SELECT platform, handle, verified, verified_at, last_connected_at, display_name, avatar_url, needs_reauth, verify_method FROM linked_accounts WHERE user_id=$1', [userId]),
      this.trialState(userId),
    ]);
    const t = this.now();
    return {
      user: this.publicUser(e.user),
      access: { ...ent, planName: ent.plan ? PLANS[ent.plan].name : null, endsAt: iso(ent.endsAt), remainingMs: ent.active ? ent.endsAt - t : 0 },
      trial,
      // only official sign-ins count as linked; an old unverified row is reported as not linked
      linked: Object.fromEntries(links.rows.filter((l) => l.verified && l.verify_method === 'oauth').map((l) => [l.platform, { handle: l.handle, displayName: l.display_name, avatar: l.avatar_url, verified: true, needsReauth: l.needs_reauth, verifiedAt: iso(l.verified_at), lastConnectedAt: iso(l.last_connected_at) }])),
      history: subs.rows.map((s) => ({ id: s.id, plan: s.plan, planName: PLANS[s.plan]?.name || s.plan, price: s.price_halalas / 100, currency: s.currency, startsAt: iso(s.starts_at), endsAt: iso(s.ends_at), source: s.source,
        status: s.status === 'cancelled' ? 'cancelled' : +new Date(s.ends_at) <= t ? 'expired' : +new Date(s.starts_at) > t ? 'scheduled' : 'active' })),
      payments: pays.rows.map((p) => ({ id: p.id, plan: p.plan, amount: p.amount_halalas / 100, currency: p.currency, status: p.status, createdAt: iso(p.created_at) })),
      billing: { enabled: !!this.gateway.configured, provider: this.gateway.configured ? this.gateway.name : null },
      mail: { enabled: !!this.mail.configured },
      trialNeedsVerifiedEmail: this.trialNeedsVerifiedEmail,
      privacy: privacyOf(e.user),
      streamer: await this.streamerStats(userId),
      progress: await this.progress(userId),
      skin: publicSkin(this.skinCatalog.byId(this.equippedSkin(e.user))),
      skinAnimations: SKIN_ANIMATIONS,
    };
  }
  /** XP, level and play/stream statistics — derived only from what the server counted (real, listed sessions),
      so reloading pages or repeating requests can never add XP. */
  async progress(userId) {
    const [pl, st, wk, uniq] = await Promise.all([
      this.pool.query(`SELECT COALESCE(sum(p.entries),0)::int entries, COALESCE(sum(p.wins),0)::int wins, COALESCE(sum(p.seconds),0)::int seconds,
          COUNT(DISTINCT p.week_start)::int weeks
        FROM weekly_player_stats p JOIN linked_accounts la ON la.user_id = $1 AND la.verified AND la.platform = p.platform AND p.handle IS NOT NULL AND lower(la.handle) = p.handle`, [userId]),
      this.pool.query('SELECT sessions, players_total, games, longest_minutes FROM streamer_stats WHERE user_id=$1', [userId]),
      this.pool.query('SELECT COALESCE(sum(minutes),0)::int minutes, COALESCE(sum(rounds),0)::int rounds FROM weekly_streamer_stats WHERE user_id=$1', [userId]),
      this.pool.query('SELECT count(DISTINCT (platform, player_id))::int n FROM weekly_streamer_players WHERE user_id=$1', [userId]),
    ]);
    const p = pl.rows[0], s = st.rows[0] || {}, w = wk.rows[0];
    const player = { entries: p.entries, wins: p.wins, hours: Math.round(p.seconds / 360) / 10, weeks: p.weeks };
    const streamer = { sessions: s.sessions || 0, hours: Math.round(w.minutes / 6) / 10, longestHours: Math.round((s.longest_minutes || 0) / 6) / 10,
      players: uniq.rows[0].n, games: Object.keys(s.games || {}).length, rounds: w.rounds };
    const R = XP_RULES;
    const xp = player.entries * R.entry + player.wins * R.win + Math.floor(p.seconds / 60) * R.playMinute
      + streamer.sessions * R.session + w.minutes * R.streamMinute + w.rounds * R.streamRound;
    return { xp, ...levelFor(xp), player, streamer, rules: R };
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
