import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Engine } from '../src/engine.mjs';

const pub = (f) => fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');

test('lazy engine signals changes without building a snapshot for every chat message', () => {
  let calls = 0, built = 0;
  const e = new Engine({ lazy: true, notify: (s) => { calls++; if (s) built++; } });
  e.prepareJoin({ mode: 'quiz' });
  for (let i = 0; i < 500; i++) e.receiveChat({ id: 'u' + i, username: 'u' + i, text: 'انضم' });
  assert.ok(calls >= 500); assert.equal(built, 0, 'no snapshot is built inside the chat path');
  assert.equal(e.snapshot().playerCount, 500);
});

test('a chat flood reaches each screen as a few batched updates, without losing state', async () => {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise((r) => reservation.close(r));
  const token = 'perf-owner-token-123456789';
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), ADMIN_TOKEN: token, NODE_ENV: 'test', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-perf-')) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await once(child.stdout, 'data');
  const base = 'http://127.0.0.1:' + port, H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const post = (a, b) => fetch(base + '/api/admin/' + a, { method: 'POST', headers: H, body: JSON.stringify(b) });
  try {
    const states = [];
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
    ws.onmessage = (e) => { const p = JSON.parse(e.data); if (p.type === 'state') states.push(p.data); };
    await new Promise((r) => (ws.onopen = r));
    await post('prepare', { mode: 'quiz' });
    const jobs = []; for (let i = 0; i < 400; i++) jobs.push(post('simulate', { username: 'v' + i, text: 'انضم' }));
    await Promise.all(jobs);
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(states.length < 60, `400 joins arrived as ${states.length} updates`);
    assert.equal(states.at(-1).playerCount, 400, 'the last update carries every join');
    ws.close();
  } finally { child.kill(); }
});

test('client pages: light home, single WebSocket, cleanup on leave, pause when hidden', () => {
  const home = pub('home.html'), homeCss = pub('home.css'), studio = pub('studio.js'), sponge = pub('sponge.js'), spongeCss = pub('sponge.css');
  assert.doesNotMatch(home, /<script[^>]+src="\/(aurum|session|account|sponge)\.js"/, 'the entry page loads only its own script');
  assert.doesNotMatch(home, /style="/, 'no inline styles (CSP)');
  assert.doesNotMatch(home, /href="\/studio/, 'no separate studio');
  const imgs = [...home.matchAll(/<img [^>]+>/g)].map((m) => m[0]);
  assert.ok(imgs.length >= 5);
  for (const img of imgs) { assert.match(img, /width="\d+" height="\d+"/, 'images reserve their space'); }
  // the games list: every game is a link to its own page, built from /api/site with small card images
  assert.match(pub('home.js'), /a\.href = '\/game\/' \+ g\.mode/);
  assert.match(pub('home.js'), /img\.width = 120; img\.height = 154/, 'game images reserve their space');
  assert.match(homeCss, /grid-template-columns:minmax\(0,1fr\)/, 'the card strip cannot widen the page');
  assert.match(homeCss, /overflow-x:auto/);
  // logo bubbles: CSS only, behind the letters plus edge-only ones in front, more on hover, off for reduced motion
  assert.match(home, /class="hm-lb hm-lb-back"/); assert.match(home, /class="hm-lb hm-lb-front"/);
  assert.match(homeCss, /\.hm-logo:hover \.hm-lb i\.x/);
  assert.match(homeCss, /prefers-reduced-motion:reduce\)\{[\s\S]*\.hm-lb i\{animation:none/);
  assert.match(homeCss, /content-visibility:auto/, 'lower sections render lazily');
  assert.doesNotMatch(pub('home.js'), /WebSocket/, 'no WebSocket on the home page');
  // v1.3 layout: sticky bar + side menu, real live streams (no invented partners), payments shown honestly, refund policy linked
  // the phone menu itself (#menu) is built by the shared site header on every page (site-header.js)
  assert.match(fs.readFileSync(new URL('../public/site-header.js', import.meta.url), 'utf8'), /menu\.id = 'menu'/);
  for (const id of ['menuButton', 'live', 'liveTrack', 'liveEmpty', 'enter', 'games', 'gameStrip', 'store', 'packList', 'pay', 'faq', 'contact']) assert.match(home, new RegExp('id="' + id + '"'), id);
  assert.match(pub('home.js'), /fetch\('\/api\/streams'/, 'live cards come from real connected rooms');
  assert.match(home, /قريبًا/, 'card payments are marked as coming, not live');
  assert.match(home, /href="\/refund"/);
  assert.doesNotMatch(home, /\$|USD|دولار/, 'prices in riyal only');
  assert.match(studio, /if \(ws && ws\.readyState <= 1\) return;/, 'never two sockets');
  assert.match(studio, /addEventListener\('pagehide'/);
  assert.doesNotMatch(sponge, /getContext\('2d'\)/, 'bubbles are CSS, not a per-frame canvas');
  assert.match(sponge, /is-hidden/); assert.match(spongeCss, /animation-play-state:paused/);
});

test('studio layout: game list, main screen and a tabbed drawer with only the current game settings', () => {
  const html = pub('studio.html');
  for (const id of ['gameNav', 'hostPanel', 'tab-round', 'tab-players', 'tab-settings', 'tab-codes', 'connectForm', 'drawerToggle', 'hostSeatButton', 'startButton', 'joinCall', 'players', 'leaders', 'codeForm', 'logoutButton'])
    assert.match(html, new RegExp('id="' + id + '"'), id);
  assert.match(html, /role="tablist"/);
  const js = pub('studio.js');
  // the launch flow: one command per button, in order (setup → join word → open → start)
  for (const a of ['flow-setup', 'flow-begin', 'flow-cancel', 'flow-open', 'flow-close', 'flow-keyword', 'flow-registration-reset', 'flow-start', 'flow-again', 'flow-end', 'flow-trial', 'flow-settings']) assert.ok(js.includes("'" + a + "'"), a);
  for (const id of ['setupView', 'prepareView', 'lobbyView', 'beginButton', 'tryButton', 'wordInput', 'autoOpenToggle', 'lbStart', 'lbRegToggle', 'lbReset', 'lbEnd', 'lbWordEdit', 'lbList', 'advFields']) assert.match(html, new RegExp('id="' + id + '"'), id);
  assert.match(js, /requestId/, '«بدء الجولة الآن» sends one request id per click');
  assert.doesNotMatch(js, /admin\('start'/, 'the studio never starts a round with the old one-step command');
  assert.match(js, /history\.replaceState\(null, '', '\/game\/' \+ mode\)/, 'the address is the game\'s own page');
  for (const a of ['promo-create', 'promo-list', 'promo-update', 'promo-delete', 'connect', 'disconnect']) assert.ok(js.includes("'" + a + "'"), a);
});
