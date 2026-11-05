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
  return { e, flow, chat, prepareQuestion, add: (ms) => { t += ms; e.tick(); } };
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

test('the mandatory scenario: «ابدأ اللعبة» opens the join-word screen; only «بدء الجولة الآن» starts the quiz', () => {
  const { e, flow, chat, prepareQuestion, add } = rig();
  assert.equal(flow.snapshot().stage, 'GAME_LIBRARY');
  // 2–4. «تشغيل اللعبة» on تحدي المعرفة → its settings, nothing opened
  flow.setup('quiz');
  assert.equal(flow.snapshot().stage, 'GAME_SETUP');
  assert.equal(e.registration.phase, 'idle'); assert.equal(e.status.active, false);
  // 5. change the options
  flow.saveSettings('quiz', { questions: 1, seconds: 20, scoring: 'flat' });
  assert.deepEqual([flow.snapshot().settings.questions, flow.snapshot().settings.seconds], [1, 20]);
  // 6–7. «ابدأ اللعبة» → join-word screen; no round, no registration, no timer
  flow.begin();
  assert.equal(flow.snapshot().stage, 'REGISTRATION_SETUP');
  assert.equal(e.status.active, false); assert.equal(e.registration.phase, 'idle'); assert.equal(e.status.endsAt, null);
  chat('early', 'انضم'); assert.equal(e.players.size, 0, 'nobody joins before registration opens');
  assert.throws(() => flow.start(prepareQuestion), /افتح التسجيل/, 'no jump to the round from here');
  // 8–10. word «جاهز», open registration
  flow.open('جاهز');
  assert.equal(flow.snapshot().stage, 'WAITING_FOR_PLAYERS');
  assert.equal(e.registration.phase, 'open'); assert.equal(e.registration.keyword, 'جاهز');
  assert.equal(e.status.active, false);
  // 11–12. matching comment → added once; repeating it adds nobody new
  chat('v1', 'جاهز'); chat('v1', 'جاهز'); add(400); chat('v1', 'جاهز');
  assert.equal(e.players.size, 1);
  // 13–14. a different word is ignored
  chat('v2', 'انضم'); chat('v3', 'hello');
  assert.equal(e.players.size, 1);
  // 15–16. now the round starts, with the saved settings applied
  flow.start(prepareQuestion);
  assert.equal(flow.snapshot().stage, 'GAME_RUNNING');
  assert.equal(e.status.active, true); assert.equal(e.status.mode, 'quiz');
  assert.equal(e.status.endsAt - e.status.startedAt, 20_000, 'answer time from the settings');
  chat('v1', '1');
  add(20_001);
  assert.equal(e.status.active, false);
  assert.equal(e.status.results.rankings[0].points, 5, 'flat scoring from the settings');
  assert.equal(flow.snapshot().stage, 'GAME_FINISHED');
});

test('the order is enforced: no stage can be skipped', () => {
  const { e, flow, prepareQuestion } = rig();
  assert.throws(() => flow.begin(), /اختر اللعبة/);
  assert.throws(() => flow.open('انضم'), /ابدأ اللعبة/);
  assert.throws(() => flow.start(prepareQuestion), /افتح التسجيل/);
  flow.setup('quiz');
  assert.throws(() => flow.open('انضم'), /ابدأ اللعبة/, 'setup → lobby without «ابدأ اللعبة» is refused');
  assert.throws(() => flow.start(prepareQuestion), /افتح التسجيل/, 'setup → running is refused');
  flow.begin(); flow.open('انضم');
  assert.throws(() => flow.start(prepareQuestion), /تحتاج 1/, 'needs players');
  assert.equal(e.status.active, false);
});

test('back to settings keeps players and word; word change, close and reopen; host seat', () => {
  const { e, flow, chat, prepareQuestion } = rig();
  flow.setup('flag'); flow.begin(); flow.open('العب');
  chat('a', 'العب'); chat('b', 'العب');
  // back to settings: registration stops, players stay
  flow.setup('flag');
  assert.equal(flow.snapshot().stage, 'GAME_SETUP'); assert.equal(e.players.size, 2); assert.equal(e.registration.phase, 'closed');
  chat('c', 'العب'); assert.equal(e.players.has('c'), false, 'closed while in settings');
  flow.saveSettings('flag', { rounds: 5 });
  flow.begin();
  assert.equal(flow.snapshot().join.keyword, 'العب', 'the word is remembered');
  flow.open('دخول');
  assert.equal(e.players.size, 3, 'the viewer who wrote the word while it was closed enters on reopening');
  chat('d', 'العب'); assert.equal(e.players.has('d'), false, 'old word no longer works');
  chat('d', 'دخول'); assert.equal(e.players.has('d'), true);
  // change the word while open
  flow.open('جاهز'); chat('f', 'جاهز'); assert.equal(e.players.has('f'), true);
  // close and reopen
  flow.close(); chat('g', 'جاهز'); assert.equal(e.players.has('g'), false);
  flow.open('جاهز'); assert.equal(e.players.has('g'), true, 'a viewer who wrote it while closed enters when it reopens');
  // the host as a player
  e.connection.username = 'host1';
  e.seatHost({ name: 'host1' }); assert.ok(e.snapshot().registration.hostSeated);
  flow.start(prepareQuestion);
  assert.equal(e.party.rounds, 5, 'rounds from the settings');
  assert.throws(() => flow.setup('flag'), /الجولة جارية/);
  assert.throws(() => flow.saveSettings('flag', { rounds: 10 }), /أثناء الجولة/);
});

test('joining after the round started follows each game\'s rules', () => {
  const { e, flow, chat, prepareQuestion, add } = rig();
  // a game that does not allow it: the «مفتوح دائمًا» option is refused, viewers wait for the next round
  flow.setup('flag');
  assert.throws(() => flow.saveSettings('flag', null, { lateJoin: 'open' }), /لا تدعم/);
  // the quiz allows it
  flow.setup('quiz'); flow.saveSettings('quiz', { questions: 5 }, { lateJoin: 'open' });
  flow.begin(); flow.open('انضم');
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
  flow.setup('rps'); flow.tryOut(); e.addDemoPlayers({ count: 4 });
  assert.equal(flow.snapshot().stage, 'WAITING_FOR_PLAYERS'); assert.equal(flow.snapshot().trial, true);
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
