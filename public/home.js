/* SPONGE LIVE — entry page. The server checks the promo code and opens a session; this page only sends it.
   Below the window: platform tabs and a real stream connection (through the studio API, status read by
   light polling — no live socket on this page), scroll reveal, and links that follow the visitor's account. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const form = $('promoForm'), input = $('promoCode'), button = $('promoSubmit'), error = $('promoError');
  const next = (() => { const n = new URLSearchParams(location.search).get('next') || '/studio'; return /^\/(studio|dashboard|event|bomb|play)\b/.test(n) ? n : '/studio'; })();
  let busy = false, me = null;
  document.addEventListener('visibilitychange', () => document.documentElement.classList.toggle('is-hidden', document.hidden));
  const post = (url, body) => fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
    .then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }));

  function showError(message) {
    error.textContent = message; error.hidden = !message;
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (message) { error.style.animation = 'none'; void error.offsetWidth; error.style.removeProperty('animation'); }
  }
  input.addEventListener('input', () => { if (!error.hidden) showError(''); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return; // one request at a time, however many times the button is pressed
    const code = input.value.trim();
    if (!code) { showError('أدخل الرمز الترويجي'); input.focus(); return; }
    busy = true; button.disabled = true; button.classList.add('is-busy'); showError('');
    try {
      const res = await post('/api/access/redeem', { code });
      if (res.ok) { $('promoLabel').textContent = res.data.voucher ? 'تم تفعيل الاشتراك' : 'تم — جارٍ فتح الاستوديو'; location.replace(res.data.voucher ? res.data.next : next); return; }
      showError(res.data.error || (res.status === 429 ? 'محاولات كثيرة، انتظر قليلًا' : 'تعذر التحقق من الرمز'));
      input.select();
    } catch {
      showError('تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مجددًا.');
    } finally {
      busy = false; button.disabled = false; button.classList.remove('is-busy');
    }
  });

  /* ---------------------------------------------------------------- account-aware links */
  fetch('/api/access/me', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json()).then((data) => {
    me = data;
    if (me.signedIn) $('sessionNote').hidden = false;
    if (me.account) {
      // signed in with an account: the sign-up/login links become the account page
      $('linkSignup').textContent = 'حسابي (' + me.account.publicId + ')'; $('linkSignup').href = '/account';
      $('linkLogin').hidden = true;
      $('linkTrial').href = $('planTrial').href = $('heroTrial').href = $('barTrial').href = $('menuTrial').href = '/account#trial';
      $('barAccount').href = $('menuAccount').href = '/account';
      $('barAccountLabel').textContent = $('menuAccountLabel').textContent = 'حسابي';
      $('barAccount').title = me.account.publicId;
      $('menuSecond').hidden = true; $('menuLogout').hidden = false;
      if (me.account.entitled) { $('barTrial').textContent = 'الاستوديو'; $('barTrial').href = '/studio'; }
    } else if (me.signedIn) {
      // promo-code or owner session: offer the studio and a way out
      $('barTrial').textContent = 'الاستوديو'; $('barTrial').href = '/studio'; $('menuLogout').hidden = false;
    }
    updateConnectGate();
  }).catch(() => {});
  fetch('/api/site', { cache: 'force-cache' }).then((r) => r.json()).then((site) => {
    const url = site.support?.url; if (!url) return;
    const a = $('supportLink'); a.href = url; a.hidden = false;
  }).catch(() => {});
  $('year').textContent = String(new Date().getFullYear());

  /* -------------------------------------------------------------------- connect */
  const PLATFORMS = {
    tiktok: { name: 'TikTok LIVE', icon: '/icons.svg#i-note', placeholder: 'أدخل اسم حسابك على TikTok', hint: 'ابدأ بثك المباشر على TikTok أولًا، ثم اربطه هنا.' },
    kick: { name: 'Kick LIVE', icon: '/icons.svg#i-kick', placeholder: 'أدخل اسم حسابك على Kick', hint: 'اكتب اسم قناتك على Kick كما يظهر في رابطها (دعم تجريبي).' },
  };
  const panel = $('connectPanel'), handle = $('connectHandle'), connectBtn = $('connectButton'), status = $('connectStatus'), stateText = $('connectStateText'), msg = $('connectMsg');
  const tabs = [...document.querySelectorAll('.hm-tabs [role="tab"]')];
  let platform = 'tiktok', pollTimer = 0, pollUntil = 0, connecting = false;
  function setPlatform(p, focus) {
    platform = p; const cfg = PLATFORMS[p];
    for (const t of tabs) { const on = t.dataset.platform === p; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); }
    panel.dataset.platform = p; panel.setAttribute('aria-labelledby', p === 'kick' ? 'tabKick' : 'tabTiktok');
    $('connectName').textContent = cfg.name; $('connectHint').textContent = cfg.hint;
    $('connectIcon').setAttribute('href', cfg.icon);
    handle.placeholder = cfg.placeholder; $('connectLabel').textContent = cfg.placeholder; handle.value = '';
    setStatus('idle', 'غير متصل'); updateConnectGate();
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => setPlatform(t.dataset.platform));
    t.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length; // RTL: left = next
      setPlatform(tabs[j].dataset.platform, true);
    });
  });
  function setStatus(state, text) { status.dataset.state = state; stateText.textContent = text; }
  /** Who may connect: a live promo session, the owner, or an account with a running trial/subscription. */
  function canConnect() { return !!(me && me.signedIn && me.live); }
  function updateConnectGate() {
    if (!me) return;
    if (canConnect()) { msg.textContent = 'يُربط البث بغرفتك في الاستوديو. كتابة الاسم وحدها لا تثبت ملكية الحساب — الحالة تتحول إلى «متصل» فقط عند وصول شات البث فعلًا.'; return; }
    if (me.account && !me.account.verified) msg.textContent = 'أكّد بريدك الإلكتروني من صفحة «حسابي» ثم فعّل التجربة أو اشترك لربط البث.';
    else if (me.account) msg.textContent = 'فعّل التجربة المجانية أو اشترك من صفحة «حسابي» لربط بثك.';
    else if (me.signedIn && !me.live) msg.textContent = 'رمزك الحالي للتجربة بلاعبين تجريبيين فقط ولا يشمل ربط البث.';
    else msg.textContent = 'لربط البث: أنشئ حسابًا وفعّل التجربة المجانية أو اشترك، أو ادخل برمز ترويجي.';
  }
  panel.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (connecting) return;
    const name = handle.value.trim().replace(/^@/, '');
    if (!name) { setStatus('error', 'أدخل اسم الحساب أولًا'); handle.focus(); return; }
    if (!canConnect()) { setStatus('blocked', 'يلزم تسجيل الدخول وتجربة أو اشتراك فعّال'); updateConnectGate(); msg.focus?.(); return; }
    connecting = true; connectBtn.disabled = true; connectBtn.classList.add('is-busy');
    setStatus('connecting', 'جارٍ الاتصال بالبث…');
    try {
      const res = await post('/api/admin/connect', { platform, username: name });
      if (!res.ok) { setStatus(res.status === 402 || res.status === 403 ? 'blocked' : 'error', res.data.error || 'تعذر الربط'); return; }
      pollUntil = Date.now() + 90_000; poll();
    } catch { setStatus('error', 'تعذر الاتصال بالخادم'); }
    finally { connecting = false; connectBtn.disabled = false; connectBtn.classList.remove('is-busy'); }
  });
  /* status comes from the room state (the same truth the studio shows), polled every 2.5 s only while waiting */
  async function poll() {
    clearTimeout(pollTimer);
    if (document.hidden) { pollTimer = setTimeout(poll, 2500); return; }
    try {
      const s = await fetch('/api/state?room=' + encodeURIComponent(me.room || 'main'), { cache: 'no-store', credentials: 'same-origin' }).then((r) => r.json());
      const c = s.connection || {};
      if (c.state === 'connected') { setStatus('connected', 'متصل — ' + (c.platform === 'kick' ? 'Kick' : 'TikTok') + ' @' + (c.username || '')); return; }
      if (c.state === 'error') setStatus('error', c.message || 'تعذر الاتصال — تأكد أن البث شغال الآن');
      else setStatus('connecting', c.message || 'جارٍ الاتصال بالبث…');
    } catch { /* keep the last status */ }
    if (Date.now() < pollUntil) pollTimer = setTimeout(poll, 2500);
    else if (status.dataset.state === 'connecting') setStatus('error', 'لم يصل شات البث بعد — تأكد أن البث شغال ثم حاول مجددًا');
  }

  /* ------------------------------------------------------------------- menu */
  const menu = $('menu'), menuBtn = $('menuButton');
  let lastFocus = null;
  function openMenu() {
    lastFocus = document.activeElement; menu.hidden = false; menuBtn.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('menu-open'); $('menuClose').focus();
  }
  function closeMenu(restore = true) {
    if (menu.hidden) return;
    menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); document.documentElement.classList.remove('menu-open');
    if (restore) lastFocus?.focus?.();
  }
  menuBtn.addEventListener('click', openMenu);
  $('menuClose').addEventListener('click', () => closeMenu());
  menu.addEventListener('click', (e) => { if (e.target === menu) closeMenu(); else if (e.target.closest('a')) closeMenu(false); });
  document.addEventListener('keydown', (e) => {
    if (menu.hidden) return;
    if (e.key === 'Escape') { closeMenu(); return; }
    if (e.key === 'Tab') { // keep focus inside the open menu
      const f = [...menu.querySelectorAll('a[href],button:not([hidden])')].filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  });
  $('menuLogout').addEventListener('click', async () => {
    await fetch('/api/access/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    location.reload();
  });

  /* --------------------------------------------------------- carousels */
  for (const b of document.querySelectorAll('[data-scroll]')) b.addEventListener('click', () => {
    const track = $(b.dataset.scroll), step = (track.firstElementChild?.offsetWidth || 300) + 14;
    // RTL: "next" moves toward the left
    track.scrollBy({ left: (b.dataset.dir === 'next' ? -1 : 1) * step, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });

  /* ------------------------------------------- live streams (real rooms only) */
  const GAME_ICON = { tiktok: '/icons.svg#i-note', kick: '/icons.svg#i-kick' };
  function streamCard(st) {
    const li = document.createElement('li'); li.className = 'hm-live';
    const top = document.createElement('div'); top.className = 'hm-live-top';
    const ava = document.createElement('span'); ava.className = 'hm-ava'; ava.setAttribute('aria-hidden', 'true'); ava.textContent = (st.username || '?').trim().charAt(0).toUpperCase();
    const who = document.createElement('div'); who.className = 'hm-live-who';
    const name = document.createElement('b'); name.textContent = st.username || 'بث مباشر';
    const handle = document.createElement('span');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', GAME_ICON[st.platform] || GAME_ICON.tiktok); svg.append(use);
    handle.append(svg, document.createTextNode('@' + (st.username || '') + ' · ' + (st.platform === 'kick' ? 'Kick' : 'TikTok')));
    who.append(name, handle);
    const live = document.createElement('span'); live.className = 'hm-badge-live'; live.append(document.createElement('i'), document.createTextNode('LIVE'));
    top.append(ava, who, live);
    const bottom = document.createElement('div'); bottom.className = 'hm-live-bottom';
    const game = document.createElement('span'); game.className = 'hm-live-game'; game.textContent = st.game || 'لعبة';
    const count = document.createElement('span'); count.className = 'hm-live-count';
    const n = document.createElement('b'); n.textContent = String(st.players || 0); count.append(n, document.createTextNode(' لاعب'));
    bottom.append(game, count);
    const a = document.createElement('a'); a.className = 'hm-pill hm-pill-ghost'; a.href = '/play?room=' + encodeURIComponent(st.room); a.textContent = 'شاهد اللعبة';
    li.append(top, bottom, a);
    return li;
  }
  let liveTimer = 0;
  async function loadStreams() {
    clearTimeout(liveTimer);
    if (!document.hidden) {
      try {
        const d = await fetch('/api/streams', { cache: 'no-store' }).then((r) => r.json());
        $('liveCount').textContent = String(d.totalStreams || 0); $('livePlayers').textContent = String(d.totalPlayers || 0);
        $('liveTrack').replaceChildren(...(d.streams || []).slice(0, 20).map(streamCard));
        const empty = !(d.streams || []).length;
        $('liveEmpty').hidden = !empty; $('liveTrack').hidden = empty;
        document.querySelector('.hm-car-nav').hidden = (d.streams || []).length < 2;
      } catch { /* keep what is shown */ }
    }
    liveTimer = setTimeout(loadStreams, 45_000);
  }
  loadStreams();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadStreams(); });

  /* -------------------------------------------------------------- plan tabs */
  const planTabs = [...document.querySelectorAll('[data-plan-tab]')];
  function selectPlan(id, scroll) {
    for (const t of planTabs) t.setAttribute('aria-selected', String(t.dataset.planTab === id));
    for (const c of document.querySelectorAll('.hm-plan')) c.classList.toggle('is-focus', c.id === 'plan-' + id);
    const track = $('planTrack');
    if (scroll && track.scrollWidth > track.clientWidth + 4) $('plan-' + id).scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
  planTabs.forEach((t) => t.addEventListener('click', () => selectPlan(t.dataset.planTab, true)));
  selectPlan('monthly', false);

  /* ------------------------------------------------------------------- reveal */
  const items = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach((el) => io.observe(el));
  } else document.documentElement.classList.add('no-io');
})();
