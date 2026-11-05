/* SPONGE LIVE — 3D skins catalog («السكنات»).
   Characters: KayKit Adventurers by Kay Lousberg (www.kaylousberg.com), CC0 — free for commercial use.
   Every skin is a real GLB in public/skins/ built by scripts/build-skins.mjs from the original pack: one loadout,
   four animations (idle / walk / win / lose — some rarities use their own clips), and for the new skins a
   recoloured palette texture (faces keep their original skin tone).

   The definitions below are the built-in set. They are copied into the `skins` table on start (never
   overwriting what the owner changed there: name, description, rarity, wheel, price, active), and the
   server always reads the table through SkinCatalog. The owner can also add skins by uploading a GLB + poster.

   Ownership (server-side): `default` → everyone owns it; `free` → one-click claim; `wheel` → عجلة السكنات or
   direct purchase at the listed price; `grant` → only the owner can give it. All effects are cosmetic. */

export const RARITIES = Object.freeze({
  common:    { name: 'عادي',   en: 'Common',    color: '#C9D3E3', order: 1, price: 300 },
  rare:      { name: 'نادر',   en: 'Rare',      color: '#3FA3FF', order: 2, price: 900 },
  epic:      { name: 'ملحمي',  en: 'Epic',      color: '#B06BFF', order: 3, price: 2500 },
  legendary: { name: 'أسطوري', en: 'Legendary', color: '#FFC83A', order: 4, price: 6000 },
  mythic:    { name: 'خرافي',  en: 'Mythic',    color: '#FF3D6E', order: 5, price: 12000 },
});
export const RARITY_IDS = Object.keys(RARITIES);
export const SKIN_ANIMATIONS = Object.freeze({ idle: 'Idle', walk: 'Walking_A', win: 'Cheer', lose: 'Death_A' });
export const SKIN_ANIMATION_LABELS = Object.freeze({ idle: 'وقوف', walk: 'مشي', win: 'فوز', lose: 'خسارة' });

const BODY = (who) => [`${who}_ArmLeft`, `${who}_ArmRight`, `${who}_Body`, `${who}_LegLeft`, `${who}_LegRight`, `${who}_Cape`];
const KNIGHT = (shield = 'Round_Shield', sword = '1H_Sword') => [...BODY('Knight'), 'Knight_Head', 'Knight_Helmet', sword, shield];
const BARB = (weapon = ['1H_Axe', 'Barbarian_Round_Shield']) => [...BODY('Barbarian'), 'Barbarian_Head', 'Barbarian_Hat', ...weapon];
const MAGE = (items = ['1H_Wand', 'Spellbook']) => [...BODY('Mage'), 'Mage_Head', 'Mage_Hat', ...items];
const ROGUE = (head = 'Rogue_Head', items = ['Knife', 'Knife_Offhand']) => [...BODY('Rogue'), head, ...items];

/* recolor: how the palette texture is tinted (scripts/build-skins.mjs) —
   hue: new hue for coloured cells (deg) | shift: hue rotation instead | metal: [hue, sat] for grey/metal cells |
   sat / light: multipliers. Skin-tone cells are never changed. */
const DEFS = [
  // the original five — Common, free (kept as they were for everyone who already has them)
  { id: 'knight', name: 'الفارس', blurb: 'سيف ودرع وخوذة لامعة — الشخصية الافتراضية لكل حساب.', source: 'Knight.glb', rarity: 'common', access: 'free', default: true, accent: '#5AA9FF', keep: KNIGHT() },
  { id: 'barbarian', name: 'المحارب', blurb: 'فأس ودرع خشبي وقبعة فرو دافئة.', source: 'Barbarian.glb', rarity: 'common', access: 'free', accent: '#FF8A4C', keep: BARB() },
  { id: 'mage', name: 'الساحر', blurb: 'عصا سحرية وكتاب تعاويذ.', source: 'Mage.glb', rarity: 'common', access: 'free', accent: '#B07CFF', keep: MAGE() },
  { id: 'rogue', name: 'المتسللة', blurb: 'خنجران سريعان ورداء أخضر خفيف.', source: 'Rogue.glb', rarity: 'common', access: 'free', accent: '#4FD39A', keep: ROGUE() },
  { id: 'rogue_hooded', name: 'المتسلل المقنّع', blurb: 'قوس نشّاب صغير وخنجر وقلنسوة تخفي الوجه.', source: 'Rogue_Hooded.glb', rarity: 'common', access: 'free', accent: '#2FC5C9', keep: ROGUE('Rogue_Head_Hooded', ['1H_Crossbow', 'Knife_Offhand']) },

  // «مجموعة الأعماق» — عجلة السكنات or a direct purchase
  { id: 'sponge_adventurer', name: 'إسفنجة المغامر', blurb: 'رداء أصفر بلون الإسفنجة وخنجران للمغامرات.', source: 'Rogue.glb', rarity: 'common', access: 'wheel', accent: '#FFD62A',
    keep: ROGUE(), recolor: { hue: 50, spread: 0.06, sat: 1.25, light: 1.12, metal: [42, 0.18] } },
  { id: 'sponge_deep', name: 'إسفنجة الأعماق', blurb: 'محارب من قاع البحر بألوان المرجان والطحالب.', source: 'Barbarian.glb', rarity: 'common', access: 'wheel', accent: '#2FC5C9',
    keep: BARB(), recolor: { hue: 178, sat: 1.0, light: 0.92, metal: [190, 0.2] } },
  { id: 'sponge_ice', name: 'الإسفنجة الجليدية', blurb: 'ساحر الجليد: أزرق بارد ووميض صقيع.', source: 'Mage.glb', rarity: 'rare', access: 'wheel', accent: '#8CE8FF',
    keep: MAGE(['2H_Staff']), recolor: { hue: 202, spread: 0.08, sat: 0.95, light: 1.32, metal: [200, 0.4], metalLight: 1.15 } },
  { id: 'sponge_gold', name: 'الإسفنجة الذهبية', blurb: 'فارس بدرع ذهبي لامع وشعار ملكي.', source: 'Knight.glb', rarity: 'rare', access: 'wheel', accent: '#FFC83A',
    keep: KNIGHT('Badge_Shield'), recolor: { shift: 0, sat: 1.0, light: 1.0, metal: [44, 0.78], metalLight: 1.12 } },
  { id: 'sponge_electric', name: 'الإسفنجة الكهربائية', blurb: 'قلنسوة بنفسجية وشرارات كهربائية تحيط بها.', source: 'Rogue_Hooded.glb', rarity: 'epic', access: 'wheel', accent: '#B06BFF',
    keep: ROGUE('Rogue_Head_Hooded', ['1H_Crossbow', 'Knife_Offhand']), recolor: { hue: 272, sat: 1.3, light: 1.0, metal: [200, 0.45] },
    anims: { idle: '2H_Melee_Idle' } },
  { id: 'ocean_knight', name: 'فارس المحيط', blurb: 'درع بلون الموج يرفعه دائمًا في وضع الحراسة.', source: 'Knight.glb', rarity: 'epic', access: 'wheel', accent: '#1EC8FF',
    keep: KNIGHT('Rectangle_Shield'), recolor: { hue: 188, sat: 1.25, light: 1.0, metal: [190, 0.42] },
    anims: { idle: 'Blocking' } },
  { id: 'deep_king', name: 'ملك الأعماق', blurb: 'ملك المحيط بعباءة أرجوانية وحلية ذهبية — يدور بفأسه عند الفوز.', source: 'Barbarian.glb', rarity: 'legendary', access: 'wheel', accent: '#FFC83A',
    keep: BARB(['2H_Axe']), recolor: { hue: 285, sat: 1.2, light: 0.95, metal: [45, 0.8], metalLight: 1.1 },
    anims: { idle: '2H_Melee_Idle', win: '2H_Melee_Attack_Spin' } },
  { id: 'sponge_lightning', name: 'إسفنجة البرق', blurb: 'ساحر البرق: أصفر وأسود وتعويذة صاعقة عند الفوز.', source: 'Mage.glb', rarity: 'legendary', access: 'wheel', accent: '#FFE14D',
    keep: MAGE(['2H_Staff']), recolor: { hue: 52, spread: 0.05, sat: 1.5, light: 1.15, metal: [230, 0.25], metalLight: 0.45 },
    anims: { win: 'Spellcast_Long' } },
  { id: 'sponge_galaxy', name: 'إسفنجة المجرة', blurb: 'قلنسوة من سماء الليل بألوان المجرة — تحوك النجوم بين يديها.', source: 'Rogue_Hooded.glb', rarity: 'mythic', access: 'wheel', accent: '#FF5BD8',
    keep: ROGUE('Rogue_Head_Hooded', ['Knife', 'Knife_Offhand']), recolor: { hue: 300, sat: 1.4, light: 0.85, metal: [255, 0.55], metalLight: 0.75, cycle: true },
    anims: { idle: 'Spellcasting', win: 'Jump_Full_Long' } },
  { id: 'ocean_emperor', name: 'إمبراطور المحيط', blurb: 'درع قرمزي وذهبي ودرع بأشواك — سيد الأعماق كلها.', source: 'Knight.glb', rarity: 'mythic', access: 'wheel', accent: '#FF3D6E',
    keep: KNIGHT('Spike_Shield'), recolor: { hue: 46, spread: 0.1, sat: 1.3, light: 1.05, metal: [350, 0.62], metalLight: 0.88 },
    anims: { idle: '2H_Melee_Idle', win: '2H_Melee_Attack_Spinning' } },
];

export const SKINS = Object.freeze(DEFS.map((s, i) => Object.freeze({
  ...s, pack: 'adventurers', sort: i, keep: Object.freeze(s.keep),
  anims: Object.freeze({ ...SKIN_ANIMATIONS, ...(s.anims || {}) }),
  price: s.access === 'wheel' ? RARITIES[s.rarity].price : null,
  model: `/skins/${s.id}.glb`, thumb: `/skins/${s.id}.webp`,
})));
export const SKIN_PACKS = Object.freeze({ adventurers: { name: 'المغامرون', credit: 'KayKit Adventurers — Kay Lousberg (CC0)' } });
export const DEFAULT_SKIN = SKINS.find((s) => s.default).id;
/** Built-in definitions only (build scripts and tests); the server uses SkinCatalog. */
export const skinById = (id) => SKINS.find((s) => s.id === id) || null;
/** What the browser needs (no build details). */
export const publicSkin = (s) => s && ({
  id: s.id, name: s.name, blurb: s.blurb, pack: s.pack, default: !!s.default, access: s.access, accent: s.accent,
  rarity: s.rarity, rarityName: RARITIES[s.rarity]?.name, rarityColor: RARITIES[s.rarity]?.color,
  price: s.price ?? null, inWheel: !!s.inWheel, model: s.model, thumb: s.thumb,
});

/* ------------------------------------------------------------------ the live catalog (database) */
const ID_RE = /^[a-z0-9_]{2,32}$/;
export class SkinCatalog {
  constructor() { this.map = new Map(SKINS.map((s) => [s.id, { ...s, inWheel: s.access === 'wheel', active: true }])); }
  /** Copies the built-in skins into the table (keeping the owner's edits), then reads the table. */
  async load(pool) {
    for (const s of SKINS) {
      await pool.query(`INSERT INTO skins (id, name, blurb, rarity, access, is_default, accent, in_wheel, price_coins, sort, builtin)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.name, s.blurb, s.rarity, s.access, !!s.default, s.accent, s.access === 'wheel', s.price, s.sort]);
    }
    const rows = (await pool.query('SELECT id, name, blurb, rarity, access, is_default, accent, in_wheel, price_coins, active, sort, builtin, model_v, thumb_v, (model IS NOT NULL) has_model, (thumb IS NOT NULL) has_thumb FROM skins ORDER BY sort, id')).rows;
    const map = new Map();
    for (const r of rows) {
      const def = skinById(r.id);
      if (!def && !(r.has_model && r.has_thumb)) continue; // an uploaded skin is shown only once both files exist
      map.set(r.id, {
        ...(def || { keep: [], anims: { ...SKIN_ANIMATIONS }, pack: 'uploads' }),
        id: r.id, name: r.name, blurb: r.blurb, rarity: r.rarity, access: r.access, default: r.is_default, accent: r.accent,
        inWheel: r.in_wheel && r.active, price: r.price_coins, active: r.active, sort: r.sort,
        model: r.has_model ? `/skins/u/${r.id}.glb?v=${r.model_v}` : def.model,
        thumb: r.has_thumb ? `/skins/u/${r.id}.webp?v=${r.thumb_v}` : def.thumb,
      });
    }
    this.map = map;
    return this;
  }
  byId(id) { const s = this.map.get(String(id || '')); return s && s.active ? s : null; }
  anyById(id) { return this.map.get(String(id || '')) || null; }
  list({ all = false } = {}) { return [...this.map.values()].filter((s) => all || s.active).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id)); }
  get defaultId() { return this.list().find((s) => s.default)?.id || DEFAULT_SKIN; }
  wheelPool() { return this.list().filter((s) => s.inWheel); }
  static validId(id) { return ID_RE.test(String(id || '')); }
}
