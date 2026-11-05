// سبونج لايف — team and secret-word chat games (rules only, no UI). Server-authoritative like the others.
//
//   tug       شد الحبل     — two balanced teams; every «شد» in chat pulls the rope; best of three pulls
//   outsider  برا السالفة  — everyone but one sees a secret word on their private page; find who is out of it
import { randomInt } from 'node:crypto';
import { norm, firstNumber, pub, RoundGame } from './round-game.mjs';

export const TEAM_MIN_PLAYERS = { tug: 2, outsider: 3 };
export const TEAM_DEFAULTS = {
  tug: { rounds: 3, seconds: 40, target: 40 },
  outsider: { rounds: 1, seconds: 75 },
};
const shuffle = (list, random) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = random(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ------------------------------------------------------------------ شد الحبل */
export const TUG_TEAMS = ['الأزرق', 'الأصفر'];
const PULL_GAP_MS = 600;            // one pull per player every 0.6 s (spam guard)
const PULL_WORDS = new Set(['شد', 'شدد', 'اسحب', 'pull', '1']);
export class TugOfWar extends RoundGame {
  constructor(o) { super('tug', o); this.revealMs = 4000; }
  setup() {
    // balanced by join order: odd numbers blue, even numbers yellow
    for (const p of this.roster.values()) { p.team = p.number % 2 === 1 ? 0 : 1; p.pulls = 0; p.lastPull = 0; }
    this.score = [0, 0]; this.roundWins = [];
  }
  nextRound() { super.nextRound(); this.rope = 0; this.roundPulls = [0, 0]; }
  get needed() { return Math.floor(this.rounds / 2) + 1; }
  parse(message) { return PULL_WORDS.has(norm(message).replace(/^!/, '')) ? 1 : null; }
  input(id, message, at = this.now()) {
    if (this.finished || this.phase !== 'input' || at > this.endsAt) return false;
    const p = this.roster.get(id); if (!p || this.parse(message) === null) return false;
    if (at - p.lastPull < PULL_GAP_MS) return false;
    // each side pulls in proportion to its size, so a bigger team does not win by numbers alone
    const size = [...this.roster.values()].filter((x) => x.team === p.team).length || 1;
    const other = this.roster.size - size || 1;
    p.lastPull = at; p.pulls++; this.totalInputs++; this.roundPulls[p.team]++;
    this.rope += (p.team === 0 ? -1 : 1) * Math.min(2, Math.max(0.5, other / size));
    if (Math.abs(this.rope) >= this.target) this.endsAt = at; // the rope crossed a line: the pull ends now
    return true;
  }
  resolve() {
    const w = this.rope === 0 ? (this.roundPulls[0] === this.roundPulls[1] ? null : this.roundPulls[0] > this.roundPulls[1] ? 0 : 1) : this.rope < 0 ? 0 : 1;
    if (w !== null) this.score[w]++;
    this.roundWins.push(w);
    this.reveal = { winner: w, team: w === null ? null : TUG_TEAMS[w], score: [...this.score] };
  }
  isOver() { return this.score[0] >= this.needed || this.score[1] >= this.needed || this.round >= this.rounds; }
  get winnerTeam() { return this.score[0] === this.score[1] ? null : this.score[0] > this.score[1] ? 0 : 1; }
  rank() {
    const w = this.winnerTeam;
    return [...this.roster.values()].sort((a, b) => ((b.team === w) - (a.team === w)) || b.pulls - a.pulls || a.number - b.number);
  }
  detail(p) { return `الفريق ${TUG_TEAMS[p.team]} • ${p.pulls} شدّة`; }
  summary() { const w = this.winnerTeam; return w === null ? 'تعادل الفريقان' : 'فاز الفريق ' + TUG_TEAMS[w] + ' ' + this.score[w] + '–' + this.score[1 - w]; }
  view() {
    const teams = [0, 1].map((t) => {
      const members = [...this.roster.values()].filter((p) => p.team === t).sort((a, b) => b.pulls - a.pulls || a.number - b.number);
      return { name: TUG_TEAMS[t], score: this.score[t], size: members.length, pulls: this.roundPulls?.[t] || 0, top: members.slice(0, 6).map((p) => ({ ...pub(p), pulls: p.pulls })) };
    });
    return { prompt: this.phase === 'input' ? 'اكتب «شد» في الشات لتسحب الحبل لفريقك' : this.reveal?.team ? 'الشدّة للفريق ' + this.reveal.team : 'تعادل في هذه الشدّة',
      rope: Math.max(-this.target, Math.min(this.target, Math.round(this.rope || 0))), target: this.target, needed: this.needed, teams, winner: this.finished ? this.winnerTeam : null, options: [], counts: [] };
  }
}

/* ------------------------------------------------------------------ برا السالفة */
export const OUTSIDER_WORDS = Object.freeze({
  'أكلات': ['كبسة', 'مندي', 'شاورما', 'بيتزا', 'برجر', 'سمبوسة', 'كنافة', 'فلافل', 'مطبق', 'جريش'],
  'أماكن': ['مطار', 'مستشفى', 'مدرسة', 'سوق', 'شاطئ', 'مسجد', 'ملعب', 'سينما', 'مطعم', 'حديقة'],
  'حيوانات': ['جمل', 'أسد', 'قطة', 'زرافة', 'دلفين', 'نسر', 'حصان', 'فيل', 'بطريق', 'صقر'],
  'أشياء في البيت': ['ثلاجة', 'مكيف', 'كنب', 'تلفزيون', 'سرير', 'مرآة', 'غسالة', 'فرن', 'مروحة', 'دولاب'],
  'مهن': ['طبيب', 'طيار', 'مهندس', 'معلم', 'شيف', 'شرطي', 'حلاق', 'مصور', 'رسام', 'نجار'],
  'رياضات': ['كرة قدم', 'سباحة', 'تنس', 'ملاكمة', 'سلة', 'بولينج', 'تزلج', 'جري', 'كاراتيه', 'فروسية'],
});
const OUTSIDER_PHASES = { assign: 40_000, vote: 25_000, guess: 25_000 };
export const OUTSIDER_LABELS = { outsider: 'برا السالفة', insider: 'داخل السالفة' };
export class Outsider extends RoundGame {
  constructor(o) { super('outsider', o); this.revealMs = 6000; this.codes = new Map(); this.tokens = new Map(); }
  setup() {
    const cats = Object.keys(OUTSIDER_WORDS);
    this.category = this.opts.category && OUTSIDER_WORDS[this.opts.category] ? this.opts.category : cats[this.random(cats.length)];
    const words = OUTSIDER_WORDS[this.category];
    this.word = words[this.random(words.length)];
    this.outsiderId = shuffle([...this.roster.keys()], this.random)[0];
    this.winner = null; this.accused = null; this.guess = null;
  }
  nextRound() { this.round++; this.enter('assign', OUTSIDER_PHASES.assign); }
  enter(phase, ms) { this.phase = phase; this.inputs = new Map(); this.phaseStartedAt = this.now(); this.endsAt = this.phaseStartedAt + ms; }
  /* private page: the same one-time code flow as «الأدوار المخفية» */
  claim() {
    const token = randomInt(1e9).toString(36) + randomInt(1e9).toString(36) + randomInt(1e9).toString(36);
    let code; do { code = String(1000 + randomInt(9000)); } while (this.codes.has(code));
    this.codes.set(code, { token, at: this.now() });
    return { code, token };
  }
  privateView(token) {
    const id = this.tokens.get(token); if (!id) return { linked: false };
    const out = id === this.outsiderId, role = out ? 'outsider' : 'insider';
    return { linked: true, player: pub(this.roster.get(id)), alive: true, role, roleLabel: OUTSIDER_LABELS[role], category: this.category,
      ...(out ? {} : { word: this.word }), phase: this.phase, finished: this.finished, canAct: false, targets: [], teammates: [], inspected: [] };
  }
  act() { throw new Error('لا يوجد إجراء في هذه اللعبة — صوّت من الشات'); }
  input(id, message, at = this.now()) {
    if (this.finished) return false;
    const text = String(message).trim();
    const claim = /^(?:دوري|دور|role)\s*([0-9٠-٩]{4})$/i.exec(text);
    if (claim) {
      const c = this.codes.get(norm(claim[1]));
      if (!c || !this.roster.has(id) || this.now() - c.at > 15 * 60_000) return false;
      this.codes.delete(norm(claim[1])); this.tokens.set(c.token, id); this.totalInputs++; return true;
    }
    if (at > this.endsAt) return false;
    if (this.phase === 'vote') {
      if (!this.roster.has(id) || this.inputs.has(id)) return false;
      const n = firstNumber(text.replace(/^(?:صوت|صوّت|vote)\s*/i, '').replace(/^#/, ''), 1, 99);
      const target = n && [...this.roster.values()].find((x) => x.number === n && x.id !== id);
      if (!target) return false;
      this.inputs.set(id, { value: target.id, at }); this.totalInputs++;
      if (this.inputs.size >= this.roster.size) this.endsAt = Math.min(this.endsAt, at + 700);
      return true;
    }
    if (this.phase === 'guess' && id === this.outsiderId && !this.guess) {
      this.guess = text.slice(0, 40); this.totalInputs++; this.endsAt = at;
      return true;
    }
    return false;
  }
  tally() { const t = new Map(); for (const { value } of this.inputs.values()) t.set(value, (t.get(value) || 0) + 1); return t; }
  tick() {
    if (this.finished) return false;
    const t = this.now(); if (t < this.endsAt) return false;
    if (this.phase === 'assign') { this.enter('talk', this.seconds * 1000); return true; }
    if (this.phase === 'talk') { this.enter('vote', OUTSIDER_PHASES.vote); return true; }
    if (this.phase === 'vote') {
      const tally = [...this.tally()].sort((a, b) => b[1] - a[1]);
      const tie = tally.length > 1 && tally[0][1] === tally[1][1];
      this.accused = tally.length && !tie ? tally[0][0] : null;
      const caught = this.accused === this.outsiderId;
      this.lastVotes = new Map([...this.inputs].map(([k, v]) => [k, v.value]));
      this.reveal = { votes: Object.fromEntries(tally.map(([pid, n]) => [this.roster.get(pid).number, n])), accused: this.accused ? pub(this.roster.get(this.accused)) : null, caught, tie };
      this.enter('reveal', this.revealMs);
      this.after = caught ? 'guess' : 'end';
      if (!caught) this.winner = 'outsider';
      return true;
    }
    if (this.phase === 'reveal') {
      if (this.after === 'guess') { this.enter('guess', OUTSIDER_PHASES.guess); return true; }
      this.finish('complete'); return true;
    }
    if (this.phase === 'guess') {
      // caught, but naming the secret word still saves the outsider
      this.winner = this.guess && norm(this.guess) === norm(this.word) ? 'outsider' : 'insiders';
      this.finish('complete'); return true;
    }
    return false;
  }
  advance() { if (this.finished) return false; this.endsAt = this.now(); return this.tick(); }
  won(p) { return (p.id === this.outsiderId) === (this.winner === 'outsider'); }
  rank() {
    // winners first; insiders who voted for the outsider before the rest
    const votedRight = (p) => this.lastVotes?.get(p.id) === this.outsiderId;
    return [...this.roster.values()].sort((a, b) => (this.won(b) - this.won(a)) || (votedRight(b) - votedRight(a)) || a.number - b.number);
  }
  finish(reason) {
    if (!this.winner) this.winner = 'outsider'; // stopped early: the secret held
    super.finish(reason);
  }
  detail(p) { return (p.id === this.outsiderId ? 'كان برا السالفة' : 'داخل السالفة') + (this.won(p) ? ' • فاز' : ''); }
  summary() { return (this.winner === 'outsider' ? 'فاز اللي برا السالفة' : 'كشفوا اللي برا السالفة') + ' — الكلمة: ' + this.word; }
  view() {
    const tally = this.phase === 'vote' ? Object.fromEntries([...this.tally()].map(([pid, n]) => [this.roster.get(pid).number, n])) : (this.reveal?.votes || {});
    const done = this.finished;
    return {
      prompt: { assign: 'افتح صفحتك الخاصة واكتب الرمز في الشات لتعرف الكلمة', talk: 'لمّحوا للكلمة في الشات بدون ما تقولونها', vote: 'صوّتوا: اكتب «صوت» ورقم اللي تشك إنه برا السالفة', reveal: 'نتيجة التصويت', guess: 'انكشف! عنده فرصة أخيرة: يكتب الكلمة السرية في الشات' }[this.phase] || '',
      category: this.category, word: done ? this.word : null, linked: this.tokens.size, winner: done ? this.winner : null,
      outsider: done || this.phase === 'guess' || (this.phase === 'reveal' && this.reveal?.caught) ? pub(this.roster.get(this.outsiderId)) : null,
      players: [...this.roster.values()].sort((a, b) => a.number - b.number).slice(0, 40).map((p) => ({ ...pub(p), votes: tally[p.number] || 0 })),
      options: [], counts: [],
    };
  }
  /** Host screen: the word and the outsider, unless the host is playing too. */
  adminView(hostPlaying) { return hostPlaying ? { hidden: true } : { category: this.category, word: this.word, outsider: pub(this.roster.get(this.outsiderId)) }; }
}

export const TEAM_GAMES = { tug: TugOfWar, outsider: Outsider };
