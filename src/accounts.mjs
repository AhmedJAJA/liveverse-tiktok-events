// SKY LIVE accounts: server-side validation, scrypt password hashing, opaque
// HttpOnly session cookies and owner-managed subscriptions.
// Storage is a JSON file (SKY_DATA_DIR). On hosts with an ephemeral disk the file
// resets on redeploy — mount a persistent disk for production accounts.
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PLANS = Object.freeze({ none: 'بدون اشتراك', trial: 'تجربة', monthly: 'شهري', annual: 'سنوي' });
export const PASSWORD_MIN = 8;
const DAY = 86_400_000;
const KEYLEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const hash = (password, salt) => new Promise((resolve, reject) =>
  scrypt(String(password).normalize('NFKC'), salt, KEYLEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));
const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
const ROOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const roomId = (prefix) => prefix + Array.from(randomBytes(9), (b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');

/** Password strength 0–4 shared by the server rules and the client meter. */
export function passwordScore(pw) {
  const s = String(pw ?? '');
  let score = 0;
  if (s.length >= PASSWORD_MIN) score++;
  if (s.length >= 12) score++;
  if (/[a-z؀-ۿ]/i.test(s) && /\d/.test(s)) score++;
  if (/[^\p{L}\p{N}]/u.test(s) || (/[a-z]/.test(s) && /[A-Z]/.test(s))) score++;
  return score;
}

export function validateRegistration({ username, displayName, email, password } = {}) {
  const fields = {};
  const u = String(username ?? '').trim();
  if (!/^[A-Za-z0-9_.]{3,20}$/.test(u)) fields.username = 'اسم المستخدم من 3 إلى 20 حرفًا إنجليزيًا أو رقمًا أو _ .';
  const d = String(displayName ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (d.length < 2 || d.length > 32) fields.displayName = 'الاسم الظاهر من 2 إلى 32 حرفًا';
  const e = String(email ?? '').trim().toLowerCase();
  if (e.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) fields.email = 'أدخل بريدًا إلكترونيًا صحيحًا';
  const p = String(password ?? '');
  if (p.length < PASSWORD_MIN) fields.password = `كلمة المرور ${PASSWORD_MIN} أحرف على الأقل`;
  else if (p.length > 128) fields.password = 'كلمة المرور طويلة جدًا';
  else if (passwordScore(p) < 2) fields.password = 'كلمة المرور ضعيفة: استخدم حروفًا وأرقامًا';
  return { fields, clean: { username: u, displayName: d, email: e, password: p } };
}

export class FieldError extends Error {
  constructor(fields, message = 'تحقق من الحقول المظللة') { super(message); this.fields = fields; this.status = 400; }
}

export class AccountStore {
  constructor({ file = null, now = () => Date.now() } = {}) {
    this.file = file; this.now = now; this.users = new Map();
    if (file) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const u of data.users || []) if (u?.id && u?.username) this.users.set(u.id, u);
      } catch { /* first run */ }
    }
  }
  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, users: [...this.users.values()] }), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  find(identifier) {
    const key = String(identifier ?? '').trim().toLowerCase();
    if (!key) return null;
    for (const u of this.users.values()) if (u.username.toLowerCase() === key || u.email === key) return u;
    return null;
  }
  byId(id) { return this.users.get(id) || null; }
  byRoom(room) { for (const u of this.users.values()) if (u.room === room) return u; return null; }
  planActive(u) { return !!u && u.plan !== 'none' && Number(u.planUntil) > this.now(); }
  publicUser(u) {
    if (!u) return null;
    return { id: u.id, username: u.username, displayName: u.displayName, email: u.email, plan: this.planActive(u) ? u.plan : 'none',
      planLabel: PLANS[this.planActive(u) ? u.plan : 'none'], planUntil: this.planActive(u) ? u.planUntil : null, planActive: this.planActive(u), room: u.room, createdAt: u.createdAt };
  }
  async register(input) {
    const { fields, clean } = validateRegistration(input);
    if (!fields.username && this.find(clean.username)) fields.username = 'اسم المستخدم مستخدم بالفعل';
    if (!fields.email && this.find(clean.email)) fields.email = 'هذا البريد مسجل بالفعل';
    if (Object.keys(fields).length) throw new FieldError(fields);
    if (this.users.size >= 5000) throw new Error('بلغ الموقع الحد الأقصى للحسابات');
    const salt = token(16);
    const user = { id: 'usr_' + token(12), username: clean.username, displayName: clean.displayName, email: clean.email, salt,
      hash: (await hash(clean.password, salt)).toString('base64'), plan: 'none', planUntil: null, room: roomId('u'), createdAt: this.now() };
    this.users.set(user.id, user);
    this.save();
    return user;
  }
  async verify(identifier, password) {
    const user = this.find(identifier);
    // Always run scrypt so timing does not reveal whether the account exists.
    const salt = user?.salt || 'sky-live-timing-pad';
    const key = await hash(String(password ?? '').slice(0, 128), salt);
    if (!user) return null;
    const stored = Buffer.from(user.hash, 'base64');
    return stored.length === key.length && timingSafeEqual(stored, key) ? user : null;
  }
  async setPassword(username, password) {
    const user = this.find(username);
    if (!user) throw new Error('الحساب غير موجود');
    const { fields } = validateRegistration({ username: user.username, displayName: user.displayName, email: user.email, password });
    if (fields.password) throw new FieldError({ password: fields.password }, fields.password);
    user.salt = token(16); user.hash = (await hash(password, user.salt)).toString('base64');
    this.save();
    return true;
  }
  setPlan(username, plan, days) {
    const user = this.find(username);
    if (!user) throw new Error('الحساب غير موجود');
    if (!Object.hasOwn(PLANS, plan)) throw new Error('خطة غير معروفة');
    if (plan === 'none') { user.plan = 'none'; user.planUntil = null; }
    else {
      const d = Number(days ?? { trial: 3, monthly: 30, annual: 365 }[plan]);
      if (!Number.isInteger(d) || d < 1 || d > 3660) throw new Error('عدد الأيام من 1 إلى 3660');
      const from = Math.max(this.now(), this.planActive(user) ? Number(user.planUntil) : 0);
      user.plan = plan; user.planUntil = from + d * DAY;
    }
    this.save();
    return this.publicUser(user);
  }
  list() { return [...this.users.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 500).map((u) => this.publicUser(u)); }
}

/** Login sessions. With a file they survive restarts and redeploys (keys are stored hashed). */
export class Sessions {
  constructor({ now = () => Date.now(), ttlMs = 30 * DAY, max = 20000, file = null } = {}) {
    this.now = now; this.ttl = ttlMs; this.max = max; this.map = new Map(); this.file = file; this.saveTimer = null;
    if (file && fs.existsSync(file)) {
      try { for (const s of JSON.parse(fs.readFileSync(file, 'utf8'))) if (s.expires > this.now()) this.map.set(s.key, s); }
      catch (err) { console.error('[sessions] could not read', err.message); }
    }
  }
  key(id) { return createHash('sha256').update(String(id)).digest('base64url'); }
  save() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const keep = [...this.map.values()].filter((s) => s.kind !== 'guest' && s.expires > this.now());
        fs.writeFileSync(this.file + '.tmp', JSON.stringify(keep), { mode: 0o600 }); fs.renameSync(this.file + '.tmp', this.file);
      } catch (err) { console.error('[sessions] save failed', err.message); }
    }, 200);
    this.saveTimer.unref?.();
  }
  create(kind, { userId = null, room = null, codeId = null, level = null } = {}) {
    if (this.map.size >= this.max) this.prune(true);
    const id = token(32), key = this.key(id);
    this.map.set(key, { key, kind, userId, room, codeId, level, created: this.now(), expires: this.now() + (kind === 'guest' ? DAY : this.ttl) });
    this.save();
    return id;
  }
  get(id) {
    if (typeof id !== 'string' || id.length < 20) return null;
    const key = this.key(id), s = this.map.get(key);
    if (!s) return null;
    if (s.expires <= this.now()) { this.map.delete(key); return null; }
    return { ...s, id };
  }
  destroy(id) { if (this.map.delete(this.key(id))) this.save(); }
  destroyWhere(test) { let n = 0; for (const [k, s] of this.map) if (test(s)) { this.map.delete(k); n++; } if (n) this.save(); return n; }
  destroyUser(userId) { this.destroyWhere((s) => s.userId === userId); }
  prune(force = false) {
    const t = this.now();
    for (const [k, s] of this.map) if (s.expires <= t) this.map.delete(k);
    if (force && this.map.size >= this.max) for (const k of [...this.map.keys()].slice(0, Math.ceil(this.max / 10))) this.map.delete(k);
  }
}

/** Fixed-window limiter for login/registration attempts. */
export class RateLimiter {
  constructor({ limit = 10, windowMs = 10 * 60_000, now = () => Date.now() } = {}) { this.limit = limit; this.window = windowMs; this.now = now; this.hits = new Map(); }
  hit(key) {
    const t = this.now(); const entry = this.hits.get(key);
    if (!entry || t - entry.start > this.window) { this.hits.set(key, { start: t, count: 1 }); if (this.hits.size > 10000) this.hits.clear(); return true; }
    entry.count++;
    return entry.count <= this.limit;
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
