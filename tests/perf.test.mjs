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
  assert.doesNotMatch(home, /<a[^>]+href="\/(play|studio)\?mode=/, 'decorative cards are not links');
  const imgs = [...home.matchAll(/<img [^>]+>/g)].map((m) => m[0]);
  assert.ok(imgs.length >= 13);
  for (const img of imgs) { assert.match(img, /width="\d+" height="\d+"/, 'images reserve their space'); }
  assert.equal(imgs.filter((i) => /\/games\/\d\d-[\w-]+-120\.webp/.test(i) && /srcset=/.test(i)).length, 12, 'small card images with srcset');
  assert.match(homeCss, /grid-template-columns:minmax\(0,1fr\)/, 'the card strip cannot widen the page');
  assert.match(homeCss, /overflow-x:auto/);
  // logo bubbles: CSS only, behind the letters plus edge-only ones in front, more on hover, off for reduced motion
  assert.match(home, /class="hm-lb hm-lb-back"/); assert.match(home, /class="hm-lb hm-lb-front"/);
  assert.match(homeCss, /\.hm-logo:hover \.hm-lb i\.x/);
  assert.match(homeCss, /prefers-reduced-motion:reduce\)\{[\s\S]*\.hm-lb i\{animation:none/);
  assert.match(homeCss, /content-visibility:auto/, 'lower sections render lazily');
  assert.doesNotMatch(pub('home.js'), /WebSocket/, 'no WebSocket on the home page');
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
  assert.match(js, /async function selectGame/);
  assert.match(js, /history\.replaceState\(null, '', '\/studio\?mode='/);
  for (const a of ['promo-create', 'promo-list', 'promo-update', 'promo-delete', 'connect', 'disconnect']) assert.ok(js.includes("'" + a + "'"), a);
});
