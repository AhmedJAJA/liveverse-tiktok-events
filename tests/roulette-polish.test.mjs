// «الروليت» P1 — the match reads like a story: who eliminated whom (the kill feed and the winner's screen), a short
// lock-in beat after the choice (shooter → target, on every screen at the same moment), and an optional rule that
// protects the previous turn's target so one viewer cannot be hunted turn after turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { createPartyGame } from '../src/party.mjs';
import { ROULETTE_RULES, ROULETTE_DEFAULTS, SPEED, LOCK_MS } from '../src/roulette.mjs';
import { GAME_SETTINGS, defaultSettings, validateSettings } from '../src/game-settings.mjs';

function clock(start = 1_000_000) { let t = start; return { now: () => t, add: (ms) => { t += ms; } }; }
const people = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: 'لاعب ' + (i + 1), number: i + 1 }));
function make(n, opts = {}) { const c = clock(); const g = createPartyGame('roulette', { now: c.now, random: (m) => randomInt(m), ...opts }); g.start(opts.players || people(n)); return { g, c }; }
const finishScene = (g, c) => { if (g.endsAt != null) c.add(Math.max(0, g.endsAt - c.now())); return g.tick(); };
function toChoose(g, c) { g.draw(); finishScene(g, c); finishScene(g, c); assert.equal(g.phase, 'choose'); return g.roster.get(g.holder); }
/** Load every cylinder so the next pull on anyone fires (the outcome is then known in advance). */
const allLoaded = (g) => { for (const p of g.roster.values()) p.cyl = [p.shots]; };
const allEmpty = (g) => { for (const p of g.roster.values()) p.cyl = []; };

/* ---------------- the lock-in beat ---------------- */
test('after the choice, a lock-in beat on the server clock, then the revolver scene; skipping still jumps to the result', () => {
  assert.ok(LOCK_MS >= 800 && LOCK_MS <= 2000);
  const { g, c } = make(5);
  const h = toChoose(g, c);
  const t = g.alive.find((p) => p.id !== h.id);
  g.input(h.id, String(t.number));
  const v = g.view();
  assert.equal(v.phase, 'aim'); assert.equal(v.lockMs, LOCK_MS, 'every screen knows how long the lock-in lasts');
  assert.equal(v.endsAt - v.phaseStartedAt, SPEED.normal.aim + LOCK_MS, 'the revolver keeps its full scene after the lock-in');
  assert.equal(g.skip().phase, 'reveal');
  // the timeout and the host's random target lock in the same way
  const r = make(5); toChoose(r.g, r.c); finishScene(r.g, r.c);
  assert.equal(r.g.how, 'timeout'); assert.equal(r.g.view().lockMs, LOCK_MS);
  assert.equal(make(4).g.view().lockMs, null, 'nothing to lock in outside the revolver scene');
});

/* ---------------- who eliminated whom ---------------- */
test('the kill feed: every elimination says who pulled the trigger, and how the target was chosen', () => {
  const { g, c } = make(5);
  const h = toChoose(g, c); allLoaded(g);
  const t = g.alive.find((p) => p.id !== h.id);
  g.input(h.id, String(t.number)); finishScene(g, c);
  const v = g.view();
  assert.equal(v.result.outcome, 'out');
  const e = v.log.at(-1);
  assert.deepEqual({ kind: e.kind, holder: e.holder, target: e.target, how: e.how }, { kind: 'out', holder: h.number, target: t.number, how: 'chat' });
  const row = v.players.find((p) => p.n === t.number);
  assert.equal(row.a, 0); assert.equal(row.b, h.number, 'the eliminated player shows who eliminated them');
  assert.equal(v.players.find((p) => p.n === h.number).k, 1, 'the shooter counts one elimination');
  // a timeout pick is not a kill by the holder: the server chose
  const r = make(5); const rh = toChoose(r.g, r.c); allLoaded(r.g); finishScene(r.g, r.c); finishScene(r.g, r.c);
  const rv = r.g.view();
  assert.equal(rv.log.at(-1).how, 'timeout');
  assert.equal(rv.players.find((p) => p.n === rh.number).k || 0, 0);
  assert.equal(rv.players.find((p) => !p.a).b, null, 'eliminated by the server\'s choice, not by the holder');
});

test('the winner\'s screen data: eliminations per player, the winner\'s count, nothing secret', () => {
  const { g, c } = make(4);
  let guard = 0;
  while (!g.finished && guard++ < 200) {
    if (g.phase === 'ready') g.draw();
    else if (g.phase === 'choose') { const h = g.roster.get(g.holder); g.input(h.id, String(g.alive.find((p) => p.id !== h.id).number)); }
    else finishScene(g, c);
  }
  const v = g.view();
  assert.ok(v.winner); assert.equal(typeof v.winner.kills, 'number');
  const kills = v.players.reduce((s, p) => s + (p.k || 0), 0);
  assert.equal(kills, v.players.filter((p) => !p.a).length, 'every elimination was by a holder\'s choice in this match');
  assert.equal(v.players.find((p) => p.n === v.winner.number).k || 0, v.winner.kills);
  assert.doesNotMatch(JSON.stringify(v), /"cyl"|"pending"/);
});

/* ---------------- the optional «protect the last target» rule ---------------- */
test('the settings page offers «استهداف هدف الدور السابق»: allowed by default, or blocked for one turn', () => {
  assert.deepEqual(ROULETTE_RULES.repeatTarget, ['allow', 'block']);
  assert.equal(ROULETTE_DEFAULTS.repeatTarget, 'allow');
  const f = GAME_SETTINGS.roulette.find((x) => x.key === 'repeatTarget');
  assert.ok(f && f.group === 'rules'); assert.equal(defaultSettings('roulette').repeatTarget, 'allow');
  assert.equal(validateSettings('roulette', { repeatTarget: 'block' }).repeatTarget, 'block');
  assert.throws(() => validateSettings('roulette', { repeatTarget: 'maybe' }), /قيمة غير صالحة/);
});

test('«ممنوع»: the previous turn\'s target cannot be chosen again at once — by the holder, the timeout, or the host\'s random', () => {
  for (let run = 0; run < 25; run++) {
    const { g, c } = make(5, { repeatTarget: 'block' });
    const h1 = toChoose(g, c); allEmpty(g); // everybody survives: the protected player is still in
    const t1 = g.alive.find((p) => p.id !== h1.id);
    g.input(h1.id, String(t1.number)); finishScene(g, c); finishScene(g, c);
    const h2 = toChoose(g, c);
    if (h2.id === t1.id) continue; // the protected player holds the turn: nothing to test this run
    g.input(h2.id, String(t1.number));
    assert.equal(g.phase, 'choose', 'the last target is protected for one turn');
    assert.deepEqual({ kind: g.view().feedback.kind, number: g.view().feedback.number }, { kind: 'protected', number: t1.number });
    // the server's choices respect the protection too
    for (let i = 0; i < 20; i++) {
      const x = make(5, { repeatTarget: 'block' }); const a = toChoose(x.g, x.c); allEmpty(x.g);
      const prev = x.g.alive.find((p) => p.id !== a.id); x.g.input(a.id, String(prev.number)); finishScene(x.g, x.c); finishScene(x.g, x.c);
      const b = toChoose(x.g, x.c); if (b.id === prev.id) continue;
      if (i % 2) finishScene(x.g, x.c); else x.g.command('random');
      assert.notEqual(x.g.target, prev.id, 'never the protected player'); assert.notEqual(x.g.target, b.id);
    }
    const ok = g.alive.find((p) => p.id !== h2.id && p.id !== t1.id);
    g.input(h2.id, String(ok.number));
    assert.equal(g.phase, 'aim'); assert.equal(g.target, ok.id);
    return;
  }
  assert.fail('no run reached a second turn with another holder');
});

test('«مسموح» (default) keeps the old freedom; with two players left the protection never blocks the game', () => {
  const { g, c } = make(4);
  const h = toChoose(g, c); allEmpty(g);
  const t = g.alive.find((p) => p.id !== h.id); g.input(h.id, String(t.number)); finishScene(g, c); finishScene(g, c);
  const h2 = toChoose(g, c);
  if (h2.id !== t.id) { g.input(h2.id, String(t.number)); assert.equal(g.phase, 'aim', 'allowed by default'); }
  const two = make(2, { repeatTarget: 'block' });
  const a = toChoose(two.g, two.c); allEmpty(two.g);
  const b = two.g.alive.find((p) => p.id !== a.id); two.g.input(a.id, String(b.number)); finishScene(two.g, two.c); finishScene(two.g, two.c);
  const a2 = toChoose(two.g, two.c); const only = two.g.alive.find((p) => p.id !== a2.id);
  two.g.input(a2.id, String(only.number));
  assert.equal(two.g.phase, 'aim', 'the only other player can always be chosen');
});
