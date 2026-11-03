import test from 'node:test';
import assert from 'node:assert/strict';
import { BombGame, parsePassCommand, BOMB_TRANSITION_MS } from '../src/bomb.mjs';
import { Engine } from '../src/engine.mjs';

// ---------- helpers: virtual clock + deterministic randomness ----------
function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t, advance: ms => { c.t += ms; } };
  return c;
}
function seeded(seed = 7) { // mulberry32
  let a = seed >>> 0;
  return n => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return Math.floor(((t ^ t >>> 14) >>> 0) / 4294967296 * n); };
}
const players = numbers => numbers.map(n => ({ id: 'tt:' + n, number: n, name: 'لاعب ' + n }));
function game({ numbers = [43, 3, 6, 12, 25, 8], pick = null, seed = 1, autoBots = false } = {}) {
  const c = clock();
  const rnd = seeded(seed);
  const g = new BombGame({ now: c.now, random: n => pick !== null && pick.length ? pick.shift() % n : rnd(n) });
  g.configure({ autoBots });
  g.start(players(numbers));
  return { g, c };
}
const holderNumber = g => g.snapshot().holder?.number;

// ---------- 1–15: core rules ----------
test('1. match start picks a valid random holder from the alive players', () => {
  const { g } = game({ pick: [0] });
  assert.equal(g.phase, 'armed');
  assert.equal(holderNumber(g), 43);
  const other = game({ pick: [4] }).g;
  assert.equal(holderNumber(other), 25);
  for (let seed = 1; seed < 60; seed++) {
    const s = game({ seed }).g;
    assert.ok(s.alive.includes(s.holder));
  }
});

test('2. each turn counts down from exactly 15 seconds', () => {
  const { g, c } = game();
  assert.equal(g.seconds, 15);
  assert.equal(g.endsAt - c.t, 15000);
  assert.equal(g.snapshot().remainingMs, 15000);
});

test('3. passing never resets or extends the shared timer', () => {
  const { g, c } = game({ pick: [0] });
  const deadline = g.endsAt;
  c.advance(5000);
  assert.ok(g.pass('tt:43', 3).ok);
  assert.equal(g.endsAt, deadline);
  assert.equal(g.snapshot().remainingMs, 10000);
  c.advance(4000);
  assert.ok(g.pass('tt:3', 12).ok);
  assert.equal(g.endsAt, deadline);
  assert.equal(g.snapshot().remainingMs, 6000);
});

test('4–7. the worked example: 43→3→12→6, bomb explodes on 6 only', () => {
  const { g, c } = game({ pick: [0] }); // 43 starts with the bomb at 15s
  c.advance(5000); assert.ok(g.pass('tt:43', 3).ok);   // at 10s
  c.advance(4000); assert.ok(g.pass('tt:3', 12).ok);   // at 6s
  c.advance(3000); assert.ok(g.pass('tt:12', 6).ok);   // at 3s
  assert.equal(holderNumber(g), 6);
  c.advance(2999); g.tick();
  assert.equal(g.phase, 'armed', '1 ms before zero the bomb has not exploded');
  c.advance(1); g.tick();                               // 0s
  assert.equal(g.phase, 'exploded');
  assert.deepEqual(g.snapshot().eliminated.map(p => p.number), [6], 'only the holder at zero is eliminated');
  for (const n of [43, 3, 12, 25, 8]) assert.ok(g.alive.includes('tt:' + n), 'earlier passers survive: ' + n);
  assert.deepEqual(g.snapshot().passes.map(p => [p.from.number, p.to.number]), [[12, 6], [3, 12], [43, 3]]);
});

test('8. cannot pass to an eliminated player', () => {
  const { g, c } = game({ pick: [2, 0] }); // 6 holds, then 43 after the explosion
  c.advance(15000); g.tick();               // 6 eliminated
  c.advance(BOMB_TRANSITION_MS); g.tick();
  assert.equal(holderNumber(g), 43);
  const r = g.pass('tt:43', 6);
  assert.deepEqual(r, { ok: false, reason: 'eliminated' });
  assert.equal(holderNumber(g), 43);
});

test('9. cannot pass to yourself, to an unknown number, or when you are not the holder', () => {
  const { g } = game({ pick: [0] });
  assert.equal(g.pass('tt:43', 43).reason, 'self');
  assert.equal(g.pass('tt:43', 999).reason, 'unknown-target');
  assert.equal(g.pass('tt:3', 12).reason, 'not-holder');
  assert.equal(holderNumber(g), 43);
});

test('10. cannot pass after the explosion, including a pass that races the deadline', () => {
  const { g, c } = game({ pick: [0] });
  c.advance(15000); // deadline reached but no tick yet
  const raced = g.pass('tt:43', 3);
  assert.equal(raced.ok, false, 'the explosion wins over a simultaneous pass');
  assert.equal(g.phase, 'exploded');
  assert.equal(g.snapshot().eliminated[0].number, 43);
  assert.equal(g.pass('tt:43', 3).ok, false);
  assert.equal(g.pass('tt:3', 12).reason, 'not-armed', 'nobody can pass during the transition');
});

test('11–12. a new holder is drawn from survivors and gets a fresh 15 s timer', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { g, c } = game({ seed });
    const victim = g.holder;
    c.advance(15000); g.tick();
    c.advance(BOMB_TRANSITION_MS); g.tick();
    assert.equal(g.phase, 'armed');
    assert.equal(g.turn, 2);
    assert.notEqual(g.holder, victim);
    assert.ok(g.alive.includes(g.holder));
    assert.equal(g.endsAt - c.t, 15000);
  }
});

test('13. the match continues with two players and ends only when one remains', () => {
  const { g, c } = game({ numbers: [1, 2, 3] });
  for (let round = 1; round <= 2; round++) {
    assert.ok(g.running, 'still running with ' + g.alive.length + ' alive');
    c.advance(15000); g.tick();
    if (g.phase === 'exploded') { c.advance(BOMB_TRANSITION_MS); g.tick(); }
  }
  assert.equal(g.phase, 'finished');
  assert.equal(g.alive.length, 1);
  assert.equal(g.eliminated.length, 2);
});

test('14. the last survivor is declared the winner (engine awards and announces them)', () => {
  const c = clock(); const e = new Engine({ now: c.now, random: seeded(3) });
  e.configure({ mode: 'bomb' }); e.openRegistration({ keyword: 'انضم' });
  for (const n of ['أ', 'ب', 'ج']) e.receiveChat({ id: 'id-' + n, username: n, text: 'انضم' });
  e.start();
  while (e.status.active) { c.advance(500); e.tick(); }
  const b = e.snapshot().bomb;
  assert.equal(b.phase, 'finished');
  assert.equal(b.alive.length, 1);
  assert.deepEqual(b.winner, b.alive[0]);
  assert.equal(e.status.winner.number, b.winner.number);
  assert.equal(e.status.winner.name, b.winner.name);
  assert.equal(e.players.get('id-' + b.winner.name).score, 10);
  assert.match(e.status.notice, /الناجي الأخير/);
});

test('15. only one turn can run: repeated ticks explode once and start one next turn', () => {
  const { g, c } = game();
  c.advance(15000);
  for (let i = 0; i < 20; i++) g.tick();
  assert.equal(g.eliminated.length, 1);
  assert.equal(g.explosions.length, 1);
  c.advance(BOMB_TRANSITION_MS);
  for (let i = 0; i < 20; i++) g.tick();
  assert.equal(g.turn, 2);
  assert.throws(() => g.start(players([1, 2])), /جارية/);
});

// ---------- 18–20: concurrency, pause, restart ----------
test('18. simultaneous passes: only the real holder\'s first pass applies; stale turns are rejected', () => {
  const { g } = game({ pick: [0] });
  const a = g.pass('tt:43', 3);
  const b = g.pass('tt:43', 12);       // 43 no longer holds it
  assert.ok(a.ok); assert.equal(b.reason, 'not-holder');
  assert.equal(holderNumber(g), 3);
  assert.equal(g.pass('tt:3', 12, { expectedTurn: g.turn - 1 }).reason, 'stale-turn');
  assert.equal(g.pass('tt:3', 12, { expectedMatch: g.matchId + 1 }).reason, 'stale-turn');
  assert.equal(holderNumber(g), 3);
});

test('19. pause and resume keep the exact remaining time, including during the transition', () => {
  const { g, c } = game({ pick: [0] });
  c.advance(10000);
  g.pause();
  assert.equal(g.snapshot().remainingMs, 5000);
  assert.equal(g.pass('tt:43', 3).reason, 'not-armed', 'no passes while paused');
  c.advance(60000); g.tick();
  assert.equal(g.phase, 'paused', 'time does not run while paused');
  g.resume();
  assert.equal(g.endsAt - c.t, 5000);
  c.advance(5000); g.tick();
  assert.equal(g.phase, 'exploded');
  c.advance(1000); g.pause(); c.advance(30000); g.resume();
  c.advance(BOMB_TRANSITION_MS - 1001); g.tick(); assert.equal(g.phase, 'exploded');
  c.advance(1); g.tick(); assert.equal(g.phase, 'armed');
});

test('20. restarting a match leaves no stale events behind', () => {
  const c = clock(); const e = new Engine({ now: c.now, random: seeded(9) });
  e.configure({ mode: 'bomb' }); e.addDemoPlayers({ count: 5 }); e.bombSettings({ autoBots: false });
  e.start();
  const first = e.snapshot().bomb;
  const holder = first.alive.find(p => p.number !== first.holder.number);
  e.bombPass({ target: holder.number, turn: first.turn, match: first.matchId });
  c.advance(15000); e.tick();
  e.bombRestart();
  const fresh = e.snapshot().bomb;
  assert.equal(fresh.matchId, first.matchId + 1);
  assert.equal(fresh.turn, 1);
  assert.equal(fresh.phase, 'armed');
  assert.equal(fresh.alive.length, 5);
  assert.deepEqual(fresh.eliminated, []);
  assert.deepEqual(fresh.passes, []);
  assert.equal(fresh.explosion, null);
  const target = fresh.alive.find(p => p.number !== fresh.holder.number).number;
  assert.throws(() => e.bombPass({ target, turn: 1, match: first.matchId }), /انتهت هذه الدورة/);
  assert.equal(e.snapshot().bomb.holder.number, fresh.holder.number);
});

// ---------- chat integration and identity ----------
function liveEngine(seed = 5) {
  const c = clock(); const e = new Engine({ now: c.now, random: seeded(seed) });
  e.configure({ mode: 'bomb' }); e.openRegistration({ keyword: 'انضم' });
  for (const [id, name] of [['u1', 'نورة'], ['u2', 'فهد'], ['u3', 'ريم'], ['u4', 'سلطان']]) e.receiveChat({ id, username: name, text: 'انضم' });
  e.start();
  const idOf = number => [...e.players.values()].find(p => p.number === number).id;
  return { e, c, idOf };
}
test('chat: "!مرر 43" / "!bomb 43" parse with Arabic-Indic digits; other chat is ignored', () => {
  assert.equal(parsePassCommand('!مرر 43'), 43);
  assert.equal(parsePassCommand('!bomb 43'), 43);
  assert.equal(parsePassCommand('مرر #٤٣'), 43);
  assert.equal(parsePassCommand('!PASS 7'), 7);
  assert.equal(parsePassCommand('مرر'), null);
  assert.equal(parsePassCommand('43'), null);
  assert.equal(parsePassCommand('!مرر 4 3'), null);
});
test('chat: the holder passes by number and the remaining time is untouched', () => {
  const { e, c, idOf } = liveEngine();
  const b0 = e.snapshot().bomb;
  const target = b0.alive.find(p => p.number !== b0.holder.number).number;
  c.advance(4000);
  e.receiveChat({ id: idOf(b0.holder.number), username: b0.holder.name, text: '!مرر ' + target });
  const b1 = e.snapshot().bomb;
  assert.equal(b1.holder.number, target);
  assert.equal(b1.endsAt, b0.endsAt);
  assert.equal(b1.passes[0].from.number, b0.holder.number);
});
test('chat: impersonating the holder by display name, or chatting as a non-holder, cannot move the bomb', () => {
  const { e, idOf } = liveEngine();
  const b0 = e.snapshot().bomb;
  const someoneElse = b0.alive.find(p => p.number !== b0.holder.number);
  const target = b0.alive.find(p => ![b0.holder.number, someoneElse.number].includes(p.number)).number;
  e.receiveChat({ id: 'attacker', username: b0.holder.name, text: '!مرر ' + target });          // unregistered, same name
  e.receiveChat({ id: idOf(someoneElse.number), username: b0.holder.name, text: '!bomb ' + target }); // registered non-holder
  assert.equal(e.snapshot().bomb.holder.number, b0.holder.number);
  assert.equal(e.snapshot().bomb.totalPasses, 0);
});
test('chat: nobody can join once the match has started, and eliminated players cannot act', () => {
  const { e, c, idOf } = liveEngine();
  e.receiveChat({ id: 'late', username: 'متأخر', text: 'انضم' });
  assert.equal(e.players.has('late'), false);
  assert.equal(e.snapshot().bomb.total, 4);
  assert.throws(() => e.openRegistration({}), /أنهِ الجولة/);
  const victim = e.snapshot().bomb.holder;
  c.advance(15000); e.tick();
  c.advance(BOMB_TRANSITION_MS); e.tick();
  const now = e.snapshot().bomb;
  const target = now.alive.find(p => p.number !== now.holder.number).number;
  e.receiveChat({ id: idOf(victim.number), username: victim.name, text: '!مرر ' + target });
  assert.equal(e.snapshot().bomb.holder.number, now.holder.number);
});
test('chat: rapid duplicate pass commands only move the bomb once', () => {
  const { e, idOf } = liveEngine();
  const b0 = e.snapshot().bomb;
  const target = b0.alive.find(p => p.number !== b0.holder.number).number;
  for (let i = 0; i < 10; i++) e.receiveChat({ id: idOf(b0.holder.number), username: b0.holder.name, text: '!مرر ' + target });
  assert.equal(e.snapshot().bomb.totalPasses, 1);
});
test('public bomb state never exposes TikTok account ids', () => {
  const { e } = liveEngine();
  const json = JSON.stringify(e.snapshot().bomb);
  for (const id of ['u1', 'u2', 'u3', 'u4']) assert.ok(!json.includes('"' + id + '"'));
});
test('admin controls: pause/resume/end are rejected without a running bomb match, settings validated', () => {
  const c = clock(); const e = new Engine({ now: c.now, random: seeded(1) });
  assert.throws(() => e.bombPause(), /لا توجد مباراة/);
  assert.throws(() => e.bombSettings({ seconds: 3 }), /من 5 إلى 60/);
  assert.deepEqual(e.bombSettings({ seconds: 20, sound: false }), { seconds: 20, sound: false, autoBots: true });
  e.configure({ mode: 'bomb' });
  e.openRegistration({}); e.receiveChat({ id: 'solo', username: 'وحيد', text: 'انضم' });
  assert.throws(() => e.start(), /لاعبَين/);
  assert.equal(e.status.active, false);
});
test('stopping a match manually ends it without a winner and frees the engine', () => {
  const { e } = liveEngine();
  e.stop();
  assert.equal(e.status.active, false);
  assert.equal(e.snapshot().bomb.phase, 'finished');
  assert.equal(e.snapshot().bomb.winner, null);
  assert.doesNotThrow(() => e.openRegistration({}));
});
test('demo bots pass on their own during test mode, never to themselves or eliminated players', () => {
  const c = clock(); const e = new Engine({ now: c.now, random: seeded(4) });
  e.configure({ mode: 'bomb' }); e.addDemoPlayers({ count: 6 }); e.start();
  let steps = 0;
  while (e.status.active && steps++ < 10000) { c.advance(100); e.tick(); }
  const b = e.snapshot().bomb;
  assert.equal(b.phase, 'finished');
  assert.ok(b.totalPasses > 0);
  for (const p of e.bomb.passes) assert.notEqual(p.from, p.to);
});

// ---------- simulations ----------
function simulate(size, seed) {
  const c = clock(); const rnd = seeded(seed);
  const g = new BombGame({ now: c.now, random: rnd });
  g.configure({ autoBots: false });
  g.start(players(Array.from({ length: size }, (_, i) => i + 1)));
  let steps = 0, explosions = 0, lastAlive = size;
  while (g.phase !== 'finished') {
    if (++steps > 200000) throw new Error('stalled: size ' + size + ' seed ' + seed);
    const action = rnd(10);
    if (g.phase === 'armed' && action < 6) {
      // valid or invalid passes from random senders to random targets
      const sender = rnd(4) ? g.holder : 'tt:' + (rnd(size) + 1);
      g.pass(sender, rnd(size + 2) + 1);
    } else if (action === 6 && g.phase !== 'paused' && rnd(20) === 0) { g.pause(); c.advance(rnd(5000)); g.resume(); }
    c.advance(rnd(2500));
    if (g.tick() && (g.phase === 'exploded' || g.phase === 'finished') && g.alive.length < lastAlive) {
      assert.equal(lastAlive - g.alive.length, 1, 'each explosion eliminates exactly one player');
      explosions++; lastAlive = g.alive.length;
    }
    assert.ok(g.holder === null || g.alive.includes(g.holder), 'holder is always alive');
  }
  assert.equal(g.alive.length, 1, 'exactly one winner');
  assert.equal(g.winner, g.alive[0]);
  assert.equal(g.eliminated.length, size - 1);
  assert.equal(new Set(g.eliminated.map(e => e.id)).size, size - 1, 'nobody eliminated twice');
  assert.equal(explosions, size - 1);
  assert.equal(g.turn, size - 1);
}
for (const [size, runs] of [[2, 400], [10, 300], [50, 120], [100, 60]]) {
  test(`simulation: ${runs} matches of ${size} players always end with one winner`, () => {
    for (let seed = 1; seed <= runs; seed++) simulate(size, seed * 31 + size);
  });
}
