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

  /* ------------------------------------------- weekly leaderboard (counted by the server) */
  const LB_METRICS = {
    players: [['wins', 'الانتصارات'], ['entries', 'المشاركات'], ['hours', 'الساعات']],
    streamers: [['hours', 'الساعات'], ['players', 'اللاعبون'], ['sessions', 'الجلسات'], ['rounds', 'الجولات']],
  };
  const LB_HOW = {
    'players:wins': 'المركز الأول في كل جولة منتهية داخل بث موثّق ومرتبط رسميًا. الجولة الأقصر من 15 ثانية لا تُحسب.',
    'players:entries': 'كل جولة مؤهلة شارك فيها اللاعب من بدايتها. الجولة الأقصر من 15 ثانية لا تُحسب، ولا تُحسب الجولة مرتين إذا تداخل وقتها مع جولة في بث آخر.',
    'players:hours': 'مدة الجولات المؤهلة التي شارك فيها (حتى ساعة للجولة الواحدة). الوقت المتداخل بين بثّين في نفس اللحظة يُحسب مرة واحدة فقط.',
    'streamers:hours': 'الوقت الذي كانت فيه لعبة تعمل فعليًا في بث مباشر موثّق والاستوديو مفتوح — وليس عدد المتابعين.',
    'streamers:players': 'عدد اللاعبين المختلفين الذين شاركوا في جولات الستريمر هذا الأسبوع (كل لاعب مرة واحدة).',
    'streamers:sessions': 'عدد جلسات الألعاب الحقيقية التي بدأها الستريمر في بث موثّق.',
    'streamers:rounds': 'عدد الجولات المكتملة (15 ثانية على الأقل) في بثوث الستريمر.',
  };
  const lb = { board: 'players', metric: 'wins', endsAt: 0, timer: 0, prev: false, poll: 0 };
  const lbMk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  function lbAvatar(src, name) {
    const ava = lbMk('span', 'hm-ava lb-ava'); ava.setAttribute('aria-hidden', 'true');
    ava.append(lbMk('span', 'hm-ava-letter', Array.from(String(name || '').trim())[0]?.toUpperCase() || '؟'));
    if (src && (/^https:\/\//.test(src) || src.startsWith('/'))) {
      const img = lbMk('img'); img.alt = ''; img.width = 56; img.height = 56; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.addEventListener('load', () => ava.classList.add('has-img'), { once: true });
      img.addEventListener('error', () => img.remove(), { once: true });
      img.src = src; ava.append(img);
    }
    return ava;
  }
  function lbValue(r, board = lb.board, metric = lb.metric) {
    if (board === 'players') return metric === 'entries' ? [r.entries, 'مشاركة'] : metric === 'hours' ? [r.hours, 'ساعة'] : [r.wins, 'فوز'];
    return { players: [r.players, 'لاعب'], sessions: [r.sessions, 'جلسة'], rounds: [r.rounds, 'جولة'] }[metric] || [r.hours, 'ساعة'];
  }
  function paintMetrics() {
    $('lbMetrics').replaceChildren(...LB_METRICS[lb.board].map(([key, label]) => {
      const b = lbMk('button', 'lb-metric', label); b.type = 'button'; b.dataset.metric = key; b.setAttribute('aria-pressed', String(key === lb.metric));
      return b;
    }));
    document.querySelectorAll('[data-board]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.board === lb.board)));
    $('lbHowMetric').textContent = LB_METRICS[lb.board].find(([k]) => k === lb.metric)[1];
    $('lbHowText').textContent = LB_HOW[lb.board + ':' + lb.metric] || '';
    $('lbFound').hidden = true; $('lbFoundMsg').hidden = true;
  }
  function lbRow(row) {
    const li = lbMk('li', 'lb-row' + (row.rank <= 3 ? ' is-top is-top' + row.rank : ''));
    const rank = lbMk('span', 'lb-rank', String(row.rank));
    if (row.rank <= 3) rank.append(lbMk('i', 'lb-star', '★'));
    const who = lbMk('div', 'lb-who');
    who.append(lbMk('b', 'lb-name', row.name));
    const tags = lbMk('div', 'lb-tags');
    if (row.handle) { const h = lbMk('span', 'lb-chip is-handle', '@' + row.handle); h.dir = 'ltr'; tags.append(h); }
    if (row.publicId) { const id = lbMk('a', 'lb-chip is-id', row.publicId); id.href = '/u/' + encodeURIComponent(row.publicId); id.dir = 'ltr'; tags.append(id); }
    if (!row.handle && !row.publicId && row.platform) tags.append(lbMk('span', 'lb-chip', row.platform === 'kick' ? 'Kick' : 'TikTok'));
    who.append(tags);
    const [n, unit] = lbValue(row);
    const val = lbMk('span', 'lb-val'); val.append(lbMk('b', '', String(n)), document.createTextNode(' ' + unit));
    li.append(rank, lbAvatar(row.picture || row.avatar, row.name), who, val);
    return li;
  }
  async function loadBoard() {
    clearTimeout(lb.poll);
    try {
      const r = await fetch('/api/leaderboard?board=' + lb.board + '&metric=' + lb.metric + (lb.prev ? '&week=prev' : ''));
      if (!r.ok) throw new Error();
      const d = await r.json();
      if (!lb.prev && d.endsAt) { lb.endsAt = Date.parse(d.endsAt) || 0; tickClock(); }
      $('lbList').replaceChildren(...(d.rows || []).map(lbRow));
      $('lbEmpty').hidden = !!(d.rows || []).length;
      $('lbScope').textContent = lb.prev ? 'نتائج الأسبوع الماضي (مؤرشفة)' : 'أفضل 5 هذا الأسبوع';
      // «عليها جوائز» only when the owner announced real prizes for this board
      const prizes = d.prizes || [];
      $('lbPrize').hidden = !prizes.length;
      $('lbPrizes').hidden = !prizes.length;
      $('lbPrizes').replaceChildren(...prizes.map((p) => { const li = lbMk('li'); li.append(lbMk('b', '', p.rankFrom === p.rankTo ? 'المركز ' + p.rankFrom : 'المراكز ' + p.rankFrom + '–' + p.rankTo), document.createTextNode(': ' + p.title + (p.conditions ? ' — ' + p.conditions : ''))); return li; }));
    } catch { $('lbList').replaceChildren(); $('lbEmpty').hidden = false; }
    if (!lb.prev && !document.hidden) lb.poll = setTimeout(loadBoard, 60_000); // «يُحدّث تلقائيًا»
  }
  function tickClock() {
    clearTimeout(lb.timer);
    if (!lb.endsAt) return;
    const left = Math.max(0, lb.endsAt - Date.now());
    const parts = { d: Math.floor(left / 86400000), h: Math.floor(left / 3600000) % 24, m: Math.floor(left / 60000) % 60, s: Math.floor(left / 1000) % 60 };
    for (const b of $('lbClock').querySelectorAll('b')) b.textContent = b.dataset.u === 'd' ? String(parts.d) : String(parts[b.dataset.u]).padStart(2, '0');
    if (left === 0) { setTimeout(loadBoard, 3000); return; } // the server closes the week and starts the next one
    lb.timer = setTimeout(tickClock, 1000);
  }
  document.querySelector('.lb-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-board]'); if (!b || b.dataset.board === lb.board) return;
    lb.board = b.dataset.board; lb.metric = LB_METRICS[lb.board][0][0]; paintMetrics(); loadBoard();
  });
  $('lbMetrics').addEventListener('click', (e) => {
    const b = e.target.closest('[data-metric]'); if (!b || b.dataset.metric === lb.metric) return;
    lb.metric = b.dataset.metric; paintMetrics(); loadBoard();
  });
  $('lbHow').addEventListener('click', () => { const open = $('lbHowText').hidden; $('lbHowText').hidden = !open; $('lbHow').setAttribute('aria-expanded', String(open)); });
  $('lbWeek').addEventListener('click', () => { lb.prev = !lb.prev; $('lbWeek').textContent = lb.prev ? 'العودة لهذا الأسبوع' : 'عرض نتائج الأسبوع الماضي'; loadBoard(); });
  $('lbFind').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('lbFoundMsg'), card = $('lbFound'), id = $('lbFindInput').value.trim().toUpperCase();
    card.hidden = true; msg.hidden = false;
    if (!/^SPG-[A-Z0-9]{4,8}$/.test(id)) { msg.textContent = 'اكتب المعرف بالشكل SPG-XXXXXX'; return; }
    try {
      const r = await fetch('/api/leaderboard?board=' + lb.board + '&metric=' + lb.metric + '&find=' + encodeURIComponent(id));
      const d = await r.json();
      if (!r.ok) { msg.textContent = d.error || 'لم نجد هذا المعرف'; return; }
      const f = d.found, [n, unit] = lbValue(f);
      msg.hidden = true; card.hidden = false; card.href = '/u/' + encodeURIComponent(f.publicId);
      const rank = lbMk('span', 'lb-rank', f.rank ? String(f.rank) : '—');
      const who = lbMk('div', 'lb-who'); who.append(lbMk('b', 'lb-name', f.name), lbMk('small', '', f.rank ? 'المركز ' + f.rank + ' هذا الأسبوع' : 'لم يدخل الترتيب هذا الأسبوع بعد'));
      const val = lbMk('span', 'lb-val'); val.append(lbMk('b', '', String(n)), document.createTextNode(' ' + unit));
      card.replaceChildren(rank, lbAvatar(f.picture || f.avatar, f.name), who, val);
    } catch { msg.textContent = 'تعذر البحث الآن، حاول مرة أخرى'; }
  });
  paintMetrics();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && lb.loaded) loadBoard(); });

  /* ------------------------------------------- «شركاء النجاح»: only partners the owner added */
  async function loadPartners() {
    let list = [];
    try { list = (await (await fetch('/api/partners')).json()).partners || []; } catch {}
    const show = list.length > 0;
    $('partners').hidden = !show;
    document.querySelectorAll('[data-partners-link]').forEach((a) => { a.hidden = !show; });
    if (!show) return;
    $('ptTrack').replaceChildren(...list.map((p, i) => {
      const li = lbMk('li', 'pt-card'); li.dataset.i = String(i);
      const pic = lbMk('div', 'pt-pic');
      const ring = lbMk('span', 'pt-ring');
      ring.append(lbMk('span', 'pt-letter', Array.from(p.name)[0] || '؟'));
      if (p.photo) { const img = lbMk('img'); img.alt = ''; img.width = 132; img.height = 132; img.loading = 'lazy'; img.src = p.photo; ring.append(img); }
      const plat = lbMk('span', 'pt-plat'); plat.setAttribute('aria-label', p.platform === 'kick' ? 'Kick' : 'TikTok');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', p.platform === 'kick' ? '/icons.svg#i-kick' : '/icons.svg#i-note'); svg.append(use); plat.append(svg);
      pic.append(ring, plat);
      const body = lbMk('div', 'pt-body');
      if (p.official) { const badge = lbMk('span', 'pt-badge'); badge.append(lbMk('i', '', '✓'), document.createTextNode(' شريك رسمي')); body.append(badge); }
      const title = lbMk('div', 'pt-title'); const h = lbMk('span', 'pt-handle', '@' + p.handle); h.dir = 'ltr';
      title.append(lbMk('h3', '', p.name), h);
      body.append(title, lbMk('p', 'pt-desc', p.description || (p.platform === 'kick' ? 'صانع محتوى على Kick' : 'صانع محتوى على TikTok')));
      const visit = lbMk('a', 'pt-visit', 'زيارة الحساب'); visit.href = p.url; visit.target = '_blank'; visit.rel = 'noopener noreferrer';
      li.append(pic, body, visit);
      return li;
    }));
    const track = $('ptTrack'), total = list.length;
    $('ptNav').hidden = total < 2;
    const current = () => { const mid = track.getBoundingClientRect().left + track.clientWidth / 2; let best = 0, dist = Infinity; [...track.children].forEach((c, i) => { const r = c.getBoundingClientRect(); const d = Math.abs(r.left + r.width / 2 - mid); if (d < dist) { dist = d; best = i; } }); return best; };
    const paint = () => { const i = current(); $('ptCount').textContent = (i + 1) + ' من ' + total; document.querySelector('[data-pt="prev"]').disabled = i === 0; document.querySelector('[data-pt="next"]').disabled = i === total - 1; [...track.children].forEach((c, k) => c.classList.toggle('is-current', k === i)); };
    let raf = 0; track.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint); }, { passive: true });
    $('ptNav').onclick = (e) => {
      const b = e.target.closest('[data-pt]'); if (!b) return;
      const i = Math.max(0, Math.min(total - 1, current() + (b.dataset.pt === 'next' ? 1 : -1)));
      track.children[i].scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
    };
    paint();
  }

  /* ------------------------------------------- «كود الغرفة»: opens the streamer's game page */
  $('roomInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); $('roomError').hidden = true; });
  $('roomInput').addEventListener('focus', () => setTimeout(() => $('roomForm').scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)); // keep the button above the keyboard
  $('roomForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('roomInput').value, err = $('roomError');
    const fail = (m) => { err.textContent = m; err.hidden = false; $('roomInput').focus(); };
    if (code.length !== 4) return fail('اكتب الكود كاملًا — 4 خانات');
    try {
      const r = await fetch('/api/room-code?code=' + encodeURIComponent(code), { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !/^\/play\?room=[a-z0-9]+$/.test(d.url || '')) return fail(d.error || 'الكود غير صحيح');
      location.href = d.url;
    } catch { fail('تعذر الاتصال — حاول مرة أخرى'); }
  });
  new IntersectionObserver((entries, obs) => { if (entries.some((x) => x.isIntersecting)) { obs.disconnect(); lb.loaded = true; loadBoard(); } }, { rootMargin: '300px' }).observe($('leaders'));
  loadPartners();

  /* ------------------------------------------- FAQ accordion */
  document.querySelector('.fq-list').addEventListener('click', (e) => {
    const q = e.target.closest('.fq-q'); if (!q) return;
    const open = q.getAttribute('aria-expanded') !== 'true';
    q.setAttribute('aria-expanded', String(open));
    $(q.getAttribute('aria-controls')).hidden = !open;
    q.closest('.fq-item').classList.toggle('is-open', open);
  });

  /* ------------------------------------------- header: its real height keeps anchored titles below it */
  const setBarH = () => document.documentElement.style.setProperty('--hm-bar-h', ($('bar')?.offsetHeight || 64) + 'px');
  setBarH(); addEventListener('resize', setBarH, { passive: true });
  /* ------------------------------------------- header: «المزيد» and the current section */
  const more = $('moreButton'), moreMenu = $('moreMenu');
  const closeMore = () => { moreMenu.hidden = true; more.setAttribute('aria-expanded', 'false'); };
  more.addEventListener('click', (e) => { e.stopPropagation(); const open = moreMenu.hidden; moreMenu.hidden = !open; more.setAttribute('aria-expanded', String(open)); });
  document.addEventListener('click', (e) => { if (!moreMenu.hidden && !e.target.closest('.hm-more')) closeMore(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !moreMenu.hidden) { closeMore(); more.focus(); } });
  moreMenu.addEventListener('click', (e) => { if (e.target.closest('a')) closeMore(); });
  const spyLinks = [...document.querySelectorAll('.hm-nav > a[href^="#"], .hm-menu-nav a[href^="#"]')];
  const spy = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) {
      const id = en.target.id === 'top' ? '#top' : '#' + en.target.id;
      for (const a of spyLinks) { if (a.getAttribute('href') === id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); }
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  for (const id of ['top', 'live', 'leaders', 'partners', 'room', 'faq', 'plans']) { const el = document.getElementById(id); if (el) spy.observe(el); }

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
