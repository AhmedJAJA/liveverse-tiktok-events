/* SPONGE LIVE — 3D skins catalog («السكنات»).
   Characters: KayKit Adventurers by Kay Lousberg (www.kaylousberg.com), CC0 — free for commercial use.
   Each skin is one optimized GLB in public/skins/ built by scripts/build-skins.mjs from the original pack:
   only the listed meshes (one loadout) and the four animations below are kept.

   Ownership rules (enforced on the server):
   - `default: true`  → every account owns it, old and new; it is equipped when nothing else is.
   - `access: 'free'` → any signed-in account can add it to its collection with one click.
   - `access: 'grant'`→ only the owner (admin) can give it — reserved for future packs / prizes.
   New skins and packs are added here (and built by the script); nothing in the database needs to change. */

export const SKIN_ANIMATIONS = Object.freeze({ idle: 'Idle', walk: 'Walking_A', win: 'Cheer', lose: 'Death_A' });
export const SKIN_ANIMATION_LABELS = Object.freeze({ idle: 'وقوف', walk: 'مشي', win: 'فوز', lose: 'خسارة' });

const BODY = (who) => [`${who}_ArmLeft`, `${who}_ArmRight`, `${who}_Body`, `${who}_LegLeft`, `${who}_LegRight`, `${who}_Cape`];

export const SKINS = Object.freeze([
  { id: 'knight', name: 'الفارس', blurb: 'سيف ودرع وخوذة لامعة — الشخصية الافتراضية لكل حساب.', source: 'Knight.glb', pack: 'adventurers', default: true, access: 'free', accent: '#5AA9FF',
    keep: [...BODY('Knight'), 'Knight_Head', 'Knight_Helmet', '1H_Sword', 'Round_Shield'] },
  { id: 'barbarian', name: 'المحارب', blurb: 'فأس ودرع خشبي وقبعة فرو دافئة.', source: 'Barbarian.glb', pack: 'adventurers', access: 'free', accent: '#FF8A4C',
    keep: [...BODY('Barbarian'), 'Barbarian_Head', 'Barbarian_Hat', '1H_Axe', 'Barbarian_Round_Shield'] },
  { id: 'mage', name: 'الساحر', blurb: 'عصا سحرية وكتاب تعاويذ.', source: 'Mage.glb', pack: 'adventurers', access: 'free', accent: '#B07CFF',
    keep: [...BODY('Mage'), 'Mage_Head', 'Mage_Hat', '1H_Wand', 'Spellbook'] },
  { id: 'rogue', name: 'المتسللة', blurb: 'خنجران سريعان ورداء أخضر خفيف.', source: 'Rogue.glb', pack: 'adventurers', access: 'free', accent: '#4FD39A',
    keep: [...BODY('Rogue'), 'Rogue_Head', 'Knife', 'Knife_Offhand'] },
  { id: 'rogue_hooded', name: 'المتسلل المقنّع', blurb: 'قوس نشّاب صغير وخنجر وقلنسوة تخفي الوجه.', source: 'Rogue_Hooded.glb', pack: 'adventurers', access: 'free', accent: '#2FC5C9',
    keep: [...BODY('Rogue'), 'Rogue_Head_Hooded', '1H_Crossbow', 'Knife_Offhand'] },
].map((s) => Object.freeze({ ...s, model: `/skins/${s.id}.glb`, thumb: `/skins/${s.id}.webp`, keep: Object.freeze(s.keep) })));

export const SKIN_PACKS = Object.freeze({ adventurers: { name: 'المغامرون', credit: 'KayKit Adventurers — Kay Lousberg (CC0)' } });
export const DEFAULT_SKIN = SKINS.find((s) => s.default).id;
export const skinById = (id) => SKINS.find((s) => s.id === id) || null;
/** What the browser needs (no build details). */
export const publicSkin = (s) => ({ id: s.id, name: s.name, blurb: s.blurb, pack: s.pack, default: !!s.default, access: s.access, accent: s.accent, model: s.model, thumb: s.thumb });
