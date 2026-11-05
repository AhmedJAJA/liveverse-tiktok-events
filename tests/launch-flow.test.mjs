// The game launch flow: library → setup → join word → lobby → round → results, decided on the server.
// «ابدأ اللعبة» must never start a round; only «بدء الجولة الآن» does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.mjs';
import { GameFlow } from '../src/flow.mjs';
import { ALL_GAMES } from '../src/catalog.mjs';
import { GAME_SETTINGS, defaultSettings, validateSettings } from '../src/game-settings.mjs';

function rig() {
  let t = 1_000_000, n = 0;
  const e = new Engine({ now: () => t, random: () => 0 });
  e.questionSource = () => ({ title: 'تحدي المعلومات', prompt: 'سؤال ' + ++n, options: ['أ', 'ب', 'ج', 'د'], answer: '1' });
  const flow = new GameFlow({ engine: e, games: ALL_GAMES, now: () => t });
  const chat = (id, text) => e.receiveChat({ id, username: 'مشاهد ' + id, text });
  const prepareQuestion = () => { const q = e.questionSource(); e.configure({ mode: 'quiz', title: q.title, prompt: q.prompt, options: q.options, answer: q.answer }); };
  // «ابدأ اللعبة»: the server runs the real preparation steps; here they succeed at once
  const enter = (opts = {}) => { flow.begin(opts); flow.plan([['game', 'التحقق من بيانات اللعبة']]); flow.step('game', 'done'); return flow.ready(); };
  return { e, flow, chat, prepareQuestion, enter, add: (ms) => { t += ms; e.tick(); } };
}

test('every catalogue game has its own advanced settings (or none) and valid defaults', () => {
  for (const g of ALL_GAMES) {
    assert.ok(Array.isArray(GAME_SETTINGS[g.mode]), g.mode);
    const d = defaultSettings(g.mode);
    for (const field of GAME_SETTINGS[g.mode]) assert.ok(field.options.some(([v]) => v === d[field.key]), g.mode + '.' + field.key);
  }
  assert.throws(() => validateSettings('quiz', { questions: 999 }), /قيمة غير صالحة/);
  assert.throws(() => validateSettings('quiz', { nope: 1 }), /غير معروف/);
  assert.equal(validateSettings('quiz', { seconds: '45' }).seconds, 45);
});

test('the mandatory scenario: «ابدأ اللعبة» prepares the lobby; only «بدء الجولة الآن» starts the quiz', () => {
  const { e, flow, chat, prepareQuestion, add } = rig();
  assert.equal(flow.snapshot().stage, 'GAME_LIBRARY');
  flow.setup('quiz');
  assert.equal(flow.snapshot().stage, 'GAME_SETUP');
  assert.equal(e.registration.phase, 'idle'); assert.equal(e.status.active, false);
  flow.saveSettings('quiz', { questions: 1, seconds: 20, scoring: 'flat' }, { keyword: 'جاهز' });
  // «ابدأ اللعبة» → PREPARING_LOBBY: no round, no registration, no timer
  const { lobby } = flow.begin();
  assert.equal(flow.snapshot().state, 'PREPARING_LOBBY'); assert.equal(flow.snapshot().stage, 'PREPARING_LOBBY');
  assert.equal(e.status.active, false); assert.equal(e.registration.phase, 'idle'); assert.equal(e.status.endsAt, null);
  assert.equal(flow.begin().reused, true, 'a second press does not make a second lobby'); assert.equal(flow.lobby.id, lobby.id);
  chat('early', 'جاهز'); assert.equal(e.players.size, 0, 'nobody joins while the lobby is prepared');
  assert.throws(() => flow.start(prepareQuestion), /افتح التسجيل/, 'no round while preparing');
  assert.throws(() => flow.open(), /لا يمكن فتح التسجيل/);
  flow.plan([['game', 'التحقق من بيانات اللعبة'], ['sync', 'مزامنة']]);
  flow.step('game', 'done'); flow.step('sync', 'done');
  assert.deepEqual(flow.snapshot().lobby.progress, { done: 2, total: 2 });
  // all steps done → LOBBY_READY → registration opens (saved setting «فتح التسجيل تلقائيًا»)
  assert.equal(flow.ready(), 'REGISTRATION_OPEN');
  assert.deepEqual(flow.lobby.history.map((h) => h.to), ['PREPARING_LOBBY', 'LOBBY_READY', 'REGISTRATION_OPEN']);
  assert.equal(e.registration.phase, 'open'); assert.equal(e.registration.keyword, 'جاهز'); assert.equal(e.status.active, false);
  chat('v1', 'جاهز'); chat('v1', 'جاهز'); add(400); chat('v1', 'جاهز');
  assert.equal(e.players.size, 1, 'added once');
  chat('v2', 'انضم'); chat('v3', 'hello'); chat('v4', 'جاهزين');
  assert.equal(e.players.size, 1, 'other words and longer words are ignored');
  const r = flow.start(prepareQuestion, { requestId: 'click-1' });
  assert.equal(flow.snapshot().state, 'ROUND_RUNNING'); assert.equal(flow.snapshot().stage, 'GAME_RUNNING');
  assert.equal(flow.start(prepareQuestion, { requestId: 'click-1' }).duplicate, true, 'the same click twice → the same round');
  assert.equal(flow.snapshot().lobby.round.id, r.round.id);
  assert.throws(() => flow.start(prepareQuestion), /بدأت بالفعل/, 'no second round');
  assert.equal(e.status.endsAt - e.status.startedAt, 20_000, 'answer time from the settings');
  chat('v1', '1'); add(20_001);
  assert.equal(e.status.active, false);
  assert.equal(e.status.results.rankings[0].points, 5, 'flat scoring from the settings');
  assert.equal(flow.snapshot().state, 'ROUND_FINISHED'); assert.equal(flow.snapshot().stage, 'GAME_FINISHED');
  // «جولة جديدة» → the lobby with registration closed (never reopened silently)
  flow.again(); assert.equal(flow.snapshot().state, 'REGISTRATION_CLOSED'); assert.equal(e.registration.phase, 'closed');
  flow.end(); assert.equal(flow.snapshot().state, 'GAME_LIBRARY');
  chat('v9', 'جاهز'); assert.equal(e.players.has('v9'), false, 'an ended session takes no comments'); assert.equal(e.waiting.size, 0);
});

test('the order is enforced: no state can be skipped', () => {
  const { e, flow, prepareQuestion, enter } = rig();
  assert.throws(() => flow.begin(), /اختر اللعبة/);
  assert.throws(() => flow.open('انضم'), /ابدأ اللعبة/);
  assert.throws(() => flow.start(prepareQuestion), /افتح التسجيل/);
  flow.setup('quiz');
  assert.throws(() => flow.open('انضم'), /ابدأ اللعبة/, 'setup → lobby without «ابدأ اللعبة» is refused');
  assert.throws(() => flow.start(prepareQuestion), /افتح التسجيل/, 'setup → running is refused');
  assert.throws(() => flow.close(), /غير مفتوح/);
  enter();
  assert.throws(() => flow.start(prepareQuestion), /تحتاج 1/, 'needs players');
  assert.throws(() => flow.again(), /لا توجد جولة منتهية/);
  assert.equal(e.status.active, false);
  // the live chat must be ready unless this is «وضع التجربة»
  e.addManualPlayer({ name: 'سارة' });
  assert.throws(() => flow.start(prepareQuestion, { requireStream: 'البث غير متصل' }), /البث غير متصل/);
  assert.equal(flow.snapshot().state, 'REGISTRATION_OPEN', 'a refused start leaves the lobby intact');
});

test('preparation failure, retry, cancel, and a lobby that opens closed', () => {
  const { e, flow } = rig();
  flow.setup('flag');
  flow.saveSettings('flag', null, { autoOpen: false });
  flow.begin(); flow.plan([['account', 'التحقق من حساب البث']]); flow.step('account', 'failed');
  flow.failLobby({ code: 'not_linked', message: 'حساب البث غير مرتبط', action: 'link' });
  let snap = flow.snapshot();
  assert.equal(snap.state, 'LOBBY_ERROR'); assert.equal(snap.stage, 'PREPARING_LOBBY'); assert.equal(snap.lobby.error.code, 'not_linked');
  assert.equal(flow.begin().retried, true, '«إعادة المحاولة» → PREPARING_LOBBY again');
  assert.equal(flow.snapshot().state, 'PREPARING_LOBBY'); assert.equal(flow.snapshot().lobby.error, null);
  flow.cancel(); assert.equal(flow.snapshot().state, 'GAME_SETUP', 'cancel → back to the settings');
  flow.begin(); assert.equal(flow.ready(), 'LOBBY_READY', 'autoOpen off: ready, registration not opened');
  e.receiveChat({ id: 'x', username: 'x', text: 'انضم' }); assert.equal(e.players.size, 0);
  e.addManualPlayer({ name: 'ضيف' });
  assert.notEqual(e.registration.phase, 'open', 'adding a player by hand does not open the chat registration');
  flow.open(); assert.equal(flow.snapshot().state, 'REGISTRATION_OPEN');
  flow.close(); assert.equal(flow.snapshot().state, 'REGISTRATION_CLOSED');
  e.addDemoPlayers({ count: 2 }); assert.equal(e.registration.phase, 'closed', 'test players never reopen a closed registration');
});

test('the join word: one source of truth, versioned, whole-message matching', () => {
  const { e, flow, chat, enter } = rig();
  flow.setup('quiz'); enter();
  const v = flow.version;
  flow.setKeyword('العب', v);
  assert.equal(e.registration.keyword, 'العب'); assert.equal(flow.snapshot().join.keyword, 'العب');
  assert.throws(() => flow.setKeyword('دخول', v), /نافذة أخرى/, 'an older request cannot bring back an old word');
  assert.equal(e.registration.keyword, 'العب');
  for (const bad of ['', '   ', '!!!', '1', 'كلمة طويلة جدا جدا جدا جدا جدا جدا', 'a b c d']) assert.throws(() => flow.setKeyword(bad), /كلمة|رقم|ثلاث/, JSON.stringify(bad));
  flow.setKeyword('Play'); chat('l1', '  play!! '); chat('l2', 'PLAY'); chat('l3', 'playing'); chat('l4', 'let me play');
  assert.deepEqual([...e.players.keys()].sort(), ['l1', 'l2'], 'case and punctuation ignored, never a substring');
  flow.setKeyword('انضم'); chat('a1', 'انْضَمّ'); chat('a2', 'انـــضم'); chat('a3', 'انضمام'); chat('a4', 'إنضم');
  assert.deepEqual([...e.players.keys()].filter((k) => k.startsWith('a')).sort(), ['a1', 'a2', 'a4'], 'diacritics, tatweel and alef forms; not «انضمام»');
});

test('«إعادة تعيين» needs a confirmation with players, starts a new generation and ignores late comments', () => {
  const { e, flow, chat, enter, add } = rig();
  flow.setup('quiz'); enter();
  chat('p1', 'انضم'); chat('p2', 'انضم');
  assert.throws(() => flow.resetRegistration(), (err) => err.status === 428 && err.needConfirm);
  const gen = e.registration.generation; const before = 1_000_000 + 1;
  add(5000);
  flow.resetRegistration({ confirm: true });
  assert.equal(e.players.size, 0); assert.equal(e.registration.generation, gen + 1);
  assert.equal(flow.snapshot().state, 'REGISTRATION_OPEN'); assert.equal(e.registration.phase, 'open', 'still open after the reset');
  e.receiveChat({ id: 'old', username: 'old', text: 'انضم', at: before }); // written before the reset, delivered after it
  assert.equal(e.players.has('old'), false, 'stale comment rejected');
  e.receiveChat({ id: 'new', username: 'new', text: 'انضم', at: 1_000_000 + 6000 });
  assert.equal(e.players.has('new'), true);
});

test('a restart restores the saved lobby (players, word, registration state) through RECOVERING', () => {
  const a = rig();
  a.flow.setup('quiz'); a.flow.saveSettings('quiz', { questions: 5 }, { keyword: 'جاهز' }); a.enter();
  a.chat('v1', 'جاهز'); a.e.addManualPlayer({ name: 'ضيف' }); a.e.addDemoPlayers({ count: 2 });
  a.flow.close();
  const saved = JSON.parse(JSON.stringify(a.flow.persisted()));
  assert.equal(saved.players.length, 2, 'demo players are not saved');
  const b = rig();
  assert.equal(b.flow.recover(saved), true);
  assert.equal(b.flow.snapshot().state, 'RECOVERING');
  assert.equal(b.e.players.size, 2); assert.equal(b.e.registration.keyword, 'جاهز');
  b.chat('v2', 'جاهز'); assert.equal(b.e.players.size, 2, 'nothing joins while recovering');
  assert.equal(b.flow.ready(), 'REGISTRATION_CLOSED', 'restores the CLOSED registration it had — not open');
  assert.equal(b.e.registration.phase, 'closed'); assert.equal(b.flow.snapshot().settings.questions, 5);
  // a lobby saved with the registration open comes back open; a failed recovery → LOBBY_ERROR, players kept
  a.flow.open(); const c = rig(); c.flow.recover(JSON.parse(JSON.stringify(a.flow.persisted())));
  c.flow.failLobby({ code: 'not_live', message: 'البث المباشر غير نشط', action: 'retry' });
  assert.equal(c.flow.snapshot().state, 'LOBBY_ERROR'); assert.equal(c.e.players.size, 2);
  c.flow.begin(); assert.equal(c.flow.ready(), 'REGISTRATION_OPEN');
  // «وضع التجربة» lobbies are never saved
  const d = rig(); d.flow.setup('rps'); d.flow.tryOut(); assert.equal(d.flow.persisted(), null);
});

test('back to settings keeps players and word; host seat', () => {
  const { e, flow, chat, prepareQuestion, enter } = rig();
  flow.setup('flag'); flow.saveSettings('flag', null, { keyword: 'العب' }); enter();
  chat('a', 'العب'); chat('b', 'العب');
  flow.setup('flag');
  assert.equal(flow.snapshot().stage, 'GAME_SETUP'); assert.equal(e.players.size, 2); assert.equal(e.registration.phase, 'closed');
  chat('c', 'العب'); assert.equal(e.players.has('c'), false, 'closed while in settings');
  const sid = flow.sessionId;
  flow.saveSettings('flag', { rounds: 5 });
  enter();
  assert.equal(flow.sessionId, sid, 'same game → the same session id');
  assert.equal(flow.snapshot().join.keyword, 'العب', 'the word is remembered');
  assert.equal(e.players.size, 3, 'the viewer who wrote the word while it was closed enters on reopening');
  e.connection.username = 'host1';
  e.seatHost({ name: 'host1' }); assert.ok(e.snapshot().registration.hostSeated);
  flow.start(prepareQuestion);
  assert.equal(e.party.rounds, 5, 'rounds from the settings');
  assert.throws(() => flow.setup('flag'), /الجولة جارية/);
  assert.throws(() => flow.saveSettings('flag', { rounds: 10 }), /أثناء الجولة/);
});

test('joining after the round started follows each game\'s rules', () => {
  const { e, flow, chat, prepareQuestion, add, enter } = rig();
  // a game that does not allow it: the «مفتوح دائمًا» option is refused, viewers wait for the next round
  flow.setup('flag');
  assert.throws(() => flow.saveSettings('flag', null, { lateJoin: 'open' }), /لا تدعم/);
  // the quiz allows it
  flow.setup('quiz'); flow.saveSettings('quiz', { questions: 5 }, { lateJoin: 'open' });
  enter();
  chat('a', 'انضم'); flow.start(prepareQuestion);
  chat('late', 'انضم');
  assert.equal(e.players.has('late'), true, '«مفتوح دائمًا»: joins the running round');
  chat('late', '1'); add(30_001);
  assert.equal(e.status.results.rankings.some((r) => r.name === 'مشاهد late'), true, 'and can answer');
  // series: the next question starts by itself; the stage stays «running» in between
  assert.equal(flow.snapshot().stage, 'GAME_RUNNING');
  add(6_001);
  assert.equal(e.status.active, true); assert.equal(e.snapshot().series.index, 2);
  // «انقر للإضافة»: the host adds a newcomer by hand during the round
  e.addManualPlayer({ name: 'ضيف' });
  assert.equal([...e.players.values()].some((p) => p.name === 'ضيف'), true);
  // «إنهاء اللعبة»: stops safely and returns to the library
  flow.end();
  assert.equal(e.status.active, false); assert.equal(e.quiz.nextAt, null);
  assert.equal(flow.snapshot().stage, 'GAME_LIBRARY');
});

test('«تجربة اللعبة» fills the lobby with demo players but does not start the round', () => {
  const { e, flow } = rig();
  flow.setup('rps'); flow.tryOut(); flow.ready(); e.addDemoPlayers({ count: 4 });
  assert.equal(flow.snapshot().stage, 'WAITING_FOR_PLAYERS'); assert.equal(flow.snapshot().trial, true); assert.equal(flow.snapshot().lobby.demo, true);
  assert.equal(e.status.active, false);
  assert.equal(e.realPlayerCount(), 0, 'demo players are not real players');
});

test('settings are kept per game for the room (a refresh reads them back)', () => {
  const { flow } = rig();
  flow.setup('bomb'); flow.saveSettings('bomb', { seconds: 30 });
  flow.setup('quiz'); flow.setup('bomb');
  assert.equal(flow.snapshot().settings.seconds, 30);
  flow.resetSettings('bomb'); assert.equal(flow.snapshot().settings.seconds, 15, 'restore defaults');
});
