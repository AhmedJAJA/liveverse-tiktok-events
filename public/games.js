/* سبونج لايف — «مكتبة الألعاب». Everything shown comes from the server: the games and «آخر التحديثات» from the
   catalogue (/api/site), the live rail from verified streams only (/api/streams), the connection card from the
   visitor's own account. Nothing is invented: no sample streams, no fixed counts. Every finished game is free;
   «العب الآن» opens that game's settings page (settings → lobby → players → round). */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const SVG = 'http://www.w3.org/2000/svg';
  const icon = (href, cls, size) => { const s = document.createElementNS(SVG, 'svg'); if (cls) s.setAttribute('class', cls); if (size) { s.setAttribute('width', size); s.setAttribute('height', size); } s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS(SVG, 'use'); u.setAttribute('href', href); s.append(u); return s; };
  // versioned sprite addresses: a new icon reaches returning visitors at once (unversioned SVGs are kept for days)
  const SPRITE = '/icons.svg?v=20261106', GAME_SPRITE = '/game-icons.svg?v=20261105';
  const gameIcon = (mode, cls) => icon(GAME_SPRITE + '#g-' + mode, cls);
  const ui = (name, cls, size) => icon(SPRITE + '#i-' + name, cls, size);
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
  const fmtDate = (d) => { try { return new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d + 'T12:00:00')); } catch { return d; } };
  const daysAgo = (d) => Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86_400_000);
  const ago = (d) => { const n = daysAgo(d); if (n <= 0) return 'اليوم'; if (n === 1) return 'أمس'; if (n === 2) return 'قبل يومين'; if (n <= 10) return 'قبل ' + n + ' أيام'; return fmtDate(d); };
  // search matches with or without hamza, ة/ه, ى/ي and diacritics
  const norm = (s) => String(s || '').toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/\s+/g, ' ').trim();
  document.documentElement.classList.remove('no-js');
  $('year').textContent = String(new Date().getFullYear());

  const CATS = ['smart', 'elimination', 'luck', 'group', 'new'];
  const TYPE_LABEL = { new: 'لعبة جديدة', update: 'تحسين', platform: 'المنصة' };
  const UPDATED_DAYS = 30; // «تم التحديث» stays on a card for a month after a dated improvement
  const state = { games: [], updates: [], filter: 'all', q: '', updType: 'all', updAll: false, updated: new Set() };
  try { const p = new URLSearchParams(location.search); const c = p.get('cat'); if (CATS.includes(c)) state.filter = c; state.q = (p.get('q') || '').slice(0, 40); } catch { /* ignore */ }
  $('gameSearch').value = state.q;

  /* ---------------- game cards ---------------- */
  function card(g, i) {
    const dev = g.status === 'dev';
    const li = el('li', 'gl-card' + (g.isNew ? ' is-new' : '') + (dev ? ' is-dev' : '') + (g.featured ? ' is-featured' : ''));
    li.dataset.mode = g.mode; li.style.setProperty('--i', String(i % 12));
    li.append(gameIcon(g.mode, 'gl-bgicon'));
    const top = el('div', 'gl-card-top');
    const tile = el('span', 'gl-tile'); tile.append(gameIcon(g.mode)); top.append(tile, el('span', 'gl-num', String(i + 1).padStart(2, '0')));
    const meta = el('div', 'gl-meta');
    const cat = el('span', 'gl-cat', g.categoryLabel); cat.dataset.cat = g.category; meta.append(cat);
    if (dev) meta.append(el('span', 'gl-badge is-dev', 'قيد التطوير'));
    if (g.isNew && !dev) meta.append(el('span', 'gl-badge is-new', 'جديد'));
    if (state.updated.has(g.mode) && !g.isNew && !dev) meta.append(el('span', 'gl-badge is-updated', 'تم التحديث'));
    if (g.featured && !dev) meta.append(el('span', 'gl-badge is-featured', 'مميزة'));
    const h = el('h3', 'gl-title', g.title);
    const p = el('p', 'gl-desc', g.summary);
    const how = el('p', 'gl-how'); how.append(ui('chat'), el('span', null, (g.rules || [])[0] || 'العب من تعليقات البث'));
    const a = el('a', 'gl-play');
    if (dev) { a.setAttribute('aria-disabled', 'true'); a.setAttribute('role', 'link'); a.append(el('span', null, 'قيد التطوير'), ui('lock')); }
    else { a.href = '/game/' + g.mode; a.setAttribute('aria-label', 'العب الآن: ' + g.title); a.append(el('span', null, 'العب الآن'), ui('arrow-b')); }
    li.append(top, meta, h, p, how, a);
    return li;
  }
  function shown() {
    const q = norm(state.q);
    return state.games.filter((g) => (state.filter === 'all' || (state.filter === 'new' ? g.isNew : g.category === state.filter))
      && (!q || norm([g.title, g.summary, g.categoryLabel, ...(g.rules || [])].join(' ')).includes(q)));
  }
  function paint() {
    const list = shown();
    for (const b of document.querySelectorAll('[data-filter]')) b.setAttribute('aria-selected', String(b.dataset.filter === state.filter));
    $('gameGrid').replaceChildren(...list.map(card));
    $('gridEmpty').hidden = list.length > 0;
    if (!list.length) $('gridEmptyText').textContent = state.q ? 'لا توجد لعبة باسم «' + state.q + '» في هذا التصنيف.' : 'لا توجد ألعاب في هذا التصنيف حاليًا.';
    const playable = list.filter((g) => g.status !== 'dev').length;
    $('gameCount').textContent = list.length ? (playable === 1 ? 'لعبة واحدة' : playable + ' لعبة') + ' — كلها مجانية' + (list.length > playable ? ' · ' + (list.length - playable) + ' قيد التطوير' : '') : '';
    try {
      const p = new URLSearchParams(); if (state.filter !== 'all') p.set('cat', state.filter); if (state.q) p.set('q', state.q);
      history.replaceState(null, '', '/games' + (p.toString() ? '?' + p : '') + location.hash);
    } catch { /* ignore */ }
  }
  $('filters').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (!b) return; state.filter = b.dataset.filter; paint(); });
  $('filters').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tabs = [...document.querySelectorAll('[data-filter]')]; const i = tabs.indexOf(document.activeElement); if (i < 0) return;
    const n = tabs[(i + (e.key === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length]; n.focus(); n.click(); e.preventDefault();
  });
  let searchT = 0;
  $('gameSearch').addEventListener('input', (e) => { clearTimeout(searchT); searchT = setTimeout(() => { state.q = e.target.value.trim().slice(0, 40); paint(); }, 120); });
  $('clearFilters').addEventListener('click', () => { state.filter = 'all'; state.q = ''; $('gameSearch').value = ''; paint(); });
  // «العب الآن»: a loading state while the settings page opens
  $('gameGrid').addEventListener('click', (e) => {
    const a = e.target.closest('a.gl-play'); if (!a || a.getAttribute('aria-disabled') === 'true') return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    a.classList.add('is-loading'); a.setAttribute('aria-busy', 'true'); a.querySelector('span').textContent = 'جارٍ فتح اللعبة…';
  });
  addEventListener('pageshow', () => { for (const a of document.querySelectorAll('.gl-play.is-loading')) { a.classList.remove('is-loading'); a.removeAttribute('aria-busy'); a.querySelector('span').textContent = 'العب الآن'; } });

  // cards per row (desktop only; remembered in this browser)
  function paintCols(v) {
    const grid = $('gameGrid'); if (v === 'auto') grid.removeAttribute('data-cols'); else grid.dataset.cols = v;
    for (const b of document.querySelectorAll('[data-cols]')) if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed', String(b.dataset.cols === v));
  }
  const savedCols = store.get('gl-cols'); paintCols(['2', '3', '4'].includes(savedCols) ? savedCols : 'auto');
  $('colsSeg').addEventListener('click', (e) => { const b = e.target.closest('button[data-cols]'); if (!b) return; paintCols(b.dataset.cols); store.set('gl-cols', b.dataset.cols); });

  /* ---------------- «آخر التحديثات» ---------------- */
  function updateCard(u, byMode) {
    const g = byMode.get(u.mode); const type = TYPE_LABEL[u.type] ? u.type : (g ? 'update' : 'platform');
    const c = el('article', 'gl-upd'); c.dataset.type = type;
    c.append(g ? gameIcon(g.mode, 'gl-upd-bg') : ui('sparkle', 'gl-upd-bg'));
    const top = el('div', 'gl-upd-top');
    const tile = el('span', 'gl-upd-tile'); tile.append(g ? gameIcon(g.mode) : ui('sparkle'));
    const who = el('div', 'gl-upd-who');
    const meta = el('div', 'gl-upd-meta'); const t = el('time', null, ago(u.date)); t.dateTime = u.date; t.title = fmtDate(u.date);
    meta.append(el('b', null, g ? g.categoryLabel : 'سبونج لايف'), document.createTextNode('·'), ui('timer'), t);
    who.append(el('h3', null, u.title), meta);
    top.append(tile, who, el('span', 'gl-upd-chip', TYPE_LABEL[type]));
    c.append(top);
    if (u.summary) c.append(el('p', 'gl-upd-sum', u.summary));
    const ul = el('ul'); for (const it of u.items || []) { const li = el('li'); li.append(ui('check'), el('span', null, it)); ul.append(li); } c.append(ul);
    const a = el('a', 'gl-upd-play' + (g && g.status !== 'dev' ? '' : ' is-ghost'));
    if (g && g.status !== 'dev') { a.href = '/game/' + g.mode; a.append(el('span', null, type === 'new' ? 'جرّبها الآن' : 'جرّب ' + g.title), ui('arrow-b')); }
    else { a.href = '#library'; a.append(el('span', null, 'تصفح الألعاب')); }
    c.append(a);
    return c;
  }
  function paintUpdates() {
    const byMode = new Map(state.games.map((g) => [g.mode, g]));
    const list = state.updates.filter((u) => state.updType === 'all' || (u.type || 'platform') === state.updType);
    const cards = list.map((u, i) => { const c = updateCard(u, byMode); if (i >= 3) c.classList.add('is-extra'); return c; });
    $('updateList').replaceChildren(...cards);
    $('updateList').classList.toggle('is-all', state.updAll);
    const more = $('updMore'); more.hidden = list.length <= 3 && innerWidth > 1199;
    more.hidden = list.length <= (innerWidth > 1199 ? 3 : innerWidth > 820 ? 2 : 1);
    more.setAttribute('aria-expanded', String(state.updAll));
    more.querySelector('span').textContent = state.updAll ? 'عرض أقل' : 'عرض كل التحديثات (' + list.length + ')';
    for (const b of document.querySelectorAll('#updFilters [data-type]')) b.setAttribute('aria-pressed', String(b.dataset.type === state.updType));
  }
  $('updFilters').addEventListener('click', (e) => { const b = e.target.closest('[data-type]'); if (!b) return; state.updType = b.dataset.type; paintUpdates(); });
  $('updMore').addEventListener('click', () => { state.updAll = !state.updAll; paintUpdates(); });
  let resizeT = 0; addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (state.updates.length) paintUpdates(); }, 200); });

  fetch('/api/site', { cache: 'no-store' }).then((r) => r.json()).then((site) => {
    // finished games (free) and, clearly marked, games still in development; nothing else
    state.games = [...(site.games || []), ...(site.extraGames || [])].filter((g) => g.status === 'available' || g.status === 'dev');
    state.games.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || (a.status === 'dev' ? 1 : 0) - (b.status === 'dev' ? 1 : 0));
    state.updates = (site.gameUpdates || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    state.updated = new Set(state.updates.filter((u) => u.type === 'update' && daysAgo(u.date) <= UPDATED_DAYS).map((u) => u.mode));
    paint();
    if (state.updates.length) { $('updLatest').textContent = 'آخر تحديث ' + fmtDate(state.updates[0].date); $('updLatest').dateTime = state.updates[0].date; paintUpdates(); $('updates').hidden = false; }
  }).catch(() => { $('gridEmpty').hidden = false; $('gridEmptyText').textContent = 'تعذر تحميل الألعاب. تحقق من الاتصال وأعد المحاولة.'; });

  /* ---------------- «بثوث شغّالة الآن»: verified streams only ---------------- */
  const PLATFORM = { tiktok: ['TikTok', 'note'], kick: ['Kick', 'kick'] };
  function streamCard(st) {
    const handle = String(st.username || '').replace(/^@/, '');
    const name = st.displayName || handle || 'بث مباشر';
    const [pName, pIcon] = PLATFORM[st.platform] || PLATFORM.tiktok;
    const li = el('li', 'gl-lc'); li.dataset.platform = st.platform === 'kick' ? 'kick' : 'tiktok'; li.dataset.join = String(!!st.joinOpen);
    const ava = el('div', 'gl-lc-ava'); const face = el('span', 'ava', Array.from(name.trim())[0]?.toUpperCase() || '؟'); face.setAttribute('aria-hidden', 'true');
    if (st.avatarUrl && /^https:\/\//.test(st.avatarUrl)) {
      const img = el('img'); img.alt = ''; img.width = 56; img.height = 56; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.remove(), { once: true }); img.src = st.avatarUrl; face.append(img);
    }
    ava.append(face, el('span', 'gl-lc-tag', 'LIVE'));
    const info = el('div', 'gl-lc-info');
    const top = el('div', 'gl-lc-top'); top.append(el('b', 'gl-lc-name', name));
    if (st.liveUrl && /^https:\/\//.test(st.liveUrl)) {
      const a = el('a', 'gl-lc-btn' + (st.joinOpen ? ' is-join' : '')); a.href = st.liveUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.append(ui('play'), document.createTextNode(st.joinOpen ? 'انضم' : 'شاهد'));
      a.setAttribute('aria-label', (st.joinOpen ? 'انضم إلى بث ' : 'شاهد بث ') + name + ' على ' + pName);
      if (st.joinOpen && st.keyword) a.title = 'افتح البث واكتب «' + st.keyword + '» في التعليقات';
      top.append(a);
    }
    // the handle is left-to-right text inside an Arabic line: isolate it so «@» stays in front of the name
    const acc = el('div', 'gl-lc-acc'); const line = el('span'); if (handle) { const h = el('bdi', null, '@' + handle); h.dir = 'ltr'; line.append(h, document.createTextNode(' · ')); } line.append(pName); acc.append(ui(pIcon), line);
    const game = el('div', 'gl-lc-game'); game.append(ui('games'), el('span', null, st.currentGame || st.game || 'لعبة'));
    const meta = el('div', 'gl-lc-meta');
    if (Number.isFinite(st.players)) { const c = el('span', 'gl-chip'); c.append(ui('users'), el('b', null, String(st.players)), document.createTextNode(st.players === 1 ? ' لاعب' : ' لاعب')); meta.append(c); }
    if (st.joinOpen && st.keyword) meta.append(el('span', 'gl-chip is-word', 'اكتب: ' + st.keyword));
    else meta.append(el('span', 'gl-chip', st.active ? 'جولة جارية' : 'بانتظار اللاعبين'));
    info.append(top, acc, game, meta);
    li.append(ava, info);
    return li;
  }
  const rail = $('liveRail');
  function navState() {
    const max = rail.scrollWidth - rail.clientWidth; const pos = Math.abs(rail.scrollLeft);
    const [prev, next] = document.querySelectorAll('.gl-car-btn');
    prev.disabled = pos < 4; next.disabled = pos > max - 4;
    $('liveNav').hidden = max < 8;
  }
  $('liveNav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dir]'); if (!b) return;
    const step = (rail.querySelector('.gl-lc')?.offsetWidth || 330) + 16;
    const rtl = getComputedStyle(rail).direction === 'rtl';
    const dir = b.dataset.dir === 'next' ? 1 : -1;
    rail.scrollBy({ left: (rtl ? -1 : 1) * dir * step * Math.max(1, Math.floor(rail.clientWidth / step) - 1), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  rail.addEventListener('scroll', () => requestAnimationFrame(navState), { passive: true });
  // drag the rail with a mouse too (touch already swipes); a drag never opens a stream by accident
  let drag = null, dragged = false;
  rail.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' || e.button !== 0) return; drag = { x: e.clientX, left: rail.scrollLeft }; dragged = false; });
  addEventListener('pointermove', (e) => {
    if (!drag) return; const dx = e.clientX - drag.x;
    if (!dragged && Math.abs(dx) > 6) { dragged = true; rail.classList.add('is-drag'); }
    if (dragged) rail.scrollLeft = drag.left - dx;
  });
  addEventListener('pointerup', () => { if (!drag) return; drag = null; setTimeout(() => rail.classList.remove('is-drag'), 0); });
  rail.addEventListener('click', (e) => { if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; } }, true);
  let liveTimer = 0;
  async function loadStreams() {
    clearTimeout(liveTimer);
    if (!document.hidden) {
      try {
        const d = await fetch('/api/streams', { cache: 'no-store' }).then((r) => r.json());
        const list = (d.streams || []).slice(0, 30);
        $('liveTrack').replaceChildren(...list.map(streamCard));
        rail.hidden = !list.length; $('liveEmpty').hidden = !!list.length;
        $('liveCount').hidden = !list.length; $('liveCount').textContent = '(' + list.length + ')';
        if (list.length) requestAnimationFrame(navState); else $('liveNav').hidden = true;
      } catch { /* keep what is shown */ }
    }
    liveTimer = setTimeout(loadStreams, 20_000);
  }
  loadStreams();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadStreams(); });

  /* ---------------- «اتصل بالبث»: the visitor's real link state ---------------- */
  function connect(stateName, status, text, label, href) {
    $('connect').dataset.state = stateName;
    $('connStatus').querySelector('span').textContent = status;
    if (text) $('connText').textContent = text;
    $('connLink').textContent = label; $('connLink').href = href;
  }
  fetch('/api/access/me', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json()).then(async (me) => {
    if (!me.account) { connect('guest', 'غير مسجّل', 'سجّل الدخول بحساب مجاني، ثم اربط TikTok أو Kick مرة واحدة — وكل لعبة تتصل ببثك من صفحتها.', 'ربط حساب البث', '/login?next=%2Faccount%23platforms'); return; }
    $('accountLink').textContent = 'حسابي'; $('accountLink').href = '/account';
    const p = await fetch('/api/me/profile', { credentials: 'same-origin', cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const linked = Object.entries(p?.linked || {}).filter(([, v]) => v && v.handle);
    if (!linked.length) { connect('none', 'غير مرتبط', 'لم تربط حساب بث بعد — اربط TikTok أو Kick مرة واحدة، وكل لعبة تتصل ببثك من صفحتها.', 'ربط حساب البث', '/account#platforms'); return; }
    const reauth = linked.filter(([, v]) => v.needsReauth);
    const names = linked.map(([k, v]) => (k === 'tiktok' ? 'TikTok' : 'Kick') + ' @' + v.handle).join(' · ');
    if (reauth.length === linked.length) { connect('reauth', 'يحتاج إعادة ربط', 'انتهت صلاحية ربط ' + names + ' — أعد الربط لتتصل الألعاب ببثك.', 'إعادة الربط', '/account#platforms'); return; }
    // the live state of this account's own room, as the server sees it
    let live = false;
    if (me.room) { const s = await fetch('/api/state?room=' + encodeURIComponent(me.room), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null); live = s?.connection?.state === 'connected' && !!s.connection.liveConfirmed; }
    connect(live ? 'live' : 'linked', live ? 'متصل بالبث الآن' : 'مرتبط · غير متصل الآن', 'حساباتك المربوطة: ' + names + (live ? ' — بثك متصل الآن.' : ' — تتصل اللعبة ببثك عند فتحها والدخول للوبي.'), 'إدارة الاتصال', '/account#platforms');
  }).catch(() => {});

  /* ---------------- sections ease in once ---------------- */
  const reveal = document.querySelectorAll('.gl-reveal');
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver((entries) => { for (const en of entries) if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }, { rootMargin: '0px 0px -6% 0px' });
    reveal.forEach((n) => io.observe(n));
  } else reveal.forEach((n) => n.classList.add('is-in'));
})();
