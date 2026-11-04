// SPONGE LIVE — rules for the Bikini Bottom game set (no UI here, so every rule is testable).
//
//   drawguess   خمن الرسمة            — the host draws a secret word; first correct chat guess scores
//   chairs      كراسي موسيقية         — music plays, stops, the first to write «اجلس» take the seats
//   categories  اسم حيوان جماد نبات   — the chosen player answers a letter + category within 15 s
//   rps         حجرة ورقة مقص (duel)  — players are paired; both reveal together; loser leaves
//   roles       الأدوار المخفية        — secret roles, private role page, night actions and chat votes
//   roulette    الروليت               — a server-picked fair spin eliminates (or crowns) a player
//   country     خمن الدولة            — three clues revealed over time, Arabic spellings accepted
//   flag        خمن العلم             — a flag on screen, fastest correct answers score more
import { randomInt } from 'node:crypto';
import { RoundGame, POINTS, norm, firstNumber, pub } from './round-game.mjs';
import { COUNTRIES, matchCountry } from './countries.mjs';
import { DRAW_WORDS, LETTERS, CATEGORIES, CATEGORY_WORDS } from './word-banks.mjs';

export const SEA_MIN_PLAYERS = { drawguess: 1, chairs: 2, categories: 1, roles: 4, roulette: 2, country: 1, flag: 1 };
export const SEA_DEFAULTS = {
  drawguess: { rounds: 5, seconds: 70 },
  chairs: { rounds: 40, seconds: 6 },
  categories: { rounds: 12, seconds: 15, scoring: 'elimination' },
  roles: { rounds: 12, seconds: 45 },
  roulette: { rounds: 40, seconds: 7 },
  country: { rounds: 8, seconds: 30 },
  flag: { rounds: 10, seconds: 15 }
};
const GUESS_GAP_MS = 1200; // one guess per player every 1.2 s (spam guard)
const stripAl = (k) => (k.startsWith('ال') && k.length > 3 ? k.slice(2) : k);
const shuffle = (list, random) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = random(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const byElimination = (a, b) => (b.alive - a.alive) || ((b.eliminatedRound ?? 1e9) - (a.eliminatedRound ?? 1e9)) || (b.points - a.points) || a.number - b.number;
const byPoints = (a, b) => b.points - a.points || b.correct - a.correct || a.correctMs - b.correctMs || a.number - b.number;

/* ------------- shared: open guessing (many attempts, first correct answers score) ------------- */
class GuessGame extends RoundGame {
  constructor(mode, o) { super(mode, o); this.maxWinners = Infinity; this.lastGuess = new Map(); }
  nextRound() { super.nextRound(); this.solved = []; }
  canGuess() { return true; }
  input(id, message, at = this.now()) {
    if (this.finished || this.phase !== 'input' || at > this.endsAt) return false;
    const p = this.roster.get(id);
    if (!p || !p.alive || !this.canGuess(p) || this.solved.some((s) => s.id === id)) return false;
    if (at - (this.lastGuess.get(id) ?? -Infinity) < GUESS_GAP_MS) return false;
    this.lastGuess.set(id, at); this.totalInputs++;
    if (!this.isCorrect(message)) return true;
    const order = this.solved.length, pts = this.pointsFor(order, at);
    p.points += pts; p.correct++; p.correctMs += at - this.phaseStartedAt;
    this.solved.push({ id, at, points: pts });
    const eligible = [...this.roster.values()].filter((x) => x.alive && this.canGuess(x)).length;
    if (this.solved.length >= Math.min(this.maxWinners, eligible)) this.endsAt = Math.min(this.endsAt, at + 600);
    return true;
  }
  pointsFor(order) { return [10, 8, 6, 5, 4, 3, 2, 1][Math.min(order, 7)]; }
  solvedView() { return this.solved.map((s) => ({ ...pub(this.roster.get(s.id)), points: s.points })); }
  isOver() { return this.round >= this.rounds; }
  rank() { return [...this.roster.values()].sort(byPoints); }
  detail(p) { return `${p.points} نقطة • ${p.correct} إجابة صحيحة`; }
  standings() { return [...this.roster.values()].sort(byPoints).slice(0, 10).map((p) => ({ ...pub(p), points: p.points })); }
}

/* ---------------- خمن الرسمة ---------------- */
class DrawGuess extends GuessGame {
  constructor(o) { super('drawguess', o); this.maxWinners = Number(this.opts.winners) > 0 ? Number(this.opts.winners) : 1; }
  setup() { this.deck = DRAW_WORDS.map((_, i) => i); }
  prepareRound() {
    if (!this.deck.length) this.deck = DRAW_WORDS.map((_, i) => i);
    const [word, aliases] = DRAW_WORDS[this.deck.splice(this.random(this.deck.length), 1)[0]];
    this.word = word; this.keys = new Set([word, ...aliases].map((w) => stripAl(norm(w))));
  }
  /** The drawing host knows the word, so the host seat never guesses. */
  canGuess(p) { return !p.host; }
  isCorrect(message) { return this.keys.has(stripAl(norm(message))); }
  resolve() { this.reveal = { word: this.word, solved: this.solvedView() }; }
  /** Letters stay hidden; the first letter appears after half the time (as a hint). */
  mask() {
    const letters = Array.from(this.word);
    const showFirst = this.phase === 'input' && this.now() - this.phaseStartedAt >= this.seconds * 500;
    return letters.map((ch, i) => (ch === ' ' ? ' ' : (i === 0 && showFirst) || this.phase !== 'input' ? ch : '_')).join('');
  }
  secret() { return this.finished ? null : { word: this.word, round: this.round }; }
  view() { return { prompt: 'خمّن ما يرسمه المشرف واكتب الإجابة في الشات', mask: this.word ? this.mask() : '', letters: Array.from(this.word || '').filter((c) => c !== ' ').length, solved: this.solvedView(), players: this.standings() }; }
}

/* ---------------- خمن الدولة / خمن العلم ---------------- */
class CountryGame extends GuessGame {
  constructor(mode, o) { super(mode, o); }
  setup() { this.deck = COUNTRIES.map((_, i) => i); }
  prepareRound() {
    if (!this.deck.length) this.deck = COUNTRIES.map((_, i) => i);
    this.country = COUNTRIES[this.deck.splice(this.random(this.deck.length), 1)[0]];
  }
  isCorrect(message) { return matchCountry(message) === this.country.iso; }
  resolve() { this.reveal = { iso: this.country.iso, name: this.country.name, capital: this.country.capital, solved: this.solvedView() }; }
}
class GuessCountry extends CountryGame {
  constructor(o) { super('country', o); }
  /** Clues open over time; earlier correct answers are worth more. */
  cluesShown() { if (this.phase !== 'input') return 3; const f = (this.now() - this.phaseStartedAt) / (this.seconds * 1000); return f < 1 / 3 ? 1 : f < 2 / 3 ? 2 : 3; }
  pointsFor(order) { return Math.max(1, [10, 8, 6, 5, 4, 3, 2, 1][Math.min(order, 7)] - (this.cluesShown() - 1) * 2); }
  view() {
    const c = this.country, n = this.cluesShown();
    const clues = c ? [`القارة: ${c.continent}`, `معلم شهير: ${c.clue}`, `عاصمتها تبدأ بحرف «${Array.from(c.capital)[0]}»`].slice(0, n) : [];
    return { prompt: 'ما هي الدولة؟ اكتب اسمها في الشات', clues, clueCount: 3, solved: this.solvedView(), players: this.standings() };
  }
}
class GuessFlag extends CountryGame {
  constructor(o) { super('flag', o); }
  view() { return { prompt: 'لمن هذا العلم؟ اكتب اسم الدولة', flag: this.country?.iso || null, solved: this.solvedView(), players: this.standings() }; }
}

/* ---------------- كراسي موسيقية ---------------- */
const SIT_WORDS = ['اجلس', 'جلوس', 'كرسي', 'sit', '1', '🪑'];
class MusicalChairs extends RoundGame {
  constructor(o) { super('chairs', o); this.revealMs = 3500; }
  nextRound() {
    this.round++; this.inputs = new Map(); this.reveal = null; this.early = new Set(); this.seated = [];
    const n = this.alive.length;
    this.seats = Math.max(1, n - Math.max(1, Math.ceil(n / 4)));
    this.phase = 'music'; this.phaseStartedAt = this.now(); this.endsAt = this.phaseStartedAt + 5000 + this.random(6) * 1000;
  }
  isSit(message) { const raw = String(message).trim(), k = norm(raw); return SIT_WORDS.some((w) => w === raw || (k && norm(w) === k)); }
  input(id, message, at = this.now()) {
    if (this.finished) return false;
    const p = this.roster.get(id); if (!p || !p.alive || !this.isSit(message)) return false;
    if (this.phase === 'music') { if (this.early.has(id)) return false; this.early.add(id); this.totalInputs++; return true; }
    if (this.phase !== 'input' || at > this.endsAt || this.early.has(id) || this.seated.includes(id)) return false;
    this.seated.push(id); this.totalInputs++;
    if (this.seated.length >= this.seats) this.endsAt = Math.min(this.endsAt, at + 400);
    return true;
  }
  tick() {
    if (this.finished) return false;
    const t = this.now(); if (t < this.endsAt) return false;
    if (this.phase === 'music') { this.phase = 'input'; this.phaseStartedAt = t; this.endsAt = t + this.seconds * 1000; return true; }
    if (this.phase === 'input') { this.resolve(); this.phase = 'reveal'; this.phaseStartedAt = t; this.endsAt = t + this.revealMs; return true; }
    if (this.isOver()) this.finish('complete'); else this.nextRound();
    return true;
  }
  resolve() {
    const alive = this.alive, keep = new Set(this.seated.slice(0, this.seats));
    let out = [], note = '';
    if (!keep.size) note = 'لم يجلس أحد — تعاد الجولة بنفس المقاعد';
    else { out = alive.filter((p) => !keep.has(p.id)); out.forEach((p) => this.eliminate(p)); }
    for (const id of keep) this.roster.get(id).wins++;
    this.reveal = { seats: this.seats, seated: [...keep].map((id) => pub(this.roster.get(id))), eliminated: out.slice(0, 30).map((p) => ({ ...pub(p), early: this.early.has(p.id) })), eliminatedCount: out.length, early: this.early.size, note };
  }
  isOver() { return this.alive.length <= (this.roster.size > 1 ? 1 : 0) || this.round >= this.rounds; }
  rank() { return [...this.roster.values()].sort((a, b) => byElimination(a, b) || b.wins - a.wins); }
  detail(p) { return p.alive ? `جلس في ${p.wins} جولات` : `خرج في الجولة ${p.eliminatedRound}`; }
  view() {
    const seated = new Set(this.seated || []);
    return { prompt: this.phase === 'music' ? 'الموسيقى تعمل… انتظر حتى تتوقف ولا تكتب الآن' : this.phase === 'input' ? 'توقفت الموسيقى! اكتب «اجلس» بسرعة' : 'نتيجة الجولة',
      music: this.phase === 'music', seats: this.seats, seatedCount: seated.size,
      players: this.alive.slice(0, 30).map((p) => ({ ...pub(p), seated: seated.has(p.id) })) };
  }
  summary() { return 'آخر من بقي على الكرسي'; }
}

/* ---------------- اسم حيوان جماد نبات إنسان ---------------- */
const BANK = Object.fromEntries(Object.entries(CATEGORY_WORDS).map(([k, words]) => [k, new Set(words.map((w) => stripAl(norm(w))))]));
const letterKey = (l) => norm(l);
function lettersFor(category) { return LETTERS.filter((l) => [...BANK[category]].some((w) => w.startsWith(letterKey(l)))); }
class Categories extends RoundGame {
  constructor(o) { super('categories', o); this.scoring = this.opts.scoring === 'points' ? 'points' : 'elimination'; this.judgeMs = 10_000; }
  setup() { this.turn = -1; }
  nextRound() {
    this.round++; this.inputs = new Map(); this.reveal = null; this.answer = null;
    const alive = this.alive; if (!alive.length) { this.finish('complete'); return; }
    this.turn = (this.turn + 1) % alive.length;
    this.chosen = alive[this.turn].id;
    const keys = Object.keys(CATEGORIES); this.category = keys[this.random(keys.length)];
    const pool = lettersFor(this.category); this.letter = pool[this.random(pool.length)];
    this.phase = 'input'; this.phaseStartedAt = this.now(); this.endsAt = this.phaseStartedAt + this.seconds * 1000;
  }
  /** Only the chosen player answers; the first message that looks like an answer counts. */
  input(id, message, at = this.now()) {
    if (this.finished || this.phase !== 'input' || at > this.endsAt || id !== this.chosen || this.answer) return false;
    const text = String(message).trim(); if (!text || text.length > 30 || text.split(/\s+/).length > 3) return false;
    this.answer = { text, at, verdict: this.check(text) }; this.totalInputs++;
    this.endsAt = at; // answered: resolve right away
    return true;
  }
  check(text) {
    const k = stripAl(norm(text)), first = stripAl(norm(text.split(/\s+/)[0]));
    if (!k.startsWith(letterKey(this.letter)) && !first.startsWith(letterKey(this.letter))) return 'wrong';
    return BANK[this.category].has(k) || BANK[this.category].has(first) ? 'right' : 'judge';
  }
  /** Host decision for a word that is not in the built-in list. */
  judge(accept) { if (this.phase !== 'judge') return false; this.settle(!!accept, accept ? 'قبله المشرف' : 'رفضه المشرف'); return true; }
  tick() {
    if (this.finished) return false;
    const t = this.now(); if (t < this.endsAt) return false;
    if (this.phase === 'input') {
      if (this.answer?.verdict === 'judge') { this.phase = 'judge'; this.phaseStartedAt = t; this.endsAt = t + this.judgeMs; return true; }
      this.settle(this.answer?.verdict === 'right', this.answer ? (this.answer.verdict === 'right' ? 'إجابة صحيحة' : 'لا تبدأ بالحرف المطلوب') : 'انتهى الوقت');
      return true;
    }
    // No decision from the host in time: the benefit of the doubt goes to the player.
    if (this.phase === 'judge') { this.settle(true, 'قُبلت تلقائيًا'); return true; }
    if (this.phase === 'reveal') { if (this.isOver()) this.finish('complete'); else this.nextRound(); return true; }
    return false;
  }
  settle(ok, why) {
    const p = this.roster.get(this.chosen);
    if (ok) { p.points += 5; p.correct++; }
    else if (this.scoring === 'elimination') this.eliminate(p);
    else p.points = Math.max(0, p.points - 3);
    if (!ok && this.scoring === 'elimination') this.turn--; // the next player keeps the rotation order
    this.reveal = { player: pub(p), answer: this.answer?.text || null, ok, why, letter: this.letter, category: CATEGORIES[this.category] };
    this.phase = 'reveal'; this.phaseStartedAt = this.now(); this.endsAt = this.phaseStartedAt + this.revealMs;
  }
  isOver() { return this.scoring === 'elimination' ? this.alive.length <= (this.roster.size > 1 ? 1 : 0) || this.round >= this.rounds * 4 : this.round >= this.rounds; }
  rank() { return [...this.roster.values()].sort(this.scoring === 'elimination' ? byElimination : byPoints); }
  detail(p) { return this.scoring === 'elimination' && !p.alive ? `خرج في الجولة ${p.eliminatedRound}` : `${p.correct} إجابات صحيحة`; }
  view() {
    const p = this.roster.get(this.chosen);
    return { prompt: p ? `دور ${p.name}: ${CATEGORIES[this.category]} يبدأ بحرف «${this.letter}»` : '', letter: this.letter, category: CATEGORIES[this.category], chosen: p ? pub(p) : null,
      judging: this.phase === 'judge', answer: this.phase === 'judge' ? this.answer?.text : null, scoring: this.scoring,
      players: [...this.roster.values()].sort(this.scoring === 'elimination' ? byElimination : byPoints).slice(0, 24).map((x) => ({ ...pub(x), alive: x.alive, points: x.points })) };
  }
}

/* ---------------- حجرة ورقة مقص — مواجهات ثنائية ---------------- */
const RPS = [['حجرة', ['حجره', 'حجر', '1', 'rock', '✊', '👊']], ['ورقة', ['ورقه', '2', 'paper', '✋', '🖐', '🖐️']], ['مقص', ['مقص', '3', 'scissors', '✌', '✌️']]];
class RpsDuel extends RoundGame {
  constructor(o) { super('rps', o); this.revealMs = 4000; }
  prepareRound() {
    const order = shuffle(this.alive, this.random);
    this.duels = []; this.bye = null;
    for (let i = 0; i + 1 < order.length; i += 2) this.duels.push([order[i].id, order[i + 1].id]);
    if (order.length % 2) this.bye = order[order.length - 1].id;
  }
  parse(message) {
    const raw = String(message).trim(), key = norm(raw);
    const i = RPS.findIndex(([, words]) => words.some((w) => w === raw || (key && norm(w) === key)));
    return i >= 0 ? i : null;
  }
  resolve() {
    const results = [], out = [];
    const lastTwo = this.alive.length === 2;
    for (const [a, b] of this.duels) {
      const pa = this.roster.get(a), pb = this.roster.get(b);
      const va = this.inputs.get(a)?.value, vb = this.inputs.get(b)?.value;
      let winner = null, loser = [], note = '';
      if (va === undefined && vb === undefined) { if (lastTwo) note = 'لم يختر أحد — تعاد المواجهة'; else { loser = [pa, pb]; note = 'لم يختر أحد'; } }
      else if (va === undefined) { winner = pb; loser = [pa]; note = 'لم يختر'; }
      else if (vb === undefined) { winner = pa; loser = [pb]; note = 'لم يختر'; }
      else if (va === vb) note = 'تعادل — تعاد المواجهة';
      else { const aWins = (va - vb + 3) % 3 === 1; winner = aWins ? pa : pb; loser = [aWins ? pb : pa]; }
      if (winner) winner.wins++;
      loser.forEach((p) => { this.eliminate(p); out.push(p); });
      results.push({ a: { ...pub(pa), pick: va ?? null }, b: { ...pub(pb), pick: vb ?? null }, winner: winner ? winner.id : null, note });
    }
    this.reveal = { results: results.slice(0, 12), duels: results.length, bye: this.bye ? pub(this.roster.get(this.bye)) : null, eliminated: out.slice(0, 30).map(pub), eliminatedCount: out.length };
  }
  isOver() { return this.alive.length <= (this.roster.size > 1 ? 1 : 0) || this.round >= this.rounds; }
  rank() { return [...this.roster.values()].sort((a, b) => byElimination(a, b) || b.wins - a.wins); }
  detail(p) { return p.alive ? `فاز في ${p.wins} مواجهات` : `خرج في الجولة ${p.eliminatedRound}`; }
  view() {
    const picked = (id) => this.inputs.has(id);
    return { prompt: 'مواجهات ثنائية: اكتب حجرة أو ورقة أو مقص — يُكشف الاختياران معًا', choices: RPS.map(([l]) => l),
      duels: (this.duels || []).slice(0, 12).map(([a, b]) => ({ a: { ...pub(this.roster.get(a)), ready: picked(a) }, b: { ...pub(this.roster.get(b)), ready: picked(b) } })),
      duelCount: this.duels?.length || 0, bye: this.bye ? pub(this.roster.get(this.bye)) : null };
  }
  summary() { return 'بطل المواجهات'; }
}

/* ---------------- الروليت ---------------- */
class Roulette extends RoundGame {
  constructor(o) { super('roulette', o); this.revealMs = 3500; }
  setup() { this.rule = ['eliminate', 'winner'].includes(this.opts.rule) ? this.opts.rule : (this.roster.size > 16 ? 'winner' : 'eliminate'); }
  nextRound() {
    this.round++; this.reveal = null; this.inputs = new Map();
    const alive = this.alive;
    // Fair pick on the server; the wheel shows up to 24 names and always includes the result.
    const pickIndex = this.random(alive.length), picked = alive[pickIndex];
    let wheel = alive;
    if (wheel.length > 24) { const others = shuffle(alive.filter((p) => p.id !== picked.id), this.random).slice(0, 23); wheel = shuffle([...others, picked], this.random); }
    this.wheel = wheel.map(pub); this.target = this.wheel.findIndex((p) => p.id === picked.id); this.picked = picked.id;
    this.phase = 'input'; this.phaseStartedAt = this.now(); this.endsAt = this.phaseStartedAt + this.seconds * 1000;
  }
  input() { return false; }
  resolve() {
    const p = this.roster.get(this.picked);
    if (this.rule === 'eliminate') this.eliminate(p); else p.wins++;
    this.reveal = { picked: pub(p), rule: this.rule };
  }
  isOver() { return this.rule === 'winner' || this.alive.length <= 1 || this.round >= this.rounds; }
  rank() {
    if (this.rule === 'winner') return [...this.roster.values()].sort((a, b) => b.wins - a.wins || a.number - b.number);
    return [...this.roster.values()].sort(byElimination);
  }
  detail(p) { return this.rule === 'winner' ? (p.wins ? 'اختارته العجلة' : 'شارك في السحب') : p.alive ? 'نجا من العجلة' : `خرج في الدورة ${p.eliminatedRound}`; }
  view() { return { prompt: this.rule === 'winner' ? 'العجلة تختار الفائز' : 'العجلة تُقصي لاعبًا في كل دورة — آخر من يبقى يفوز', wheel: this.wheel, target: this.target, rule: this.rule, spinMs: this.seconds * 1000 }; }
  summary() { return this.rule === 'winner' ? 'اختارته العجلة' : 'آخر من بقي'; }
}

/* ---------------- الأدوار المخفية ---------------- */
export const ROLE_LABELS = { impostor: 'المخادع', detective: 'المحقق', citizen: 'مواطن' };
const ROLE_PHASES = { assign: 40_000, night: 25_000 };
class HiddenRoles extends RoundGame {
  constructor(o) { super('roles', o); this.revealMs = 5000; this.codes = new Map(); this.tokens = new Map(); this.log = []; }
  setup() {
    const ids = shuffle([...this.roster.keys()], this.random), n = ids.length;
    const impostors = Math.max(1, Math.floor(n / 5));
    this.roles = new Map(ids.map((id, i) => [id, i < impostors ? 'impostor' : i === impostors && n >= 5 ? 'detective' : 'citizen']));
    this.inspected = new Map(); this.revealed = new Map(); this.winner = null;
  }
  nextRound() { this.round++; this.enter('assign', ROLE_PHASES.assign); }
  enter(phase, ms) { this.phase = phase; this.inputs = new Map(); this.phaseStartedAt = this.now(); this.endsAt = this.phaseStartedAt + ms; if (phase !== 'reveal') this.reveal = null; if (phase === 'night') this.nightVotes = new Map(); }
  /* private role page: a one-time code proves which chat user owns this browser */
  claim() {
    const token = randomInt(1e9).toString(36) + randomInt(1e9).toString(36) + randomInt(1e9).toString(36);
    let code; do { code = String(1000 + randomInt(9000)); } while (this.codes.has(code));
    this.codes.set(code, { token, at: this.now() });
    return { code, token };
  }
  privateView(token) {
    const id = this.tokens.get(token); if (!id) return { linked: false };
    const p = this.roster.get(id), role = this.roles.get(id);
    const others = this.alive.filter((x) => x.id !== id).map(pub);
    return { linked: true, player: pub(p), alive: p.alive, role, roleLabel: ROLE_LABELS[role], phase: this.phase, finished: this.finished,
      teammates: role === 'impostor' ? [...this.roles].filter(([pid, r]) => r === 'impostor' && pid !== id).map(([pid]) => pub(this.roster.get(pid))) : [],
      canAct: p.alive && this.phase === 'night' && (role === 'impostor' || role === 'detective'), targets: p.alive && this.phase === 'night' ? others : [],
      chosen: this.nightVotes?.get(id) ?? null,
      inspected: role === 'detective' ? [...this.inspected].map(([pid, r]) => ({ ...pub(this.roster.get(pid)), suspect: r === 'impostor' })) : [] };
  }
  act(token, number) {
    const id = this.tokens.get(token); if (!id || this.phase !== 'night') throw new Error('لا يوجد إجراء متاح الآن');
    const p = this.roster.get(id), role = this.roles.get(id);
    if (!p.alive || !['impostor', 'detective'].includes(role)) throw new Error('لا يوجد إجراء لدورك');
    const target = this.alive.find((x) => x.number === Number(number) && x.id !== id);
    if (!target) throw new Error('اختر لاعبًا من القائمة');
    if (role === 'detective') { if (this.nightVotes.has(id)) throw new Error('فحصت لاعبًا هذه الليلة'); this.inspected.set(target.id, this.roles.get(target.id)); }
    this.nightVotes.set(id, target.number);
    return true;
  }
  input(id, message, at = this.now()) {
    if (this.finished) return false;
    const text = String(message).trim();
    const claim = /^(?:دوري|دور|role)\s*([0-9٠-٩]{4})$/i.exec(text);
    if (claim) {
      const code = norm(claim[1]); const c = this.codes.get(code);
      if (!c || !this.roster.has(id) || this.now() - c.at > 15 * 60_000) return false;
      this.codes.delete(code); this.tokens.set(c.token, id); this.totalInputs++; return true;
    }
    if (this.phase !== 'day' || at > this.endsAt) return false;
    const p = this.roster.get(id); if (!p || !p.alive || this.inputs.has(id)) return false;
    const n = firstNumber(text.replace(/^(?:صوت|صوّت|vote)\s*/i, '').replace(/^#/, ''), 1, 99);
    const target = n && this.alive.find((x) => x.number === n);
    if (!target) return false;
    this.inputs.set(id, { value: target.id, at }); this.totalInputs++;
    return true;
  }
  tally() { const t = new Map(); for (const { value } of this.inputs.values()) t.set(value, (t.get(value) || 0) + 1); return t; }
  kill(p, how) { this.eliminate(p); this.revealed.set(p.id, this.roles.get(p.id)); this.reveal = { how, player: { ...pub(p), role: this.roles.get(p.id), roleLabel: ROLE_LABELS[this.roles.get(p.id)] } }; }
  checkWin() {
    const alive = this.alive, bad = alive.filter((p) => this.roles.get(p.id) === 'impostor').length;
    if (!bad) this.winner = 'citizens'; else if (bad >= alive.length - bad) this.winner = 'impostors';
    return !!this.winner;
  }
  tick() {
    if (this.finished) return false;
    const t = this.now(); if (t < this.endsAt) return false;
    if (this.phase === 'assign') { this.enter('night', ROLE_PHASES.night); return true; }
    if (this.phase === 'night') {
      const votes = [...this.nightVotes].filter(([id]) => this.roles.get(id) === 'impostor').map(([, n]) => n);
      const counts = new Map(); votes.forEach((n) => counts.set(n, (counts.get(n) || 0) + 1));
      const top = [...counts].sort((a, b) => b[1] - a[1])[0];
      const victim = top && this.alive.find((p) => p.number === top[0]);
      this.enter('reveal', this.revealMs); this.after = 'day';
      if (victim) this.kill(victim, 'night'); else this.reveal = { how: 'quiet' };
      return true;
    }
    if (this.phase === 'day') {
      const tally = [...this.tally()].sort((a, b) => b[1] - a[1]);
      const tie = tally.length > 1 && tally[0][1] === tally[1][1];
      const votes = Object.fromEntries(tally.map(([id, n]) => [this.roster.get(id).number, n]));
      this.enter('reveal', this.revealMs); this.after = 'night';
      if (tally.length && !tie) this.kill(this.roster.get(tally[0][0]), 'vote'); else this.reveal = { how: tally.length ? 'tie' : 'novotes' };
      this.reveal.votes = votes;
      return true;
    }
    if (this.phase === 'reveal') {
      if (this.checkWin() || this.round >= this.rounds) { if (!this.winner) this.winner = 'impostors'; this.finish('complete'); return true; }
      if (this.after === 'night') this.round++;
      this.enter(this.after, this.after === 'night' ? ROLE_PHASES.night : this.seconds * 1000);
      return true;
    }
    return false;
  }
  advance() { if (this.finished) return false; this.endsAt = this.now(); return this.tick(); }
  finish(reason) { super.finish(reason); for (const [id, r] of this.roles) this.revealed.set(id, r); }
  rank() {
    const won = (p) => (this.roles.get(p.id) === 'impostor') === (this.winner === 'impostors');
    return [...this.roster.values()].sort((a, b) => (won(b) - won(a)) || (b.alive - a.alive) || ((b.eliminatedRound ?? 1e9) - (a.eliminatedRound ?? 1e9)) || a.number - b.number);
  }
  detail(p) { return `${ROLE_LABELS[this.roles.get(p.id)]} • ${p.alive ? 'نجا' : 'خرج'}`; }
  summary() { return this.winner === 'citizens' ? 'فاز المواطنون' : 'فاز المخادعون'; }
  /** Public screen: roles appear only for revealed players. */
  view() {
    const tally = this.phase === 'day' ? Object.fromEntries([...this.tally()].map(([id, n]) => [this.roster.get(id).number, n])) : {};
    return { prompt: { assign: 'وُزّعت الأدوار سرًا — افتح صفحة دورك واكتب الرمز في الشات', night: 'الليل… المخادعون والمحقق يتصرفون من صفحاتهم الخاصة', day: 'النهار: ناقشوا ثم صوّتوا — اكتب «صوت» ورقم اللاعب', reveal: 'الكشف' }[this.phase] || '',
      winner: this.finished ? this.winner : null, linked: this.tokens.size, hiddenCount: [...this.roles.values()].filter((r) => r === 'impostor').length,
      players: [...this.roster.values()].sort((a, b) => (b.alive - a.alive) || a.number - b.number).slice(0, 40).map((p) => ({ ...pub(p), alive: p.alive, ...(this.revealed.has(p.id) ? { role: this.revealed.get(p.id), roleLabel: ROLE_LABELS[this.revealed.get(p.id)] } : {}), votes: tally[p.number] || 0 })) };
  }
  /** Host screen: every role, unless the host is playing too. */
  adminView(hostPlaying) { return hostPlaying ? { hidden: true } : { roles: [...this.roster.values()].map((p) => ({ ...pub(p), role: this.roles.get(p.id), roleLabel: ROLE_LABELS[this.roles.get(p.id)], alive: p.alive })) }; }
}

export const SEA_GAMES = { drawguess: DrawGuess, chairs: MusicalChairs, categories: Categories, roles: HiddenRoles, roulette: Roulette, country: GuessCountry, flag: GuessFlag };
export { RpsDuel };
