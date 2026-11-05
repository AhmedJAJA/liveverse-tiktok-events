// SPONGE LIVE — the launch flow of a game session, kept on the server (the studio only draws it).
//
// Two layers:
//  • navigation (the host's screens): GAME_LIBRARY → GAME_SETUP — nothing runs on the server here;
//  • the lobby (authoritative session state, below) once «ابدأ اللعبة» is pressed:
//
//    PREPARING_LOBBY ─success→ LOBBY_READY ─openRegistration→ REGISTRATION_OPEN ⇄ REGISTRATION_CLOSED
//          │failure                                                │startRound
//          ↓                                                       ↓
//      LOBBY_ERROR ─retry→ PREPARING_LOBBY                  ROUND_STARTING ─success→ ROUND_RUNNING ─finishRound→ ROUND_FINISHED
//                                                                                                     nextRound → REGISTRATION_CLOSED
//    RECOVERING (after a server restart) ─restored→ the state that was saved (registration open or closed)
//    any lobby state ─endSession→ SESSION_ENDED
//
// «ابدأ اللعبة» only prepares the lobby (real steps, reported one by one); only «بدء الجولة الآن» starts a round.
// Every transition is checked against TRANSITIONS: a step out of order is refused with a clear message (409).
// `stage` is kept for older screens: GAME_LIBRARY, GAME_SETUP, PREPARING_LOBBY, WAITING_FOR_PLAYERS, GAME_RUNNING, GAME_FINISHED.
import { randomUUID } from 'node:crypto';
import { validateSettings, defaultSettings, applySettings, LATE_JOIN_MODES } from './game-settings.mjs';
import { cleanJoinWord } from './engine.mjs';
import { describeError } from './lobby.mjs';

export const STAGES = Object.freeze(['GAME_LIBRARY', 'GAME_SETUP', 'PREPARING_LOBBY', 'WAITING_FOR_PLAYERS', 'GAME_RUNNING', 'GAME_FINISHED']);
export const LOBBY_STATES = Object.freeze(['PREPARING_LOBBY', 'LOBBY_READY', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'ROUND_STARTING', 'ROUND_RUNNING',
  'ROUND_FINISHED', 'RECOVERING', 'LOBBY_ERROR', 'SESSION_ENDED']);
/** The transition table (from the launch specification, adapted where noted). */
export const TRANSITIONS = Object.freeze({
  PREPARING_LOBBY: { success: 'LOBBY_READY', failure: 'LOBBY_ERROR', cancel: 'SESSION_ENDED' },
  // adapted: a lobby can start with players the host added by hand, without opening the chat registration
  LOBBY_READY: { openRegistration: 'REGISTRATION_OPEN', startRound: 'ROUND_STARTING', close: 'SESSION_ENDED', endSession: 'SESSION_ENDED' },
  REGISTRATION_OPEN: { closeRegistration: 'REGISTRATION_CLOSED', startRound: 'ROUND_STARTING', recover: 'RECOVERING', endSession: 'SESSION_ENDED' },
  REGISTRATION_CLOSED: { openRegistration: 'REGISTRATION_OPEN', startRound: 'ROUND_STARTING', recover: 'RECOVERING', endSession: 'SESSION_ENDED' },
  // adapted: a refused start leaves the lobby as it was (back to the state it came from) instead of an error screen
  ROUND_STARTING: { success: 'ROUND_RUNNING', failure: 'LOBBY_ERROR', revert: '*' },
  ROUND_RUNNING: { finishRound: 'ROUND_FINISHED', recover: 'RECOVERING', endSession: 'SESSION_ENDED' },
  ROUND_FINISHED: { nextRound: 'REGISTRATION_CLOSED', endSession: 'SESSION_ENDED' },
  // adapted: recovery restores what was saved — registration open or closed — never "open" by assumption
  RECOVERING: { restored: '*', failed: 'LOBBY_ERROR', endSession: 'SESSION_ENDED' },
  LOBBY_ERROR: { retry: 'PREPARING_LOBBY', endSession: 'SESSION_ENDED' },
  SESSION_ENDED: {},
});
const STAGE_OF = { PREPARING_LOBBY: 'PREPARING_LOBBY', LOBBY_ERROR: 'PREPARING_LOBBY', RECOVERING: 'PREPARING_LOBBY', LOBBY_READY: 'WAITING_FOR_PLAYERS',
  REGISTRATION_OPEN: 'WAITING_FOR_PLAYERS', REGISTRATION_CLOSED: 'WAITING_FOR_PLAYERS', ROUND_STARTING: 'WAITING_FOR_PLAYERS', ROUND_RUNNING: 'GAME_RUNNING', ROUND_FINISHED: 'GAME_FINISHED' };
const IN_LOBBY = ['LOBBY_READY', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'];
const fail = (m, status = 409, extra = {}) => { throw Object.assign(new Error(m), { status, ...extra }); };
const LABEL = { PREPARING_LOBBY: 'تجهيز اللوبي', LOBBY_READY: 'اللوبي جاهز', REGISTRATION_OPEN: 'التسجيل مفتوح', REGISTRATION_CLOSED: 'التسجيل مغلق', ROUND_STARTING: 'بدء الجولة',
  ROUND_RUNNING: 'الجولة جارية', ROUND_FINISHED: 'انتهت الجولة', RECOVERING: 'استعادة الجلسة', LOBBY_ERROR: 'خطأ في اللوبي', SESSION_ENDED: 'انتهت الجلسة' };

export class GameFlow {
  constructor({ engine, games, now = () => Date.now(), onChange = () => {} }) {
    this.engine = engine; this.games = games; this.now = now; this.onChange = onChange;
    this.nav = 'GAME_LIBRARY'; this.mode = null; this.sessionId = null; this.trial = false;
    this.settings = {};          // mode -> saved advanced settings (kept for the room's lifetime)
    this.join = { keyword: 'انضم', lateJoin: 'click', autoOpen: true };
    this.version = 1;            // configuration version: a stale keyword change from another window is refused
    this.lobby = null;           // the authoritative lobby (null before the first «ابدأ اللعبة»)
    this.updatedAt = now();
  }
  get stage() { const s = this.lobby?.state; return s && s !== 'SESSION_ENDED' ? STAGE_OF[s] : this.nav; }
  get state() { const s = this.lobby?.state; return s && s !== 'SESSION_ENDED' ? s : this.nav; }
  game(mode) { const g = this.games.find((x) => x.mode === mode); if (!g) fail('لعبة غير معروفة'); return g; }
  settingsFor(mode) { return this.settings[mode] || defaultSettings(mode); }
  touch() { this.updatedAt = this.now(); this.onChange(this); }
  /** Move the lobby along one edge of TRANSITIONS; anything else is refused. */
  go(event, target) {
    const from = this.lobby?.state;
    const to = from && TRANSITIONS[from]?.[event];
    if (!to) fail(from ? 'لا يمكن ذلك الآن — ' + (LABEL[from] || from) : 'اضغط «ابدأ اللعبة» من الإعدادات أولًا');
    this.lobby.state = to === '*' ? target : to;
    this.lobby.history.push({ from, to: this.lobby.state, event, at: this.now() });
    if (this.lobby.history.length > 40) this.lobby.history.shift();
    this.touch();
    return this.lobby.state;
  }
  /** The engine can end a round on its own (timer, last survivor): keep the lobby in step with it. */
  sync() {
    const e = this.engine, s = this.lobby?.state;
    if (s === 'ROUND_RUNNING' && !e.status.active && !e.quiz?.nextAt) this.go('finishRound');
    else if (s === 'ROUND_FINISHED' && e.status.active) { this.lobby.state = 'ROUND_RUNNING'; this.touch(); }
    // older pages may open / close the engine registration directly: mirror it (an explicit host command either way)
    else if ((s === 'REGISTRATION_CLOSED' || s === 'LOBBY_READY') && e.registration.phase === 'open' && !e.status.active) this.go('openRegistration');
    else if (s === 'REGISTRATION_OPEN' && e.registration.phase !== 'open' && !e.status.active) this.go('closeRegistration');
    return this;
  }
  /** Leave the lobby (settings, library, «إنهاء الجلسة»): the session id stays for the same game, players are kept. */
  endLobby() {
    if (!this.lobby || this.lobby.state === 'SESSION_ENDED') return;
    const s = this.lobby.state;
    if (s === 'ROUND_RUNNING' || s === 'ROUND_STARTING') fail('الجولة جارية — أنهِها أو أوقفها أولًا');
    this.go(s === 'PREPARING_LOBBY' ? 'cancel' : TRANSITIONS[s].endSession ? 'endSession' : 'close');
  }

  /** «تشغيل اللعبة» from the library, or «العودة للإعدادات»: the settings screen of one game. */
  setup(mode) {
    this.sync();
    if (this.lobby?.state === 'ROUND_RUNNING' || this.lobby?.state === 'ROUND_STARTING') fail('الجولة جارية — أنهِها أو أوقفها قبل تعديل الإعدادات');
    const g = this.game(mode);
    const e = this.engine;
    if (e.registration.phase === 'open') e.closeRegistration();
    // another game: a new session id (registered players stay, as before); the same game: everything is kept
    if (this.mode !== g.mode) { this.sessionId = null; this.trial = false; }
    this.endLobby();
    this.mode = g.mode; this.nav = 'GAME_SETUP';
    this.touch();
  }
  saveSettings(mode, values, join = {}) {
    if (['ROUND_RUNNING', 'ROUND_STARTING'].includes(this.lobby?.state)) fail('لا يمكن تغيير الإعدادات أثناء الجولة');
    if (mode !== this.mode) fail('افتح إعدادات هذه اللعبة أولًا');
    if (values) this.settings[mode] = validateSettings(mode, values, this.settingsFor(mode));
    if (join.lateJoin !== undefined) {
      if (!['click', 'open'].includes(join.lateJoin)) fail('خيار الانضمام غير صالح');
      if (join.lateJoin === 'open' && !LATE_JOIN_MODES.includes(mode)) fail('هذه اللعبة لا تدعم دخول لاعبين أثناء الجولة');
      this.join.lateJoin = join.lateJoin;
    }
    if (join.autoOpen !== undefined) this.join.autoOpen = join.autoOpen === true;
    if (join.keyword !== undefined) this.setKeyword(join.keyword);
    this.version++; this.touch();
  }
  resetSettings(mode) { if (mode !== this.mode) fail('افتح إعدادات هذه اللعبة أولًا'); delete this.settings[mode]; this.version++; this.touch(); }

  /* ------------------------------------------------------------- the lobby */
  /** «ابدأ اللعبة» (or «تجربة اللعبة» with demo:true): a new lobby in PREPARING_LOBBY. The server then runs the
      real preparation steps (src/lobby.mjs) and calls ready() or failLobby(). A repeated press while it is
      being prepared returns the same lobby — never a second one. */
  begin({ demo = false } = {}) {
    const s = this.lobby?.state;
    if (s === 'PREPARING_LOBBY' || s === 'RECOVERING') return { lobby: this.lobby, reused: true };
    if (s === 'LOBBY_ERROR') { this.lobby.demo = demo; this.lobby.error = null; this.lobby.steps = []; this.go('retry'); return { lobby: this.lobby, retried: true }; }
    if (s && s !== 'SESSION_ENDED') fail('اللوبي مفتوح بالفعل');
    if (this.nav !== 'GAME_SETUP' || !this.mode) fail('اختر اللعبة واضبط إعداداتها أولًا');
    const sessionReused = !!this.sessionId;
    if (!this.sessionId) this.sessionId = randomUUID();
    this.trial = demo;
    this.engine.lobbyManaged = true;
    this.lobby = { id: randomUUID(), state: 'PREPARING_LOBBY', demo, sessionReused, steps: [], error: null, round: null, rounds: 0, note: '', restoreTo: null,
      startedAt: this.now(), readyAt: null, history: [{ from: null, to: 'PREPARING_LOBBY', event: 'prepare', at: this.now() }] };
    this.touch();
    return { lobby: this.lobby, reused: false };
  }
  /** The list of steps this preparation will really perform (decided by the server for this room and mode). */
  plan(steps) { this.lobby.steps = steps.map(([key, label]) => ({ key, label, status: 'pending', detail: '' })); this.touch(); }
  step(key, status, detail = '') {
    const st = this.lobby?.steps.find((x) => x.key === key); if (!st) return;
    st.status = status; st.detail = String(detail || '').slice(0, 160); this.touch();
  }
  /** Is this still the lobby being prepared (not cancelled or replaced while a step was running)? */
  preparing(id) { return this.lobby?.id === id && ['PREPARING_LOBBY', 'RECOVERING'].includes(this.lobby.state); }
  /** All steps done: LOBBY_READY, then the registration opens if the saved settings say so (or as it was before a restart). */
  ready() {
    const e = this.engine, g = this.game(this.mode);
    const restoring = this.lobby.state === 'RECOVERING';
    if (e.status.mode !== g.mode) e.configure({ mode: g.mode, title: g.title });
    e.setLateJoin(this.join.lateJoin === 'open' && LATE_JOIN_MODES.includes(g.mode) ? 'open' : 'click');
    const target = this.lobby.restoreTo || (this.join.autoOpen ? 'REGISTRATION_OPEN' : null);
    this.lobby.readyAt = this.now(); this.lobby.error = null;
    if (restoring) {
      this.go('restored', target || 'REGISTRATION_CLOSED');
      if (this.lobby.state === 'REGISTRATION_OPEN') this.openEngine(); else this.closeEngine();
    } else {
      this.go('success');
      if (target === 'REGISTRATION_OPEN') this.open();
      else this.closeEngine(); // LOBBY_READY: nobody joins from the chat until «فتح التسجيل»
    }
    this.lobby.restoreTo = null;
    return this.lobby.state;
  }
  failLobby(error) {
    const s = this.lobby?.state;
    if (s !== 'PREPARING_LOBBY' && s !== 'RECOVERING') return;
    this.lobby.error = { code: error.code || 'prepare_failed', message: String(error.message || '').slice(0, 200), action: error.action || 'retry', step: error.step || null };
    this.go(s === 'RECOVERING' ? 'failed' : 'failure');
  }
  /** «إلغاء» / «العودة للإعدادات» from the preparation screen. */
  cancel() {
    const s = this.lobby?.state;
    if (!['PREPARING_LOBBY', 'LOBBY_ERROR', 'RECOVERING'].includes(s)) fail('لا يوجد تجهيز جارٍ');
    this.go(s === 'PREPARING_LOBBY' ? 'cancel' : 'endSession');
    this.nav = 'GAME_SETUP'; this.touch();
  }
  openEngine() {
    const e = this.engine;
    if (e.registration.phase === 'open') { if (e.registration.keyword !== this.join.keyword) e.updateRegistration({ keyword: this.join.keyword }); }
    else e.openRegistration({ keyword: this.join.keyword });
  }
  closeEngine() {
    const e = this.engine;
    if (e.registration.phase === 'open') e.closeRegistration();
    else if (e.registration.phase === 'idle') { e.registration.phase = 'closed'; e.registration.closedAt = this.now(); }
  }
  /** «فتح التسجيل» (an optional new word is saved first). Also used by older pages to change the word while open. */
  open(keyword) {
    this.sync();
    if (keyword !== undefined && keyword !== null && keyword !== this.join.keyword) this.setKeyword(keyword);
    const s = this.lobby?.state;
    if (s === 'REGISTRATION_OPEN') { this.openEngine(); this.touch(); return; }
    if (s !== 'LOBBY_READY' && s !== 'REGISTRATION_CLOSED') fail(s ? 'لا يمكن فتح التسجيل الآن — ' + LABEL[s] : 'اضغط «ابدأ اللعبة» من الإعدادات أولًا');
    this.go('openRegistration');
    this.openEngine();
  }
  /** «إغلاق التسجيل»: nobody new joins; the players already in stay. */
  close() {
    if (this.sync().lobby?.state !== 'REGISTRATION_OPEN') fail('التسجيل غير مفتوح');
    this.go('closeRegistration');
    this.closeEngine();
  }
  /** The join word: one place for every screen (server, studio, OBS, matching). `version` guards against an
      older request from another window overwriting a newer word. */
  setKeyword(raw, version) {
    if (version !== undefined && version !== null && Number(version) !== this.version) fail('تغيّرت الإعدادات من نافذة أخرى — حدّث الصفحة ثم أعد المحاولة', 409, { stale: true, version: this.version });
    if (['ROUND_RUNNING', 'ROUND_STARTING'].includes(this.lobby?.state)) fail('غيّر الكلمة بعد انتهاء الجولة');
    const word = cleanJoinWord(raw);
    this.join.keyword = word;
    const e = this.engine;
    if (e.registration.phase === 'open') e.updateRegistration({ keyword: word }); else e.registration.keyword = word;
    this.version++; this.touch();
    return word;
  }
  /** «بدء الجولة الآن»: the only command that starts a real round.
      opts.requireStream: the server's verdict on the live chat (null = fine, or the reason it is not ready);
      opts.requestId: the same click sent twice returns the round already started instead of a second one. */
  start(prepareQuestion, { requestId = null, requireStream = null } = {}) {
    const s = this.sync().lobby?.state;
    if (s === 'ROUND_STARTING' || s === 'ROUND_RUNNING') {
      if (requestId && this.lobby.round?.requestId === requestId) return { duplicate: true, round: this.lobby.round };
      fail('الجولة بدأت بالفعل');
    }
    if (!IN_LOBBY.includes(s)) fail(s === 'ROUND_FINISHED' ? 'اضغط «جولة جديدة» أولًا' : 'افتح التسجيل واستقبل المتسابقين أولًا');
    const e = this.engine, mode = this.mode;
    const need = Math.max(1, e.snapshot().registration.minPlayers || 1);
    if (e.players.size < need) fail(`هذه اللعبة تحتاج ${need} ${need === 1 ? 'لاعبًا' : 'لاعبين'} على الأقل`);
    if (requireStream && !this.lobby.demo) fail(requireStream, 409, { code: 'stream' });
    this.go('startRound');
    try {
      if (e.status.mode !== mode) e.configure({ mode, title: this.game(mode).title });
      if (e.registration.phase === 'idle') this.closeEngine();
      applySettings(e, mode, this.settingsFor(mode));
      if (mode === 'quiz') prepareQuestion?.(this.settingsFor(mode));
      e.start();
    } catch (err) {
      // nothing started: the lobby stays exactly as it was and the host can try again
      if (!e.status.active) { this.go('revert', s); throw err; }
      this.lobby.error = { code: 'round_failed', message: String(err.message).slice(0, 200), action: 'retry' };
      this.go('failure'); throw err;
    }
    this.lobby.rounds++;
    this.lobby.round = { id: randomUUID(), requestId, number: this.lobby.rounds, startedAt: this.now(), participants: e.players.size };
    this.go('success');
    return { round: this.lobby.round };
  }
  /** «جولة جديدة»: back to the lobby with the same players and word; the registration stays closed until the host opens it. */
  again() {
    if (this.sync().lobby?.state !== 'ROUND_FINISHED') fail('لا توجد جولة منتهية');
    this.go('nextRound');
    this.closeEngine();
  }
  /** «إعادة تعيين»: clear the players of this lobby (results already saved are kept). A new registration
      generation makes comments written before the reset arrive as nothing. */
  resetRegistration({ confirm = false } = {}) {
    const s = this.sync().lobby?.state, e = this.engine;
    if (![...IN_LOBBY, 'ROUND_FINISHED'].includes(s)) fail('لا يمكن إعادة التعيين الآن');
    if (e.players.size && confirm !== true) fail('أكّد إعادة التعيين — سيُحذف ' + e.players.size + ' من اللاعبين من هذا اللوبي', 428, { needConfirm: true });
    const wasOpen = e.registration.phase === 'open';
    e.resetScores();
    if (s === 'ROUND_FINISHED') this.go('nextRound');
    if (wasOpen && this.lobby.state === 'REGISTRATION_OPEN') this.openEngine(); else if (this.lobby.state !== 'LOBBY_READY') this.closeEngine();
    this.touch();
    return { generation: e.registration.generation };
  }
  /** «إنهاء الجلسة» / «إنهاء اللعبة»: stop safely and return to the library; the next game is a new session. */
  end() {
    const e = this.engine;
    if (e.status.active || e.quiz?.nextAt) e.stop();
    if (e.registration.phase === 'open') e.closeRegistration();
    e.waiting?.clear?.();
    e.registration.phase = 'idle'; // an ended session takes no more comments (not even into the waiting list)
    e.setSimulation?.({ autoplay: false });
    e.lobbyManaged = false;
    if (this.lobby && this.lobby.state !== 'SESSION_ENDED') { this.lobby.state = 'SESSION_ENDED'; this.lobby.history.push({ to: 'SESSION_ENDED', event: 'endSession', at: this.now() }); }
    this.mode = null; this.sessionId = null; this.trial = false; this.nav = 'GAME_LIBRARY';
    this.touch();
  }
  /** Back from the setup / preparation screens to the library (nothing is running). */
  library() {
    const s = this.sync().lobby?.state;
    if (s && !['PREPARING_LOBBY', 'LOBBY_ERROR', 'SESSION_ENDED'].includes(s)) fail('أنهِ اللعبة أولًا');
    if (s && s !== 'SESSION_ENDED') this.cancel();
    this.nav = 'GAME_LIBRARY'; this.touch();
  }
  /** «تجربة اللعبة»: the same preparation in «وضع التجربة» (no stream needed, test players, nothing counted). */
  tryOut() { return this.begin({ demo: true }); }
  /** Older pages (event setup, join page) still use prepare/start: mirror them so the studio never disagrees. */
  legacy(action, mode) {
    if (action === 'prepare' && mode) {
      this.mode = mode; if (!this.sessionId) this.sessionId = randomUUID();
      if (!this.lobby || ['SESSION_ENDED', 'PREPARING_LOBBY', 'LOBBY_ERROR'].includes(this.lobby.state)) {
        this.lobby = { id: randomUUID(), state: 'REGISTRATION_OPEN', demo: false, legacy: true, steps: [], error: null, round: null, rounds: 0, note: '', restoreTo: null, startedAt: this.now(), readyAt: this.now(), history: [] };
      }
      this.touch();
    }
    if (action === 'start' && this.engine.status.active) {
      if (!this.mode) this.mode = this.engine.status.mode;
      if (!this.lobby || this.lobby.state === 'SESSION_ENDED') this.lobby = { id: randomUUID(), state: 'ROUND_RUNNING', demo: false, legacy: true, steps: [], error: null, round: null, rounds: 0, note: '', restoreTo: null, startedAt: this.now(), readyAt: this.now(), history: [] };
      else this.lobby.state = 'ROUND_RUNNING';
      this.touch();
    }
  }

  /* --------------------------------------------------------- restarts */
  /** What survives a server restart (saved by the room; no secrets, no demo players). */
  persisted() {
    if (!this.lobby || this.lobby.state === 'SESSION_ENDED' || this.lobby.demo || this.lobby.legacy || !this.mode) return null;
    const e = this.engine;
    return { v: 1, mode: this.mode, sessionId: this.sessionId, settings: this.settings[this.mode] || null, join: { ...this.join }, version: this.version,
      lobby: { id: this.lobby.id, state: this.lobby.state, rounds: this.lobby.rounds, restoreTo: this.lobby.restoreTo }, registration: { phase: e.registration.phase, maxPlayers: e.registration.maxPlayers, generation: e.registration.generation },
      platform: e.connection.platform, players: e.exportPlayers(), savedAt: this.now() };
  }
  /** A saved lobby comes back in RECOVERING; the server reconnects the chat and then calls ready() (restored) or failLobby(). */
  recover(saved) {
    if (!saved || saved.v !== 1 || !saved.mode || !this.games.some((g) => g.mode === saved.mode)) return false;
    const e = this.engine, g = this.game(saved.mode);
    this.mode = g.mode; this.sessionId = saved.sessionId || randomUUID(); this.nav = 'GAME_SETUP';
    if (saved.settings) try { this.settings[g.mode] = validateSettings(g.mode, saved.settings, defaultSettings(g.mode)); } catch {}
    try { this.join.keyword = cleanJoinWord(saved.join?.keyword ?? 'انضم'); } catch {}
    this.join.lateJoin = saved.join?.lateJoin === 'open' ? 'open' : 'click'; this.join.autoOpen = saved.join?.autoOpen !== false;
    this.version = Math.max(1, Number(saved.version) || 1) + 1;
    e.configure({ mode: g.mode, title: g.title });
    e.registration.keyword = this.join.keyword;
    if (Number.isInteger(saved.registration?.maxPlayers)) e.registration.maxPlayers = saved.registration.maxPlayers;
    if (Number.isInteger(saved.registration?.generation)) e.registration.generation = saved.registration.generation;
    e.restorePlayers(saved.players);
    e.lobbyManaged = true;
    const was = saved.lobby?.state;
    const round = was === 'ROUND_RUNNING' || was === 'ROUND_STARTING' || was === 'ROUND_FINISHED';
    this.lobby = { id: saved.lobby?.id || randomUUID(), state: 'RECOVERING', demo: false, steps: [], error: null, round: null, rounds: Number(saved.lobby?.rounds) || 0,
      restoreTo: was === 'REGISTRATION_OPEN' ? 'REGISTRATION_OPEN' : was === 'PREPARING_LOBBY' || was === 'LOBBY_ERROR' || was === 'RECOVERING' ? saved.lobby?.restoreTo || null : 'REGISTRATION_CLOSED',
      note: round ? 'أُعيد تشغيل الخادم أثناء الجولة — اللاعبون محفوظون، ابدأ جولة جديدة.' : 'أُعيد تشغيل الخادم — استُعيد اللوبي كما كان.',
      startedAt: this.now(), readyAt: null, history: [{ from: was || null, to: 'RECOVERING', event: 'recover', at: this.now() }] };
    this.touch();
    return true;
  }
  snapshot() {
    this.sync();
    const l = this.lobby;
    const done = l ? l.steps.filter((x) => x.status === 'done' || x.status === 'skipped').length : 0;
    return { stage: this.stage, state: this.state, mode: this.mode, sessionId: this.sessionId, trial: this.trial, version: this.version,
      settings: this.mode ? this.settingsFor(this.mode) : null,
      join: { ...this.join, lateJoinSupported: !!this.mode && LATE_JOIN_MODES.includes(this.mode) },
      lobby: l && l.state !== 'SESSION_ENDED' ? { id: l.id, state: l.state, label: LABEL[l.state], demo: l.demo, steps: l.steps.map((x) => ({ ...x })), progress: { done, total: l.steps.length },
        error: describeError(l.error), round: l.round ? { id: l.round.id, number: l.round.number, startedAt: l.round.startedAt, participants: l.round.participants } : null, rounds: l.rounds, note: l.note || '', readyAt: l.readyAt } : null,
      updatedAt: this.updatedAt };
  }
}
