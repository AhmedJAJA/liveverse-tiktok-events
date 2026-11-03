// SKY LIVE — single source for the public game catalog, pricing and support channel.
// The homepage reads it through /api/site; the studio mode list is checked against it in tests.

export const GAMES = Object.freeze([
  { mode: 'quiz', title: 'تحدي المعلومات', category: 'ذكاء وسرعة', href: '/event?mode=quiz', cover: '/covers/quiz.svg', summary: 'أربعة خيارات ومؤقت تنازلي — الأسرع يتصدر' },
  { mode: 'bomb', title: 'القنبلة المؤقتة', category: 'إقصاء', href: '/bomb', cover: '/covers/bomb.svg', summary: 'مرّر القنبلة قبل أن تنفجر — حاملها عند الصفر يُقصى' },
  { mode: 'race', title: 'سباق الجمهور', category: 'جماعية', href: '/event?mode=race', cover: '/covers/race.svg', summary: 'المسجلون يندفعون نحو خط النهاية بأوامر الشات' },
  { mode: 'glass', title: 'الجسر الزجاجي', category: 'إقصاء', href: '/event?mode=glass', cover: '/covers/glass.svg', summary: 'اختر اللوح الآمن في كل خطوة؛ الخطأ يقصي المتسابق' },
  { mode: 'guess', title: 'خمّن الكلمة', category: 'ذكاء وسرعة', href: '/event?mode=guess', cover: '/covers/guess.svg', summary: 'أول إجابة صحيحة في الشات تخطف الصدارة' },
  { mode: 'wheel', title: 'عجلة الأسماء', category: 'حظ', href: '/event?mode=wheel', cover: '/covers/wheel.svg', summary: 'قرعة مباشرة لاختيار الفائز من المسجلين' }
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

// Prices and the support channel are owner settings (environment variables), not code.
export function siteConfig(env = process.env) {
  const monthly = money(env.SKY_PRICE_MONTHLY, 29);
  const annual = money(env.SKY_PRICE_ANNUAL, 290);
  return {
    games: GAMES,
    gameCount: GAMES.length,
    maxPlayers: 1500,
    pricing: {
      currency: safeText(env.SKY_CURRENCY, 'ريال', 12),
      monthly,
      annual,
      annualSaving: Math.max(0, Math.round((monthly * 12 - annual) * 100) / 100)
    },
    support: { url: safeUrl(env.SKY_SUPPORT_URL), label: safeText(env.SKY_SUPPORT_LABEL, 'تواصل مع فريق Sky Live') }
  };
}
