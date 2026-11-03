import { randomInt } from 'node:crypto';
import { BombGame, parsePassCommand } from './bomb.mjs';

export const MODES = ['quiz', 'guess', 'race', 'wheel', 'glass', 'bomb'];
const MAX_MESSAGE = 160;
const MAX_PLAYERS = 1500;
const MAX_ENTRIES = 500;
const KEEP_CHAT = 35;
const QUIZ_POINTS = [10, 7, 5, 3, 2, 1];
const REGISTRATION_PREVIEW = 10;

const AVATAR_HOSTS = ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'tiktokcdn-in.com', 'byteoversea.com', 'ibytedtos.com', 'ibyteimg.com', 'muscdn.com'];
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
export function safeLine(raw, max = MAX_MESSAGE) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
export function safeUserName(raw) {
  return safeLine(raw, 32) || 'مشاهد';
}
export class Engine {
  constructor({ now = () => Date.now(), random = randomInt, notify = () => {} } = {}) {
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
    this.registration = { phase: 'idle', keyword: 'انضم', openedAt: null, closedAt: null, session: 0, maxPlayers: MAX_PLAYERS, audience: 'all' };
    this.glass = { steps: 10, stepDuration: 10, step: 0, safeSide: 0, survivors: new Set(), choices: new Map(), choiceTimes: new Map() };
    this.registrationRecent = [];
    this.firstAnswers = new Map();
    this.correctAnswers = [];
    this.answerSequence = 0;
    this.status = { mode: 'quiz', active: false, title: 'تحدي المعلومات', prompt: 'ما هي عاصمة المملكة العربية السعودية؟', options: ['الرياض', 'جدة', 'الدمام', 'مكة'], answer: '1', winner: null, notice: 'جاهز للفعالية!', target: 12, duration: 30, startedAt: null, endsAt: null, submissionCount: 0, results: null, lastEvent: null, glassStep: 0, glassSteps: 10, glassRemaining: 0 };
    this.connection = { state: 'disconnected', username: '', detail: 'لم يتم الربط' };
    this.bomb = new BombGame({ now: () => this.now(), random: n => this.random(n) });
    this.demoSerial = 0;
  }
  setConnection(state, username = '', detail = '') {
    const previousState = this.connection.state;
    this.connection = { state, username: safeLine(username, 50), detail: safeLine(detail, 180) };
    // First successful LIVE connection opens signups. Reconnects do not wipe a session.
    if (state === 'connected' && previousState !== 'connected' && this.registration.phase === 'idle' && this.round === 0 && !this.players.size) {
      this.openRegistration({ keyword: this.registration.keyword });
      return;
    }
    this.emit();
  }
  emit() { this.notify(this.snapshot()); }
  snapshot() {
    const players = [...this.players.values()].sort((a, b) => b.score - a.score || (a.correctRounds && b.correctRounds ? a.totalResponseMs / a.correctRounds - b.totalResponseMs / b.correctRounds : 0) || a.firstSeen - b.firstSeen).slice(0, 20).map(({ id, name, score, avatar, correctRounds = 0, totalResponseMs = 0 }) => ({ id, name, score, ...(avatar ? { avatar } : {}), correctRounds, avgMs: correctRounds ? Math.round(totalResponseMs / correctRounds) : null }));
    const race = [...this.raceProgress.entries()].map(([id, progress]) => ({ id, name: this.players.get(id)?.name || id, progress }))
      .sort((a,b) => b.progress - a.progress).slice(0, 15);
    return {
      status: { ...this.status, answer: undefined, choiceCounts: [1, 2, 3, 4].map(n => [...this.firstAnswers.values()].filter(a => a.choice === String(n)).length), choiceVoters: [1, 2, 3, 4].map(n => [...this.firstAnswers.entries()].filter(([, a]) => a.choice === String(n)).slice(0, 3).map(([id]) => this.publicPlayer(this.players.get(id)))) },
      connection: this.connection,
      leaderboard: players,
      race,
      entries: [...this.wheelEntries.values()].map(({ name }) => name).slice(0, 60),
      entriesCount: this.wheelEntries.size,
      bomb: this.bomb.snapshot(),
      glass: { step: this.glass.step, steps: this.glass.steps, remaining: this.glass.survivors.size, duration: this.glass.stepDuration, voted: this.glass.choices.size, choiceCounts: [1, 2].map(n => [...this.glass.choices.values()].filter(x => x === n).length) },
      recent: this.recent,
      round: this.round,
      playerCount: this.players.size,
      registration: { ...this.registration, count: this.players.size, recent: [...this.registrationRecent], participants: [...this.players.values()].slice(-100).map((p, i, tail) => ({ name: p.name, number: this.players.size - tail.length + i + 1, ...(p.avatar ? { avatar: p.avatar } : {}) })) },
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
  updateRegistration({ keyword = this.registration.keyword, maxPlayers = this.registration.maxPlayers, audience = this.registration.audience } = {}) {
    if (this.status.active) throw new Error('لا يمكن تعديل التسجيل أثناء الجولة');
    const rawKeyword = String(keyword ?? '').trim();
    const clean = safeLine(rawKeyword, 32).trim();
    if (!clean || !normalizeAnswer(clean) || rawKeyword.length > 32 || /[\r\n]/.test(rawKeyword))
      throw new Error('اكتب كلمة تسجيل صالحة من 1 إلى 32 حرفًا');
    if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > MAX_PLAYERS)
      throw new Error('عدد اللاعبين يجب أن يكون بين 1 و1500');
    if (!['all','followers','subscribers'].includes(audience))
      throw new Error('نوع الجمهور غير صالح');
    const eligibleCount = [...this.players.values()].filter(player => this.eligibleForAudience(player,audience)).length;
    if (eligibleCount > maxPlayers) throw new Error('الحد أقل من عدد المتسابقين المؤهلين المسجلين');
    const removed = this.pruneForAudience(audience);
    Object.assign(this.registration, { keyword:clean, maxPlayers, audience });
    this.status.notice = this.registration.phase === 'open'
      ? 'التسجيل مفتوح ' + (audience === 'followers' ? 'للمتابعين فقط' : audience === 'subscribers' ? 'للمشتركين فقط' : 'للجميع')
      : this.status.notice;
    this.emit();
    return { phase:this.registration.phase, audience, maxPlayers, removed, remaining:this.players.size };
  }
  openRegistration({ keyword = this.registration.keyword, reset = false, maxPlayers = this.registration.maxPlayers, audience = this.registration.audience } = {}) {
    if (this.status.active) throw new Error('أنهِ الجولة قبل فتح التسجيل');
    const rawKeyword = String(keyword ?? '').trim();
    const clean = safeLine(rawKeyword, 32).trim();
    if (!clean || !normalizeAnswer(clean) || rawKeyword.length > 32 || /[\r\n]/.test(rawKeyword)) throw new Error('اكتب كلمة تسجيل صالحة من 1 إلى 32 حرفًا');
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
    }
    if (!reset) this.pruneForAudience(audience);
    this.registration = { phase: 'open', keyword: clean, openedAt: this.now(), closedAt: null, session: this.registration.session + 1, maxPlayers, audience };
    this.status.results = null; this.status.winner = null; this.status.endsAt = null;
    this.status.notice = `التسجيل مفتوح! اكتب ${clean} في شات البث`;
    this.status.lastEvent = null;
    this.emit();
    return this.registration;
  }
  closeRegistration() {
    if (this.registration.phase !== 'open') throw new Error('التسجيل ليس مفتوحًا');
    this.registration.phase = 'closed';
    this.registration.closedAt = this.now();
    this.status.notice = `انتهى التسجيل • ${this.players.size} متسابقًا جاهزًا`;
    this.emit();
    return this.registration;
  }
  register(id, name, avatar = '', { isFollower = false, isSubscriber = false } = {}) {
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
    this.emit();
    return true;
  }
  hasValidJoinWord(text) {
    return normalizeAnswer(text) === normalizeAnswer(this.registration.keyword);
  }
  announce(text, winner = null) {
    this.status.notice = safeLine(text, 180);
    this.status.winner = winner;
    this.status.lastEvent = { text: this.status.notice, at: this.now(), winner };
  }
  configure({ mode, title, prompt, options, answer, target, duration, glassSteps, glassStepDuration, bombSeconds } = {}) {
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
    if (this.registration.phase === 'open') this.closeRegistration();
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
    this.status.winner = null;
    this.status.lastEvent = null;
    this.status.notice = this.status.mode === 'bomb' ? 'القنبلة مع اللاعب #' + this.bomb.snapshot().holder.number + ' — مرّرها قبل الانفجار!' : 'بدأت الجولة! شارك الآن';
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
    if (this.status.active && this.status.mode === 'bomb') { this.bomb.end('manual'); this.finishBomb(); return; }
    if (this.status.active && this.status.mode === 'glass') { this.endGlassGame('manual'); return; }
    if (this.status.active && ['quiz', 'guess'].includes(this.status.mode)) return this.finishTimedRound('manual');
    this.status.active = false; this.status.notice = 'الجولة متوقفة'; this.emit();
  }
  tick() {
    if (this.status.active && this.status.mode === 'bomb') {
      const changed = this.bomb.tick();
      if (this.bomb.phase === 'finished') { this.finishBomb(); return true; }
      if (changed) { this.bombNotice(); this.emit(); }
      return changed;
    }
    if (this.status.active && this.status.endsAt !== null && this.now() >= this.status.endsAt) {
      if (this.status.mode === 'glass') this.finishGlassStep(); else this.finishTimedRound('timer'); return true;
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
    this.status.winner = b.winner ? { name: b.winner.name, number: b.winner.number, score: 10, ...(b.winner.avatar ? { avatar: b.winner.avatar } : {}) } : null;
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
    if (this.registration.phase !== 'open') this.openRegistration({});
    const names = ['نورة','فهد','ريم','سلطان','لمى','ماجد','هيا','تركي','جود','بدر','دانة','يزيد','شهد','راكان','غادة','عبدالله'];
    let added = 0;
    for (let i = 0; i < n; i++) {
      const serial = ++this.demoSerial;
      if (this.register('demo:bot-' + serial, names[(serial - 1) % names.length] + ' ' + serial, '', { isFollower: true, isSubscriber: true })) added++;
    }
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
      return { rank:i+1, name:player?.name||'متسابق', ...(player?.avatar?{avatar:player.avatar}:{}), points, totalScore:player?.score||points };
    });
    const winner=rankings[0];
    this.status.active=false;
    this.status.endsAt=null;
    this.status.winner=winner?{ name:winner.name, score:winner.points, ...(winner.avatar?{avatar:winner.avatar}:{}) }:null;
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
        const points = QUIZ_POINTS[Math.min(index, QUIZ_POINTS.length - 1)];
        if (player) { this.addScore(player, points); player.correctRounds++; player.totalResponseMs += entry.elapsedMs; }
        return { rank: index + 1, id: entry.id, name: player?.name ?? entry.name, ...(player?.avatar ? { avatar: player.avatar } : {}), elapsedMs: entry.elapsedMs, points, totalScore: player?.score ?? points };
      });
    const winner = ranking[0] || null;
    const answerText = this.status.mode === 'quiz' ? this.status.options[Number(this.status.answer)-1] : this.status.answer;
    this.status.active = false;
    this.status.endsAt = null;
    this.status.winner = winner ? { id: winner.id, name: winner.name, score: winner.points, ...(winner.avatar ? { avatar: winner.avatar } : {}) } : null;
    this.status.results = { round: this.round, completedAt: this.now(), reason, totalAnswers: this.firstAnswers.size,
      correctCount: ranking.length, correctAnswer: answerText, rankings: ranking.slice(0, 20) };
    this.status.notice = winner ? `🏆 الأول في السرعة: ${winner.name}` : 'انتهت الجولة، لا توجد إجابات صحيحة';
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
    this.registration.phase = 'idle'; this.registration.openedAt = null; this.registration.closedAt = null;
    this.status.results = null; this.status.winner = null;
    this.status.notice = 'تم تصفير الجلسة. افتح التسجيل للبدء من جديد';
    this.emit();
  }
  addScore(player, points) { player.score += points; }
  receiveChat({ id, username, text, avatar = '', isFollower = false, isSubscriber = false }) {
    const message = safeLine(text);
    const identity = safeLine(id, 80);
    if (!message || !identity) return;
    const currentTime = this.now();
    if (this.status.active && this.status.endsAt !== null && currentTime >= this.status.endsAt) { if (this.status.mode === 'glass') this.finishGlassStep(); else this.finishTimedRound('timer'); }
    const dedupKey = `${identity}\u0000${message}`;
    if (currentTime - (this.lastChatAt.get(dedupKey) ?? -Infinity) < 300) return;
    this.lastChatAt.set(dedupKey, currentTime);
    if (this.lastChatAt.size > 1000) this.lastChatAt.clear();
    const name = safeUserName(username);
    this.recent.unshift({ name, message, at: currentTime });
    if (this.recent.length > KEEP_CHAT) this.recent.length = KEEP_CHAT;
    // Joining the TikTok room does NOT enroll the viewer. Only the chosen chat word does.
    if (this.registration.phase === 'open') {
      if (this.hasValidJoinWord(message)) this.register(identity, name, avatar, {isFollower,isSubscriber});
    } else if (this.registration.phase === 'closed' && this.status.active && this.players.has(identity)) {
      const player = this.player(identity, name, avatar);
      if (player) this.applyMessage(player, message, currentTime);
    }
    this.emit();
  }
  applyMessage(player, message, timestamp) {
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

