import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const pub = (f) => fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

test('Aurum UI assets are whitelisted and loaded by every page, including the OBS screen', () => {
  for (const asset of ['aurum.css', 'aurum.js', 'royal-luxe.css', 'royal-arena.css']) assert.ok(server.includes("'" + asset + "'"), asset);
  for (const page of ['landing.html', 'event.html', 'index.html', 'bomb.html', 'overlay.html']) {
    assert.match(pub(page), /href="\/aurum\.css"/, page);
    assert.match(pub(page), /src="\/aurum\.js"/, page);
  }
  assert.match(pub('overlay.html'), /href="\/royal-arena\.css"/);
  assert.ok(!fs.existsSync(new URL('../public/royal-fx.js', import.meta.url)), 'royal-fx is superseded by aurum');
});

test('Aurum rebuilds the six Aceternity effects natively, without remote code', () => {
  const css = pub('aurum.css'), js = pub('aurum.js');
  for (const f of ['aurum.css', 'aurum.js', 'royal-arena.css', 'royal-luxe.css']) assert.doesNotMatch(pub(f), /@import|https?:\/\/|import\s.+from/, f);
  for (const cls of ['.au-mb', '.au-cs', '.au-beams', '.au-sparkles', '.au-tip', '.au-w', '.au-shimmer', '.au-retext']) assert.ok(css.includes(cls), cls);
  for (const fn of ['function movingBorder', 'function spotlight', 'function beams', 'function burst', 'function sparkleField', 'function showTip', 'function splitWords', 'function card3d', 'function glowing', 'function heroSpot']) assert.ok(js.includes(fn), fn);
  for (const cls of ['.au-3d', '.au-glow', '.au-spot']) assert.ok(css.includes(cls), cls);
  assert.match(js, /offset-path/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(js, /reduce\.matches/);
  assert.match(js, /visibilitychange/);
  assert.match(js, /aria-hidden/);
});

test('Aurum is CSP-safe: no inline style attributes in generated markup', () => {
  const js = pub('aurum.js');
  for (const markup of js.match(/tpl\(`[\s\S]*?`\)/g) || []) assert.doesNotMatch(markup, /\sstyle=/);
});

test('registration screen keeps every id overlay.js writes and adds tiered participant cards', () => {
  const html = pub('overlay.html'), arena = pub('royal-arena.css');
  for (const id of ['registrationOverlay', 'signupKeyword', 'signupCount', 'signupRecent', 'signupLatestAvatar', 'signupLatestName', 'signupEmpty', 'winnerBanner', 'roundResultsOverlay']) assert.ok(html.includes('id="' + id + '"'), id);
  assert.match(arena, /signup-member-grid:has\(>\.signup-member-card:nth-child\(13\)\)/);
  assert.match(arena, /signup-member-grid:has\(>\.signup-member-card:nth-child\(25\)\)/);
  assert.match(arena, /max-aspect-ratio:4\/5/);
});

test('landing uses the SVG icon set instead of emoji glyphs', () => {
  const home = pub('landing.html'), icons = pub('icons.svg');
  assert.doesNotMatch(home, /🔥|🎁|>♪<|>✦<|>‹</);
  for (const id of ['i-flame', 'i-gift', 'i-note', 'i-laurel', 'i-star', 'i-chevron']) {
    assert.match(icons, new RegExp('id="' + id + '"'), id);
  }
  assert.match(home, /data-au-tip=/);
});

test('Aurum follows the original Aceternity parameters', () => {
  const css = pub('aurum.css'), js = pub('aurum.js');
  assert.match(js, /x \* \.45/);                       // tooltip: [-100,100]px → [-45°,45°]
  assert.match(js, /\/ 25\)/);                          // 3D card: offset / 25 degrees
  assert.match(js, /rand\(10, 20\)/);                   // beams: 10–20s gradient sweeps
  assert.match(js, /\.7;/);                             // glowing effect: inactive zone .7
  assert.match(css, /calc\(var\(--i,0\) \* 200ms\)/); // text generate: 0.2s stagger
  assert.match(css, /radial-gradient\(var\(--au-mb-color,#F1D58C\) 40%,transparent 60%\)/); // moving border orb
  assert.match(js, /if \(!reduce\.matches\) \{|const animate = !reduce\.matches/);
});
