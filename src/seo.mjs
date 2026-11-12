// سبونج لايف — search-engine rules in one place: which pages may be indexed, robots.txt, sitemap.xml, the
// canonical address, and the server-rendered game cards of «مكتبة الألعاب» (so the library is not an empty
// JavaScript shell for crawlers).
//
// Only the pages in INDEXABLE_PAGES may appear in search results. Every other HTML page (account, studio, OBS
// overlays, join pages, sign-in, profiles, notices) is sent with «X-Robots-Tag: noindex». robots.txt is not a
// security control: private pages are protected by sign-in on the server, never by robots.txt.

/** The address written in the public pages' canonical/Open Graph/JSON-LD tags (the server rewrites it to SITE_URL). */
export const DEFAULT_SITE_URL = 'https://spongelive.com';
/** The one public address of the site. Other hosts (Render's onrender.com address, www) send search engines here. */
export const SITE_URL = cleanSiteUrl(process.env.SITE_URL) || DEFAULT_SITE_URL;

function cleanSiteUrl(raw) {
  try { const u = new URL(String(raw || '').trim()); return u.protocol === 'https:' && !u.pathname.replace(/\/$/, '') && !u.search ? u.origin : ''; }
  catch { return ''; }
}

/**
 * The indexable pages, in sitemap order. lastmod is the date of the last meaningful change to the page's content
 * (YYYY-MM-DD). Update it in the same commit that changes the page — tests/seo.test.mjs checks it against git.
 */
export const INDEXABLE_PAGES = Object.freeze([
  { path: '/', file: 'home.html', lastmod: '2026-11-06' },
  { path: '/games', file: 'games.html', lastmod: '2026-11-12' },
  { path: '/guide/games', file: 'guide-games.html', lastmod: '2026-11-12' },
  { path: '/guide/tiktok-live', file: 'guide-tiktok.html', lastmod: '2026-11-06' },
  { path: '/guide/tools', file: 'guide-tools.html', lastmod: '2026-11-06' }
].map(Object.freeze));
const INDEXABLE = new Set(INDEXABLE_PAGES.map((p) => p.path));

export const isIndexablePath = (pathname) => INDEXABLE.has(pathname);

/** Raw file names of public pages → their clean address (one URL per page; the file name answers 301). */
export const FILE_ALIASES = Object.freeze({
  '/home.html': '/', '/games.html': '/games', '/guide-games.html': '/guide/games', '/guide-tiktok.html': '/guide/tiktok-live',
  '/guide-tools.html': '/guide/tools', '/privacy.html': '/privacy', '/terms.html': '/terms', '/refund.html': '/refund'
});

/**
 * Where a request for a public page should be sent permanently (301), or null. Only page addresses are moved:
 * sign-in, OAuth callbacks, OBS overlays, WebSockets and APIs keep working on every host.
 *  - /home.html, /games.html … → the clean address
 *  - /games/ → /games
 *  - on Render's own address or www (production only) → the same page on SITE_URL — but never for a visitor who
 *    carries a session cookie: sessions are per host, so moving them would sign them out (crawlers send no cookies;
 *    those pages still carry «noindex» on the other host)
 */
export function seoRedirect({ method, host, pathname, search = '', production = false, signedIn = false, siteUrl = SITE_URL }) {
  if (method !== 'GET' && method !== 'HEAD') return null;
  let path = pathname;
  if (FILE_ALIASES[path]) path = FILE_ALIASES[path];
  else if (path.length > 1 && path.endsWith('/') && INDEXABLE.has(path.replace(/\/+$/, ''))) path = path.replace(/\/+$/, '');
  const canonicalHost = new URL(siteUrl).host;
  const h = String(host || '').toLowerCase();
  const foreignHost = production && !signedIn && h && h !== canonicalHost && (h === 'www.' + canonicalHost || h.endsWith('.onrender.com'));
  if (foreignHost && (INDEXABLE.has(path) || path !== pathname)) return siteUrl + path + search;
  if (path !== pathname) return path + search;
  return null;
}

/**
 * X-Robots-Tag for an HTML response: null (indexable) only for an indexable page on the canonical host; everything
 * else is «noindex». Links on noindexed pages may still be followed.
 */
export function robotsHeader({ host, pathname, production = false, siteUrl = SITE_URL }) {
  if (!INDEXABLE.has(pathname)) return 'noindex';
  if (production && String(host || '').toLowerCase() !== new URL(siteUrl).host) return 'noindex';
  return null;
}

export function robotsTxt(siteUrl = SITE_URL) {
  return [
    '# سبونج لايف — SPONGE LIVE',
    '# Public pages are open to every crawler. Private pages are protected by sign-in on the server and carry',
    '# "X-Robots-Tag: noindex"; they are not blocked here so that crawlers can read that header.',
    'User-agent: *',
    'Allow: /',
    // redirect-only addresses and endpoints that no crawler needs (third-party sign-in, admin, webhooks)
    'Disallow: /api/admin/',
    'Disallow: /api/manage/',
    'Disallow: /api/oauth/',
    'Disallow: /api/billing/',
    'Disallow: /api/kick/',
    'Disallow: /go/',
    '',
    'Sitemap: ' + siteUrl + '/sitemap.xml',
    ''
  ].join('\n');
}

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function sitemapXml(siteUrl = SITE_URL, pages = INDEXABLE_PAGES) {
  const urls = pages.map((p) => `  <url>\n    <loc>${xmlEscape(siteUrl + p.path)}</loc>\n    <lastmod>${xmlEscape(p.lastmod)}</lastmod>\n  </url>`);
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>\n';
}

/** Search Console / Bing ownership tags, from the owner's settings (only the token's own characters are kept). */
export function verificationMeta(env = process.env) {
  const tag = (name, raw) => { const v = String(raw || '').trim(); return /^[A-Za-z0-9_-]{8,128}$/.test(v) ? `<meta name="${name}" content="${v}">\n` : ''; };
  return tag('google-site-verification', env.GOOGLE_SITE_VERIFICATION) + tag('msvalidate.01', env.BING_SITE_VERIFICATION);
}

/** IndexNow key from the owner's settings (8–128 of a-z A-Z 0-9 -), or ''. The key file is served at /<key>.txt. */
export function indexNowKey(env = process.env) {
  const k = String(env.INDEXNOW_KEY || '').trim();
  return /^[A-Za-z0-9-]{8,128}$/.test(k) ? k : '';
}

/* ------------------------------------------------ «مكتبة الألعاب» in the first HTML response
   The same card markup as public/games.js (which replaces these cards once the live data arrives), so the page
   looks the same with or without JavaScript and crawlers read every game's title, category, summary and status. */
export const SPRITE = '/icons.svg?v=20261106';
export const GAME_SPRITE = '/game-icons.svg?v=20261105';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (href, cls) => `<svg${cls ? ` class="${cls}"` : ''} aria-hidden="true"><use href="${esc(href)}"></use></svg>`;
const uiIcon = (name) => svg(SPRITE + '#i-' + name);
const UPDATED_DAYS = 30;

/** The library order of public/games.js: the first game back, then released games, then new ones. */
export function libraryOrder(games) {
  return games.filter((g) => g.status === 'available' || g.status === 'dev')
    .map((g, i) => [g, i])
    .sort(([a, ia], [b, ib]) => (b.spotlight ? 1 : 0) - (a.spotlight ? 1 : 0) || (a.status === 'dev' ? 1 : 0) - (b.status === 'dev' ? 1 : 0) || (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || ia - ib)
    .map(([g]) => g);
}

export function gameCardsHtml(games, updates = [], now = Date.now()) {
  const updated = new Set(updates.filter((u) => u.type === 'update' && Math.floor((now - new Date(u.date + 'T00:00:00').getTime()) / 86_400_000) <= UPDATED_DAYS).map((u) => u.mode));
  return libraryOrder(games).map((g, i) => {
    const dev = g.status === 'dev';
    const cls = 'gl-card' + (g.isNew ? ' is-new' : '') + (dev ? ' is-dev' : '') + (g.featured ? ' is-featured' : '') + (g.spotlight ? ' is-spotlight' : '');
    const badges = [];
    if (dev) badges.push(g.spotlight && g.spotlightBadge ? `<span class="gl-badge sl-badge gl-badge-spot">${esc(g.spotlightBadge)}</span>` : '<span class="gl-badge sl-badge gl-badge-dev">قيد التطوير</span>');
    if (g.isNew && !dev) badges.push('<span class="gl-badge sl-badge sl-badge-new">جديد</span>');
    if (updated.has(g.mode) && !g.isNew && !dev) badges.push('<span class="gl-badge sl-badge">تم التحديث</span>');
    if (g.featured && !dev) badges.push('<span class="gl-badge sl-badge sl-badge-epic">مميزة</span>');
    const icon = GAME_SPRITE + '#g-' + g.mode;
    const play = dev
      ? `<p class="gl-off"><i></i><span>غير متاحة حالياً</span></p><button class="gl-play is-dev" type="button" data-mode="${esc(g.mode)}" aria-haspopup="dialog" aria-label="قيد التطوير: ${esc(g.title)} — غير متاحة حالياً"><span>قيد التطوير</span>${uiIcon('lock')}</button>`
      : `<a class="gl-play" href="/game/${esc(g.mode)}" aria-label="العب الآن: ${esc(g.title)}"><span>العب الآن</span>${uiIcon('arrow-b')}</a>`;
    // no style attribute: the CSP forbids inline styles (games.js sets the stagger index from script)
    return `<li class="${cls}" data-mode="${esc(g.mode)}">${svg(icon, 'gl-bgicon')}`
      + `<div class="gl-card-top"><span class="gl-tile">${svg(icon)}</span><span class="gl-num">${String(i + 1).padStart(2, '0')}</span></div>`
      + `<div class="gl-meta"><span class="gl-cat" data-cat="${esc(g.category)}">${esc(g.categoryLabel)}</span>${badges.join('')}</div>`
      + `<h3 class="gl-title">${esc(g.title)}</h3><p class="gl-desc">${esc(g.summary)}</p>`
      + `<p class="gl-how">${uiIcon('chat')}<span>${esc((g.rules || [])[0] || 'العب من تعليقات البث')}</span></p>${play}</li>`;
  }).join('');
}

/** games.html with the cards in place (and the «under development» note shown when no game is released). */
export function renderLibrary(html, games, updates, now) {
  const list = libraryOrder(games);
  let out = html.replace('<ul class="gl-grid" id="gameGrid"></ul>', `<ul class="gl-grid" id="gameGrid" data-ssr="1">${gameCardsHtml(games, updates, now)}</ul>`);
  if (list.length && !list.some((g) => g.status === 'available')) out = out.replace('<p class="gl-devstrip" id="devStrip" hidden>', '<p class="gl-devstrip" id="devStrip">');
  return out;
}
