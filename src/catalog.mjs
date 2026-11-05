// سبونج لايف — single source for the game catalogue, pricing, support channel and
// release notes. The home page, the dashboard, the join page and the server all
// read it (via /api/site), so counts and statuses never disagree.

export const CATEGORIES = Object.freeze({
  elimination: 'الإقصاء',
  group: 'الجماعية',
  smart: 'الذكاء والسرعة',
  luck: 'الحظ والمخاطرة'
});

const g = (mode, title, category, summary, rules, extra = {}) => Object.freeze({
  mode, title, category, categoryLabel: CATEGORIES[category], summary, rules: Object.freeze(rules),
  href: `/play?mode=${mode}`, setup: extra.setup || `/event?mode=${mode}`, cover: `/covers/${mode}.svg`, status: 'available', minPlayers: extra.minPlayers || 1, ...extra
});
const art = (file) => ({ cover: `/cards/${file}.webp`, art: `/cards/${file}.png` });

/** The سبونج لايف games, in gallery order, each with its card art. */
export const GAMES = Object.freeze([
  g('quiz', 'تحدي المعرفة', 'smart', 'سؤال وأربعة خيارات ومؤقت — الأسرع يتصدر', ['اكتب رقم الإجابة 1–4 في الشات', 'أول إجابة فقط تُحتسب', 'تظهر الإجابة الصحيحة وترتيب الأسرع'], art('01-knowledge-challenge')),
  g('drawguess', 'خمن الرسمة', 'smart', 'المشرف يرسم كلمة سرية والجمهور يخمّن من الشات', ['المشرف يرسم على اللوحة', 'اكتب تخمينك في الشات (محاولة كل ثانية)', 'أول إجابة صحيحة تربح الجولة'], art('02-guess-drawing')),
  g('chairs', 'كراسي موسيقية', 'elimination', 'تتوقف الموسيقى فجأة — اكتب «اجلس» قبل أن تمتلئ المقاعد', ['لا تكتب أثناء الموسيقى وإلا تُقصى', 'عند التوقف اكتب «اجلس» بسرعة', 'المقاعد تقل كل جولة حتى يبقى فائز'], { ...art('03-musical-chairs'), minPlayers: 2 }),
  g('bowling', 'لعبة البولينج', 'luck', 'اختر نقطة التصويب من 1 إلى 10 — كلما اقتربت من النقطة المخفية أسقطت قوارير أكثر', ['اكتب رقمًا من 1 إلى 10 في كل إطار', 'الإصابة المثالية ضربة كاملة (10 قوارير +5)', 'الأعلى مجموعًا بعد الإطارات يفوز'], art('04-bowling')),
  g('bomb', 'القنبلة الموقوتة', 'elimination', 'مرّر القنبلة قبل أن ينتهي العداد — حاملها عند الانفجار يُقصى', ['حامل القنبلة يكتب !مرر ورقم لاعب', 'العداد 15 ثانية والانفجار يقصي الحامل', 'آخر ناجٍ يفوز'], { ...art('05-time-bomb'), setup: '/bomb', minPlayers: 2 }),
  g('categories', 'اسم حيوان جماد نبات', 'smart', 'حرف وفئة للاعب المختار — أجب خلال 15 ثانية', ['ينتظر اللاعب المختار حرفًا وفئة', 'يكتب كلمة تبدأ بالحرف خلال 15 ثانية', 'الخطأ أو انتهاء الوقت يُقصي اللاعب'], art('06-categories')),
  g('rps', 'حجرة ورقة مقص', 'elimination', 'مواجهات ثنائية تُكشف معًا — الخاسر يخرج والتعادل يُعاد', ['اكتب حجرة أو ورقة أو مقص', 'يُكشف الاختياران في نفس اللحظة', 'آخر لاعب في البطولة يفوز'], { ...art('07-rock-paper-scissors'), minPlayers: 2 }),
  g('roles', 'الأدوار المخفية', 'group', 'أدوار سرية ومخادعون بينكم — اكشفوهم بالتصويت', ['افتح صفحة دورك واكتب رمزها في الشات', 'المخادعون والمحقق يتصرفون ليلًا من صفحاتهم', 'في النهار اكتب «صوت» ورقم المشتبه'], { ...art('08-hidden-roles'), minPlayers: 4 }),
  g('roulette', 'الروليت', 'luck', 'عجلة بأسماء المتسابقين تتوقف على نتيجة عادلة يحددها الخادم', ['كل المسجلين على العجلة', 'كل دورة تُقصي لاعبًا (أو تختار فائزًا)', 'آخر من يبقى يفوز'], { ...art('09-roulette'), minPlayers: 2 }),
  g('redlight', 'الضوء الأحمر', 'elimination', 'تقدّم عند الأخضر، وتجمّد عند الأحمر — الحركة تُقصيك', ['عند الأخضر اكتب رقمًا من 1 إلى 5 للتقدم (مرة لكل ضوء)', 'أي رقم عند الأحمر يقصيك', 'أول من يصل 20 خطوة يفوز'], art('10-red-light')),
  g('country', 'خمن الدولة', 'smart', 'ثلاثة تلميحات تظهر تباعًا — اكتب اسم الدولة', ['تظهر القارة ثم معلم شهير ثم أول حرف من العاصمة', 'تُقبل طرق الكتابة المختلفة', 'الإجابة المبكرة تعطي نقاطًا أكثر'], art('11-guess-country')),
  g('flag', 'لعبة خمن العلم', 'smart', 'علم على الشاشة ومؤقت — أسرع إجابة تحصد أكثر', ['اكتب اسم الدولة صاحبة العلم', 'تُقبل الأسماء العربية والإنجليزية', 'الأعلى نقاطًا بعد الجولات يفوز'], art('12-guess-flag')),
  g('tug', 'شد الحبل', 'group', 'فريقان والحبل في النص — كل «شد» في الشات يسحب لفريقك', ['يتوزع اللاعبون على فريقين بالتساوي (الأزرق والأصفر)', 'اكتب «شد» في الشات لتسحب الحبل (مرة كل نصف ثانية تقريبًا)', 'الفريق اللي يكسب شدّتين من ثلاث يفوز'], { ...art('13-tug-of-war'), minPlayers: 2 }),
  g('outsider', 'برا السالفة', 'group', 'الكل يعرف الكلمة السرية إلا واحد — اكتشفوه قبل ما يكتشف الكلمة', ['افتح صفحتك الخاصة واكتب «دوري» والرمز في الشات لتعرف الكلمة', 'لمّحوا للكلمة في الشات بدون ما تقولونها', 'صوّتوا بكتابة «صوت» ورقم اللاعب — وإذا انكشف عنده فرصة يكتب الكلمة'], { ...art('14-outsider'), minPlayers: 3 })
]);

/** Earlier games: still fully playable from the studio and their join pages. */
export const EXTRA_GAMES = Object.freeze([
  g('guess', 'خمّن الكلمة', 'smart', 'أول إجابة صحيحة في الشات تخطف الصدارة', ['اكتب تخمينك في الشات', 'محاولة واحدة لكل متسابق', 'الأسرع في الإجابة الصحيحة يتصدر']),
  g('race', 'سباق الجمهور', 'group', 'المسجلون يندفعون نحو خط النهاية بأوامر الشات', ['اكتب !go أو انطلق للتقدم', 'خطوة كل 1.2 ثانية كحد أقصى', 'أول من يصل الهدف يفوز']),
  g('glass', 'الجسر الزجاجي', 'elimination', 'اختر اللوح الآمن في كل خطوة؛ الخطأ يقصي المتسابق', ['اكتب 1 أو 2 لكل خطوة', 'اللوح الخطأ أو الصمت يقصيان', 'من يعبر الجسر يفوز']),
  g('truefalse', 'حقيقة أم كذب', 'smart', 'عبارة في كل جولة: صح أم خطأ؟', ['اكتب صح أو خطأ (أو 1 / 2)', 'إجابة واحدة لكل جولة', 'المجموع الأعلى يفوز']),
  g('higherlower', 'أعلى أم أقل', 'smart', 'هل الورقة التالية أعلى أم أقل من الحالية؟', ['اكتب أعلى أو أقل (أو 1 / 2)', 'الإجابة الصحيحة +2 والأسرع يحصل على مكافأة', 'المجموع الأعلى يفوز']),
  g('minority', 'الأقلية تفوز', 'smart', 'خياران — الجهة الأقل عددًا تنجو', ['اكتب 1 أو 2', 'الأغلبية والصامتون يُقصون', 'آخر ناجٍ يفوز'], { minPlayers: 3 }),
  g('wheel', 'عجلة الأسماء', 'luck', 'قرعة مباشرة لاختيار فائز واحد', ['كل المسجلين يدخلون السحب تلقائيًا', 'المضيف يضغط زر السحب', 'اسم واحد يفوز'])
]);
export const ALL_GAMES = Object.freeze([...GAMES, ...EXTRA_GAMES]);

export const UPDATES = Object.freeze([
  { version: '1.0', date: '2026-11-04', items: ['هوية سبونج لايف البحرية', 'ألعاب جديدة: خمن الرسمة، كراسي موسيقية، اسم حيوان جماد نبات، الأدوار المخفية، الروليت، خمن الدولة، خمن العلم', 'حجرة ورقة مقص بمواجهات ثنائية', 'صفحة انضمام لكل لعبة دون غرف أو رموز'] },
  { version: '0.9', date: '2026-11-04', items: ['صفحة انضمام لكل لعبة: اكتب انضم في الشات، وزر «شارك كلاعب» للمشرف', 'ست ألعاب جديدة: حجر ورقة مقص، الأقلية تفوز، أعلى أم أقل، حقيقة أم كذب، الضوء الأحمر، البولينج', 'لوحة الستريمر بثلاثة أوضاع توزيع', 'حسابات المستخدمين وغرفة خاصة لكل حساب', 'ربط Kick (تجريبي)', 'صفحة الرسم'] },
  { version: '0.8', date: '2026-11-03', items: ['تصميم Royal Black & Gold', 'تأثيرات Aurum المستوحاة من Aceternity'] },
  { version: '0.7', date: '2026-10-28', items: ['القنبلة المؤقتة', 'تسجيل المتابعين والمشتركين فقط'] }
]);

const money = (raw, fallback) => {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value < 100000 ? Math.round(value * 100) / 100 : fallback;
};
const safeUrl = (raw) => {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try {
    const url = new URL(raw.trim());
    return ['https:', 'mailto:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
};
const safeText = (raw, fallback, max = 40) => (typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, max) : fallback);

// Prices, support channel and season name are owner settings (environment variables), not code.
export function siteConfig(env = process.env) {
  const monthly = money(env.SKY_PRICE_MONTHLY, 29);
  const annual = money(env.SKY_PRICE_ANNUAL, 290);
  return {
    games: GAMES,
    extraGames: EXTRA_GAMES,
    gameCount: GAMES.length,
    eliminationCount: GAMES.filter((x) => x.category === 'elimination').length,
    categories: CATEGORIES,
    maxPlayers: 1500,
    season: safeText(env.SKY_SEASON_NAME, 'موسم الأبطال 1', 40),
    pricing: {
      currency: safeText(env.SKY_CURRENCY, 'ريال', 12),
      monthly,
      annual,
      annualSaving: Math.max(0, Math.round((monthly * 12 - annual) * 100) / 100)
    },
    support: { url: safeUrl(env.SKY_SUPPORT_URL), label: safeText(env.SKY_SUPPORT_LABEL, 'تواصل مع فريق سبونج لايف') }
  };
}
