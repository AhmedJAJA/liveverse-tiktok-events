// سبونج لايف — «سلسلة الكلمات» (Word Chain): rules only, no UI, every rule testable.
//
// A category and a word are on screen. The first player whose comment is a correct word reaches the server first
// wins the link: the word must belong to the category, start with the last letter of the previous word, and not
// have been used in this chain. That word becomes the new word, and its last letter is the next required letter.
//
// The written rules (shown to players in the game and on the settings page):
//   • Letters: diacritics and tatweel are ignored; أ إ آ ٱ count as ا; ى counts as ي; ؤ as و; ئ as ي.
//   • A final ة is read as «ت» for the next letter; a final ء is skipped (the letter before it is used).
//   • «ال» at the start of a word is ignored (الدب = دب).
//   • If no word of the category starts with the required letter, the letter before it is used (shown on screen).
//   • A correct word = 3 points, +2 when it arrives in the first 5 seconds of the turn.
//   • The category changes after 5 correct words in a row, or when the time runs out with no correct word
//     (a new starting word is drawn — the round never waits forever). After 80 turns the top scorer wins.
//   • Optional «منع الإجابة مرتين ورا بعض»: the player who gave the last word cannot give the next one.
//   • A word that is not in the built-in lists can be accepted by the host («مراجعة المشرف») while the turn is open.
import { RoundGame, pub } from './round-game.mjs';
import { CHAIN_CATEGORIES } from './chain-words.mjs';

export const CHAIN_DEFAULTS = Object.freeze({ target: 30, seconds: 20, order: 'ordered', alternate: true, review: true, sounds: true });
export const CHAIN_POINTS = 3, CHAIN_FAST_BONUS = 2, CHAIN_FAST_MS = 5000, LINKS_PER_CATEGORY = 5, MAX_TURNS = 80, ATTEMPT_GAP_MS = 1200;
const REVEAL_MS = 2600;

/** Comparison key of one word: no diacritics, unified alef/ya/hamza forms, ة→ه, no leading «ال». */
export function chainKey(raw) {
  return String(raw ?? '').normalize('NFKC').replace(/[ً-ٰٟـ]/g, '')
    .replace(/[^ء-ي\s]/g, ' ').trim().split(/\s+/).filter(Boolean)
    .map((w) => {
      let k = w.replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ة/g, 'ه');
      if (k.startsWith('ال') && k.length > 3) k = k.slice(2);
      return k.replace(/ء$/, '');
    }).filter(Boolean).join(' ');
}
/** First letter a word is judged by (after the rules above). */
export function firstLetter(raw) { const k = chainKey(raw); return k ? k[0] : ''; }
/** The letter the next word must start with: final ة → ت, final ء skipped, unified forms. */
export function lastLetter(raw) {
  const w = String(raw ?? '').normalize('NFKC').replace(/[ً-ٰٟـ]/g, '').replace(/[^ء-ي]/g, '');
  const chars = [...w].reverse().filter((c) => c !== 'ء');
  const c = chars[0] || '';
  return ({ 'ة': 'ت', 'ى': 'ي', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ؤ': 'و', 'ئ': 'ي' })[c] || c;
}
/** Letters as shown on screen (ا shown as «أ/ا»). */
export const letterLabel = (l) => (l === 'ا' ? 'أ' : l);

const BANKS = CHAIN_CATEGORIES.map((c) => {
  const index = new Map();
  for (const w of c.words) { const k = chainKey(w); if (k && !index.has(k)) index.set(k, w); }
  return { ...c, index };
});
export const CHAIN_CATEGORY_LABELS = Object.freeze(BANKS.map((b) => b.label));
/** Does this category have an unused word starting with the letter? */
function available(bank, letter, used) { for (const [k] of bank.index) if (k[0] === letter && !used.has(k)) return true; return false; }
const looksLikeWord = (text) => { const t = String(text).trim(); return t.length >= 2 && t.length <= 30 && /^[؀-ۿ\s]+$/.test(t) && t.split(/\s+/).length <= 3; };

export class WordChain extends RoundGame {
  constructor(o = {}) {
    super('chain', { ...o, seconds: o.seconds ?? CHAIN_DEFAULTS.seconds, revealMs: REVEAL_MS });
    const n = Number(o.target); this.target = Number.isInteger(n) && n >= 10 && n <= 100 ? n : CHAIN_DEFAULTS.target;
    this.order = o.order === 'random' ? 'random' : 'ordered';
    this.alternate = o.alternate === undefined ? CHAIN_DEFAULTS.alternate : o.alternate === true || o.alternate === 'on';
    this.review = o.review === undefined ? CHAIN_DEFAULTS.review : o.review === true || o.review === 'on';
    this.sounds = o.sounds === undefined ? CHAIN_DEFAULTS.sounds : o.sounds === true || o.sounds === 'on';
    this.rounds = MAX_TURNS;
  }
  setup() {
    this.used = new Set(); this.chain = []; this.links = 0; this.catPos = -1; this.lastAttempt = new Map(); this.lastBy = null;
    this.events = 0; this.miss = null; this.timeouts = 0;
    this.categoryOrder = this.order === 'random' ? this.shuffled(BANKS.map((_, i) => i)) : BANKS.map((_, i) => i);
    this.nextCategory();
  }
  shuffled(list) { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = this.random(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  get bank() { return BANKS[this.categoryOrder[this.catPos % this.categoryOrder.length]]; }
  /** New category with a fresh starting word (drawn by the server). */
  nextCategory() {
    this.catPos++; this.links = 0; this.chain = [];
    const pool = [...this.bank.index].filter(([k]) => !this.used.has(k));
    const [k, word] = pool.length ? pool[this.random(pool.length)] : [...this.bank.index][this.random(this.bank.index.size)];
    this.used.add(k);
    this.word = { text: word, by: null }; this.chain.push(this.word);
    this.setLetter(word);
  }
  /** Required letter from the word; walks back to an earlier letter of the word when the category has none. */
  setLetter(word) {
    const letters = []; const w = String(word).replace(/[ً-ٰٟـ\s]/g, '');
    for (let i = w.length; i > 0; i--) { const l = lastLetter(w.slice(0, i)); if (l && !letters.includes(l)) letters.push(l); }
    this.letterNote = null;
    const hit = letters.find((l) => available(this.bank, l, this.used));
    this.letter = hit || letters[0];
    if (hit && hit !== letters[0]) this.letterNote = `لا توجد كلمات تبدأ بـ«${letterLabel(letters[0])}» في ${this.bank.label} — نأخذ الحرف «${letterLabel(hit)}»`;
  }
  nextRound() {
    this.round++; this.inputs = new Map(); this.reveal = null; this.pending = null; this.miss = null;
    this.phase = 'input'; this.phaseStartedAt = this.now(); this.endsAt = this.phaseStartedAt + this.seconds * 1000;
  }
  /** Judge a comment. Returns true when it changed the board (accepted, held for review, or a visible miss). */
  input(id, message, at = this.now()) {
    if (this.finished || this.phase !== 'input' || at > this.endsAt) return false;
    const p = this.roster.get(id); if (!p) return false;
    const text = String(message ?? '').trim();
    if (!looksLikeWord(text)) return false;                                   // ordinary chat is ignored
    if (at - (this.lastAttempt.get(id) ?? -Infinity) < ATTEMPT_GAP_MS) return false; // one attempt per 1.2 s
    this.lastAttempt.set(id, at);
    const key = chainKey(text);
    if (!key) return false;
    const miss = (why) => { this.miss = { player: pub(p), word: text, why, n: ++this.events }; return true; };
    if (this.alternate && this.lastBy === id) return miss('انتظر إجابة لاعب آخر');
    if (key[0] !== this.letter) return miss(`يجب أن تبدأ بحرف «${letterLabel(this.letter)}»`);
    if (this.used.has(key)) return miss('استُخدمت من قبل في السلسلة');
    const known = this.bank.index.get(key);
    if (known) { this.accept(p, known, key, at); return true; }
    const other = BANKS.find((b) => b !== this.bank && b.index.has(key));
    if (other) return miss(`ليست من فئة «${this.bank.label}»`);
    if (!this.review) return miss('ليست في قائمة الكلمات');
    if (!this.pending) { this.pending = { id, player: pub(p), word: text, key, at }; this.miss = null; this.events++; return true; }
    return miss('بانتظار مراجعة كلمة أخرى');
  }
  /** Host decision on the word held for review (only while its turn is open). */
  judge(accept) {
    if (this.phase !== 'input' || !this.pending) return false;
    const pd = this.pending; this.pending = null;
    if (!accept) { this.miss = { player: pd.player, word: pd.word, why: 'رفضها المشرف', n: ++this.events }; return true; }
    if (this.used.has(pd.key)) { this.miss = { player: pd.player, word: pd.word, why: 'استُخدمت من قبل في السلسلة', n: ++this.events }; return true; }
    this.accept(this.roster.get(pd.id), pd.word, pd.key, pd.at, true);
    return true;
  }
  accept(p, word, key, at, reviewed = false) {
    const fast = at - this.phaseStartedAt <= CHAIN_FAST_MS;
    const gained = CHAIN_POINTS + (fast ? CHAIN_FAST_BONUS : 0);
    p.points += gained; p.correct++; p.correctMs += Math.max(0, at - this.phaseStartedAt);
    this.used.add(key); this.lastBy = p.id; this.links++; this.timeouts = 0; this.totalInputs++;
    const prev = this.word;
    this.word = { text: word, by: pub(p) }; this.chain.push(this.word);
    this.reveal = { ok: true, player: pub(p), word, from: prev.text, gained, fast, reviewed, total: p.points };
    this.pending = null; this.miss = null; this.events++;
    if (p.points >= this.target) { this.finish('target'); return; }
    if (this.links >= LINKS_PER_CATEGORY) { this.reveal.categoryChange = true; this.nextCategory(); }
    else this.setLetter(word);
    this.phase = 'reveal'; this.phaseStartedAt = at; this.endsAt = Math.max(this.now(), at) + this.revealMs;
  }
  tick() {
    if (this.finished) return false;
    const t = this.now(); if (t < this.endsAt) return false;
    if (this.phase === 'input') {
      // Time is up with no correct word: announced rule — a new word in the next category.
      this.timeouts++; this.events++;
      this.reveal = { ok: false, timeout: true, word: this.word.text, letter: this.letter, pending: this.pending?.word || null };
      this.pending = null; this.lastBy = null; this.nextCategory();
      this.reveal.categoryChange = true;
      this.phase = 'reveal'; this.phaseStartedAt = t; this.endsAt = t + this.revealMs;
      return true;
    }
    if (this.phase === 'reveal') { if (this.round >= MAX_TURNS) this.finish('turns'); else this.nextRound(); return true; }
    return false;
  }
  isOver() { return this.round >= MAX_TURNS; }
  rank() { return [...this.roster.values()].sort((a, b) => b.points - a.points || b.correct - a.correct || a.correctMs - b.correctMs || a.number - b.number); }
  detail(p) { return `${p.points} نقطة — ${p.correct} كلمات`; }
  finish(reason) {
    super.finish(reason);
    // the results keep the real chain points (the standard results screen shows them)
    this.rankings = this.rankings.map((r) => ({ ...r, points: this.roster.get(r.id).points }));
  }
  view() {
    const board = this.rank();
    return {
      category: this.bank.label, word: this.word.text, wordBy: this.word.by, letter: letterLabel(this.letter), letterNote: this.letterNote,
      chain: this.chain.slice(-6).map((w) => ({ text: w.text, by: w.by })), links: this.links, linksPerCategory: LINKS_PER_CATEGORY,
      target: this.target, alternate: this.alternate, review: this.review, sounds: this.sounds, blocked: this.alternate && this.lastBy ? pub(this.roster.get(this.lastBy)) : null,
      pending: this.pending ? { player: this.pending.player, word: this.pending.word } : null, miss: this.miss, events: this.events, turn: this.round, maxTurns: MAX_TURNS,
      leader: board[0] && board[0].points > 0 ? { ...pub(board[0]), points: board[0].points } : null,
      players: board.slice(0, 12).map((x) => ({ ...pub(x), points: x.points, correct: x.correct })),
    };
  }
  /** Demo mode: a valid word for the current letter, when the lists have one. */
  botWord() { for (const [k, w] of this.bank.index) if (k[0] === this.letter && !this.used.has(k)) return w; return null; }
}
