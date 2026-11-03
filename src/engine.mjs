import { randomInt } from 'node:crypto';

export const MODES = ['quiz', 'guess', 'race', 'wheel'];
const MAX_MESSAGE = 160;
const MAX_PLAYERS = 1500;
const MAX_ENTRIES = 500;
const KEEP_CHAT = 35;
const QUIZ_POINTS = [10, 7, 5, 3, 2, 1];

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
    this.firstAnswers = new Map();
    this.correctAnswers = [];
    this.answerSequence = 0;
    this.status = { mode: 'quiz', active: false, title: 'تحدي المعلومات', prompt: 'ما هي عاصمة المملكة العربية السعودية؟', options: ['الرياض', 'جدة', 'الدمام', 'مكة'], answer: '1', winner: null, notice: 'جاهز للفعالية!', target: 12, duration: 30, startedAt: null, endsAt: null, submissionCount: 0, results: null, lastEvent: null };
    this.connection = { state: 'disconnected', username: '', detail: 'لم يتم الربط' };
  }
  setConnection(state, username = '', detail = '') {
    this.connection = { state, username: safeLine(username, 50), detail: safeLine(detail, 180) };
    this.emit();
  }
  emit() { this.notify(this.snapshot()); }
  snapshot() {
    const players = [...this.players.values()].sort((a, b) => b.score - a.score || (a.correctRounds && b.correctRounds ? a.totalResponseMs / a.correctRounds - b.totalResponseMs / b.correctRounds : 0) || a.firstSeen - b.firstSeen).slice(0, 20).map(({ id, name, score, correctRounds = 0, totalResponseMs = 0 }) => ({ id, name, score, correctRounds, avgMs: correctRounds ? Math.round(totalResponseMs / correctRounds) : null }));
    const race = [...this.raceProgress.entries()].map(([id, progress]) => ({ id, name: this.players.get(id)?.name || id, progress }))
      .sort((a,b) => b.progress - a.progress).slice(0, 15);
    return {
      status: { ...this.status, answer: undefined },
      connection: this.connection,
      leaderboard: players,
      race,
      entries: [...this.wheelEntries.values()].map(({ name }) => name).slice(0, 60),
      entriesCount: this.wheelEntries.size,
      recent: this.recent,
      round: this.round,
      playerCount: this.players.size,
      serverTime: this.now()
    };
  }
  player(userId, name) {
    const id = safeLine(userId, 80) || safeUserName(name);
    if (!this.players.has(id)) {
      if (this.players.size >= MAX_PLAYERS) return null;
      this.players.set(id, { id, name: safeUserName(name), score: 0, firstSeen: this.now(), correctRounds: 0, totalResponseMs: 0 });
    }
    const player = this.players.get(id);
    player.name = safeUserName(name);
    return player;
  }
  announce(text, winner = null) {
    this.status.notice = safeLine(text, 180);
    this.status.winner = winner;
    this.status.lastEvent = { text: this.status.notice, at: this.now(), winner };
  }
  configure({ mode, title, prompt, options, answer, target, duration } = {}) {
    if (this.status.active) throw new Error('أنه الجولة الحالية قبل تغيير إعداداتها');
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
    this.emit();
  }
  start() {
    if (this.status.active) throw new Error('يوجد سؤال جارٍ بالفعل');
    if (this.status.mode === 'quiz' && (!this.status.options.some(Boolean) || !['1','2','3','4'].includes(this.status.answer))) throw new Error('حدد الإجابة الصحيحة من 1 إلى 4');
    if (this.status.mode === 'guess' && !normalizeAnswer(this.status.answer)) throw new Error('اكتب الإجابة الصحيحة');
    this.round++;
    this.status.active = true;
    this.firstAnswers.clear(); this.correctAnswers = []; this.answerSequence = 0;
    this.status.submissionCount = 0;
    this.status.results = null;
    this.status.startedAt = this.now();
    this.status.endsAt = ['quiz','guess'].includes(this.status.mode) ? this.status.startedAt + this.status.duration * 1000 : null;
    this.status.winner = null;
    this.status.lastEvent = null;
    this.status.notice = 'بدأت الجولة! شارك الآن';
    this.raceProgress.clear(); this.raceLastMove.clear(); this.wheelEntries.clear();
    this.lastChatAt.clear();
    this.emit();
  }
  stop() {
    if (this.status.active && ['quiz', 'guess'].includes(this.status.mode)) return this.finishTimedRound('manual');
    this.status.active = false; this.status.notice = 'الجولة متوقفة'; this.emit();
  }
  tick() {
    if (this.status.active && this.status.endsAt !== null && this.now() >= this.status.endsAt) {
      this.finishTimedRound('timer'); return true;
    }
    return false;
  }
  finishTimedRound(reason = 'timer') {
    if (!this.status.active || !['quiz','guess'].includes(this.status.mode)) return false;
    const ranking = [...this.correctAnswers].sort((a, b) => a.at - b.at || a.order - b.order)
      .map((entry, index) => {
        const player = this.players.get(entry.id);
        const points = QUIZ_POINTS[Math.min(index, QUIZ_POINTS.length - 1)];
        if (player) { this.addScore(player, points); player.correctRounds++; player.totalResponseMs += entry.elapsedMs; }
        return { rank: index + 1, id: entry.id, name: player?.name ?? entry.name, elapsedMs: entry.elapsedMs, points, totalScore: player?.score ?? points };
      });
    const winner = ranking[0] || null;
    const answerText = this.status.mode === 'quiz' ? this.status.options[Number(this.status.answer)-1] : this.status.answer;
    this.status.active = false;
    this.status.endsAt = null;
    this.status.winner = winner ? { id: winner.id, name: winner.name, score: winner.points } : null;
    this.status.results = { round: this.round, completedAt: this.now(), reason, totalAnswers: this.firstAnswers.size,
      correctCount: ranking.length, correctAnswer: answerText, rankings: ranking.slice(0, 20) };
    this.status.notice = winner ? `🏆 الأول في السرعة: ${winner.name}` : 'انتهت الجولة، لا توجد إجابات صحيحة';
    this.status.lastEvent = { text: this.status.notice, at: this.now(), winner: this.status.winner };
    this.emit();
    return true;
  }
  recordAnswer(player, isCorrect, timestamp) {
    if (this.firstAnswers.has(player.id)) return; // لا تغيير للإجابة الأولى حتى لو كانت خاطئة
    this.firstAnswers.set(player.id, { correct: isCorrect, at: timestamp });
    this.status.submissionCount = this.firstAnswers.size;
    if (isCorrect) this.correctAnswers.push({ id: player.id, name: player.name, at: timestamp,
      elapsedMs: Math.max(0, timestamp - this.status.startedAt), order: this.answerSequence++ });
  }

  resetScores() { this.players.clear(); this.raceProgress.clear(); this.raceLastMove.clear(); this.wheelEntries.clear(); this.recent = []; this.emit(); }
  addScore(player, points) { player.score += points; }
  receiveChat({ id, username, text, avatar = '' }) {
    const message = safeLine(text);
    if (!message) return;
    const player = this.player(id, username);
    if (!player) return;
    const currentTime = this.now();
    if (this.status.active && this.status.endsAt !== null && currentTime >= this.status.endsAt) this.finishTimedRound('timer');
    // Ignore exact duplicate bursts within 300ms, but allow normal rapid chat events.
    const dedupKey = `${player.id}\u0000${message}`;
    if (currentTime - (this.lastChatAt.get(dedupKey) ?? -Infinity) < 300) return;
    this.lastChatAt.set(dedupKey, currentTime);
    if (this.lastChatAt.size > 1000) this.lastChatAt.clear();
    this.recent.unshift({ name: player.name, message, at: currentTime });
    if (this.recent.length > KEEP_CHAT) this.recent.length = KEEP_CHAT;
    if (this.status.active) this.applyMessage(player, message, currentTime);
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
      this.recordAnswer(player, option === this.status.answer, timestamp);
    } else if (this.status.mode === 'guess') {
      if (!input || message.trim().startsWith('!')) return;
      this.recordAnswer(player, input === normalizeAnswer(this.status.answer), timestamp);
    } else if (this.status.mode === 'wheel') {
      if (['انضم', 'انضمام', 'join', 'دخل', 'شارك'].includes(input) || ['!join', '!انضم', '+'].includes(message.trim().toLowerCase())) {
        if (this.wheelEntries.size < MAX_ENTRIES) this.wheelEntries.set(player.id, { name: player.name, id: player.id });
      }
    } else if (this.status.mode === 'race') {
      if (['!join', '!انضم', 'انضم', 'join'].includes(message.trim().toLowerCase())) this.raceProgress.set(player.id, this.raceProgress.get(player.id) ?? 0);
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
    this.announce(`🏆 الفائز: ${player.name} (+${score} نقاط)`, { name: player.name, id: player.id, score });
  }
  drawWheel() {
    if (this.status.mode !== 'wheel' || !this.status.active) throw new Error('ابدأ جولة العجلة أولًا');
    const entries = [...this.wheelEntries.values()];
    if (!entries.length) throw new Error('لا يوجد مشتركون بعد؛ اكتبوا !join');
    const pick = entries[this.random(entries.length)];
    const winner = this.players.get(pick.id);
    this.finishWinner(winner, 5);
    this.emit();
    return { name: winner.name };
  }
}
