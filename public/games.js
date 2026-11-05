/* سبونج لايف — «مكتبة الألعاب». Everything comes from the catalogue (/api/site): the games, their categories,
   the «جديد» badges and «آخر التحديثات». Every game is free; «العب الآن» opens that game's own page
   (settings → lobby → round). No WebSocket here. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const icon = (mode, cls) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '/game-icons.svg#g-' + mode); s.append(u); return s; };
  const fmtDate = (d) => { try { return new Intl.DateTimeFormat('ar-SA-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d + 'T12:00:00')); } catch { return d; } };
  $('year').textContent = String(new Date().getFullYear());
  let games = [], filter = 'all';
  try { const f = new URLSearchParams(location.search).get('cat'); if (['smart', 'elimination', 'luck', 'group', 'new'].includes(f)) filter = f; } catch {}

  function card(g, i) {
    const li = el('li', 'gl-card' + (g.isNew ? ' is-new' : ''));
    li.dataset.cat = g.category; li.style.setProperty('--i', String(i % 12));
    li.append(icon(g.mode, 'gl-mark'));
    const top = el('div', 'gl-card-top');
    top.append(el('span', 'gl-num', String(i + 1).padStart(2, '0')));
    const ic = el('span', 'gl-ic'); ic.append(icon(g.mode, 'gl-ic-svg')); top.append(ic);
    const badges = el('div', 'gl-badges');
    badges.append(el('span', 'gl-badge', g.categoryLabel));
    if (g.isNew) badges.append(el('span', 'gl-badge is-new', 'جديد'));
    const h = el('h3', null, g.title);
    const p = el('p', 'gl-desc', g.summary);
    const rules = el('ul', 'gl-rules');
    for (const r of (g.rules || []).slice(0, 2)) rules.append(el('li', null, r));
    const a = el('a', 'gl-btn gl-play'); a.href = '/game/' + g.mode; a.setAttribute('aria-label', 'العب الآن: ' + g.title);
    a.append(el('span', null, 'العب الآن'), el('i', 'gl-arrow', '←'));
    li.append(top, badges, h, p, rules, a);
    return li;
  }
  function paint() {
    const shown = games.filter((g) => filter === 'all' || (filter === 'new' ? g.isNew : g.category === filter));
    for (const b of document.querySelectorAll('[data-filter]')) b.setAttribute('aria-selected', String(b.dataset.filter === filter));
    $('gameGrid').replaceChildren(...shown.map(card));
    $('gridEmpty').hidden = shown.length > 0;
    $('gameCount').textContent = shown.length ? (shown.length === 1 ? 'لعبة واحدة' : shown.length + ' لعبة') + (filter === 'all' ? ' — كلها مجانية' : '') : '';
  }
  $('filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]'); if (!b) return;
    filter = b.dataset.filter; paint();
    try { history.replaceState(null, '', filter === 'all' ? '/games' : '/games?cat=' + filter); } catch {}
  });
  // arrow keys move between the filter tabs
  $('filters').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tabs = [...document.querySelectorAll('[data-filter]')]; const i = tabs.indexOf(document.activeElement); if (i < 0) return;
    const n = tabs[(i + (e.key === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length]; n.focus(); n.click();
  });

  function updates(list, byMode) {
    if (!list?.length) return;
    $('updateList').replaceChildren(...list.slice(0, 4).map((u) => {
      const g = byMode.get(u.mode);
      const c = el('article', 'gl-upd' + (g?.isNew ? ' is-new' : ''));
      const head = el('div', 'gl-upd-head');
      const ic = el('span', 'gl-ic gl-ic-sm'); ic.append(icon(g ? g.mode : 'quiz', 'gl-ic-svg')); if (!g) { ic.classList.add('is-all'); ic.querySelector('use').setAttribute('href', '/icons.svg#i-sparkle'); }
      const t = el('div'); t.append(el('h3', null, u.title), el('time', null, fmtDate(u.date))); t.querySelector('time').dateTime = u.date;
      head.append(ic, t);
      if (g?.isNew) head.append(el('span', 'gl-badge is-new', 'لعبة جديدة'));
      const ul = el('ul', 'gl-upd-items'); for (const it of u.items) ul.append(el('li', null, it));
      const a = el('a', 'gl-btn ' + (g ? 'gl-try' : 'gl-btn-ghost'));
      a.href = g ? '/game/' + g.mode : '#gameGrid'; a.textContent = g ? 'جرّب ' + g.title : 'تصفح الألعاب';
      c.append(head, ul, a); return c;
    }));
    $('updates').hidden = false;
  }

  fetch('/api/site', { cache: 'no-store' }).then((r) => r.json()).then((site) => {
    // newest first inside each category order: new games lead the list
    games = [...(site.games || []), ...(site.extraGames || [])].filter((g) => g.status === 'available');
    games.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0));
    paint();
    updates(site.gameUpdates, new Map(games.map((g) => [g.mode, g])));
  }).catch(() => { $('gridEmpty').hidden = false; $('gridEmpty').textContent = 'تعذر تحميل الألعاب. تحقق من الاتصال وأعد المحاولة.'; });

  // the visitor's account: the sign-in link becomes «حسابي»; the stream card says what is linked
  fetch('/api/access/me', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json()).then((me) => {
    if (!me.account) { $('liveLink').href = '/login?next=%2Faccount%23settings'; $('liveText').textContent = 'سجّل الدخول بحساب مجاني، ثم اربط TikTok أو Kick مرة واحدة — وكل لعبة تتصل ببثك من صفحتها.'; return; }
    $('accountLink').textContent = 'حسابي'; $('accountLink').href = '/account';
    return fetch('/api/me/profile', { credentials: 'same-origin', cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((p) => {
      const linked = Object.entries(p?.linked || {}).filter(([, v]) => v && !v.needsReauth).map(([k, v]) => (k === 'tiktok' ? 'TikTok' : 'Kick') + ' @' + v.handle);
      if (linked.length) { $('liveTitle').textContent = 'بثك جاهز للربط'; $('liveText').textContent = 'حساباتك المربوطة: ' + linked.join(' · ') + ' — اختر لعبة واتصل ببثك من صفحتها.'; $('liveLink').textContent = 'إدارة الربط'; document.querySelector('.gl-live').classList.add('is-on'); }
    });
  }).catch(() => {});
})();
