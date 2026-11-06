// «الروليت» — the rules engine (src/roulette.mjs), the recorder (src/roulette-store.mjs) and the engine wiring.
// The server alone draws the turn holder (a fair shuffle bag, never an eliminated player) and alone decides every
// pull (a cylinder per player, loaded with the secure generator at the start). The screens only animate what was
// decided; skipping an animation jumps to the same outcome; a repeated «ابدأ السحب» never draws twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import pg from 'pg';
import { createPartyGame } from '../src/party.mjs';
import { RussianRoulette, ROULETTE_RULES, ROULETTE_DEFAULTS, SPEED, PICKED_MS, AUTO_GAP_MS, parseNumber } from '../src/roulette.mjs';
import { RouletteStore } from '../src/roulette-store.mjs';
import { Engine } from '../src/engine.mjs';
import { GAME_SETTINGS, defaultSettings, validateSettings, applySettings } from '../src/game-settings.mjs';
import { migrate } from '../src/db.mjs';

function clock(start = 1_000_000) { let t = start; return { now: () => t, add: (ms) => { t += ms; } }; }
const people = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: 'لاعب ' + (i + 1), number: i + 1, ...(extra[i] || {}) }));
function make(n, opts = {}) {
  const c = clock(); const events = [];
  const g = createPartyGame('roulette', { now: c.now, random: (m) => randomInt(m), onEvent: (e) => events.push(e), ...opts });
  g.start(opts.players || people(n));
  return { g, c, events };
}
/** Let the server clock reach the end of the current scene. */
const finishScene = (g, c) => { if (g.endsAt != null) c.add(Math.max(0, g.endsAt - c.now())); return g.tick(); };
/** One whole turn in «اللاعب المسحوب» mode: draw → reel → picked → revolver → result → the grid again. */
function playTurn(g, c) {
  g.draw();
  const seen = [g.phase];
  for (let i = 0; i < 12 && !g.finished && !(g.phase === 'ready' && seen.length > 1); i++) { finishScene(g, c); seen.push(g.phase); }
  return seen;
}

test('a player number written in the chat: digits, Arabic-Indic digits, «#12», «رقم 12» — nothing else', () => {
  for (const [raw, n] of [['12', 12], ['#12', 12], ['١٢', 12], ['۱۲', 12], ['رقم 12', 12], ['رقم12', 12], ['  7 ', 7], ['٣', 3]]) assert.equal(parseNumber(raw), n, raw);
  for (const raw of ['', 'abc', '12a', 'a12', '12345', '1 2', 'انضم', '-3', '1.5', null, undefined]) assert.equal(parseNumber(raw), null, String(raw));
});

test('the rules: announced defaults, every value checked, at least one empty chamber, fixed for the whole match', () => {
  const { g } = make(4);
  assert.deepEqual({ ...g.rules }, { ...ROULETTE_DEFAULTS });
  assert.equal(ROULETTE_DEFAULTS.chambers, 2); assert.equal(ROULETTE_DEFAULTS.bullets, 1); assert.equal(ROULETTE_DEFAULTS.cylinder, 'advance');
  assert.ok(Object.isFrozen(g.rules), 'the rules cannot change during the match');
  const odd = make(4, { chambers: 99, bullets: 'x', cylinder: 'loop', targetMode: 'any', autoRun: 1 }).g;
  assert.deepEqual({ ...odd.rules }, { ...ROULETTE_DEFAULTS }, 'unknown values fall back to the announced defaults');
  assert.equal(make(4, { chambers: 2, bullets: 3 }).g.rules.bullets, 1, 'bullets < chambers, always');
  assert.equal(make(4, { chambers: 3, bullets: 3 }).g.rules.bullets, 2);
  // the settings page refuses an impossible cylinder outright, and clamps when only the chambers changed
  assert.throws(() => validateSettings('roulette', { chambers: 3, bullets: 3 }), /أقل من عدد الحجرات/);
  assert.equal(validateSettings('roulette', { chambers: 2 }, { ...defaultSettings('roulette'), chambers: 4, bullets: 3 }).bullets, 1);
  // the rules are written on screen in plain Arabic
  const text = make(4, { chambers: 6, bullets: 1, cylinder: 'spin', targetMode: 'choose' }).g.view().rules.text.join(' ');
  assert.match(text, /6 حجرات/); assert.match(text, /طلقة واحدة/); assert.match(text, /1 من 6/); assert.match(text, /يكتب في الشات رقم اللاعب/);
  assert.match(make(4).g.view().rules.text.join(' '), /حجرتين.*السحبة الأولى 1 من 2/);
});

test('every setting on the settings page changes the game (none is decorative)', () => {
  const keys = GAME_SETTINGS.roulette.map((f) => f.key).sort();
  assert.deepEqual(keys, ['autoRun', 'bullets', 'chambers', 'chooseSeconds', 'cylinder', 'drawSpeed', 'effects', 'graphics', 'hostPlays', 'maxPlayers', 'resultSeconds', 'showFrames', 'showNames', 'sounds', 'targetMode', 'timeoutRule', 'trial'].sort());
  for (const f of GAME_SETTINGS.roulette) assert.ok(f.label && f.options.length >= 2, f.key);
  // applied to the engine: the rules reach the match, the lobby limit and the host seat reach the registration
  let t = 1000;
  const e = new Engine({ now: () => t, random: randomInt });
  e.configure({ mode: 'roulette', title: 'الروليت' });
  const s = { ...defaultSettings('roulette'), chambers: 4, bullets: 2, cylinder: 'spin', targetMode: 'choose', chooseSeconds: 15, timeoutRule: 'random', autoRun: 'auto', drawSpeed: 'fast', resultSeconds: 3, maxPlayers: 10, hostPlays: true, sounds: false, effects: 'high', graphics: 'low', showNames: false, showFrames: false };
  applySettings(e, 'roulette', s);
  assert.equal(e.registration.maxPlayers, 10); assert.equal(e.registration.hostJoin, 'auto');
  e.openRegistration({ keyword: 'انضم' });
  for (let i = 1; i <= 4; i++) e.receiveChat({ id: 'v' + i, username: 'مشاهد ' + i, text: 'انضم' });
  e.start();
  const v = e.snapshot().party;
  assert.deepEqual({ chambers: v.rules.chambers, bullets: v.rules.bullets, cylinder: v.rules.cylinder, targetMode: v.rules.targetMode, chooseSeconds: v.rules.chooseSeconds, timeoutRule: v.rules.timeoutRule, autoRun: v.rules.autoRun, drawSpeed: v.rules.drawSpeed, resultSeconds: v.rules.resultSeconds },
    { chambers: 4, bullets: 2, cylinder: 'spin', targetMode: 'choose', chooseSeconds: 15, timeoutRule: 'random', autoRun: 'auto', drawSpeed: 'fast', resultSeconds: 3 });
  assert.deepEqual({ ...v.display }, { showNames: false, showFrames: false, sounds: false, effects: 'high', graphics: 'low', hostPlays: true });
  assert.equal(v.endsAt - v.phaseStartedAt, AUTO_GAP_MS, '«تلقائي»: the next turn is scheduled by the server');
});

test('cylinders: each player gets their own, loaded with distinct chambers — even with a generator that always says 0', () => {
  for (const [chambers, bullets] of [[2, 1], [3, 2], [4, 3], [6, 1], [6, 3]]) {
    const { g } = make(30, { chambers, bullets });
    for (const p of g.roster.values()) {
      assert.equal(p.cyl.length, bullets); assert.equal(new Set(p.cyl).size, bullets);
      assert.ok(p.cyl.every((x) => Number.isInteger(x) && x >= 0 && x < chambers));
    }
    const zero = make(5, { chambers, bullets, random: () => 0 }).g; // a broken generator must never hang the server
    for (const p of zero.roster.values()) assert.equal(new Set(p.cyl).size, bullets);
  }
});

test('one turn, scene by scene: the server keeps every deadline and publishes the outcome only at the reveal', () => {
  const { g, c, events } = make(5);
  let v = g.view();
  assert.equal(v.phase, 'ready'); assert.equal(v.endsAt, null, '«يدوي»: the grid waits for «ابدأ السحب»');
  assert.equal(v.alive, 5); assert.equal(v.total, 5); assert.equal(v.turn, 0);
  assert.equal(g.tick(), false, 'nothing happens by itself in manual mode');
  c.add(60_000); assert.equal(g.tick(), false);
  const seq0 = v.seq;
  assert.deepEqual(g.draw(), { turn: 1 });
  v = g.view();
  assert.equal(v.phase, 'drawing'); assert.ok(v.seq > seq0);
  assert.equal(v.endsAt - v.phaseStartedAt, SPEED.normal.reel);
  assert.equal(v.reel.list.length, 30); assert.equal(v.reel.list[v.reel.stop], v.holder.number, 'every screen rolls to the same name');
  assert.ok(v.reel.list.every((n) => g.alive.some((p) => p.number === n)), 'only players still in are on the reel');
  assert.equal(v.target, null); assert.equal(v.result, null); assert.equal(v.chamber, null);
  finishScene(g, c); v = g.view();
  assert.equal(v.phase, 'picked'); assert.equal(v.endsAt - v.phaseStartedAt, PICKED_MS);
  finishScene(g, c); v = g.view();
  assert.equal(v.phase, 'aim'); assert.equal(v.target.id, v.holder.id, '«اللاعب المسحوب» faces the revolver');
  assert.deepEqual(v.chamber, { index: 1, of: 2 }, '«الحجرة 1 من 2»');
  assert.equal(v.result, null, 'the outcome is decided, not published');
  const pub = JSON.stringify(g.snapshot());
  assert.doesNotMatch(pub, /"cyl"|"pending"|"spin"|"out":true|"out":false/, 'no cylinder, no pending outcome on the broadcast');
  const decided = g.pending.out;
  finishScene(g, c); v = g.view();
  assert.equal(v.phase, 'reveal'); assert.equal(v.endsAt - v.phaseStartedAt, 4000, '«مدة عرض النتيجة»');
  assert.equal(v.result.outcome, decided ? 'out' : 'empty'); assert.deepEqual(v.chamber, { index: 1, of: 2 });
  const p = g.roster.get(v.target.id);
  assert.equal(p.alive, !decided); assert.equal(p.shots, 1);
  finishScene(g, c); v = g.view();
  assert.equal(v.phase, 'ready'); assert.equal(v.holder, null); assert.equal(v.target, null); assert.equal(v.result, null);
  assert.equal(v.alive, decided ? 4 : 5); assert.equal(v.eliminated, decided ? 1 : 0);
  assert.deepEqual(events.map((e) => e.type), ['start', 'draw', 'turn']);
  assert.equal(events[2].outcome, decided ? 'out' : 'empty'); assert.equal(events[2].chamber, 1); assert.equal(events[2].of, 2);
  assert.equal(v.log.at(-1).kind, decided ? 'out' : 'empty');
});

test('«تتقدم حجرة»: a player who survived once fires the next chamber — two chambers, one bullet: never a third pull', () => {
  for (let run = 0; run < 40; run++) {
    const { g, c } = make(2);
    while (!g.finished) playTurn(g, c);
    for (const p of g.roster.values()) assert.ok(p.shots <= 2, 'at most two pulls on a two-chamber cylinder');
    const loser = [...g.roster.values()].find((p) => !p.alive);
    assert.equal(loser.cyl[0], loser.shots - 1, 'the bullet was exactly where the cylinder stopped');
  }
});

test('the fair draw: everyone still in is drawn once before anyone is drawn again, never twice in a row', () => {
  const { g } = make(7, { targetMode: 'choose' });
  const order = [];
  for (let i = 0; i < 70; i++) order.push(g.nextHolder().number);
  for (let b = 0; b < 70; b += 7) assert.deepEqual(order.slice(b, b + 7).sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7], 'bag ' + b / 7);
  for (let i = 1; i < order.length; i++) assert.notEqual(order[i], order[i - 1], 'no immediate repeat at ' + i);
  // two players: they alternate
  const two = make(2, { targetMode: 'choose' }).g;
  const alt = Array.from({ length: 20 }, () => two.nextHolder().number);
  for (let i = 1; i < alt.length; i++) assert.notEqual(alt[i], alt[i - 1]);
});

test('an eliminated player is never drawn, never on the reel, never a target', () => {
  const { g, c } = make(6, { targetMode: 'choose', chambers: 3, bullets: 2 });
  let turns = 0;
  while (!g.finished && turns++ < 400) {
    g.draw();
    const holder = g.roster.get(g.holder);
    assert.ok(holder.alive, 'holder is still in');
    assert.ok(g.reel.list.every((n) => g.alive.some((p) => p.number === n)));
    finishScene(g, c); finishScene(g, c); // → choose
    assert.equal(g.phase, 'choose');
    const dead = [...g.roster.values()].find((p) => !p.alive);
    if (dead) assert.equal(g.input(holder.id, String(dead.number)), false, 'an eliminated number is not a target');
    const other = g.alive.find((p) => p.id !== holder.id);
    assert.equal(g.input(holder.id, String(other.number)), true);
    assert.ok(g.roster.get(g.target).alive);
    finishScene(g, c); finishScene(g, c);
  }
  assert.ok(g.finished); assert.equal(g.alive.length, 1);
});

test('«ابدأ السحب» clicked again and again: one turn per request id, a second draw during a turn is refused', () => {
  const { g, c } = make(5);
  assert.deepEqual(g.draw({ requestId: 'click-aaa111' }), { turn: 1 });
  for (let i = 0; i < 5; i++) assert.deepEqual(g.draw({ requestId: 'click-aaa111' }), { duplicate: true, turn: 1 }, 'the same click counts once');
  assert.throws(() => g.draw({ requestId: 'click-bbb222' }), (e) => e.status === 409 && /السحب جارٍ/.test(e.message));
  assert.throws(() => g.draw(), (e) => e.status === 409);
  assert.equal(g.turn, 1); assert.equal(g.stats.turns, 1);
  const holder = g.holder;
  finishScene(g, c);
  assert.throws(() => g.draw(), /السحب جارٍ/, 'not while the name is announced either');
  assert.equal(g.holder, holder, 'the turn keeps its holder');
  // a request id that is not one is simply not remembered
  while (g.phase !== 'ready') finishScene(g, c);
  assert.deepEqual(g.draw({ requestId: '<script>' }), { turn: 2 });
});

test('skipping an animation jumps to the outcome already decided — it never draws anything again', () => {
  // advance: the outcome is the target's next chamber
  for (let run = 0; run < 30; run++) {
    const { g } = make(4);
    g.draw();
    const h = g.roster.get(g.holder), willBeOut = h.cyl.includes(h.shots);
    const r = g.skip();
    assert.equal(r.phase, 'reveal', 'skip from the reel goes straight to the result');
    assert.equal(g.result.outcome, willBeOut ? 'out' : 'empty');
  }
  // spin: the cylinder is spun when the turn is drawn, so skipping cannot change it
  for (let run = 0; run < 30; run++) {
    const { g, c } = make(4, { cylinder: 'spin', chambers: 6, bullets: 1 });
    g.draw();
    const spun = g.spin;
    assert.ok(Number.isInteger(spun) && spun >= 0 && spun < 6);
    if (run % 2) { finishScene(g, c); finishScene(g, c); assert.equal(g.phase, 'aim'); assert.deepEqual(g.view().chamber, { index: spun + 1, of: 6 }, 'the chamber the spin stopped on (not whether it is loaded)'); }
    const target = g.roster.get(g.holder);
    g.skip();
    assert.equal(g.result.chamber, spun + 1);
    assert.equal(g.result.outcome, target.cyl.includes(spun) ? 'out' : 'empty');
  }
  // during the revolver scene: the pending outcome is the one revealed
  const { g, c } = make(4);
  g.draw(); finishScene(g, c); finishScene(g, c);
  const pending = { ...g.pending };
  g.skip();
  assert.equal(g.result.outcome, pending.out ? 'out' : 'empty'); assert.equal(g.result.chamber, pending.chamber + 1);
  // skipping the grid, or the choice, does nothing
  const idle = make(4).g; assert.equal(idle.skip().phase, 'ready');
  const ch = make(4, { targetMode: 'choose' }); ch.g.draw(); finishScene(ch.g, ch.c); finishScene(ch.g, ch.c);
  assert.equal(ch.g.phase, 'choose'); assert.equal(ch.g.skip().phase, 'choose', 'the holder still chooses');
});

test('«يختاره صاحب الدور»: only the holder\'s message counts, only another player still in', () => {
  const { g, c } = make(6, { targetMode: 'choose', chooseSeconds: 20 });
  g.draw(); finishScene(g, c); finishScene(g, c);
  const v = g.view();
  assert.equal(v.phase, 'choose'); assert.equal(v.endsAt - v.phaseStartedAt, 20_000);
  const h = g.roster.get(g.holder), other = g.alive.find((p) => p.id !== h.id), third = g.alive.find((p) => p.id !== h.id && p.id !== other.id);
  assert.equal(g.input(other.id, String(third.number)), false, 'another viewer cannot choose');
  assert.equal(g.input(h.id, String(h.number)), false, 'not themselves');
  assert.equal(g.input(h.id, '99'), false, 'not a number nobody has');
  assert.equal(g.input(h.id, 'هههه'), false, 'ordinary chat is ignored');
  assert.equal(g.phase, 'choose');
  const arabic = String(other.number).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
  assert.equal(g.input(h.id, 'رقم ' + arabic), true);
  assert.equal(g.phase, 'aim'); assert.equal(g.target, other.id); assert.equal(g.how, 'chat');
  assert.equal(g.view().target.number, other.number);
  assert.equal(g.input(h.id, String(third.number)), false, 'one choice per turn');
});

test('the holder does not choose in time: the announced rule decides (self, random target, or the turn is cancelled)', () => {
  const self = make(5, { targetMode: 'choose', timeoutRule: 'self' });
  self.g.draw(); finishScene(self.g, self.c); finishScene(self.g, self.c); finishScene(self.g, self.c);
  assert.equal(self.g.phase, 'aim'); assert.equal(self.g.target, self.g.holder); assert.equal(self.g.how, 'timeout');
  for (let run = 0; run < 20; run++) {
    const r = make(5, { targetMode: 'choose', timeoutRule: 'random' });
    r.g.draw(); finishScene(r.g, r.c); finishScene(r.g, r.c); finishScene(r.g, r.c);
    assert.equal(r.g.phase, 'aim'); assert.notEqual(r.g.target, r.g.holder); assert.ok(r.g.roster.get(r.g.target).alive);
  }
  const skip = make(5, { targetMode: 'choose', timeoutRule: 'skip' });
  skip.g.draw(); finishScene(skip.g, skip.c); finishScene(skip.g, skip.c); finishScene(skip.g, skip.c);
  assert.equal(skip.g.phase, 'reveal'); assert.equal(skip.g.view().result.outcome, 'cancel'); assert.equal(skip.g.view().result.reason, 'timeout');
  assert.ok([...skip.g.roster.values()].every((p) => p.shots === 0 && p.alive), 'nobody was shot');
  finishScene(skip.g, skip.c); assert.equal(skip.g.phase, 'ready');
  assert.equal(skip.events.at(-1).outcome, 'cancel');
});

test('the host\'s buttons: choose when holding the turn, random target, cancel the turn, eliminate the holder', () => {
  const players = people(5, { 0: { host: true } });
  // the host plays («السماح للمضيف بالمشاركة») and holds the turn
  const { g, c } = make(5, { players, targetMode: 'choose', hostPlays: true });
  assert.equal(g.roster.size, 5);
  let guard = 0;
  while (guard++ < 50) { g.draw(); finishScene(g, c); finishScene(g, c); if (g.holder === 'p1') break; g.command('cancel'); finishScene(g, c); }
  assert.equal(g.holder, 'p1');
  assert.throws(() => g.command('pick', { number: 3 }, { hostId: 'p2' }), /الدور ليس لك/);
  assert.throws(() => g.command('pick', { number: 1 }, { hostId: 'p1' }), (e) => e.status === 400);
  assert.deepEqual(g.command('pick', { number: 3 }, { hostId: 'p1' }), { target: 3 });
  assert.equal(g.how, 'host');
  // the host does not play by default
  assert.equal(make(5, { players }).g.roster.size, 4, 'the host seat is not in the match');
  // random target
  const r = make(5, { targetMode: 'choose' });
  assert.throws(() => r.g.command('random'), /ليس وقت اختيار الهدف/);
  r.g.draw(); finishScene(r.g, r.c); finishScene(r.g, r.c);
  const t = r.g.command('random');
  assert.ok(t.target && t.target !== r.g.roster.get(r.g.holder).number); assert.equal(r.g.phase, 'aim'); assert.equal(r.g.how, 'random');
  // cancel the turn (only before the revolver scene)
  const k = make(5); k.g.draw();
  assert.throws(() => k.g.command('cancel'), /لا يوجد دور يمكن إلغاؤه/, 'not during the reel');
  finishScene(k.g, k.c); assert.deepEqual(k.g.command('cancel'), { cancelled: true });
  assert.equal(k.g.view().result.outcome, 'cancel'); assert.equal(k.g.view().result.reason, 'host');
  // eliminate the holder (a viewer who left, for example): no chamber is used
  const o = make(5); o.g.draw(); finishScene(o.g, o.c);
  const holder = o.g.roster.get(o.g.holder);
  assert.deepEqual(o.g.command('out-holder'), { out: holder.number });
  assert.equal(holder.alive, false); assert.equal(holder.shots, 0);
  assert.deepEqual({ outcome: o.g.view().result.outcome, reason: o.g.view().result.reason, chamber: o.g.view().result.chamber }, { outcome: 'out', reason: 'host', chamber: null });
  assert.equal(o.events.at(-1).reason, 'host');
  assert.throws(() => o.g.command('fly'), (e) => e.status === 400);
  // after the end, nothing
  const f = make(2); while (!f.g.finished) playTurn(f.g, f.c);
  for (const cmd of ['draw', 'random', 'cancel', 'out-holder']) assert.throws(() => f.g.command(cmd), (e) => e.status === 409, cmd);
});

test('«وضع التجربة»: trial players choose their target by themselves; a real viewer never does', () => {
  const players = Array.from({ length: 4 }, (_, i) => ({ id: 'demo:bot-' + (i + 1), name: 'تجربة ' + (i + 1), number: i + 1 }));
  const { g, c } = make(4, { players, targetMode: 'choose', chooseSeconds: 45, demo: true });
  g.draw(); finishScene(g, c); finishScene(g, c);
  assert.equal(g.phase, 'choose');
  assert.ok(g.botAt >= c.now() + 1800 && g.botAt <= c.now() + 1800 + 3400);
  c.add(g.botAt - c.now()); g.tick();
  assert.equal(g.phase, 'aim'); assert.notEqual(g.target, g.holder); assert.equal(g.view().demo, true);
  const real = make(4, { targetMode: 'choose', chooseSeconds: 45 });
  real.g.draw(); finishScene(real.g, real.c); finishScene(real.g, real.c);
  assert.equal(real.g.botAt, null); real.c.add(10_000); real.g.tick(); assert.equal(real.g.phase, 'choose', 'waits for the viewer');
});

test('«تلقائي»: the next turn starts by itself only while the host\'s window is open', () => {
  let here = true;
  const { g, c } = make(6, { autoRun: 'auto', hostPresent: () => here });
  assert.equal(g.endsAt - g.phaseStartedAt, AUTO_GAP_MS);
  finishScene(g, c); assert.equal(g.phase, 'drawing', 'started by the server');
  while (g.phase !== 'ready') finishScene(g, c);
  here = false;
  finishScene(g, c);
  assert.equal(g.phase, 'ready'); assert.equal(g.view().waitingHost, true, 'the match waits, exactly where it is');
  c.add(5000); g.tick(); assert.equal(g.phase, 'ready');
  here = true; c.add(1000); g.tick();
  assert.equal(g.phase, 'drawing'); assert.equal(g.view().waitingHost, false);
});

test('the winner: the last player standing; ranking by survival; the match stats; then nothing moves', () => {
  const { g, c, events } = make(8);
  while (!g.finished) playTurn(g, c);
  assert.equal(g.alive.length, 1);
  const v = g.view();
  assert.equal(v.phase, 'finished'); assert.equal(v.winner.id, g.alive[0].id); assert.equal(v.winner.number, g.alive[0].number);
  assert.equal(v.stats.out, 7); assert.equal(v.stats.players, 8); assert.equal(v.stats.turns, v.stats.pulls);
  assert.equal(v.stats.empty + v.stats.out, v.stats.pulls); assert.ok(v.stats.durationMs > 0);
  assert.equal(g.rankings[0].id, v.winner.id); assert.equal(g.rankings.length, 8);
  const outTurns = g.rankings.slice(1).map((r) => g.roster.get(r.id).eliminatedTurn);
  assert.deepEqual(outTurns, [...outTurns].sort((a, b) => b - a), 'the later you went out, the higher you rank');
  assert.equal(events.at(-1).type, 'finish'); assert.equal(events.at(-1).winner.id, v.winner.id); assert.equal(events.filter((e) => e.type === 'turn').length, v.stats.turns);
  assert.equal(g.tick(), false); assert.throws(() => g.draw(), /انتهت المباراة/);
  // stopped by the host before the end: no winner
  const s = make(5); s.g.draw(); s.g.end('manual');
  assert.equal(s.g.view().winner, null); assert.equal(s.events.at(-1).winner, null);
});

test('simulation: thousands of matches with every rule set end with one winner, fair draws and the announced odds', () => {
  const rnd = (list) => list[randomInt(list.length)];
  let matches = 0, firstPulls = 0, firstOut = 0, spinPulls = 0, spinOut = 0;
  for (let m = 0; m < 2500; m++) {
    const chambers = rnd(ROULETTE_RULES.chambers), bullets = Math.min(rnd(ROULETTE_RULES.bullets), chambers - 1);
    const opts = { chambers, bullets, cylinder: rnd(ROULETTE_RULES.cylinder), targetMode: rnd(ROULETTE_RULES.targetMode), timeoutRule: rnd(ROULETTE_RULES.timeoutRule), drawSpeed: rnd(ROULETTE_RULES.drawSpeed) };
    const n = 2 + randomInt(m % 10 === 0 ? 60 : 14);
    const { g, c, events } = make(n, opts);
    let last = null, turns = 0;
    while (!g.finished) {
      assert.ok(++turns < 5000, 'a match always ends');
      g.draw();
      const h = g.roster.get(g.holder);
      assert.ok(h.alive); if (g.alive.length > 1) assert.notEqual(h.id, last, 'never twice in a row');
      last = h.id;
      finishScene(g, c); finishScene(g, c);
      if (g.phase === 'choose') {
        const roll = randomInt(10);
        if (roll < 6) { const o = g.alive.filter((p) => p.id !== h.id); g.input(h.id, String(o[randomInt(o.length)].number)); }
        else if (roll < 7) g.command('random');
        else if (roll < 8) g.command('cancel');
        else finishScene(g, c); // the holder lets the time run out
      }
      if (g.phase === 'aim') {
        const t = g.roster.get(g.target);
        if (opts.cylinder === 'advance' && t.shots === 0) { firstPulls++; if (g.pending.out) firstOut += 1 / (bullets / chambers); }
        if (opts.cylinder === 'spin') { spinPulls++; if (g.pending.out) spinOut += 1 / (bullets / chambers); }
        if (randomInt(3) === 0) g.skip(); else finishScene(g, c);
      }
      while (!g.finished && g.phase !== 'ready') finishScene(g, c);
    }
    assert.equal(g.alive.length, 1, 'exactly one winner');
    assert.equal(events.filter((e) => e.type === 'turn' && e.outcome === 'out').length, n - 1, 'everyone else went out once');
    assert.equal(events.filter((e) => e.type === 'finish').length, 1);
    for (const p of g.roster.values()) if (opts.cylinder === 'advance') assert.ok(p.shots <= chambers);
    matches++;
  }
  assert.equal(matches, 2500);
  // first pull on a fresh cylinder, and every spun pull: out with probability bullets/chambers (scaled to 1 here)
  assert.ok(Math.abs(firstOut / firstPulls - 1) < 0.08, 'first pulls: ' + (firstOut / firstPulls).toFixed(3));
  assert.ok(Math.abs(spinOut / spinPulls - 1) < 0.08, 'spun pulls: ' + (spinOut / spinPulls).toFixed(3));
});

test('simulation: who holds the turn is uniform across players over many matches', () => {
  const counts = new Array(10).fill(0);
  for (let m = 0; m < 3000; m++) { const { g } = make(10, { targetMode: 'choose' }); counts[g.nextHolder().number - 1]++; }
  for (const k of counts) assert.ok(Math.abs(k / 300 - 1) < 0.25, 'first holder share: ' + counts.join(','));
});

/* ---------------- the engine: a real lobby, chat, host commands, results ---------------- */
function rouletteRoom(opts = {}) {
  let t = 50_000;
  const events = [];
  const e = new Engine({ now: () => t, random: randomInt });
  e.partyExtras = (mode) => (mode === 'roulette' ? { onEvent: (x) => events.push(x), hostPresent: () => true } : null);
  e.configure({ mode: 'roulette', title: 'الروليت' });
  applySettings(e, 'roulette', { ...defaultSettings('roulette'), ...opts });
  e.openRegistration({ keyword: 'انضم' });
  return { e, events, add: (ms) => { t += ms; e.tick(); }, chat: (id, text) => e.receiveChat({ id, username: 'مشاهد ' + id, text }) };
}
test('the engine: viewers join from the chat, the host draws, the holder chooses from the chat, the winner is announced', () => {
  const { e, events, add, chat } = rouletteRoom({ targetMode: 'choose' });
  for (const id of ['a', 'b', 'c', 'd', 'a']) chat(id, 'انضم');
  assert.equal(e.players.size, 4, 'no duplicate participants');
  e.start();
  assert.equal(e.snapshot().party.phase, 'ready');
  assert.throws(() => e.rouletteCommand('pick', { number: 2 }), /ليس وقت اختيار الهدف/);
  assert.deepEqual(e.rouletteCommand('draw', { requestId: 'req-000001' }), { turn: 1 });
  assert.deepEqual(e.rouletteCommand('draw', { requestId: 'req-000001' }), { duplicate: true, turn: 1 });
  let guard = 0;
  while (e.status.active && guard++ < 300) {
    const v = e.snapshot().party;
    if (v.phase === 'ready') e.rouletteCommand('draw', {});
    else if (v.phase === 'choose') { const holder = [...e.players.values()].find((p) => p.number === v.holder.number); const other = v.players.find((p) => p.a && p.n !== v.holder.number); chat(holder.id, String(other.n)); add(10); }
    else add((v.endsAt ?? e.now()) - e.now() + 1);
  }
  assert.equal(e.status.active, false);
  const party = e.snapshot().party;
  assert.equal(party.phase, 'finished');
  assert.equal(e.status.winner.id, party.winner.id, 'the announced winner is the last player standing');
  assert.equal(e.status.results.rankings[0].id, party.winner.id);
  assert.ok(e.snapshot().leaderboard.length);
  assert.ok(events.some((x) => x.type === 'turn' && x.how === 'chat'), 'targets came from the chat');
  assert.throws(() => e.rouletteCommand('draw'), (x) => x.status === 409 && /ليست جارية/.test(x.message));
});
test('the engine: a match the host ends early has no winner; the host seat does not play unless allowed', () => {
  const { e, chat } = rouletteRoom();
  for (const id of ['a', 'b', 'c']) chat(id, 'انضم');
  e.addManualPlayer({ name: 'المضيف', host: true });
  e.start();
  assert.equal(e.snapshot().party.total, 3, 'the host watches');
  e.rouletteCommand('draw');
  e.stop();
  assert.equal(e.status.active, false); assert.equal(e.status.winner, null); assert.match(e.status.notice, /بدون فائز/);
  const played = rouletteRoom({ hostPlays: true });
  for (const id of ['a', 'b']) played.chat(id, 'انضم');
  played.e.addManualPlayer({ name: 'المضيف', host: true });
  played.e.start();
  assert.equal(played.e.snapshot().party.total, 3, 'the host plays under the same rules');
});

/* ---------------- the recorder (PostgreSQL) ---------------- */
const dbUrl = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/visual';
let pool = null;
try { const p = new pg.Pool({ connectionString: dbUrl, max: 2, connectionTimeoutMillis: 2000 }); await p.query('select 1'); pool = p; } catch {}
test('every match, every turn and the winner are saved — in order, never twice', { skip: !pool ? 'no PostgreSQL' : false }, async () => {
  await migrate(pool, { log: () => {} });
  const store = new RouletteStore(pool);
  const room = { id: 'test-room-' + randomInt(1e9), ownerId: null };
  const { g, c } = make(6, { onEvent: (e) => store.record(room, e) });
  while (!g.finished) playTurn(g, c);
  await store.flush();
  const [m] = await store.recent(room.id, 5);
  assert.equal(m.id, g.matchId); assert.equal(m.demo, false); assert.equal(m.rules.chambers, 2); assert.equal(m.players.length, 6);
  assert.equal(m.winner.id, g.alive[0].id); assert.equal(m.stats.out, 5); assert.ok(m.ended_at >= m.started_at);
  assert.equal(m.turns.length, g.stats.turns); assert.deepEqual(m.turns.map((t) => t.turn), m.turns.map((_, i) => i + 1));
  assert.equal(m.turns.filter((t) => t.outcome === 'out').length, 5);
  // the same event twice (a retried write) changes nothing
  store.record(room, { type: 'turn', match: g.matchId, turn: 1, holder: { id: 'x', name: 'x', number: 1 }, outcome: 'out', at: Date.now() });
  store.record(room, { type: 'finish', match: g.matchId, reason: 'manual', winner: null, stats: {} });
  await store.flush();
  const [again] = await store.recent(room.id, 1);
  assert.equal(again.turns.length, m.turns.length); assert.equal(again.winner.id, m.winner.id, 'a finished match is never rewritten');
  // a failing database never stops the game
  const broken = new RouletteStore({ query: async () => { throw new Error('db down'); } });
  const warn = console.warn; console.warn = () => {};
  try { const b = make(3, { onEvent: (e) => broken.record(room, e) }); while (!b.g.finished) playTurn(b.g, b.c); await broken.flush(); assert.ok(broken.failures > 0); assert.ok(b.g.finished); }
  finally { console.warn = warn; }
  await pool.query('DELETE FROM roulette_matches WHERE room=$1', [room.id]);
  await pool.end();
});
