// Search-engine readiness, checked on every change: robots.txt, sitemap.xml, one address per public page,
// canonical/Open Graph/structured data on every indexable page, «noindex» on everything private, the games library
// readable without JavaScript, no broken internal links or assets, and a real browser render without errors.
// Nothing here calls a third-party service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { SITE_URL, INDEXABLE_PAGES, FILE_ALIASES, seoRedirect, robotsHeader, robotsTxt, sitemapXml, verificationMeta, indexNowKey, gameCardsHtml, libraryOrder, renderLibrary, SPRITE, GAME_SPRITE } from '../src/seo.mjs';
import { ALL_GAMES, GAME_UPDATES } from '../src/catalog.mjs';
import { submitIndexNow } from '../tools/indexnow.mjs';

const root = new URL('..', import.meta.url);
const pub = (f) => fs.readFileSync(new URL('public/' + f, root), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const attr = (tag, name) => (new RegExp(`\\s${name}="([^"]*)"`).exec(tag) || [])[1];
const metas = (html) => [...html.matchAll(/<meta\s[^>]*>/g)].map((m) => m[0]);
const metaContent = (html, key) => metas(html).filter((t) => attr(t, 'name') === key || attr(t, 'property') === key).map((t) => attr(t, 'content'));
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }
async function boot(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, DATABASE_URL: '', PORT: String(port), ADMIN_TOKEN: 'seo-test-owner-token-0123456789', NODE_ENV: 'test',
    SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-seo-')), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await sleep(50); }
  return { base: 'http://127.0.0.1:' + port, stop: async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } } };
}

/* ------------------------------------------------------------------ rules (no server) */
test('robots.txt allows crawling, keeps assets open and points to the absolute sitemap', () => {
  const txt = robotsTxt('https://spongelive.com');
  assert.match(txt, /^User-agent: \*$/m);
  assert.match(txt, /^Allow: \/$/m);
  assert.match(txt, /^Sitemap: https:\/\/spongelive\.com\/sitemap\.xml$/m);
  const disallowed = [...txt.matchAll(/^Disallow:\s*(\S*)$/gm)].map((m) => m[1]);
  assert.ok(!disallowed.includes('/') && !disallowed.includes(''), 'never blocks the whole site');
  for (const p of disallowed) {
    assert.ok(p.startsWith('/api/') || p === '/go/', 'only redirect/API endpoints are disallowed: ' + p);
    for (const asset of ['/home.css', '/games.js', '/brand/og-1200x630.png', '/fonts/x.woff2', '/api/site', '/api/streams', '/api/access/me'])
      assert.ok(!asset.startsWith(p), asset + ' (needed to render public pages) must stay crawlable');
    for (const page of INDEXABLE_PAGES) assert.ok(!page.path.startsWith(p), page.path + ' must stay crawlable');
  }
});

test('sitemap.xml is valid, lists only indexable canonical pages with real dates', () => {
  const xml = sitemapXml('https://spongelive.com');
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<\/urlset>\n$/);
  const opened = (xml.match(/<url>/g) || []).length, closed = (xml.match(/<\/url>/g) || []).length;
  assert.equal(opened, closed);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, INDEXABLE_PAGES.length);
  assert.equal(new Set(locs).size, locs.length, 'no duplicate URLs');
  for (const loc of locs) { const u = new URL(loc); assert.equal(u.origin, 'https://spongelive.com'); assert.equal(u.search, ''); assert.equal(u.hash, ''); assert.ok(u.pathname === '/' || !u.pathname.endsWith('/')); }
  for (const m of xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) {
    assert.match(m[1], /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(new Date(m[1] + 'T00:00:00Z').getTime() <= Date.now() + 86_400_000, 'lastmod is not in the future');
  }
  for (const bad of ['/login', '/signup', '/account', '/admin', '/overlay', '/dashboard', '/api', '/play', '/role', '/draw', '/game/', '/u/', '/tool', '/privacy', '/terms', '/refund'])
    assert.ok(!locs.some((l) => new URL(l).pathname.startsWith(bad) && new URL(l).pathname !== '/'), 'sitemap must not list ' + bad);
});

test('lastmod follows the last commit that changed each page (when git history is available)', (t) => {
  let shallow = true;
  try { shallow = execSync('git rev-parse --is-shallow-repository', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== 'false'; } catch { /* no git */ }
  if (shallow) return t.skip('no full git history');
  // a page's content also comes from the data the server renders into it: «مكتبة الألعاب» shows the game catalogue
  const sources = { '/games': ['src/catalog.mjs'] };
  for (const p of INDEXABLE_PAGES) {
    const files = ['public/' + p.file, ...(sources[p.path] || [])].join(' ');
    const day = execSync(`git log -1 --format=%cs -- ${files}`, { cwd: root }).toString().trim();
    if (!day) continue; // not committed yet
    // one day of slack for commits made around midnight in another time zone
    assert.ok(new Date(p.lastmod) >= new Date(new Date(day).getTime() - 86_400_000), `${p.path}: lastmod ${p.lastmod} is older than its last change (${day}) — update src/seo.mjs`);
  }
});

test('one address per page: file names, trailing slashes and other hosts redirect permanently; app routes stay', () => {
  const r = (o) => seoRedirect({ method: 'GET', production: true, host: 'spongelive.com', search: '', siteUrl: 'https://spongelive.com', ...o });
  for (const [file, clean] of Object.entries(FILE_ALIASES)) assert.equal(r({ pathname: file }), clean);
  assert.equal(r({ pathname: '/games/' }), '/games');
  assert.equal(r({ pathname: '/guide/games/' }), '/guide/games');
  assert.equal(r({ pathname: '/' }), null);
  assert.equal(r({ pathname: '/games' }), null);
  assert.equal(r({ pathname: '/games', host: 'liveverse-tiktok-events.onrender.com', search: '?utm_source=x' }), 'https://spongelive.com/games?utm_source=x');
  assert.equal(r({ pathname: '/', host: 'www.spongelive.com' }), 'https://spongelive.com/');
  assert.equal(r({ pathname: '/home.html', host: 'liveverse-tiktok-events.onrender.com' }), 'https://spongelive.com/');
  // sign-in, OAuth callbacks, OBS overlays, join pages, APIs and WebSockets keep working on every host
  for (const pathname of ['/login', '/signup', '/account', '/overlay', '/play', '/role', '/draw', '/game/roulette', '/api/oauth/google/callback', '/api/oauth/tiktok/callback', '/api/kick/webhook', '/ws', '/robots.txt', '/sitemap.xml'])
    assert.equal(r({ pathname, host: 'liveverse-tiktok-events.onrender.com' }), null, pathname);
  assert.equal(r({ pathname: '/games', host: 'liveverse-tiktok-events.onrender.com', method: 'POST' }), null);
  // a signed-in visitor on Render's address stays there (sessions are per host); file names are still cleaned up
  assert.equal(r({ pathname: '/games', host: 'liveverse-tiktok-events.onrender.com', signedIn: true }), null);
  assert.equal(r({ pathname: '/', host: 'liveverse-tiktok-events.onrender.com', signedIn: true }), null);
  assert.equal(r({ pathname: '/home.html', host: 'liveverse-tiktok-events.onrender.com', signedIn: true }), '/');
  assert.equal(r({ pathname: '/games', host: 'localhost:3000', production: false }), null, 'local development is never redirected');
  assert.equal(r({ pathname: '/games', host: 'evil.example' }), null, 'unknown hosts are not redirected');
});

test('only the canonical public pages may be indexed', () => {
  const h = (pathname, host = 'spongelive.com') => robotsHeader({ host, pathname, production: true, siteUrl: 'https://spongelive.com' });
  for (const p of INDEXABLE_PAGES) assert.equal(h(p.path), null, p.path);
  for (const p of INDEXABLE_PAGES) assert.equal(h(p.path, 'liveverse-tiktok-events.onrender.com'), 'noindex', 'duplicate host: ' + p.path);
  for (const p of ['/login', '/signup', '/forgot', '/reset', '/account', '/admin', '/dashboard', '/overlay', '/play', '/role', '/draw', '/event', '/bomb', '/tools', '/tool', '/game/quiz', '/u/SPG-ABC234', '/privacy', '/terms', '/refund'])
    assert.equal(h(p), 'noindex', p);
});

test('ownership tags and the IndexNow key accept only well-formed tokens', () => {
  assert.equal(verificationMeta({}), '');
  assert.equal(verificationMeta({ GOOGLE_SITE_VERIFICATION: 'abc"><script>' }), '');
  assert.equal(verificationMeta({ GOOGLE_SITE_VERIFICATION: 'AbC_123-xyzTOKEN' }), '<meta name="google-site-verification" content="AbC_123-xyzTOKEN">\n');
  assert.match(verificationMeta({ BING_SITE_VERIFICATION: '0123456789ABCDEF0123456789ABCDEF' }), /^<meta name="msvalidate\.01" content="0123456789ABCDEF0123456789ABCDEF">\n$/);
  assert.equal(indexNowKey({ INDEXNOW_KEY: 'short' }), '');
  assert.equal(indexNowKey({ INDEXNOW_KEY: '../../etc/passwd' }), '');
  assert.equal(indexNowKey({ INDEXNOW_KEY: 'a1b2c3d4e5f6a7b8' }), 'a1b2c3d4e5f6a7b8');
});

test('IndexNow sends only changed public pages, checks the key file first and reports refusals', async () => {
  const env = { INDEXNOW_KEY: 'a1b2c3d4e5f6a7b8c9d0' };
  const calls = [];
  const okFetch = async (url, init) => { calls.push({ url, init }); return url.endsWith('.txt') ? new Response(env.INDEXNOW_KEY) : new Response('', { status: 202 }); };
  const quiet = () => {};
  await assert.rejects(submitIndexNow({ since: '2026-01-01', env: {}, fetchImpl: okFetch, log: quiet }), /INDEXNOW_KEY/);
  await assert.rejects(submitIndexNow({ env, fetchImpl: okFetch, log: quiet }), /--since/);
  const dry = await submitIndexNow({ since: '2000-01-01', dryRun: true, env, fetchImpl: okFetch, log: quiet });
  assert.equal(calls.length, 0, 'a dry run sends nothing');
  assert.deepEqual(dry.urlList, INDEXABLE_PAGES.map((p) => SITE_URL + p.path));
  assert.equal((await submitIndexNow({ since: '2999-01-01', env, fetchImpl: okFetch, log: quiet })).sent, 0, 'nothing changed → nothing sent');
  const res = await submitIndexNow({ since: '2000-01-01', env, fetchImpl: okFetch, log: quiet });
  assert.equal(res.status, 202);
  const post = calls.find((c) => c.init?.method === 'POST');
  const body = JSON.parse(post.init.body);
  assert.equal(body.key, env.INDEXNOW_KEY);
  assert.equal(body.keyLocation, SITE_URL + '/' + env.INDEXNOW_KEY + '.txt');
  assert.equal(body.host, new URL(SITE_URL).host);
  for (const u of body.urlList) assert.ok(INDEXABLE_PAGES.some((p) => SITE_URL + p.path === u), 'only sitemap pages: ' + u);
  await assert.rejects(submitIndexNow({ since: '2000-01-01', env, log: quiet, fetchImpl: async (u) => (u.endsWith('.txt') ? new Response('other-key') : new Response('', { status: 200 })) }), /does not serve this key/);
  await assert.rejects(submitIndexNow({ since: '2000-01-01', env, log: quiet, fetchImpl: async (u) => (u.endsWith('.txt') ? new Response(env.INDEXNOW_KEY) : new Response('', { status: 429 })) }), /429/);
});

test('library cards in the first HTML match games.js: order, honest status, escaped text, same sprites', () => {
  const js = pub('games.js');
  assert.ok(js.includes(`SPRITE = '${SPRITE}'`) && js.includes(`GAME_SPRITE = '${GAME_SPRITE}'`), 'sprite versions match public/games.js');
  const games = ALL_GAMES.map((g) => ({ ...g, status: g.mode === 'roulette' ? 'available' : 'dev' }));
  const html = gameCardsHtml(games, GAME_UPDATES);
  assert.equal((html.match(/<li class="gl-card/g) || []).length, ALL_GAMES.length);
  assert.equal(libraryOrder(games)[0].status, 'available', 'released games first');
  // a game under development never offers «العب الآن» or a link into the game
  for (const g of games.filter((x) => x.status === 'dev')) {
    const card = html.split('<li ').find((c) => c.includes(`data-mode="${g.mode}"`));
    assert.match(card, /قيد التطوير/); assert.doesNotMatch(card, /href="\/game\//);
  }
  assert.match(html, /<a class="gl-play" href="\/game\/roulette"/);
  const evil = gameCardsHtml([{ mode: 'x', title: '<img src=x onerror=alert(1)>', summary: '"><b>', category: 'smart', categoryLabel: 'a&b', rules: [], status: 'available' }]);
  assert.doesNotMatch(evil, /<img|<b>/); assert.match(evil, /a&amp;b/);
  const page = renderLibrary(pub('games.html'), games.map((g) => ({ ...g, status: 'dev' })), []);
  assert.match(page, /<p class="gl-devstrip" id="devStrip">/, 'the «under development» note shows when no game is released');
});

/* ------------------------------------------------------------------ page metadata (source files) */
test('every indexable page: title, description, one H1, heading order, Arabic RTL, canonical, Open Graph, JSON-LD, alt text', () => {
  const titles = new Set(), descs = new Set();
  for (const p of INDEXABLE_PAGES) {
    const html = pub(p.file), where = p.path;
    assert.match(html, /^<!doctype html>\n<html lang="ar" dir="rtl"/i, where + ': lang="ar" dir="rtl"');
    const title = [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);
    assert.equal(title.length, 1, where + ': one <title>'); assert.ok(title[0].length >= 15 && title[0].length <= 70, where + ': title length ' + title[0].length);
    assert.ok(/سبونج لايف/.test(title[0]), where + ': brand in title'); assert.ok(!titles.has(title[0]), where + ': unique title'); titles.add(title[0]);
    const desc = metaContent(html, 'description');
    assert.equal(desc.length, 1, where + ': one description'); assert.ok(desc[0].length >= 70 && desc[0].length <= 160, where + ': description length ' + desc[0].length);
    assert.ok(!descs.has(desc[0]), where + ': unique description'); descs.add(desc[0]);
    assert.equal(metaContent(html, 'robots').filter((v) => /noindex/i.test(v)).length, 0, where + ': not noindex');
    const canon = [...html.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(canon, [SITE_URL + p.path], where + ': one absolute canonical');
    assert.deepEqual(metaContent(html, 'og:url'), [SITE_URL + p.path]);
    assert.deepEqual(metaContent(html, 'og:title'), title); assert.deepEqual(metaContent(html, 'og:description'), desc);
    for (const k of ['og:type', 'og:site_name', 'og:locale', 'og:image', 'og:image:alt', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) assert.equal(metaContent(html, k).length, 1, where + ': ' + k);
    for (const k of ['og:image', 'twitter:image']) { const u = new URL(metaContent(html, k)[0]); assert.equal(u.origin, SITE_URL); assert.ok(fs.existsSync(new URL('public' + u.pathname, root)), k + ' file exists'); }
    assert.equal(metaContent(html, 'twitter:card')[0], 'summary_large_image');
    // headings: exactly one H1, no level skipped on the way down
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => +m[1]);
    assert.equal(levels.filter((l) => l === 1).length, 1, where + ': one H1'); assert.equal(levels[0], 1, where + ': H1 comes first');
    for (let i = 1; i < levels.length; i++) assert.ok(levels[i] <= levels[i - 1] + 1, `${where}: heading jumps from h${levels[i - 1]} to h${levels[i]}`);
    for (const img of html.matchAll(/<img\s[^>]*>/g)) assert.ok(/\salt="/.test(img[0]), where + ': <img> without alt: ' + img[0].slice(0, 80));
    // structured data parses and only claims what the page shows
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    assert.equal(ld.length, 1, where + ': one JSON-LD block');
    assert.equal(ld[0]['@context'], 'https://schema.org');
    const flat = JSON.stringify(ld);
    for (const fake of ['aggregateRating', 'review', 'award', '"price"', 'offers']) assert.ok(!flat.includes(fake), where + ': no invented ' + fake);
    for (const u of flat.match(/https?:\/\/[^"]+/g) || []) if (!u.startsWith('https://schema.org')) assert.ok(u.startsWith(SITE_URL), where + ': JSON-LD URL on the site: ' + u);
    assert.ok(textOf(html).length > 600, where + ': meaningful text in the HTML itself');
  }
  const home = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(pub('home.html'))[1]);
  assert.deepEqual(home['@graph'].map((n) => n['@type']).sort(), ['Organization', 'WebSite']);
});

/* ------------------------------------------------------------------ over HTTP */
test('over HTTP: status codes, robots.txt, sitemap, noindex policy, server-rendered library, links and assets', async () => {
  const srv = await boot();
  try {
    const get = (p, init) => fetch(srv.base + p, { redirect: 'manual', ...init });
    const robots = await get('/robots.txt');
    assert.equal(robots.status, 200); assert.match(robots.headers.get('content-type'), /^text\/plain/);
    assert.equal(await robots.text(), robotsTxt());
    const sm = await get('/sitemap.xml');
    assert.equal(sm.status, 200); assert.match(sm.headers.get('content-type'), /^application\/xml/);
    const locs = [...(await sm.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    assert.deepEqual(locs, INDEXABLE_PAGES.map((p) => p.path));
    const seen = new Set(), assets = new Set();
    for (const p of locs) {
      const res = await get(p);
      assert.equal(res.status, 200, p + ' answers 200 (no redirect, no error)');
      assert.match(res.headers.get('content-type'), /^text\/html/);
      assert.equal(res.headers.get('x-robots-tag'), null, p + ' is indexable');
      const html = await res.text();
      // the server may add ?v= hashes to CSS/JS, nothing else changes the head
      assert.equal((html.match(/<link rel="canonical"/g) || []).length, 1, p + ': one canonical');
      for (const m of html.matchAll(/\shref="(\/[^"#]*)(?:#[^"]*)?"/g)) seen.add(m[1]);
      for (const m of html.matchAll(/\s(?:src|srcset)="([^"]+)"/g)) for (const part of m[1].split(',')) { const u = part.trim().split(/\s+/)[0]; if (u.startsWith('/')) assets.add(u); }
      for (const m of html.matchAll(/<use href="([^"#]+)#/g)) assets.add(m[1]);
    }
    // the library is readable without JavaScript: every game, with its status
    const lib = await (await get('/games')).text();
    for (const g of ALL_GAMES) assert.ok(lib.includes(`data-mode="${g.mode}"`) && lib.includes(g.title.replace(/&/g, '&amp;')), 'library HTML lists ' + g.title);
    // every internal link on the public pages leads somewhere (redirects to sign-in are fine, errors are not)
    for (const href of seen) {
      const res = await get(href);
      assert.ok(res.status < 400, `broken internal link ${href}: ${res.status}`);
      if (res.status === 301) assert.fail('internal link points to a redirected address: ' + href);
    }
    for (const a of assets) assert.equal((await get(a)).status, 200, 'missing asset ' + a);
    // duplicates answer 301 to the clean address
    for (const [file, clean] of Object.entries(FILE_ALIASES)) { const r = await get(file); assert.equal(r.status, 301, file); assert.equal(r.headers.get('location'), clean); }
    assert.equal((await get('/games/')).headers.get('location'), '/games');
    // private and app pages: signed-out visitors are sent to sign-in, or the page carries noindex
    for (const p of ['/login', '/signup', '/forgot', '/reset', '/overlay', '/play?room=abc', '/role', '/draw', '/tool', '/u/SPG-ABC234', '/privacy', '/terms', '/refund', '/game/quiz', '/bomb', '/index.html', '/studio.html', '/me.html', '/overlay.html']) {
      const r = await get(p);
      assert.ok(r.status === 200 || r.status === 302, p + ': ' + r.status);
      if (r.status === 200 && /^text\/html/.test(r.headers.get('content-type'))) assert.equal(r.headers.get('x-robots-tag'), 'noindex', p + ' must carry noindex');
    }
    for (const p of ['/account', '/admin', '/dashboard', '/tools', '/event']) assert.equal((await get(p)).status, 302, p + ' needs sign-in');
    // unknown addresses are real 404s (no soft 404), APIs are never indexed
    for (const p of ['/does-not-exist', '/game/nope', '/guide/nope', '/.env', '/server.mjs']) assert.equal((await get(p)).status, 404, p);
    assert.equal((await get('/api/site')).headers.get('x-robots-tag'), 'noindex');
    assert.equal((await get('/indexnow-key-not-set.txt')).status, 404, 'no key file without INDEXNOW_KEY');
  } finally { await srv.stop(); }
});

test('over HTTP in production: other hosts redirect to the canonical address, HSTS, verification tags, IndexNow key file', async () => {
  const srv = await boot({ NODE_ENV: 'production', GOOGLE_SITE_VERIFICATION: 'TestToken_123-abc', INDEXNOW_KEY: 'a1b2c3d4e5f6a7b8c9d0' });
  try {
    // fetch() cannot set the Host header, so these requests use node:http
    const get = (p, host, extra = { 'X-Forwarded-Proto': 'https' }) => new Promise((resolve, reject) => {
      const req = http.request(srv.base + p, { headers: { Host: host, ...extra } }, (res) => {
        let body = ''; res.setEncoding('utf8'); res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: { get: (k) => res.headers[k.toLowerCase()] ?? null }, text: async () => body }));
      });
      req.on('error', reject); req.end();
    });
    let r = await get('/games?utm_source=x', 'liveverse-tiktok-events.onrender.com');
    assert.equal(r.status, 301); assert.equal(r.headers.get('location'), SITE_URL + '/games?utm_source=x');
    r = await get('/', 'www.' + new URL(SITE_URL).host); assert.equal(r.headers.get('location'), SITE_URL + '/');
    r = await get('/games', 'liveverse-tiktok-events.onrender.com', { 'X-Forwarded-Proto': 'https', Cookie: 'sky_session=abc' });
    assert.equal(r.status, 200, 'a signed-in visitor is not moved to another host (they would lose their session)');
    assert.equal(r.headers.get('x-robots-tag'), 'noindex', '…and the page is still not indexable there');
    r = await get('/login', 'liveverse-tiktok-events.onrender.com'); assert.equal(r.status, 200, 'sign-in still works on Render\'s address'); assert.equal(r.headers.get('x-robots-tag'), 'noindex');
    r = await get('/overlay', 'liveverse-tiktok-events.onrender.com'); assert.equal(r.status, 200, 'OBS overlays keep working'); assert.equal(r.headers.get('x-robots-tag'), 'noindex');
    r = await get('/', new URL(SITE_URL).host);
    assert.equal(r.status, 200); assert.equal(r.headers.get('strict-transport-security'), 'max-age=31536000'); assert.equal(r.headers.get('x-robots-tag'), null);
    assert.match(await r.text(), /<meta name="google-site-verification" content="TestToken_123-abc">\n<\/head>/);
    // games.js and the server render the same library: the CSP allows no inline style in the cards
    assert.doesNotMatch(await (await get('/games', new URL(SITE_URL).host)).text(), /<li class="gl-card[^>]*style=/);
    assert.doesNotMatch(await (await get('/games', new URL(SITE_URL).host)).text(), /google-site-verification/, 'the tag is only on the home page');
    r = await get('/a1b2c3d4e5f6a7b8c9d0.txt', new URL(SITE_URL).host); assert.equal(r.status, 200); assert.equal(await r.text(), 'a1b2c3d4e5f6a7b8c9d0');
    r = await get('/', new URL(SITE_URL).host, {}); assert.equal(r.headers.get('strict-transport-security'), null, 'no HSTS on plain http');
  } finally { await srv.stop(); }
});

test('a different SITE_URL moves canonicals, Open Graph, JSON-LD, the sitemap and the redirects together', async () => {
  const srv = await boot({ NODE_ENV: 'production', SITE_URL: 'https://www.example.org' });
  try {
    const html = await (await fetch(srv.base + '/games')).text();
    assert.match(html, /<link rel="canonical" href="https:\/\/www\.example\.org\/games">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/www\.example\.org\/brand\/og-1200x630\.png">/);
    assert.doesNotMatch(html, /spongelive\.com/);
    assert.doesNotMatch(await (await fetch(srv.base + '/')).text(), /spongelive\.com/);
    assert.match(await (await fetch(srv.base + '/sitemap.xml')).text(), /<loc>https:\/\/www\.example\.org\/guide\/tools<\/loc>/);
    assert.match(await (await fetch(srv.base + '/robots.txt')).text(), /^Sitemap: https:\/\/www\.example\.org\/sitemap\.xml$/m);
  } finally { await srv.stop(); }
});

/* ------------------------------------------------------------------ real browser */
let chromium = null;
for (const base of [process.cwd(), (() => { try { return execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } })()]) {
  try { chromium = createRequire(path.join(base, 'x.js'))('playwright').chromium; break; } catch {}
}
test('in a browser (phone and desktop): public pages render without errors, failed requests or sideways scrolling', { skip: !chromium && 'no Playwright' }, async () => {
  const srv = await boot();
  const browser = await chromium.launch();
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 900 }]) {
      const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
      for (const p of INDEXABLE_PAGES) {
        const page = await ctx.newPage(), problems = [];
        page.on('pageerror', (e) => problems.push('error: ' + e.message));
        page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
        page.on('response', (r) => { if (r.status() >= 400) problems.push(r.status() + ' ' + r.url()); });
        // requests the browser itself cancels (a poll cut short by navigation) are not failures
        page.on('requestfailed', (r) => { if (!/ERR_ABORTED/.test(r.failure()?.errorText || '')) problems.push('failed: ' + r.url() + ' ' + r.failure()?.errorText); });
        await page.goto(srv.base + p.path, { waitUntil: 'networkidle' });
        const d = await page.evaluate(() => ({ h1: document.querySelectorAll('h1').length, lang: document.documentElement.lang, dir: document.documentElement.dir, wide: document.documentElement.scrollWidth > innerWidth + 1, cards: document.querySelectorAll('#gameGrid .gl-card').length }));
        assert.deepEqual(problems, [], `${p.path} @${viewport.width}px`);
        assert.equal(d.h1, 1); assert.equal(d.lang, 'ar'); assert.equal(d.dir, 'rtl');
        assert.equal(d.wide, false, `${p.path} @${viewport.width}px scrolls sideways`);
        if (p.path === '/games') assert.equal(d.cards, ALL_GAMES.length, 'games.js keeps every game after taking over the server-rendered cards');
        await page.close();
      }
      await ctx.close();
    }
    // the server-rendered cards play their entrance once: when games.js swaps in the live cards (here after a slow
    // /api/site), they must not vanish and fade in a second time
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.route('**/api/site', async (r) => { await sleep(800); await r.continue(); });
    await page.addInitScript(() => { window.__op = []; const t0 = performance.now(); const tick = () => { const c = document.querySelector('#gameGrid .gl-card'); if (c) window.__op.push([+getComputedStyle(c).opacity, c.classList.contains('no-in')]); if (performance.now() - t0 < 2600) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await page.goto(srv.base + '/games');
    await page.waitForFunction(() => performance.now() > 2700, null, { timeout: 10_000 });
    const op = await page.evaluate(() => window.__op);
    let max = 0, dips = 0; for (const [o] of op) { if (o < max - 0.05) dips++; max = Math.max(max, o); }
    assert.ok(op.some(([, swapped]) => swapped), 'games.js replaced the server-rendered cards');
    assert.equal(dips, 0, 'cards flash (fade out and in again) when the live data arrives');
    await page.close();
  } finally { await browser.close(); await srv.stop(); }
});
