// TIME BOMB — server-authoritative "pass the bomb" elimination game.
//
// Rules (enforced here, never in the browser):
//  • Each turn has ONE deadline (endsAt). Passing changes the holder only; the
//    remaining time is never reset or extended.
//  • When the deadline is reached the current holder is eliminated. The match
//    continues with a new random holder until exactly one player is alive.
//  • Every state change is synchronous and guarded by phase + turn id, so a late,
//    duplicated or concurrent event can never act on a different turn, explode
//    twice or eliminate twice.
//
// Time and randomness are injected so tests can drive a virtual clock.

export const BOMB_DEFAULT_SECONDS = 15;
export const BOMB_MIN_SECONDS = 5;
export const BOMB_MAX_SECONDS = 60;
export const BOMB_TRANSITION_MS = 3500;
const PASS_LOG = 30;
const BOT_PREFIX = 'demo:';

const PASS_RE = /^[!！]?\s*(?:مرر|مرّر|pass|bomb|بومب)\s*[#＃]?\s*(\d{1,4})\s*$/i;
/** Parse a chat pass command ("!مرر 43", "!bomb 43", Arabic-Indic digits allowed). Returns the target number or null. */
export function parsePassCommand(text) {
  const clean = String(text ?? '').normalize('NFKC')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[ً-ٟـ]/g, '')
    .trim();
  const match = PASS_RE.exec(clean);
  return match ? Number(match[1]) : null;
}

export class BombGame {
  /**
   * @param {{ now?: () => number, random?: (n:number)=>number, notify?: ()=>void, transitionMs?: number }} options
   */
  constructor({ now = () => Date.now(), random = n => Math.floor(Math.random() * n), notify = () => {}, transitionMs = BOMB_TRANSITION_MS } = {}) {
    this.now = now; this.random = random; this.notify = notify; this.transitionMs = transitionMs;
    this.seconds = BOMB_DEFAULT_SECONDS;
    this.sound = true;
    this.autoBots = true;
    this.matchId = 0;
    this.reset();
  }
  reset() {
    this.phase = 'idle';            // idle | armed | paused | exploded | finished
    this.turn = 0;
    this.roster = new Map();         // id -> { id, number, name, avatar }
    this.alive = [];                 // ids, in registration order
    this.eliminated = [];            // { id, turn, at }
    this.holder = null;
    this.endsAt = null;              // deadline of the current turn (armed)
    this.nextTurnAt = null;          // when the next turn starts (exploded)
    this.pausedFrom = null;          // phase that was paused
    this.pausedRemaining = null;     // ms left when paused
    this.passes = [];                // { turn, from, to, at, remainingMs } — newest first, capped
    this.passCount = 0;
    this.explosions = [];            // { turn, id, at }
    this.winner = null;
    this.reason = null;
    this.startedAt = null;
    this.botPassAt = null;
  }
  configure({ seconds, sound, autoBots } = {}) {
    if (seconds !== undefined) {
      const n = Number(seconds);
      if (!Number.isInteger(n) || n < BOMB_MIN_SECONDS || n > BOMB_MAX_SECONDS)
        throw new Error(`مدة القنبلة يجب أن تكون من ${BOMB_MIN_SECONDS} إلى ${BOMB_MAX_SECONDS} ثانية`);
      if (this.running) throw new Error('لا يمكن تغيير مدة القنبلة أثناء المباراة');
      this.seconds = n;
    }
    if (sound !== undefined) this.sound = sound === true;
    if (autoBots !== undefined) this.autoBots = autoBots === true;
  }
  get running() { return ['armed', 'paused', 'exploded'].includes(this.phase); }

  /** Start a new match with a fixed roster. Nobody can join after this. */
  start(players) {
    if (this.running) throw new Error('توجد مباراة قنبلة جارية بالفعل');
    const roster = (players || []).filter(p => p && p.id);
    if (roster.length < 2) throw new Error('القنبلة المؤقتة تحتاج لاعبَين على الأقل');
    this.reset();
    this.matchId++;
    for (const p of roster) this.roster.set(p.id, { id: p.id, number: p.number, name: p.name, ...(p.avatar ? { avatar: p.avatar } : {}) });
    this.alive = roster.map(p => p.id);
    this.startedAt = this.now();
    this.beginTurn();
    return true;
  }
  beginTurn() {
    this.turn++;
    this.holder = this.alive[this.random(this.alive.length)];
    this.endsAt = this.now() + this.seconds * 1000;
    this.nextTurnAt = null;
    this.phase = 'armed';
    this.scheduleBot();
  }
  scheduleBot() {
    this.botPassAt = this.autoBots && String(this.holder).startsWith(BOT_PREFIX) && this.alive.length > 1
      ? this.now() + 900 + this.random(2600) : null;
  }

  /**
   * Pass the bomb. `fromId` must be the current holder; `target` is a player number or id.
   * `expectedMatch` / `expectedTurn` (optional) reject requests aimed at an earlier match or turn.
   * Returns { ok, reason }.
   */
  pass(fromId, target, { expectedTurn, expectedMatch } = {}) {
    this.tick(); // a pass that arrives after the deadline must lose to the explosion
    if (this.phase !== 'armed') return { ok: false, reason: 'not-armed' };
    if (expectedMatch !== undefined && expectedMatch !== this.matchId) return { ok: false, reason: 'stale-turn' };
    if (expectedTurn !== undefined && expectedTurn !== this.turn) return { ok: false, reason: 'stale-turn' };
    if (fromId !== this.holder) return { ok: false, reason: 'not-holder' };
    const at = this.now();
    if (at >= this.endsAt) return { ok: false, reason: 'expired' };
    const toId = this.resolve(target);
    if (!toId || !this.roster.has(toId)) return { ok: false, reason: 'unknown-target' };
    if (toId === fromId) return { ok: false, reason: 'self' };
    if (!this.alive.includes(toId)) return { ok: false, reason: 'eliminated' };
    this.holder = toId; // the deadline is deliberately untouched
    this.passCount++;
    this.passes.unshift({ turn: this.turn, from: fromId, to: toId, at, remainingMs: this.endsAt - at });
    this.passes.length = Math.min(this.passes.length, PASS_LOG);
    this.scheduleBot();
    return { ok: true };
  }
  resolve(target) {
    if (typeof target === 'string' && this.roster.has(target)) return target;
    const n = Number(target);
    if (!Number.isInteger(n)) return null;
    for (const p of this.roster.values()) if (p.number === n) return p.id;
    return null;
  }

  /** Advance time. Idempotent: calling it any number of times per instant is safe. Returns true if state changed. */
  tick() {
    const now = this.now();
    if (this.phase === 'armed') {
      if (now >= this.endsAt) { this.explode(now); return true; }
      if (this.botPassAt !== null && now >= this.botPassAt) {
        const options = this.alive.filter(id => id !== this.holder);
        this.botPassAt = null;
        if (options.length) { const r = this.pass(this.holder, options[this.random(options.length)]); return r.ok; }
      }
      return false;
    }
    if (this.phase === 'exploded' && now >= this.nextTurnAt) { this.beginTurn(); return true; }
    return false;
  }
  explode(now) {
    if (this.phase !== 'armed') return false;
    const victim = this.holder;
    this.alive = this.alive.filter(id => id !== victim);
    this.eliminated.push({ id: victim, turn: this.turn, at: now });
    this.explosions.push({ turn: this.turn, id: victim, at: now });
    this.holder = null; this.endsAt = null; this.botPassAt = null;
    if (this.alive.length === 1) {
      this.phase = 'finished'; this.reason = 'winner'; this.winner = this.alive[0];
      this.lastExplosionAt = now;
      return true;
    }
    this.phase = 'exploded';
    this.nextTurnAt = now + this.transitionMs;
    this.lastExplosionAt = now;
    return true;
  }
  pause() {
    this.tick();
    if (!['armed', 'exploded'].includes(this.phase)) throw new Error('لا توجد مباراة جارية لإيقافها');
    const now = this.now();
    this.pausedFrom = this.phase;
    this.pausedRemaining = Math.max(0, (this.phase === 'armed' ? this.endsAt : this.nextTurnAt) - now);
    this.pausedBot = this.botPassAt !== null ? Math.max(0, this.botPassAt - now) : null;
    this.phase = 'paused';
    return true;
  }
  resume() {
    if (this.phase !== 'paused') throw new Error('المباراة ليست موقوفة مؤقتًا');
    const now = this.now();
    this.phase = this.pausedFrom;
    if (this.phase === 'armed') this.endsAt = now + this.pausedRemaining;
    else this.nextTurnAt = now + this.pausedRemaining;
    this.botPassAt = this.pausedBot !== null && this.phase === 'armed' ? now + this.pausedBot : null;
    this.pausedFrom = null; this.pausedRemaining = null; this.pausedBot = null;
    return true;
  }
  end(reason = 'manual') {
    if (!this.running) return false;
    this.phase = 'finished'; this.reason = reason; this.winner = null;
    this.holder = null; this.endsAt = null; this.nextTurnAt = null; this.botPassAt = null;
    return true;
  }
  /** Remove a player that is no longer registered (e.g. audience filter). */
  forfeit(id) {
    if (!this.running || !this.alive.includes(id)) return false;
    if (this.holder === id && this.phase === 'armed') { this.explode(this.now()); return true; }
    this.alive = this.alive.filter(x => x !== id);
    this.eliminated.push({ id, turn: this.turn, at: this.now(), forfeit: true });
    if (this.alive.length === 1) { this.phase = 'finished'; this.reason = 'winner'; this.winner = this.alive[0]; this.holder = null; this.endsAt = null; this.nextTurnAt = null; }
    return true;
  }

  publicPlayer(id) {
    const p = this.roster.get(id);
    return p ? { number: p.number, name: p.name, ...(p.avatar ? { avatar: p.avatar } : {}) } : null;
  }
  /** Public snapshot. Never exposes TikTok account ids — players are identified by their number. */
  snapshot() {
    const now = this.now();
    const remainingMs = this.phase === 'armed' ? Math.max(0, this.endsAt - now)
      : this.phase === 'paused' && this.pausedFrom === 'armed' ? this.pausedRemaining : this.phase === 'idle' ? this.seconds * 1000 : 0;
    const last = this.explosions.at(-1);
    return {
      matchId: this.matchId, phase: this.phase, turn: this.turn, seconds: this.seconds, sound: this.sound, autoBots: this.autoBots,
      endsAt: this.phase === 'armed' ? this.endsAt : null, remainingMs,
      pausedFrom: this.pausedFrom, nextTurnAt: this.phase === 'exploded' ? this.nextTurnAt : null,
      holder: this.holder ? this.publicPlayer(this.holder) : null,
      alive: this.alive.map(id => this.publicPlayer(id)),
      eliminated: this.eliminated.map(e => ({ ...this.publicPlayer(e.id), turn: e.turn, ...(e.forfeit ? { forfeit: true } : {}) })),
      passes: this.passes.slice(0, 12).map(p => ({ turn: p.turn, from: this.publicPlayer(p.from), to: this.publicPlayer(p.to), remainingMs: p.remainingMs, at: p.at })),
      explosion: last ? { turn: last.turn, at: last.at, player: this.publicPlayer(last.id) } : null,
      winner: this.winner ? this.publicPlayer(this.winner) : null,
      reason: this.reason, total: this.roster.size,
      totalPasses: this.passCount
    };
  }
}
