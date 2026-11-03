import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const pub = (f) => fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

test('royal FX assets are whitelisted and wired into every interactive page except the OBS overlay', () => {
  for (const asset of ['royal-luxe.css', 'royal-fx.css', 'royal-fx.js']) assert.ok(server.includes("'" + asset + "'"), asset);
  for (const page of ['landing.html', 'event.html', 'index.html', 'bomb.html']) {
    assert.match(pub(page), /href="\/royal-fx\.css"/, page);
    assert.match(pub(page), /src="\/royal-fx\.js"/, page);
  }
  assert.match(pub('landing.html'), /href="\/royal-luxe\.css"/);
  assert.match(pub('event.html'), /href="\/royal-luxe\.css"/);
  assert.doesNotMatch(pub('overlay.html'), /royal-fx/);
});

test('royal FX is self-hosted, decorative and motion-safe', () => {
  for (const f of ['royal-fx.css', 'royal-fx.js', 'royal-luxe.css']) assert.doesNotMatch(pub(f), /@import|https?:\/\//, f);
  const css = pub('royal-fx.css'), js = pub('royal-fx.js');
  for (const cls of ['.fx-stage', '.fx-border', '.fx-orbit', '.fx-spot', '.fx-spot-ring', 'data-fx-icon']) assert.ok(css.includes(cls), cls);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(js, /aria-hidden/);
  assert.match(js, /classList\.contains\('broadcast'\)/);
  assert.match(js, /visibilitychange/);
});

test('landing and event repaint has no navy or cyan left in its token layer', () => {
  const luxe = pub('royal-luxe.css');
  assert.match(luxe, /--sky-blue:#D4AF37/);
  assert.match(luxe, /--event-teal:#E6C463/);
});
