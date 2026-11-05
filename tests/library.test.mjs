// «مكتبة الألعاب» (/games): the page order, the violet design measurements, filters + search together,
// card states, the live rail (verified streams only, a real empty state), «آخر التحديثات», the connection card
// and phones — static checks always, and the same page in a real browser when Playwright + PostgreSQL exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { GAMES, EXTRA_GAMES, GAME_UPDATES } from '../src/catalog.mjs';

const pub = (f) => fs.readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
const html = pub('games.html'), css = pub('games.css'), js = pub('games.js'), server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

test('page order: header, title, lead, call to action, «اتصل بالبث», live streams, updates, filters, games, support, footer', () => {
  const at = (s) => { const i = html.indexOf(s); assert.ok(i > 0, 'missing ' + s); return i; };
  const order = ['class="gl-top"', 'id="libTitle"', 'class="gl-lead"', 'class="gl-cta"', 'id="connect"', 'id="live"', 'id="updates"', 'id="filters"', 'id="gameGrid"', 'class="gl-support', 'class="gl-foot"'].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(html, /<h1 id="libTitle">مكتبة الألعاب<\/h1>/);
  assert.match(html, /<span>تصفح الألعاب<\/span>/);
  assert.match(html, /بثوث شغّالة الآن/);
  for (const t of ['الكل', 'الذكاء والكلمات', 'التحديات', 'الحظ', 'الألعاب الجماعية', 'الألعاب الجديدة']) assert.ok(html.includes('>' + t + '</button>'), t);
  assert.match(html, /id="gameSearch" type="search"/);
  // quick links to the sections
  for (const a of ['#live', '#updates', '#library']) assert.ok(html.includes('href="' + a + '"'), a);
  assert.doesNotMatch(html, /studio|استوديو/i, 'no separate studio step');
  assert.doesNotMatch(html, /\bstyle="/, 'no inline styles (CSP)');
  assert.doesNotMatch(html, /https?:\/\//, 'no external resources');
});

test('every link on the page goes somewhere real, and the self-hosted fonts are served', () => {
  const routes = new Set(['/', '/games', '/terms', '/privacy', '/refund', '/guide/games', '/guide/tiktok-live', '/guide/tools', '/account']);
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (href.startsWith('#')) { assert.ok(html.includes('id="' + href.slice(1) + '"'), 'anchor ' + href); continue; }
    if (/\.(css|js|png|webp|woff2?|svg)(#.*)?$/.test(href.split('?')[0])) continue;
    const p = href.split(/[?#]/)[0];
    assert.ok(routes.has(p) || p === '/login', 'route ' + href);
    if (href.startsWith('/account#')) assert.match(pub('me.js'), new RegExp("'" + href.split('#')[1] + "'|id=\"" + href.split('#')[1]) , href);
  }
  assert.match(pub('me.html'), /id="platforms"/);
  for (const f of ['noto-kufi-arabic-700.woff', 'ibm-plex-arabic-400.woff', 'ibm-plex-arabic-600.woff', 'ibm-plex-arabic-700.woff', 'readex-pro-700.woff', 'OFL-library-fonts.txt']) {
    assert.ok(fs.existsSync(new URL('../public/fonts/' + f, import.meta.url)), f);
    assert.ok(server.includes("'fonts/" + f + "'"), 'served: ' + f);
  }
  // every icon the page uses exists, and comes from a versioned sprite address (the plain one is cached for days)
  const sprite = pub('icons.svg'), games = pub('game-icons.svg');
  const used = new Set([...html.matchAll(/icons\.svg\?v=\d+#(i-[a-z-]+)/g)].map((m) => m[1]));
  for (const [, name] of js.matchAll(/ui\('([a-z-]+)'/g)) used.add('i-' + name);
  for (const name of ['note', 'kick']) used.add('i-' + name); // the platform icons, chosen from a table
  for (const id of used) assert.match(sprite, new RegExp('<symbol id="' + id + '"'), id);
  assert.doesNotMatch(html, /\/icons\.svg#/, 'html uses the versioned sprite');
  assert.match(js, /SPRITE = '\/icons\.svg\?v=\d+'/); assert.match(js, /GAME_SPRITE = '\/game-icons\.svg\?v=\d+'/);
  for (const g of [...GAMES, ...EXTRA_GAMES]) assert.match(games, new RegExp('<symbol id="g-' + g.mode + '"'), g.mode);
  assert.match(server, /\['icons\.svg', 'game-icons\.svg'\]\.includes\(relative\) \? 'public, max-age=300, must-revalidate'/);
});

test('design tokens: violet-black page, 4 columns of 3D cards, violet buttons, phone layouts, calm motion', () => {
  for (const c of ['#080610', '#100B1D', '#19112B', '#25173D']) assert.ok(css.includes(c), c);
  assert.match(css, /\.gl-grid\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:22px/);
  assert.match(css, /\.gl-card\{[^}]*border-radius:26px/);
  assert.match(css, /\.gl-play\{[^}]*height:48px[^}]*border-radius:14px/);
  assert.match(css, /\.gl-tile\{[^}]*width:56px;height:56px/);
  assert.match(css, /@media \(max-width:620px\)\{[\s\S]*\.gl-grid,\.gl-grid\[data-cols\]\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css, /#1E5BFF|#38D4FF/i, 'the library is violet, not the sea-blue of the rest of the site');
});

test('data: every update has a type and summary; «مميزة» games exist; streams carry the real join state', () => {
  for (const u of GAME_UPDATES) {
    assert.ok(['new', 'update', 'platform'].includes(u.type), u.title);
    assert.ok(u.summary && u.items.length, u.title);
    assert.ok(u.mode === 'all' || [...GAMES, ...EXTRA_GAMES].some((g) => g.mode === u.mode), u.mode);
  }
  const featured = GAMES.filter((g) => g.featured);
  assert.ok(featured.length >= 1 && featured.every((g) => g.status === 'available'));
  assert.match(server, /joinOpen: st\.state === 'waiting'/);
  // the page never invents streams or games: no sample data in the script
  assert.doesNotMatch(js, /displayName:\s*'|players:\s*\d/);
  assert.match(js, /fetch\('\/api\/streams'/);
  assert.match(js, /g\.status === 'available' \|\| g\.status === 'dev'/);
});

/* ---------------- in a real browser ---------------- */
let chromium = null;
for (const base of [process.cwd(), (() => { try { return execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } })()]) {
  try { chromium = createRequire(path.join(base, 'x.js'))('playwright').chromium; break; } catch {}
}
const dbUrl = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/visual';
let pgOk = false; try { const pg = (await import('pg')).default; const c = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 2000 }); await c.connect(); await c.end(); pgOk = true; } catch {}
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }

const STREAMS = { streams: [
  { room: 'a1', platform: 'tiktok', username: 'host.one', displayName: 'مضيف واحد', avatarUrl: '', liveUrl: 'https://www.tiktok.com/@host.one/live', state: 'waiting', joinOpen: true, keyword: 'انضم', players: 4, active: false, mode: 'chain', currentGame: 'سلسلة الكلمات' },
  { room: 'a2', platform: 'kick', username: 'host_two', displayName: 'Host Two', avatarUrl: '', liveUrl: 'https://kick.com/host_two', state: 'running', joinOpen: false, players: 12, active: true, mode: 'quiz', currentGame: 'تحدي المعرفة' },
], totalStreams: 2, totalPlayers: 16 };

test('in a real browser: desktop layout, filters with search, card states, live rail, updates, phones', { skip: !chromium ? 'no Playwright' : !pgOk ? 'no PostgreSQL' : false, timeout: 120_000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), NODE_ENV: 'test', ADMIN_TOKEN: 'owner-token-library-test-1', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-lib-')), DATABASE_URL: dbUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await new Promise((r) => setTimeout(r, 50)); }
  const base = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch();
  try {
    const playable = [...GAMES, ...EXTRA_GAMES].filter((g) => g.status === 'available');
    // desktop, at the size of the reference comparison
    const ctx = await browser.newContext({ viewport: { width: 1732, height: 815 } });
    let streams = STREAMS;
    await ctx.route('**/api/streams', (r) => r.fulfill({ json: streams }));
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(base + '/games', { waitUntil: 'networkidle' });
    await p.waitForSelector('.gl-card');
    const m = await p.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left, y: b.top + scrollY, w: b.width, h: b.height }; };
      const cs = getComputedStyle(document.getElementById('gameGrid'));
      return { header: r('.gl-top'), h1: getComputedStyle(document.querySelector('.gl-hero h1')).fontSize, card: r('.gl-card'), play: r('.gl-card .gl-play'), cols: cs.gridTemplateColumns.split(' ').length, gap: cs.columnGap,
        cards: document.querySelectorAll('.gl-card').length, links: [...document.querySelectorAll('.gl-card .gl-play')].map((a) => a.getAttribute('href')), bg: getComputedStyle(document.documentElement).backgroundColor, sw: document.documentElement.scrollWidth, iw: innerWidth };
    });
    assert.equal(m.cols, 4); assert.equal(m.gap, '22px');
    assert.ok(m.card.w > 380 && m.card.w < 430, 'card width near the reference 408px: ' + m.card.w);
    assert.ok(m.card.h >= 340, 'card height near the reference: ' + m.card.h);
    assert.equal(m.play.h, 48); assert.equal(Math.round(m.header.h), 76); assert.equal(m.h1, '60px');
    assert.equal(m.bg, 'rgb(8, 6, 16)'); assert.equal(m.sw, m.iw);
    assert.equal(m.cards, playable.length, 'every finished game, free');
    assert.ok(m.links.every((h) => /^\/game\/[a-z]+$/.test(h)), '«العب الآن» opens the game page directly');
    // the icons really draw (a missing sprite symbol leaves an empty box)
    const drawn = await p.evaluate(() => ['.gl-card .gl-play svg use', '.gl-card .gl-tile svg use', '.gl-cta svg use', '.gl-upd-play svg use'].map((s) => { const u = document.querySelector(s); const b = u && u.getBBox(); return s + ':' + (b ? Math.round(b.width) : 0); }));
    for (const d of drawn) assert.ok(!d.endsWith(':0'), 'icon drawn: ' + d);
    // card states
    const badges = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.gl-card')].map((c) => [c.dataset.mode, [...c.querySelectorAll('.gl-badge')].map((b) => b.textContent)])));
    assert.deepEqual(badges.chain, ['جديد']);
    assert.ok(badges.quiz.includes('تم التحديث'));
    for (const g of GAMES.filter((x) => x.featured)) assert.ok(badges[g.mode].includes('مميزة'), g.mode);
    // filters and search work together, without reloading the page
    const marker = await p.evaluate(() => (window.__same = 1));
    await p.click('[data-filter=elimination]');
    let cats = await p.$$eval('.gl-card .gl-cat', (n) => n.map((x) => x.dataset.cat));
    assert.ok(cats.length > 0 && cats.every((c) => c === 'elimination'));
    await p.fill('#gameSearch', 'قنبله'); await p.waitForTimeout(250);
    let titles = await p.$$eval('.gl-card .gl-title', (n) => n.map((x) => x.textContent));
    assert.deepEqual(titles, ['القنبلة الموقوتة'], 'ة/ه written either way');
    assert.match(p.url(), /\/games\?cat=elimination&q=/);
    await p.click('[data-filter=smart]');
    assert.equal(await p.locator('.gl-card').count(), 0);
    assert.equal(await p.isVisible('#gridEmpty'), true);
    await p.click('#clearFilters');
    assert.equal(await p.locator('.gl-card').count(), playable.length);
    await p.click('[data-filter=new]');
    assert.deepEqual(await p.$$eval('.gl-card .gl-title', (n) => n.map((x) => x.textContent)), playable.filter((g) => g.isNew).map((g) => g.title));
    assert.equal(await p.evaluate(() => window.__same), marker, 'no page reload');
    await p.click('[data-filter=all]');
    // the live rail: verified streams from the server, «انضم» only while registration is open
    assert.equal(await p.locator('.gl-lc').count(), 2);
    assert.equal(await p.textContent('#liveCount'), '(2)');
    const live = await p.$$eval('.gl-lc', (n) => n.map((c) => ({ btn: c.querySelector('.gl-lc-btn').textContent.trim(), href: c.querySelector('.gl-lc-btn').href, tag: c.querySelector('.gl-lc-tag').textContent, word: c.querySelector('.gl-chip.is-word')?.textContent || '' })));
    assert.deepEqual(live.map((x) => x.btn), ['انضم', 'شاهد']);
    assert.equal(live[0].word, 'اكتب: انضم'); assert.ok(live.every((x) => x.tag === 'LIVE' && x.href.startsWith('https://')));
    assert.equal(await p.isVisible('#liveEmpty'), false);
    // no streams: a real empty state, nothing invented
    streams = { streams: [], totalStreams: 0, totalPlayers: 0 };
    await p.reload({ waitUntil: 'networkidle' }); await p.waitForSelector('.gl-card');
    assert.equal(await p.locator('.gl-lc').count(), 0); assert.equal(await p.isVisible('#liveEmpty'), true); assert.equal(await p.isVisible('#liveRail'), false);
    // «آخر التحديثات»: three at first, a type filter, «عرض كل التحديثات»
    assert.equal(await p.locator('.gl-upd:visible').count(), Math.min(3, GAME_UPDATES.length));
    await p.click('#updFilters [data-type=new]');
    assert.equal(await p.locator('.gl-upd').count(), GAME_UPDATES.filter((u) => u.type === 'new').length);
    await p.click('#updFilters [data-type=all]');
    if (GAME_UPDATES.length > 3) { await p.click('#updMore'); assert.equal(await p.locator('.gl-upd:visible').count(), GAME_UPDATES.length); }
    // the connection card for a visitor: sign in, then link
    assert.equal(await p.getAttribute('#connLink', 'href'), '/login?next=%2Faccount%23platforms');
    assert.equal(await p.textContent('#connLink'), 'ربط حساب البث');
    // «العب الآن» shows a loading state while the game page opens
    assert.deepEqual(errors, []);
    const loading = await p.evaluate(() => { const a = document.querySelector('.gl-card[data-mode=quiz] .gl-play'); a.click(); return [a.className, a.getAttribute('aria-busy'), a.textContent]; });
    assert.match(loading[0], /is-loading/); assert.equal(loading[1], 'true'); assert.equal(loading[2], 'جارٍ فتح اللعبة…');
    await p.waitForURL(/\/login\?next=%2Fgame%2Fquiz/);
    await ctx.close();

    // a game still in development: shown as such, never playable
    const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await dctx.route('**/api/site', async (r) => { const res = await r.fetch(); const j = await res.json(); j.extraGames = [...j.extraGames, { ...j.extraGames[0], mode: 'devgame', title: 'لعبة قيد التطوير', status: 'dev', isNew: false }]; r.fulfill({ response: res, json: j }); });
    const d = await dctx.newPage(); await d.goto(base + '/games', { waitUntil: 'networkidle' }); await d.waitForSelector('.gl-card');
    const dev = d.locator('.gl-card[data-mode=devgame] .gl-play');
    assert.equal(await dev.getAttribute('aria-disabled'), 'true'); assert.equal(await dev.getAttribute('href'), null);
    assert.equal(await d.textContent('.gl-card[data-mode=devgame] .gl-badge'), 'قيد التطوير');
    assert.equal(await d.evaluate(() => getComputedStyle(document.getElementById('gameGrid')).gridTemplateColumns.split(' ').length), 4);
    await dctx.close();

    // phones: one column, nothing wider than the screen, filters scroll sideways, the bottom bar never hides content
    for (const width of [320, 390, 430]) {
      const mctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await mctx.route('**/api/streams', (r) => r.fulfill({ json: STREAMS }));
      const q = await mctx.newPage(); await q.goto(base + '/games', { waitUntil: 'networkidle' }); await q.waitForSelector('.gl-card');
      const mm = await q.evaluate(() => ({ cols: getComputedStyle(document.getElementById('gameGrid')).gridTemplateColumns.split(' ').length, sw: document.documentElement.scrollWidth, iw: innerWidth,
        filtersScroll: (() => { const f = document.getElementById('filters'); return getComputedStyle(f).overflowX; })(),
        titleFits: [...document.querySelectorAll('.gl-card .gl-title')].every((t) => t.scrollWidth <= t.clientWidth + 1),
        nav: !!document.getElementById('bottomNav'), active: document.querySelector('#bottomNav [aria-current=page]')?.dataset.key || null,
        pad: parseFloat(getComputedStyle(document.body).paddingBottom) }));
      assert.equal(mm.cols, 1, width + 'px: one column'); assert.equal(mm.sw, mm.iw, width + 'px: no sideways scroll');
      assert.equal(mm.filtersScroll, 'auto'); assert.ok(mm.titleFits, 'game names are not cut');
      assert.ok(mm.nav && mm.active === 'studio', 'the bottom bar shows «ألعاب البث» as the current page');
      assert.ok(mm.pad >= 72, 'room for the bottom bar: ' + mm.pad);
      await mctx.close();
    }
    // a tablet: two columns
    const tctx = await browser.newContext({ viewport: { width: 820, height: 1000 } });
    const tp = await tctx.newPage(); await tp.goto(base + '/games', { waitUntil: 'networkidle' }); await tp.waitForSelector('.gl-card');
    assert.equal(await tp.evaluate(() => getComputedStyle(document.getElementById('gameGrid')).gridTemplateColumns.split(' ').length), 2);
    await tctx.close();
  } finally { await browser.close(); child.kill(); await once(child, 'exit').catch(() => {}); }
});
