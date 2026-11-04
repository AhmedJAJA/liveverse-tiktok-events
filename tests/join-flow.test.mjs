import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Engine, minPlayersFor } from '../src/engine.mjs';
import { GAMES } from '../src/catalog.mjs';

const make = () => { let t = 1_000_000; const engine = new Engine({ now: () => t, random: () => 0 }); return { engine, tick: (ms) => { t += ms; } }; };
const chat = (engine, id, name, text, extra = {}) => engine.receiveChat({ id, username: name, text, ...extra });

test('every catalogued game opens its join page and can be prepared for chat signups', () => {
  for (const game of GAMES) {
    assert.equal(game.href, '/play?mode=' + game.mode);
    const { engine } = make();
    assert.deepEqual(engine.prepareJoin({ mode: game.mode, title: game.title }), { phase: 'open' });
    const s = engine.snapshot();
    assert.equal(s.status.mode, game.mode);
    assert.equal(s.registration.phase, 'open');
    assert.equal(s.registration.minPlayers, minPlayersFor(game.mode));
  }
});

test('joining from chat adds a player once, with name, number and avatar', () => {
  const { engine, tick } = make();
  engine.prepareJoin({ mode: 'glass' });
  const avatar = 'https://p16-sign.tiktokcdn.com/a.jpg';
  chat(engine, 'u1', 'سارا', 'انضم', { avatar });
  tick(1000); chat(engine, 'u1', 'سارا', 'انضم', { avatar });
  tick(1000); chat(engine, 'u1', 'سارا', ' انضم ');
  chat(engine, 'u2', 'Omar', 'مرحبا'); // ordinary chat never enrolls
  chat(engine, 'u3', 'Khaled', 'انضم');
  const s = engine.snapshot();
  assert.equal(s.playerCount, 2);
  assert.deepEqual(s.roster.map((p) => [p.number, p.name]), [[1, 'سارا'], [2, 'Khaled']]);
  assert.equal(s.roster[0].avatar, avatar);
});

test('host plays as a contestant under the same rules, and can leave before kick-off only', () => {
  const { engine } = make();
  engine.prepareJoin({ mode: 'minority' });
  engine.seatHost({ name: 'أحمد' });
  assert.equal(engine.snapshot().registration.hostSeated, true);
  assert.throws(() => engine.seatHost({ name: 'أحمد' }), /مشارك بالفعل/);
  engine.unseatHost();
  assert.equal(engine.snapshot().registration.hostSeated, false);
  assert.equal(engine.snapshot().playerCount, 0);
  // connected host uses the stream handle, so the host's own chat answers count
  engine.setConnection('connected', 'sky_host');
  engine.seatHost({ name: 'ignored' });
  chat(engine, 'v1', 'A', 'انضم'); chat(engine, 'v2', 'B', 'انضم');
  engine.start();
  const host = engine.snapshot().roster.find((p) => p.host);
  assert.equal(host.name, '@sky_host');
  assert.throws(() => engine.unseatHost(), /بدأ اللعب/);
  engine.receiveChat({ id: 'tiktok-id-9', username: 'Sky Host', handle: 'sky_host', text: '1' });
  assert.ok(engine.party.snapshot().players.some((p) => p.name === '@sky_host'));
});

test('start needs the game minimum; late joiners wait and enter the next round', () => {
  const { engine } = make();
  engine.prepareJoin({ mode: 'minority' });
  chat(engine, 'a', 'A', 'انضم'); chat(engine, 'b', 'B', 'انضم');
  assert.equal(engine.snapshot().registration.minPlayers, 3);
  assert.throws(() => engine.start(), /3 متسابقين/);
  chat(engine, 'c', 'C', 'انضم');
  engine.start();
  assert.equal(engine.snapshot().registration.phase, 'closed');
  chat(engine, 'late', 'Late', 'انضم');
  chat(engine, 'late', 'Late', 'انضم');
  let s = engine.snapshot();
  assert.equal(s.playerCount, 3, 'late joiner is not added to the running round');
  assert.equal(s.registration.waitingCount, 1);
  assert.deepEqual(s.registration.waitingRecent, ['Late']);
  engine.stop();
  engine.prepareJoin({ mode: 'minority' });
  s = engine.snapshot();
  assert.equal(s.playerCount, 4, 'waiting viewer joins as soon as signups reopen');
  assert.equal(s.registration.waitingCount, 0);
});

test('prepare refuses to hijack a different running game', () => {
  const { engine } = make();
  engine.prepareJoin({ mode: 'race' });
  chat(engine, 'a', 'A', 'انضم');
  engine.start();
  assert.deepEqual(engine.prepareJoin({ mode: 'race' }), { phase: 'playing' });
  assert.throws(() => engine.prepareJoin({ mode: 'glass' }), /جولة جارية/);
});

test('join page: big call text, host-only controls, no room codes, safe DOM', () => {
  const html = fs.readFileSync(new URL('../public/play.html', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../public/play.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/play.css', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(html, /اكتب <b class="pl-word" id="joinWord">انضم<\/b> في شات البث لبدء اللعب/);
  assert.match(html, /بانتظار انضمام اللاعبين/);
  for (const id of ['hostSeatButton', 'startButton', 'adminBar', 'players', 'playerCount', 'liveFrame', 'lateNote']) assert.match(html, new RegExp('id="' + id + '"'), id);
  assert.match(html, /id="adminBar" hidden/, 'controls are hidden until the page knows the viewer is the host');
  assert.match(js, /'إلغاء مشاركتي'/); assert.match(js, /'شارك كلاعب'/);
  for (const action of ['prepare', 'host-seat', 'host-unseat', 'start', 'stop', 'draw']) assert.ok(js.includes("'" + action + "'"), action);
  assert.doesNotMatch(js, /innerHTML/);
  assert.doesNotMatch(html, /رمز الغرفة|كود/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /@keyframes pl-enter/);
  assert.match(server, /'\/play': 'play\.html'/);
});
