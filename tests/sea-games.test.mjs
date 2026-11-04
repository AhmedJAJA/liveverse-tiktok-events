import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartyGame } from '../src/party.mjs';
import { COUNTRIES, matchCountry } from '../src/countries.mjs';
import { DRAW_WORDS, CATEGORY_WORDS } from '../src/word-banks.mjs';
import fs from 'node:fs';

function clock(start = 1_000_000) { let t = start; return { now: () => t, add: (ms) => { t += ms; } }; }
const players = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: 'لاعب ' + (i + 1), number: i + 1, ...extra[i] }));
function make(mode, n, opts = {}, seq = null) {
  const c = clock(); let k = 0;
  const random = seq ? (m) => seq[k++ % seq.length] % m : () => 0;
  const g = createPartyGame(mode, { now: c.now, random, ...opts });
  g.start(players(n, opts.extra));
  return { g, c };
}
/** Run timers until the game finishes (guards against loops). */
function runOut(g, c, step = 500, limit = 4000) { for (let i = 0; i < limit && !g.finished; i++) { c.add(step); g.tick(); } }

/* ---------- خمن الرسمة ---------- */
test('drawguess: secret word never on the public screen; first correct guess wins the round', () => {
  const { g, c } = make('drawguess', 3, { extra: [{ host: true }] });
  const word = g.secret().word;
  const pub = JSON.stringify(g.snapshot());
  assert.ok(!pub.includes(word), 'word hidden from the broadcast snapshot');
  assert.equal(g.snapshot().mask.replace(/[_ ]/g, ''), '', 'all letters masked at the start');
  assert.equal(g.input('p1', word), false, 'the drawing host never guesses');
  assert.equal(g.input('p2', 'خطأ'), true);
  assert.equal(g.input('p2', word), false, 'one guess per 1.2 s');
  c.add(1300);
  assert.equal(g.input('p2', word), true);
  assert.equal(g.roster.get('p2').points, 10);
  c.add(700); g.tick();
  assert.equal(g.phase, 'reveal');
  assert.equal(g.snapshot().reveal.word, word);
  assert.equal(g.snapshot().reveal.solved[0].name, 'لاعب 2');
});
test('drawguess: hint letter after half time, accepts spelling variants', () => {
  const { g, c } = make('drawguess', 2);
  g.word = 'سيارة'; g.keys = new Set(['سياره']);
  c.add(g.seconds * 500 + 10);
  assert.equal(g.snapshot().mask[0], 'س');
  assert.equal(g.input('p1', 'السيارة'), true);
  assert.equal(g.roster.get('p1').correct, 1);
  for (const [w] of DRAW_WORDS) assert.ok(w.length >= 2);
});

/* ---------- كراسي موسيقية ---------- */
test('chairs: early sitters are out, the first sitters take the seats, last one wins', () => {
  const { g, c } = make('chairs', 4);
  assert.equal(g.phase, 'music');
  assert.equal(g.seats, 3);
  assert.equal(g.input('p4', 'اجلس'), true, 'recorded as an early sit');
  c.add(12000); g.tick();
  assert.equal(g.phase, 'input');
  assert.equal(g.input('p4', 'اجلس'), false, 'early sitters cannot sit');
  g.input('p2', 'اجلس'); g.input('p1', 'كرسي');
  c.add(10000); g.tick();
  const r = g.snapshot().reveal;
  assert.deepEqual(r.seated.map((p) => p.id).sort(), ['p1', 'p2']);
  assert.equal(r.eliminatedCount, 2);
  assert.ok(r.eliminated.find((p) => p.id === 'p4').early);
  assert.equal(g.alive.length, 2);
  c.add(4000); g.tick();
  assert.equal(g.seats, 1);
  c.add(12000); g.tick(); g.input('p1', 'اجلس'); g.input('p2', 'اجلس');
  c.add(10000); g.tick(); c.add(4000); g.tick();
  assert.equal(g.finished, true);
  assert.equal(g.rankings[0].id, 'p1');
});
test('chairs: nobody sits — nobody leaves', () => {
  const { g, c } = make('chairs', 3);
  c.add(12000); g.tick(); c.add(10000); g.tick();
  assert.equal(g.snapshot().reveal.eliminatedCount, 0);
  assert.equal(g.alive.length, 3);
});

/* ---------- اسم حيوان جماد نبات إنسان ---------- */
test('categories: only the chosen player answers; wrong letter eliminates; right word scores', () => {
  const { g, c } = make('categories', 3);
  g.category = 'animal'; g.letter = 'ف';
  assert.equal(g.chosen, 'p1');
  assert.equal(g.input('p2', 'فيل'), false, 'not your turn');
  assert.equal(g.input('p1', 'فيل'), true);
  c.add(10); g.tick();
  assert.equal(g.snapshot().reveal.ok, true);
  assert.equal(g.roster.get('p1').points, 5);
  c.add(4000); g.tick();
  assert.equal(g.chosen, 'p2');
  g.category = 'plant'; g.letter = 'ت';
  g.input('p2', 'موز');
  c.add(10); g.tick();
  assert.equal(g.snapshot().reveal.ok, false);
  assert.equal(g.roster.get('p2').alive, false);
});
test('categories: unknown word goes to the host; no decision means accepted; timeout eliminates', () => {
  const { g, c } = make('categories', 2);
  g.category = 'object'; g.letter = 'ب';
  g.input('p1', 'بلاستيكة');
  c.add(10); g.tick();
  assert.equal(g.phase, 'judge');
  assert.equal(g.snapshot().judging, true);
  assert.equal(g.judge(false), true);
  assert.equal(g.roster.get('p1').alive, false);
  const b = make('categories', 2); b.g.category = 'object'; b.g.letter = 'ب'; b.g.input('p1', 'بلاستيكة');
  b.c.add(10); b.g.tick(); b.c.add(11000); b.g.tick();
  assert.equal(b.g.snapshot().reveal.ok, true);
  const t = make('categories', 2); t.c.add(16000); t.g.tick();
  assert.equal(t.g.snapshot().reveal.why, 'انتهى الوقت');
  assert.equal(t.g.roster.get('p1').alive, false);
});
test('categories: points scoring deducts instead of eliminating; every letter offered has bank words', () => {
  const { g, c } = make('categories', 2, { scoring: 'points' });
  g.roster.get('p1').points = 5; c.add(16000); g.tick();
  assert.equal(g.roster.get('p1').alive, true);
  assert.equal(g.roster.get('p1').points, 2);
  for (const words of Object.values(CATEGORY_WORDS)) assert.ok(words.length >= 60);
});

/* ---------- حجرة ورقة مقص ---------- */
test('rps duel: pairs reveal together, loser out, tie replays, silence loses', () => {
  const { g, c } = make('rps', 5);
  assert.equal(g.snapshot().duelCount, 2);
  const [[a1, b1], [a2, b2]] = g.duels;
  g.input(a1, 'حجرة'); g.input(b1, 'مقص');
  g.input(a2, 'ورقة'); g.input(b2, 'ورقه');
  // choices are hidden until the reveal; only "ready" is public
  assert.ok(!JSON.stringify(g.snapshot().duels).includes('pick'));
  c.add(16000); g.tick();
  const r = g.snapshot().reveal;
  assert.equal(r.results[0].winner, a1);
  assert.match(r.results[1].note, /تعادل/);
  assert.equal(g.roster.get(b1).alive, false);
  assert.equal(g.alive.length, 4);
  assert.ok(r.bye);
  const s = make('rps', 2); s.g.input(s.g.duels[0][0], '✌️'); s.c.add(16000); s.g.tick();
  assert.equal(s.g.alive.length, 1);
  s.c.add(5000); s.g.tick();
  assert.equal(s.g.finished, true);
  assert.equal(s.g.rankings[0].id, s.g.duels[0][0]);
});
test('rps duel: the last two both silent replay instead of everyone losing', () => {
  const { g, c } = make('rps', 2);
  c.add(16000); g.tick();
  assert.equal(g.alive.length, 2);
  assert.match(g.snapshot().reveal.results[0].note, /تعاد/);
});
test('rps keeps the original vs-Sky format as an option', () => {
  const { g } = make('rps', 2, { format: 'sky' });
  assert.match(g.snapshot().prompt, /بوبل/);
});

/* ---------- الروليت ---------- */
test('roulette: server picks the result, wheel always contains it, last one standing wins', () => {
  const { g, c } = make('roulette', 4, {}, [2, 1, 0, 0]);
  const v = g.snapshot();
  assert.equal(v.rule, 'eliminate');
  assert.equal(v.wheel[v.target].id, g.picked);
  runOut(g, c);
  assert.equal(g.alive.length, 1);
  assert.equal(g.rankings[0].id, g.alive[0].id);
  const big = make('roulette', 40);
  assert.equal(big.g.rule, 'winner', 'big crowds pick one winner by default');
  assert.ok(big.g.snapshot().wheel.length <= 24);
  assert.equal(big.g.snapshot().wheel[big.g.snapshot().target].id, big.g.picked);
  runOut(big.g, big.c);
  assert.equal(big.g.rankings[0].id, big.g.picked);
});

/* ---------- خمن الدولة / العلم ---------- */
test('country names: Arabic spelling variants and English names match', () => {
  assert.equal(matchCountry('السعوديه'), 'sa');
  assert.equal(matchCountry('المملكة العربية السعودية'), 'sa');
  assert.equal(matchCountry('امريكا'), 'us');
  assert.equal(matchCountry('الولايات المتحدة'), 'us');
  assert.equal(matchCountry('اليابان'), 'jp');
  assert.equal(matchCountry('يابان'), 'jp');
  assert.equal(matchCountry('Brazil'), 'br');
  assert.equal(matchCountry('الإمارات'), 'ae');
  assert.equal(matchCountry('مصر!'), 'eg');
  assert.equal(matchCountry('بلد غير موجود'), null);
  for (const c of COUNTRIES) {
    assert.ok(fs.existsSync(new URL('../public/flags/' + c.iso + '.svg', import.meta.url)), c.iso);
    assert.equal(matchCountry(c.name), c.iso, c.name);
  }
});
test('country: clues open over time and earlier answers score more', () => {
  const { g, c } = make('country', 3);
  const name = g.country.name;
  assert.equal(g.snapshot().clues.length, 1);
  g.input('p1', name);
  c.add(11000); assert.equal(g.snapshot().clues.length, 2);
  g.input('p2', name);
  assert.ok(g.roster.get('p1').points > g.roster.get('p2').points);
  c.add(10000); g.input('p3', 'الصين' === name ? 'مصر' : 'الصين');
  c.add(10000); g.tick();
  assert.equal(g.snapshot().reveal.name, name);
});
test('flag: shows a flag code only, answers by name, ranking by points', () => {
  const { g, c } = make('flag', 2, { rounds: 2 });
  const v = g.snapshot();
  assert.match(v.flag, /^[a-z]{2}$/);
  assert.ok(!JSON.stringify(v).includes(g.country.name));
  g.input('p2', g.country.name);
  runOut(g, c);
  assert.equal(g.rankings[0].id, 'p2');
});

/* ---------- الأدوار المخفية ---------- */
test('roles: secret until revealed; private page links through a chat code; night kill and day vote', () => {
  const { g, c } = make('roles', 6);
  const roles = [...g.roles.values()];
  assert.equal(roles.filter((r) => r === 'impostor').length, 1);
  assert.equal(roles.filter((r) => r === 'detective').length, 1);
  assert.ok(!JSON.stringify(g.snapshot()).match(/impostor|detective|citizen/), 'no role on the public screen');
  const imp = [...g.roles].find(([, r]) => r === 'impostor')[0];
  const det = [...g.roles].find(([, r]) => r === 'detective')[0];
  const { code, token } = g.claim();
  assert.equal(g.privateView(token).linked, false);
  assert.equal(g.input(imp, 'دوري ' + code), true);
  assert.equal(g.input(det, 'دوري ' + code), false, 'codes are single-use');
  const mine = g.privateView(token);
  assert.equal(mine.role, 'impostor');
  const d = g.claim(); g.input(det, 'دوري ' + d.code);
  c.add(41000); g.tick();
  assert.equal(g.phase, 'night');
  const victim = [...g.roster.values()].find((p) => p.id !== imp && p.id !== det);
  g.act(token, victim.number);
  g.act(d.token, g.roster.get(imp).number);
  assert.equal(g.privateView(d.token).inspected[0].suspect, true, 'detective learns privately');
  assert.ok(!JSON.stringify(g.snapshot()).includes('suspect'));
  c.add(26000); g.tick();
  assert.equal(g.snapshot().reveal.how, 'night');
  assert.equal(g.roster.get(victim.id).alive, false);
  assert.equal(g.snapshot().players.find((p) => p.id === victim.id).role, g.roles.get(victim.id), 'revealed role is public');
  c.add(6000); g.tick();
  assert.equal(g.phase, 'day');
  for (const p of g.alive) if (p.id !== imp) g.input(p.id, 'صوت ' + g.roster.get(imp).number);
  c.add(46000); g.tick();
  assert.equal(g.snapshot().reveal.how, 'vote');
  c.add(6000); g.tick();
  assert.equal(g.finished, true);
  assert.equal(g.winner, 'citizens');
  assert.notEqual(g.rankings[0].id, imp);
});
test('roles: tied vote eliminates nobody; host role list hidden when the host plays', () => {
  const { g, c } = make('roles', 4);
  c.add(41000); g.tick(); c.add(26000); g.tick(); c.add(6000); g.tick();
  g.input('p1', '2'); g.input('p2', '1');
  c.add(46000); g.tick();
  assert.equal(g.snapshot().reveal.how, 'tie');
  assert.equal(g.adminView(true).hidden, true);
  assert.equal(g.adminView(false).roles.length, 4);
});

/* ---------- البولينج ---------- */
test('bowling: closer aim knocks more pins; exact aim is a strike', () => {
  const { g, c } = make('bowling', 3, { rounds: 1 });
  g.lucky = 5;
  g.input('p1', '5'); g.input('p2', '6'); g.input('p3', '10');
  c.add(13000); g.tick();
  const rolls = Object.fromEntries(g.snapshot().reveal.rolls.map((r) => [r.id, r.pins]));
  assert.equal(rolls.p1, 10);
  assert.ok(rolls.p2 >= 7 && rolls.p2 <= 8);
  assert.ok(rolls.p3 <= 0 + 1);
});
