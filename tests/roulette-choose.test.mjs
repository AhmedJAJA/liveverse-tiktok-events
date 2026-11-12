// «الروليت» — the rule of the game: the holder, drawn at random by the server, chooses ANOTHER player still in the
// game by writing that player's number in the TikTok/Kick chat. Nobody else can choose, the holder never faces the
// revolver because of their own draw, and a holder who stays silent hands the choice to the server (a random other
// player) or loses the turn — as the host announced. Wrong numbers get an answer on screen; a chat that drops while
// the holder chooses freezes the countdown instead of stealing their turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { createPartyGame } from '../src/party.mjs';
import { ROULETTE_RULES, ROULETTE_DEFAULTS, CHAT_PAUSE_MAX_MS, parseChoice } from '../src/roulette.mjs';
import { Engine } from '../src/engine.mjs';
import { GAME_SETTINGS, defaultSettings, validateSettings, applySettings, settingsSchema } from '../src/game-settings.mjs';

function clock(start = 1_000_000) { let t = start; return { now: () => t, add: (ms) => { t += ms; } }; }
const people = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: 'لاعب ' + (i + 1), number: i + 1 }));
function make(n, opts = {}) {
  const c = clock();
  const g = createPartyGame('roulette', { now: c.now, random: (m) => randomInt(m), ...opts });
  g.start(opts.players || people(n));
  return { g, c };
}
const finishScene = (g, c) => { if (g.endsAt != null) c.add(Math.max(0, g.endsAt - c.now())); return g.tick(); };
/** Draw a turn and run the reel until the holder chooses. */
function toChoose(g, c) { g.draw(); finishScene(g, c); finishScene(g, c); assert.equal(g.phase, 'choose'); return g.roster.get(g.holder); }
const otherAlive = (g, holder) => g.alive.filter((p) => p.id !== holder.id);

/* ---------------- the rule itself ---------------- */
test('by default the drawn holder chooses — the game never makes the holder face the revolver for being drawn', () => {
  assert.deepEqual(ROULETTE_RULES.targetMode, ['choose'], 'the only rule is «the holder chooses»');
  assert.equal(ROULETTE_DEFAULTS.targetMode, 'choose');
  const { g, c } = make(5);
  assert.equal(g.rules.targetMode, 'choose');
  const holder = toChoose(g, c);
  assert.equal(g.target, null, 'no target before the holder writes a number');
  assert.ok(g.alive.includes(holder));
  // a saved match from before (rule «self») plays by the rule of the game
  const legacy = make(4, { targetMode: 'self' });
  assert.equal(legacy.g.rules.targetMode, 'choose');
});

test('a silent holder never shoots themselves: the server picks a random OTHER player, or the turn is cancelled', () => {
  assert.deepEqual(ROULETTE_RULES.timeoutRule, ['random', 'skip']);
  assert.equal(ROULETTE_DEFAULTS.timeoutRule, 'random');
  for (let i = 0; i < 60; i++) {
    const { g, c } = make(2 + (i % 5));
    const holder = toChoose(g, c);
    finishScene(g, c); // the countdown ends
    assert.equal(g.phase, 'aim');
    assert.notEqual(g.target, holder.id, 'never the holder');
    assert.ok(g.roster.get(g.target).alive, 'a player still in');
    assert.equal(g.how, 'timeout');
  }
  const legacy = make(4, { timeoutRule: 'self' });
  assert.equal(legacy.g.rules.timeoutRule, 'random', 'an old «self» setting becomes «random»');
  const skip = make(4, { timeoutRule: 'skip' });
  toChoose(skip.g, skip.c); finishScene(skip.g, skip.c);
  assert.equal(skip.g.phase, 'reveal'); assert.equal(skip.g.result.outcome, 'cancel'); assert.equal(skip.g.result.reason, 'timeout');
  assert.equal(skip.g.alive.length, 4, 'nobody is out when the turn is cancelled');
});

/* ---------------- what the holder writes ---------------- */
test('the number may be written the way people write in a live chat', () => {
  for (const [raw, n] of [['7', 7], ['#7', 7], ['رقم 7', 7], ['رقم٧', 7], ['٧', 7], ['۷', 7], ['7 🔫', 7], ['🔫7', 7], ['اطلق على 7', 7], ['اختار 12 يا شباب', 12],
    ['7️⃣', 7], ['  7  ', 7], ['7 7', 7], ['اللاعب رقم 07', 7]]) assert.deepEqual(parseChoice(raw), { n }, raw);
  for (const raw of ['', 'ههههه', 'انضم', '🔫', null, undefined, '12345', '0', '00']) assert.equal(parseChoice(raw), null, String(raw));
  assert.deepEqual(parseChoice('7 أو 8'), { ambiguous: [7, 8] });
  assert.deepEqual(parseChoice('3 4 5'), { ambiguous: [3, 4, 5] });
});

test('a valid number from the holder: that player is the target, chosen by the chat', () => {
  const { g, c } = make(6);
  const holder = toChoose(g, c);
  const target = otherAlive(g, holder)[2];
  assert.equal(g.input(holder.id, 'اطلق على ' + target.number + ' 🔫'), true);
  assert.equal(g.phase, 'aim'); assert.equal(g.target, target.id); assert.equal(g.how, 'chat');
  const v = g.view();
  assert.equal(v.target.number, target.number); assert.equal(v.holder.number, holder.number); assert.equal(v.how, 'chat');
  assert.equal(v.feedback, null, 'no error card once the choice is made');
});

test('a wrong number from the holder gets an answer on screen, and the holder can try again', () => {
  const { g, c } = make(6);
  // put one player out first, so «already out» can be tried
  const holder0 = toChoose(g, c); const victim = otherAlive(g, holder0)[0];
  victim.alive = false; victim.eliminatedTurn = 1;
  const holder = holder0;
  const cases = [
    [String(holder.number), 'self'],
    [String(victim.number), 'out'],
    ['99', 'missing'],
    [otherAlive(g, holder)[0].number + ' أو ' + otherAlive(g, holder)[1].number, 'ambiguous'],
  ];
  for (const [text, kind] of cases) {
    assert.equal(g.input(holder.id, text), true, 'a wrong choice is news for the screens: ' + text);
    assert.equal(g.phase, 'choose', 'still choosing after: ' + text);
    const f = g.view().feedback;
    assert.equal(f?.kind, kind, text);
    if (kind !== 'ambiguous') assert.equal(f.number, Number(text));
  }
  // plain chatter from the holder changes nothing and keeps the last answer
  assert.equal(g.input(holder.id, 'لحظة أفكر'), false);
  assert.equal(g.view().feedback.kind, 'ambiguous');
  const ok = otherAlive(g, holder)[1];
  assert.equal(g.input(holder.id, String(ok.number)), true);
  assert.equal(g.phase, 'aim'); assert.equal(g.target, ok.id); assert.equal(g.view().feedback, null);
});

test('nobody but the holder can choose: other players, eliminated players, strangers, and messages outside the choice', () => {
  const { g, c } = make(5);
  g.draw();
  const early = g.roster.get(g.holder);
  assert.equal(g.input(early.id, String(otherAlive(g, early)[0].number)), false, 'during the draw the choice is not open yet');
  finishScene(g, c); finishScene(g, c);
  const holder = g.roster.get(g.holder), target = otherAlive(g, holder)[0];
  const other = otherAlive(g, holder)[1];
  assert.equal(g.input(other.id, String(target.number)), false, 'another player');
  const out = otherAlive(g, holder)[2]; out.alive = false;
  assert.equal(g.input(out.id, String(target.number)), false, 'an eliminated player');
  assert.equal(g.input('stranger', String(target.number)), false, 'a viewer who is not in the game');
  assert.equal(g.input('', String(target.number)), false);
  assert.equal(g.phase, 'choose'); assert.equal(g.target, null); assert.equal(g.view().feedback, null, 'others never trigger the error card');
  g.input(holder.id, String(target.number));
  assert.equal(g.phase, 'aim');
  assert.equal(g.input(holder.id, String(other.number)), false, 'the choice is final');
  assert.equal(g.target, target.id);
});

/* ---------------- the chat drops while the holder chooses ---------------- */
test('the chat drops during the choice: the countdown freezes, then resumes with the time that was left', () => {
  let live = true;
  const { g, c } = make(5, { chatConnected: () => live });
  const holder = toChoose(g, c);
  g.tick(); // the server sees the chat connected during this match
  c.add(5_000); g.tick();
  const left = g.endsAt - c.now();
  live = false; g.tick();
  assert.equal(g.view().chatDown, true, 'the screens say why the countdown stopped');
  c.add(40_000); g.tick();
  assert.equal(g.phase, 'choose', 'the holder keeps their turn while the chat is down');
  assert.ok(Math.abs((g.endsAt - c.now()) - left) <= 150, 'the time left is kept');
  live = true; g.tick();
  assert.equal(g.view().chatDown, false);
  assert.equal(g.input(holder.id, String(otherAlive(g, holder)[0].number)), true, 'the holder chooses once the chat is back');
});

test('the chat never comes back: the pause is capped and the announced timeout rule decides', () => {
  let live = true;
  const { g, c } = make(4, { chatConnected: () => live });
  const holder = toChoose(g, c); g.tick();
  live = false;
  let sawResume = false;
  for (let t = 0; t < CHAT_PAUSE_MAX_MS + 60_000; t += 1000) {
    c.add(1000); g.tick();
    if (g.phase !== 'choose') break;
    if (t > CHAT_PAUSE_MAX_MS + 1000) { assert.equal(g.view().chatDown, false, 'once the pause is over the screens no longer say «paused»'); sawResume = true; }
  }
  assert.ok(sawResume, 'the countdown ran (visibly) after the pause');
  assert.equal(g.phase, 'aim', 'the match goes on');
  assert.notEqual(g.target, holder.id); assert.equal(g.how, 'timeout');
});

test('no stream at all (owner tests, trial lobby): the countdown runs normally', () => {
  const never = make(4, { chatConnected: () => false });
  toChoose(never.g, never.c); finishScene(never.g, never.c);
  assert.equal(never.g.phase, 'aim', 'never connected during the match: nothing to wait for');
  const demo = make(4, { chatConnected: () => false, demo: true, players: people(4).map((p) => ({ ...p, id: 'demo:bot-' + p.number })) });
  demo.g.draw(); finishScene(demo.g, demo.c); finishScene(demo.g, demo.c);
  demo.c.add(60_000); demo.g.tick();
  assert.notEqual(demo.g.phase, 'choose');
});

/* ---------------- the settings page ---------------- */
test('the settings page offers only the rule of the game; old saved choices are carried over, not refused', () => {
  const keys = GAME_SETTINGS.roulette.map((f) => f.key);
  assert.ok(!keys.includes('targetMode'), 'there is nothing to choose: the holder always chooses');
  const timeout = settingsSchema().roulette.find((f) => f.key === 'timeoutRule');
  assert.deepEqual(timeout.options.map((o) => o.value), ['random', 'skip']);
  assert.equal(timeout.default, 'random');
  assert.equal(defaultSettings('roulette').timeoutRule, 'random');
  // a host page from before, or a saved lobby, still sends the old values
  const v = validateSettings('roulette', { targetMode: 'self', timeoutRule: 'self' });
  assert.equal(v.timeoutRule, 'random'); assert.equal(v.targetMode, undefined);
  const fromSaved = validateSettings('roulette', {}, { ...defaultSettings('roulette'), targetMode: 'self', timeoutRule: 'self' });
  assert.equal(fromSaved.timeoutRule, 'random'); assert.equal(fromSaved.targetMode, undefined);
  assert.throws(() => validateSettings('roulette', { timeoutRule: 'never' }), /قيمة غير صالحة/);
});

/* ---------------- end to end through the chat (the path TikTok and Kick use) ---------------- */
function room(opts = {}) {
  let t = 50_000, live = opts.live ?? null;
  const e = new Engine({ now: () => t, random: randomInt });
  e.partyExtras = (mode) => (mode === 'roulette' ? { hostPresent: () => true, ...(live === null ? {} : { chatConnected: () => live }) } : null);
  e.configure({ mode: 'roulette', title: 'الروليت' });
  applySettings(e, 'roulette', { ...defaultSettings('roulette'), ...(opts.settings || {}) });
  e.openRegistration({ keyword: 'انضم' });
  const chat = (id, text, msgId = '') => e.receiveChat({ id, username: 'مشاهد ' + id, text, msgId });
  return { e, chat, add: (ms) => { t += ms; e.tick(); }, setLive: (v) => { live = v; }, party: () => e.snapshot().party, idOf: (n) => [...e.players.values()].find((p) => p.number === n).id };
}

test('through the chat: the holder writes a number, everyone else is ignored, wrong numbers show on screen', () => {
  const r = room();
  for (const id of ['a', 'b', 'c', 'd', 'e']) r.chat(id, 'انضم');
  r.e.start();
  r.e.rouletteCommand('draw', { requestId: 'p0-e2e-01' });
  for (let i = 0; i < 40 && r.party().phase !== 'choose'; i++) r.add(250);
  let p = r.party();
  assert.equal(p.phase, 'choose');
  const holderId = r.idOf(p.holder.number);
  const others = p.players.filter((x) => x.a && x.n !== p.holder.number).map((x) => x.n);
  r.chat(r.idOf(others[1]), String(others[0]));             // another player
  r.chat('not-a-player', String(others[0]));                // a viewer who never joined
  r.chat(holderId, String(p.holder.number));                // the holder's own number
  p = r.party();
  assert.equal(p.phase, 'choose'); assert.equal(p.feedback.kind, 'self');
  r.chat(holderId, 'اطلق على ' + others[0], 'msg-1');       // a valid choice…
  r.chat(holderId, 'اطلق على ' + others[0], 'msg-1');       // …delivered twice by the platform
  p = r.party();
  assert.equal(p.phase, 'aim'); assert.equal(p.target.number, others[0]); assert.equal(p.how, 'chat');
});

test('through the chat: a silent holder — the server picks another player, the match reaches a winner', () => {
  const r = room();
  for (const id of ['a', 'b', 'c', 'd']) r.chat(id, 'انضم');
  r.e.start();
  let guard = 0, timeouts = 0;
  while (r.e.status.active && guard++ < 2000) {
    const p = r.party();
    if (p.phase === 'ready') r.e.rouletteCommand('draw', {});
    else if (p.phase === 'aim' && p.how === 'timeout') { assert.notEqual(p.target.number, p.holder.number); timeouts++; r.add(p.endsAt - r.e.now() + 1); }
    else r.add(Math.max(1, (p.endsAt ?? r.e.now()) - r.e.now() + 1));
  }
  assert.equal(r.e.status.active, false, 'the match ended');
  assert.ok(timeouts >= 3, 'every pull came from the timeout rule');
  assert.ok(r.e.status.winner, 'one winner');
});

test('through the chat: the stream drops while the holder chooses, comes back, and the holder still chooses', () => {
  const r = room({ live: true });
  for (const id of ['a', 'b', 'c']) r.chat(id, 'انضم');
  r.e.start();
  r.e.rouletteCommand('draw', { requestId: 'p0-e2e-02' });
  for (let i = 0; i < 40 && r.party().phase !== 'choose'; i++) r.add(250);
  const p = r.party(); const holderId = r.idOf(p.holder.number);
  r.add(200);
  r.setLive(false); r.add(200);
  assert.equal(r.party().chatDown, true);
  r.add(60_000);
  assert.equal(r.party().phase, 'choose', 'a minute without chat does not cost the holder their turn');
  r.setLive(true); r.add(200);
  const tgt = p.players.find((x) => x.a && x.n !== p.holder.number).n;
  r.chat(holderId, String(tgt));
  assert.equal(r.party().phase, 'aim'); assert.equal(r.party().target.number, tgt);
});
