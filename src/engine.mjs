import { randomInt } from 'node:crypto';
import { BombGame, parsePassCommand } from './bomb.mjs';
import { PARTY_MODES, PARTY_MIN_PLAYERS, PARTY_DEFAULTS, createPartyGame } from './party.mjs';
import { OUTSIDER_WORDS } from './team-games.mjs';
import { ALL_GAMES as GAMES } from './catalog.mjs';
import { CATEGORY_WORDS } from './word-banks.mjs';
const botWord = (category, letter) => (CATEGORY_WORDS[category] || []).find(w => normalizeAnswer(w).replace(/^ال/, '').startsWith(normalizeAnswer(letter)));

/** «سلسلة الكلمات»: the «نقاط الفوز» counter steps (10 → 100 by 5). */
export const CHAIN_TARGETS = Array.from({ length: 19 }, (_, i) => 10 + i * 5);
export const MODES = ['quiz', 'guess', 'race', 'wheel', 'glass', 'bomb', ...PARTY_MODES];
export { PARTY_MODES };
export const MASCOT_PRESETS = Object.freeze({
  visor: ['#7fe3ff', '#7dffc8', '#ff8fb3', '#ffd36c', '#c9a7ff'],
  crown: ['gold', 'silver', 'rose', 'obsidian']
});
const MAX_MESSAGE = 160;
const MAX_PLAYERS = 1500;
const MAX_ENTRIES = 500;
const KEEP_CHAT = 35;
const QUIZ_POINTS = [10, 7, 5, 3, 2, 1];
const QUIZ_NEXT_MS = 6000; // results of a question stay on screen before the next one
const LATE_JOIN = ['quiz', 'guess']; // rules that let a newcomer join a running round
const REGISTRATION_PREVIEW = 10;
const MAX_WAITING = 300;
/** Minimum contestants each game needs before it can start (one source: the catalogue). */
export function minPlayersFor(mode) {
  return Math.max(GAMES.find(g => g.mode === mode)?.minPlayers || 1, PARTY_MIN_PLAYERS[mode] || 1);
}

const AVATAR_HOSTS = ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'tiktokcdn-in.com', 'byteoversea.com', 'ibytedtos.com', 'ibyteimg.com', 'muscdn.com'];
const STREAMER_HOSTS = [...AVATAR_HOSTS, 'files.kick.com'];
/** The broadcaster's own profile picture: TikTok CDNs, or Kick's file host for Kick channels. */
export function safeStreamerAvatar(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      STREAMER_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host)) ? url.href : '';
  } catch { return ''; }
}
/** Public link to the broadcast itself, built only from a validated handle. */
export function liveUrlFor(platform, username) {
  const u = String(username || '').replace(/^@/, '');
  if (platform === 'kick') return /^[A-Za-z0-9_-]{1,40}$/.test(u) ? 'https://kick.com/' + u.toLowerCase() : '';
  return /^[A-Za-z0-9._]{1,40}$/.test(u) ? 'https://www.tiktok.com/@' + u + '/live' : '';
}
export function safeAvatarUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      AVATAR_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host)) ? url.href : '';
  } catch { return ''; }
}

export function normalizeAnswer(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}
/** A join word the host may choose: 1–32 characters, at most 3 words, something left after normalising,
    and not a bare number (numbers are answers in several games). Returns the cleaned word or throws. */
export function cleanJoinWord(raw) {
  const w = String(raw ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  const n = normalizeAnswer(w);
  if (!w || [...w].length > 32 || !n) throw Object.assign(new Error('اكتب كلمة انضمام من 1 إلى 32 حرفًا'), { status: 400 });
  if (w.split(' ').length > 3) throw Object.assign(new Error('كلمة الانضمام: ثلاث كلمات على الأكثر'), { status: 400 });
  if (/^\p{N}+$/u.test(n)) throw Object.assign(new Error('اختر كلمة وليس رقمًا — الأرقام إجابات في بعض الألعاب'), { status: 400 });
  return w;
}
export function safeLine(raw, max = MAX_MESSAGE) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
export function safeUserName(raw) {
  return safeLine(raw, 32) || 'مشاهد';
}
export class Engine {
  constructor({ now = () => Date.now(), random = randomInt, notify = () => {}, lazy = false } = {}) {
    this.lazy = lazy; // lazy: notify() only signals a change; the owner builds one snapshot per broadcast tick
    this.now = now;
    this.random = random;
    this.notify = notify;
    this.players = new Map();
    this.recent = [];
    this.raceProgress = new Map();
    this.raceLastMove = new Map();
    this.wheelEntries = new Map();
    this.lastChatAt = new Map();
    this.round = 0;
    this.registration = { phase: 'idle', keyword: 'انضم', openedAt: null, closedAt: null, session: 0, maxPlayers: MAX_PLAYERS, audience: 'all', hostJoin: 'manual', lateJoin: 'click', generation: 1, notBefore: 0 };
    this.glass = { steps: 10, stepDuration: 10, step: 0, safeSide: 0, survivors: new Set(), choices: new Map(), choiceTimes: new Map() };
    this.registrationRecent = [];
    // Viewers who wrote the join word after kick-off: they enter the next round automatically.
    this.waiting = new Map();
    this.firstAnswers = new Map();
    this.correctAnswers = [];
    this.answerSequence = 0;
    this.status = { mode: 'quiz', active: false, title: 'تحدي المعلومات', prompt: 'ما هي عاصمة المملكة العربية السعودية؟', options: ['الرياض', 'جدة', 'الدمام', 'مكة'], answer: '1', winner: null, notice: 'جاهز للفعالية!', target: 12, duration: 30, startedAt: null, endsAt: null, submissionCount: 0, results: null, lastEvent: null, glassStep: 0, glassSteps: 10, glassRemaining: 0 };
    this.connection = { state: 'disconnected', username: '', detail: 'لم يتم الربط', platform: 'tiktok' };
    this.streamer = { key: '', name: '', avatar: '' };
    // Server-side facts about the stream: ownership proven, live confirmed by the platform. Never set from a browser.
    this.connMeta = { verified: false, verifying: false, liveConfirmed: false };
    this.party = null;
    this.partyConfig = {};
    this.simulation = { autoplay: false };
    this.botLastAct = new Map();
    this.seenMsgIds = new Set();
    this.msgOrder = [];
    this.branding = { mascot: { visor: MASCOT_PRESETS.visor[0], crown: 'gold' } };
    this.bomb = new BombGame({ now: () => this.now(), random: n => this.random(n) });
    this.demoSerial = 0;
    // «تحدي المعرفة» as a series of questions; the next one is drawn by questionSource (set by the room).
    this.quiz = { total: 1, index: 0, scoring: 'speed', category: 'all', difficulty: 'all', nextAt: null };
    this.questionSource = null;
  }
  setQuizSeries({ total = 1, scoring = 'speed', category = 'all', difficulty = 'all' } = {}) {
    if (this.status.active) throw new Error('أنهِ الجولة قبل تغيير إعداداتها');
    this.quiz = { total: Math.max(1, Math.min(50, total | 0)), index: 0, scoring: scoring === 'flat' ? 'flat' : 'speed', category, difficulty, nextAt: null };
  }
  /** After a question ends on its own, the next one of the series starts a few seconds later (results stay on screen). */
  nextQuestion() {
    this.quiz.nextAt = null;
    if (!this.questionSource || this.status.mode !== 'quiz' || !this.players.size) return false;
    const q = this.questionSource({ category: this.quiz.category, difficulty: this.quiz.difficulty });
    if (!q) return false;
    const keep = { ...this.quiz };
    this.configure({ mode: 'quiz', title: q.title, prompt: q.prompt, options: q.options, answer: q.answer });
    this.quiz = keep;
    this.quizContinuing = true;
    try { this.start(); } finally { this.quizContinuing = false; }
    return true;
  }
  setConnection(state, username = '', detail = '', platform = this.connection.platform || 'tiktok') {
    const previousState = this.connection.state;
    const key = (platform === 'kick' ? 'kick' : 'tiktok') + ':' + String(username || '').toLowerCase();
    if (this.streamer?.key !== key) { // a different channel: forget the old profile and its proofs
      this.streamer = { key, name: '', avatar: '' };
      this.connMeta = { verified: false, verifying: false, liveConfirmed: false };
    }
    this.connection = { state, username: safeLine(username, 50), detail: safeLine(detail, 180), platform: platform === 'kick' ? 'kick' : 'tiktok' };
    if (state === 'connected' && this.registration.phase === 'open' && this.registration.hostJoin === 'auto') this.joinHost(false);
    // Connecting the stream never opens signups by itself: the host opens them from «تجهيز المتسابقين».
    this.emit();
  }
  /** Players who joined from the real chat (no demo bots, no names typed by the host). */
  realPlayerCount() { let n = 0; for (const p of this.players.values()) if (!p.id.startsWith('demo:') && !p.manual) n++; return n; }
  /** Ownership / live facts decided by the server (verification code seen in the owner's chat, platform live check). */
  setConnectionMeta(meta = {}) {
    const next = { ...this.connMeta };
    for (const k of ['verified', 'verifying', 'liveConfirmed']) if (typeof meta[k] === 'boolean') next[k] = meta[k];
    if (next.verified) next.verifying = false;
    const changed = Object.keys(next).some((k) => next[k] !== this.connMeta[k]);
    this.connMeta = next;
    if (changed) this.emit();
  }
  /** Broadcaster profile (display name + picture) read from the platform when the stream connects. */
  setStreamer({ displayName = '', avatar = '', platformId = '' } = {}) {
    if (!this.streamer) this.streamer = { key: '', name: '', avatar: '' };
    const name = safeLine(displayName, 50), image = safeStreamerAvatar(avatar);
    const pid = String(platformId || '');
    if (/^[A-Za-z0-9_-]{1,40}$/.test(pid)) this.streamer.platformId = pid;
    if (name) this.streamer.name = name;
    if (image) this.streamer.avatar = image;
  }
  emit() { if (this.lazy) this.notify(); else this.notify(this.snapshot()); }
  snapshot() {
    const players = [...this.players.values()].sort((a, b) => b.score - a.score || (a.correctRounds && b.correctRounds ? a.totalResponseMs / a.correctRounds - b.totalResponseMs / b.correctRounds : 0) || a.firstSeen - b.firstSeen).slice(0, 20).map(({ id, name, score, avatar, correctRounds = 0, totalResponseMs = 0 }) => ({ id, name, score, ...(avatar ? { avatar } : {}), correctRounds, avgMs: correctRounds ? Math.round(totalResponseMs / correctRounds) : null }));
    const race = [...this.raceProgress.entries()].map(([id, progress]) => ({ id, name: this.players.get(id)?.name || id, progress }))
      .sort((a,b) => b.progress - a.progress).slice(0, 15);
    return {
      status: { ...this.status, answer: undefined, choiceCounts: [1, 2, 3, 4].map(n => [...this.firstAnswers.values()].filter(a => a.choice === String(n)).length), choiceVoters: [1, 2, 3, 4].map(n => [...this.firstAnswers.entries()].filter(([, a]) => a.choice === String(n)).slice(0, 3).map(([id]) => this.publicPlayer(this.players.get(id)))) },
      connection: { ...this.connection, verified: this.connMeta.verified, verifying: this.connMeta.verifying, liveConfirmed: this.connection.state === 'connected' && this.connMeta.liveConfirmed },
      leaderboard: players,
      race,
      entries: [...this.wheelEntries.values()].map(({ name }) => name).slice(0, 60),
      entriesCount: this.wheelEntries.size,
      bomb: this.bomb.snapshot(),
      glass: { step: this.glass.step, steps: this.glass.steps, remaining: this.glass.survivors.size, duration: this.glass.stepDuration, voted: this.glass.choices.size, choiceCounts: [1, 2].map(n => [...this.glass.choices.values()].filter(x => x === n).length) },
      recent: this.recent,
      round: this.round,
      playerCount: this.players.size,
      party: this.party ? this.party.snapshot() : null,
      simulation: { ...this.simulation },
      branding: this.branding,
      roster: [...this.players.values()].slice(0, 300).map(p => ({ number: p.number, name: p.name, score: p.score, ...(p.avatar ? { avatar: p.avatar } : {}), ...(p.host ? { host: true } : {}), ...(p.manual ? { manual: true } : {}), ...(p.id.startsWith('demo:bot-') ? { bot: true } : {}) })),
      registration: { ...this.registration, count: this.players.size, minPlayers: minPlayersFor(this.status.mode), hostSeated: !!this.hostSeat(),
        waitingCount: this.waiting.size, waitingRecent: [...this.waiting.values()].slice(-5).reverse().map(w => w.name), recent: [...this.registrationRecent], participants: [...this.players.values()].slice(-100).map((p, i, tail) => ({ name: p.name, number: this.players.size - tail.length + i + 1, ...(p.avatar ? { avatar: p.avatar } : {}) })) },
      series: this.status.mode === 'quiz' ? { index: this.quiz.index, total: this.quiz.total, nextAt: this.quiz.nextAt } : null,
      serverTime: this.now()
    };
  }
  publicPlayer(player) {
    return { name: player?.name || 'مشاهد', number: player?.number || 0, ...(player?.avatar ? { avatar: player.avatar } : {}) };
  }
  player(userId, name, avatar = '') {
    const id = safeLine(userId, 80) || safeUserName(name);
    if (!this.players.has(id)) {
      if (this.players.size >= MAX_PLAYERS) return null;
      this.players.set(id, { id, number: this.players.size + 1, name: safeUserName(name), score: 0, firstSeen: this.now(), correctRounds: 0, totalResponseMs: 0 });
    }
    const player = this.players.get(id);
    player.name = safeUserName(name);
    const image = safeAvatarUrl(avatar);
    if (image) player.avatar = image;
    return player;
  }
  eligibleForAudience(player, audience) {
    return audience === 'all' ||
      (audience === 'followers' && player.isFollower === true) ||
      (audience === 'subscribers' && player.isSubscriber === true);
  }
  pruneForAudience(audience) {
    let removed = 0;
    for (const [id, player] of this.players) {
      if (this.eligibleForAudience(player, audience)) continue;
      this.players.delete(id);
      this.raceProgress.delete(id);
      this.raceLastMove.delete(id);
      this.wheelEntries.delete(id);
      this.glass.survivors.delete(id);
      this.glass.choices.delete(id);
      this.glass.choiceTimes.delete(id);
      this.firstAnswers.delete(id);
      removed++;
    }
    if (removed) {
      this.correctAnswers = this.correctAnswers.filter(answer => this.players.has(answer.id));
      this.registrationRecent = [...this.players.values()].slice(-REGISTRATION_PREVIEW).reverse()
        .map(p => ({ name:p.name, joinedAt:p.firstSeen, ...(p.avatar ? {avatar:p.avatar} : {}) }));
    }
    return removed;
  }
  updateRegistration({ keyword = this.registration.keyword, maxPlayers = this.registration.maxPlayers, audience = this.registration.audience, hostJoin, hostName } = {}) {
    if (hostName !== undefined) this.registration.hostName = safeLine(hostName, 32).replace(/^@/, '') || 'المشرف';
    if (hostJoin !== undefined) {
      if (!['manual', 'auto'].includes(hostJoin)) throw new Error('خيار دخول المضيف غير صالح');
      this.registration.hostJoin = hostJoin;
    }
    if (this.status.active) { if (hostJoin !== undefined) { this.emit(); return { hostJoin }; } throw new Error('لا يمكن تعديل التسجيل أثناء الجولة'); }
    const clean = keyword === this.registration.keyword ? keyword : cleanJoinWord(keyword);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > MAX_PLAYERS)
      throw new Error('عدد اللاعبين يجب أن يكون بين 1 و1500');
    if (!['all','followers','subscribers'].includes(audience))
      throw new Error('نوع الجمهور غير صالح');
    const eligibleCount = [...this.players.values()].filter(player => this.eligibleForAudience(player,audience)).length;
    if (eligibleCount > maxPlayers) throw new Error('الحد أقل من عدد المتسابقين المؤهلين المسجلين');
    const removed = this.pruneForAudience(audience);
    Object.assign(this.registration, { keyword:clean, maxPlayers, audience });
    if (this.registration.phase === 'open' && this.registration.hostJoin === 'auto') this.joinHost(false);
    this.status.notice = this.registration.phase === 'open'
      ? 'التسجيل مفتوح ' + (audience === 'followers' ? 'للمتابعين فقط' : audience === 'subscribers' ? 'للمشتركين فقط' : 'للجميع')
      : this.status.notice;
    this.emit();
    return { phase:this.registration.phase, audience, maxPlayers, removed, remaining:this.players.size, hostJoin:this.registration.hostJoin };
  }
  openRegistration({ keyword = this.registration.keyword, reset = false, maxPlayers = this.registration.maxPlayers, audience = this.registration.audience } = {}) {
    if (this.status.active) throw new Error('أنهِ الجولة قبل فتح التسجيل');
    const clean = keyword === this.registration.keyword ? keyword : cleanJoinWord(keyword);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > MAX_PLAYERS) throw new Error('عدد اللاعبين يجب أن يكون بين 1 و1500');
    if (!['all','followers','subscribers'].includes(audience)) throw new Error('نوع الجمهور غير صالح');
    const eligibleCount = reset ? 0 : [...this.players.values()].filter(player => this.eligibleForAudience(player,audience)).length;
    if (!reset && maxPlayers < eligibleCount) throw new Error('الحد أقل من عدد المتسابقين المؤهلين المسجلين');
    if (reset) {
      this.players.clear(); this.recent = []; this.round = 0;
      this.lastChatAt.clear();
      this.raceProgress.clear(); this.raceLastMove.clear(); this.wheelEntries.clear();
      this.firstAnswers.clear(); this.correctAnswers = [];
      this.status.results = null; this.status.winner = null; this.status.submissionCount = 0;
      this.registrationRecent = [];
      this.party = null;
    }
    if (!reset) this.pruneForAudience(audience);
    this.registration = { phase: 'open', keyword: clean, openedAt: this.now(), closedAt: null, session: this.registration.session + 1, maxPlayers, audience, hostJoin: this.registration.hostJoin || 'manual', hostName: this.registration.hostName, lateJoin: this.registration.lateJoin || 'click', generation: this.registration.generation || 1, notBefore: this.registration.notBefore || 0 };
    if (this.registration.hostJoin === 'auto') this.joinHost(false);
    this.status.results = null; this.status.winner = null; this.status.endsAt = null;
    this.status.notice = `التسجيل مفتوح! اكتب ${clean} في شات البث`;
    this.status.lastEvent = null;
    this.admitWaiting();
    this.emit();
    return this.registration;
  }
  /** Late joiners from the previous round enter as soon as signups reopen (same eligibility rules). */
  admitWaiting() {
    if (this.registration.phase !== 'open' || !this.waiting.size) return 0;
    let added = 0;
    for (const [id, w] of this.waiting) { if (this.register(id, w.name, w.avatar, w, false)) { added++; this.noteHandle(id, w.handle); } }
    this.waiting.clear();
    return added;
  }
  closeRegistration() {
    if (this.registration.phase !== 'open') throw new Error('التسجيل ليس مفتوحًا');
    this.registration.phase = 'closed';
    this.registration.closedAt = this.now();
    this.status.notice = `انتهى التسجيل • ${this.players.size} متسابقًا جاهزًا`;
    this.emit();
    return this.registration;
  }
  register(id, name, avatar = '', { isFollower = false, isSubscriber = false } = {}, notify = true) {
    if (this.registration.phase !== 'open' || !id || this.players.has(id)) return false;
    if (this.players.size >= this.registration.maxPlayers) return false;
    if (this.registration.audience === 'followers' && !isFollower) return false;
    if (this.registration.audience === 'subscribers' && !isSubscriber) return false;
    const player = this.player(id, name, avatar);
    if (!player) return false;
    player.isFollower = isFollower === true;
    player.isSubscriber = isSubscriber === true;
    this.registrationRecent.unshift({ name: player.name, joinedAt: this.now(), ...(player.avatar ? { avatar: player.avatar } : {}) });
    this.registrationRecent.length = Math.min(this.registrationRecent.length, REGISTRATION_PREVIEW);
    if (notify) this.emit();
    return true;
  }
  /** The viewer's public platform handle: lets a سبونج لايف account that linked the same platform account see its own stats. */
  noteHandle(id, handle) {
    const h = String(handle || '').replace(/^@/, '').toLowerCase();
    const p = this.players.get(id);
    if (p && /^[a-z0-9_.]{1,40}$/.test(h)) p.handle = h;
  }
  registerLate(id, name, avatar, who) {
    const phase = this.registration.phase;
    this.registration.phase = 'open';
    try { return this.register(id, name, avatar, who, false); } finally { this.registration.phase = phase; }
  }
  /** «الانضمام بعد بدء اللعبة»: 'click' — the host adds newcomers by hand; 'open' — the join word works during the round. */
  setLateJoin(mode) {
    if (!['click', 'open'].includes(mode)) throw new Error('خيار الانضمام غير صالح');
    this.registration.lateJoin = mode;
  }
  hasValidJoinWord(text) {
    return normalizeAnswer(text) === normalizeAnswer(this.registration.keyword);
  }
  announce(text, winner = null) {
    this.status.notice = safeLine(text, 180);
    this.status.winner = winner;
    this.status.lastEvent = { text: this.status.notice, at: this.now(), winner };
  }
  configure({ mode, title, prompt, options, answer, target, duration, glassSteps, glassStepDuration, bombSeconds, rounds, roundSeconds, variant } = {}) {
    if (this.status.active) throw new Error('أنه الجولة الحالية قبل تغيير إعداداتها');
    if (bombSeconds !== undefined) this.bomb.configure({ seconds: bombSeconds });
    if (mode !== undefined && !MODES.includes(mode)) throw new Error('نمط غير معروف');
    if (title !== undefined) this.status.title = safeLine(title, 80);
    if (mode !== undefined) this.status.mode = mode;
    if (prompt !== undefined) this.status.prompt = safeLine(prompt, 200);
    if (options !== undefined) {
      if (!Array.isArray(options) || options.length !== 4) throw new Error('يجب إدخال أربعة خيارات');
      this.status.options = options.map(x => safeLine(x, 80));
    }
    if (answer !== undefined) this.status.answer = safeLine(answer, 80);
    if (target !== undefined) {
      const n = Number(target);
      if (!Number.isInteger(n) || n < 3 || n > 100) throw new Error('الهدف من 3 إلى 100');
      this.status.target = n;
    }
    if (duration !== undefined) {
      const seconds = Number(duration);
      if (!Number.isInteger(seconds) || seconds < 10 || seconds > 180) throw new Error('مدة الجولة يجب أن تكون من 10 إلى 180 ثانية');
      this.status.duration = seconds;
    }
    const partyMode = PARTY_MODES.includes(mode ?? this.status.mode) ? (mode ?? this.status.mode) : null;
    if (partyMode && variant !== undefined) {
      // Per-game rule switches, validated against a fixed list.
      const allowed = { rps: { format: ['duel', 'sky'] }, roulette: { rule: ['eliminate', 'winner'] }, categories: { scoring: ['elimination', 'points'] }, chain: { target: CHAIN_TARGETS, order: ['ordered', 'random'], alternate: [true, false], review: [true, false], sounds: [true, false] }, drawguess: { winners: [1, 2, 3] }, outsider: { category: ['random', ...Object.keys(OUTSIDER_WORDS)] } }[partyMode] || {};
      const clean = {};
      for (const [k, v] of Object.entries(variant || {})) { if (!allowed[k]?.includes(v)) throw new Error('خيار غير صالح لهذه اللعبة'); clean[k] = v; }
      this.partyConfig[partyMode] = { ...this.partyConfig[partyMode], ...clean };
    }
    if (partyMode && (rounds !== undefined || roundSeconds !== undefined)) {
      const cfg = { ...PARTY_DEFAULTS[partyMode], ...this.partyConfig[partyMode] };
      if (rounds !== undefined) {
        const n = Number(rounds);
        if (!Number.isInteger(n) || n < 1 || n > 30) throw new Error('عدد الجولات من 1 إلى 30');
        cfg.rounds = n;
      }
      if (roundSeconds !== undefined) {
        const sec = Number(roundSeconds);
        if (!Number.isInteger(sec) || sec < 4 || sec > 180) throw new Error('وقت الجولة من 4 إلى 180 ثانية');
        cfg.seconds = sec;
      }
      this.partyConfig[partyMode] = { ...this.partyConfig[partyMode], rounds: cfg.rounds, seconds: cfg.seconds }; // rule switches (variant) are kept
    }
    if (glassSteps !== undefined) {
      if (![5, 10, 15].includes(glassSteps)) throw new Error('طول الجسر يجب أن يكون 5 أو 10 أو 15 خطوة');
      this.glass.steps = glassSteps;
      this.status.glassSteps = glassSteps;
    }
    if (glassStepDuration !== undefined) {
      if (!Number.isInteger(glassStepDuration) || glassStepDuration < 5 || glassStepDuration > 60) throw new Error('وقت قفزة الجسر يجب أن يكون بين 5 و60 ثانية');
      this.glass.stepDuration = glassStepDuration;
    }
    this.status.active = false;
    this.status.winner = null;
    this.status.results = null;
    this.status.startedAt = null;
    this.status.endsAt = null;
    this.status.submissionCount = 0;
    this.firstAnswers.clear(); this.correctAnswers = []; this.answerSequence = 0;
    this.status.lastEvent = null;
    this.status.notice = 'الإعدادات محفوظة، ابدأ الجولة';
    this.raceProgress.clear(); this.raceLastMove.clear(); this.wheelEntries.clear();
    this.glass.choices.clear(); this.glass.choiceTimes.clear(); this.glass.survivors.clear(); this.glass.step = 0;
    this.status.glassStep = 0; this.status.glassRemaining = 0;
    this.party = null;
    this.emit();
  }
  start() {
    if (this.status.active) throw new Error('يوجد سؤال جارٍ بالفعل');
    if (this.registration.phase === 'idle') throw new Error('افتح التسجيل أولًا ليكتب المشاهدون كلمة الانضمام');
    if (!this.players.size) throw new Error('لا يوجد متسابقون مسجلون، انتظر انضمام لاعب واحد على الأقل');
    if (this.status.mode === 'quiz' && (!this.status.options.some(Boolean) || !['1','2','3','4'].includes(this.status.answer))) throw new Error('حدد الإجابة الصحيحة من 1 إلى 4');
    if (this.status.mode === 'guess' && !normalizeAnswer(this.status.answer)) throw new Error('اكتب الإجابة الصحيحة');
    if (this.status.mode === 'bomb') {
      if (this.players.size < 2) throw new Error('القنبلة المؤقتة تحتاج لاعبَين مسجلَين على الأقل');
      // Fixed roster: the match keeps exactly the players registered at kick-off.
      this.bomb.start([...this.players.values()].slice(0, this.registration.maxPlayers));
    }
    const partyMode = PARTY_MODES.includes(this.status.mode);
    const need = minPlayersFor(this.status.mode);
    if (this.players.size < need) throw new Error(`هذه اللعبة تحتاج ${need} متسابقين على الأقل`);
    if (this.registration.phase === 'open') this.closeRegistration();
    if (this.status.mode === 'quiz') { this.quiz.index = this.quizContinuing ? this.quiz.index + 1 : 1; this.quiz.nextAt = null; }
    this.round++;
    this.status.active = true;
    this.firstAnswers.clear(); this.correctAnswers = []; this.answerSequence = 0;
    this.status.submissionCount = 0;
    this.status.results = null;
    this.status.startedAt = this.now();
    this.status.endsAt = ['quiz','guess'].includes(this.status.mode) ? this.status.startedAt + this.status.duration * 1000 : null;
    if (this.status.mode === 'glass') {
      this.glass.step = 1;
      this.glass.survivors = new Set([...this.players.keys()].slice(0, this.registration.maxPlayers));
      this.glass.choices.clear(); this.glass.choiceTimes.clear();
      this.glass.safeSide = this.random(2) + 1;
      this.status.glassStep = 1;
      this.status.glassRemaining = this.glass.survivors.size;
      this.status.glassSteps = this.glass.steps;
      this.status.endsAt = this.status.startedAt + this.glass.stepDuration * 1000;
    }
    this.party = null;
    if (partyMode) {
      const cfg = { ...PARTY_DEFAULTS[this.status.mode], ...this.partyConfig[this.status.mode] };
      this.party = createPartyGame(this.status.mode, { ...cfg, now: () => this.now(), random: n => this.random(n) });
      this.party.start([...this.players.values()].slice(0, this.registration.maxPlayers));
      this.syncParty(false);
    }
    this.status.winner = null;
    this.status.lastEvent = null;
    this.status.notice = partyMode ? 'بدأت اللعبة! شارك من التعليقات' : this.status.mode === 'bomb' ? 'القنبلة مع اللاعب #' + this.bomb.snapshot().holder.number + ' — مرّرها قبل الانفجار!' : 'بدأت الجولة! شارك الآن';
    this.raceProgress.clear(); this.raceLastMove.clear(); this.wheelEntries.clear();
    if (this.status.mode === 'race') for (const id of this.players.keys()) this.raceProgress.set(id, 0);
    if (this.status.mode === 'wheel') for (const player of this.players.values()) {
      if (this.wheelEntries.size >= MAX_ENTRIES) break;
      this.wheelEntries.set(player.id, { id: player.id, name: player.name });
    }
    this.lastChatAt.clear();
    this.emit();
  }
  stop() {
    if (this.quiz.nextAt) { this.quiz.nextAt = null; this.status.notice = 'انتهت أسئلة الجولة'; if (!this.status.active) { this.emit(); return; } }
    if (this.status.active && this.status.mode === 'bomb') { this.bomb.end('manual'); this.finishBomb(); return; }
    if (this.status.active && this.status.mode === 'glass') { this.endGlassGame('manual'); return; }
    if (this.status.active && ['quiz', 'guess'].includes(this.status.mode)) return this.finishTimedRound('manual');
    if (this.status.active && this.party) { this.party.end('manual'); this.finishParty(); return; }
    this.status.active = false; this.status.notice = 'الجولة متوقفة'; this.emit();
  }
  tick() {
    if (this.simulation.autoplay && this.status.active) this.botStep();
    if (this.status.active && this.party) {
      const changed = this.party.tick();
      if (this.party.finished) { this.finishParty(); return true; }
      if (changed) { this.syncParty(); }
      return changed;
    }
    if (this.status.active && this.status.mode === 'bomb') {
      const changed = this.bomb.tick();
      if (this.bomb.phase === 'finished') { this.finishBomb(); return true; }
      if (changed) { this.bombNotice(); this.emit(); }
      return changed;
    }
    if (this.status.active && this.status.endsAt !== null && this.now() >= this.status.endsAt) {
      if (this.status.mode === 'glass') this.finishGlassStep(); else this.finishTimedRound('timer'); return true;
    }
    if (!this.status.active && this.quiz.nextAt && this.now() >= this.quiz.nextAt) {
      try { return this.nextQuestion(); } catch (err) { this.quiz.nextAt = null; this.status.notice = safeLine(err.message, 180); this.emit(); return true; }
    }
    return false;
  }
  bombNotice() {
    const b = this.bomb.snapshot();
    this.status.notice = b.phase === 'exploded' ? 'انفجرت القنبلة! تم إقصاء اللاعب #' + b.explosion.player.number
      : b.phase === 'paused' ? 'المباراة موقوفة مؤقتًا'
      : b.holder ? 'القنبلة مع اللاعب #' + b.holder.number + ' — مرّرها قبل الانفجار!' : this.status.notice;
  }
  /** Close a finished bomb match exactly once: award the survivor and release the round. */
  finishBomb() {
    if (this.status.mode !== 'bomb' || !this.status.active || this.bomb.phase !== 'finished') return false;
    const b = this.bomb.snapshot();
    this.status.active = false;
    this.status.endsAt = null;
    const winner = b.winner ? this.bomb.winner : null;
    if (winner && this.players.has(winner)) this.addScore(this.players.get(winner), 10);
    this.status.winner = b.winner ? { id: winner || undefined, name: b.winner.name, number: b.winner.number, score: 10, ...(b.winner.avatar ? { avatar: b.winner.avatar } : {}) } : null;
    this.status.notice = b.winner ? 'الناجي الأخير: ' + b.winner.name + ' (#' + b.winner.number + ')' : 'تم إنهاء مباراة القنبلة يدويًا';
    this.status.lastEvent = { text: this.status.notice, at: this.now(), winner: this.status.winner };
    this.emit();
    return true;
  }
  /** After any bomb operation: finish the match if it ended, otherwise publish the new state. */
  syncBomb() {
    if (this.bomb.phase === 'finished') return this.finishBomb() || (this.emit(), true);
    this.bombNotice(); this.emit(); return true;
  }
  requireBombMatch() {
    if (this.status.mode !== 'bomb' || !this.status.active) throw new Error('لا توجد مباراة قنبلة جارية');
  }
  bombPause() { this.requireBombMatch(); this.bomb.pause(); return this.syncBomb(); }
  bombResume() { this.requireBombMatch(); this.bomb.resume(); return this.syncBomb(); }
  /** Host/test control: pass on behalf of the current holder. Same rules as a chat pass. */
  bombPass({ target, turn, match } = {}) {
    this.requireBombMatch();
    const guard = {};
    if (turn !== undefined) guard.expectedTurn = Number(turn);
    if (match !== undefined) guard.expectedMatch = Number(match);
    const result = this.bomb.pass(this.bomb.holder, target, guard);
    this.syncBomb();
    if (!result.ok) throw new Error({ 'not-armed': 'لا يمكن التمرير الآن', 'stale-turn': 'انتهت هذه الدورة بالفعل', expired: 'انتهى الوقت — انفجرت القنبلة', 'unknown-target': 'رقم اللاعب غير موجود', self: 'لا يمكن تمرير القنبلة إلى نفس الحامل', eliminated: 'هذا اللاعب مُقصى', 'not-holder': 'لا يحمل القنبلة' }[result.reason] || 'تمرير غير صالح');
    return result;
  }
  bombRestart() {
    if (this.status.mode !== 'bomb') throw new Error('اختر لعبة القنبلة المؤقتة أولًا');
    if (this.status.active) { this.bomb.end('restart'); this.status.active = false; }
    this.start();
    return true;
  }
  bombSettings({ seconds, sound, autoBots } = {}) {
    if (seconds !== undefined && this.status.active && this.status.mode === 'bomb') throw new Error('لا يمكن تغيير مدة القنبلة أثناء المباراة');
    this.bomb.configure({ seconds, sound, autoBots });
    this.emit();
    return { seconds: this.bomb.seconds, sound: this.bomb.sound, autoBots: this.bomb.autoBots };
  }
  /** Test mode: register demo contestants without a live broadcast. */
  addDemoPlayers({ count = 6 } = {}) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error('عدد اللاعبين التجريبيين من 1 إلى 100');
    if (this.status.active) throw new Error('أنهِ الجولة قبل إضافة لاعبين تجريبيين');
    if (this.registration.phase === 'idle') { if (this.lobbyManaged) { this.registration.phase = 'closed'; this.registration.closedAt = this.now(); } else this.openRegistration({}); }
    const closed = this.registration.phase !== 'open'; // a closed registration stays closed: test players are seated by the host
    const names = ['نورة','فهد','ريم','سلطان','لمى','ماجد','هيا','تركي','جود','بدر','دانة','يزيد','شهد','راكان','غادة','عبدالله'];
    let added = 0;
    for (let i = 0; i < n; i++) {
      const serial = ++this.demoSerial;
      const id = 'demo:bot-' + serial, name = names[(serial - 1) % names.length] + ' ' + serial, who = { isFollower: true, isSubscriber: true };
      if (closed ? this.registerLate(id, name, '', who) : this.register(id, name, '', who)) added++;
    }
    if (closed && added) this.emit();
    return added;
  }
  finishGlassStep() {
    if (!this.status.active || this.status.mode !== 'glass') return false;
    const surviving = [...this.glass.survivors].filter(id => this.glass.choices.get(id) === this.glass.safeSide);
    this.glass.survivors = new Set(surviving);
    this.status.glassRemaining = surviving.length;
    this.status.submissionCount = this.glass.choices.size;
    if (!surviving.length || this.glass.step >= this.glass.steps) {
      this.endGlassGame('timer');
      return true;
    }
    this.glass.step++;
    this.status.glassStep = this.glass.step;
    this.glass.choices.clear(); this.glass.choiceTimes.clear();
    this.glass.safeSide = this.random(2) + 1;
    this.status.endsAt = this.now() + this.glass.stepDuration * 1000;
    this.status.notice = 'الجسر الزجاجي — الخطوة ' + this.glass.step + ' من ' + this.glass.steps;
    this.emit();
    return true;
  }
  endGlassGame(reason = 'timer') {
    if (!this.status.active || this.status.mode !== 'glass') return false;
    const completed = this.glass.step >= this.glass.steps && this.glass.survivors.size > 0;
    const results = completed
      ? [...this.glass.survivors].sort((a,b) => (this.glass.choiceTimes.get(a)||Infinity) - (this.glass.choiceTimes.get(b)||Infinity))
      : [];
    const rankings = results.map((id,i) => {
      const player = this.players.get(id);
      const points = QUIZ_POINTS[Math.min(i, QUIZ_POINTS.length-1)];
      if (player) this.addScore(player,points);
      return { rank:i+1, id, name:player?.name||'متسابق', ...(player?.avatar?{avatar:player.avatar}:{}), points, totalScore:player?.score||points };
    });
    const winner=rankings[0];
    this.status.active=false;
    this.status.endsAt=null;
    this.status.winner=winner?{ id:winner.id, name:winner.name, score:winner.points, ...(winner.avatar?{avatar:winner.avatar}:{}) }:null;
    this.status.results={ round:this.round, completedAt:this.now(), reason,
      totalAnswers:this.glass.choices.size, correctCount:rankings.length,
      correctAnswer:completed?'اكتمل عبور الجسر':'لم ينجُ أحد من الجسر', rankings:rankings.slice(0,20) };
    this.status.notice=winner?'🏆 بطل الجسر الزجاجي: '+winner.name : reason==='manual'?'تم إيقاف الجسر الزجاجي':'انتهت الجولة، لم يعبر أي متسابق';
    this.status.lastEvent={ text:this.status.notice, at:this.now(), winner:this.status.winner };
    this.emit();
    return true;
  }
  finishTimedRound(reason = 'timer') {
    if (!this.status.active || !['quiz','guess'].includes(this.status.mode)) return false;
    const ranking = [...this.correctAnswers].sort((a, b) => a.at - b.at || a.order - b.order)
      .map((entry, index) => {
        const player = this.players.get(entry.id);
        const points = this.status.mode === 'quiz' && this.quiz.scoring === 'flat' ? 5 : QUIZ_POINTS[Math.min(index, QUIZ_POINTS.length - 1)];
        if (player) { this.addScore(player, points); player.correctRounds++; player.totalResponseMs += entry.elapsedMs; }
        return { rank: index + 1, id: entry.id, ...(player?.number ? { number: player.number } : {}), name: player?.name ?? entry.name, ...(player?.avatar ? { avatar: player.avatar } : {}), elapsedMs: entry.elapsedMs, points, totalScore: player?.score ?? points };
      });
    const winner = ranking[0] || null;
    const answerText = this.status.mode === 'quiz' ? this.status.options[Number(this.status.answer)-1] : this.status.answer;
    this.status.active = false;
    this.status.endsAt = null;
    this.status.winner = winner ? { id: winner.id, name: winner.name, score: winner.points, ...(winner.avatar ? { avatar: winner.avatar } : {}) } : null;
    this.status.results = { round: this.round, completedAt: this.now(), reason, totalAnswers: this.firstAnswers.size,
      correctCount: ranking.length, correctAnswer: answerText, ...(this.status.mode === 'quiz' ? { correctIndex: Number(this.status.answer) - 1 } : {}), rankings: ranking.slice(0, 20) };
    this.status.notice = winner ? `🏆 الأول في السرعة: ${winner.name}` : 'انتهت الجولة، لا توجد إجابات صحيحة';
    if (this.status.mode === 'quiz' && reason !== 'manual' && this.quiz.index < this.quiz.total && this.questionSource) {
      this.quiz.nextAt = this.now() + QUIZ_NEXT_MS;
      this.status.notice += ` • السؤال ${this.quiz.index + 1} من ${this.quiz.total} بعد لحظات`;
    } else this.quiz.nextAt = null;
    this.status.lastEvent = { text: this.status.notice, at: this.now(), winner: this.status.winner };
    this.emit();
    return true;
  }
  recordAnswer(player, isCorrect, timestamp, choice = null) {
    if (this.firstAnswers.has(player.id)) return; // لا تغيير للإجابة الأولى حتى لو كانت خاطئة
    this.firstAnswers.set(player.id, { correct: isCorrect, at: timestamp, choice });
    this.status.submissionCount = this.firstAnswers.size;
    if (isCorrect) this.correctAnswers.push({ id: player.id, name: player.name, at: timestamp,
      elapsedMs: Math.max(0, timestamp - this.status.startedAt), order: this.answerSequence++ });
  }

  resetScores() {
    if (this.status.active) throw new Error('أنه الجولة قبل تصفير النقاط');
    this.bomb.reset();
    this.players.clear(); this.raceProgress.clear(); this.raceLastMove.clear(); this.wheelEntries.clear(); this.recent = [];
    this.glass.survivors.clear(); this.glass.choices.clear(); this.glass.choiceTimes.clear(); this.glass.step=0;
    this.registrationRecent = [];
    this.waiting.clear();
    this.party = null;
    this.registration.phase = 'idle'; this.registration.openedAt = null; this.registration.closedAt = null;
    // a new registration generation: comments written before the reset (delivered late by the platform) are not joins
    this.registration.generation = (this.registration.generation || 1) + 1; this.registration.notBefore = this.now();
    this.status.results = null; this.status.winner = null;
    this.status.notice = 'تم تصفير الجلسة. افتح التسجيل للبدء من جديد';
    this.emit();
  }
  addScore(player, points) { player.score += points; }
  receiveChat({ id, username, text, avatar = '', isFollower = false, isSubscriber = false, msgId = '', handle = '', at = 0 }) {
    const message = safeLine(text);
    let identity = safeLine(id, 80);
    // Reconnects can replay recent messages; a message id is applied at most once.
    const mid = safeLine(msgId, 120);
    if (mid) {
      if (this.seenMsgIds.has(mid)) return;
      this.seenMsgIds.add(mid); this.msgOrder.push(mid);
      if (this.msgOrder.length > 3000) this.seenMsgIds.delete(this.msgOrder.shift());
    }
    // The streamer's own chat messages map to the host seat when the host joined.
    const hostKey = this.connection.username ? 'host:' + this.connection.username.toLowerCase() : '';
    const fromStreamer = handle && hostKey && 'host:' + String(handle).toLowerCase().replace(/^@/, '') === hostKey;
    if (fromStreamer && !this.streamer?.avatar) this.setStreamer({ displayName: username, avatar }); // the streamer's own comment carries their picture
    if (fromStreamer && this.players.has(hostKey)) identity = hostKey;
    if (!message || !identity) return;
    const currentTime = this.now();
    if (this.status.active && !this.party && this.status.mode !== 'bomb' && this.status.endsAt !== null && currentTime >= this.status.endsAt) { if (this.status.mode === 'glass') this.finishGlassStep(); else this.finishTimedRound('timer'); }
    if (this.status.active && this.party) { this.party.tick(); if (this.party.finished) this.finishParty(); }
    const dedupKey = `${identity}\u0000${message}`;
    if (currentTime - (this.lastChatAt.get(dedupKey) ?? -Infinity) < 300) return;
    this.lastChatAt.set(dedupKey, currentTime);
    if (this.lastChatAt.size > 1000) this.lastChatAt.clear();
    const name = safeUserName(username);
    this.recent.unshift({ name, message, at: currentTime });
    if (this.recent.length > KEEP_CHAT) this.recent.length = KEEP_CHAT;
    // Joining the TikTok room does NOT enroll the viewer. Only the chosen chat word does — and only a comment
    // written after the last «إعادة تعيين» (platform time when the platform gives one).
    const sent = Number(at) || 0;
    if (sent && this.registration.notBefore && sent < this.registration.notBefore && this.hasValidJoinWord(message)) { this.emit(); return; }
    if (this.registration.phase === 'open') {
      if (this.hasValidJoinWord(message) && this.register(identity, name, avatar, {isFollower,isSubscriber})) this.noteHandle(identity, handle);
    } else if (this.registration.phase === 'closed' && this.status.active && this.registration.lateJoin === 'open' && LATE_JOIN.includes(this.status.mode) && !this.players.has(identity) && this.hasValidJoinWord(message)) {
      if (this.registerLate(identity, name, avatar, { isFollower, isSubscriber })) this.noteHandle(identity, handle); // «مفتوح دائمًا»: joins the running round
    } else if (this.registration.phase === 'closed' && !this.players.has(identity) && this.hasValidJoinWord(message)) {
      if (!this.waiting.has(identity) && this.waiting.size < MAX_WAITING) this.waiting.set(identity, { name, avatar, isFollower, isSubscriber, handle });
    } else if (this.registration.phase === 'closed' && this.status.active && this.players.has(identity)) {
      const player = this.player(identity, name, avatar);
      if (player) this.applyMessage(player, message, currentTime);
    }
    this.emit();
  }
  applyMessage(player, message, timestamp) {
    if (this.party) {
      if (this.party.input(player.id, message, timestamp)) { if (this.party.finished) this.finishParty(); else this.syncParty(false); }
      return;
    }
    const input = normalizeAnswer(message);
    if (this.status.mode === 'quiz') {
      // Only a recognized choice counts as an attempt; ordinary chat is ignored.
      const raw = message.trim();
      const key = normalizeAnswer(raw);
      const choices = { '1': '1', '١': '1', 'a': '1', 'ا': '1',
        '2': '2', '٢': '2', 'b': '2', 'ب': '2',
        '3': '3', '٣': '3', 'c': '3', 'ج': '3',
        '4': '4', '٤': '4', 'd': '4', 'د': '4' };
      const option = choices[raw.toLowerCase()] || choices[key] ||
        String(this.status.options.findIndex(text => key && normalizeAnswer(text) === key) + 1);
      if (!['1','2','3','4'].includes(option)) return;
      this.recordAnswer(player, option === this.status.answer, timestamp, option);
    } else if (this.status.mode === 'guess') {
      if (!input || message.trim().startsWith('!')) return;
      this.recordAnswer(player, input === normalizeAnswer(this.status.answer), timestamp);
    } else if (this.status.mode === 'bomb') {
      // Only the real holder (stable TikTok id) can pass; names are never trusted.
      const target = parsePassCommand(message);
      if (target === null) return;
      const result = this.bomb.pass(player.id, target);
      if (result.ok) this.bombNotice();
      if (this.bomb.phase === 'finished') this.finishBomb();
    } else if (this.status.mode === 'glass') {
      if (!this.glass.survivors.has(player.id) || this.glass.choices.has(player.id)) return;
      const choice = message.trim().normalize('NFKC')
        .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
        .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0));
      if (!['1','2'].includes(choice)) return;
      this.glass.choices.set(player.id, Number(choice));
      this.glass.choiceTimes.set(player.id, timestamp);
      this.status.submissionCount = this.glass.choices.size;
    } else if (this.status.mode === 'wheel') {
      // Already enrolled at event registration; no second !join required.
    } else if (this.status.mode === 'race') {
      if (['!go', '!انطلق', 'انطلق', 'go', '🚀'].includes(message.trim().toLowerCase()) && this.raceProgress.has(player.id)) {
        if (timestamp - (this.raceLastMove.get(player.id) ?? -Infinity) < 1200) return;
        this.raceLastMove.set(player.id, timestamp);
        const next = (this.raceProgress.get(player.id) ?? 0) + 1;
        this.raceProgress.set(player.id, next);
        if (next >= this.status.target) this.finishWinner(player, 5);
      }
    }
  }
  finishWinner(player, score) {
    if (!this.status.active) return;
    this.addScore(player, score);
    this.status.active = false;
    this.announce(`🏆 الفائز: ${player.name} (+${score} نقاط)`, { name: player.name, id: player.id, score, ...(player.avatar ? { avatar: player.avatar } : {}) });
  }
  /** Mirror the running party game into status (clock, prompt, counts). */
  syncParty(emit = true) {
    if (!this.party) return;
    const view = this.party.snapshot();
    this.status.endsAt = view.endsAt;
    this.status.prompt = view.prompt || this.status.prompt;
    this.status.submissionCount = view.submitted;
    if (emit) this.emit();
  }
  /** Close a finished party game exactly once and publish its podium. */
  finishParty() {
    if (!this.party || !this.status.active) return false;
    if (!this.party.finished) this.party.end('manual');
    const rankings = this.party.rankings.slice(0, 20).map(r => {
      const player = this.players.get(r.id);
      if (player) this.addScore(player, r.points);
      return { rank: r.rank, id: r.id, name: r.name, ...(r.avatar ? { avatar: r.avatar } : {}), points: r.points, detail: r.detail, totalScore: player?.score ?? r.points };
    });
    const winner = rankings[0] || null;
    this.status.active = false;
    this.status.endsAt = null;
    this.status.winner = winner ? { id: winner.id, name: winner.name, score: winner.points, ...(winner.avatar ? { avatar: winner.avatar } : {}) } : null;
    this.status.results = { round: this.round, completedAt: this.now(), reason: this.party.reason, totalAnswers: this.party.totalInputs,
      correctCount: rankings.length, correctAnswer: this.party.summary() || 'انتهت اللعبة', rankings };
    this.status.notice = winner ? `🏆 بطل ${this.status.title}: ${winner.name}` : 'انتهت اللعبة بدون فائز';
    this.status.lastEvent = { text: this.status.notice, at: this.now(), winner: this.status.winner };
    this.emit();
    return true;
  }
  /** Participants for a lobby that must survive a server restart (no demo players: they are recreated on demand). */
  exportPlayers() {
    return [...this.players.values()].filter((p) => !p.id.startsWith('demo:')).slice(0, MAX_PLAYERS)
      .map((p) => ({ id: p.id, name: p.name, ...(p.avatar ? { avatar: p.avatar } : {}), ...(p.handle ? { handle: p.handle } : {}), ...(p.manual ? { manual: true } : {}), ...(p.host ? { host: true } : {}), joinedAt: p.firstSeen }));
  }
  /** Recovery: put back the participants saved before a restart (scores start again from zero). */
  restorePlayers(list = []) {
    if (this.status.active) throw new Error('لا يمكن الاستعادة أثناء جولة');
    let n = 0;
    for (const x of Array.isArray(list) ? list.slice(0, MAX_PLAYERS) : []) {
      if (!x || typeof x.id !== 'string' || this.players.has(x.id)) continue;
      const p = this.player(x.id, x.name, x.avatar); if (!p) break;
      if (x.manual) p.manual = true; if (x.host) p.host = true; p.isFollower = true; p.isSubscriber = true;
      if (Number.isFinite(x.joinedAt)) p.firstSeen = x.joinedAt;
      this.noteHandle(x.id, x.handle); n++;
    }
    if (n) this.emit();
    return n;
  }
  /** Host control: add a contestant by name (no chat needed). */
  addManualPlayer({ name, host = false } = {}) {
    if (this.status.active && !LATE_JOIN.includes(this.status.mode)) throw new Error('قواعد هذه اللعبة لا تسمح بإضافة لاعب أثناء الجولة');
    const clean = safeLine(name, 32).replace(/^@/, '').trim();
    if (!clean || !normalizeAnswer(clean)) throw new Error('اكتب اسم اللاعب');
    const id = host ? 'host:' + clean.toLowerCase() : 'manual:' + normalizeAnswer(clean);
    if (this.players.has(id)) throw new Error(host ? 'المضيف مسجل بالفعل' : 'هذا الاسم مسجل بالفعل');
    if (this.players.size >= this.registration.maxPlayers) throw new Error('اكتمل عدد المتسابقين');
    // inside a lobby the host's own additions never open the chat registration by themselves
    if (this.registration.phase === 'idle' && !this.status.active) { if (this.lobbyManaged) { this.registration.phase = 'closed'; this.registration.closedAt = this.now(); } else this.openRegistration({}); }
    const player = this.player(id, host ? '@' + clean : clean);
    if (!player) throw new Error('اكتمل عدد المتسابقين');
    player.manual = true; player.host = host; player.isFollower = true; player.isSubscriber = true;
    this.registrationRecent.unshift({ name: player.name, joinedAt: this.now() });
    this.registrationRecent.length = Math.min(this.registrationRecent.length, REGISTRATION_PREVIEW);
    this.emit();
    return { number: player.number, name: player.name };
  }
  /** Seat the streamer (connected account) as a contestant. */
  joinHost(strict = true) {
    const handle = this.connection.username || this.registration.hostName;
    if (!handle) { if (strict) throw new Error('اربط البث أولًا ليُعرف حساب المضيف'); return null; }
    if (this.hostSeat() || this.players.has('host:' + handle.toLowerCase())) { if (strict) throw new Error('المضيف مسجل بالفعل'); return null; }
    try { return this.addManualPlayer({ name: handle, host: true }); } catch (error) { if (strict) throw error; return null; }
  }
  hostSeat() { for (const p of this.players.values()) if (p.host) return p; return null; }
  /** «شارك كلاعب»: the host plays under the same rules. The connected handle is used when there is one,
      so the host's own chat answers count; otherwise the given display name. */
  seatHost({ name } = {}) {
    if (this.status.active) throw new Error('لا يمكن تغيير المشاركة أثناء اللعب');
    if (this.hostSeat()) throw new Error('أنت مشارك بالفعل');
    const label = this.connection.username || safeLine(name, 32).replace(/^@/, '') || this.registration.hostName || 'المشرف';
    return this.addManualPlayer({ name: label, host: true });
  }
  unseatHost() {
    if (this.status.active) throw new Error('بدأ اللعب — لا يمكن إلغاء المشاركة الآن');
    const seat = this.hostSeat();
    if (!seat) throw new Error('لست ضمن المشاركين');
    return this.removePlayer({ number: seat.number });
  }
  /** Join page: select the game and open signups without wiping who already joined. */
  prepareJoin({ mode, title } = {}) {
    if (!MODES.includes(mode)) throw new Error('نمط غير معروف');
    if (this.status.active) {
      if (this.status.mode === mode) return { phase: 'playing' };
      throw Object.assign(new Error('هناك جولة جارية في «' + this.status.title + '» — أنهِها أولًا'), { busy: this.status.mode });
    }
    if (this.status.mode !== mode) this.configure({ mode, ...(title ? { title } : {}) });
    if (this.registration.phase !== 'open') this.openRegistration({});
    return { phase: 'open' };
  }
  removePlayer({ number } = {}) {
    if (this.status.active) throw new Error('لا يمكن إزالة لاعب أثناء الجولة');
    const target = [...this.players.values()].find(p => p.number === Number(number));
    if (!target) throw new Error('رقم اللاعب غير موجود');
    this.players.delete(target.id); this.raceProgress.delete(target.id); this.wheelEntries.delete(target.id); this.firstAnswers.delete(target.id);
    [...this.players.values()].forEach((p, i) => { p.number = i + 1; });
    this.registrationRecent = this.registrationRecent.filter(r => r.name !== target.name);
    this.emit();
    return { removed: target.name };
  }
  /** Simulation: jump the running timer to its end (party phases, timed rounds, glass steps, bomb fuse). */
  advance() {
    if (!this.status.active) throw new Error('لا توجد جولة جارية');
    if (this.party) { this.party.advance(); if (this.party.finished) this.finishParty(); else this.syncParty(); return true; }
    if (this.status.mode === 'bomb') { if (this.bomb.endsAt) this.bomb.endsAt = this.now(); this.tick(); return true; }
    if (this.status.endsAt !== null) { this.status.endsAt = this.now(); this.tick(); return true; }
    throw new Error('هذه اللعبة لا تعتمد على مؤقت');
  }
  setSimulation({ autoplay } = {}) {
    if (typeof autoplay !== 'boolean') throw new Error('قيمة المحاكاة غير صالحة');
    this.simulation.autoplay = autoplay;
    this.emit();
    return { ...this.simulation };
  }
  /* ---- private game helpers (host-only or player-private; never part of the public snapshot) ---- */
  requireParty(mode) { if (!this.party || this.status.mode !== mode || !this.status.active) throw new Error('هذه اللعبة ليست جارية'); return this.party; }
  partySecret() { return this.status.active && this.party?.secret ? this.party.secret() : null; }
  judgeAnswer(accept) { const g = this.requireParty(this.status.mode === 'chain' ? 'chain' : 'categories'); if (!g.judge(accept)) throw new Error('لا توجد إجابة بانتظار الحكم'); this.syncParty(); return true; }
  // the private page serves both secret-role games: «الأدوار المخفية» and «برا السالفة»
  get secretMode() { return this.status.mode === 'outsider' ? 'outsider' : 'roles'; }
  rolesClaim() { return this.requireParty(this.secretMode).claim(); }
  rolesPrivate(token) { if (!['roles', 'outsider'].includes(this.status.mode) || !this.party) return { linked: false, idle: true }; return { game: this.status.mode, ...this.party.privateView(String(token || '')) }; }
  rolesAct(token, number) { const g = this.requireParty(this.secretMode); g.act(String(token || ''), number); this.emit(); return true; }
  rolesAdmin() { const g = this.requireParty(this.secretMode); return g.adminView(!!this.hostSeat()); }
  /** Demo contestants act like real viewers so every rule can be tried without a stream. */
  botStep() {
    const t = this.now(), mode = this.status.mode;
    const bots = [...this.players.values()].filter(p => p.id.startsWith('demo:bot-'));
    if (!bots.length) return;
    const pick = list => list[this.random(list.length)];
    const party = this.party?.snapshot();
    for (const bot of bots) {
      if (t - (this.botLastAct.get(bot.id) ?? 0) < 900 || this.random(100) >= 12) continue;
      this.botLastAct.set(bot.id, t);
      let text = null;
      if (mode === 'quiz') text = this.random(100) < 45 ? this.status.answer : String(this.random(4) + 1);
      else if (mode === 'guess') text = this.random(100) < 25 ? this.status.answer : pick(['بيت', 'قمر', 'نجمة', 'سيارة']);
      else if (mode === 'race') text = '!go';
      else if (mode === 'glass') text = String(this.random(2) + 1);
      else if (mode === 'bomb') { const b = this.bomb.snapshot(); if (b.holder && this.bomb.holder === bot.id) { const alive = (b.alive || []).filter(p => p.number !== b.holder.number); if (alive.length) text = '!مرر ' + pick(alive).number; } }
      else if (party && party.phase === 'input') {
        if (mode === 'rps') text = pick(['حجرة', 'ورقة', 'مقص']);
        else if (mode === 'drawguess') text = this.random(100) < 20 && this.party.word ? this.party.word : pick(['بيت', 'قمر', 'شجرة', 'سمكة', 'نجمة']);
        else if (mode === 'chairs') text = 'اجلس';
        else if (mode === 'chain') { if (this.random(100) < 30) text = this.random(100) < 80 ? (this.party.botWord?.() || 'لا أعرف') : pick(['بيت', 'قمر', 'سيارة']); }
        else if (mode === 'categories') { if (this.party.chosen === bot.id) text = this.random(100) < 75 ? (botWord(this.party.category, this.party.letter) || 'لا أعرف') : 'لا أعرف'; }
        else if (mode === 'roles') { if (party.phase === 'day') { const others = party.players.filter(x => x.alive && x.number !== bot.number); if (others.length) text = 'صوت ' + pick(others).number; } }
        else if (mode === 'country' || mode === 'flag') text = this.random(100) < 18 && this.party.country ? this.party.country.name : pick(['مصر', 'فرنسا', 'اليابان', 'البرازيل', 'كندا']);
        else if (mode === 'minority') text = String(this.random(2) + 1);
        else if (mode === 'higherlower') text = pick(['أعلى', 'أقل']);
        else if (mode === 'truefalse') text = pick(['صح', 'خطأ']);
        else if (mode === 'bowling') text = String(this.random(10) + 1);
        else if (mode === 'tug') text = this.random(100) < 85 ? 'شد' : null;
        else if (mode === 'redlight') text = party.light === 'green' || this.random(100) < 6 ? String(this.random(5) + 1) : null;
      } else if (party && mode === 'chairs' && party.phase === 'music' && this.random(100) < 3) text = 'اجلس';
      else if (party && mode === 'outsider' && party.phase === 'vote') { const others = party.players.filter(x => x.number !== bot.number); if (others.length) text = 'صوت ' + pick(others).number; }
      else if (party && mode === 'outsider' && party.phase === 'talk' && this.random(100) < 10) text = pick(['شي نحبه', 'مشهور مرة', 'كلنا نعرفه', 'أحس إني عرفته']);
      else if (party && mode === 'roles' && party.phase === 'day') { const others = party.players.filter(x => x.alive && x.number !== bot.number); if (others.length) text = 'صوت ' + pick(others).number; }
      if (text) this.applyMessage(bot, text, t);
      if (!this.status.active) break;
    }
  }
  setBranding({ mascot } = {}) {
    const visor = mascot?.visor, crown = mascot?.crown;
    if (!MASCOT_PRESETS.visor.includes(visor) || !MASCOT_PRESETS.crown.includes(crown)) throw new Error('اختر لونًا من الألوان المتاحة');
    this.branding = { mascot: { visor, crown } };
    this.emit();
    return this.branding;
  }
  drawWheel() {
    if (this.status.mode !== 'wheel' || !this.status.active) throw new Error('ابدأ جولة العجلة أولًا');
    const entries = [...this.wheelEntries.values()];
    if (!entries.length) throw new Error('لا يوجد مشتركون مسجلون في السحب');
    const pick = entries[this.random(entries.length)];
    const winner = this.players.get(pick.id);
    this.finishWinner(winner, 5);
    this.emit();
    return { name: winner.name };
  }
}

