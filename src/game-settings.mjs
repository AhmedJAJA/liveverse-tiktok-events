// SPONGE LIVE — per-game «الإعدادات المتقدمة»: each game lists only the options its own rules use.
// The studio draws the option buttons from this schema; the server validates every value against it
// and applies the result to the real game when «بدء الجولة الآن» is pressed.
import { CATEGORIES as QUIZ_CATEGORIES } from './question-bank.mjs';
import { OUTSIDER_WORDS } from './team-games.mjs';

const secs = (list) => list.map((n) => [n, n < 60 ? n + ' ثانية' : n === 60 ? 'دقيقة' : n === 90 ? 'دقيقة ونصف' : n === 120 ? 'دقيقتان' : n === 150 ? 'دقيقتان ونصف' : n === 180 ? '3 دقائق' : n + ' ثانية']);
const nums = (list, unit, tags = {}) => list.map((n) => [n, n + ' ' + unit + (tags[n] ? ' — ' + tags[n] : '')]);
const f = (key, label, options, def, hint = '') => ({ key, label, options, default: def, ...(hint ? { hint } : {}) });

const roundsField = (list, def, unit = 'جولات', tags) => f('rounds', 'عدد الجولات', nums(list, unit, tags), def);
const secondsField = (list, def, label = 'وقت كل جولة', hint) => f('seconds', label, secs(list), def, hint);

export const GAME_SETTINGS = Object.freeze({
  quiz: [
    f('questions', 'عدد الأسئلة', nums([1, 5, 10, 15], 'سؤال', { 1: 'سريعة', 15: 'طويلة' }).map(([v, l]) => [v, v === 1 ? 'سؤال واحد — سريعة' : l]), 5, 'تُسحب الأسئلة من بنك الأسئلة بدون تكرار.'),
    f('seconds', 'وقت الإجابة', secs([15, 20, 30, 45, 60]), 30),
    f('scoring', 'النقاط', [['speed', 'حسب السرعة (10، 7، 5…)'], ['flat', 'ثابتة — 5 نقاط لكل إجابة صحيحة']], 'speed'),
    f('category', 'فئة الأسئلة', Object.entries(QUIZ_CATEGORIES).map(([k, t]) => [k, k === 'all' ? 'كل الفئات' : t]), 'all'),
    f('difficulty', 'مستوى الصعوبة', [['all', 'كل المستويات'], ['easy', 'سهل'], ['medium', 'متوسط'], ['hard', 'صعب']], 'all'),
  ],
  guess: [f('seconds', 'وقت التخمين', secs([20, 30, 45, 60, 90]), 30)],
  race: [f('target', 'طول السباق', nums([10, 20, 30, 50], 'خطوة', { 10: 'سريع', 50: 'طويل' }), 20)],
  wheel: [],
  glass: [
    f('steps', 'طول الجسر', nums([5, 10, 15], 'خطوات', { 5: 'سريع', 15: 'طويل' }), 10),
    f('stepSeconds', 'وقت كل قفزة', secs([10, 15, 20, 30]), 10),
  ],
  bomb: [f('seconds', 'زمن القنبلة', secs([10, 15, 20, 30, 45]), 15, 'من تنفجر القنبلة في يده يخرج، وآخر ناجٍ يفوز.')],
  rps: [
    f('format', 'شكل اللعب', [['duel', 'مواجهات ثنائية'], ['sky', 'الكل ضد بوبل (3 حيوات)']], 'duel'),
    secondsField([10, 15, 20, 30], 15, 'وقت الاختيار'),
  ],
  minority: [roundsField([5, 10, 15], 10), secondsField([10, 15, 20, 30], 15)],
  higherlower: [roundsField([5, 8, 12], 8), secondsField([10, 12, 15, 20], 12)],
  truefalse: [roundsField([5, 8, 12], 8), secondsField([10, 15, 20, 30], 15)],
  redlight: [roundsField([8, 16, 24], 16, 'إشارات')],
  bowling: [roundsField([2, 3, 5], 3, 'إطارات'), secondsField([10, 12, 15, 20], 12, 'وقت كل رمية')],
  drawguess: [
    roundsField([3, 5, 8], 5, 'رسمات'),
    secondsField([45, 60, 90, 120], 60, 'وقت كل رسمة'),
    f('winners', 'الفائزون في كل رسمة', [[1, 'أول إجابة صحيحة فقط'], [3, 'أول ثلاث إجابات']], 1),
  ],
  chairs: [secondsField([4, 6, 8, 10], 6, 'مهلة الجلوس بعد توقف الموسيقى', 'المقاعد تقل تلقائيًا كل جولة حتى يبقى فائز.')],
  categories: [
    roundsField([8, 12, 20], 12),
    secondsField([10, 15, 20, 30], 15, 'وقت الإجابة'),
    f('scoring', 'عند الخطأ', [['elimination', 'إقصاء اللاعب'], ['points', 'خصم 3 نقاط']], 'elimination'),
  ],
  roles: [roundsField([6, 12, 20], 12, 'أيام'), secondsField([30, 45, 60, 90], 45, 'وقت النقاش والتصويت')],
  roulette: [
    f('rule', 'طريقة الاختيار', [['eliminate', 'كل دورة تُقصي لاعبًا'], ['winner', 'دورة واحدة تختار الفائز']], 'eliminate'),
    secondsField([5, 7, 10], 7, 'وقت كل دورة'),
  ],
  country: [roundsField([5, 8, 12], 8, 'دول'), secondsField([20, 30, 45, 60], 30, 'وقت كل دولة')],
  flag: [roundsField([5, 10, 15], 10, 'أعلام'), secondsField([10, 15, 20, 30], 15, 'وقت كل علم')],
  tug: [roundsField([3, 5], 3, 'شدّات', { 3: 'أفضل من 3', 5: 'أفضل من 5' }), secondsField([30, 40, 60], 40, 'وقت كل شدّة')],
  outsider: [
    f('category', 'فئة الكلمة', [['random', 'عشوائية'], ...Object.keys(OUTSIDER_WORDS).map((k) => [k, k])], 'random'),
    secondsField([60, 90, 120, 180], 90, 'وقت التلميح قبل التصويت'),
  ],
});

/** Games whose rules let a newcomer join a round that already started (viewers by chat, or the host by hand). */
export const LATE_JOIN_MODES = Object.freeze(['quiz', 'guess']);
export const JOIN_WORD_SUGGESTIONS = Object.freeze(['انضم', 'العب', 'دخول', 'جاهز']);

export function defaultSettings(mode) {
  return Object.fromEntries((GAME_SETTINGS[mode] || []).map((x) => [x.key, x.default]));
}
/** Merge a change into the saved settings; every value must be one of the listed options. */
export function validateSettings(mode, input = {}, base = defaultSettings(mode)) {
  const schema = GAME_SETTINGS[mode];
  if (!schema) throw new Error('لعبة غير معروفة');
  const out = { ...defaultSettings(mode), ...base };
  for (const [k, v] of Object.entries(input || {})) {
    const field = schema.find((x) => x.key === k);
    if (!field) throw new Error('إعداد غير معروف لهذه اللعبة');
    const hit = field.options.find(([val]) => String(val) === String(v));
    if (!hit) throw new Error('قيمة غير صالحة لـ«' + field.label + '»');
    out[k] = hit[0];
  }
  return out;
}
/** Public description for the studio (labels, options, defaults). */
export function settingsSchema() {
  return Object.fromEntries(Object.entries(GAME_SETTINGS).map(([m, fields]) => [m, fields.map((x) => ({ key: x.key, label: x.label, options: x.options.map(([value, label]) => ({ value, label })), default: x.default, hint: x.hint || '' }))]));
}
/** Apply saved settings to the engine before the round starts. */
export function applySettings(engine, mode, s) {
  const v = validateSettings(mode, s, {});
  switch (mode) {
    case 'quiz': engine.configure({ duration: v.seconds }); engine.setQuizSeries({ total: v.questions, scoring: v.scoring, category: v.category, difficulty: v.difficulty }); break;
    case 'guess': engine.configure({ duration: v.seconds }); break;
    case 'race': engine.configure({ target: v.target }); break;
    case 'glass': engine.configure({ glassSteps: v.steps, glassStepDuration: v.stepSeconds }); break;
    case 'bomb': engine.configure({ bombSeconds: v.seconds }); break;
    case 'wheel': break;
    default: {
      const variant = {};
      for (const k of ['format', 'rule', 'scoring', 'winners', 'category']) if (v[k] !== undefined) variant[k] = v[k];
      engine.configure({ ...(v.rounds !== undefined ? { rounds: v.rounds } : {}), ...(v.seconds !== undefined ? { roundSeconds: v.seconds } : {}), ...(Object.keys(variant).length ? { variant } : {}) });
    }
  }
  return v;
}
