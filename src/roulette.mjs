// سبونج لايف — «الروليت»: a virtual elimination roulette for live streams (rules only — no UI here).
//
// The server decides everything, with the secure random generator it is given (node:crypto randomInt):
//   • who takes the turn — a shuffle bag: every player still in is drawn once before anyone is drawn again;
//   • what each pull fires — every player has their own cylinder («خزنة») of `chambers` chambers holding `bullets`
//     bullets, loaded at the start of the match; by default a pull fires the next chamber of that cylinder
//     (as in the reference video: «الحجرة 1 من 2»), or, if the host chose so, the cylinder is spun before each pull;
//   • when each scene ends (every deadline is a server time).
// Screens only animate what the server already decided. A pull's outcome is fixed the moment the revolver scene
// opens, and is published only when it is revealed; skipping an animation jumps to that same outcome.
// The rules (cylinder size, bullets, mode) are fixed for the whole match and published with every state.
//
// One turn:  ready ─draw→ drawing ─→ picked ─→ choose ─target→ aim ─→ reveal ─→ ready … ─→ finished
// The rule of the game: the holder is drawn at random and CHOOSES who faces the revolver — never themselves. A silent
// holder hands the choice to the server (a random other player) or loses the turn, as the host announced.
//   ready     «الجولة جاهزة»: the players' grid; the host presses «ابدأ السحب» (or it goes on by itself in auto mode)
//   drawing   the names reel — the turn holder is already chosen, every screen rolls to the same name
//   picked    «الدور على …»
//   choose    the holder writes the number of another player still in the game in the chat (TikTok/Kick)
//   aim       the revolver scene: the target's cylinder turns — «هل الطلقة هنا؟»
//   reveal    «حجرة فارغة — نجوت!» or «OUT — تم الإقصاء»
//   finished  the last player standing wins
// This is a game for fun: nothing in it is linked to coins, purchases or bets.
import { randomUUID } from 'node:crypto';
import { RoundGame, pub } from './round-game.mjs';

/** Every rule the host can choose, with the allowed values (the settings schema and the engine read this list). */
export const ROULETTE_RULES = Object.freeze({
  targetMode: ['choose'],              // the only rule: the holder chooses (a saved «self» from before reads as this)
  chambers: [2, 3, 4, 5, 6],
  bullets: [1, 2, 3],
  cylinder: ['advance', 'spin'],
  chooseSeconds: [15, 20, 25, 30, 45],
  timeoutRule: ['random', 'skip'],     // a silent holder: a random OTHER player, or the turn is cancelled
  autoRun: ['manual', 'auto'],
  drawSpeed: ['slow', 'normal', 'fast'],
  resultSeconds: [3, 4, 5, 7],
});
export const ROULETTE_DEFAULTS = Object.freeze({ targetMode: 'choose', chambers: 2, bullets: 1, cylinder: 'advance', chooseSeconds: 25, timeoutRule: 'random', autoRun: 'manual', drawSpeed: 'normal', resultSeconds: 4 });
/** Display choices: they change how the screens look, never what happens. */
export const ROULETTE_DISPLAY = Object.freeze({ showNames: [true, false], showFrames: [true, false], sounds: [true, false], effects: ['low', 'normal', 'high'], graphics: ['auto', 'high', 'low'], hostPlays: [true, false] });
export const ROULETTE_DISPLAY_DEFAULTS = Object.freeze({ showNames: true, showFrames: true, sounds: true, effects: 'normal', graphics: 'auto', hostPlays: false });

/** Scene lengths (ms). The reel and the revolver scene follow «سرعة السحب»; the result follows «مدة عرض النتيجة». */
export const SPEED = Object.freeze({ slow: { reel: 6500, aim: 4200 }, normal: { reel: 4800, aim: 3400 }, fast: { reel: 3200, aim: 2400 } });
export const PICKED_MS = 1700;
export const AUTO_GAP_MS = 2800;      // auto mode: the grid stays this long between turns
const HOST_WAIT_MS = 1000;            // auto mode without a host window: look again every second
const BOT_MIN_MS = 1800, BOT_SPREAD_MS = 3400; // trial players choose their target within these seconds
const REEL_LEN = 30, REEL_STOP = 26;  // names on the reel; the chosen one stops at this position
/** The chat drops while the holder chooses: the countdown waits this long at most, then the timeout rule decides. */
export const CHAT_PAUSE_MAX_MS = 120_000;
const MAX_LOG = 40;

const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
const shuffle = (list, random) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = random(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const DIGITS = /[٠-٩۰-۹]/g;
/** A player number written in the chat: «12», «#12», «١٢», «رقم 12». Anything else is not a choice. */
export function parseNumber(raw) {
  const t = String(raw ?? '').normalize('NFKC').replace(DIGITS, (d) => String(d.charCodeAt(0) - (d.charCodeAt(0) >= 0x6f0 ? 0x6f0 : 0x660))).trim();
  const m = t.match(/^(?:#|رقم\s*)?(\d{1,4})$/);
  return m ? Number(m[1]) : null;
}
/**
 * What the holder wrote, read the way people write in a live chat: «7», «#7», «رقم ٧», «7 🔫», «اطلق على 7», «7️⃣».
 * { n } for one player number (1–9999); { ambiguous: [..] } for several different numbers; null when there is none.
 */
export function parseChoice(raw) {
  const t = String(raw ?? '').normalize('NFKC').replace(DIGITS, (d) => String(d.charCodeAt(0) - (d.charCodeAt(0) >= 0x6f0 ? 0x6f0 : 0x660)));
  const found = [];
  for (const m of t.matchAll(/(?<!\d)\d+(?!\d)/g)) { if (m[0].length > 4) continue; const n = Number(m[0]); if (n > 0 && !found.includes(n)) found.push(n); }
  if (!found.length) return null;
  return found.length === 1 ? { n: found[0] } : { ambiguous: found };
}
const ar = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? n + ' ' + few : n + ' ' + many);

export class RussianRoulette extends RoundGame {
  constructor(o = {}) {
    super('roulette', o);
    const rules = {};
    for (const [k, list] of Object.entries(ROULETTE_RULES)) rules[k] = list.includes(o[k]) ? o[k] : ROULETTE_DEFAULTS[k];
    if (rules.bullets >= rules.chambers) rules.bullets = rules.chambers - 1; // at least one empty chamber
    this.rules = Object.freeze(rules);
    const display = {};
    for (const [k, list] of Object.entries(ROULETTE_DISPLAY)) display[k] = list.includes(o[k]) ? o[k] : ROULETTE_DISPLAY_DEFAULTS[k];
    this.display = Object.freeze(display);
    this.hooks = { onEvent: typeof o.onEvent === 'function' ? o.onEvent : () => {}, hostPresent: typeof o.hostPresent === 'function' ? o.hostPresent : () => true,
      // is the stream's chat connected right now? (unknown when the room does not say — then nothing ever waits for it)
      chatConnected: typeof o.chatConnected === 'function' ? o.chatConnected : null };
    this.matchId = typeof o.matchId === 'string' ? o.matchId : randomUUID();
    this.demo = o.demo === true;
  }
  /** The host does not play unless «السماح للمضيف بالمشاركة» is on. */
  start(players) { super.start(this.display.hostPlays ? players : players.filter((p) => !p.host)); }
  setup() {
    for (const p of this.roster.values()) Object.assign(p, { cyl: this.load(), shots: 0, survived: 0, drawn: 0, targeted: 0, eliminatedTurn: null, by: null });
    this.turn = 0; this.bag = []; this.lastHolder = null; this.log = []; this.seq = 0;
    this.holder = null; this.target = null; this.how = null; this.pending = null; this.result = null; this.reel = null; this.botAt = null; this.waitingHost = false; this.spin = null;
    this.feedback = null; this.sawChat = false; this.chatDownSince = null; this.chatLeft = 0;
    this.requests = new Map();
    this.stats = { turns: 0, pulls: 0, empty: 0, out: 0, timeouts: 0, cancelled: 0, hostOut: 0 };
    this.emit({ type: 'start', players: [...this.roster.values()].map(pub), rules: this.rules });
  }
  /** One cylinder: `bullets` distinct chambers out of `chambers`, chosen with the secure generator
      (a partial shuffle: every set of positions is equally likely, and it always ends). */
  load() {
    const slots = Array.from({ length: this.rules.chambers }, (_, i) => i);
    for (let i = 0; i < this.rules.bullets; i++) { const j = i + this.random(slots.length - i); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    return slots.slice(0, this.rules.bullets).sort((a, b) => a - b);
  }
  emit(e) { try { this.hooks.onEvent({ match: this.matchId, demo: this.demo, at: this.now(), ...e }); } catch { /* a recorder never stops the game */ } }
  enter(phase, ms = null) { this.phase = phase; this.phaseStartedAt = this.now(); this.endsAt = ms == null ? null : this.phaseStartedAt + ms; this.seq++; }
  /** RoundGame calls this once at the start: the grid, waiting for the first draw. */
  nextRound() {
    if (this.alive.length < 2) { this.finish(this.alive.length ? 'complete' : 'empty'); return; }
    this.enter('ready', this.rules.autoRun === 'auto' ? AUTO_GAP_MS : null);
  }

  /* ---------------- the turn ---------------- */
  /** «ابدأ السحب». The same request id twice returns the same turn; a second draw while a turn runs is refused. */
  draw({ requestId = null } = {}) {
    if (this.finished) fail('انتهت المباراة — اضغط «جولة جديدة»');
    const rid = typeof requestId === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(requestId) ? requestId : null;
    if (rid && this.requests.has(rid)) return { duplicate: true, turn: this.requests.get(rid) };
    if (this.phase !== 'ready') fail('السحب جارٍ — انتظر انتهاء هذا الدور');
    if (this.alive.length < 2) { this.finish('complete'); fail('انتهت المباراة'); }
    const holder = this.nextHolder();
    this.turn++; this.stats.turns++;
    this.holder = holder.id; this.target = null; this.how = null; this.pending = null; this.result = null; this.botAt = null; this.waitingHost = false;
    this.feedback = null; this.chatDownSince = null;
    // rule «تُدار من جديد»: the cylinder is spun now, when the turn is drawn — so when the scene is skipped, or the
    // target is chosen, nothing about the pull is drawn again
    this.spin = this.rules.cylinder === 'spin' ? this.random(this.rules.chambers) : null;
    holder.drawn++;
    this.reel = this.makeReel(holder);
    if (rid) { this.requests.set(rid, this.turn); if (this.requests.size > 40) this.requests.delete(this.requests.keys().next().value); }
    this.enter('drawing', SPEED[this.rules.drawSpeed].reel);
    this.emit({ type: 'draw', turn: this.turn, holder: pub(holder) });
    return { turn: this.turn };
  }
  /** The fair draw: a shuffled bag of everyone still in; nobody is drawn twice before everyone was drawn once,
      and the last holder never opens the next bag (no immediate repeat). */
  nextHolder() {
    for (let guard = 0; guard < 4 * this.roster.size + 4; guard++) {
      if (!this.bag.length) {
        this.bag = shuffle(this.alive.map((p) => p.id), this.random);
        const last = this.bag.length - 1; // the bag is drawn from its end
        if (last > 0 && this.bag[last] === this.lastHolder) { const j = this.random(last); [this.bag[j], this.bag[last]] = [this.bag[last], this.bag[j]]; }
      }
      const p = this.roster.get(this.bag.pop());
      if (p?.alive) { this.lastHolder = p.id; return p; }
    }
    fail('لا يوجد لاعب يمكن سحبه'); // unreachable while two players are in (draw() checks it first)
  }
  /** What the screens roll through: player numbers, with the holder at REEL_STOP (cosmetic, but the same everywhere). */
  makeReel(holder) {
    const others = this.alive.filter((p) => p.id !== holder.id).map((p) => p.number);
    const list = [];
    let pool = [];
    while (list.length < REEL_LEN) {
      if (!pool.length) pool = shuffle(others.length ? others : [holder.number], this.random);
      const n = pool.pop();
      list.push(list.length === REEL_STOP ? holder.number : n);
    }
    list[REEL_STOP] = holder.number;
    return { list, stop: REEL_STOP };
  }
  /** The target is known: the pull is decided now (kept secret until the reveal), the revolver scene opens. */
  aimAt(target, how) {
    this.target = target.id; this.how = how; this.botAt = null; this.feedback = null; this.chatDownSince = null;
    target.targeted++;
    // «تُدار»: the chamber the spin (drawn with the turn) stopped on; «تتقدم»: the next chamber of the target's cylinder
    const chamber = this.rules.cylinder === 'spin' ? (this.spin ?? this.random(this.rules.chambers)) : target.shots;
    this.pending = { chamber, out: target.cyl.includes(chamber) };
    this.enter('aim', SPEED[this.rules.drawSpeed].aim);
  }
  resolve() {
    const t = this.roster.get(this.target), h = this.roster.get(this.holder), f = this.pending;
    if (!t || !f) { this.enter('ready', this.rules.autoRun === 'auto' ? AUTO_GAP_MS : null); return; }
    t.shots++; this.stats.pulls++;
    if (f.out) { this.knockOut(t, h); this.stats.out++; } else { t.survived++; this.stats.empty++; }
    this.result = { outcome: f.out ? 'out' : 'empty', reason: 'shot', chamber: f.chamber + 1, of: this.rules.chambers, how: this.how };
    this.pending = null;
    this.note({ kind: f.out ? 'out' : 'empty', chamber: f.chamber + 1 });
    this.enter('reveal', this.rules.resultSeconds * 1000);
    this.emit({ type: 'turn', turn: this.turn, holder: pub(h), target: pub(t), outcome: this.result.outcome, reason: 'shot', chamber: f.chamber + 1, of: this.rules.chambers, how: this.how });
  }
  knockOut(p, by) { p.alive = false; p.eliminatedTurn = this.turn; p.eliminatedRound = this.turn; p.by = by && by.id !== p.id ? by.number : null; }
  note(extra) {
    const h = this.roster.get(this.holder), t = this.roster.get(this.target);
    this.log.push({ turn: this.turn, holder: h?.number ?? null, target: t?.number ?? null, ...extra });
    if (this.log.length > MAX_LOG) this.log.shift();
  }
  /** The holder did not choose in time («مهلة اختيار الهدف»): the published rule decides — never the holder. */
  timedOut() {
    const h = this.roster.get(this.holder); this.stats.timeouts++;
    const rule = this.rules.timeoutRule;
    this.note({ kind: 'timeout', rule });
    const others = this.alive.filter((p) => p.id !== h?.id);
    if (rule === 'random' && others.length) return this.aimAt(others[this.random(others.length)], 'timeout');
    this.cancelTurn('timeout');
  }
  /** The chat dropped while the holder chooses (a real stream that was connected during this match): the countdown
      keeps the time that was left, for CHAT_PAUSE_MAX_MS at most. Returns true when the screens should know. */
  holdForChat(t) {
    const ask = this.hooks.chatConnected;
    if (!ask || this.demo) return false;
    const on = !!ask();
    if (on) this.sawChat = true;
    const down = this.phase === 'choose' && this.sawChat && !on;
    if (!down) { if (this.chatDownSince == null) return false; this.chatDownSince = null; this.chatGaveUp = false; return true; }
    if (this.chatDownSince == null) { this.chatDownSince = t; this.chatGaveUp = false; this.chatLeft = Math.max(1000, (this.endsAt ?? t) - t); this.endsAt = t + this.chatLeft; return true; }
    if (t - this.chatDownSince < CHAT_PAUSE_MAX_MS) { this.endsAt = t + this.chatLeft; return false; }
    // the pause is over: the countdown runs out with the time that was left (and the screens stop saying «paused»)
    if (!this.chatGaveUp) { this.chatGaveUp = true; return true; }
    return false;
  }
  cancelTurn(reason) {
    this.stats.cancelled++;
    this.result = { outcome: 'cancel', reason };
    if (reason !== 'timeout') this.note({ kind: 'cancel', reason });
    this.emit({ type: 'turn', turn: this.turn, holder: pub(this.roster.get(this.holder)), target: null, outcome: 'cancel', reason });
    this.pending = null; this.target = null; this.botAt = null;
    this.enter('reveal', 1800);
  }
  tick() {
    if (this.finished) return false;
    const t = this.now();
    const chatNews = this.holdForChat(t);
    // a trial player holding the turn chooses on its own (never a real viewer)
    if (this.phase === 'choose' && this.botAt != null && t >= this.botAt) {
      const others = this.alive.filter((p) => p.id !== this.holder);
      if (others.length) { this.aimAt(others[this.random(others.length)], 'chat'); return true; }
    }
    if (this.endsAt == null || t < this.endsAt) return chatNews;
    switch (this.phase) {
      case 'ready':
        // auto mode goes on only while a host window is open; otherwise the match waits, exactly where it is
        if (!this.hooks.hostPresent()) { const was = this.waitingHost; this.waitingHost = true; this.endsAt = t + HOST_WAIT_MS; return !was; }
        this.waitingHost = false; this.draw(); return true;
      case 'drawing': this.enter('picked', PICKED_MS); return true;
      case 'picked': {
        const h = this.roster.get(this.holder);
        this.enter('choose', this.rules.chooseSeconds * 1000);
        if (h.id.startsWith('demo:bot-')) this.botAt = t + BOT_MIN_MS + this.random(BOT_SPREAD_MS); // «وضع التجربة» players only
        return true;
      }
      case 'choose': this.timedOut(); return true;
      case 'aim': this.resolve(); return true;
      case 'reveal':
        if (this.alive.length <= 1) { this.finish('complete'); return true; }
        this.result = null; this.holder = null; this.target = null; this.reel = null;
        this.enter('ready', this.rules.autoRun === 'auto' ? AUTO_GAP_MS : null); return true;
    }
    return false;
  }
  /** «تخطي الأنيميشن»: end the scene on screen now — the outcome is the one already decided. */
  skip() {
    if (this.finished) return { phase: 'finished' };
    const now = this.now();
    if (this.phase === 'drawing' || this.phase === 'picked') {
      if (this.phase === 'drawing') this.enter('picked', 0);
      this.endsAt = now; this.tick();               // → choose (rule «صاحب الدور يختار») or the revolver scene
      if (this.phase === 'aim') { this.endsAt = now; this.tick(); } // → straight to the reveal
    } else if (this.phase === 'aim' || this.phase === 'reveal') { this.endsAt = now; this.tick(); }
    return { phase: this.phase };
  }
  /** The studio's generic «التالي» is the same as skipping the scene. */
  advance() { this.skip(); }
  /** Chat: during «choose», only the turn holder's message counts — the number of another player still in the game.
      A wrong number gets an answer on screen (returns true: the screens have news); chatter without a number, and
      every message from anybody else, changes nothing. */
  input(id, message) {
    if (this.finished || this.phase !== 'choose' || !id || id !== this.holder) return false;
    const c = parseChoice(message);
    if (!c) return false;
    const at = this.now();
    if (c.ambiguous) { this.feedback = { kind: 'ambiguous', numbers: c.ambiguous.slice(0, 5), at }; return true; }
    const p = [...this.roster.values()].find((x) => x.number === c.n);
    const kind = !p ? 'missing' : p.id === this.holder ? 'self' : !p.alive ? 'out' : null;
    if (kind) { this.feedback = { kind, number: c.n, at }; return true; }
    this.totalInputs++;
    this.aimAt(p, 'chat');
    return true;
  }
  /** The host's buttons during a turn. `hostId` is the host's seat id (when the host plays). */
  command(cmd, body = {}, { hostId = null } = {}) {
    if (cmd === 'draw') return this.draw({ requestId: body.requestId });
    if (cmd === 'skip') return this.skip();
    if (this.finished) fail('انتهت المباراة');
    const h = this.roster.get(this.holder);
    if (cmd === 'pick') {
      // the host plays and holds the turn: they choose here (or from their own chat, like everyone)
      if (this.phase !== 'choose') fail('ليس وقت اختيار الهدف');
      if (!h || !hostId || h.id !== hostId) fail('الدور ليس لك — صاحب الدور يختار من الشات');
      const target = this.alive.find((p) => p.number === Number(body.number));
      if (!target || target.id === h.id) fail('اختر رقم لاعب ما زال في اللعبة غيرك', 400);
      this.aimAt(target, 'host');
      return { target: target.number };
    }
    if (cmd === 'random') {
      if (this.phase !== 'choose') fail('ليس وقت اختيار الهدف');
      const others = this.alive.filter((p) => p.id !== h.id);
      this.note({ kind: 'random' });
      this.aimAt(others.length ? others[this.random(others.length)] : h, 'random');
      return { target: this.roster.get(this.target).number };
    }
    if (cmd === 'cancel') {
      if (!['picked', 'choose'].includes(this.phase)) fail('لا يوجد دور يمكن إلغاؤه الآن');
      this.cancelTurn('host'); return { cancelled: true };
    }
    if (cmd === 'out-holder') {
      // «إقصاء صاحب الدور»: the host's decision (a holder who left, for example); no chamber is used
      if (!['picked', 'choose'].includes(this.phase) || !h) fail('لا يوجد صاحب دور الآن');
      this.knockOut(h, null); this.stats.hostOut++;
      this.target = h.id; this.how = 'host';
      this.result = { outcome: 'out', reason: 'host', chamber: null, of: this.rules.chambers, how: 'host' };
      this.note({ kind: 'host-out' });
      this.enter('reveal', this.rules.resultSeconds * 1000);
      this.emit({ type: 'turn', turn: this.turn, holder: pub(h), target: pub(h), outcome: 'out', reason: 'host', chamber: null, of: this.rules.chambers, how: 'host' });
      return { out: h.number };
    }
    fail('أمر غير معروف', 400);
  }

  /* ---------------- the end ---------------- */
  isOver() { return this.alive.length <= 1; }
  finish(reason) {
    if (this.finished) return;
    this.endsAt = null; this.reel = null; this.pending = null;
    super.finish(reason);
    const w = this.alive.length === 1 ? this.alive[0] : null;
    this.winner = w ? { ...pub(w), survived: w.survived, drawn: w.drawn, targeted: w.targeted } : null;
    this.endedAtMs = this.now();
    this.seq++;
    this.emit({ type: 'finish', reason, winner: this.winner, stats: this.matchStats() });
  }
  matchStats() { return { ...this.stats, players: this.roster?.size || 0, durationMs: Math.max(0, (this.endedAtMs || this.now()) - (this.startedAt || this.now())) }; }
  rank() {
    return [...this.roster.values()].sort((a, b) => (Number(b.alive) - Number(a.alive)) || ((b.eliminatedTurn ?? 1e9) - (a.eliminatedTurn ?? 1e9)) || (b.survived - a.survived) || a.number - b.number);
  }
  detail(p) { return p.alive ? 'آخر من بقي' + (p.survived ? ' — نجا ' + ar(p.survived, 'مرة', 'مرتين', 'مرات', 'مرة') : '') : 'خرج في الدور ' + p.eliminatedTurn; }
  summary() { return 'آخر من بقي'; }

  /* ---------------- what every screen gets (nothing secret) ---------------- */
  rulesText() {
    const { chambers: c, bullets: b, cylinder } = this.rules;
    const cyl = 'لكل لاعب خزنة من ' + ar(c, 'حجرة', 'حجرتين', 'حجرات', 'حجرة') + ' فيها ' + ar(b, 'طلقة واحدة', 'طلقتان', 'طلقات', 'طلقة') + ' في مكان عشوائي';
    const how = cylinder === 'spin' ? 'وتُدار الخزنة قبل كل سحبة (احتمال الإقصاء ' + b + ' من ' + c + ' في كل مرة)'
      : 'وتتقدم حجرة واحدة في كل سحبة عليه (السحبة الأولى ' + b + ' من ' + c + ')';
    const who = 'صاحب الدور يكتب في الشات رقم لاعب آخر ما زال في اللعبة ليضغط عليه الزناد — خلال ' + this.rules.chooseSeconds + ' ثانية';
    const late = this.rules.timeoutRule === 'skip' ? 'إذا لم يختر في الوقت يُلغى الدور' : 'إذا لم يختر في الوقت يختار الخادم لاعبًا آخر عشوائيًا';
    // the rule of the game first: a vertical screen shows only the first line (and the odds)
    return [who + '.', cyl + '، ' + how + '.', late + '.', 'يسحب الخادم صاحب الدور عشوائيًا، وكل لاعب يُسحب مرة في كل دورة قبل أن يتكرر أحد.', 'آخر من يبقى يفوز.'];
  }
  view() {
    const C = this.rules.chambers, inScene = this.phase === 'aim' || this.phase === 'reveal';
    const h = this.holder ? this.roster.get(this.holder) : null, t = this.target ? this.roster.get(this.target) : null;
    const players = this.roster ? [...this.roster.values()].map((p) => ({ n: p.number, a: p.alive ? 1 : 0, s: Math.min(p.shots, C), v: p.survived, ...(p.eliminatedTurn ? { o: p.eliminatedTurn } : {}), ...(p.host ? { h: 1 } : {}) })) : [];
    const alive = this.roster ? this.alive.length : 0, total = this.roster?.size || 0;
    return {
      prompt: this.finished ? 'انتهت المباراة' : 'الروليت — آخر من يبقى يفوز',
      match: this.matchId, demo: this.demo, seq: this.seq, turn: this.turn || 0,
      phase: this.phase, phaseStartedAt: this.phaseStartedAt ?? null, endsAt: this.endsAt ?? null,
      alive, total, eliminated: total - alive,
      holder: h ? pub(h) : null,
      target: inScene && t ? { ...pub(t), shots: t.shots, survived: t.survived } : null,
      // the chamber about to fire (the next one, or where the spin stopped) — never whether it is loaded
      chamber: this.phase === 'aim' && t && this.pending ? { index: this.pending.chamber + 1, of: C } : this.phase === 'reveal' && this.result?.chamber ? { index: this.result.chamber, of: C } : null,
      reel: this.phase === 'drawing' || this.phase === 'picked' ? this.reel : null,
      result: this.phase === 'reveal' ? this.result : null,
      how: inScene ? this.how : null,
      // the holder's wrong number (shown while they choose) and «the chat dropped — the countdown waits»
      feedback: this.phase === 'choose' && this.feedback ? { ...this.feedback } : null,
      chatDown: this.phase === 'choose' && this.chatDownSince != null && !this.chatGaveUp,
      waitingHost: !!this.waitingHost,
      players, log: this.log ? this.log.slice(-14) : [],
      rules: { ...this.rules, text: this.rulesText() }, display: this.display,
      winner: this.finished ? this.winner : null,
      stats: this.finished ? this.matchStats() : null,
    };
  }
}
