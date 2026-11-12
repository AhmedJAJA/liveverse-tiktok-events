/* سبونج لايف — the site header, the same on every page (markup: <header class="sl-header" id="bar">).
   One behaviour for all pages: the current link, «المزيد», the phone menu, and the visitor's account state
   (name, picture, coins) read from the server session — never from localStorage. A page that has its own
   side menu (the account dashboard) marks its burger with data-own-menu and keeps opening that menu. */
(() => {
  'use strict';
  const bar = document.getElementById('bar');
  if (!bar || !bar.classList.contains('sl-header')) return;
  const $ = (id) => document.getElementById(id);
  const SPRITE = '/icons.svg?v=20261106';
  const svg = (name) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('width', '20'); s.setAttribute('height', '20'); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', SPRITE + '#i-' + name); s.append(u); return s; };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  /* the header's real height keeps anchored sections clear of it */
  const setH = () => { const h = bar.offsetHeight + (parseFloat(getComputedStyle(bar).top) || 0); document.documentElement.style.setProperty('--sl-header-real', h + 'px'); document.documentElement.style.setProperty('--hm-bar-h', bar.offsetHeight + 'px'); document.documentElement.style.scrollPaddingTop = (h + 16) + 'px'; };
  setH(); addEventListener('resize', setH, { passive: true });

  /* never wider than the screen: when a page's extra controls crowd a narrow phone, the brand name goes first,
     then «ابدأ مجاناً» (both stay in the phone menu) */
  const inner = bar.querySelector('.sl-header-in'), actions = bar.querySelector('.sl-actions');
  const fit = () => {
    if (!inner) return;
    bar.classList.remove('sl-tight-1', 'sl-tight-2');
    if (inner.scrollWidth <= inner.clientWidth + 1) return;
    bar.classList.add('sl-tight-1');
    if (inner.scrollWidth > inner.clientWidth + 1) bar.classList.add('sl-tight-2');
  };
  let fitQueued = false;
  const queueFit = () => { if (fitQueued) return; fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fit(); }); };
  fit(); addEventListener('resize', queueFit, { passive: true });
  document.fonts?.ready.then(queueFit);
  if (window.ResizeObserver && actions) new ResizeObserver(queueFit).observe(actions); // chips a page shows later

  /* the current page */
  const path = location.pathname;
  const current = path === '/' ? 'home' : /^\/games?(\/|$)/.test(path) ? 'games' : path === '/pass' ? 'pass' : null;
  /* «SpongePass»: one link on every page's bar (before «المزيد»), without editing each page's markup */
  const navEl = bar.querySelector('.sl-nav');
  if (navEl && !navEl.querySelector('[data-nav=pass]')) {
    const a = el('a', 'sl-nav-pass', 'SpongePass'); a.href = '/pass'; a.dataset.nav = 'pass'; a.dir = 'ltr';
    navEl.insertBefore(a, navEl.querySelector('.sl-more'));
  }
  for (const a of bar.querySelectorAll('.sl-nav [data-nav]')) if (a.dataset.nav === current) a.setAttribute('aria-current', 'page');

  /* «المزيد» */
  const more = $('moreButton'), moreMenu = $('moreMenu');
  if (more && moreMenu) {
    const close = () => { moreMenu.hidden = true; more.setAttribute('aria-expanded', 'false'); };
    more.addEventListener('click', (e) => { e.stopPropagation(); const open = moreMenu.hidden; moreMenu.hidden = !open; more.setAttribute('aria-expanded', String(open)); });
    document.addEventListener('click', (e) => { if (!moreMenu.hidden && !e.target.closest('.sl-more')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !moreMenu.hidden) { close(); more.focus(); } });
    moreMenu.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
  }

  /* the phone menu: one list for the whole site */
  const LINKS = [['/', 'home', 'الرئيسية'], ['/games', 'games', 'مكتبة الألعاب'], ['/#live', 'live', 'البثوث النشطة'], ['/#leaders', 'trophy', 'المتصدرون'], ['/#store', 'ticket', 'المتجر'], ['/pass', 'trophy', 'SpongePass'], ['/#room', 'key', 'دخول الغرفة'], ['/account', 'user', 'حسابي'], ['/guide/games', 'note', 'دليل الألعاب'], ['/guide/tools', 'screen', 'أدوات البث'], ['/#faq', 'question', 'الأسئلة الشائعة']];
  const burger = $('menuButton');
  let menu = null, lastFocus = null;
  function buildMenu() {
    menu = el('div', 'sl-menu'); menu.id = 'menu'; menu.hidden = true; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-modal', 'true'); menu.setAttribute('aria-label', 'القائمة');
    const panel = el('div', 'sl-menu-panel');
    const head = el('div', 'sl-menu-head');
    const brand = el('a', 'sl-brand'); brand.href = '/'; const img = el('img'); img.src = '/brand/sponge-128.webp'; img.alt = ''; img.width = 34; img.height = 34; const name = el('span'); name.append(el('b', null, 'سبونج'), document.createTextNode(' لايف')); brand.append(img, name);
    const x = el('button', 'sl-icon-btn'); x.type = 'button'; x.id = 'menuClose'; x.setAttribute('aria-label', 'إغلاق القائمة'); x.append(svg('close'));
    head.append(brand, x);
    const nav = el('nav', 'sl-menu-nav'); nav.setAttribute('aria-label', 'أقسام الموقع');
    for (const [href, ic, label] of LINKS) { const a = el('a'); a.href = href; a.append(svg(ic), document.createTextNode(label)); if ((href === '/' && current === 'home') || (href === '/games' && current === 'games')) a.setAttribute('aria-current', 'page'); nav.append(a); }
    const acts = el('div', 'sl-menu-acts');
    const acc = el('a', 'sl-btn sl-btn-primary'); acc.id = 'menuAccount'; acc.href = '/login'; acc.append(svg('user'), el('span', null, 'تسجيل الدخول')); acc.querySelector('span').id = 'menuAccountLabel';
    const second = el('a', 'sl-btn sl-btn-sun', 'إنشاء حساب مجاني'); second.id = 'menuSecond'; second.href = '/signup';
    const out = el('button', 'sl-btn sl-btn-danger', 'تسجيل الخروج'); out.type = 'button'; out.id = 'menuLogout'; out.hidden = true;
    out.addEventListener('click', async () => { await fetch('/api/access/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}); location.href = '/'; });
    acts.append(acc, second, out);
    panel.append(head, nav, acts); menu.append(panel); document.body.append(menu);
    x.addEventListener('click', () => closeMenu());
    menu.addEventListener('click', (e) => { if (e.target === menu) closeMenu(); else if (e.target.closest('a')) closeMenu(false); });
  }
  function openMenu() { if (!menu) buildMenu(); lastFocus = document.activeElement; menu.hidden = false; burger.setAttribute('aria-expanded', 'true'); document.documentElement.classList.add('sl-menu-open'); $('menuClose').focus(); }
  function closeMenu(restore = true) { if (!menu || menu.hidden) return; menu.hidden = true; burger.setAttribute('aria-expanded', 'false'); document.documentElement.classList.remove('sl-menu-open'); if (restore) lastFocus?.focus?.(); }
  if (burger && !burger.hasAttribute('data-own-menu')) {
    burger.addEventListener('click', openMenu);
    document.addEventListener('keydown', (e) => {
      if (!menu || menu.hidden) return;
      if (e.key === 'Escape') { closeMenu(); return; }
      if (e.key === 'Tab') { // focus stays inside the open menu
        const f = [...menu.querySelectorAll('a[href],button:not([hidden])')].filter((n) => n.offsetParent !== null); if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
      }
    });
  }

  /* the account, from the server session */
  const account = $('barAccount'), trial = $('barTrial'), coins = $('barCoins');
  fetch('/api/access/me', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json()).then((me) => {
    if (!me.account) { if (me.signedIn && trial) trial.hidden = true; return; }
    const a = me.account;
    const short = a.displayName && a.displayName.length > 14 ? a.displayName.slice(0, 13) + '…' : (a.displayName || 'حسابي');
    bar.classList.add('is-signed');
    if (trial) trial.hidden = true;
    if (account) {
      account.href = '/account'; account.title = a.publicId || '';
      const label = $('barAccountLabel'); if (label) label.textContent = short;
      if (a.picture && /^https:\/\//.test(a.picture)) { const img = el('img', 'sl-avatar'); img.src = a.picture; img.alt = ''; img.width = 26; img.height = 26; img.referrerPolicy = 'no-referrer'; img.addEventListener('error', () => img.remove(), { once: true }); account.querySelector('svg')?.replaceWith(img); }
    }
    const setMenu = () => { if (!menu) return; $('menuAccount').href = '/account'; $('menuAccountLabel').textContent = 'حسابي — ' + (a.publicId || short); $('menuSecond').hidden = true; $('menuLogout').hidden = false; };
    if (menu) setMenu(); else burger?.addEventListener('click', setMenu, { once: true });
    if (coins) fetch('/api/me/wallet', { credentials: 'same-origin', cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((w) => {
      if (!w || !Number.isFinite(w.balance)) return;
      coins.hidden = false;
      if (window.SpongeCoins?.setBalance) window.SpongeCoins.setBalance(w.balance);
      else for (const b of coins.querySelectorAll('[data-coin-balance]')) b.textContent = w.balance.toLocaleString('en-US');
    }).catch(() => {});
  }).catch(() => {}).finally(() => { document.documentElement.classList.remove('me-pending'); setH(); queueFit(); });
})();
