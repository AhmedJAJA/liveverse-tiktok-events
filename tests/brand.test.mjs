// One identity across سبونج لايف: one design system (shared-theme.css), one font (Tajawal), one header, one
// bottom bar, one palette (navy + sea blue + cyan + sponge yellow). Static checks always; and in a real browser
// (Playwright + PostgreSQL) the shared elements measure the same on every page, on desktop and on phones.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { once } from 'node:events';

const dir = new URL('../public/', import.meta.url);
const pub = (f) => fs.readFileSync(new URL(f, dir), 'utf8');
const htmlFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
const cssFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.css'));
const theme = pub('shared-theme.css');
const HEADER_PAGES = ['home', 'games', 'auth', 'me', 'profile', 'terms', 'privacy', 'refund', 'guide-games', 'guide-tiktok', 'guide-tools', 'admin', 'studio', 'tools', 'play', 'role', 'game-soon'];

test('the official palette, type scale, radii, shadows, spacing and timing live in shared-theme.css', () => {
  for (const [token, hex] of [['--sl-deep', '#020A22'], ['--sl-navy', '#061A44'], ['--sl-surface', '#0B1737'], ['--sl-elevated', '#10234D'], ['--sl-primary', '#176DF0'], ['--sl-cyan', '#38D4FF'], ['--sl-yellow', '#FFD62A'], ['--sl-text', '#EAF8FF'], ['--sl-muted', '#9EADD0']])
    assert.match(theme, new RegExp(token + ':' + hex + ';'), token);
  for (const t of ['--sl-border:', '--sl-glow:', '--sl-r-md:', '--sl-shadow-card:', '--sl-sp-4:', '--sl-font:"Tajawal"', '--sl-fs-base:', '--sl-fw-black:', '--sl-dur-2:', '--sl-ease:'])
    assert.ok(theme.includes(t), t);
  // components every page shares
  for (const c of ['.sl-header{', '.sl-brand{', '.sl-nav{', '.sl-menu{', '.sl-btn{', '.sl-btn-primary{', '.sl-btn-sun{', '.sl-card{', '.sl-badge{', '.sc-pill{', '[hidden]{display:none!important}'])
    assert.ok(theme.includes(c), c);
});

test('every page links the design system first; the site pages share one header and its script', () => {
  for (const f of htmlFiles) {
    const s = pub(f);
    const first = s.match(/<link rel="stylesheet" href="\/([^"]+)">/);
    assert.equal(first?.[1], 'shared-theme.css', f + ': shared-theme.css first');
  }
  // the header, normalised: the same markup on every site page (pages may add ids or extra actions)
  const norm = (s) => s.match(/<header class="sl-header" id="bar">[\s\S]*?<\/header>/)[0]
    .replace(/ id="(gamesLink|navStudio)"/g, '').replace(/<button[^>]*class="sl-icon-btn sl-burger-btn"[^>]*>/, '<burger>')
    .replace(/<span class="pl-room[^>]*><\/span>\s*/g, '').replace(/<button type="button" class="pl-chip"[\s\S]*?<\/button>\s*/g, '').replace(/<a class="pl-chip"[\s\S]*?<\/a>\s*/g, '')
    .replace(/\s*<button type="button" class="sl-btn sl-btn-ghost[^"]*" id="logoutButton">[\s\S]*?<\/button>/g, '').replace(/ sl-hide-phone/g, '');
  const ref = norm(pub('home.html'));
  for (const n of HEADER_PAGES) {
    const s = pub(n + '.html');
    assert.ok(s.includes('<script defer src="/site-header.js"></script>'), n + ': header script');
    assert.match(s, /<body class="sl-page/, n + ': site page');
    assert.equal(norm(s), ref, n + ': the same header');
  }
  // the old per-page headers are gone
  for (const n of HEADER_PAGES) assert.doesNotMatch(pub(n + '.html'), /class="(hm-bar|pg-top|ds-top|gl-top|pl-bar|st-top-row)"/, n);
});

test('one font: Tajawal is declared once (shared-theme.css), no page brings another family', () => {
  for (const f of cssFiles) {
    const s = pub(f);
    const faces = [...s.matchAll(/@font-face\{font-family:"([^"]+)"/g)].map((m) => m[1]);
    if (f === 'shared-theme.css') assert.deepEqual([...new Set(faces)], ['Tajawal']);
    else if (f === 'royal-core.css') assert.deepEqual([...new Set(faces)], ['Royal Latin'], 'scoreboard numerals only');
    else assert.deepEqual(faces, [], f);
    assert.doesNotMatch(s, /IBM Plex|Noto Kufi|Readex/, f);
  }
  // one weight band = one face split by script. A Latin file spanning several bands ties with the Arabic bands in the
  // browser's weight matching, wins, and then every Arabic letter at that weight falls back to a system font.
  const faces = [...theme.matchAll(/@font-face\{font-family:"Tajawal";src:url\(\/fonts\/tajawal-(arabic|latin)-\d+-normal\.woff2\)[^}]*font-weight:(\d+ \d+)/g)].map((m) => [m[1], m[2]]);
  const arabicBands = faces.filter(([s]) => s === 'arabic').map(([, w]) => w);
  assert.deepEqual(arabicBands, ['400 500', '600 700', '800 900']);
  for (const [script, band] of faces) if (script === 'latin') assert.ok(arabicBands.includes(band), 'the Latin face shares an Arabic band exactly: ' + band);
});

test('one palette: no stylesheet hard-codes a brand colour or a drifted copy of one; no violet page colour', () => {
  const brand = /#(020A22|061A44|0B1737|10234D|176DF0|2C8BFF|38D4FF|8CE8FF|FFD62A|FFE14D|FFB800|EAF8FF|9EADD0|1E5BFF|2B8BFF|0AC9F5|4AD3FF|4FD1FF|37B3D4|FFD21F|FFC21A|E7F2F6|E9FBFF|EAF9FF|050B17|07060A|040812)(?![0-9A-F])/i;
  for (const f of cssFiles) if (f !== 'shared-theme.css') assert.doesNotMatch(pub(f), brand, f + ' uses the tokens');
  for (const f of cssFiles) assert.doesNotMatch(pub(f), /rgba\(30,91,255/, f);
  // the old per-page palettes now point at the shared one
  assert.match(pub('home.css'), /--deep:var\(--sl-deep\); --navy:var\(--sl-navy\); --blue:var\(--sl-primary\)/);
  assert.match(pub('sponge.css'), /--sp-deep:var\(--sl-deep\)/);
  assert.match(pub('play.css'), /--pl-bg:var\(--sl-deep\)/);
  assert.match(pub('draw.css'), /--dr-a:var\(--sl-navy\)/);
  // violet is an accent for epic items only: never a page background or a main button
  assert.doesNotMatch(pub('games.css'), /#(7A3FD4|9A6CF0|080610|25173D)/i);
  assert.doesNotMatch(theme, /--sl-(primary|deep|navy|surface)[^;]*#(7A3FD4|9A6CF0|B06BFF)/i);
  // the bottom bar is the same component everywhere: no page restyles it
  for (const f of cssFiles) if (f !== 'bottom-nav.css') assert.doesNotMatch(pub(f), /\.bn(-item|-ic)?[\s{[:.]/, f);
  for (const f of htmlFiles) assert.doesNotMatch(pub(f), /theme-color" content="#(?!020A22)/i, f);
});

/* ---------------- in a real browser: the shared elements measure the same everywhere ---------------- */
let chromium = null;
for (const base of [process.cwd(), (() => { try { return execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } })()]) {
  try { chromium = createRequire(path.join(base, 'x.js'))('playwright').chromium; break; } catch {}
}
const dbUrl = process.env.TEST_DATABASE_URL || 'postgres://sponge@localhost:55432/visual';
let pgOk = false; try { const pg = (await import('pg')).default; const c = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 2000 }); await c.connect(); await c.end(); pgOk = true; } catch {}
async function freePort() { const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise((r) => s.close(r)); return p; }

test('in a real browser: header, brand, links, buttons, font and bottom bar are identical on every page', { skip: !chromium ? 'no Playwright' : !pgOk ? 'no PostgreSQL' : false, timeout: 240_000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), NODE_ENV: 'test', ADMIN_TOKEN: 'owner-token-brand-test-1', SKY_OPEN_SIGNUP: '1', SKY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sponge-brand-')), DATABASE_URL: dbUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  const t0 = Date.now(); while (!/ready on/.test(out)) { if (Date.now() - t0 > 15000 || child.exitCode !== null) throw new Error('server did not start: ' + out); await new Promise((r) => setTimeout(r, 50)); }
  const base = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch();
  try {
    const boot = await browser.newContext(); const bp = await boot.newPage();
    const u = 'bt' + Date.now().toString(36).slice(-7);
    assert.equal((await bp.request.post(base + '/api/auth/register', { data: { username: u, email: u + '@example.com', password: 'reef2026go', confirm: 'reef2026go' } })).status(), 201);
    const me = await (await bp.request.get(base + '/api/access/me')).json(); const cookies = await boot.cookies();
    const signedOut = new Set(['/login']);
    const pages = ['/', '/games', '/login', '/account', '/account#bag', '/u/' + me.account.publicId, '/guide/games', '/terms', '/game/chain', '/tools', '/play?room=' + me.room];
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const seen = {};
      for (const path of pages) {
        const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700 });
        if (!signedOut.has(path)) await ctx.addCookies(cookies);
        const p = await ctx.newPage(); const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
        await p.goto(base + path, { waitUntil: 'networkidle' });
        await p.waitForTimeout(400);
        const m = await p.evaluate((W) => {
          const cs = (n) => getComputedStyle(n); const q = (s) => document.querySelector(s); const h = q('.sl-header'); const b = q('.sl-brand'); const nav = q('.sl-nav > a[data-nav=games]'); const acc = q('#barAccount');
          const r = (n) => Math.round(n.getBoundingClientRect().height);
          return {
            header: [r(h), cs(h).borderRadius, cs(h).backgroundColor, cs(h).borderTopColor, cs(h).position],
            brand: [Math.round(q('.sl-brand img').getBoundingClientRect().width), cs(b).fontSize, cs(b).fontWeight, cs(b.querySelector('b')).color],
            nav: cs(nav.parentElement).display === 'none' ? 'hidden' : [cs(nav).fontSize, cs(nav).fontWeight, cs(nav).color === 'rgb(234, 248, 255)' ? 'current' : cs(nav).color],
            account: [cs(acc).backgroundImage.slice(0, 60), cs(acc).borderRadius, Math.round(acc.getBoundingClientRect().height)],
            font: cs(document.body).fontFamily.split(',')[0].replace(/"/g, ''),
            bn: q('#bottomNav') && cs(q('#bottomNav')).display !== 'none' ? [cs(q('#bottomNav')).backgroundImage.slice(0, 50), q('#bottomNav [aria-current=page]') ? cs(q('#bottomNav [aria-current=page]')).backgroundImage.slice(0, 50) : 'none'] : null,
            // against the nominal width: a phone browser zooms out to fit wide content, so innerWidth would grow with it
            overflow: document.documentElement.scrollWidth - W,
          };
        }, width);
        assert.deepEqual(errors, [], path + ': no script errors');
        assert.equal(m.font, 'Tajawal', path + ' font');
        assert.ok(m.overflow <= 0, path + ' @' + width + ': no sideways scroll (' + m.overflow + ')');
        seen[path] = m;
        await ctx.close();
      }
      const [first, ...rest] = Object.entries(seen);
      for (const [path, m] of rest) {
        assert.deepEqual(m.header, first[1].header, path + ' header @' + width);
        assert.deepEqual(m.brand, first[1].brand, path + ' brand @' + width);
        if (m.nav !== 'hidden' && first[1].nav !== 'hidden') assert.deepEqual(m.nav.slice(0, 2), first[1].nav.slice(0, 2), path + ' nav @' + width);
        // on phones the account page hides its own account button (it is that page; «تسجيل الخروج» takes the place)
        if (!(path.startsWith('/account') && width < 700)) assert.deepEqual(m.account.slice(1), first[1].account.slice(1), path + ' account button @' + width);
      }
      assert.equal(first[1].header[0], width < 700 ? 60 : 66);
      assert.equal(first[1].brand[0], width < 700 ? 34 : 40);
      // the bottom bar (phones): the same look wherever it appears
      const bars = Object.entries(seen).filter(([, m]) => m.bn);
      if (width < 700) {
        assert.ok(bars.length >= 3, 'bottom bar on the main pages');
        for (const [path, m] of bars) assert.equal(m.bn[0], bars[0][1].bn[0], path + ' bottom bar');
        const active = bars.filter(([, m]) => m.bn[1] !== 'none').map(([, m]) => m.bn[1]);
        assert.ok(active.length >= 2 && active.every((a) => a === active[0]), 'the current section looks the same everywhere');
      }
    }
    // a visitor who is not signed in: «ابدأ مجاناً» and a round account icon fit on a phone, and the icon keeps its name for screen readers
    for (const [width, height] of [[390, 844], [430, 932]]) {
      for (const path of ['/', '/games', '/u/' + me.account.publicId, '/guide/games', '/play?room=' + me.room]) {
        const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
        const p = await ctx.newPage(); await p.goto(base + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(300);
        const m = await p.evaluate((W) => {
          const acc = document.getElementById('barAccount'); const trial = document.getElementById('barTrial');
          return { overflow: document.documentElement.scrollWidth - W, signed: document.getElementById('bar').classList.contains('is-signed'), acc: Math.round(acc.getBoundingClientRect().width), name: acc.textContent.trim(), trial: trial.offsetParent !== null, brandName: document.querySelector('.sl-brand span').offsetParent !== null };
        }, width);
        assert.equal(m.signed, false, path + ' signed out');
        assert.ok(m.overflow <= 0, path + ' @' + width + ' signed out: no sideways scroll (' + m.overflow + ')');
        assert.equal(m.acc, 42, path + ' @' + width + ': the account button is a round icon');
        assert.equal(m.name, 'تسجيل الدخول', path + ': the icon keeps its name');
        assert.ok(m.trial, path + ': «ابدأ مجاناً» stays in the header');
        // only a page with extra header controls (the play page) may drop the brand name to fit
        if (!path.startsWith('/play')) assert.ok(m.brandName, path + ' @' + width + ': the brand name stays');
        await ctx.close();
      }
    }
    // what is really on screen: every Arabic text is drawn with Tajawal, at every weight band, not a system fallback
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addCookies(cookies);
      const bands = new Set();
      for (const path of ['/', '/games', '/guide/games', '/game/chain', '/play?room=' + me.room, '/overlay?room=' + me.room]) {
        const p = await ctx.newPage(); await p.goto(base + path, { waitUntil: 'load' }); await p.waitForTimeout(1200); await p.evaluate(() => document.fonts.ready);
        const items = await p.evaluate(() => {
          const out = []; const letters = /[\u0621-\u064A\u0660-\u0669\u0671-\u06D3]/g;
          for (const el of document.querySelectorAll('body *')) {
            if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
            const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join('').replace(/\s+/g, ' ').trim();
            const ar = (own.match(letters) || []).length; if (!ar) continue;
            el.setAttribute('data-fq', String(out.length)); out.push({ ar, w: +getComputedStyle(el).fontWeight, t: own.slice(0, 30) }); if (out.length >= 80) break;
          }
          return out;
        });
        const cdp = await ctx.newCDPSession(p); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
        const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
        let checked = 0;
        for (const [i, it] of items.entries()) {
          const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-fq="${i}"]` }); if (!nodeId) continue;
          const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId }); if (!fonts.length) continue; // not painted
          const tajawal = fonts.filter((f) => /^Tajawal/.test(f.familyName)).reduce((a, f) => a + f.glyphCount, 0);
          assert.ok(tajawal >= 0.6 * it.ar, `${path}: «${it.t}» (${it.w}) is drawn with ${fonts.map((f) => f.familyName + ' ×' + f.glyphCount).join(', ')}`);
          bands.add(it.w <= 500 ? 'regular' : it.w <= 700 ? 'bold' : 'heavy'); checked++;
        }
        assert.ok(checked >= 5, path + ': Arabic text checked (' + checked + ')');
        await p.close();
      }
      assert.deepEqual([...bands].sort(), ['bold', 'heavy', 'regular'], 'all three weight bands seen');
      await ctx.close();
    }
  } finally { await browser.close(); child.kill(); await once(child, 'exit').catch(() => {}); }
});
