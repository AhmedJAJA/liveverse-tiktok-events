// SPONGE LIVE — shared base for round-based chat games (rules only, no UI).
// The server owns every timer; one input per player per round unless a game overrides input().
export const ROUND_DEFAULTS = {};
export const POINTS = [10, 7, 5, 3, 2, 1];
export const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
export function norm(raw) {
  return String(raw ?? '').toLowerCase().normalize('NFKC')
    .replace(ARABIC_DIGITS, d => String(d.charCodeAt(0) - (d.charCodeAt(0) >= 0x6f0 ? 0x6f0 : 0x660)))
    .replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]/gu, '').trim();
}
export const firstNumber = (raw, min, max) => {
  const text = String(raw ?? '').trim().normalize('NFKC').replace(ARABIC_DIGITS, d => String(d.charCodeAt(0) - (d.charCodeAt(0) >= 0x6f0 ? 0x6f0 : 0x660)));
  if (!/^\d{1,2}$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
};
export const pub = (p) => ({ id: p.id, name: p.name, number: p.number, ...(p.avatar ? { avatar: p.avatar } : {}) });
export const card = (n) => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[n] || String(n));

export class RoundGame {
  constructor(mode, { now = () => Date.now(), random = (n) => Math.floor(Math.random() * n), rounds, seconds, revealMs = 3500, target } = {}) {
    const d = ROUND_DEFAULTS[mode] || {};
    this.opts = { ...d, ...(arguments[1] || {}) };
    this.mode = mode; this.now = now; this.random = random;
    this.rounds = rounds ?? d.rounds; this.seconds = seconds ?? d.seconds; this.revealMs = revealMs; this.target = target ?? d.target;
    this.phase = 'idle'; this.round = 0; this.finished = false; this.reason = null;
    this.inputs = new Map(); this.totalInputs = 0; this.reveal = null; this.rankings = [];
  }
  start(players) {
    this.roster = new Map(players.map((p, i) => [p.id, { ...pub(p), number: p.number || i + 1, host: !!p.host, alive: true, points: 0, lives: 3, wins: 0, correctMs: 0, correct: 0, progress: 0, eliminatedRound: null, total: 0, frames: [] }]));
    this.startedAt = this.now();
    this.setup?.();
    this.nextRound();
  }
  get alive() { return [...this.roster.values()].filter((p) => p.alive); }
  nextRound() {
    this.round++; this.inputs = new Map(); this.reveal = null;
    this.phase = 'input'; this.phaseStartedAt = this.now(); this.endsAt = this.phaseStartedAt + this.seconds * 1000;
    this.prepareRound?.();
  }
  /** Returns true when the input was accepted. One input per player per round; eliminated players are ignored. */
  input(id, message, at = this.now()) {
    if (this.finished || this.phase !== 'input' || at > this.endsAt) return false;
    const p = this.roster.get(id);
    if (!p || !p.alive || this.inputs.has(id)) return false;
    const value = this.parse(message, p);
    if (value === null || value === undefined) return false;
    this.inputs.set(id, { value, at }); this.totalInputs++;
    // Everyone answered: resolve shortly instead of waiting for the full timer.
    if (this.inputs.size >= this.alive.length) this.endsAt = Math.min(this.endsAt, at + 700);
    return true;
  }
  tick() {
    if (this.finished) return false;
    const t = this.now();
    if (this.phase === 'input' && t >= this.endsAt) {
      this.resolve(); this.phase = 'reveal'; this.phaseStartedAt = t; this.endsAt = t + this.revealMs; return true;
    }
    if (this.phase === 'reveal' && t >= this.endsAt) {
      if (this.isOver()) this.finish('complete'); else this.nextRound();
      return true;
    }
    return false;
  }
  /** Simulation control: jump to the end of the current phase. */
  advance() { if (this.finished) return false; this.endsAt = this.now(); return this.tick(); }
  end(reason = 'manual') { if (!this.finished) this.finish(reason); }
  finish(reason) {
    this.finished = true; this.reason = reason; this.phase = 'finished'; this.endsAt = null;
    this.rankings = this.rank().map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, number: p.number, ...(p.avatar ? { avatar: p.avatar } : {}), points: POINTS[Math.min(i, POINTS.length - 1)], detail: this.detail(p) }));
  }
  eliminate(p) { p.alive = false; p.eliminatedRound = this.round; }
  counts(n) { const c = Array(n).fill(0); for (const { value } of this.inputs.values()) if (Number.isInteger(value) && value >= 0 && value < n) c[value]++; return c; }
  snapshot() {
    const base = { mode: this.mode, round: this.round, rounds: this.rounds, phase: this.phase, endsAt: this.endsAt ?? null, phaseMs: this.phase === 'reveal' ? this.revealMs : this.seconds * 1000,
      seconds: this.seconds, alive: this.alive.length, total: this.roster?.size || 0, submitted: this.inputs.size, reveal: this.reveal, finished: this.finished };
    return { ...base, ...this.view() };
  }
  summary() { return ''; }
}

