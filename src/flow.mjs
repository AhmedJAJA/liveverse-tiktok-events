// SPONGE LIVE — the launch flow of a game session, kept on the server (the studio only draws it).
//
//   GAME_LIBRARY → GAME_SETUP → REGISTRATION_SETUP → WAITING_FOR_PLAYERS → GAME_RUNNING → GAME_FINISHED
//
// «تشغيل اللعبة» opens the setup, «ابدأ اللعبة» only moves to the join-word screen, «فتح التسجيل» starts
// accepting viewers from the chat, and only «بدء الجولة الآن» starts the real round. A refresh or a new
// WebSocket reads the same state back, so players and settings are never lost.
import { randomUUID } from 'node:crypto';
import { validateSettings, defaultSettings, applySettings, LATE_JOIN_MODES } from './game-settings.mjs';

export const STAGES = Object.freeze(['GAME_LIBRARY', 'GAME_SETUP', 'REGISTRATION_SETUP', 'WAITING_FOR_PLAYERS', 'GAME_RUNNING', 'GAME_FINISHED']);
const fail = (m) => { throw Object.assign(new Error(m), { status: 409 }); };

export class GameFlow {
  constructor({ engine, games, now = () => Date.now() }) {
    this.engine = engine; this.games = games; this.now = now;
    this.stage = 'GAME_LIBRARY'; this.mode = null; this.sessionId = null; this.trial = false;
    this.settings = {};          // mode -> saved advanced settings (kept for the room's lifetime)
    this.join = { keyword: 'انضم', lateJoin: 'click' };
    this.updatedAt = now();
  }
  game(mode) { const g = this.games.find((x) => x.mode === mode); if (!g) fail('لعبة غير معروفة'); return g; }
  settingsFor(mode) { return this.settings[mode] || defaultSettings(mode); }
  set(stage) { this.stage = stage; this.updatedAt = this.now(); }
  /** The engine can end a round on its own (timer, last survivor): keep the stage in step with it. */
  sync() {
    const e = this.engine;
    if (this.stage === 'GAME_RUNNING' && !e.status.active && !e.quiz?.nextAt) this.set('GAME_FINISHED');
    else if (this.stage === 'GAME_FINISHED' && e.status.active) this.set('GAME_RUNNING');
    return this;
  }
  /** «تشغيل اللعبة» from the library, or «العودة للإعدادات»: the settings screen of one game. */
  setup(mode) {
    this.sync();
    if (this.stage === 'GAME_RUNNING') fail('الجولة جارية — أنهِها أو أوقفها قبل تعديل الإعدادات');
    const g = this.game(mode);
    // another game: a new session id (registered players stay, as before); the same game: everything is kept
    if (this.mode !== g.mode) {
      if (this.engine.registration.phase === 'open') this.engine.closeRegistration();
      this.sessionId = null; this.trial = false;
    } else if (this.engine.registration.phase === 'open') this.engine.closeRegistration();
    this.mode = g.mode;
    this.set('GAME_SETUP');
  }
  saveSettings(mode, values, join = {}) {
    if (this.stage === 'GAME_RUNNING') fail('لا يمكن تغيير الإعدادات أثناء الجولة');
    if (mode !== this.mode) fail('افتح إعدادات هذه اللعبة أولًا');
    if (values) this.settings[mode] = validateSettings(mode, values, this.settingsFor(mode));
    if (join.lateJoin !== undefined) {
      if (!['click', 'open'].includes(join.lateJoin)) fail('خيار الانضمام غير صالح');
      if (join.lateJoin === 'open' && !LATE_JOIN_MODES.includes(mode)) fail('هذه اللعبة لا تدعم دخول لاعبين أثناء الجولة');
      this.join.lateJoin = join.lateJoin;
    }
    if (join.keyword !== undefined) this.join.keyword = cleanWord(join.keyword);
    this.updatedAt = this.now();
  }
  resetSettings(mode) { if (mode !== this.mode) fail('افتح إعدادات هذه اللعبة أولًا'); delete this.settings[mode]; this.updatedAt = this.now(); }
  /** «ابدأ اللعبة»: only the join-word screen. Nothing is opened and no timer starts here. */
  begin() {
    if (this.stage !== 'GAME_SETUP') fail('اختر اللعبة واضبط إعداداتها أولًا');
    if (!this.sessionId) this.sessionId = randomUUID();
    this.trial = false;
    this.set('REGISTRATION_SETUP');
  }
  /** «حفظ الكلمة وفتح التسجيل»: viewers who write the word from now on join. Also used to change the word or reopen. */
  open(keyword) {
    if (!['REGISTRATION_SETUP', 'WAITING_FOR_PLAYERS', 'GAME_FINISHED'].includes(this.sync().stage)) fail('اضغط «ابدأ اللعبة» من الإعدادات أولًا');
    const word = cleanWord(keyword ?? this.join.keyword);
    const e = this.engine, g = this.game(this.mode);
    if (e.status.mode !== g.mode) e.configure({ mode: g.mode, title: g.title });
    e.setLateJoin(this.join.lateJoin === 'open' && LATE_JOIN_MODES.includes(g.mode) ? 'open' : 'click');
    if (e.registration.phase === 'open') e.updateRegistration({ keyword: word });
    else e.openRegistration({ keyword: word });
    this.join.keyword = word;
    if (!this.sessionId) this.sessionId = randomUUID();
    this.set('WAITING_FOR_PLAYERS');
  }
  close() {
    if (this.sync().stage !== 'WAITING_FOR_PLAYERS') fail('التسجيل غير مفتوح');
    this.engine.closeRegistration();
  }
  /** «بدء الجولة الآن»: the only command that starts the real round. */
  start(prepareQuestion) {
    if (this.sync().stage !== 'WAITING_FOR_PLAYERS') fail('افتح التسجيل واستقبل المتسابقين أولًا');
    const e = this.engine, mode = this.mode;
    const need = Math.max(1, e.snapshot().registration.minPlayers || 1);
    if (e.players.size < need) fail(`هذه اللعبة تحتاج ${need} ${need === 1 ? 'لاعبًا' : 'لاعبين'} على الأقل`);
    if (e.status.mode !== mode) e.configure({ mode, title: this.game(mode).title });
    applySettings(e, mode, this.settingsFor(mode));
    if (mode === 'quiz') prepareQuestion?.(this.settingsFor(mode));
    e.start();
    this.set('GAME_RUNNING');
  }
  /** «جولة جديدة»: back to the lobby with the same players and word. */
  again() {
    if (this.sync().stage !== 'GAME_FINISHED') fail('لا توجد جولة منتهية');
    this.open(this.join.keyword);
  }
  /** «إنهاء اللعبة»: stop safely and return to the library; the next game is a new session. */
  end() {
    const e = this.engine;
    if (e.status.active || e.quiz?.nextAt) e.stop();
    if (e.registration.phase === 'open') e.closeRegistration();
    e.setSimulation?.({ autoplay: false });
    this.mode = null; this.sessionId = null; this.trial = false;
    this.set('GAME_LIBRARY');
  }
  /** Back from the setup / join-word screens to the library (nothing was opened). */
  library() {
    if (!['GAME_SETUP', 'REGISTRATION_SETUP', 'GAME_LIBRARY'].includes(this.sync().stage)) fail('أنهِ اللعبة أولًا');
    this.set('GAME_LIBRARY');
  }
  /** «تجربة اللعبة»: a preview with demo players in the lobby; the host still starts it with «بدء الجولة الآن». */
  tryOut() {
    if (this.stage !== 'GAME_SETUP') fail('اختر اللعبة أولًا');
    this.sessionId = randomUUID(); this.set('REGISTRATION_SETUP');
    this.open(this.join.keyword);
    this.trial = true;
  }
  /** Older pages (event setup, join page) still use prepare/start: mirror them so the studio never disagrees. */
  legacy(action, mode) {
    if (action === 'prepare' && mode) { this.mode = mode; if (!this.sessionId) this.sessionId = randomUUID(); this.set('WAITING_FOR_PLAYERS'); }
    if (action === 'start' && this.engine.status.active) { if (!this.mode) this.mode = this.engine.status.mode; this.set('GAME_RUNNING'); }
  }
  snapshot() {
    this.sync();
    return { stage: this.stage, mode: this.mode, sessionId: this.sessionId, trial: this.trial, settings: this.mode ? this.settingsFor(this.mode) : null,
      join: { ...this.join, lateJoinSupported: !!this.mode && LATE_JOIN_MODES.includes(this.mode) }, updatedAt: this.updatedAt };
  }
}
function cleanWord(raw) {
  const w = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!w || w.length > 32 || /\s{2,}/.test(w)) fail('اكتب كلمة انضمام من 1 إلى 32 حرفًا');
  return w;
}
