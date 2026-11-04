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
    if (!code) {
      // no code typed: a signed-in subscriber goes straight in; anyone else gets told what is needed
      if (me && (me.signedIn || me.account)) { enterStudio(); return; }
      showError('أدخل الرمز الترويجي'); input.focus(); return;
    }
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
      $('linkTrial').href = $('planTrial').href = $('barTrial').href = $('menuTrial').href = '/account#trial';
      $('barAccount').href = $('menuAccount').href = '/account';
      // restored from the session cookie: show who is signed in (name, picture, permanent ID)
      const shortName = me.account.displayName.length > 14 ? me.account.displayName.slice(0, 13) + '…' : me.account.displayName;
      $('bar').classList.add('is-signed');
      $('barAccountLabel').textContent = shortName; $('menuAccountLabel').textContent = 'حسابي — ' + me.account.publicId;
      if (me.account.picture) { const img = document.createElement('img'); img.className = 'hm-bar-pic'; img.src = me.account.picture; img.alt = ''; img.width = 26; img.height = 26; img.referrerPolicy = 'no-referrer'; $('barAccount').querySelector('svg')?.replaceWith(img); }
      $('barAccount').title = me.account.publicId;
      $('menuSecond').hidden = true; $('menuLogout').hidden = false;
      if (me.account.entitled) { $('barTrial').hidden = true; $('barStudio').hidden = false; $('heroStudio').querySelector('span').textContent = 'ادخل الاستوديو'; $('heroStudio').href = '/studio'; }
      else { $('heroStudio').querySelector('span').textContent = 'حسابي'; $('heroStudio').href = '/account'; }
    } else if (me.signedIn) {
      // promo-code or owner session: offer the studio and a way out
      $('barTrial').hidden = true; $('barStudio').hidden = false; $('menuLogout').hidden = false;
    }
    paintStatus();
  }).catch(() => {}).finally(() => document.documentElement.classList.remove('me-pending'));
  fetch('/api/site', { cache: 'force-cache' }).then((r) => r.json()).then((site) => {
    const url = site.support?.url; if (!url) return;
    const a = $('supportLink'); a.href = url; a.hidden = false;
  }).catch(() => {});
  $('year').textContent = String(new Date().getFullYear());

  /* ------------------------------------------------------- hero: demo wheel + simulated chat
     An illustration only (no stream, no server): the real game's results are decided on the server. */
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SEATS = ['ليلى', 'عمر', 'سارة', 'نور', 'علي', 'ريم', 'فهد', 'مها'];
  const disc = $('wheelDisc'), wheel = $('wheel'), spinBtn = $('spinButton');
  let turn = 0, spinning = false;
  function spin() {
    if (spinning) return;
    spinning = true; spinBtn.disabled = true; $('wheelWinner').textContent = ''; wheel.classList.remove('has-winner');
    for (const s of disc.querySelectorAll('.hm-seat.is-win')) s.classList.remove('is-win');
    const pick = Math.floor(Math.random() * SEATS.length);
    // seat i sits at i*45°; the pointer is at the top, so turn until that seat reaches 0°, plus whole turns
    const from = turn, to = turn + 360 * (reduce ? 1 : 6) + ((360 - pick * 45 - (turn % 360)) % 360 + 360) % 360;
    const done = () => {
      turn = to % 360; disc.style.setProperty('--spin', turn + 'deg');
      for (const a of anims) a.cancel(); // the static CSS takes over at the same angle
      spinning = false; spinBtn.disabled = false; wheel.classList.remove('is-spinning'); wheel.classList.add('has-winner');
      disc.querySelector('.s' + pick)?.classList.add('is-win');
      $('wheelWinner').textContent = '🎉 الفائز: ' + SEATS[pick];
      spinBtn.querySelector('span').textContent = 'أعد التجربة';
      if (!reduce) { const c = $('confetti'); c.classList.remove('is-on'); void c.offsetWidth; c.classList.add('is-on'); }
    };
    // Web Animations on transform only: the compositor turns the disc, the seats turn back so names stay upright
    const opts = { duration: reduce ? 1 : 5200, easing: 'cubic-bezier(.45,.05,.12,1)', fill: 'forwards' };
    wheel.classList.add('is-spinning');
    const anims = [disc.animate([{ transform: 'rotate(' + from + 'deg)' }, { transform: 'rotate(' + to + 'deg)' }], opts)];
    disc.querySelectorAll('.hm-seat').forEach((seat, i) => {
      const inner = seat.firstElementChild, a = i * 45;
      anims.push(inner.animate([{ transform: 'rotate(' + -(a + from) + 'deg)' }, { transform: 'rotate(' + -(a + to) + 'deg)' }], opts));
    });
    anims[0].finished.then(done, done);
  }
  spinBtn.addEventListener('click', spin);

  const CHAT = [
    ['🐠', 'ليلى', 'انضم', 'join'], ['🦀', 'عمر', 'جاهزين للجولة؟'], ['⭐', 'سارة', 'انضم', 'join'], ['🐙', 'نور', 'الإجابة 2', 'right'],
    ['🐚', 'علي', 'يلا نلعب!'], ['🐳', 'ريم', 'انضم', 'join'], ['🪼', 'فهد', 'الإجابة 3'], ['🐡', 'مها', 'الإجابة 2', 'right'],
  ];
  const list = $('chatList');
  let ci = 0, chatTimer = 0, heroVisible = true;
  function addChat() {
    const [av, name, text, kind] = CHAT[ci++ % CHAT.length];
    const li = document.createElement('li'); li.className = 'hm-msg' + (kind ? ' is-' + kind : '');
    const a = document.createElement('i'); a.className = 'av'; a.textContent = av;
    const body = document.createElement('div'); const n = document.createElement('b'); n.textContent = name;
    const t = document.createElement('span'); t.textContent = kind === 'join' ? 'انضم للجولة ✓' : text;
    body.append(n, t); li.append(a, body);
    if (kind === 'right') { const ok = document.createElement('em'); ok.textContent = 'إجابة صحيحة'; li.append(ok); }
    list.append(li);
    while (list.children.length > 4) list.firstElementChild.remove();
  }
  function chatLoop() { clearTimeout(chatTimer); if (!heroVisible || document.hidden) return; addChat(); chatTimer = setTimeout(chatLoop, 1900); }
  for (let i = 0; i < 3; i++) addChat();
  if (!reduce) {
    // pause everything while the hero is off-screen or the tab is hidden
    new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; $('heroPlay').classList.toggle('is-off', !heroVisible); if (heroVisible) chatTimer = setTimeout(chatLoop, 1200); else clearTimeout(chatTimer); }).observe($('heroPlay'));
    document.addEventListener('visibilitychange', () => { if (!document.hidden && heroVisible) chatTimer = setTimeout(chatLoop, 1200); });
  }

  /* ---------------------------------------------- studio & free-trial flow
     The server decides everything (session, subscription, trial). This page only asks and shows the answer. */
  const flow = $('flow');
  const fmtLeft = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)), h = Math.floor(m / 60); return h ? `${h} ساعة و${m % 60} دقيقة` : `${m % 60} دقيقة`; };
  async function refreshMe() { me = await fetch('/api/access/me', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json()); paintStatus(); return me; }
  let statusTimer = 0;
  function paintStatus() {
    clearTimeout(statusTimer);
    const a = me?.account, el = $('heroStatus'), text = $('heroStatusText');
    el.dataset.state = 'trial'; el.dataset.action = 'trial';
    if (a?.entitled) {
      el.dataset.state = 'on'; el.dataset.action = 'studio'; el.href = '/studio';
      text.textContent = a.plan === 'trial' ? 'تجربتك المجانية فعالة — متبقي ' + fmtLeft(new Date(a.endsAt) - Date.now()) : 'اشتراكك فعال — دخول الاستوديو';
      statusTimer = setTimeout(paintStatus, 30_000);
    } else if (me?.signedIn) { el.dataset.state = 'on'; el.dataset.action = 'studio'; el.href = '/studio'; text.textContent = 'أنت مسجّل الدخول — دخول الاستوديو'; }
    else if (a && a.trial?.status !== 'available') { el.dataset.state = 'off'; el.dataset.action = 'renew'; el.href = '#plans'; text.textContent = 'انتهى اشتراكك — جدّد الآن'; }
    else text.textContent = 'ابدأ تجربتك المجانية لمدة 24 ساعة';
  }
  function showFlow(kind, { intent = 'trial', message = '' } = {}) {
    const T = {
      auth: [intent === 'trial' ? 'ابدأ تجربتك المجانية لمدة 24 ساعة' : 'سجّل الدخول لدخول الاستوديو', intent === 'trial' ? 'سجّل الدخول أو أنشئ حسابًا مجانيًا، وتبدأ تجربتك مباشرة بعده.' : 'ادخل بحسابك المشترك، أو أنشئ حسابًا وابدأ تجربتك المجانية.', 'i-user'],
      expired: ['انتهى اشتراكك', 'اشتراكك أو تجربتك انتهت. جدّد اشتراكك لتعود إلى الاستوديو — حسابك ومعرّفك محفوظان.', 'i-hourglass'],
      none: ['لا يوجد اشتراك فعّال', 'فعّل تجربتك المجانية لمدة 24 ساعة، أو اختر باقة.', 'i-ticket'],
      verify: ['أكّد بريدك أولًا', message || 'لتفعيل التجربة المجانية أكّد بريدك الإلكتروني من صفحة «حسابي»، أو سجّل الدخول باستخدام Google.', 'i-shield'],
      error: ['تعذر إتمام الطلب', message, 'i-close'],
      wait: ['لحظة…', '', 'i-sparkle'],
      done: ['تم تفعيل تجربتك المجانية بنجاح', 'لديك 24 ساعة كاملة. جارٍ فتح الاستوديو…', 'i-check'],
    }[kind];
    $('flowTitle').textContent = T[0]; $('flowText').textContent = T[1]; $('flowText').hidden = !T[1];
    $('flowIconUse').setAttribute('href', '/icons.svg#' + T[2]);
    $('flowError').hidden = true;
    $('flowAuth').hidden = kind !== 'auth';
    $('flowPlans').hidden = !['expired', 'none'].includes(kind);
    $('flowTrial').hidden = !(['expired', 'none'].includes(kind) && me?.account?.trial?.status === 'available');
    $('flowWait').hidden = !['wait', 'done'].includes(kind);
    $('flowSignup').href = '/signup?intent=' + intent; $('flowLogin').href = '/login?intent=' + intent;
    if (kind === 'verify') { $('flowAuth').hidden = false; $('flowSignup').textContent = 'افتح صفحة «حسابي»'; $('flowSignup').href = '/account'; $('flowLogin').hidden = true; }
    else { $('flowSignup').textContent = 'إنشاء حساب بالبريد'; $('flowLogin').hidden = false; }
    if (flow.hidden) { lastFocusFlow = document.activeElement; flow.hidden = false; document.documentElement.classList.add('menu-open'); }
    $('flowClose').focus();
    if (kind === 'auth' || kind === 'verify') mountGoogle(intent);
  }
  let lastFocusFlow = null;
  function hideFlow() { if (flow.hidden) return; flow.hidden = true; document.documentElement.classList.remove('menu-open'); lastFocusFlow?.focus?.(); }
  $('flowClose').addEventListener('click', hideFlow);
  flow.addEventListener('click', (e) => { if (e.target === flow) hideFlow(); else if (e.target.closest('a[href^="#"]')) hideFlow(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !flow.hidden) hideFlow(); });
  let googleLoaded = null;
  function mountGoogle(intent) {
    googleLoaded ||= new Promise((resolve) => { const sc = document.createElement('script'); sc.src = '/google.js'; sc.onload = resolve; sc.onerror = resolve; document.head.append(sc); });
    googleLoaded.then(async () => {
      if (!window.SpongeGoogle) return;
      const shown = await window.SpongeGoogle.render($('flowGoogle'), async (credential) => {
        showFlow('wait');
        try { await window.SpongeGoogle.signIn(credential); await refreshMe(); intent === 'trial' ? startTrial() : enterStudio(); }
        catch (err) { showFlow('auth', { intent }); $('flowError').textContent = err.message; $('flowError').hidden = false; }
      });
      $('flowOr').hidden = !shown;
    });
  }
  let acting = false;
  async function enterStudio() {
    if (acting) return; acting = true;
    try {
      await refreshMe();
      if (me.signedIn) { location.assign('/studio'); return; } // a running subscription/trial, a promo code or the owner
      if (!me.account) { showFlow('auth', { intent: 'studio' }); return; }
      showFlow(me.account.expired || me.account.trial?.status === 'expired' ? 'expired' : 'none');
    } catch { showFlow('error', { message: 'تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مجددًا.' }); }
    finally { acting = false; }
  }
  async function startTrial() {
    if (acting) return; acting = true;
    try {
      await refreshMe();
      if (!me.account) { showFlow('auth', { intent: 'trial' }); return; }
      if (me.signedIn) { location.assign('/studio'); return; } // already has access: no new trial is created
      showFlow('wait');
      const r = await post('/api/me/trial-start', {});
      if (r.ok) {
        if (r.data.started) { showFlow('done'); setTimeout(() => location.assign('/studio'), 1400); }
        else location.assign('/studio');
        return;
      }
      if (r.status === 403) showFlow('verify', { message: r.data.error });
      else if (r.status === 409) { await refreshMe(); showFlow('expired'); }
      else showFlow('error', { message: r.data.error || 'تعذر تفعيل التجربة' });
    } catch { showFlow('error', { message: 'انقطع الاتصال قبل اكتمال الطلب. لم يُفعّل شيء مرتين — حاول مرة أخرى.' }); }
    finally { acting = false; }
  }
  $('flowTrial').addEventListener('click', startTrial);
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]'); if (!a) return;
    const action = a.dataset.action;
    if (action === 'renew') return; // a normal link to #plans
    e.preventDefault(); closeMenu(false);
    if (action === 'trial') startTrial(); else if (action === 'studio') enterStudio();
  });

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
    const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
    const handleName = (st.username || '').replace(/^@/, '');
    const display = st.displayName || handleName || 'بث مباشر';
    const platformName = st.platform === 'kick' ? 'Kick' : 'TikTok';
    const li = mk('li', 'hm-live'); li.dataset.platform = st.platform === 'kick' ? 'kick' : 'tiktok';
    const top = mk('div', 'hm-live-top');
    // The broadcaster's real picture when the platform gave one; otherwise a styled initial.
    const ava = mk('span', 'hm-ava'); ava.setAttribute('aria-hidden', 'true');
    ava.append(mk('span', 'hm-ava-letter', Array.from(display.trim())[0]?.toUpperCase() || '؟'));
    if (st.avatarUrl && /^https:\/\//.test(st.avatarUrl)) {
      const img = mk('img'); img.alt = ''; img.width = 64; img.height = 64; img.decoding = 'async'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      img.addEventListener('load', () => ava.classList.add('has-img'), { once: true });
      img.addEventListener('error', () => img.remove(), { once: true });
      img.src = st.avatarUrl; ava.append(img);
    }
    const who = mk('div', 'hm-live-who');
    const name = mk('b', '', display);
    const handle = mk('span', 'hm-live-handle');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', GAME_ICON[st.platform] || GAME_ICON.tiktok); svg.append(use);
    handle.append(svg, mk('span', '', (handleName ? '@' + handleName + ' · ' : '') + platformName));
    who.append(name, handle);
    const live = mk('span', 'hm-badge-live'); live.append(mk('i'), document.createTextNode('LIVE'));
    const ring = mk('span', 'hm-ava-wrap'); ring.append(ava, live);
    top.append(ring, who);
    const bottom = mk('div', 'hm-live-bottom');
    const game = mk('span', 'hm-live-game', st.currentGame || st.game || 'لعبة');
    const count = mk('span', 'hm-live-count');
    count.append(mk('b', '', String(st.players || 0)), document.createTextNode(' لاعب'));
    bottom.append(game, count);
    const acts = mk('div', 'hm-live-acts');
    if (st.liveUrl && /^https:\/\/(www\.tiktok\.com|kick\.com)\//.test(st.liveUrl)) {
      const watch = mk('a', 'hm-pill hm-pill-gold hm-live-watch');
      watch.href = st.liveUrl; watch.target = '_blank'; watch.rel = 'noopener noreferrer';
      watch.setAttribute('aria-label', 'شاهد بث ' + display + ' على ' + platformName + ' (يفتح في تبويب جديد)');
      watch.append(mk('span', 'hm-live-dot'), document.createTextNode('شاهد البث'));
      acts.append(watch);
    } else {
      const off = mk('button', 'hm-pill hm-pill-ghost hm-live-watch', 'رابط البث غير متوفر حالياً'); off.type = 'button'; off.disabled = true;
      acts.append(off);
    }
    const a = mk('a', 'hm-pill hm-pill-ghost hm-live-game-btn', 'شاهد اللعبة'); a.href = '/play?room=' + encodeURIComponent(st.room);
    acts.append(a);
    li.append(top, bottom, acts);
    return li;
  }
  let liveTimer = 0, lastStreams = [];
  function paintStreams() {
    const g = $('liveGame').value;
    $('liveTrack').replaceChildren(...lastStreams.filter((x) => !g || (x.currentGame || x.game) === g).slice(0, 20).map(streamCard));
  }
  $('liveGame').addEventListener('change', paintStreams);
  async function loadStreams() {
    clearTimeout(liveTimer);
    if (!document.hidden) {
      try {
        const d = await fetch('/api/streams', { cache: 'no-store' }).then((r) => r.json());
        $('liveCount').textContent = String(d.totalStreams || 0); $('livePlayers').textContent = String(d.totalPlayers || 0);
        lastStreams = d.streams || [];
        const sel = $('liveGame'), games = [...new Set(lastStreams.map((x) => x.currentGame || x.game).filter(Boolean))];
        const keep = sel.value;
        sel.replaceChildren(new Option('كل الألعاب', ''), ...games.map((g) => new Option(g, g)));
        sel.value = games.includes(keep) ? keep : '';
        paintStreams();
        const empty = !lastStreams.length;
        $('liveEmpty').hidden = !empty; $('liveTrack').hidden = empty;
        document.querySelector('.hm-car-nav').hidden = (d.streams || []).length < 2;
      } catch { /* keep what is shown */ }
    }
    liveTimer = setTimeout(loadStreams, 20_000);
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

  /* ------------------------------------------- off-screen pause + light parallax
     Sections that are not visible stop animating; the hero layers move with scroll and pointer
     through CSS variables, at most once per frame, and not at all with reduced motion. */
  if ('IntersectionObserver' in window) {
    const watch = new IntersectionObserver((entries) => { for (const e of entries) e.target.classList.toggle('is-off', !e.isIntersecting); }, { rootMargin: '120px 0px' });
    document.querySelectorAll('.hm-hero, .hm-sec, .hm-strip, .hm-foot').forEach((el) => watch.observe(el));
  }
  const hero = document.querySelector('.hm-hero');
  if (hero && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let frame = 0, px = 0;
    const paint = () => { frame = 0; const sy = Math.min(1, Math.max(0, scrollY / (hero.offsetHeight || 1))); hero.style.setProperty('--sy', sy.toFixed(3)); hero.style.setProperty('--px', px.toFixed(3)); };
    const ask = () => { if (!frame) frame = requestAnimationFrame(paint); };
    addEventListener('scroll', ask, { passive: true });
    if (matchMedia('(pointer: fine)').matches) hero.addEventListener('pointermove', (e) => { px = (e.clientX / innerWidth - 0.5) * 2; ask(); }, { passive: true });
  }

  /* ------------------------------------------------------------------- reveal */
  const items = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach((el) => io.observe(el));
  } else document.documentElement.classList.add('no-io');
})();
