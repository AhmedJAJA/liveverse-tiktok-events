// SPONGE LIVE — promo codes that open the studio.
// Codes are stored only as salted SHA-256 hashes; the plain code is shown once, when it is created.
// Each code has a use limit (0 = unlimited), an optional expiry, an on/off switch and an access level:
//   live — full studio including connecting a real TikTok/Kick stream
//   demo — full studio, demo players only (no stream connection)
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomInt } from 'node:crypto';

export const PROMO_LEVELS = Object.freeze({ live: 'استوديو كامل مع ربط البث', demo: 'تجربة بلا ربط بث' });
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to avoid misreading

export function normalizeCode(raw) { return String(raw ?? '').normalize('NFKC').toUpperCase().replace(/[\s\-_]/g, '').slice(0, 64); }
export function generateCode(length = 10) { let s = ''; for (let i = 0; i < length; i++) s += ALPHABET[randomInt(ALPHABET.length)]; return s; }

export class PromoStore {
  constructor({ file = null, now = () => Date.now() } = {}) {
    this.file = file; this.now = now; this.codes = new Map(); this.byHash = new Map(); this.pepper = null; this.saveTimer = null; this.mirror = null;
    if (file && fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.pepper = data.pepper || null;
        for (const c of data.codes || []) this.add(c);
      } catch (err) { console.error('[promo] could not read', file, err.message); }
    }
    if (!this.pepper) { this.pepper = randomBytes(24).toString('base64url'); this.save(); }
  }
  hash(code) { return createHash('sha256').update(this.pepper + ':' + normalizeCode(code)).digest('base64url'); }
  add(c) { this.codes.set(c.id, c); this.byHash.set(c.hash, c); return c; }
  /** Swap in the codes loaded from the database (see src/persist.mjs). */
  replaceAll(pepper, records) { this.pepper = pepper; this.codes.clear(); this.byHash.clear(); for (const c of records) this.add(c); this.save(); }
  changed(c) { this.save(); this.mirror?.put(c); }
  save() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ pepper: this.pepper, codes: [...this.codes.values()] }), { mode: 0o600 });
        fs.renameSync(tmp, this.file);
      } catch (err) { console.error('[promo] save failed', err.message); }
    }, 50);
    this.saveTimer.unref?.();
  }
  flush() { if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; if (this.file) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ pepper: this.pepper, codes: [...this.codes.values()] }), { mode: 0o600 }); } } }

  create({ code, label = '', maxUses = 1, expiresAt = null, level = 'live' } = {}) {
    const plain = code ? normalizeCode(code) : generateCode();
    if (!/^[A-Z0-9]{6,32}$/.test(plain)) throw Object.assign(new Error('الرمز من 6 إلى 32 حرفًا إنجليزيًا أو رقمًا'), { status: 400 });
    if (!PROMO_LEVELS[level]) throw Object.assign(new Error('مستوى الصلاحية غير معروف'), { status: 400 });
    const uses = Number(maxUses);
    if (!Number.isInteger(uses) || uses < 0 || uses > 100000) throw Object.assign(new Error('عدد مرات الاستخدام من 0 (بلا حد) إلى 100000'), { status: 400 });
    let expires = null;
    if (expiresAt) { expires = new Date(expiresAt).getTime(); if (!Number.isFinite(expires) || expires <= this.now()) throw Object.assign(new Error('تاريخ الانتهاء يجب أن يكون في المستقبل'), { status: 400 }); }
    const hash = this.hash(plain);
    if (this.byHash.has(hash)) throw Object.assign(new Error('هذا الرمز موجود بالفعل'), { status: 409 });
    const c = this.add({ id: 'pc_' + randomBytes(6).toString('hex'), hash, hint: plain.slice(0, 2) + '•••' + plain.slice(-2), label: String(label).slice(0, 60), maxUses: uses, uses: 0, expiresAt: expires, active: true, level, createdAt: this.now(), lastUsedAt: null });
    this.changed(c);
    return { ...this.public(c), code: plain };
  }
  /** Ensure a code from the environment exists (unlimited, live). The plain value is never stored. */
  seed(code, { level = 'live', label = 'من إعدادات الخادم' } = {}) {
    const plain = normalizeCode(code); if (plain.length < 6) return null;
    const hit = this.byHash.get(this.hash(plain)); if (hit) return hit;
    return this.create({ code: plain, label, maxUses: 0, level });
  }
  status(c) {
    if (!c.active) return 'disabled';
    if (c.expiresAt && c.expiresAt <= this.now()) return 'expired';
    if (c.maxUses && c.uses >= c.maxUses) return 'used';
    return 'active';
  }
  /** Returns the code record when it may be used now (and counts the use), otherwise null. */
  redeem(raw) {
    const plain = normalizeCode(raw);
    if (plain.length < 4) return null;
    const c = this.byHash.get(this.hash(plain));
    if (!c || this.status(c) !== 'active') return null;
    c.uses++; c.lastUsedAt = this.now(); this.changed(c);
    return c;
  }
  /** Is a session that came from this code still allowed? (disabled codes revoke their sessions) */
  stillValid(id) { const c = this.codes.get(id); return !!c && c.active && !(c.expiresAt && c.expiresAt <= this.now()); }
  update(id, { active, label, maxUses, expiresAt, level } = {}) {
    const c = this.codes.get(id); if (!c) throw Object.assign(new Error('الرمز غير موجود'), { status: 404 });
    if (active !== undefined) c.active = !!active;
    if (label !== undefined) c.label = String(label).slice(0, 60);
    if (maxUses !== undefined) { const n = Number(maxUses); if (!Number.isInteger(n) || n < 0) throw Object.assign(new Error('عدد مرات غير صالح'), { status: 400 }); c.maxUses = n; }
    if (expiresAt !== undefined) c.expiresAt = expiresAt ? new Date(expiresAt).getTime() || null : null;
    if (level !== undefined) { if (!PROMO_LEVELS[level]) throw Object.assign(new Error('مستوى الصلاحية غير معروف'), { status: 400 }); c.level = level; }
    this.changed(c);
    return this.public(c);
  }
  remove(id) { const c = this.codes.get(id); if (!c) return false; this.codes.delete(id); this.byHash.delete(c.hash); this.save(); this.mirror?.del(id); return true; }
  public(c) { const { hash, ...rest } = c; return { ...rest, status: this.status(c), levelLabel: PROMO_LEVELS[c.level] }; }
  list() { return [...this.codes.values()].sort((a, b) => b.createdAt - a.createdAt).map((c) => this.public(c)); }
}
