// سبونج لايف — «إطارات الأسماء»: an avatar ring + a nameplate shown with a player's name in the lobby and on
// the game screens. Cosmetic only (no effect on any game or ranking).
//
// Built-in frames are drawn by CSS (public/frames.css) and need no image. Uploaded frames add transparent
// PNG / WebP images: an avatar ring (square, drawn over the picture) and a nameplate drawn as a nine-slice
// (`slice` = top, right, bottom, left in pixels of the image), so long and short names keep the corners intact.
// A frame shows for a viewer only when their TikTok / Kick account is officially linked to a سبونج لايف account
// that equipped it — guests keep their platform picture, nothing is invented for them.
const RARITY_ORDER = { common: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
export const FRAME_RARITIES = Object.freeze({ common: 'عادي', rare: 'نادر', epic: 'ملحمي', legendary: 'أسطوري', mythic: 'خرافي' });
export const FRAME_EFFECTS = Object.freeze(['none', 'cyan', 'gold', 'saudi', 'flame', 'ice', 'crown', 'royal']);
export const BUILTIN_FRAMES = Object.freeze([
  { id: 'cyan', name: 'الموجة السماوية', rarity: 'common', access: 'free', effect: 'cyan', sort: 10 },
  { id: 'gold', name: 'لمعة الذهب', rarity: 'rare', access: 'grant', effect: 'gold', sort: 20 },
  { id: 'saudi', name: 'الأخضر السعودي', rarity: 'epic', access: 'grant', effect: 'saudi', sort: 30 },
  { id: 'ice', name: 'الجليد', rarity: 'epic', access: 'grant', effect: 'ice', sort: 40 },
  { id: 'flame', name: 'اللهب', rarity: 'legendary', access: 'grant', effect: 'flame', sort: 50 },
  { id: 'crown', name: 'التاج', rarity: 'legendary', access: 'grant', effect: 'crown', sort: 60 },
  { id: 'royal', name: 'الزخرفة الملكية', rarity: 'mythic', access: 'grant', effect: 'royal', sort: 70 },
]);
const fail = (m, status = 400) => { throw Object.assign(new Error(m), { status }); };
const validId = (id) => /^[a-z0-9_]{2,32}$/.test(id);
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
/** PNG / WebP only (an SVG upload could carry script). */
export function imageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}
/** What a page may know about a frame (no image bytes: images are served from /frames/u/<id>-<part>.<ext>). */
export function publicFrame(r) {
  const ext = (t) => (t === 'image/webp' ? 'webp' : 'png');
  return { id: r.id, name: r.name, rarity: r.rarity, rarityName: FRAME_RARITIES[r.rarity], effect: r.effect, access: r.access,
    avatar: r.avatar_type ? `/frames/u/${r.id}-avatar.${ext(r.avatar_type)}?v=${r.img_v}` : null,
    plate: r.plate_type ? `/frames/u/${r.id}-plate.${ext(r.plate_type)}?v=${r.img_v}` : null,
    slice: Array.isArray(r.slice) ? r.slice.map(Number) : [0, 0, 0, 0] };
}
const COLS = 'id, name, rarity, access, effect, avatar_type, plate_type, slice, img_v, active, builtin, sort';

export class FrameStore {
  constructor({ pool }) { this.pool = pool; this.seeded = null; this.cache = null; this.cacheAt = 0; }
  /** Built-in frames are added once; an owner's later edits (name, access, active) are never overwritten. */
  async seed() {
    if (!this.seeded) this.seeded = (async () => {
      for (const f of BUILTIN_FRAMES) await this.pool.query(`INSERT INTO frames (id, name, rarity, access, effect, builtin, sort) VALUES ($1,$2,$3,$4,$5,true,$6) ON CONFLICT (id) DO NOTHING`, [f.id, f.name, f.rarity, f.access, f.effect, f.sort]);
    })().catch((err) => { this.seeded = null; throw err; });
    return this.seeded;
  }
  async all(force = false) {
    await this.seed();
    if (!force && this.cache && Date.now() - this.cacheAt < 30_000) return this.cache;
    this.cache = (await this.pool.query(`SELECT ${COLS} FROM frames ORDER BY sort, id`)).rows; this.cacheAt = Date.now();
    return this.cache;
  }
  async owned(userId) { return new Map((await this.pool.query('SELECT frame_id, source, acquired_at FROM user_frames WHERE user_id=$1', [userId])).rows.map((r) => [r.frame_id, r])); }
  /** «إطاراتي»: the frames the account can see (free ones and those it owns), and the one equipped. */
  async list(userId) {
    const [rows, owned, u] = await Promise.all([this.all(), this.owned(userId), this.pool.query('SELECT frame, email_verified_at FROM users WHERE id=$1', [userId])]);
    const equipped = u.rows[0]?.frame && owned.has(u.rows[0].frame) ? u.rows[0].frame : null;
    return { equipped, verified: !!u.rows[0]?.email_verified_at,
      frames: rows.filter((r) => r.active && (r.access === 'free' || owned.has(r.id))).map((r) => ({ ...publicFrame(r), owned: owned.has(r.id), equipped: r.id === equipped, source: owned.get(r.id)?.source || null })) };
  }
  async claim(userId, id) {
    const f = (await this.all()).find((r) => r.id === String(id || '') && r.active);
    if (!f) fail('الإطار غير موجود', 404);
    if (f.access !== 'free') fail('هذا الإطار يُمنح فقط ولا يمكن إضافته مجانًا', 403);
    const u = (await this.pool.query('SELECT email_verified_at FROM users WHERE id=$1', [userId])).rows[0];
    if (!u?.email_verified_at) fail('وثّق بريدك الإلكتروني أولًا لتحصل على الإطار المجاني', 403);
    await this.pool.query(`INSERT INTO user_frames (user_id, frame_id, source) VALUES ($1,$2,'claim') ON CONFLICT DO NOTHING`, [userId, f.id]);
    return this.list(userId);
  }
  /** Ownership is checked here (never taken from the browser); null takes the frame off. */
  async equip(userId, id) {
    if (id === null || id === '') { await this.pool.query('UPDATE users SET frame=NULL WHERE id=$1', [userId]); return this.list(userId); }
    const fid = String(id);
    const f = (await this.all()).find((r) => r.id === fid && r.active);
    if (!f) fail('الإطار غير موجود', 404);
    if (!(await this.owned(userId)).has(fid)) fail('هذا الإطار ليس في مجموعتك', 403);
    await this.pool.query('UPDATE users SET frame=$2 WHERE id=$1', [userId, fid]);
    return this.list(userId);
  }
  /** Players in a stream: platform handle → the frame equipped by the verified سبونج لايف account that linked it. */
  async forHandles(platformName, handles) {
    const list = [...new Set(handles.map((h) => String(h || '').toLowerCase()).filter((h) => /^[a-z0-9_.]{1,40}$/.test(h)))].slice(0, 300);
    const out = new Map(list.map((h) => [h, null]));
    if (!list.length || !['tiktok', 'kick'].includes(platformName)) return out;
    const rows = (await this.pool.query(`SELECT lower(la.handle) handle, f.id, f.name, f.rarity, f.access, f.effect, f.avatar_type, f.plate_type, f.slice, f.img_v
      FROM linked_accounts la JOIN users u ON u.id = la.user_id JOIN user_frames uf ON uf.user_id = u.id AND uf.frame_id = u.frame JOIN frames f ON f.id = u.frame AND f.active
      WHERE la.platform=$1 AND la.verified AND lower(la.handle) = ANY($2) AND u.disabled_at IS NULL`, [platformName, list])).rows;
    for (const r of rows) out.set(r.handle, publicFrame(r));
    return out;
  }
  /** The account's own frame (the host seated as a player). */
  async forUser(userId) {
    const r = (await this.pool.query(`SELECT f.id, f.name, f.rarity, f.access, f.effect, f.avatar_type, f.plate_type, f.slice, f.img_v FROM users u
      JOIN user_frames uf ON uf.user_id = u.id AND uf.frame_id = u.frame JOIN frames f ON f.id = u.frame AND f.active WHERE u.id=$1`, [userId])).rows[0];
    return r ? publicFrame(r) : null;
  }
  async file(id, part) {
    const r = (await this.pool.query(part === 'avatar' ? 'SELECT avatar_img data, avatar_type type, img_v v FROM frames WHERE id=$1' : 'SELECT plate_img data, plate_type type, img_v v FROM frames WHERE id=$1', [String(id)])).rows[0];
    return r?.data ? r : null;
  }

  /* ---- owner ---- */
  async admin() {
    const rows = await this.all(true);
    const counts = Object.fromEntries((await this.pool.query('SELECT frame_id, count(*)::int n FROM user_frames GROUP BY frame_id')).rows.map((r) => [r.frame_id, r.n]));
    return rows.map((r) => ({ ...publicFrame(r), active: r.active, builtin: r.builtin, sort: r.sort, owners: counts[r.id] || 0 }));
  }
  /** Add or update a frame. Images arrive as data: URLs (PNG / WebP, ≤ 300 KB each). */
  async save(input) {
    const id = String(input.id || '').toLowerCase();
    if (!validId(id)) fail('المعرّف: حروف إنجليزية صغيرة وأرقام و _ (2–32)');
    const cur = (await this.pool.query(`SELECT ${COLS} FROM frames WHERE id=$1`, [id])).rows[0];
    const name = cleanName(input.name ?? cur?.name);
    if (!name) fail('اكتب اسم الإطار');
    const rarity = input.rarity ?? cur?.rarity ?? 'common'; if (!RARITY_ORDER[rarity]) fail('الندرة غير صالحة');
    const access = input.access ?? cur?.access ?? 'grant'; if (!['free', 'grant'].includes(access)) fail('طريقة الحصول غير صالحة');
    const effect = input.effect ?? cur?.effect ?? 'none'; if (!FRAME_EFFECTS.includes(effect)) fail('المؤثر غير صالح');
    const slice = input.slice !== undefined ? input.slice : cur?.slice || [0, 0, 0, 0];
    if (!Array.isArray(slice) || slice.length !== 4 || slice.some((n) => !Number.isInteger(Number(n)) || Number(n) < 0 || Number(n) > 400)) fail('قيم التقسيم (nine-slice) أربعة أرقام من 0 إلى 400');
    const decode = (d) => { if (!d) return null; const m = /^data:image\/(png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(d)); if (!m) fail('الصورة يجب أن تكون PNG أو WebP'); const b = Buffer.from(m[2], 'base64'); if (b.length > 300 * 1024) fail('الصورة أكبر من 300 KB'); const t = imageType(b); if (!t) fail('ملف الصورة غير صالح'); return { b, t }; };
    const av = decode(input.avatar), pl = decode(input.plate);
    const active = input.active === undefined ? cur?.active ?? true : input.active === true;
    if (!cur) {
      await this.pool.query(`INSERT INTO frames (id, name, rarity, access, effect, slice, active, avatar_img, avatar_type, plate_img, plate_type, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, name, rarity, access, effect, slice.map(Number), active, av?.b || null, av?.t || null, pl?.b || null, pl?.t || null, Number.isInteger(input.sort) ? input.sort : 100]);
    } else {
      await this.pool.query(`UPDATE frames SET name=$2, rarity=$3, access=$4, effect=$5, slice=$6, active=$7,
        avatar_img=COALESCE($8, avatar_img), avatar_type=COALESCE($9, avatar_type), plate_img=COALESCE($10, plate_img), plate_type=COALESCE($11, plate_type),
        img_v = img_v + CASE WHEN $8::bytea IS NULL AND $10::bytea IS NULL THEN 0 ELSE 1 END WHERE id=$1`,
        [id, name, rarity, access, effect, slice.map(Number), active, av?.b || null, av?.t || null, pl?.b || null, pl?.t || null]);
    }
    this.cache = null;
    return (await this.admin()).find((f) => f.id === id);
  }
  async grant(userId, id, by) {
    const f = (await this.all(true)).find((r) => r.id === String(id || ''));
    if (!f) fail('الإطار غير موجود', 404);
    const r = await this.pool.query(`INSERT INTO user_frames (user_id, frame_id, source, granted_by) VALUES ($1,$2,'grant',$3) ON CONFLICT DO NOTHING`, [userId, f.id, String(by || '').slice(0, 60)]);
    return { ok: true, frame: f.id, added: r.rowCount === 1 };
  }

  /* ---- the lobby saved for a restart ---- */
  async saveLobby(room, userId, data) {
    if (!data) { await this.pool.query('DELETE FROM lobby_sessions WHERE room=$1', [room]); return; }
    await this.pool.query(`INSERT INTO lobby_sessions (room, user_id, data, updated_at) VALUES ($1,$2,$3,now())
      ON CONFLICT (room) DO UPDATE SET data=EXCLUDED.data, user_id=EXCLUDED.user_id, updated_at=now()`, [room, userId, JSON.stringify(data)]);
  }
  /** A saved lobby younger than `maxAgeMs`; older ones are dropped. */
  async loadLobby(room, maxAgeMs = 6 * 60 * 60_000) {
    const r = (await this.pool.query('SELECT data, updated_at FROM lobby_sessions WHERE room=$1', [room])).rows[0];
    if (!r) return null;
    if (Date.now() - new Date(r.updated_at).getTime() > maxAgeMs) { await this.pool.query('DELETE FROM lobby_sessions WHERE room=$1', [room]); return null; }
    return r.data;
  }
}
