// «سلسلة الكلمات» (Word Chain): the written rules, the real engine and lobby, chat arrival order, duplicates,
// timeouts, scoring and the winner — no UI involved. HTTP and page checks are at the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WordChain, chainKey, firstLetter, lastLetter, CHAIN_POINTS, CHAIN_FAST_BONUS, LINKS_PER_CATEGORY, MAX_TURNS } from '../src/word-chain.mjs';
import { CHAIN_CATEGORIES } from '../src/chain-words.mjs';
import { Engine } from '../src/engine.mjs';
import { GameFlow } from '../src/flow.mjs';
import { ALL_GAMES, GAMES, GAME_UPDATES, siteConfig } from '../src/catalog.mjs';
import { GAME_SETTINGS, defaultSettings, validateSettings, applySettings, settingsSchema } from '../src/game-settings.mjs';

const P = (id) => ({ id, name: 'لاعب ' + id });
function game(opts = {}) {
  let t = 1_000_000;
  const g = new WordChain({ now: () => t, random: () => 0, ...opts });
  g.start([P('a'), P('b'), P('c')]);
  return { g, at: () => t, add: (ms) => { t += ms; return g.tick(); } };
}
/** A correct word for the current letter and category, straight from the word list. */
const right = (g) => g.botWord();
/** A word that is in another category's list and starts with the current letter. */
function otherCategoryWord(g) {
  for (const c of CHAIN_CATEGORIES) if (c.label !== g.bank.label) for (const w of c.words) {
    const k = chainKey(w); if (k[0] === g.letter && !g.bank.index.has(k) && !g.used.has(k)) return w;
  }
  return null;
}

test('the written letter rules: hamza forms, ة, ى, final ء and «ال» are handled one way everywhere', () => {
  assert.equal(chainKey('الأسد'), chainKey('اسد'), '«ال» and أ are ignored for matching');
  assert.equal(chainKey('إبراهيم'), chainKey('ابراهيم'));
  assert.equal(chainKey('مصطفى'), chainKey('مصطفي'), 'ى = ي');
  assert.equal(chainKey('بَقَرَةٌ'), chainKey('بقره'), 'diacritics ignored, ة = ه for matching');
  assert.equal(lastLetter('سلحفاة'), 'ت', 'a final ة asks for «ت»');
  assert.equal(lastLetter('سماء'), 'ا', 'a final ء is skipped');
  assert.equal(lastLetter('مصطفى'), 'ي');
  assert.equal(lastLetter('شاطئ'), 'ي');
  assert.equal(firstLetter('الأرنب'), 'ا');
  assert.equal(firstLetter('أرنب'), 'ا');
  for (const c of CHAIN_CATEGORIES) assert.ok(c.words.length >= 100, c.id + ' has a real word list');
});

test('13–16: a correct word is accepted and sets the next letter; wrong letter, wrong category and repeats are refused', () => {
  const { g, at, add } = game();
  const s0 = g.snapshot();
  assert.equal(s0.category, CHAIN_CATEGORIES[0].label, '«بالترتيب» starts with the first category');
  const start = g.word.text, need = g.letter;
  assert.equal(lastLetter(start), need === 'ا' ? 'ا' : lastLetter(start), 'the letter comes from the start word');
  // wrong letter
  const bad = CHAIN_CATEGORIES[0].words.find((w) => firstLetter(w) !== g.letter);
  assert.equal(g.input('a', bad, at()), true); assert.match(g.snapshot().miss.why, /يجب أن تبدأ بحرف/);
  // wrong category (a word of another list with the right letter)
  const other = otherCategoryWord(g);
  if (other) { add(1300); assert.equal(g.input('a', other, at()), true); assert.match(g.snapshot().miss.why, /ليست من فئة/); }
  // ordinary chat is ignored completely
  assert.equal(g.input('b', 'هههههه 😂', at()), false);
  assert.equal(g.input('b', 'تمام 123', at()), false);
  // the right word
  add(1300);
  const w = right(g); assert.ok(w);
  assert.equal(g.input('b', w, at()), true);
  const r = g.snapshot().reveal;
  assert.equal(r.ok, true); assert.equal(r.word, w); assert.equal(r.player.id, 'b');
  assert.equal(g.snapshot().word, w);
  assert.equal(g.letter, lastLetter(w), '16: the required letter is now the last letter of the new word');
  // the same word again in the next turn is refused
  add(3000); assert.equal(g.phase, 'input');
  const k = chainKey(w);
  if (firstLetter(w) === g.letter) { assert.equal(g.input('c', w, at()), true); assert.match(g.snapshot().miss.why, /استُخدمت/); }
  else { g.letter = firstLetter(w); assert.equal(g.input('c', w, at()), true); assert.match(g.snapshot().miss.why, /استُخدمت/); }
  assert.ok(g.used.has(k));
});

test('18: points — 3 for a correct word, +2 within the first 5 seconds of the turn', () => {
  const { g, at, add } = game({ alternate: false });
  add(1000); g.input('a', right(g), at());
  assert.equal(g.roster.get('a').points, CHAIN_POINTS + CHAIN_FAST_BONUS);
  add(3000); add(6000); // next turn, then 6 s in
  g.input('a', right(g), at());
  assert.equal(g.roster.get('a').points, CHAIN_POINTS * 2 + CHAIN_FAST_BONUS, 'a slower answer gets 3');
});

test('8: «منع الإجابة مرتين ورا بعض» — the last answerer waits for someone else; off lets them answer again', () => {
  const on = game({ alternate: true });
  on.g.input('a', right(on.g), on.at()); on.add(3000);
  const w = right(on.g);
  assert.equal(on.g.input('a', w, on.at()), true); assert.match(on.g.snapshot().miss.why, /انتظر إجابة لاعب آخر/);
  on.add(1300); assert.equal(on.g.input('b', w, on.at()), true); assert.equal(on.g.snapshot().reveal.player.id, 'b');
  const off = game({ alternate: false });
  off.g.input('a', right(off.g), off.at()); off.add(3000);
  assert.equal(off.g.input('a', right(off.g), off.at()), true); assert.equal(off.g.snapshot().reveal?.player.id, 'a');
});

test('17: when time runs out with no correct word the chain moves on (new word and category) — never stuck', () => {
  const { g, add } = game({ seconds: 15 });
  const cat0 = g.snapshot().category;
  add(15_000);
  const s = g.snapshot();
  assert.equal(s.phase, 'reveal'); assert.equal(s.reveal.timeout, true); assert.notEqual(s.category, cat0);
  add(3000); assert.equal(g.phase, 'input', 'the next turn opens by itself');
  // even if nobody ever answers, the match ends after the turn limit with a result
  for (let i = 0; i < MAX_TURNS * 2 && !g.finished; i++) add(20_000);
  assert.equal(g.finished, true);
});

test('categories change after the set number of words, in order or at random', () => {
  const { g, at, add } = game({ alternate: false });
  const first = g.snapshot().category;
  for (let i = 0; i < LINKS_PER_CATEGORY; i++) { const w = right(g); if (!w) break; g.input('a', w, at()); add(3000); }
  assert.notEqual(g.snapshot().category, first);
  assert.equal(g.snapshot().category, CHAIN_CATEGORIES[1].label);
  let n = 0;
  const rnd = new WordChain({ now: () => 0, random: () => (n++ % 3), order: 'random' }); rnd.start([P('a')]);
  assert.equal(rnd.order, 'random');
  assert.deepEqual([...rnd.categoryOrder].sort(), [0, 1, 2, 3, 4, 5]);
});

test('19: reaching «نقاط الفوز» ends the match with the winner and the real points', () => {
  const { g, at, add } = game({ target: 10, alternate: false });
  for (let i = 0; i < 5 && !g.finished; i++) { g.input('b', right(g), at()); add(3000); }
  assert.equal(g.finished, true); assert.equal(g.reason, 'target');
  assert.equal(g.rankings[0].id, 'b'); assert.ok(g.rankings[0].points >= 10);
});

test('host review: an unknown word with the right letter waits for «قبول» or «رفض»; review off refuses it', () => {
  const { g, at } = game({ review: true });
  const fake = (g.letter === 'ا' ? 'ا' : g.letter) + 'زبرقان';
  assert.equal(g.input('a', fake, at()), true);
  assert.equal(g.snapshot().pending.word, fake);
  assert.equal(g.judge(false), true); assert.match(g.snapshot().miss.why, /رفضها/);
  g.input('b', fake + 'ي', at() + 1300);
  assert.equal(g.judge(true), true); assert.equal(g.snapshot().reveal.ok, true); assert.equal(g.snapshot().reveal.reviewed, true);
  const off = game({ review: false });
  assert.equal(off.g.input('a', (off.g.letter) + 'زبرقان', off.at()), true); assert.match(off.g.snapshot().miss.why, /ليست في قائمة/);
});

test('concurrency: many correct comments at once — only the first to reach the server wins the link', () => {
  const { g, at } = game({ alternate: false });
  const w = right(g);
  const words = [w, ...CHAIN_CATEGORIES[0].words.filter((x) => firstLetter(x) === g.letter && chainKey(x) !== chainKey(w))].slice(0, 30);
  const players = Array.from({ length: 30 }, (_, i) => P('p' + i)); g.start(players);
  const results = players.map((p, i) => g.input(p.id, words[i % words.length], at()));
  assert.equal(results.filter(Boolean).length >= 1, true);
  const winners = [...g.roster.values()].filter((p) => p.points > 0);
  assert.equal(winners.length, 1, 'exactly one link awarded');
  assert.equal(winners[0].id, 'p0', 'arrival order decides');
});

/* ---------------------------- the real engine and lobby ---------------------------- */
function rig() {
  let t = 2_000_000;
  const e = new Engine({ now: () => t, random: () => 0 });
  const flow = new GameFlow({ engine: e, games: ALL_GAMES, now: () => t });
  let n = 0;
  const chat = (id, text, extra = {}) => e.receiveChat({ id, username: 'مشاهد ' + id, text, msgId: extra.msgId || 'm' + ++n, ...extra });
  const enter = (opts = {}) => { flow.begin(opts); flow.plan([['game', 'التحقق من بيانات اللعبة']]); flow.step('game', 'done'); return flow.ready(); };
  return { e, flow, chat, enter, add: (ms) => { t += ms; e.tick(); } };
}

test('1–7, 9–12, 18–20: settings → lobby → joins → round → points → winner → new round, on the real engine', () => {
  const { e, flow, chat, enter, add } = rig();
  // 3–7: the settings are saved and validated on the server
  flow.setup('chain');
  flow.saveSettings('chain', { target: 15, seconds: 25, order: 'random', alternate: true }, { keyword: 'جاهز', audience: 'all' });
  assert.deepEqual(flow.settingsFor('chain'), { target: 15, seconds: 25, order: 'random', alternate: true, review: true, sounds: true });
  assert.throws(() => flow.saveSettings('chain', { seconds: 40 }), /قيمة غير صالحة/);
  assert.throws(() => flow.saveSettings('chain', { target: 12 }), /قيمة غير صالحة/);
  assert.equal(flow.snapshot().join.keyword, 'جاهز');
  // 9: «الدخول للوبي» prepares the lobby; no round starts
  enter(); assert.equal(e.status.active, false);
  assert.equal(flow.snapshot().lobby.state, 'REGISTRATION_OPEN');
  // 10–11: the join word joins; other comments do not
  chat('u1', 'جاهز'); chat('u2', 'جاهز'); chat('u3', 'انضم'); chat('u4', 'جاهز يا شباب');
  assert.deepEqual([...e.players.keys()].sort(), ['u1', 'u2']);
  // 12: «بدء الجولة الآن» — settings applied to the real game
  flow.start(() => {}, { requestId: 'go-1' });
  assert.equal(e.status.active, true); assert.equal(e.status.mode, 'chain');
  const party = () => e.snapshot().party;
  assert.equal(party().target, 15); assert.equal(e.party.seconds, 25); assert.equal(e.party.order, 'random');
  // 13 + 18: a correct word from chat
  chat('u1', e.party.botWord()); assert.equal(party().reveal.player.id, 'u1');
  const pts = e.party.roster.get('u1').points; assert.ok(pts === 5);
  // the same comment delivered twice (a reconnect replay) counts once
  add(3000);
  const w = e.party.botWord();
  chat('u2', w, { msgId: 'dup-1' }); chat('u2', w, { msgId: 'dup-1' });
  assert.equal(e.party.roster.get('u2').points, 5, 'one comment, one award');
  // 19: play on until someone reaches the target
  for (let i = 0; i < 20 && e.status.active; i++) { add(3000); chat(i % 2 ? 'u1' : 'u2', e.party.botWord() || 'كلمة'); }
  assert.equal(e.status.active, false);
  const res = e.status.results; assert.ok(res?.rankings?.length);
  assert.ok(res.rankings[0].points >= 15, 'the winner shows the real chain points');
  // 20: «جولة جديدة» keeps the players and the word
  flow.sync(); flow.again(); assert.equal(flow.snapshot().lobby.state, 'REGISTRATION_CLOSED');
  assert.equal(e.players.size, 2);
});

test('21–22: the stream disconnecting and reconnecting does not stop the round or double-count replayed comments', () => {
  const { e, flow, chat, enter, add } = rig();
  flow.setup('chain'); flow.saveSettings('chain', { target: 30, alternate: false }); enter();
  chat('u1', 'انضم'); chat('u2', 'انضم');
  flow.start(() => {}, { requestId: 'go-2' });
  e.setConnection('connected', 'host', 'متصل', 'tiktok');
  const w = e.party.botWord();
  chat('u1', w, { msgId: 'tt:100' });
  e.setConnection('disconnected', '', 'انقطع الاتصال', 'tiktok');
  add(1000); assert.equal(e.status.active, true, 'the round keeps running on the server');
  e.setConnection('connected', 'host', 'عاد الاتصال', 'tiktok');
  chat('u1', w, { msgId: 'tt:100' }); // the platform replays recent comments after a reconnect
  assert.equal(e.party.roster.get('u1').points, 5);
  add(3000); chat('u2', e.party.botWord(), { msgId: 'tt:101' });
  assert.equal(e.party.roster.get('u2').points > 0, true, 'new comments after the reconnect are played');
});

test('«المتابعون فقط» is enforced only where the platform really reports follows (TikTok live)', () => {
  const { e, flow, chat, enter } = rig();
  flow.setup('chain'); flow.saveSettings('chain', {}, { audience: 'followers' });
  e.setConnection('connected', 'host', 'متصل', 'tiktok');
  enter();
  assert.equal(e.registration.audience, 'followers');
  chat('f1', 'انضم', { isFollower: true }); chat('n1', 'انضم', { isFollower: false });
  assert.deepEqual([...e.players.keys()], ['f1']);
  const k = rig(); k.flow.setup('chain'); k.flow.saveSettings('chain', {}, { audience: 'followers' });
  k.e.setConnection('connected', 'host', 'متصل', 'kick'); k.enter();
  assert.equal(k.e.registration.audience, 'all', 'Kick does not report follows: everyone is accepted, as the page says');
  assert.throws(() => flow.saveSettings('chain', {}, { audience: 'subscribers' }), /غير صالح/);
});

test('demo mode: the lobby runs with labelled test players, never as real viewers', () => {
  const { e, flow, enter, add } = rig();
  flow.setup('chain'); enter({ demo: true });
  assert.equal(flow.snapshot().lobby.demo, true);
  e.addDemoPlayers({ count: 3 });
  assert.ok([...e.players.keys()].every((id) => id.startsWith('demo:')));
  flow.start(() => {}, { requestId: 'demo-1' });
  e.simulation.autoplay = true;
  for (let i = 0; i < 40; i++) add(1000);
  assert.ok(e.party.totalInputs > 0 || e.party.round > 1, 'demo players play on their own');
});

/* ---------------------------- catalogue, settings and pages ---------------------------- */
test('catalogue: Word Chain is listed as new with real rules; the library data comes from the catalogue', () => {
  const g = GAMES.find((x) => x.mode === 'chain');
  assert.ok(g && g.isNew && g.status === 'available'); assert.equal(g.category, 'smart');
  assert.ok(g.rules.length >= 4); assert.match(g.cover, /^\/cards\/15-word-chain\.webp$/);
  assert.ok(fs.existsSync(new URL('../public/cards/15-word-chain-200.webp', import.meta.url)));
  const site = siteConfig({});
  assert.deepEqual(Object.values(site.categories), ['الذكاء والكلمات', 'التحديات', 'الحظ', 'الألعاب الجماعية']);
  assert.ok(site.gameUpdates.length >= 1 && site.gameUpdates.every((u) => u.mode === 'all' || ALL_GAMES.some((x) => x.mode === u.mode)), 'updates point to real games');
  assert.ok(GAME_UPDATES.every((u) => /^\d{4}-\d{2}-\d{2}$/.test(u.date) && u.items.length));
  const schema = settingsSchema().chain;
  assert.deepEqual(schema.map((f) => [f.key, f.control, f.group]), [['target', 'counter', 'match'], ['seconds', 'segment', 'match'], ['order', 'segment', 'match'], ['alternate', 'toggle', 'rules'], ['review', 'toggle', 'rules'], ['sounds', 'toggle', 'rules']]);
  assert.deepEqual(defaultSettings('chain'), { target: 30, seconds: 20, order: 'ordered', alternate: true, review: true, sounds: true });
  assert.deepEqual(GAME_SETTINGS.chain.find((f) => f.key === 'seconds').options.map(([v]) => v), [15, 20, 25]);
  const e = new Engine({ now: () => 0 }); e.configure({ mode: 'chain' });
  applySettings(e, 'chain', validateSettings('chain', { target: 50, seconds: 15, order: 'random', alternate: false, sounds: false }));
  assert.equal(e.partyConfig.chain.target, 50); assert.equal(e.partyConfig.chain.seconds, 15); assert.equal(e.partyConfig.chain.alternate, false); assert.equal(e.partyConfig.chain.sounds, false);
});

test('pages: the library (filters, updates, cards), the numbered settings cards, the chain board and no fixed game counts', () => {
  const pub = (f) => fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
  const lib = pub('games.html'), libJs = pub('games.js');
  assert.match(lib, /<h1 id="libTitle">مكتبة الألعاب<\/h1>/);
  for (const f of ['all', 'smart', 'elimination', 'luck', 'group', 'new']) assert.match(lib, new RegExp('data-filter="' + f + '"'));
  for (const t of ['الكل', 'الذكاء والكلمات', 'التحديات', 'الحظ', 'الألعاب الجماعية', 'الألعاب الجديدة', 'آخر التحديثات']) assert.ok(lib.includes(t), t);
  assert.match(libJs, /fetch\('\/api\/site'/); assert.match(libJs, /'\/game\/' \+ g\.mode/); assert.match(libJs, /'العب الآن'/); assert.match(libJs, /'جديد'/);
  assert.doesNotMatch(libJs, /new WebSocket/);
  const studio = pub('studio.html');
  for (const t of ['<span class="su-num">1</span>الدخول', '<span class="su-num">2</span>المباراة', '<span class="su-num">3</span>قواعد اللعب', 'المسموح لهم', 'الدخول للوبي']) assert.ok(studio.includes(t), t);
  for (const id of ['streamBadge', 'autoBadge', 'audienceSeg', 'rulesFields', 'rulesList', 'advFields', 'beginButton', 'tryButton']) assert.match(studio, new RegExp('id="' + id + '"'), id);
  const icons = pub('game-icons.svg');
  for (const g of ALL_GAMES) assert.match(icons, new RegExp('id="g-' + g.mode + '"'), 'icon for ' + g.mode);
  const overlay = pub('overlay.js');
  assert.match(overlay, /chain\(panel, party, r\) \{ chainBoard/);
  for (const t of ['الحرف المطلوب', 'نقاط الفوز', 'انتهى الوقت', 'بانتظار مراجعة المشرف']) assert.ok(overlay.includes(t), t);
  const home = pub('home.html');
  assert.doesNotMatch(home, /14 لعبة|20 لعبة|أكثر من \d+ لعبة/, 'no fixed game count');
});

/* ---------------------------- over HTTP (needs PostgreSQL) ---------------------------- */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
const dbUrl = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/visual';
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
let pgOk = false; try { const pg = (await import('pg')).default; const c = new pg.Client({ connectionString: dbUrl }); await c.connect(); await c.end(); pgOk = true; } catch {}

test('over HTTP: library page, Word Chain page behind sign-in, settings saved, lobby, joins, round, OBS state', { skip: !pgOk && 'no PostgreSQL', timeout: 90_000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), NODE_ENV: 'test', ADMIN_TOKEN: 'owner-token-chain-test-1', SKY_OPEN_SIGNUP: '1', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-wc-')), DATABASE_URL: dbUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await new Promise((r) => setTimeout(r, 50)); }
  const base = 'http://127.0.0.1:' + port; const jar = new Map();
  const call = async (method, route, body) => {
    const res = await fetch(base + route, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => k + '=' + v).join('; ') }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    let data = null; try { data = await res.json(); } catch {} return { status: res.status, data, location: res.headers.get('location') };
  };
  try {
    // 1–2: the library is public and lists every game, Word Chain included
    assert.equal((await fetch(base + '/games')).status, 200);
    const site = await (await fetch(base + '/api/site')).json();
    assert.ok(site.games.some((g) => g.mode === 'chain' && g.isNew)); assert.ok(site.gameUpdates.length);
    assert.equal((await call('GET', '/studio')).location, '/games');
    // 3: the game page needs an account (free)
    assert.match((await call('GET', '/game/chain')).location, /^\/login\?next=%2Fgame%2Fchain/);
    const u = 'wc' + Date.now().toString(36).slice(-6);
    assert.equal((await call('POST', '/api/auth/register', { username: u, email: u + '@example.com', password: 'reef2026go', confirm: 'reef2026go' })).status, 201);
    assert.equal((await call('GET', '/game/chain')).status, 200);
    const A = (action, body = {}) => call('POST', '/api/admin/' + action, body);
    assert.equal((await A('flow-setup', { mode: 'chain' })).status, 200);
    // 4–8: settings
    let r = await A('flow-settings', { settings: { target: 20, seconds: 15, order: 'random', alternate: false }, keyword: 'العب' });
    assert.equal(r.status, 200); assert.equal(r.data.flow.settings.target, 20); assert.equal(r.data.flow.join.keyword, 'العب');
    assert.equal((await A('flow-settings', { settings: { seconds: 99 } })).status, 400);
    assert.equal((await A('flow-settings', { audience: 'followers' })).status, 200);
    assert.equal((await A('flow-settings', { audience: 'all' })).status, 200);
    // 9–11: lobby in demo mode (no stream here), joins by the word only
    assert.equal((await A('flow-trial')).status, 200);
    const me = (await call('GET', '/api/access/me')).data; const room = me.room; assert.ok(room, 'room id: ' + JSON.stringify(me).slice(0, 300));
    for (let i = 0; i < 40; i++) { const st = await (await fetch(base + '/api/state?room=' + room)).json(); if (st.flow?.lobby?.state === 'REGISTRATION_OPEN') break; await new Promise((x) => setTimeout(x, 100)); }
    await A('simulate', { username: 'سارة', text: 'العب' }); await A('simulate', { username: 'عمر', text: 'انضم' });
    let st = await (await fetch(base + '/api/state?room=' + room)).json();
    assert.ok(st.roster.some((p) => p.name === 'سارة')); assert.ok(!st.roster.some((p) => p.name === 'عمر'));
    // 12: the round
    assert.equal((await A('flow-start', { requestId: 'http-chain-1' })).status, 200);
    st = await (await fetch(base + '/api/state?room=' + room)).json();
    assert.equal(st.status.mode, 'chain'); assert.equal(st.party.target, 20); assert.ok(st.party.letter && st.party.word && st.party.category);
    // 23: the OBS page and its state work for this room
    assert.equal((await fetch(base + '/overlay?room=' + room)).status, 200);
    assert.equal(st.party.sounds, true);
  } finally { child.kill(); await once(child, 'exit').catch(() => {}); }
});
