// «شد الحبل» and «برا السالفة»: rules, timers, private word page, and the engine wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartyGame, PARTY_MODES } from '../src/party.mjs';
import { Engine } from '../src/engine.mjs';
import { GAMES } from '../src/catalog.mjs';

const clock = () => { let t = 1_000_000; return { now: () => t, add: (ms) => (t += ms) }; };
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: 'لاعب ' + (i + 1), number: i + 1 }));

test('both games are in the catalogue and the party list', () => {
  for (const m of ['tug', 'outsider']) { assert.ok(PARTY_MODES.includes(m)); assert.ok(GAMES.some((g) => g.mode === m)); }
});

test('tug of war: balanced teams, «شد» pulls, spam guard, best of three', () => {
  const c = clock();
  const g = createPartyGame('tug', { now: c.now, random: () => 0 });
  g.start(players(4));
  const v = g.snapshot();
  assert.deepEqual(v.teams.map((t) => t.size), [2, 2]);
  assert.equal(g.input('p1', 'شد'), true);
  assert.equal(g.input('p1', 'شد'), false, 'one pull every 0.6 s');
  assert.equal(g.input('p2', 'hello'), false, 'only the pull word counts');
  c.add(700); assert.equal(g.input('p1', '!شد'), true);
  // blue (odd numbers) pulls the rope across its line → the pull ends early
  for (let i = 0; i < 40; i++) { c.add(650); g.input('p1', 'شد'); g.input('p3', 'شد'); }
  assert.ok(g.snapshot().rope <= -40 + 1);
  c.add(10); g.tick(); assert.equal(g.phase, 'reveal'); assert.equal(g.reveal.team, 'الأزرق');
  c.add(5000); g.tick(); assert.equal(g.round, 2);
  for (let i = 0; i < 40; i++) { c.add(650); g.input('p1', 'شد'); }
  c.add(41_000); g.tick(); c.add(5000); g.tick();
  assert.equal(g.finished, true, 'two pulls of three decide it');
  assert.deepEqual(g.rankings.slice(0, 2).map((r) => r.id).sort(), ['p1', 'p3']);
  assert.match(g.summary(), /الأزرق 2–0/);
});

test('برا السالفة: private word, outsider hidden, vote, last-chance guess', () => {
  const c = clock();
  const g = createPartyGame('outsider', { now: c.now, random: () => 0 });
  g.start(players(4));
  const out = g.outsiderId;
  assert.equal(g.phase, 'assign');
  assert.equal(g.snapshot().outsider, null, 'the public screen never names the outsider early');
  assert.equal(g.snapshot().word, null);
  // each player links a private page with a one-time code typed in chat
  const pages = {};
  for (const p of players(4)) { const { code, token } = g.claim(); assert.equal(g.input(p.id, 'دوري ' + code), true); pages[p.id] = token; }
  const insider = players(4).find((p) => p.id !== out).id;
  assert.equal(g.privateView(pages[insider]).word, g.word);
  assert.equal(g.privateView(pages[out]).word, undefined, 'the outsider does not get the word');
  assert.equal(g.privateView(pages[out]).role, 'outsider');
  assert.equal(g.privateView('forged').linked, false);
  c.add(40_000); g.tick(); assert.equal(g.phase, 'talk');
  c.add(75_000); g.tick(); assert.equal(g.phase, 'vote');
  const outNumber = players(4).find((p) => p.id === out).number;
  for (const p of players(4)) if (p.id !== out) assert.equal(g.input(p.id, 'صوت ' + outNumber), true);
  assert.equal(g.input(out, 'صوت ' + outNumber), false, 'nobody votes for themselves');
  c.add(25_000); g.tick();
  assert.equal(g.phase, 'reveal'); assert.equal(g.reveal.caught, true);
  c.add(6000); g.tick(); assert.equal(g.phase, 'guess');
  assert.equal(g.input(insider, g.word), false, 'only the outsider guesses');
  assert.equal(g.input(out, 'شي غلط'), true);
  g.tick();
  assert.equal(g.finished, true); assert.equal(g.winner, 'insiders');
  assert.notEqual(g.rankings[0].id, out);
  assert.equal(g.snapshot().word, g.word, 'the word is shown at the end');
});

test('برا السالفة: the outsider wins by naming the word, or when the vote misses', () => {
  for (const right of [true, false]) {
    const c = clock();
    const g = createPartyGame('outsider', { now: c.now, random: () => 0 });
    g.start(players(3));
    const out = g.outsiderId, innocent = players(3).find((p) => p.id !== out);
    c.add(40_000); g.tick(); c.add(75_000); g.tick();
    for (const p of players(3)) g.input(p.id, 'صوت ' + (right ? players(3).find((x) => x.id === out).number : (p.id === innocent.id ? players(3).find((x) => x.id !== innocent.id && x.id !== out).number : innocent.number)));
    c.add(25_000); g.tick(); c.add(6000); g.tick();
    if (right) { g.input(out, g.word); g.tick(); }
    assert.equal(g.winner, 'outsider');
    assert.equal(g.rankings[0].id, out);
  }
});

test('engine: the private page serves «برا السالفة» and its host view', () => {
  const e = new Engine({ notify() {} });
  e.configure({ mode: 'outsider', title: 'برا السالفة' });
  e.openRegistration({ keyword: 'انضم' });
  for (const p of players(3)) e.receiveChat({ id: p.id, username: p.name, text: 'انضم' });
  e.start();
  assert.equal(e.status.active, true, JSON.stringify(e.status.notice));
  const { code, token } = e.rolesClaim();
  e.receiveChat({ id: 'p1', username: 'لاعب 1', text: 'دوري ' + code });
  const page = e.rolesPrivate(token);
  assert.equal(page.game, 'outsider'); assert.equal(page.linked, true); assert.ok(page.category);
  const host = e.rolesAdmin();
  assert.ok(host.word && host.outsider);
});
