import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GAMES, siteConfig } from '../src/catalog.mjs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const home = read('public/landing.html'), studio = read('public/index.html'), app = read('public/app.js'), server = read('server.mjs');

test('one catalogue: home gallery, studio modes and catalogue list the same working games', () => {
  const studioModes = [...studio.matchAll(/data-mode="([a-z]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(GAMES.map((g) => g.mode).sort(), studioModes);
  assert.ok(app.includes('STUDIO_MODES.includes(requestedMode)'));
  for (const game of GAMES) {
    assert.ok(home.includes(`href="${game.href}"`), game.href);
    assert.ok(home.includes(game.title), game.title);
    assert.ok(fs.existsSync(new URL('../public' + game.cover, import.meta.url)), game.cover);
  }
  assert.match(server, /'\/api\/site'/);
  assert.match(server, /GAMES\.map\(\(g\) => g\.cover\.slice\(1\)\)/, 'every catalogue cover is whitelisted');
});

test('pricing and support channel are owner settings with safe parsing', () => {
  const d = siteConfig({});
  assert.equal(d.pricing.monthly, 29);
  assert.equal(d.pricing.annual, 290);
  assert.equal(d.pricing.annualSaving, 58);
  assert.equal(d.support.url, '');
  const c = siteConfig({ SKY_PRICE_MONTHLY: '35', SKY_PRICE_ANNUAL: '300', SKY_SUPPORT_URL: 'https://wa.me/966500000000' });
  assert.equal(c.pricing.annualSaving, 120);
  assert.equal(c.support.url, 'https://wa.me/966500000000');
  assert.equal(siteConfig({ SKY_SUPPORT_URL: 'javascript:alert(1)' }).support.url, '');
  assert.equal(siteConfig({ SKY_PRICE_MONTHLY: '-5' }).pricing.monthly, 29);
  assert.equal(d.gameCount, GAMES.length);
});

test('home follows the brief structure with Sky Live identity only', () => {
  for (const id of ['how', 'games', 'pricing', 'platforms', 'season', 'leaderboard', 'start', 'gameGallery', 'phoneSlides', 'liveCard', 'liveEmpty', 'priceMonthly', 'priceAnnual', 'heroGameCount', 'heroElimCount', 'gameDialog', 'livePlatform'])
    assert.match(home, new RegExp('id="' + id + '"'), id);
  for (const href of ['#how', '#games', '#pricing']) assert.ok(home.includes(`href="${href}"`), href);
  assert.doesNotMatch(home, /hudhud|هدهد|Kick\.com|دعم كيك/);
  assert.match(home, /تجريبي/); // Kick is shown as experimental
  assert.match(home, /معاينة/); // demo phone data is labelled as a preview
  const css = read('public/sky-home.css');
  for (const w of ['max-width:1200px', 'max-width:1024px', 'max-width:850px', 'max-width:560px', 'prefers-reduced-motion:reduce']) assert.ok(css.includes(w), w);
});
