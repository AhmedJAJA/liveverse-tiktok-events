import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const html = read('public/overlay.html');
const script = read('public/overlay.js');
const style = read('public/overlay.css');
const server = read('server.mjs');

test('viewer overlay has accessible Arabic RTL document and independent stylesheet', () => {
  assert.match(html, /lang="ar" dir="rtl"/);
  assert.match(html, /href="\/overlay\.css"/);
  assert.doesNotMatch(html, /href="\/styles\.css"/);
});
test('every overlay controller ID exists in HTML', () => {
  const referenced = [...script.matchAll(/\$\('([^']+)'\)/g)].map(x=>x[1]);
  const absent = [...new Set(referenced)].filter(id=>!html.includes(`id="${id}"`));
  assert.deepEqual(absent,[]);
});
test('visual results include podium and rankings surface', () => {
  for(const id of ['roundResultsOverlay','resultsPodium','resultsOthers','resultsCorrect','resultsAnswers','resultsRoundLabel']) assert.ok(html.includes(`id="${id}"`));
});
test('four existing modes remain supported by viewer', () => {
  for(const name of ['quiz','guess','race','wheel']) assert.match(script,new RegExp(`${name}:\\s*\\{`));
});
test('submissions and leaderboard are escaped as text, never HTML', () => {
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|eval\(/);
  assert.match(script, /\.textContent\s*=/);
});
test('visible response timing follows server-supplied elapsedMs', () => {
  assert.match(script, /formatMs\(p\.elapsedMs\)/);
  assert.match(script, /results\.rankings\.slice\(0,3\)/);
});
test('styles cover 16:9 and 9:16 layouts and motion preferences', () => {
  assert.match(style, /max-aspect-ratio:4\/5/);
  assert.match(style, /min-aspect-ratio:5\/4/);
  assert.match(style, /prefers-reduced-motion/);
});
test('new stylesheet is served by strict static whitelist', () => {
  assert.match(server, /'overlay\.css'/);
});
test('overlay is read-only and never contains host token or answer before results', () => {
  assert.doesNotMatch(script, /ADMIN_TOKEN|\/api\/admin\/|status\.answer\b/);
  assert.ok(script.includes('results.correctAnswer'));
});
