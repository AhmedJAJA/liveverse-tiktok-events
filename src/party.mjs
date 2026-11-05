// SKY LIVE — round-based chat games.
// Each game is server-authoritative: the server owns every timer, accepts one input
// per player per round, ignores eliminated players and stale input, and produces
// a final ranking. The Engine wires them to chat, scoring and the broadcast screen.
//
//   rps         حجر ورقة مقص — vs. Sky, 3 lives, last one standing wins
//   minority    الأقلية تفوز  — two options, the smaller side survives
//   higherlower أعلى أم أقل   — guess the next card, points over N rounds
//   truefalse   حقيقة أم كذب — statement rounds, fastest correct answers score more
//   redlight    الضوء الأحمر  — move 1–5 steps on green; moving on red eliminates
//   bowling     البولينج      — pick 1–10 to roll; no number guarantees a strike

import { ROUND_DEFAULTS, POINTS, norm, firstNumber, pub, card, RoundGame } from './round-game.mjs';
import { SEA_GAMES, SEA_MIN_PLAYERS, SEA_DEFAULTS, RpsDuel } from './sea-games.mjs';
import { TEAM_GAMES, TEAM_MIN_PLAYERS, TEAM_DEFAULTS } from './team-games.mjs';
export { norm };
export const PARTY_MODES = ['rps', 'minority', 'higherlower', 'truefalse', 'redlight', 'bowling', ...Object.keys(SEA_GAMES), ...Object.keys(TEAM_GAMES)];
export const PARTY_MIN_PLAYERS = { rps: 2, minority: 3, higherlower: 1, truefalse: 1, redlight: 1, bowling: 1, ...SEA_MIN_PLAYERS, ...TEAM_MIN_PLAYERS };
export const PARTY_DEFAULTS = {
  rps: { rounds: 30, seconds: 15 },
  minority: { rounds: 10, seconds: 15 },
  higherlower: { rounds: 8, seconds: 12 },
  truefalse: { rounds: 8, seconds: 15 },
  redlight: { rounds: 16, seconds: 6, target: 20 },
  bowling: { rounds: 3, seconds: 12 },
  ...SEA_DEFAULTS,
  ...TEAM_DEFAULTS
};
Object.assign(ROUND_DEFAULTS, PARTY_DEFAULTS);

export const MINORITY_QUESTIONS = Object.freeze([
  ['قهوة', 'شاي'], ['صيف', 'شتاء'], ['بحر', 'بر'], ['قطط', 'كلاب'], ['سهر', 'نوم مبكر'], ['برجر', 'بيتزا'],
  ['السفر بالسيارة', 'السفر بالطائرة'], ['أفلام', 'مسلسلات'], ['فطور مالح', 'فطور حلو'], ['مدينة', 'ريف'],
  ['كتاب ورقي', 'كتاب إلكتروني'], ['آيس كريم فانيلا', 'آيس كريم شوكولاتة'], ['رسالة صوتية', 'رسالة نصية'],
  ['تمر', 'شوكولاتة'], ['مطر', 'شمس'], ['ألعاب فيديو', 'ألعاب لوحية'], ['جبل', 'صحراء'], ['كبسة', 'مندي'],
  ['الصباح', 'الليل'], ['المشي', 'الجري'], ['ماء بارد', 'ماء عادي'], ['الأسود', 'الأبيض'], ['عصير برتقال', 'عصير تفاح'],
  ['القراءة', 'الاستماع'], ['الصور', 'الفيديو'], ['تخييم', 'فندق'], ['الشاطئ', 'المسبح'], ['الحلو قبل الأكل', 'الحلو بعد الأكل'],
  ['المكالمة', 'الرسالة'], ['البيت', 'الكافيه']
]);

// Facts checked against standard references; true = «صح».
export const TRUE_FALSE = Object.freeze([
  ['الشمس نجم', true], ['القمر يضيء بنفسه', false], ['الحوت من الثدييات', true], ['عاصمة أستراليا هي سيدني', false],
  ['الماء يغلي عند 100 درجة مئوية عند مستوى سطح البحر', true], ['للعنكبوت ستة أرجل', false], ['نهر النيل يصب في البحر الأبيض المتوسط', true],
  ['البطريق طائر', true], ['المريخ أكبر من الأرض', false], ['أسرع حيوان بري هو الأسد', false], ['الألماس مكوّن من الكربون', true],
  ['الرياض عاصمة المملكة العربية السعودية', true], ['للمثلث أربعة أضلاع', false], ['ينتقل الصوت في الفراغ', false],
  ['المحيط الهادئ أكبر محيطات العالم', true], ['الخفاش طائر', false], ['الطماطم تُصنَّف علميًا ثمرة', true],
  ['جبل إيفرست أعلى قمة فوق مستوى سطح البحر', true], ['يلعب كل فريق كرة قدم بأحد عشر لاعبًا داخل الملعب', true],
  ['اليابان تقع في قارة أفريقيا', false], ['يتكوّن الماء من الهيدروجين والأكسجين', true], ['الثلج أثقل من الماء السائل بنفس الحجم', false],
  ['عطارد أقرب كواكب المجموعة الشمسية إلى الشمس', true], ['السنة الكبيسة 366 يومًا', true], ['الأسد يعيش في القطب الجنوبي', false],
  ['الضوء أسرع من الصوت', true], ['القاهرة عاصمة المغرب', false], ['النحل يصنع العسل', true], ['للأخطبوط ثلاثة قلوب', true],
  ['الزرافة أطول الحيوانات البرية', true], ['الموطن الأصلي للكنغر هو أمريكا الجنوبية', false], ['الدلفين يتنفس بالخياشيم', false],
  ['الكعبة المشرفة في مكة المكرمة', true], ['زحل أكبر كواكب المجموعة الشمسية', false], ['الحديد ينجذب إلى المغناطيس', true],
  ['الأرض هي الكوكب الثالث بعدًا عن الشمس', true], ['للإنسان قلبان', false], ['البحر الميت أخفض نقطة على اليابسة', true],
  ['الذهب يصدأ بسهولة', false], ['الأخضر لون ناتج من خلط الأزرق والأصفر', true]
]);

/* ---------------- حجر ورقة مقص ---------------- */
const RPS = [['حجر', ['حجر', '1', 'rock', '✊', '👊']], ['ورقة', ['ورقه', '2', 'paper', '✋', '🖐', '🖐️']], ['مقص', ['مقص', '3', 'scissors', '✌', '✌️']]];
class RockPaperScissors extends RoundGame {
  constructor(o) { super('rps', o); }
  prepareRound() { this.house = this.random(3); }
  parse(message) {
    const raw = String(message).trim(); const key = norm(raw);
    const i = RPS.findIndex(([, words]) => words.some((w) => w === raw || (key && norm(w) === key)));
    return i >= 0 ? i : null;
  }
  resolve() {
    const alive = this.alive, losers = [], winners = [];
    for (const p of alive) {
      const pick = this.inputs.get(p.id)?.value;
      const outcome = pick === undefined ? 2 : (pick - this.house + 3) % 3; // 0 tie, 1 win, 2 lose
      if (outcome === 2) losers.push(p); else if (outcome === 1) { winners.push(p); p.wins++; }
    }
    const out = losers.filter((p) => p.lives <= 1);
    let note = '';
    if (out.length && out.length === alive.length && alive.length > 1) note = 'الكل خسر آخر حياة — تبقى حياة واحدة للجميع';
    else for (const p of losers) { p.lives--; if (p.lives <= 0) this.eliminate(p); }
    if (note) for (const p of alive) p.lives = 1;
    this.reveal = { house: RPS[this.house][0], houseIndex: this.house, counts: this.counts(3), winners: winners.length, lost: losers.length,
      eliminated: note ? [] : out.map(pub), note };
  }
  isOver() { return this.alive.length <= (this.roster.size > 1 ? 1 : 0) || this.round >= this.rounds; }
  rank() {
    return [...this.roster.values()].sort((a, b) => (b.alive - a.alive) || ((b.eliminatedRound ?? 1e9) - (a.eliminatedRound ?? 1e9)) || (b.lives - a.lives) || (b.wins - a.wins) || a.number - b.number);
  }
  detail(p) { return p.alive ? `نجا بـ ${p.lives} ${p.lives === 1 ? 'حياة' : 'حيوات'}` : `خرج في الجولة ${p.eliminatedRound}`; }
  view() {
    return { prompt: 'اختر: حجر أو ورقة أو مقص — بوبل يكشف اختياره بعد الوقت', options: RPS.map(([l]) => l), counts: this.counts(3),
      players: [...this.roster.values()].filter((p) => p.alive).sort((a, b) => b.lives - a.lives || a.number - b.number).slice(0, 24).map((p) => ({ ...pub(p), lives: p.lives })) };
  }
  summary() { return this.alive.length === 1 ? 'آخر ناجٍ' : 'اكتملت الجولات'; }
}

/* ---------------- الأقلية تفوز ---------------- */
class MinorityWins extends RoundGame {
  constructor(o) { super('minority', o); }
  setup() { this.deck = MINORITY_QUESTIONS.map((_, i) => i); }
  prepareRound() {
    if (!this.deck.length) this.deck = MINORITY_QUESTIONS.map((_, i) => i);
    this.question = MINORITY_QUESTIONS[this.deck.splice(this.random(this.deck.length), 1)[0]];
  }
  parse(message) {
    const n = firstNumber(message, 1, 2); if (n) return n - 1;
    const key = norm(message); const i = this.question.findIndex((o) => norm(o) === key);
    return i >= 0 ? i : null;
  }
  resolve() {
    const alive = this.alive, [a, b] = this.counts(2);
    const losing = a === b ? -1 : a > b ? 0 : 1;
    const out = alive.filter((p) => { const v = this.inputs.get(p.id)?.value; return v === undefined || v === losing; });
    let note = '';
    if (out.length === alive.length) note = 'كان الإقصاء سيشمل الجميع — لا أحد يخرج هذه الجولة';
    else out.forEach((p) => this.eliminate(p));
    this.reveal = { counts: [a, b], minority: losing === -1 ? null : 1 - losing, tie: losing === -1, eliminated: note ? [] : out.slice(0, 30).map(pub), eliminatedCount: note ? 0 : out.length, note };
  }
  isOver() { return this.alive.length <= (this.roster.size > 1 ? 1 : 0) || this.round >= this.rounds; }
  rank() { return [...this.roster.values()].sort((a, b) => (b.alive - a.alive) || ((b.eliminatedRound ?? 1e9) - (a.eliminatedRound ?? 1e9)) || a.number - b.number); }
  detail(p) { return p.alive ? 'بقي مع الأقلية' : `خرج في الجولة ${p.eliminatedRound}`; }
  view() {
    return { prompt: `${this.question?.[0] ?? ''} أم ${this.question?.[1] ?? ''}؟ — الجهة الأقل تنجو`, options: this.question ? [...this.question] : [], counts: this.counts(2),
      players: this.alive.slice(0, 24).map(pub) };
  }
  summary() { return this.alive.length === 1 ? 'آخر من بقي مع الأقلية' : `${this.alive.length} ناجين`; }
}

/* ---------------- أعلى أم أقل ---------------- */
const UP = ['اعلي', 'اعلى', 'فوق', '1', 'high', 'higher', 'up', '⬆', '⬆️'], DOWN = ['اقل', 'تحت', '2', 'low', 'lower', 'down', '⬇', '⬇️'];
class HigherLower extends RoundGame {
  constructor(o) { super('higherlower', o); }
  setup() { this.current = this.random(13) + 1; }
  // Uniform over the 12 other cards, so the next card is never a tie (and never loops).
  prepareRound() { this.next = this.random(12) + 1; if (this.next >= this.current) this.next++; }
  parse(message) {
    const raw = String(message).trim(), key = norm(raw);
    if (UP.some((w) => w === raw || (key && norm(w) === key))) return 0;
    if (DOWN.some((w) => w === raw || (key && norm(w) === key))) return 1;
    return null;
  }
  resolve() {
    const right = this.next > this.current ? 0 : 1;
    const correct = [...this.inputs.entries()].filter(([, v]) => v.value === right).sort((a, b) => a[1].at - b[1].at);
    correct.forEach(([id, v], i) => { const p = this.roster.get(id); p.points += 2 + (i < 3 ? 3 - i : 0); p.correct++; p.correctMs += v.at - this.phaseStartedAt; });
    this.reveal = { from: card(this.current), to: card(this.next), toValue: this.next, right, counts: this.counts(2), correct: correct.length };
    this.current = this.next;
  }
  isOver() { return this.round >= this.rounds; }
  rank() { return [...this.roster.values()].sort((a, b) => b.points - a.points || b.correct - a.correct || a.correctMs - b.correctMs || a.number - b.number); }
  detail(p) { return `${p.points} نقطة لعب • ${p.correct} صحيحة`; }
  view() {
    return { prompt: `الورقة الحالية ${card(this.current)} — هل التالية أعلى أم أقل؟`, card: card(this.current), cardValue: this.current, options: ['أعلى', 'أقل'], counts: this.counts(2),
      players: this.standings() };
  }
  standings() { return [...this.roster.values()].sort((a, b) => b.points - a.points || a.number - b.number).slice(0, 10).map((p) => ({ ...pub(p), points: p.points })); }
}

/* ---------------- حقيقة أم كذب ---------------- */
const TRUE_WORDS = ['صح', 'صحيح', 'حقيقه', '1', 'true', 'yes', '✅', '✔', '✔️'], FALSE_WORDS = ['خطا', 'غلط', 'كذب', '2', 'false', 'no', '❌', '✖', '✖️'];
class TrueFalse extends RoundGame {
  constructor(o) { super('truefalse', o); }
  setup() { this.deck = TRUE_FALSE.map((_, i) => i); }
  prepareRound() {
    if (!this.deck.length) this.deck = TRUE_FALSE.map((_, i) => i);
    this.statement = TRUE_FALSE[this.deck.splice(this.random(this.deck.length), 1)[0]];
  }
  parse(message) {
    const raw = String(message).trim(), key = norm(raw);
    if (TRUE_WORDS.some((w) => w === raw || (key && norm(w) === key))) return 0;
    if (FALSE_WORDS.some((w) => w === raw || (key && norm(w) === key))) return 1;
    return null;
  }
  resolve() {
    const right = this.statement[1] ? 0 : 1;
    const correct = [...this.inputs.entries()].filter(([, v]) => v.value === right).sort((a, b) => a[1].at - b[1].at);
    correct.forEach(([id, v], i) => { const p = this.roster.get(id); p.points += [5, 4, 3][i] ?? 2; p.correct++; p.correctMs += v.at - this.phaseStartedAt; });
    this.reveal = { truth: this.statement[1], right, counts: this.counts(2), correct: correct.length };
  }
  isOver() { return this.round >= this.rounds; }
  rank() { return [...this.roster.values()].sort((a, b) => b.points - a.points || b.correct - a.correct || a.correctMs - b.correctMs || a.number - b.number); }
  detail(p) { return `${p.points} نقطة لعب • ${p.correct} صحيحة`; }
  view() { return { prompt: this.statement?.[0] ?? '', options: ['صح', 'خطأ'], counts: this.counts(2), players: HigherLower.prototype.standings.call(this) }; }
}

/* ---------------- الضوء الأحمر ---------------- */
const RED_GRACE_MS = 600; // chat latency allowance right after the light turns red
class RedLight extends RoundGame {
  constructor(o) { super('redlight', o); }
  start(players) { super.start(players); }
  nextRound() {
    // A "round" here is one green+red cycle. Green length varies so nobody can count it.
    this.round++; this.light = 'green'; this.phase = 'input'; this.moved = new Set(); this.inputs = new Map();
    this.phaseStartedAt = this.now(); this.endsAt = this.phaseStartedAt + (4000 + this.random(4) * 1000);
  }
  parse(message) { return firstNumber(message, 1, 5); }
  input(id, message, at = this.now()) {
    if (this.finished || this.phase !== 'input') return false;
    const p = this.roster.get(id); if (!p || !p.alive) return false;
    const steps = this.parse(message); if (steps === null) return false;
    // Messages that land just after red are treated as typed during green (chat latency); they never eliminate.
    const inGrace = this.light === 'red' && at - this.phaseStartedAt <= RED_GRACE_MS;
    if (this.light === 'red' && !inGrace) { this.eliminate(p); this.recentOut = [pub(p), ...(this.recentOut || [])].slice(0, 6); this.totalInputs++; this.checkEnd(); return true; }
    if (this.moved.has(id)) return false;
    this.moved.add(id); this.inputs.set(id, { value: steps, at }); this.totalInputs++;
    p.progress = Math.min(this.target, p.progress + steps);
    if (p.progress >= this.target && !p.finishedAt) { p.finishedAt = at; this.finish('complete'); }
    return true;
  }
  checkEnd() { if (!this.finished && this.alive.length === 0) this.finish('complete'); }
  tick() {
    if (this.finished) return false;
    const t = this.now(); if (t < this.endsAt) return false;
    if (this.light === 'green') { this.light = 'red'; this.phaseStartedAt = t; this.endsAt = t + 2000 + this.random(3) * 1000; return true; }
    if (this.alive.length <= 1 && this.roster.size > 1) { this.finish('complete'); return true; }
    if (this.round >= this.rounds) { this.finish('complete'); return true; }
    this.nextRound(); return true;
  }
  rank() {
    return [...this.roster.values()].sort((a, b) => ((a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity)) || (b.alive - a.alive) || (b.progress - a.progress) || a.number - b.number);
  }
  detail(p) { return p.finishedAt ? 'وصل خط النهاية' : p.alive ? `${p.progress} من ${this.target} خطوة` : `تحرّك في الأحمر عند ${p.progress}`; }
  view() {
    return { prompt: this.light === 'green' ? 'الضوء أخضر — اكتب رقمًا من 1 إلى 5 للتقدم' : 'الضوء أحمر — لا تكتب شيئًا!', light: this.light || 'green', target: this.target, options: [], counts: [],
      out: this.recentOut || [],
      track: [...this.roster.values()].sort((a, b) => (b.alive - a.alive) || b.progress - a.progress).slice(0, 10).map((p) => ({ ...pub(p), progress: p.progress, alive: p.alive })) };
  }
  snapshot() { const s = super.snapshot(); s.phaseMs = this.endsAt && this.phaseStartedAt ? this.endsAt - this.phaseStartedAt : 0; return s; }
  summary() { const first = this.rank()[0]; return first?.finishedAt ? 'أول من وصل' : 'الأبعد مسافة'; }
}

/* ---------------- البولينج ---------------- */
class Bowling extends RoundGame {
  constructor(o) { super('bowling', o); }
  prepareRound() { this.lucky = this.random(10) + 1; }
  parse(message) { return firstNumber(message, 1, 10); }
  resolve() {
    const rolls = [];
    for (const [id, { value }] of this.inputs) {
      const p = this.roster.get(id);
      // The closer the aim is to this frame's hidden sweet spot, the more pins fall — no number is a guaranteed win.
      const miss = Math.abs(value - this.lucky);
      const pins = miss === 0 ? 10 : Math.max(0, 10 - miss * 2 - this.random(2));
      const score = pins + (pins === 10 ? 5 : 0);
      p.total += score; p.frames.push(pins);
      rolls.push({ ...pub(p), pins, score, total: p.total });
    }
    for (const p of this.roster.values()) if (!this.inputs.has(p.id)) p.frames.push(0);
    rolls.sort((a, b) => b.pins - a.pins || b.total - a.total);
    this.reveal = { lucky: this.lucky, rolls: rolls.slice(0, 8), strikes: rolls.filter((r) => r.pins === 10).length };
  }
  isOver() { return this.round >= this.rounds; }
  rank() { return [...this.roster.values()].sort((a, b) => b.total - a.total || Math.max(...b.frames, 0) - Math.max(...a.frames, 0) || a.number - b.number); }
  detail(p) { return `${p.total} نقطة • ${p.frames.filter((f) => f === 10).length} ضربة كاملة`; }
  view() {
    return { prompt: 'اكتب نقطة التصويب من 1 إلى 10 — كلما اقتربت من النقطة المخفية سقطت قوارير أكثر', options: [], counts: [],
      lanes: [...this.roster.values()].sort((a, b) => b.total - a.total || a.number - b.number).slice(0, 8).map((p) => ({ ...pub(p), total: p.total, frames: p.frames.slice(-this.rounds) })) };
  }
}

const GAMES = { ...SEA_GAMES, ...TEAM_GAMES, rps: RockPaperScissors, minority: MinorityWins, higherlower: HigherLower, truefalse: TrueFalse, redlight: RedLight, bowling: Bowling };
export function createPartyGame(mode, options = {}) {
  // «حجرة ورقة مقص» runs as head-to-head duels; the original «vs Sky» format stays available.
  if (mode === 'rps' && options.format !== 'sky') return new RpsDuel(options);
  const Game = GAMES[mode];
  if (!Game) throw new Error('لعبة غير معروفة');
  return new Game(options);
}
