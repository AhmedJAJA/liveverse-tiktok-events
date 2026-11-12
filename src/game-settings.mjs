// سبونج لايف — per-game «الإعدادات المتقدمة»: each game lists only the options its own rules use.
// The studio draws the option buttons from this schema; the server validates every value against it
// and applies the result to the real game when «بدء الجولة الآن» is pressed.
import { CATEGORIES as QUIZ_CATEGORIES } from './question-bank.mjs';
import { OUTSIDER_WORDS } from './team-games.mjs';

const secs = (list) => list.map((n) => [n, n < 60 ? n + ' ثانية' : n === 60 ? 'دقيقة' : n === 90 ? 'دقيقة ونصف' : n === 120 ? 'دقيقتان' : n === 150 ? 'دقيقتان ونصف' : n === 180 ? '3 دقائق' : n + ' ثانية']);
const nums = (list, unit, tags = {}) => list.map((n) => [n, n + ' ' + unit + (tags[n] ? ' — ' + tags[n] : '')]);
const f = (key, label, options, def, hint = '') => ({ key, label, options, default: def, ...(hint ? { hint } : {}) });

/* «سلسلة الكلمات»: fields carry a `control` (counter / segment / toggle) and a `group` (match / rules) for the settings cards. */
const onOff = [[true, 'تشغيل'], [false, 'إيقاف']];
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
  // «الروليت» (src/roulette.mjs): «قواعد اللعب» are fixed for the whole match and shown on screen; «المباراة» covers
  // the players and how the screens look. Every option here changes the game — nothing is decorative.
  roulette: [
    { ...f('maxPlayers', 'الحد الأقصى للمشاركين', [10, 20, 30, 50, 100].map((n) => [n, String(n)]), 50, 'من يكتب كلمة الانضمام بعد اكتمال العدد لا يدخل'), control: 'counter', group: 'match' },
    { ...f('hostPlays', 'السماح للمضيف بالمشاركة', onOff, false, 'تدخل كلاعب تلقائيًا عند فتح التسجيل، وتخضع للقواعد نفسها'), control: 'toggle', group: 'match' },
    { ...f('drawSpeed', 'سرعة السحب', [['slow', 'بطيئة'], ['normal', 'عادية'], ['fast', 'سريعة']], 'normal', 'مدة دوران الأسماء ومشهد المسدس'), control: 'segment', group: 'match' },
    { ...f('resultSeconds', 'مدة عرض النتيجة (ثانية)', [[3, '3'], [4, '4'], [5, '5'], [7, '7']], 4), control: 'segment', group: 'match' },
    { ...f('showNames', 'إظهار أسماء اللاعبين', onOff, true, 'عند الإيقاف تظهر الأرقام فقط'), control: 'toggle', group: 'match' },
    { ...f('showFrames', 'عرض إطارات اللاعبين', onOff, true, 'الإطار الذي جهّزه اللاعب في حسابه'), control: 'toggle', group: 'match' },
    { ...f('sounds', 'الأصوات', onOff, true, 'مؤثرات السحب والمسدس والنتيجة على شاشة البث'), control: 'toggle', group: 'match' },
    { ...f('effects', 'قوة المؤثرات', [['low', 'خفيفة'], ['normal', 'متوسطة'], ['high', 'قوية']], 'normal', 'الومضة واهتزاز الكاميرا والجزيئات'), control: 'segment', group: 'match' },
    { ...f('graphics', 'مستوى الرسوميات', [['auto', 'تلقائي'], ['high', 'عالٍ'], ['low', 'منخفض']], 'auto', 'المنخفض يرسم المسدس بدون ثلاثي الأبعاد للأجهزة الضعيفة'), control: 'segment', group: 'match' },
    { ...f('trial', 'وضع التجربة', onOff, false, '«جهّز اللوبي» يبدأ بلاعبين تجريبيين بدون بث — لا يدخل التصنيف'), control: 'toggle', group: 'match' },
    { ...f('chooseSeconds', 'مهلة اختيار الهدف (ثانية)', [15, 20, 25, 30, 45].map((n) => [n, String(n)]), 25, 'يكتب صاحب الدور في الشات رقم لاعب آخر ما زال في اللعبة'), control: 'counter', group: 'rules' },
    { ...f('timeoutRule', 'إذا لم يختر صاحب الدور', [['random', 'يختار الخادم لاعبًا آخر عشوائيًا'], ['skip', 'يُلغى الدور']], 'random', 'صاحب الدور لا يواجه المسدس بسبب سحب اسمه أبدًا'), control: 'segment', group: 'rules' },
    { ...f('repeatTarget', 'استهداف هدف الدور السابق', [['allow', 'مسموح'], ['block', 'ممنوع لدور واحد']], 'allow', '«ممنوع»: لا يُختار نفس اللاعب مرتين متتاليتين — يحمي اللاعب من الاستهداف المتكرر'), control: 'segment', group: 'rules' },
    { ...f('chambers', 'حجرات خزنة كل لاعب', [2, 3, 4, 5, 6].map((n) => [n, String(n)]), 2, 'لكل لاعب خزنته؛ الطلقة في مكان عشوائي يحدده الخادم'), control: 'counter', group: 'rules' },
    { ...f('bullets', 'الطلقات في الخزنة', [1, 2, 3].map((n) => [n, String(n)]), 1, 'أقل من عدد الحجرات دائمًا'), control: 'counter', group: 'rules' },
    { ...f('cylinder', 'الخزنة بعد كل سحبة', [['advance', 'تتقدم حجرة'], ['spin', 'تُدار من جديد']], 'advance', '«تتقدم»: من نجا مرة يقترب من الطلقة. «تُدار»: الاحتمال نفسه كل مرة'), control: 'segment', group: 'rules' },
    { ...f('autoRun', 'تشغيل الأدوار', [['manual', 'يدوي'], ['auto', 'تلقائي']], 'manual', '«يدوي»: تضغط «ابدأ السحب» كل دور. «تلقائي»: يبدأ الدور التالي بعد النتيجة ما دامت شاشة المضيف مفتوحة'), control: 'segment', group: 'rules' },
  ],
  country: [roundsField([5, 8, 12], 8, 'دول'), secondsField([20, 30, 45, 60], 30, 'وقت كل دولة')],
  flag: [roundsField([5, 10, 15], 10, 'أعلام'), secondsField([10, 15, 20, 30], 15, 'وقت كل علم')],
  tug: [roundsField([3, 5], 3, 'شدّات', { 3: 'أفضل من 3', 5: 'أفضل من 5' }), secondsField([30, 40, 60], 40, 'وقت كل شدّة')],
  chain: [
    { ...f('target', 'نقاط الفوز', Array.from({ length: 19 }, (_, i) => 10 + i * 5).map((n) => [n, n + ' نقطة']), 30, 'أول لاعب يوصل لهذا العدد يفوز بالمباراة'), control: 'counter', step: 5, group: 'match' },
    { ...f('seconds', 'وقت الإجابة (ثانية)', [[15, '15'], [20, '20'], [25, '25']], 20, 'إذا انتهى الوقت بلا إجابة صحيحة تتغير الكلمة والفئة'), control: 'segment', group: 'match' },
    { ...f('order', 'ترتيب الفئات', [['ordered', 'بالترتيب'], ['random', 'عشوائي']], 'ordered', 'حيوانات، دول، أسماء، فواكه وخضار، أشياء، مدن'), control: 'segment', group: 'match' },
    { ...f('alternate', 'منع الإجابة مرتين ورا بعض', onOff, true, 'اللاعب اللي جاوب ما تنقبل إجابته الجاية إلا بعد ما يجاوب لاعب غيره — عشان ما يسيطر لاعب واحد على السلسلة'), control: 'toggle', group: 'rules' },
    { ...f('review', 'مراجعة المشرف للكلمات غير المعروفة', onOff, true, 'كلمة صحيحة الحرف وليست في قائمة الكلمات تظهر لك لتقبلها أو ترفضها أثناء الدور'), control: 'toggle', group: 'rules' },
    { ...f('sounds', 'الأصوات', onOff, true, 'مؤثرات الإجابة الصحيحة والخاطئة وانتهاء الوقت على شاشة البث'), control: 'toggle', group: 'rules' },
  ],
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
/** Saved roulette settings from before the rule was fixed: no «targetMode», and a silent holder never faces the revolver. */
function legacyRoulette(out) { delete out.targetMode; if (out.timeoutRule === 'self') out.timeoutRule = 'random'; return out; }
/** Merge a change into the saved settings; every value must be one of the listed options. */
export function validateSettings(mode, input = {}, base = defaultSettings(mode)) {
  const schema = GAME_SETTINGS[mode];
  if (!schema) throw new Error('لعبة غير معروفة');
  const out = { ...defaultSettings(mode), ...base };
  if (mode === 'roulette') legacyRoulette(out);
  for (let [k, v] of Object.entries(input || {})) {
    // «الروليت» from before: «من يواجه المسدس؟» is gone (the holder always chooses), «يواجه المسدس بنفسه» became «random»
    if (mode === 'roulette' && k === 'targetMode') continue;
    if (mode === 'roulette' && k === 'timeoutRule' && v === 'self') v = 'random';
    const field = schema.find((x) => x.key === k);
    if (!field) throw new Error('إعداد غير معروف لهذه اللعبة');
    const hit = field.options.find(([val]) => String(val) === String(v));
    if (!hit) throw new Error('قيمة غير صالحة لـ«' + field.label + '»');
    out[k] = hit[0];
  }
  // the roulette: a cylinder always keeps at least one empty chamber
  if (mode === 'roulette' && out.bullets >= out.chambers) {
    if (input && 'bullets' in input) throw new Error('الطلقات يجب أن تكون أقل من عدد الحجرات');
    out.bullets = out.chambers - 1;
  }
  return out;
}
/** Public description for the studio (labels, options, defaults). */
export function settingsSchema() {
  return Object.fromEntries(Object.entries(GAME_SETTINGS).map(([m, fields]) => [m, fields.map((x) => ({ key: x.key, label: x.label, options: x.options.map(([value, label]) => ({ value, label })), default: x.default, hint: x.hint || '', control: x.control || 'options', group: x.group || 'match', ...(x.step ? { step: x.step } : {}) }))]));
}
/** Settings that shape the lobby itself (who may join, how many): applied when the lobby is ready and whenever
    they change before the round. Today only the roulette has them. */
export function applyLobbySettings(engine, mode, s) {
  if (mode !== 'roulette' || engine.status.active) return;
  const v = validateSettings(mode, s, {});
  const already = [...engine.players.values()].filter((p) => !p.host).length;
  engine.registration.maxPlayers = Math.max(v.maxPlayers, already); // never drops players who already joined
  const hostJoin = v.hostPlays ? 'auto' : 'manual';
  if (engine.registration.hostJoin !== hostJoin) { engine.registration.hostJoin = hostJoin; if (hostJoin === 'auto' && engine.registration.phase === 'open') engine.joinHost(false); }
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
    case 'roulette': {
      const variant = {};
      for (const k of ['chambers', 'bullets', 'cylinder', 'chooseSeconds', 'timeoutRule', 'repeatTarget', 'autoRun', 'drawSpeed', 'resultSeconds', 'showNames', 'showFrames', 'sounds', 'effects', 'graphics', 'hostPlays']) variant[k] = v[k];
      engine.configure({ variant });
      applyLobbySettings(engine, mode, v);
      break;
    }
    default: {
      const variant = {};
      for (const k of ['format', 'rule', 'scoring', 'winners', 'category', 'target', 'order', 'alternate', 'review', 'sounds']) if (v[k] !== undefined) variant[k] = v[k];
      engine.configure({ ...(v.rounds !== undefined ? { rounds: v.rounds } : {}), ...(v.seconds !== undefined ? { roundSeconds: v.seconds } : {}), ...(Object.keys(variant).length ? { variant } : {}) });
    }
  }
  return v;
}
