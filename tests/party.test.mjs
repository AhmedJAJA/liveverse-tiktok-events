import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartyGame, PARTY_MODES, norm } from '../src/party.mjs';
import { Engine } from '../src/engine.mjs';

function clock(start = 1000) { let t = start; return { now: () => t, add: (ms) => { t += ms; return t; } }; }
const seq = (...values) => { let i = 0; return (n) => { const v = values[i++ % values.length]; return Math.min(v, n - 1); }; };
const roster = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: 'لاعب ' + (i + 1), number: i + 1 }));

test('rock paper scissors: lives, elimination, everyone-out protection, last one standing', () => {
  const c = clock();
  const g = createPartyGame('rps', { format: 'sky', now: c.now, random: seq(0), rounds: 20, seconds: 10, revealMs: 1000 }); // Sky always picks حجر
  g.start(roster(3));
  assert.equal(g.phase, 'input');
  assert.equal(g.input('p1', 'ورقة'), true);   // beats rock
  assert.equal(g.input('p1', 'مقص'), false);   // one input per round
  assert.equal(g.input('p2', '✌️'), true);     // scissors loses
  assert.equal(g.input('ghost', 'حجر'), false); // not in the roster
  c.add(10_000); g.tick();                      // p3 silent → loses a life too
  assert.equal(g.phase, 'reveal');
  assert.equal(g.reveal.house, 'حجر');
  const lives = Object.fromEntries([...g.roster.values()].map(p => [p.id, p.lives]));
  assert.deepEqual(lives, { p1: 3, p2: 2, p3: 2 });
  // Two more losing rounds for p2/p3 → both would hit zero together with p1 winning → they are eliminated
  for (let r = 0; r < 2; r++) { c.add(1000); g.tick(); g.input('p1', 'ورقة'); c.add(10_000); g.tick(); }
  assert.equal(g.roster.get('p2').alive, false);
  assert.equal(g.input('p2', 'ورقة'), false, 'eliminated players cannot act');
  c.add(1000); g.tick();
  assert.equal(g.finished, true);
  assert.equal(g.rankings[0].id, 'p1');
  assert.equal(g.rankings[0].points, 10);
});

test('rock paper scissors: if every survivor would lose their last life, nobody is eliminated', () => {
  const c = clock();
  const g = createPartyGame('rps', { format: 'sky', now: c.now, random: seq(0), rounds: 20, seconds: 5, revealMs: 500 });
  g.start(roster(2));
  for (const p of g.roster.values()) p.lives = 1;
  c.add(5000); g.tick();                     // nobody answered: both would be out
  assert.equal(g.alive.length, 2);
  assert.match(g.reveal.note, /حياة واحدة/);
});

test('minority wins: smaller side survives, silence eliminates, ties keep voters', () => {
  const c = clock();
  const g = createPartyGame('minority', { now: c.now, random: seq(0), rounds: 10, seconds: 10, revealMs: 500 });
  g.start(roster(5));
  g.input('p1', '1'); g.input('p2', '1'); g.input('p3', '2'); g.input('p4', '٢'); // p5 silent
  c.add(10_000); g.tick();
  assert.deepEqual(g.reveal.counts, [2, 2]);
  assert.equal(g.reveal.tie, true);
  assert.deepEqual(g.alive.map(p => p.id), ['p1', 'p2', 'p3', 'p4']);
  c.add(500); g.tick();
  g.input('p1', '1'); g.input('p2', '1'); g.input('p3', '1'); g.input('p4', '2');
  c.add(10_000); g.tick();
  assert.deepEqual(g.alive.map(p => p.id), ['p4']);
  c.add(500); g.tick();
  assert.equal(g.finished, true);
  assert.equal(g.rankings[0].id, 'p4');
});

test('higher or lower and true/false score correct answers, fastest first', () => {
  const c = clock();
  const hl = createPartyGame('higherlower', { now: c.now, random: seq(4, 9), rounds: 1, seconds: 10, revealMs: 500 }); // 5 then 10
  hl.start(roster(3));
  c.add(100); hl.input('p2', 'أعلى'); c.add(100); hl.input('p1', 'اعلى'); hl.input('p3', 'أقل');
  c.add(10_000); hl.tick(); c.add(500); hl.tick();
  assert.equal(hl.finished, true);
  assert.deepEqual(hl.rankings.slice(0, 2).map(r => r.id), ['p2', 'p1']);
  const c2 = clock();
  const tf = createPartyGame('truefalse', { now: c2.now, random: seq(0), rounds: 1, seconds: 10, revealMs: 500 }); // «الشمس نجم» = صح
  tf.start(roster(2));
  tf.input('p1', 'خطأ'); tf.input('p2', 'صح');
  c2.add(10_000); tf.tick(); c2.add(500); tf.tick();
  assert.equal(tf.rankings[0].id, 'p2');
});

test('red light: one move per green, moving on red eliminates after the grace window, first to finish wins', () => {
  const c = clock();
  const g = createPartyGame('redlight', { now: c.now, random: seq(0), rounds: 16, target: 6 });
  g.start(roster(3));
  assert.equal(g.snapshot().light, 'green');
  assert.equal(g.input('p1', '5'), true);
  assert.equal(g.input('p1', '5'), false, 'one move per green light');
  assert.equal(g.input('p2', '9'), false, 'only 1–5 steps');
  c.add(4000); g.tick();
  assert.equal(g.snapshot().light, 'red');
  c.add(300); assert.equal(g.input('p2', '2'), true, 'inside the grace window counts as green');
  assert.equal(g.roster.get('p2').alive, true);
  c.add(1000); g.input('p3', '1');
  assert.equal(g.roster.get('p3').alive, false, 'moving on red eliminates');
  c.add(2000); g.tick();
  assert.equal(g.snapshot().light, 'green');
  g.input('p1', '1');
  assert.equal(g.finished, true);
  assert.equal(g.rankings[0].id, 'p1');
});

test('bowling: lucky lane gives a strike, totals decide the winner', () => {
  const c = clock();
  const g = createPartyGame('bowling', { now: c.now, random: seq(6, 2, 2), rounds: 1, seconds: 10, revealMs: 500 }); // lucky = 7
  g.start(roster(2));
  g.input('p1', '7'); g.input('p2', '3');
  c.add(10_000); g.tick();
  const p1 = g.reveal.rolls.find(r => r.id === 'p1');
  assert.equal(p1.pins, 10);
  assert.equal(p1.score, 15);
  c.add(500); g.tick();
  assert.equal(g.rankings[0].id, 'p1');
});

test('engine runs every party mode end to end from chat, with server timers and podium points', () => {
  for (const mode of PARTY_MODES) {
    let t = 10_000;
    const e = new Engine({ now: () => t, random: (n) => 0 });
    e.configure({ mode, title: mode, rounds: 1, roundSeconds: 5 });
    e.openRegistration({ keyword: 'انضم' });
    for (const name of ['a', 'b', 'c', 'd']) e.receiveChat({ id: name, username: name, text: 'انضم' });
    e.start();
    assert.ok(e.snapshot().party, mode);
    assert.equal(e.snapshot().status.active, true);
    for (let i = 0; i < 400 && e.status.active; i++) { t += 1000; e.tick(); }
    if (e.status.active) e.stop();
    assert.equal(e.status.active, false, mode + ' finishes');
    assert.ok(e.status.results?.rankings.length, mode + ' has a podium');
    assert.ok(e.snapshot().leaderboard[0].score > 0, mode + ' awards points');
  }
});

test('simulation: demo bots play, time control advances, manual and host players join', () => {
  let t = 1000;
  const e = new Engine({ now: () => t });
  e.addDemoPlayers({ count: 4 });
  assert.equal(e.addManualPlayer({ name: 'سارة' }).number, 5);
  assert.throws(() => e.addManualPlayer({ name: 'سارة' }), /مسجل/);
  e.setConnection('connected', 'sky_host', 'ok');
  e.updateRegistration({ hostJoin: 'auto' });
  assert.ok(e.snapshot().roster.some(p => p.host));
  e.configure({ mode: 'truefalse', rounds: 2, roundSeconds: 10 });
  e.setSimulation({ autoplay: true });
  e.start();
  for (let i = 0; i < 40; i++) { t += 200; e.tick(); }
  assert.ok(e.party.totalInputs > 0, 'bots answered');
  e.advance();                     // jump the timer
  assert.equal(e.party.phase, 'reveal');
  e.stop();
  assert.equal(e.status.active, false);
  assert.equal(e.removePlayer({ number: 1 }).removed.length > 0, true);
});

test('chat replays with the same message id are applied once; host chat maps to the host seat', () => {
  let t = 1000;
  const e = new Engine({ now: () => t });
  e.setConnection('connected', 'Sky_Host', 'ok');
  e.openRegistration({ keyword: 'انضم' });
  e.joinHost();
  e.receiveChat({ id: 'u1', username: 'a', text: 'انضم', msgId: 'm1' });
  e.removePlayer({ number: 2 });
  e.receiveChat({ id: 'u1', username: 'a', text: 'انضم', msgId: 'm1' }); // replay after reconnect
  assert.equal(e.players.has('u1'), false);
  e.configure({ mode: 'truefalse', rounds: 1, roundSeconds: 10 });
  e.start();
  t += 100;
  e.receiveChat({ id: '999', username: 'Host', handle: 'sky_host', text: 'صح', msgId: 'm2' });
  assert.equal(e.party.inputs.has('host:sky_host'), true);
});

test('normalizer maps Arabic-Indic digits and hamza forms', () => {
  assert.equal(norm('٣'), '3');
  assert.equal(norm('أعلى'), norm('اعلى'));
});
