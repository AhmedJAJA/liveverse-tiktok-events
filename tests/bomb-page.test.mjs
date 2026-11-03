import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const html = read('public/bomb.html'), js = read('public/bomb.js'), css = read('public/bomb.css');
const overlay = read('public/overlay.html'), overlayJs = read('public/overlay.js'), server = read('server.mjs');

test('TIME BOMB page is routed and whitelisted', () => {
  assert.match(server, /'\/bomb': 'bomb\.html'/);
  for (const f of ['bomb.html', 'bomb.js', 'bomb.css']) assert.ok(server.includes("'" + f + "'"), f);
});
test('game page shows name, English name, bomb visual, timer, rules, registration and admin start', () => {
  assert.match(html, /القنبلة المؤقتة/);
  assert.match(html, /Time Bomb/i);
  for (const id of ['bpFusePath', 'bpSpark', 'demoTimer', 'registrationButton', 'registeredCount', 'startButton', 'keywordInput']) assert.ok(html.includes('id="' + id + '"'), id);
  assert.match(html, /!مرر 12/);
  assert.match(html, /!bomb 12/);
});
test('control room covers every host tool and goes through authenticated admin endpoints', () => {
  for (const id of ['pauseButton', 'endButton', 'restartButton', 'secondsSelect', 'soundToggle', 'botsToggle', 'passTarget', 'passButton', 'playerList', 'timeline']) assert.ok(html.includes('id="' + id + '"'), id);
  for (const action of ['registration-open', 'registration-close', 'start', 'bomb-pause', 'bomb-resume', 'bomb-end', 'bomb-restart', 'bomb-settings', 'bomb-demo', 'bomb-pass']) assert.ok(js.includes("'" + action + "'"), action);
  assert.match(js, /Authorization: 'Bearer ' \+ token/);
  assert.match(js, /sessionStorage\.getItem\('liveverse_admin'\)/);
  // stale-click protection: manual passes carry the match and turn they were made for
  assert.match(js, /admin\('bomb-pass', \{ target, turn: b\.turn, match: b\.matchId \}\)/);
});
test('bomb page and broadcast render player data safely and reference only existing ids', () => {
  for (const source of [js, overlayJs]) assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|eval\(/);
  const ids = [...js.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(ids)].filter(id => !html.includes('id="' + id + '"')), []);
  const htmlIds = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(htmlIds.filter((id, i) => htmlIds.indexOf(id) !== i), []);
  for (const id of ['bombStage', 'bombHolder', 'bombSeconds', 'bombFusePath', 'bombSpark', 'bombRoster', 'bombPasses', 'bombBlast', 'bombVictory']) assert.ok(overlay.includes('id="' + id + '"'), id);
});
test('responsive and reduced-motion support on the page and the broadcast', () => {
  assert.match(css, /@media \(max-width:640px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(read('public/royal-broadcast.css'), /\.bomb-stage/);
  assert.match(overlayJs, /if\(!bombView\.data\?\.sound\|\|reducedMotion\(\)\)return null/);
});
