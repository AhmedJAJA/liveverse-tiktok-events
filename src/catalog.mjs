// SKY LIVE — single source for the game catalogue, pricing, support channel and
// release notes. The home page, the dashboard, the setup page and the server all
// read it (via /api/site), so counts and statuses never disagree.

export const CATEGORIES = Object.freeze({
  elimination: 'الإقصاء',
  group: 'الجماعية',
  smart: 'الذكاء والسرعة',
  luck: 'الحظ والمخاطرة'
});

const g = (mode, title, category, summary, rules, extra = {}) => Object.freeze({
  mode, title, category, categoryLabel: CATEGORIES[category], summary, rules: Object.freeze(rules),
  href: extra.href || `/event?mode=${mode}`, cover: `/covers/${mode}.svg`, status: 'available', minPlayers: extra.minPlayers || 1, ...extra
});

export const GAMES = Object.freeze([
  g('quiz', 'تحدي المعلومات', 'smart', 'أربعة خيارات ومؤقت تنازلي — الأسرع يتصدر', ['اكتب رقم الإجابة 1–4 في الشات', 'أول إجابة فقط تُحتسب', 'الترتيب حسب أسرع إجابة صحيحة']),
  g('bomb', 'القنبلة المؤقتة', 'elimination', 'مرّر القنبلة قبل الصفر — حاملها عند الانفجار يُقصى', ['حامل القنبلة يكتب !مرر ورقم لاعب', 'المؤقت لا يُعاد عند التمرير', 'آخر ناجٍ يفوز'], { href: '/bomb', minPlayers: 2 }),
  g('bowling', 'البولينج', 'luck', 'اختر رقمًا من 1 إلى 10 لترمي الكرة — رقم الحظ مخفي', ['اكتب رقمًا من 1 إلى 10 في كل إطار', 'الرقم المطابق للحارة المخفية يعطي ضربة كاملة', 'لا يوجد رقم فائز مضمون؛ الأعلى مجموعًا يفوز']),
  g('glass', 'الجسر الزجاجي', 'elimination', 'اختر اللوح الآمن في كل خطوة؛ الخطأ يقصي المتسابق', ['اكتب 1 أو 2 لكل خطوة', 'اللوح الخطأ أو الصمت يقصيان', 'من يعبر الجسر يفوز']),
  g('guess', 'خمّن الكلمة', 'smart', 'أول إجابة صحيحة في الشات تخطف الصدارة', ['اكتب تخمينك في الشات', 'محاولة واحدة لكل متسابق', 'الأسرع في الإجابة الصحيحة يتصدر']),
  g('race', 'سباق الجمهور', 'group', 'المسجلون يندفعون نحو خط النهاية بأوامر الشات', ['اكتب !go أو انطلق للتقدم', 'خطوة كل 1.2 ثانية كحد أقصى', 'أول من يصل الهدف يفوز']),
  g('truefalse', 'حقيقة أم كذب', 'smart', 'عبارة في كل جولة: صح أم خطأ؟ الأسرع يحصد نقاطًا أكثر', ['اكتب صح أو خطأ (أو 1 / 2)', 'إجابة واحدة لكل جولة', 'المجموع الأعلى بعد الجولات يفوز']),
  g('higherlower', 'أعلى أم أقل', 'smart', 'هل الورقة التالية أعلى أم أقل من الحالية؟', ['اكتب أعلى أو أقل (أو 1 / 2)', 'الإجابة الصحيحة +2 والأسرع ثلاثة يحصلون على مكافأة', 'المجموع الأعلى يفوز']),
  g('redlight', 'الضوء الأحمر', 'elimination', 'تقدّم عند الأخضر، وتجمّد عند الأحمر — الحركة تُقصيك', ['عند الأخضر اكتب رقمًا من 1 إلى 5 للتقدم (مرة لكل ضوء)', 'أي رقم عند الأحمر يقصيك', 'أول من يصل 20 خطوة يفوز']),
  g('wheel', 'عجلة الأسماء', 'luck', 'قرعة مباشرة لاختيار الفائز من المسجلين', ['كل المسجلين يدخلون السحب تلقائيًا', 'المضيف يضغط زر السحب', 'اسم واحد يفوز']),
  g('minority', 'الأقلية تفوز', 'smart', 'سؤالان وخياران — الجهة الأقل عددًا تنجو', ['اكتب 1 أو 2', 'الأغلبية والصامتون يُقصون', 'آخر ناجٍ يفوز'], { minPlayers: 3 }),
  g('rps', 'حجر ورقة مقص', 'elimination', 'تحدَّ Sky بثلاث حيوات — آخر من يبقى يفوز', ['اكتب حجر أو ورقة أو مقص', 'الخسارة أو الصمت يكلّفان حياة', 'ثلاث حيوات، وآخر باقٍ يفوز'])
]);

export const UPDATES = Object.freeze([
  { version: '0.9', date: '2026-11-04', items: ['ست ألعاب جديدة: حجر ورقة مقص، الأقلية تفوز، أعلى أم أقل، حقيقة أم كذب، الضوء الأحمر، البولينج', 'لوحة الستريمر بثلاثة أوضاع توزيع', 'حسابات المستخدمين وغرفة خاصة لكل حساب', 'ربط Kick (تجريبي)', 'صفحة الرسم Sky Draw'] },
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
    support: { url: safeUrl(env.SKY_SUPPORT_URL), label: safeText(env.SKY_SUPPORT_LABEL, 'تواصل مع فريق Sky Live') }
  };
}
