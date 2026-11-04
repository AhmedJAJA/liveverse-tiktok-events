// SPONGE LIVE — countries for «خمن الدولة» and «خمن العلم».
// Each entry: ISO code (flag file /flags/<iso>.svg), Arabic name, accepted spellings, continent,
// one well-known landmark/feature, and the capital. Facts kept to widely documented ones.
export const COUNTRIES = Object.freeze([
  { iso: 'sa', name: 'السعودية', aliases: ['المملكة العربية السعودية', 'المملكه', 'السعوديه', 'saudi', 'saudi arabia', 'ksa'], continent: 'آسيا', clue: 'فيها المسجد الحرام والمسجد النبوي', capital: 'الرياض' },
  { iso: 'eg', name: 'مصر', aliases: ['egypt', 'جمهورية مصر'], continent: 'أفريقيا', clue: 'أهرامات الجيزة وأبو الهول', capital: 'القاهرة' },
  { iso: 'ae', name: 'الإمارات', aliases: ['الامارات العربية المتحدة', 'الامارات', 'uae', 'emirates'], continent: 'آسيا', clue: 'فيها برج خليفة أطول مبنى في العالم', capital: 'أبوظبي' },
  { iso: 'kw', name: 'الكويت', aliases: ['kuwait'], continent: 'آسيا', clue: 'أبراج الكويت الثلاثة على ساحل الخليج', capital: 'مدينة الكويت' },
  { iso: 'qa', name: 'قطر', aliases: ['qatar'], continent: 'آسيا', clue: 'استضافت كأس العالم لكرة القدم 2022', capital: 'الدوحة' },
  { iso: 'bh', name: 'البحرين', aliases: ['bahrain'], continent: 'آسيا', clue: 'مملكة تتكوّن من مجموعة جزر في الخليج العربي', capital: 'المنامة' },
  { iso: 'om', name: 'عمان', aliases: ['سلطنة عمان', 'oman'], continent: 'آسيا', clue: 'قلعة نزوى وجبل شمس', capital: 'مسقط' },
  { iso: 'ye', name: 'اليمن', aliases: ['yemen'], continent: 'آسيا', clue: 'مدينة شبام ذات المباني الطينية العالية', capital: 'صنعاء' },
  { iso: 'iq', name: 'العراق', aliases: ['iraq'], continent: 'آسيا', clue: 'يجري فيها نهرا دجلة والفرات', capital: 'بغداد' },
  { iso: 'sy', name: 'سوريا', aliases: ['سورية', 'syria'], continent: 'آسيا', clue: 'فيها الجامع الأموي الكبير', capital: 'دمشق' },
  { iso: 'jo', name: 'الأردن', aliases: ['jordan'], continent: 'آسيا', clue: 'مدينة البتراء المنحوتة في الصخر الوردي', capital: 'عمّان' },
  { iso: 'lb', name: 'لبنان', aliases: ['lebanon'], continent: 'آسيا', clue: 'مغارة جعيتا وغابات الأرز', capital: 'بيروت' },
  { iso: 'ps', name: 'فلسطين', aliases: ['palestine'], continent: 'آسيا', clue: 'فيها المسجد الأقصى وقبة الصخرة', capital: 'القدس' },
  { iso: 'ma', name: 'المغرب', aliases: ['المملكة المغربية', 'morocco'], continent: 'أفريقيا', clue: 'مدينة شفشاون الزرقاء', capital: 'الرباط' },
  { iso: 'dz', name: 'الجزائر', aliases: ['algeria'], continent: 'أفريقيا', clue: 'أكبر دولة في أفريقيا مساحةً', capital: 'الجزائر' },
  { iso: 'tn', name: 'تونس', aliases: ['tunisia'], continent: 'أفريقيا', clue: 'قرية سيدي بوسعيد بالأبيض والأزرق', capital: 'تونس' },
  { iso: 'ly', name: 'ليبيا', aliases: ['libya'], continent: 'أفريقيا', clue: 'آثار لبدة الكبرى الرومانية', capital: 'طرابلس' },
  { iso: 'sd', name: 'السودان', aliases: ['sudan'], continent: 'أفريقيا', clue: 'يلتقي فيها النيل الأزرق بالنيل الأبيض', capital: 'الخرطوم' },
  { iso: 'tr', name: 'تركيا', aliases: ['turkey', 'turkiye', 'تركيه'], continent: 'آسيا وأوروبا', clue: 'مدينة إسطنبول تقع على قارتين', capital: 'أنقرة' },
  { iso: 'ir', name: 'إيران', aliases: ['iran'], continent: 'آسيا', clue: 'ساحة نقش جهان في أصفهان', capital: 'طهران' },
  { iso: 'pk', name: 'باكستان', aliases: ['pakistan'], continent: 'آسيا', clue: 'فيها قمة كي 2 ثاني أعلى جبل في العالم', capital: 'إسلام آباد' },
  { iso: 'in', name: 'الهند', aliases: ['india', 'هند'], continent: 'آسيا', clue: 'ضريح تاج محل', capital: 'نيودلهي' },
  { iso: 'cn', name: 'الصين', aliases: ['china', 'صين'], continent: 'آسيا', clue: 'سور الصين العظيم', capital: 'بكين' },
  { iso: 'jp', name: 'اليابان', aliases: ['japan', 'يابان'], continent: 'آسيا', clue: 'جبل فوجي وأزهار الكرز', capital: 'طوكيو' },
  { iso: 'kr', name: 'كوريا الجنوبية', aliases: ['كوريا', 'south korea', 'korea'], continent: 'آسيا', clue: 'موطن موسيقى الكي بوب', capital: 'سيول' },
  { iso: 'id', name: 'إندونيسيا', aliases: ['اندونيسيا', 'indonesia'], continent: 'آسيا', clue: 'أكبر دولة مسلمة من حيث عدد السكان وفيها جزيرة بالي', capital: 'جاكرتا' },
  { iso: 'my', name: 'ماليزيا', aliases: ['malaysia'], continent: 'آسيا', clue: 'برجا بتروناس التوأمان', capital: 'كوالالمبور' },
  { iso: 'th', name: 'تايلاند', aliases: ['thailand', 'تايلند'], continent: 'آسيا', clue: 'المعابد الذهبية وأسواق الماء العائمة', capital: 'بانكوك' },
  { iso: 'ru', name: 'روسيا', aliases: ['russia', 'روسيه'], continent: 'أوروبا وآسيا', clue: 'أكبر دولة في العالم مساحةً', capital: 'موسكو' },
  { iso: 'fr', name: 'فرنسا', aliases: ['france', 'فرنسه'], continent: 'أوروبا', clue: 'برج إيفل', capital: 'باريس' },
  { iso: 'gb', name: 'بريطانيا', aliases: ['المملكة المتحدة', 'انجلترا', 'انكلترا', 'uk', 'england', 'britain'], continent: 'أوروبا', clue: 'ساعة بيغ بن', capital: 'لندن' },
  { iso: 'de', name: 'ألمانيا', aliases: ['المانيا', 'germany'], continent: 'أوروبا', clue: 'بوابة براندنبورغ', capital: 'برلين' },
  { iso: 'it', name: 'إيطاليا', aliases: ['ايطاليا', 'italy'], continent: 'أوروبا', clue: 'برج بيزا المائل والكولوسيوم', capital: 'روما' },
  { iso: 'es', name: 'إسبانيا', aliases: ['اسبانيا', 'spain'], continent: 'أوروبا', clue: 'قصر الحمراء في غرناطة', capital: 'مدريد' },
  { iso: 'pt', name: 'البرتغال', aliases: ['portugal'], continent: 'أوروبا', clue: 'بلد اللاعب كريستيانو رونالدو', capital: 'لشبونة' },
  { iso: 'nl', name: 'هولندا', aliases: ['netherlands', 'holland'], continent: 'أوروبا', clue: 'طواحين الهواء وحقول التوليب', capital: 'أمستردام' },
  { iso: 'gr', name: 'اليونان', aliases: ['greece', 'يونان'], continent: 'أوروبا', clue: 'معبد البارثينون فوق الأكروبوليس', capital: 'أثينا' },
  { iso: 'ch', name: 'سويسرا', aliases: ['switzerland'], continent: 'أوروبا', clue: 'جبال الألب والساعات والشوكولاتة', capital: 'برن' },
  { iso: 'no', name: 'النرويج', aliases: ['norway'], continent: 'أوروبا', clue: 'المضايق البحرية (الفيوردات) والشفق القطبي', capital: 'أوسلو' },
  { iso: 'us', name: 'أمريكا', aliases: ['امريكا', 'الولايات المتحدة', 'الولايات المتحدة الامريكية', 'usa', 'america', 'us'], continent: 'أمريكا الشمالية', clue: 'تمثال الحرية', capital: 'واشنطن' },
  { iso: 'ca', name: 'كندا', aliases: ['canada'], continent: 'أمريكا الشمالية', clue: 'شلالات نياغارا وورقة القيقب', capital: 'أوتاوا' },
  { iso: 'mx', name: 'المكسيك', aliases: ['mexico', 'مكسيك'], continent: 'أمريكا الشمالية', clue: 'هرم تشيتشن إيتزا', capital: 'مكسيكو سيتي' },
  { iso: 'br', name: 'البرازيل', aliases: ['brazil', 'برازيل'], continent: 'أمريكا الجنوبية', clue: 'تمثال المسيح الفادي وغابات الأمازون', capital: 'برازيليا' },
  { iso: 'ar', name: 'الأرجنتين', aliases: ['الارجنتين', 'argentina'], continent: 'أمريكا الجنوبية', clue: 'بلد اللاعب ليونيل ميسي ورقصة التانغو', capital: 'بوينس آيرس' },
  { iso: 'au', name: 'أستراليا', aliases: ['استراليا', 'australia'], continent: 'أوقيانوسيا', clue: 'دار أوبرا سيدني وحيوان الكنغر', capital: 'كانبرا' },
  { iso: 'za', name: 'جنوب أفريقيا', aliases: ['جنوب افريقيا', 'south africa'], continent: 'أفريقيا', clue: 'جبل الطاولة في كيب تاون', capital: 'بريتوريا' },
  { iso: 'ng', name: 'نيجيريا', aliases: ['nigeria'], continent: 'أفريقيا', clue: 'أكثر دول أفريقيا سكانًا', capital: 'أبوجا' },
  { iso: 'ke', name: 'كينيا', aliases: ['kenya'], continent: 'أفريقيا', clue: 'محمية ماساي مارا للحياة البرية', capital: 'نيروبي' }
]);

import { norm } from './round-game.mjs';
/** Arabic-aware key: spelling variants, the definite article and spaces don't matter. */
export function countryKey(raw) {
  let k = norm(raw);
  if (k.startsWith('ال') && k.length > 3) k = k.slice(2);
  return k.replace(/^جمهوريه/, '').replace(/^دوله/, '');
}
const INDEX = new Map();
for (const c of COUNTRIES) for (const n of [c.name, ...c.aliases]) INDEX.set(countryKey(n), c.iso);
export function matchCountry(raw) { return INDEX.get(countryKey(raw)) || null; }
