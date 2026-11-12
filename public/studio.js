/* سبونج لايف — a game's own page (/game/<mode>; there is no separate studio). The screens follow the server's
   state (src/flow.mjs): «إعداد اللعبة» → «جاري تجهيز اللوبي» (real preparation steps) → «غرفة الانتظار» → round → results.
   «تشغيل اللعبة» opens the setup, «ابدأ اللعبة» prepares the lobby, «فتح التسجيل» / «إغلاق التسجيل» control who
   joins, and only «بدء الجولة الآن» starts a round. Every node is built with createElement/textContent. */
(() => {
  'use strict';
  // a page restored from the back/forward cache is checked again (the session may have ended meanwhile)
  addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const MODES = ['quiz', 'drawguess', 'chairs', 'bowling', 'bomb', 'categories', 'rps', 'roles', 'roulette', 'redlight', 'country', 'flag', 'tug', 'outsider', 'chain',
    'guess', 'race', 'glass', 'truefalse', 'higherlower', 'minority', 'wheel'];
  let codeAt = 0; // last «كود الغرفة» request
  const pathMode = (location.pathname.match(/^\/game\/([a-z]+)$/) || [])[1];
  let mode = MODES.includes(pathMode) ? pathMode : MODES.includes(params.get('mode')) ? params.get('mode') : 'quiz';
  // the games list is «مكتبة الألعاب» (/games); leaving this page never ends anything on the server
  let toListing = false, booted = false, autoOpening = false;
  const toList = () => { toListing = true; location.assign('/games'); };
  const NO_TIMER = ['race', 'wheel'];
  // server stage → studio screen
  const SCREEN = { GAME_LIBRARY: 'games', GAME_SETUP: 'setup', PREPARING_LOBBY: 'prepare', WAITING_FOR_PLAYERS: 'lobby', GAME_RUNNING: 'game', GAME_FINISHED: 'game' };
  let browsing = false; // the host looks at the library while a game session is still open on the server
  let game = { mode, title: '', minPlayers: 1, rules: [], setup: '/event?mode=' + mode };
  let state = null, seen = new Set(), firstPaint = true, busy = false, retries = 0, site = null, ws = null, me = {};
  let advFor = '', wordTouched = false, readyFlash = 0;

  const session = () => window.SkySession;
  const fx = () => window.SpongeFx;
  const ownerToken = () => session()?.ownerToken?.() || '';
  /** Host = whoever controls this room; an explicit ?room= of someone else is a read-only view. */
  function isHost() { return true; } // the server only serves /studio to a signed-in host
  const roomPath = (p) => session() ? session().withRoom(p) : p;
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const initial = (n) => Array.from(String(n || '؟').replace(/^@/, '').trim())[0] || '؟';
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  let toastTimer = 0;
  function feedback(msg, error = false) {
    const f = $('feedback'); f.textContent = msg || ''; f.classList.toggle('is-error', !!error);
    // on the full-screen round the message shows as a short toast under the bar
    const t = $('gmToast'); clearTimeout(toastTimer);
    t.hidden = !msg || document.body.dataset.screen !== 'game'; t.textContent = msg || ''; t.classList.toggle('is-error', !!error);
    if (msg) toastTimer = setTimeout(() => { t.hidden = true; }, error ? 6000 : 3500);
  }
  $('gmActions').prepend($('adminBar').firstElementChild); // the round's buttons live in the slim top bar

  /** The session ended (signed out elsewhere, account stopped): the round on screen is kept (viewers and OBS still
      see it), but the server refuses new commands until the host signs in again. */
  function expired(message) {
    if (document.getElementById('expiredBanner')) return;
    const b = el('div', 'st-expired'); b.id = 'expiredBanner'; b.setAttribute('role', 'alert');
    const t = el('span', '', message || 'انتهت جلستك — الجولة الحالية محفوظة على الشاشة، سجّل الدخول للمتابعة.');
    const a = el('a', '', 'تسجيل الدخول'); a.href = '/login?next=' + encodeURIComponent(location.pathname);
    b.append(t, a); document.body.prepend(b);
  }
  // One id per studio window: the server lets only one window control the room and counts it as the host being present.
  const TAB = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, '');
  async function admin(action, body = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-Studio-Tab': TAB };
    const t = ownerToken(); if (t) Object.assign(headers, { Authorization: 'Bearer ' + t });
    const res = await fetch('/api/admin/' + action, { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify(body) });
    let data = {}; try { data = await res.json(); } catch {}
    if (res.status === 402 && data.needPlan && action === 'connect') $('planNotice').hidden = false;
    else if (res.status === 402) expired(data.error);
    if (res.status === 409 && data.otherWindow) $('windowBanner').hidden = false;
    if (!res.ok) throw Object.assign(new Error(data.error || 'تعذر تنفيذ الطلب'), { code: res.status });
    return data;
  }

  /* ---------- game identity ---------- */
  function paintGame() {
    document.title = (game.title || 'شاشة اللعبة') + ' | سبونج لايف';
    document.body.dataset.category = game.category || 'smart';
    $('gameTitle').textContent = game.title || '';
    $('gameCategory').textContent = game.categoryLabel || '';
    $('gameSummary').textContent = game.summary || '';
    $('gameRules').replaceChildren(...(game.rules || []).map((r) => el('li', '', r)));
    const cover = game.cover ? game.cover.replace('.webp', '-200.webp') : '/covers/' + mode + '.svg';
    $('gameCover').src = cover;
    $('crumbTitle').textContent = game.title || '';
    $('sideTitle').textContent = game.title || '';
    $('sideCover').src = game.cover ? coverAt(game, 120) : cover;
    if ($('gameNav').children.length) markCurrent();
    $('gameCover').closest('.pl-cover').classList.toggle('is-art', cover.startsWith('/cards/'));
    $('setupTitle').textContent = game.title || ''; $('setupSummary').textContent = game.summary || '';
    $('setupCover').src = game.cover ? coverAt(game, 200) : cover;
    $('lbGame').textContent = game.title || '';
    $('setupGuess').hidden = mode !== 'guess';
  }

  /* ---------- roster ---------- */
  function avatarNode(p) {
    const box = el('span', 'pl-av'); box.append(el('span', '', initial(p.name)));
    if (p.avatar && /^https:\/\//.test(p.avatar)) {
      const img = el('img'); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.decoding = 'async'; img.src = p.avatar;
      img.addEventListener('error', () => img.remove(), { once: true });
      box.append(img);
    }
    return box;
  }
  // One listener for every ✕ button, however often the roster is redrawn.
  $('players').addEventListener('click', (e) => {
    const x = e.target.closest('.pl-remove'); if (!x) return;
    run(x, async () => { await admin('remove-player', { number: Number(x.dataset.number) }); feedback('حُذف ' + x.dataset.name); });
  });
  function renderRoster(list, canRemove, outIds) {
    const items = [...list].reverse(); // newest first so arrivals are visible
    let joined = 0;
    const nodes = items.map((p) => {
      const key = p.number + '\u0000' + p.name;
      const li = el('li', 'pl-player sp-tilt');
      const isNew = !seen.has(key) && !firstPaint;
      if (isNew) { li.classList.add('is-new'); joined++; }
      if (p.host) li.classList.add('is-host');
      if (outIds?.has(p.name)) li.classList.add('is-out');
      seen.add(key);
      const av = avatarNode(p);
      li.append(av, el('span', 'pl-name', p.name), el('b', 'pl-no', '#' + p.number));
      if (p.host) li.append(el('small', 'pl-tag', 'المشرف'));
      else if (p.bot) li.append(el('small', 'pl-tag is-bot', 'تجريبي'));
      if (canRemove) {
        const x = el('button', 'pl-remove', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'حذف ' + p.name);
        x.dataset.number = p.number; x.dataset.name = p.name; // handled by one delegated listener on the list
        li.append(x);
      }
      if (isNew) requestAnimationFrame(() => fx()?.burst(av, 10));
      return li;
    });
    $('players').replaceChildren(...nodes);
    $('rosterEmpty').hidden = list.length > 0;
    if (joined) fx()?.play('join');
    firstPaint = false;
  }

  /* ---------- view ---------- */
  function viewFor(s) {
    if (s.status.active) return s.status.mode === mode ? 'live' : 'busy';
    if (s.flow?.stage === 'GAME_RUNNING') return 'live'; // between two questions of a series
    if (s.status.mode === mode && s.status.results && s.registration.phase !== 'open') return 'done';
    return 'join';
  }
  /** The server's stage decides which screen is shown; a reload or a reconnect lands on the same one. */
  function syncStage(s) {
    const f = s.flow || { stage: 'GAME_LIBRARY' };
    if (f.mode && f.mode !== mode && MODES.includes(f.mode)) {
      mode = f.mode; game = allGames().find((x) => x.mode === mode) || { mode, title: mode, rules: [] };
      seen = new Set(); firstPaint = true; secretRound = -1; advFor = ''; wordTouched = false;
      paintGame();
    }
    let screen = SCREEN[f.stage] || 'games';
    // no library here: with nothing open on the server, this page opens its own game's settings
    if (screen === 'games' && booted && !toListing && !autoOpening) { autoOpening = true; playGame(mode).finally(() => { autoOpening = false; }); }
    // «اللوبي جاهز!» stays on the preparation card for a moment so the host sees it finish (the lobby is already live)
    if (screen === 'lobby' && document.body.dataset.screen === 'prepare' && Date.now() < readyFlash) screen = 'prepare';
    if (document.body.dataset.screen !== screen) showScreen(screen);
    const open = f.stage !== 'GAME_LIBRARY' && f.mode;
    $('resumeGame').hidden = !(browsing && open);
    if (open) $('resumeText').textContent = (f.stage === 'GAME_RUNNING' ? 'تُلعب الآن' : f.stage === 'GAME_SETUP' ? 'تجهّز' : f.stage === 'PREPARING_LOBBY' ? 'يُجهَّز لوبي' : 'مفتوحة') + ' «' + (game.title || '') + '»';
    if (open && location.pathname !== '/game/' + mode) history.replaceState(null, '', '/game/' + mode);
  }
  function render(s) {
    if (!s?.status) return;
    const prev = state; state = s;
    syncStage(s);
    const reg = s.registration || {}, flow = s.flow || {};
    const host = isHost();
    const view = viewFor(s);
    document.body.dataset.view = view;
    document.body.dataset.stage = flow.stage || 'GAME_LIBRARY';
    const word = reg.keyword || flow.join?.keyword || 'انضم';
    for (const n of document.querySelectorAll('#joinWord,.pl-word-sm,.pl-word-inline')) n.textContent = word;
    const count = Number(s.playerCount || 0);
    if ($('playerCount').textContent !== num(count)) { $('playerCount').textContent = num(count); $('playerCount').classList.remove('bump'); void $('playerCount').offsetWidth; $('playerCount').classList.add('bump'); }
    $('playerCountLabel').textContent = count === 1 ? 'لاعب منضم' : 'لاعبين منضمين';
    const out = new Set((s.party?.players || []).filter((p) => p.alive === false).map((p) => p.name));
    renderRoster(Array.isArray(s.roster) ? s.roster : [], host && !s.status.active, out);
    $('topCount').textContent = num(count); paintConnection(s.connection); paintLeaders(s.leaderboard);
    if (!prev || prev.status.active !== s.status.active || prev.status.mode !== s.status.mode) markCurrent();

    const need = Math.max(0, (reg.minPlayers || game.minPlayers || 1) - count);
    $('needNote').textContent = view === 'join' ? (need ? 'ينقص ' + num(need) + (need === 1 ? ' لاعب' : ' لاعبين') + ' للبدء' : 'العدد مكتمل — جاهزون للبدء') : '';
    $('needNote').classList.toggle('is-ready', !need);
    const series = s.series && s.series.total > 1 ? ' • السؤال ' + num(s.series.index || 1) + ' من ' + num(s.series.total) : '';
    $('callSubText').textContent = view === 'busy' ? 'تُلعب الآن «' + (s.status.title || '') + '» — انتظر انتهاءها'
      : view === 'done' ? 'انتهت الجولة — بانتظار الجولة التالية'
      : reg.phase === 'open' ? (count ? 'بانتظار انضمام المزيد من اللاعبين' : 'بانتظار انضمام اللاعبين')
      : 'التسجيل مغلق — لا يُقبل لاعبون جدد';
    $('joinCall').hidden = view === 'live';
    paintLobby(s, count);

    const showFrame = view === 'live' || view === 'done';
    $('liveView').hidden = !showFrame;
    if (showFrame) {
      const base = roomPath('/overlay'), src = base + (base.includes('?') ? '&' : '?') + 'embedded=1' + (host && !(mode === 'roulette' && previewSound()) ? '&mute=1' : ''); // the switch lives in the roulette bar
      if ($('liveFrame').dataset.src !== src) { $('liveFrame').dataset.src = src; $('liveFrame').src = src; }
      $('liveNotice').textContent = (s.status.notice || '') + series;
      document.querySelector('.pl-live-tag').lastChild.textContent = view === 'live' ? 'اللعبة جارية' : 'النتائج';
    }
    const lateOpen = reg.lateJoin === 'open' && (site?.lateJoinModes || []).includes(mode);
    $('lateNote').hidden = !showFrame;
    $('lateCount').textContent = lateOpen && view === 'live' ? ' وتدخل الجولة الآن' : (reg.waitingCount ? ' • ' + num(reg.waitingCount) + ' بانتظار الجولة التالية' : ' وستدخل الجولة التالية');
    if (prev && !prev.status.active && s.status.active && s.status.mode === mode) fx()?.play('start');

    // Host controls.
    $('adminBar').hidden = !host || document.body.dataset.screen !== 'game'; $('hostPanel').hidden = !host;
    $('overlayLink').hidden = !host; $('overlayLink').href = roomPath('/overlay');
    if (host && Date.now() - codeAt > 120_000) { // «كود الغرفة» for viewers; asked again now and then (codes live in server memory)
      codeAt = Date.now();
      admin('room-code').then((r) => { $('roomCode').textContent = r.code; $('roomCodeChip').hidden = false; }).catch(() => { codeAt = 0; });
    }
    paintRoundBar(s, view);
    if (host) paintHost(s, view, need);
    else $('hostTools').hidden = true;
    paintSetup(s); paintPrepare(s); paintLobbyView(s);
  }
  /** The slim bar of the full-screen round: game, stage, question, players and the honest stream state. */
  function paintRoundBar(s, view) {
    if (document.body.dataset.screen !== 'game') return;
    const c = s.connection || {}, demo = !!(s.flow?.lobby?.demo || s.flow?.trial);
    $('gmTitle').textContent = game.title || s.status.title || '';
    $('gmStage').textContent = view === 'done' ? 'النتائج' : view === 'busy' ? 'لعبة أخرى جارية' : 'الجولة جارية';
    if (view === 'done') $('gmStage').dataset.done = '1'; else delete $('gmStage').dataset.done;
    const ser = s.series && s.series.total > 1 ? 'السؤال ' + num(s.series.index || 1) + ' من ' + num(s.series.total) : '';
    $('gmSeries').hidden = !ser; $('gmSeries').textContent = ser;
    $('gmCount').textContent = num(s.playerCount || 0);
    const live = c.state === 'connected' && (c.liveConfirmed || c.verified || me.owner || ownerToken());
    const tone = demo ? 'demo' : live ? 'ok' : c.state === 'connecting' ? 'wait' : 'bad';
    $('gmConn').dataset.tone = tone;
    $('gmConnText').textContent = demo ? 'وضع التجربة — بلا بث' : live ? 'متصل · ' + (c.platform === 'kick' ? 'Kick' : 'TikTok')
      : c.state === 'connecting' ? 'جارٍ الاتصال…' : (c.detail || 'البث غير متصل');
    $('gmConn').title = c.detail || '';
    $('gmTools').setAttribute('aria-expanded', String(document.body.dataset.drawer === 'open'));
  }
  $('gmTools').addEventListener('click', () => $('drawerToggle').click());
  $('gmFloatTools').addEventListener('click', () => $('drawerToggle').click());
  /* «ملء الشاشة»: only when the host asks (never forced). The browser's full screen when it is available
     (a direct click), otherwise an expanded view inside the page; Escape or «الخروج من ملء الشاشة» leaves it. */
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const liveHome = document.createComment('live-view'); // where the game frame lives outside full screen
  function immersive(on) {
    if (on) document.body.dataset.immersive = '1'; else delete document.body.dataset.immersive;
    // the frame goes to the top of the page while in full screen (no parent can clip or offset it); the iframe keeps its game
    const live = $('liveView');
    if (on && live.parentNode !== document.body) { live.before(liveHome); document.body.append(live); }
    else if (!on && liveHome.parentNode) { liveHome.replaceWith(live); }
    $('gmFloat').hidden = !on;
    $('gmFull').setAttribute('aria-pressed', String(on));
    $('gmFull').lastElementChild.textContent = on ? 'الخروج من ملء الشاشة' : 'ملء الشاشة';
    if (!on && document.body.dataset.drawer === 'open') $('drawerToggle').click();
    requestAnimationFrame(() => dispatchEvent(new Event('resize')));
  }
  async function enterFull() {
    immersive(true);
    const root = document.documentElement, req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (req) { try { await req.call(root, { navigationUI: 'hide' }); } catch { /* refused: the in-page view stays */ } }
  }
  async function leaveFull() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (fsEl() && exit) { try { await exit.call(document); } catch {} }
    immersive(false);
  }
  $('gmFull').addEventListener('click', () => (document.body.dataset.immersive ? leaveFull() : enterFull()));
  $('gmExit').addEventListener('click', leaveFull);
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => { if (!fsEl() && document.body.dataset.immersive) immersive(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.dataset.immersive) leaveFull(); });
  function paintHost(s, view, need) {
    const reg = s.registration || {}, active = !!s.status.active, stage = s.flow?.stage;
    const waiting = stage === 'WAITING_FOR_PLAYERS';
    $('adminJoin').hidden = !(view === 'join' && waiting);
    $('adminLive').hidden = !(view === 'live' || view === 'busy');
    $('adminDone').hidden = view !== 'done' || stage !== 'GAME_FINISHED';
    $('drawButton').hidden = !(mode === 'wheel' && view === 'live' && active);
    $('advanceButton').hidden = view !== 'live' || !active || NO_TIMER.includes(mode) || mode === 'roulette';
    paintRoulette(s, view, active);
    const seated = !!reg.hostSeated;
    $('hostSeatButton').setAttribute('aria-pressed', String(seated));
    $('hostSeatLabel').textContent = seated ? 'إلغاء مشاركتي' : 'دخّلني كلاعب';
    // «بدء الجولة الآن» — the only button that starts the round
    $('startButton').disabled = busy || need > 0 || !waiting;
    $('startLabel').textContent = need > 0 ? 'بدء الجولة الآن (ينقص ' + num(need) + ')' : 'بدء الجولة الآن';
    $('demoButton').hidden = s.connection?.state === 'connected';
    if (document.activeElement !== $('maxInput')) $('maxInput').value = String(reg.maxPlayers || 1500);
    $('autoHost').checked = reg.hostJoin === 'auto';
    for (const id of ['stopButton', 'liveStopButton']) $(id).disabled = !active && !s.series?.nextAt;
    $('keywordForm').querySelectorAll('input,button').forEach((n) => { n.disabled = active; });
    const lateManual = active && (site?.lateJoinModes || []).includes(mode);
    $('addForm').querySelectorAll('input,button').forEach((n) => { n.disabled = active && !lateManual; });
    paintTools(s, view);
  }
  /* ---------- the host's preview is muted (OBS carries the sound to the stream); «صوت المعاينة» turns it on here ---------- */
  const previewSound = () => { try { return localStorage.getItem('sl_preview_sound') === '1'; } catch { return false; } };
  function paintPreviewSound() {
    const on = previewSound(), b = $('rrSound');
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('use').setAttribute('href', '/icons.svg#' + (on ? 'i-volume' : 'i-volume-off'));
    b.querySelector('span').textContent = on ? 'صوت المعاينة: يعمل' : 'صوت المعاينة: مكتوم';
  }
  $('rrSound').addEventListener('click', () => {
    try { localStorage.setItem('sl_preview_sound', previewSound() ? '0' : '1'); } catch { /* private mode: stays muted */ }
    paintPreviewSound();
    // reload the preview with (or without) its sound; this click lets the browser play it
    const f = $('liveFrame'); if (!f.dataset.src) return;
    const src = f.dataset.src.replace(/&mute=1/, '') + (previewSound() ? '' : '&mute=1');
    f.dataset.src = src; f.src = src;
  });
  paintPreviewSound();
  /* ---------- «الروليت»: one turn at a time, the host's buttons follow the server's scene ---------- */
  const RR_STATE = { ready: 'الجولة جاهزة', drawing: 'السحب جارٍ…', picked: 'تم اختيار صاحب الدور', choose: 'صاحب الدور يختار من الشات', aim: 'الخزنة تدور…', reveal: 'النتيجة', finished: 'انتهت المباراة' };
  let rrPending = false;
  function paintRoulette(s, view, active) {
    const p = s.party && s.status?.mode === 'roulette' ? s.party : null, on = mode === 'roulette' && view === 'live' && active && !!p;
    $('rrControls').hidden = !on; document.body.dataset.rr = on ? '1' : '';
    if (!on) return;
    const ph = p.phase, roster = new Map((s.roster || []).map((x) => [x.number, x]));
    const who = (n) => (n == null ? '' : (roster.get(n)?.name || 'لاعب') + ' (#' + n + ')');
    const hostSeat = (s.roster || []).find((x) => x.host);
    const hostHolds = ph === 'choose' && hostSeat && p.holder?.number === hostSeat.number;
    $('rrDraw').disabled = rrPending || ph !== 'ready';
    $('rrSkip').disabled = !['drawing', 'picked', 'aim', 'reveal'].includes(ph);
    $('rrRandom').hidden = ph !== 'choose';
    $('rrPick').hidden = !hostHolds;
    $('rrCancel').hidden = $('rrOut').hidden = !['picked', 'choose'].includes(ph);
    let line = 'الدور ' + num(ph === 'ready' ? p.turn + 1 : p.turn) + ' — ' + (RR_STATE[ph] || '');
    if (ph === 'ready' && p.waitingHost) line = 'الأدوار التلقائية متوقفة حتى تعود هذه النافذة';
    else if (ph === 'ready' && p.rules?.autoRun === 'auto') line += ' — السحب التالي تلقائيًا';
    else if (['picked', 'choose'].includes(ph)) {
      line += ' — ' + who(p.holder?.number);
      if (p.chatDown) line += ' — الشات منقطع: المهلة متوقفة';
      else if (p.feedback) line += ' — كتب ' + (p.feedback.kind === 'ambiguous' ? 'أكثر من رقم' : 'رقمًا غير صالح (' + p.feedback.number + ')');
    }
    else if (ph === 'aim') line += ' — الهدف ' + who(p.target?.number);
    else if (ph === 'reveal') line = p.result?.outcome === 'out' ? 'خرج ' + who(p.target?.number) : p.result?.outcome === 'empty' ? 'نجا ' + who(p.target?.number) + ' — حجرة فارغة' : 'أُلغي الدور';
    line += ' • داخل اللعبة ' + num(p.alive) + ' من ' + num(p.total);
    $('rrState').textContent = line;
  }
  const rrCmd = (cmd, extra = {}) => admin('roulette', { cmd, ...extra });
  // «ابدأ السحب»: disabled at once; one request id per click, so a double click or a retried request draws once
  function rrDraw() {
    if (rrPending || $('rrDraw').disabled) return;
    rrPending = true; $('rrDraw').disabled = true;
    const requestId = 'rr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    run(null, () => rrCmd('draw', { requestId })).finally(() => { rrPending = false; if (state) render(state); });
  }
  $('rrDraw').addEventListener('click', rrDraw);
  $('rrSkip').addEventListener('click', (e) => run(e.currentTarget, () => rrCmd('skip')));
  $('rrRandom').addEventListener('click', (e) => run(e.currentTarget, () => rrCmd('random')));
  $('rrCancel').addEventListener('click', (e) => run(e.currentTarget, () => rrCmd('cancel')));
  $('rrOut').addEventListener('click', (e) => { const b = e.currentTarget; (async () => {
    const n = state?.party?.holder?.number;
    if (!(await confirmBox('إقصاء صاحب الدور؟', 'يخرج اللاعب #' + n + ' من المباراة بقرار منك، بلا سحبة — استخدمه إذا غادر البث مثلًا.', 'إقصاء'))) return;
    run(b, () => rrCmd('out-holder'));
  })(); });
  $('rrPick').addEventListener('submit', (e) => { e.preventDefault(); run(null, async () => {
    const n = Number(String($('rrPickNum').value).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    if (!n) { $('rrPickNum').focus(); throw new Error('اكتب رقم اللاعب'); }
    await rrCmd('pick', { number: n }); $('rrPickNum').value = '';
  }); });
  // keyboard: Space = «ابدأ السحب», S = «تخطي المشهد» (never while typing)
  addEventListener('keydown', (e) => {
    if ($('rrControls').hidden || e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.('input,textarea,select,[contenteditable],dialog')) return;
    if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); rrDraw(); }
    else if (e.code === 'KeyS' && !$('rrSkip').disabled) { e.preventDefault(); $('rrSkip').click(); }
  });
  /** «تجهيز المتسابقين» after the registration opened: state, stream, count, tools. */
  function paintLobby(s, count) {
    const reg = s.registration || {}, c = s.connection || {}, open = reg.phase === 'open', active = !!s.status.active;
    const live = c.state === 'connected' && (c.liveConfirmed || me.owner || ownerToken());
    $('stageTag').textContent = s.flow?.trial ? 'تجربة — لاعبون تجريبيون' : open ? 'التسجيل مفتوح' : 'التسجيل مغلق';
    $('stageTag').dataset.on = String(open);
    $('regState').textContent = open ? 'التسجيل مفتوح' : 'التسجيل مغلق';
    $('regToggle').textContent = open ? 'إغلاق التسجيل' : 'فتح التسجيل';
    $('regToggle').disabled = active || busy;
    fact('factReg', open, open ? 'مفتوح' : 'مغلق');
    fact('factConn', !!live, c.state === 'connected' ? (live ? 'متصل · ' + (c.platform === 'kick' ? 'Kick' : 'TikTok') : 'تعذر التحقق من البث') : c.state === 'connecting' ? 'جارٍ الاتصال' : 'غير متصل');
    fact('factCount', count > 0, num(count));
    $('noConn').hidden = !!live || active;
    $('lobbyAdd').hidden = active && !(site?.lateJoinModes || []).includes(mode);
    $('lobbyWord').hidden = active;
    if (document.activeElement !== $('lobbyWordInput')) $('lobbyWordInput').placeholder = 'الكلمة الآن: ' + (reg.keyword || 'انضم');
  }
  function fact(id, on, text) { $(id).dataset.on = String(on); $(id).querySelector('b').textContent = text; }

  /* ---------- stage 2: «إعداد اللعبة» ---------- */
  function paintSetup(s) {
    const f = s.flow || {};
    if (document.body.dataset.screen !== 'setup') return;
    $('setupWord').textContent = f.join?.keyword || 'انضم';
    if (!wordTouched && document.activeElement !== $('wordInput')) $('wordInput').value = f.join?.keyword || 'انضم';
    for (const b of $('wordChips').children) b.setAttribute('aria-pressed', String(b.dataset.word === $('wordInput').value.trim()));
    $('autoOpenToggle').setAttribute('aria-checked', String(f.join?.autoOpen !== false));
    // joining after the start: what this game's rules allow
    const supported = !!f.join?.lateJoinSupported, late = f.join?.lateJoin === 'open' && supported ? 'open' : 'click';
    for (const b of document.querySelectorAll('[data-late]')) {
      b.setAttribute('aria-checked', String(b.dataset.late === late));
      if (b.dataset.late === 'open') { b.disabled = !supported; b.setAttribute('aria-disabled', String(!supported)); }
    }
    $('lateWarn').hidden = supported;
    $('lateHelp').textContent = supported ? 'يمكن للاعب جديد دخول هذه اللعبة أثناء الجولة.'
      : 'قواعد «' + (game.title || '') + '» تثبّت قائمة اللاعبين عند البدء: من يكتب الكلمة بعد البدء يدخل الجولة التالية.';
    paintAdvanced(f);
    paintPlatforms();
    paintBadges(s); paintAudience(f);
  }
  /** «2 — المباراة» and «3 — قواعد اللعب»: drawn from the game's settings schema (control = counter / segment /
      toggle / options, group = match / rules). Every value is validated and stored by the server. */
  function control(field) {
    const row = el('div', 'su-row su-field'); row.dataset.key = field.key;
    const text = el('div', 'su-row-text'); text.append(el('b', '', field.label)); if (field.hint) text.append(el('small', '', field.hint));
    let ctl;
    if (field.control === 'counter') {
      ctl = el('div', 'su-counter'); ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', field.label);
      const minus = el('button', 'su-step', '−'), plus = el('button', 'su-step', '+'), val = el('output', 'su-count');
      minus.type = plus.type = 'button'; minus.dataset.step = '-1'; plus.dataset.step = '1'; minus.setAttribute('aria-label', 'إنقاص'); plus.setAttribute('aria-label', 'زيادة');
      ctl.append(plus, val, minus);
    } else if (field.control === 'toggle') {
      ctl = el('button', 'su-switch su-toggle'); ctl.type = 'button'; ctl.setAttribute('role', 'switch'); ctl.setAttribute('aria-label', field.label); ctl.append(el('i'));
    } else {
      ctl = el('div', field.control === 'segment' ? 'su-seg' : 'su-choices'); ctl.setAttribute('role', 'radiogroup'); ctl.setAttribute('aria-label', field.label);
      ctl.classList.toggle('is-many', field.options.length > 4);
      for (const o of field.options) { const b = el('button', 'su-choice', o.label); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.key = field.key; b.dataset.value = String(o.value); ctl.append(b); }
    }
    ctl.dataset.key = field.key; row.append(text, ctl);
    return row;
  }
  function paintAdvanced(f) {
    const fields = site?.gameSettings?.[mode] || [];
    const match = fields.filter((x) => x.group !== 'rules'), rules = fields.filter((x) => x.group === 'rules');
    $('advNone').hidden = match.length > 0 || mode === 'guess';
    $('resetSettings').hidden = !fields.length;
    if (advFor !== mode) {
      advFor = mode;
      $('advFields').replaceChildren(...match.map(control));
      $('rulesFields').replaceChildren(...rules.map(control));
      $('rulesList').replaceChildren(...(game.rules || []).map((r) => el('li', '', r)));
    }
    const values = f.settings || {};
    for (const field of fields) {
      const box = document.querySelector('.su-field[data-key="' + field.key + '"]'); if (!box) continue;
      const v = values[field.key] ?? field.default;
      if (field.control === 'counter') {
        const i = field.options.findIndex((o) => String(o.value) === String(v));
        box.querySelector('.su-count').textContent = String(v);
        box.querySelector('[data-step="-1"]').disabled = i <= 0; box.querySelector('[data-step="1"]').disabled = i >= field.options.length - 1;
      } else if (field.control === 'toggle') box.querySelector('.su-toggle').setAttribute('aria-checked', String(v === true));
      else for (const b of box.querySelectorAll('.su-choice')) b.setAttribute('aria-checked', String(String(v) === b.dataset.value));
    }
  }
  function saveSetting(key, value) { return run(null, async () => { await step('flow-settings', { settings: { [key]: value } }); }); }
  function settingClick(e) {
    const field = (site?.gameSettings?.[mode] || []).find((x) => x.key === e.target.closest('[data-key]')?.dataset.key); if (!field) return;
    const values = state?.flow?.settings || {}, cur = values[field.key] ?? field.default;
    const stepBtn = e.target.closest('[data-step]');
    if (stepBtn) {
      const i = field.options.findIndex((o) => String(o.value) === String(cur)), next = field.options[i + Number(stepBtn.dataset.step)];
      if (!next) return;
      e.target.closest('.su-field').querySelector('.su-count').textContent = String(next.value); // shown at once; the server confirms
      return saveSetting(field.key, next.value);
    }
    if (e.target.closest('.su-toggle')) { const t = e.target.closest('.su-toggle'); const on = t.getAttribute('aria-checked') !== 'true'; t.setAttribute('aria-checked', String(on)); return saveSetting(field.key, on); }
    const b = e.target.closest('.su-choice'); if (!b || b.getAttribute('aria-checked') === 'true') return;
    for (const x of b.parentElement.children) x.setAttribute('aria-checked', String(x === b));
    const o = field.options.find((x) => String(x.value) === b.dataset.value); if (o) saveSetting(field.key, o.value);
  }
  /** Top badges: the real stream connection and «فتح التسجيل تلقائيًا». */
  function paintBadges(s) {
    const c = s.connection || {}, on = c.state === 'connected';
    const badge = $('streamBadge'); badge.dataset.on = String(on);
    badge.querySelector('b').textContent = on ? 'متصل بالبث — ' + (c.platform === 'kick' ? 'Kick' : 'TikTok') + (c.username ? ' @' + c.username : '') : c.state === 'connecting' ? 'جارٍ الاتصال بالبث…' : 'غير متصل بالبث';
    $('autoBadge').hidden = s.flow?.join?.autoOpen === false;
  }
  /** «المسموح لهم»: followers-only is offered when a TikTok account is linked (TikTok reports follow status). */
  function paintAudience(f) {
    const tiktok = !!(links.linked?.tiktok && !links.linked.tiktok.needsReauth), aud = f.join?.audience === 'followers' ? 'followers' : 'all';
    for (const b of $('audienceSeg').children) {
      b.setAttribute('aria-checked', String(b.dataset.aud === aud));
      if (b.dataset.aud === 'followers') { b.disabled = !tiktok && aud !== 'followers'; b.setAttribute('aria-disabled', String(b.disabled)); }
    }
    $('audienceHint').textContent = tiktok ? (aud === 'followers' ? 'يُقبل فقط من يؤكد TikTok أنه يتابعك. مع Kick أو وضع التجربة يُقبل الجميع.' : '«المتابعون فقط» يتحقق منه TikTok فعليًا — Kick لا يرسل حالة المتابعة.')
      : '«المتابعون فقط» يحتاج حساب TikTok مربوطًا — Kick لا يرسل حالة المتابعة.';
  }
  /** «منصات البث»: only accounts linked by signing in with TikTok / Kick; nothing can be typed here. */
  function preferredPlatform() { try { return localStorage.getItem('sponge_platform') || ''; } catch { return ''; } }
  function linkedList() { return ['tiktok', 'kick'].map((p) => [p, links.linked?.[p]]).filter(([, l]) => l && !l.needsReauth); }
  function accountButton(p, l, label) {
    const c = state?.connection || {}, on = c.state === 'connected' && c.platform === p;
    const b = el('button', 'su-acct' + (on ? ' is-on' : '')); b.type = 'button'; b.dataset.platform = p;
    const ava = el('span', 'su-acct-ava', (l.handle[0] || '?').toUpperCase());
    if (l.avatar && /^https:\/\//.test(l.avatar)) { const img = el('img'); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.addEventListener('error', () => img.remove(), { once: true }); img.src = l.avatar; ava.append(img); }
    const txt = el('span', 'su-acct-txt'); txt.append(el('bdi', '', '@' + l.handle), el('small', '', PNAME[p] + (on ? ' · متصل الآن' : c.state === 'connecting' && c.platform === p ? ' · جارٍ الاتصال' : '')));
    b.append(ava, txt, el('span', 'su-acct-go', on ? '✓' : label));
    return b;
  }
  function paintPlatforms() {
    if (me.owner || ownerToken()) {
      $('platState').textContent = 'غرفة المالك — اتصال تجريبي من شريط الأعلى';
      $('platAccounts').replaceChildren(); $('otherToggle').disabled = true; $('otherHint').textContent = 'غير متاح لغرفة المالك.'; return;
    }
    const list = linkedList();
    if (!list.length) {
      $('platState').textContent = 'لم يتم ربط منصة بعد';
      const a = el('a', 'su-link', 'اربط TikTok أو Kick من الإعدادات'); a.href = '/account#settings';
      $('platAccounts').replaceChildren(a);
      $('otherToggle').disabled = true; $('otherAccounts').hidden = true;
      $('otherHint').textContent = 'اربط حساب بث أولًا عبر تسجيل الدخول الرسمي.';
      return;
    }
    const c = state?.connection || {};
    const pref = (c.state === 'connected' && list.find(([p]) => p === c.platform)?.[0]) || list.find(([p]) => p === preferredPlatform())?.[0] || list[0][0];
    const main = list.find(([p]) => p === pref), others = list.filter(([p]) => p !== pref);
    $('platState').textContent = c.state === 'connected' ? 'متصل ببثك' : 'الحساب المرتبط';
    $('platAccounts').replaceChildren(accountButton(main[0], main[1], 'اتصال'));
    $('otherToggle').disabled = !others.length;
    if (!others.length) { $('otherAccounts').hidden = true; $('otherToggle').setAttribute('aria-checked', 'false'); }
    $('otherHint').textContent = others.length ? 'استخدم حساب بث آخر موثّقًا ومربوطًا بحسابك لهذه المرة.' : 'لديك حساب بث واحد مربوط — اربط حسابًا آخر من الإعدادات لتستخدمه هنا.';
    $('otherAccounts').replaceChildren(...others.map(([p, l]) => accountButton(p, l, 'استخدمه')));
  }
  async function connectPlatform(p) {
    try { localStorage.setItem('sponge_platform', p); } catch {}
    $('planNotice').hidden = true;
    try { await admin('connect', { platform: p }); feedback('متصل ببثك على ' + PNAME[p] + ' ✓'); }
    catch (err) { if (err.code === 409 && /الإعدادات/.test(err.message)) loadLinks(); throw err; }
  }

  /* ---------- «جاري تجهيز اللوبي»: the server's real steps, as they happen ---------- */
  let prepWatch = 0;
  function paintPrepare(s) {
    const f = s.flow || {}, l = f.lobby;
    clearTimeout(prepWatch);
    if (!l || document.body.dataset.screen !== 'prepare') return;
    const st = Date.now() < readyFlash ? 'READY' : l.state, err = l.state === 'LOBBY_ERROR' ? l.error : null;
    $('prepCard').dataset.state = st;
    const steps = l.steps || [], done = steps.filter((x) => x.status === 'done' || x.status === 'skipped').length;
    const now = steps.find((x) => x.status === 'running') || steps.find((x) => x.status === 'failed');
    $('prepEyebrow').textContent = l.demo ? 'غرفة الانتظار • وضع التجربة' : 'غرفة الانتظار';
    $('prepTitle').textContent = st === 'READY' ? 'اللوبي جاهز!' : err ? err.title : l.state === 'RECOVERING' ? 'جاري استعادة الجلسة' : 'جاري تجهيز اللوبي';
    $('prepNow').textContent = st === 'READY' ? 'جاري فتح غرفة الانتظار' : err ? (err.step ? 'توقف عند: ' + (steps.find((x) => x.key === err.step)?.label || '') : '') : now ? 'جاري ' + now.label.replace(/^ال/, 'ال') : steps.length ? 'جاري إنهاء التجهيز' : 'جاري بدء التجهيز';
    // a measured bar: one share per real step (no fake percentages)
    const total = steps.length || 1, ratio = st === 'READY' ? 1 : done / total;
    $('prepFill').style.setProperty('--p', Math.round(ratio * 100) + '%');
    $('prepBar').setAttribute('aria-valuenow', ratio.toFixed(2));
    $('prepCount').textContent = steps.length ? num(done) + ' من ' + num(steps.length) + ' خطوات' : '';
    $('prepSteps').replaceChildren(...steps.map((x) => { const li = el('li'); li.dataset.status = x.status; li.append(el('span', '', x.label)); if (x.detail) li.append(el('small', '', x.detail)); return li; }));
    $('prepError').hidden = !err;
    if (err) $('prepErrText').textContent = err.message || '';
    const link = err && err.href, act = err && !err.href;
    $('prepLink').hidden = !link; $('prepAction').hidden = !act;
    if (link) { $('prepLink').href = err.href; $('prepLink').textContent = err.label; }
    if (act) { $('prepAction').textContent = err.label; $('prepAction').dataset.action = err.action; }
    $('prepBack').textContent = err ? 'العودة للإعدادات' : 'إلغاء';
    $('prepDemo').hidden = !err || l.demo || !['not_linked', 'not_live', 'chat_failed', 'reauth', 'not_connected', 'unavailable'].includes(err.code);
    // no WebSocket (or a slow one): keep reading the state while the server works
    if (!err && st !== 'READY' && (!ws || ws.readyState !== 1)) prepWatch = setTimeout(() => refresh().catch(() => {}), 1200);
  }
  $('prepBack').addEventListener('click', (e) => run(e.currentTarget, async () => { await step('flow-cancel'); }));
  $('prepAction').addEventListener('click', (e) => {
    const a = e.currentTarget.dataset.action;
    if (a === 'setup') return run(e.currentTarget, () => step('flow-cancel'));
    if (a === 'demo') return run(e.currentTarget, () => step('flow-trial'));
    run(e.currentTarget, () => step('flow-begin', { platform: preferredPlatform() })); // «إعادة المحاولة» / «التحقق مجددًا» / «إعادة الاتصال»
  });
  $('prepDemo').addEventListener('click', (e) => run(e.currentTarget, () => step('flow-trial')));

  /* ---------- «غرفة الانتظار» ---------- */
  let lbSeen = new Set(), lbFirst = true, lbWordShown = '';
  const PICON = { tiktok: 'TikTok', kick: 'Kick' };
  function lbFeedback(msg, error = false) { $('lbFeedback').textContent = msg || ''; $('lbFeedback').classList.toggle('is-error', !!error); feedback(msg, error); }
  function lbAvatar(p) {
    const box = el('span', 'lb-av'); box.append(el('span', '', initial(p.name)));
    if (p.avatar && /^https:\/\//.test(p.avatar)) {
      const img = el('img'); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.decoding = 'async'; img.src = p.avatar;
      img.addEventListener('error', () => img.remove(), { once: true }); box.append(img);
    }
    return box;
  }
  function paintLobbyView(s) {
    if (document.body.dataset.screen !== 'lobby') return;
    const f = s.flow || {}, l = f.lobby || {}, reg = s.registration || {}, c = s.connection || {};
    const demo = !!l.demo, open = reg.phase === 'open', count = Number(s.playerCount || 0);
    const live = c.state === 'connected' && (c.liveConfirmed || c.verified || me.owner || ownerToken());
    // toolbar: four separate facts — never «connected» for a simulated stream
    const tone = demo ? 'demo' : live ? 'ok' : c.state === 'connecting' ? 'wait' : 'bad';
    $('lbStatus').dataset.tone = tone;
    $('lbStatusText').textContent = demo ? 'وضع التجربة — لاعبون تجريبيون، بلا بث'
      : live ? 'البث متصل · ' + (PICON[c.platform] || '') + (open ? ' — الانضمام مباشر' : ' — التسجيل مغلق')
      : c.state === 'connecting' ? 'جارٍ الاتصال بالبث…' + (s.connRetry?.attempts ? ' (المحاولة ' + num(s.connRetry.attempts) + ')' : '')
      : 'البث غير متصل — لن تصل تعليقات';
    $('lbObs').href = roomPath('/overlay');
    $('lbDemo').hidden = !demo;
    // the join word
    const word = reg.keyword || f.join?.keyword || 'انضم';
    if (lbWordShown && lbWordShown !== word) { $('lbWord').classList.remove('is-changed'); void $('lbWord').offsetWidth; $('lbWord').classList.add('is-changed'); }
    lbWordShown = word; $('lbWord').textContent = word;
    $('lbEmptyText').textContent = open ? 'أول من يكتب «' + word + '» في التعليقات يظهر هنا.' : 'التسجيل مغلق — افتحه ليبدأ المشاهدون بالانضمام، أو أضف لاعبًا بنفسك.';
    const roundOn = ['ROUND_STARTING', 'ROUND_RUNNING'].includes(f.state);
    $('lbWordEdit').disabled = roundOn;
    // count
    if ($('lbCount').textContent !== num(count)) { $('lbCount').textContent = num(count); $('lbCount').classList.remove('bump'); void $('lbCount').offsetWidth; $('lbCount').classList.add('bump'); }
    $('lbCountLabel').textContent = count === 1 ? 'لاعب انضم' : count === 2 ? 'لاعبان انضما' : count >= 3 && count <= 10 ? 'لاعبين انضموا' : count > 10 ? 'لاعبًا انضموا' : 'لاعبين بعد';
    $('lbPlayersN').textContent = num(count) + ' من ' + num(reg.maxPlayers || 1500);
    // notes: the real reason no comments arrive, a restored session
    const note = l.note ? l.note : (!demo && !live) ? (c.detail && c.state === 'error' ? 'تعذر استقبال التعليقات: ' + c.detail : 'البث غير متصل — لن تصل تعليقات حقيقية. يمكنك إضافة لاعبين بنفسك.') : '';
    $('lbNote').hidden = !note; $('lbNoteText').textContent = note; $('lbNote').dataset.tone = l.note && live ? 'info' : 'warn';
    $('lbConnect').hidden = demo || !!live;
    // players
    const frames = s.frames || {}, list = Array.isArray(s.roster) ? s.roster : [];
    let joined = 0;
    const nodes = [...list].reverse().map((p) => {
      const key = p.number + '\u0000' + p.name, isNew = !lbSeen.has(key) && !lbFirst;
      lbSeen.add(key); if (isNew) joined++;
      const fr = !p.bot && !p.manual || p.host ? frames['n:' + p.number] : null; // frames only for verified linked accounts
      // a slim nameplate: the avatar (in its frame) overlapping the plate's edge, the name, where the player comes from,
      // the player's number; the remove button sits outside the plate
      const li = el('li', 'lb-player' + (isNew ? ' is-new' : '') + (p.host ? ' is-host' : '') + (p.bot ? ' is-bot' : '') + (fr ? ' has-frame' : ''));
      const plate = el('span', 'lb-plate');
      const who = el('span', 'lb-who');
      who.append(window.SpongeFrames ? SpongeFrames.plate(p.name, fr) : el('bdi', '', p.name));
      const src = p.host ? ['is-host', 'المضيف'] : p.bot ? ['is-bot', 'تجريبي'] : p.manual ? ['is-manual', 'يدوي'] : c.platform && PICON[c.platform] ? ['', PICON[c.platform]] : null;
      if (src || fr) {
        const tags = el('span', 'lb-tags');
        if (src) tags.append(el('span', 'lb-tag ' + src[0], src[1]));
        if (fr) tags.append(el('span', 'lb-tag is-frame', fr.name));
        who.append(tags);
      }
      const av = window.SpongeFrames ? SpongeFrames.avatar(lbAvatar(p), fr) : lbAvatar(p);
      const n = el('span', 'lb-num', num(p.number)); n.setAttribute('aria-label', 'رقم ' + num(p.number));
      plate.append(av, who, n);
      li.append(plate);
      if (!roundOn) {
        const x = el('button', 'lb-rm'); x.type = 'button'; x.dataset.number = p.number; x.dataset.name = p.name; x.setAttribute('aria-label', 'إزالة ' + p.name);
        x.innerHTML = ''; const ic = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); ic.setAttribute('class', 'i'); ic.setAttribute('aria-hidden', 'true');
        const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '/icons.svg#i-trash'); ic.append(u); x.append(ic);
        li.append(x);
      }
      return li;
    });
    $('lbList').replaceChildren(...nodes);
    $('lbEmpty').hidden = list.length > 0;
    if (joined) { fx()?.play('join'); }
    lbFirst = false;
    // registration + actions
    $('lbReg').dataset.open = String(open);
    $('lbRegText').textContent = open ? 'التسجيل مفتوح' : f.state === 'LOBBY_READY' ? 'اللوبي جاهز — التسجيل لم يُفتح' : 'التسجيل مغلق';
    $('lbRegSub').textContent = open ? 'يُقبل كل من يكتب «' + word + '»' : 'لا يُقبل لاعبون جدد من التعليقات';
    $('lbRegToggleText').textContent = open ? 'إغلاق التسجيل' : 'فتح التسجيل';
    $('lbRegToggle').dataset.open = String(open);
    $('lbRegToggle').disabled = busy || roundOn;
    const seated = !!reg.hostSeated;
    $('lbSeat').setAttribute('aria-pressed', String(seated)); $('lbSeatLabel').textContent = seated ? 'إلغاء مشاركتي' : 'دخّلني كلاعب';
    $('lbFx').setAttribute('aria-pressed', String(!(window.SpongeFrames?.lite())));
    const need = Math.max(0, (reg.minPlayers || game.minPlayers || 1) - count);
    $('lbStart').disabled = busy || need > 0 || roundOn || startPending;
    $('lbStartLabel').textContent = roundOn ? 'الجولة تبدأ…' : need > 0 ? 'بدء الجولة الآن (ينقص ' + num(need) + ')' : 'بدء الجولة الآن';
    $('lbReset').disabled = busy || roundOn; $('lbEnd').disabled = busy || roundOn;
  }
  // one listener for every remove button, however often the list is redrawn
  $('lbList').addEventListener('click', (e) => {
    const x = e.target.closest('.lb-rm'); if (!x) return;
    run(x, async () => { await admin('remove-player', { number: Number(x.dataset.number) }); lbFeedback('أُزيل ' + x.dataset.name); });
  });
  const confirmBox = (title, text, ok) => new Promise((resolve) => {
    const d = $('confirmDialog'); $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('confirmOk').textContent = ok;
    d.returnValue = ''; d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    if (typeof d.showModal === 'function') d.showModal(); else resolve(true);
  });
  $('lbRegToggle').addEventListener('click', (e) => run(e.currentTarget, async () => {
    if (state?.registration?.phase === 'open') { await step('flow-close'); lbFeedback('أُغلق التسجيل — اللاعبون الحاليون باقون، ولا يُقبل جدد.'); }
    else { await step('flow-open'); lbFeedback('فُتح التسجيل — يكتب المشاهدون «' + (state?.registration?.keyword || 'انضم') + '» للانضمام.'); }
  }));
  $('lbReset').addEventListener('click', (e) => { const b = e.currentTarget; (async () => {
    const n = Number(state?.playerCount || 0);
    if (n && !(await confirmBox('إعادة تعيين اللاعبين؟', 'سيُحذف ' + num(n) + (n === 1 ? ' لاعب' : ' لاعبين') + ' من هذا اللوبي. النتائج المحفوظة سابقًا لا تتأثر، وتعليقات «' + (state?.registration?.keyword || '') + '» القديمة لن تُحتسب.', 'إعادة تعيين'))) return;
    run(b, async () => { await step('flow-registration-reset', { confirm: true }); lbFeedback('بدأ تسجيل جديد — القائمة فارغة.'); });
  })(); });
  $('lbEnd').addEventListener('click', (e) => { const b = e.currentTarget; (async () => {
    const n = Number(state?.playerCount || 0);
    if (n && !(await confirmBox('إنهاء الجلسة؟', 'يُغلق اللوبي ويتوقف قبول اللاعبين، وتعود إلى مكتبة الألعاب.', 'إنهاء الجلسة'))) return;
    run(b, async () => { await step('flow-end'); toList(); });
  })(); });
  // «بدء الجولة الآن»: disabled at once; the same request id makes a double click start one round only
  let startPending = false;
  $('lbStart').addEventListener('click', (e) => {
    const b = e.currentTarget; if (startPending) return;
    startPending = true; b.disabled = true; b.classList.add('is-busy');
    const requestId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    run(null, async () => {
      try { await step('flow-start', { requestId }); if (mode === 'wheel') feedback('دخل كل المشاركين السحب — اضغط «اسحب الفائز».'); }
      catch (err) { lbFeedback(err.message, true); throw err; }
    }).finally(() => { startPending = false; b.classList.remove('is-busy'); if (state) render(state); });
  });
  $('lbSettings').addEventListener('click', (e) => run(e.currentTarget, async () => { browsing = false; await step('flow-setup', { mode }); }));
  $('lbSeat').addEventListener('click', (e) => run(e.currentTarget, async () => {
    if (state?.registration?.hostSeated) { await admin('host-unseat'); lbFeedback('ألغيت مشاركتك — ما زلت تدير اللعبة.'); }
    else { await admin('host-seat'); lbFeedback('أنت الآن ضمن اللاعبين، وتطبق عليك قواعد اللعبة نفسها.'); }
  }));
  $('lbFx').addEventListener('click', () => { const lite = !window.SpongeFrames?.lite(); window.SpongeFrames?.setLite(lite); $('lbFx').setAttribute('aria-pressed', String(!lite)); });
  $('lbConnect').addEventListener('click', (e) => {
    if (me.owner || ownerToken() || !me.account) { document.body.dataset.showtop = '1'; scrollTo({ top: 0 }); $('handleInput')?.focus(); return; }
    const p = (state?.connection?.platform && links.linked?.[state.connection.platform] ? state.connection.platform : null) || linkedList()[0]?.[0];
    if (!p) { location.href = '/account#settings'; return; }
    run(e.currentTarget, () => connectPlatform(p));
  });
  // the join word, edited in place (the server keeps one word for every screen; an older edit is refused)
  const wordEdit = (on) => { $('lbWordForm').hidden = !on; $('lbWordEdit').hidden = on; $('lbWord').hidden = on; if (on) { $('lbWordInput').value = state?.registration?.keyword || 'انضم'; $('lbWordInput').focus(); $('lbWordInput').select(); } };
  $('lbWordEdit').addEventListener('click', () => wordEdit(true));
  $('lbWordCancel').addEventListener('click', () => wordEdit(false));
  $('lbWordForm').addEventListener('submit', (e) => { e.preventDefault(); run(null, async () => {
    const keyword = $('lbWordInput').value.trim(); if (!keyword) { $('lbWordInput').focus(); throw new Error('اكتب كلمة الانضمام'); }
    try { await step('flow-keyword', { keyword, version: state?.flow?.version }); }
    catch (err) { if (/نافذة أخرى/.test(err.message)) await refresh().catch(() => {}); throw err; }
    wordEdit(false); lbFeedback('الكلمة الآن «' + keyword + '» — تغيّرت على شاشة البث أيضًا.');
  }); });
  // «إضافة لاعب»: a name typed by the host, shown as «يدوي»
  $('lbAdd').addEventListener('click', () => { $('addDialogErr').textContent = ''; $('addDialogName').value = ''; $('addDialog').showModal?.(); });
  $('addDialogClose').addEventListener('click', () => $('addDialog').close());
  $('addDialogForm').addEventListener('submit', (e) => { e.preventDefault(); const name = $('addDialogName').value.trim();
    if (!name) { $('addDialogErr').textContent = 'اكتب اسم اللاعب'; return; }
    admin('add-player', { name }).then(() => { $('addDialog').close(); lbFeedback('أُضيف ' + name); }).catch((err) => { $('addDialogErr').textContent = err.message; });
  });

  /* ---------- host tools for the running game ---------- */
  let secretRound = -1, rolesAt = 0;
  async function paintTools(s, view) {
    const party = s.party, live = view === 'live';
    const draw = live && mode === 'drawguess' && party, judge = live && ((mode === 'categories' && party?.judging) || (mode === 'chain' && party?.pending)), roles = live && (mode === 'roles' || mode === 'outsider');
    $('hostTools').hidden = !(draw || judge || roles);
    $('sketchTool').hidden = !draw; $('judgeTool').hidden = !judge; $('rolesTool').hidden = !roles;
    if (draw && party.round !== secretRound) {
      secretRound = party.round; clearSketch(true);
      try { const r = await admin('secret'); $('secretWord').textContent = r.secret?.word || '—'; } catch { $('secretWord').textContent = '—'; }
    }
    if (judge) $('judgeAnswer').textContent = mode === 'chain' ? '«' + party.pending.word + '» — ' + party.pending.player.name + ' (حرف «' + party.letter + '» — ' + party.category + ')' : '«' + (party.answer || '') + '»';
    if (roles) {
      $('roleLink').textContent = location.origin + '/role' + (session()?.room() && session().room() !== 'main' ? '?room=' + session().room() : '');
      if (Date.now() - rolesAt > 2500) { rolesAt = Date.now(); admin('roles-admin').then(paintRoles).catch(() => {}); }
    }
  }
  function paintRoles(r) {
    const list = $('rolesList');
    if (r.hidden) { list.replaceChildren(el('li', 'pl-hint', 'أنت تلعب في هذه الجولة، لذلك أدوار اللاعبين مخفية عنك أيضًا.')); return; }
    if (r.word) { // «برا السالفة»: the host sees the word and who is out of it
      const a = el('li', 'is-citizen'); a.append(el('b', '', r.category), el('span', '', 'الكلمة: ' + r.word));
      const b = el('li', 'is-impostor'); b.append(el('b', 'num', '#' + r.outsider.number), el('span', '', r.outsider.name), el('small', '', 'برا السالفة'));
      list.replaceChildren(a, b); return;
    }
    list.replaceChildren(...(r.roles || []).map((p) => { const li = el('li', 'is-' + p.role + (p.alive ? '' : ' is-out')); li.append(el('b', 'num', '#' + p.number), el('span', '', p.name), el('small', '', p.roleLabel)); return li; }));
  }

  // Drawing board for «خمن الرسمة»: the canvas is pushed to every screen as a PNG.
  const canvas = $('sketchCanvas'), g = canvas.getContext('2d');
  const INK = ['#0A1A3D', '#1E5BFF', '#38D4FF', '#2FD9A0', '#FFC21A', '#FF6A8A', '#7B5CFF', '#8A5A2B', '#ffffff'];
  let strokes = [], current = null, ink = INK[0], sendTimer = 0, lastSent = 0;
  $('sketchPalette').append(...INK.map((c, i) => { const b = el('button', 'pl-swatch'); b.type = 'button'; b.style.setProperty('--sw', c); b.setAttribute('aria-label', 'لون ' + (i + 1)); b.setAttribute('aria-pressed', String(i === 0));
    b.addEventListener('click', () => { ink = c; for (const x of $('sketchPalette').children) x.setAttribute('aria-pressed', String(x === b)); }); return b; }));
  function redraw() {
    g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height); g.lineCap = 'round'; g.lineJoin = 'round';
    for (const s of strokes) { g.strokeStyle = s.c; g.lineWidth = s.c === '#ffffff' ? 26 : 8; g.beginPath(); s.p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (s.p.length === 1) g.lineTo(s.p[0][0] + .1, s.p[0][1]); g.stroke(); }
  }
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * canvas.width / r.width), Math.round((e.clientY - r.top) * canvas.height / r.height)]; };
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); current = { c: ink, p: [pt(e)] }; strokes.push(current); redraw(); });
  canvas.addEventListener('pointermove', (e) => { if (!current) return; current.p.push(pt(e)); redraw(); queueSend(); });
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { if (current) { current = null; queueSend(true); } });
  $('sketchUndo').addEventListener('click', () => { strokes.pop(); redraw(); queueSend(true); });
  $('sketchClear').addEventListener('click', () => clearSketch(false));
  function clearSketch(silent) { strokes = []; redraw(); if (!silent || state?.status?.active) admin('sketch', { data: '' }).catch(() => {}); }
  function queueSend(now) {
    clearTimeout(sendTimer);
    const wait = now ? 0 : Math.max(0, 600 - (Date.now() - lastSent));
    sendTimer = setTimeout(() => { lastSent = Date.now(); admin('sketch', { data: canvas.toDataURL('image/png') }).catch((err) => feedback(err.message, true)); }, wait);
  }
  redraw();
  $('judgeAccept').addEventListener('click', (e) => run(e.currentTarget, () => admin('judge', { accept: true })));
  $('judgeReject').addEventListener('click', (e) => run(e.currentTarget, () => admin('judge', { accept: false })));

  /* ---------- host actions ---------- */
  async function run(button, fn) {
    if (busy) return; busy = true; if (button) button.disabled = true;
    try { await fn(); feedback(''); }
    catch (err) { feedback(err.message, true); fx()?.play('wrong'); }
    finally { busy = false; if (button) button.disabled = false; if (state) render(state); }
  }
  // One button = one job (see the table in src/flow.mjs). The server refuses any step out of order.
  const step = (action, body) => admin(action, body).then((r) => { if (r.flow && state) render({ ...state, flow: r.flow }); return r; });
  $('hostSeatButton').addEventListener('click', (e) => run(e.currentTarget, async () => {
    if (state?.registration?.hostSeated) { await admin('host-unseat'); feedback('ألغيت مشاركتك — ما زلت تدير اللعبة.'); }
    else { await admin('host-seat'); feedback('أنت الآن ضمن المتسابقين، وتطبق عليك قواعد اللعبة نفسها.'); }
  }));
  $('autoHost').addEventListener('change', (e) => run(null, async () => {
    await admin('registration-settings', { hostJoin: e.target.checked ? 'auto' : 'manual' });
    feedback(e.target.checked ? 'ستدخل تلقائيًا كلاعب في كل لعبة تفتحها.' : 'لن تدخل تلقائيًا بعد الآن.');
  }));
  // «فتح التسجيل» / «إغلاق التسجيل»
  $('regToggle').addEventListener('click', (e) => run(e.currentTarget, async () => {
    if (state?.registration?.phase === 'open') { await step('flow-close'); feedback('أُغلق التسجيل — لا يُقبل لاعبون جدد.'); }
    else { await step('flow-open', { keyword: state?.registration?.keyword }); feedback('فُتح التسجيل من جديد.'); }
  }));
  $('lobbyWord').addEventListener('submit', (e) => { e.preventDefault(); run(null, async () => {
    const keyword = $('lobbyWordInput').value.trim(); if (!keyword) { $('lobbyWordInput').focus(); throw new Error('اكتب الكلمة الجديدة'); }
    await step('flow-open', { keyword }); $('lobbyWordInput').value = '';
    feedback('الكلمة الآن «' + keyword + '» — تغيّرت الرسالة على شاشة البث.');
  }); });
  $('keywordForm').addEventListener('submit', (e) => { e.preventDefault(); run(null, async () => {
    const maxPlayers = Number($('maxInput').value);
    await admin('registration-settings', { keyword: state?.registration?.keyword || 'انضم', maxPlayers });
    feedback('الحد الأقصى ' + num(maxPlayers) + ' متسابق.');
  }); });
  const addPlayer = (input) => run(null, async () => {
    const name = input.value.trim(); if (!name) { input.focus(); throw new Error('اكتب اسم اللاعب'); }
    await admin('add-player', { name }); input.value = ''; feedback('أُضيف ' + name);
  });
  $('addForm').addEventListener('submit', (e) => { e.preventDefault(); addPlayer($('addName')); });
  $('lobbyAdd').addEventListener('submit', (e) => { e.preventDefault(); addPlayer($('lobbyAddName')); });
  $('demoButton').addEventListener('click', (e) => run(e.currentTarget, async () => {
    const r = await admin('demo-players', { count: Math.max(4, (state?.registration?.minPlayers || 1)) });
    await admin('simulation', { autoplay: true }).catch(() => {});
    feedback('وضع التجربة: أُضيف ' + num(Array.isArray(r.added) ? r.added.length : r.added) + ' لاعبين تجريبيين يلعبون تلقائيًا (معلَّمون بـ «تجريبي»).');
  }));
  // «بدء الجولة الآن»: the only command that starts the real round
  $('startButton').addEventListener('click', (e) => run(e.currentTarget, async () => {
    await step('flow-start');
    if (mode === 'wheel') feedback('دخل كل المشاركين السحب — اضغط «اسحب الفائز».');
  }));
  $('drawButton').addEventListener('click', (e) => run(e.currentTarget, async () => { const r = await admin('draw'); feedback('🏆 الفائز: ' + r.result.name); }));
  $('advanceButton').addEventListener('click', (e) => run(e.currentTarget, () => admin('advance')));
  const stop = () => admin('stop');
  $('liveStopButton').addEventListener('click', (e) => run(e.currentTarget, stop));
  $('stopButton').addEventListener('click', (e) => run(e.currentTarget, stop));
  // «إنهاء اللعبة»: stops safely and goes back to the library
  const endGame = (e) => run(e.currentTarget, async () => { await step('flow-end'); feedback(''); toList(); });
  $('endButton').addEventListener('click', endGame);
  $('doneEnd').addEventListener('click', endGame);
  // «جولة جديدة»: the lobby again, same players and word
  $('againButton').addEventListener('click', (e) => run(e.currentTarget, () => step('flow-again')));
  // «العودة للإعدادات»: players and the word are kept
  const toSetup = (e) => run(e?.currentTarget, async () => { browsing = false; await step('flow-setup', { mode }); });
  $('toSetup').addEventListener('click', toSetup);
  $('doneSetup').addEventListener('click', toSetup);
  $('drawerToSetup').addEventListener('click', toSetup);
  $('setupBack').addEventListener('click', (e) => run(e.currentTarget, async () => { toListing = true; await step('flow-library'); toList(); }));

  /* setup screen */
  $('advFields').addEventListener('click', settingClick);
  $('rulesFields').addEventListener('click', settingClick);
  $('audienceSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-aud]'); if (!b || b.disabled || b.getAttribute('aria-checked') === 'true') return;
    for (const x of b.parentElement.children) x.setAttribute('aria-checked', String(x === b));
    run(null, () => step('flow-settings', { audience: b.dataset.aud }));
  });
  $('resetSettings').addEventListener('click', (e) => run(e.currentTarget, async () => { await step('flow-reset'); feedback('أُعيدت الإعدادات الافتراضية.'); }));
  document.querySelector('.su-options').addEventListener('click', (e) => {
    const b = e.target.closest('[data-late]'); if (!b || b.disabled) return;
    run(null, () => step('flow-settings', { lateJoin: b.dataset.late }));
  });
  $('otherToggle').addEventListener('click', () => {
    if ($('otherToggle').disabled) return;
    const on = $('otherToggle').getAttribute('aria-checked') !== 'true';
    $('otherToggle').setAttribute('aria-checked', String(on)); $('otherAccounts').hidden = !on;
  });
  for (const id of ['platAccounts', 'otherAccounts']) $(id).addEventListener('click', (e) => {
    const b = e.target.closest('.su-acct'); if (!b || b.classList.contains('is-on')) return;
    run(b, async () => { await connectPlatform(b.dataset.platform); paintPlatforms(); });
  });
  async function saveGuess() {
    if (mode !== 'guess') return;
    const prompt = $('guessPrompt').value.trim(), answer = $('guessAnswer').value.trim();
    if (!prompt || !answer) { $(prompt ? 'guessAnswer' : 'guessPrompt').focus(); throw new Error('اكتب التلميح والإجابة السرية قبل البدء'); }
    await admin('configure', { mode, prompt, answer });
  }
  async function saveWordIfChanged() {
    const w = $('wordInput').value.trim();
    if (wordTouched && w && w !== state?.flow?.join?.keyword) await step('flow-settings', { keyword: w });
    wordTouched = false;
  }
  // «ابدأ اللعبة»: prepares the lobby (real steps on the server) — no round, no timer
  $('beginButton').addEventListener('click', (e) => run(e.currentTarget, async () => { await saveGuess(); await saveWordIfChanged(); lbFirst = true; lbSeen = new Set(); await step('flow-begin', { platform: preferredPlatform() }); }));
  // «تجربة اللعبة»: the same preparation in «وضع التجربة»; still started with «بدء الجولة الآن»
  $('tryButton').addEventListener('click', (e) => run(e.currentTarget, async () => { await saveGuess(); await saveWordIfChanged(); lbFirst = true; lbSeen = new Set(); await step('flow-trial'); }));
  $('autoOpenToggle').addEventListener('click', (e) => run(null, async () => { await step('flow-settings', { autoOpen: e.currentTarget.getAttribute('aria-checked') !== 'true' }); }));

  /* the join word on the setup screen */
  $('wordChips').replaceChildren(...['انضم', 'العب', 'جاهز', 'دخول', 'ابدأ'].map((w) => { const b = el('button', 'rg-chip', w); b.type = 'button'; b.dataset.word = w; return b; }));
  $('wordChips').addEventListener('click', (e) => { const b = e.target.closest('.rg-chip'); if (!b) return; $('wordInput').value = b.dataset.word; wordTouched = true; $('wordForm').requestSubmit(); });
  $('wordInput').addEventListener('input', () => { wordTouched = true; for (const b of $('wordChips').children) b.setAttribute('aria-pressed', String(b.dataset.word === $('wordInput').value.trim())); });
  $('wordForm').addEventListener('submit', (e) => { e.preventDefault(); run($('wordSave'), async () => {
    const keyword = $('wordInput').value.trim(); if (!keyword) { $('wordInput').focus(); throw new Error('اكتب كلمة الانضمام'); }
    await step('flow-settings', { keyword }); wordTouched = false;
    feedback('حُفظت كلمة الانضمام «' + keyword + '».');
  }); });

  /* ---------- presence: the server only lists a stream while its studio window keeps beating ---------- */
  let beatTimer = 0;
  async function beat(takeover = false) {
    clearTimeout(beatTimer);
    try {
      const r = await admin('heartbeat', { tab: TAB, screen: ['game', 'lobby', 'prepare'].includes(document.body.dataset.screen) ? 'game' : 'games', ...(takeover ? { takeover: true } : {}) });
      $('windowBanner').hidden = r.primary;
      paintListed(r);
    } catch { /* offline or plan ended: the server stops listing the stream by itself */ }
    beatTimer = setTimeout(() => beat(), 15_000);
  }
  const REASONS = { 'no-subscription': 'لا يوجد اشتراك فعال', 'not-verified': 'لم تُثبت ملكية حساب البث', 'not-live': 'البث غير مباشر الآن', 'studio-closed': 'الاستوديو مغلق', 'no-game': 'شغّل لعبة ليظهر بثك', hidden: 'أخفيته من الإعدادات (الخصوصية)' };
  function paintListed(r) {
    const t = $('sideListed');
    t.textContent = r.listed ? 'ظاهر الآن في البثوث النشطة ✓' : 'غير ظاهر في البثوث النشطة — ' + (REASONS[(r.reasons || []).find((x) => x !== 'studio-closed' && x !== 'hidden')] || REASONS[(r.reasons || [])[0]] || 'غير متصل');
    t.classList.toggle('is-on', !!r.listed);
  }
  $('takeOver').addEventListener('click', () => beat(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) beat(); });

  /* ---------- data ---------- */
  let leaving = false;
  addEventListener('pagehide', () => {
    leaving = true; try { ws?.close(); } catch {}
    // tell the server this window closed, so the stream leaves the active list at once
    try { navigator.sendBeacon('/api/admin/heartbeat', new Blob([JSON.stringify({ tab: TAB, closing: true })], { type: 'text/plain' })); } catch {}
  });
  async function refresh() {
    const res = await fetch(roomPath('/api/state'), { cache: 'no-store' });
    if (res.ok) render(await res.json());
  }
  function socket() {
    if (ws && ws.readyState <= 1) return; // never more than one live connection
    try { ws = new WebSocket(session() ? session().wsUrl() : (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws'); } catch { return; }
    ws.addEventListener('open', () => { retries = 0; document.body.classList.remove('is-offline'); });
    ws.addEventListener('message', (ev) => { try { const p = JSON.parse(ev.data); if (p.type === 'state') render(p.data); else if (p.type === 'lobby') lobbyEvent(p); } catch {} });
    ws.addEventListener('close', () => { if (leaving) return; document.body.classList.add('is-offline'); setTimeout(() => { socket(); refresh().catch(() => {}); }, Math.min(15000, 1500 * (++retries))); });
    ws.addEventListener('error', () => ws.close());
  }
  /** lobby:* events arrive at once (the full state follows): the preparation card advances step by step. */
  function lobbyEvent(p) {
    if (!state || !p.data || !('lobby' in p.data)) return;
    if (p.event === 'lobby:ready' || (p.event === 'registration:opened' && state.flow?.stage === 'PREPARING_LOBBY')) readyFlash = Date.now() + 650;
    state = { ...state, flow: { ...state.flow, state: p.data.state, stage: p.data.stage, version: p.data.version, lobby: p.data.lobby } };
    render(state);
    if (readyFlash > Date.now()) setTimeout(() => state && render(state), 700);
  }
  function paintRoom() {
    const badge = $('roomBadge');
    badge.hidden = false;
    badge.textContent = me.owner || ownerToken() ? 'غرفة المالك' : me.access === 'promo' ? (me.level === 'live' ? 'كل الميزات' : 'وضع التجربة') : me.user ? 'غرفتك' : 'غرفة';
    $('tab-codes').hidden = !(me.owner || ownerToken());
  }

  /* ---------- game library: category filters, search and a grid of cards ---------- */
  const allGames = () => [...(site?.games || []), ...(site?.extraGames || [])];
  const coverAt = (g, w) => (g.cover?.startsWith('/cards/') ? g.cover.replace('.webp', '-' + w + '.webp') : g.cover || '/covers/' + g.mode + '.svg');
  let filterCat = 'all';
  function gameCard(g, i, extra) {
    const li = el('li', 'st-card'); li.dataset.mode = g.mode; li.dataset.cat = g.category || 'smart'; li.dataset.tone = String(i % 6);
    if (extra) li.dataset.extra = '1';
    li.dataset.search = (g.title + ' ' + (g.summary || '') + ' ' + (g.categoryLabel || '')).toLowerCase();
    const art = el('div', 'st-card-art');
    const img = el('img'); img.alt = ''; img.width = 120; img.height = 154; img.loading = i < 8 ? 'eager' : 'lazy'; img.decoding = 'async';
    img.src = coverAt(g, 200); art.append(img);
    const tags = el('div', 'st-card-tags');
    tags.append(el('span', 'st-badge', g.categoryLabel || ''));
    if (extra) tags.append(el('span', 'st-badge is-extra', 'إضافية'));
    const live = el('span', 'st-badge is-live', 'تعمل الآن'); live.hidden = true; tags.append(live);
    const body = el('div', 'st-card-body');
    body.append(tags, el('h3', '', g.title), el('p', '', g.summary || ''));
    const acts = el('div', 'st-card-acts');
    const play = el('button', 'st-play'); play.type = 'button'; play.dataset.play = g.mode;
    const arrow = el('span', 'st-play-arrow', '‹'); arrow.setAttribute('aria-hidden', 'true');
    play.append(el('span', '', 'تشغيل اللعبة'), arrow);
    const how = el('button', 'st-how', 'شرح'); how.type = 'button'; how.dataset.how = g.mode; how.setAttribute('aria-label', 'شرح ' + g.title);
    acts.append(play, how);
    li.append(art, body, acts);
    return li;
  }
  function paintNav() {
    const main = site?.games || [], extras = site?.extraGames || [];
    $('gameNav').replaceChildren(...main.map((g, i) => gameCard(g, i, false)), ...extras.map((g, i) => gameCard(g, main.length + i, true)));
    const cats = [['all', 'الكل']];
    for (const g of main) if (g.category && !cats.some(([k]) => k === g.category)) cats.push([g.category, g.categoryLabel || g.category]);
    if (extras.length) cats.push(['extra', 'ألعاب إضافية']);
    $('gameCats').replaceChildren(...cats.map(([k, label]) => {
      const b = el('button', 'st-cat', label); b.type = 'button'; b.dataset.cat = k; b.setAttribute('aria-pressed', String(k === filterCat)); return b;
    }));
    applyFilter(); markCurrent();
  }
  function applyFilter() {
    const q = $('gameSearch').value.trim().toLowerCase();
    let shown = 0;
    for (const li of $('gameNav').children) {
      const okCat = filterCat === 'all' || (filterCat === 'extra' ? li.dataset.extra === '1' : li.dataset.cat === filterCat && li.dataset.extra !== '1');
      const ok = okCat && (!q || li.dataset.search.includes(q));
      li.hidden = !ok; if (ok) shown++;
    }
    $('gameCount').textContent = shown === 1 ? 'لعبة واحدة' : shown === 2 ? 'لعبتان' : num(shown) + (shown <= 10 ? ' ألعاب' : ' لعبة');
    $('gameNone').hidden = shown > 0;
  }
  function markCurrent() {
    const running = state?.status?.active ? state.status.mode : null;
    for (const li of $('gameNav').children) {
      li.classList.toggle('is-current', li.dataset.mode === mode);
      const tag = li.querySelector('.is-live'); if (tag) tag.hidden = li.dataset.mode !== running;
    }
  }
  $('gameSearch').addEventListener('input', applyFilter);
  $('gameCats').addEventListener('click', (e) => {
    const b = e.target.closest('.st-cat'); if (!b) return;
    filterCat = b.dataset.cat;
    for (const x of $('gameCats').children) x.setAttribute('aria-pressed', String(x === b));
    applyFilter();
  });
  function showScreen(name) {
    const changed = document.body.dataset.screen !== name;
    document.body.dataset.screen = name;
    if (changed) { setTimeout(() => beat(), 0); scrollTo({ top: 0, behavior: 'instant' }); }
    if (name === 'games') document.title = (game.title || 'اللعبة') + ' | سبونج لايف';
    else if (name === 'setup') document.title = 'إعداد ' + (game.title || 'اللعبة') + ' | سبونج لايف';
    else if (name === 'prepare') document.title = 'جاري تجهيز اللوبي | سبونج لايف';
    else if (name === 'lobby') document.title = 'غرفة الانتظار — ' + (game.title || '') + ' | سبونج لايف';
    if (changed && name === 'setup') { advFor = ''; if (state) paintSetup(state); }
    if (changed && name !== 'lobby') { lbFirst = true; }
    if (changed && name === 'game' && document.body.dataset.drawer === 'open') $('drawerToggle').click(); // the game gets the whole screen
    if (changed && name !== 'game' && document.body.dataset.immersive) leaveFull();
    if (changed && name === 'lobby') { $('lbWordForm').hidden = true; $('lbWordEdit').hidden = false; $('lbWord').hidden = false; }
  }
  function openRules(m) {
    const g = allGames().find((x) => x.mode === m); if (!g) return;
    $('rulesTitle').textContent = g.title; $('rulesSummary').textContent = g.summary || ''; $('rulesCat').textContent = g.categoryLabel || '';
    $('rulesCover').src = coverAt(g, 200);
    $('rulesList').replaceChildren(...(g.rules || []).map((r) => el('li', '', r)));
    $('rulesPlay').dataset.play = m;
    if (typeof $('rulesDialog').showModal === 'function') $('rulesDialog').showModal();
  }
  function libNote(msg) { $('libNote').textContent = msg || ''; $('libNote').hidden = !msg; }
  // «تشغيل اللعبة»: opens the game's setup — never a round, never the registration
  async function playGame(m) {
    if (!MODES.includes(m) || busy) return;
    libNote('');
    busy = true;
    try { browsing = false; await step('flow-setup', { mode: m }); }
    catch (err) { browsing = true; libNote(err.message); fx()?.play('wrong'); }
    finally { busy = false; if (state) render(state); }
  }
  $('gameNav').addEventListener('click', (e) => {
    const how = e.target.closest('[data-how]'); if (how) { openRules(how.dataset.how); return; }
    const play = e.target.closest('[data-play]'); if (play) playGame(play.dataset.play);
  });
  $('rulesPlay').addEventListener('click', () => { $('rulesDialog').close(); playGame($('rulesPlay').dataset.play); });
  // looking at the library does not end anything on the server; «العودة إليها» comes back
  const browse = () => toList();
  $('backToGames').addEventListener('click', browse);
  $('gamesLink')?.addEventListener('click', browse);
  $('resumeGame').addEventListener('click', () => { browsing = false; if (state) render(state); });

  /* ---------- drawer tabs ---------- */
  const tabs = [...document.querySelectorAll('.st-tabs [role=tab]')];
  function openTab(tab) {
    for (const t of tabs) { const on = t === tab; t.setAttribute('aria-selected', String(on)); $(t.getAttribute('aria-controls')).hidden = !on; }
    if (tab.id === 'tab-codes') loadCodes();
  }
  tabs.forEach((t) => t.addEventListener('click', () => openTab(t)));
  $('drawerToggle').addEventListener('click', () => {
    const open = document.body.dataset.drawer !== 'open';
    document.body.dataset.drawer = open ? 'open' : 'closed';
    $('drawerToggle').setAttribute('aria-expanded', String(open));
    try { localStorage.setItem('sponge_drawer', open ? 'open' : 'closed'); } catch {}
  });
  try { if (localStorage.getItem('sponge_drawer') === 'closed' || innerWidth < 900) { document.body.dataset.drawer = 'closed'; $('drawerToggle').setAttribute('aria-expanded', 'false'); } } catch {}

  /* ---------- stream connection: the account's signed-in platform accounts; typing a name is the owner's test tool only ---------- */
  const PNAME = { tiktok: 'TikTok', kick: 'Kick' };
  let links = { linked: {}, platforms: {}, entitled: false };
  async function loadLinks() {
    if (me.owner || ownerToken() || !me.account) { $('manualConnect').hidden = !(me.owner || ownerToken()); paintLinks(); return; }
    try { links = await (await fetch('/api/me/links', { credentials: 'same-origin', cache: 'no-store' })).json(); } catch {}
    paintLinks();
  }
  function paintLinks() {
    const box = $('linkedConnect'); box.hidden = !!(me.owner || ownerToken());
    if (box.hidden) return;
    const c = state?.connection || {};
    box.replaceChildren(...['tiktok', 'kick'].map((p) => {
      const l = links.linked?.[p];
      if (!l || l.needsReauth) {
        const a = el('a', 'st-link-cta', l ? 'أعد ربط ' + PNAME[p] : 'اربط ' + PNAME[p]); a.href = '/account#settings';
        a.title = l ? 'انتهى التفويض — أعد الربط من الإعدادات' : 'سجّل الدخول إلى ' + PNAME[p] + ' من الإعدادات';
        return a;
      }
      const on = c.state === 'connected' && c.platform === p;
      const b = el('button', 'st-linked-btn' + (on ? ' is-on' : '')); b.type = 'button'; b.dataset.platform = p; b.disabled = on;
      const ava = el('span', 'st-linked-ava', (l.handle[0] || '?').toUpperCase());
      if (l.avatar && /^https:\/\//.test(l.avatar)) { const img = el('img'); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.addEventListener('error', () => img.remove(), { once: true }); img.src = l.avatar; ava.append(img); }
      b.append(ava, el('span', '', (on ? 'متصل · ' : 'اتصال · ') + PNAME[p]), el('bdi', 'st-linked-h', '@' + l.handle));
      return b;
    }));
  }
  $('linkedConnect').addEventListener('click', (e) => {
    const b = e.target.closest('.st-linked-btn'); if (!b) return;
    run(b, async () => {
      $('planNotice').hidden = true;
      try { await admin('connect', { platform: b.dataset.platform }); feedback('متصل ببثك على ' + PNAME[b.dataset.platform] + ' ✓'); }
      catch (err) { if (err.code === 409 && /الإعدادات/.test(err.message)) loadLinks(); throw err; }
    });
  });
  $('platformSelect').addEventListener('change', () => {
    const kick = $('platformSelect').value === 'kick';
    $('handleInput').placeholder = kick ? 'اسم قناة Kick' : 'اسم حساب TikTok';
    $('kickWrap').hidden = !kick;
  });
  $('connectForm').addEventListener('submit', (e) => { e.preventDefault(); if ($('manualConnect').hidden) return; run($('connectButton'), async () => {
    const username = $('handleInput').value.trim().replace(/^@/, '');
    if (!username) { $('handleInput').focus(); throw new Error('اكتب اسم الحساب'); }
    const platform = $('platformSelect').value;
    await admin('connect', { username, platform, ...(platform === 'kick' && $('kickChatroom').value ? { chatroomId: $('kickChatroom').value.trim() } : {}) });
    feedback('اتصال تجريبي لغرفة المالك — لا يظهر في البثوث النشطة.');
  }); });
  $('disconnectButton').addEventListener('click', (e) => run(e.currentTarget, () => admin('disconnect')));
  function chip(id, on, text) { $(id).dataset.on = String(on); $(id).querySelector('b').textContent = text; }
  /** Four separate facts, all decided by the server: account linked, stream live, game running, plan active. */
  function paintChips(s) {
    const c = s?.connection || {}, linkedAny = Object.values(links.linked || {}).some((l) => l && !l.needsReauth);
    chip('chipAccount', linkedAny, me.owner || ownerToken() ? 'غرفة المالك' : linkedAny ? 'مرتبط' : 'غير مرتبط');
    chip('chipStream', c.state === 'connected' && !!c.liveConfirmed, c.state === 'connected' ? (c.liveConfirmed ? 'مباشر' : 'تعذر التحقق') : c.state === 'connecting' ? 'جارٍ الاتصال' : 'غير مباشر');
    const running = !!s?.status?.active || (s?.registration?.phase === 'open' && document.body.dataset.screen === 'game');
    chip('chipGame', running, s?.status?.active ? 'تعمل' : running ? 'بانتظار اللاعبين' : 'متوقفة');
    const plan = me.owner || ownerToken() ? true : !!me.account?.entitled;
    chip('chipPlan', true, me.owner || ownerToken() ? 'المالك' : 'مجاني');
  }
  function paintConnection(c) {
    const st = c?.state || 'disconnected';
    $('connState').dataset.state = st;
    $('connText').textContent = { connected: 'متصل' + (c.username ? ' @' + c.username : '') + (c.verified ? ' ✓' : ''), connecting: 'جارٍ الاتصال…', error: 'خطأ في الاتصال', disconnected: 'غير متصل' }[st] || st;
    $('connState').title = c?.detail || '';
    $('sideDot').dataset.state = st;
    $('sideConn').textContent = state?.flow?.lobby?.demo ? 'وضع التجربة — بلا بث' : (c?.platform === 'kick' ? 'Kick' : 'TikTok') + ' — ' + $('connText').textContent;
    $('disconnectButton').hidden = !['connected', 'connecting'].includes(st);
    $('connectButton').hidden = st === 'connected';
    if (st === 'connected' && c.username && !$('manualConnect').hidden && document.activeElement !== $('handleInput')) $('handleInput').value = c.username;
    paintLinks(); paintChips(state);
  }
  function paintLeaders(list) {
    $('leaders').replaceChildren(...(list || []).slice(0, 10).map((p, i) => { const li = el('li'); li.append(el('b', 'num', String(i + 1)), el('span', '', p.name), el('small', 'num', String(p.score))); return li; }));
  }
  $('resetButton').addEventListener('click', () => $('lbReset').click());

  /* ---------- promo codes (owner) ---------- */
  async function loadCodes() {
    try {
      const r = await admin('promo-list');
      $('codeList').replaceChildren(...r.codes.map((c) => {
        const li = el('li', 'is-' + c.status);
        const info = el('div'); info.append(el('b', '', (c.label || 'بدون وصف') + ' '), el('code', '', c.hint), el('small', '', ` • ${c.levelLabel} • استُخدم ${c.uses}${c.maxUses ? ' من ' + c.maxUses : ''}${c.expiresAt ? ' • ينتهي ' + new Date(c.expiresAt).toLocaleDateString('ar') : ''} • ${({ active: 'فعّال', disabled: 'معطّل', expired: 'منتهي', used: 'مستنفد' })[c.status]}`));
        const toggle = el('button', 'pl-btn pl-btn-ghost', c.active ? 'تعطيل' : 'تفعيل'); toggle.type = 'button';
        toggle.addEventListener('click', () => run(toggle, async () => { await admin('promo-update', { id: c.id, active: !c.active }); await loadCodes(); }));
        const del = el('button', 'pl-btn pl-btn-danger', 'حذف'); del.type = 'button';
        del.addEventListener('click', () => run(del, async () => { await admin('promo-delete', { id: c.id }); await loadCodes(); }));
        li.append(info, toggle, del); return li;
      }));
      if (!r.codes.length) $('codeList').replaceChildren(el('li', 'pl-hint', 'لا توجد رموز بعد.'));
    } catch (err) { feedback(err.message, true); }
  }
  $('codeForm').addEventListener('submit', (e) => { e.preventDefault(); run(null, async () => {
    const body = { label: $('codeLabel').value.trim(), maxUses: Number($('codeUses').value || 0), level: $('codeLevel').value };
    if ($('codeText').value.trim()) body.code = $('codeText').value.trim();
    if ($('codeExpires').value) body.expiresAt = $('codeExpires').value + 'T23:59:59';
    const r = await admin('promo-create', body);
    $('newCode').hidden = false; $('newCode').textContent = 'الرمز الجديد (يظهر مرة واحدة فقط — انسخه الآن): ' + r.code.code;
    $('codeText').value = ''; await loadCodes();
  }); });

  $('logoutButton').addEventListener('click', async () => {
    try { await fetch('/api/access/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    try { sessionStorage.removeItem('liveverse_admin'); } catch {}
    location.href = '/login?signed_out=1';
  });

  async function boot() {
    try { site = await (await fetch('/api/site', { cache: 'no-store' })).json(); } catch {}
    try { me = await (await fetch('/api/access/me', { credentials: 'same-origin', cache: 'no-store' })).json(); if (!me.signedIn && !ownerToken()) { location.href = '/login?next=' + encodeURIComponent(location.pathname); return; } } catch {}
    game = [...(site?.games || []), ...(site?.extraGames || [])].find((x) => x.mode === mode) || game;
    // «قيد التطوير»: only a developer (checked by the server on every command) gets this far; say so on screen
    if (game?.status === 'dev') {
      if (!me?.developer && !ownerToken()) { location.replace('/game/' + encodeURIComponent(mode)); return; }
      $('devBannerText').textContent = '«' + (game.title || 'هذه اللعبة') + '» قيد التطوير — لا يراها المستخدمون ولا يستطيعون تشغيلها. الاختبار هنا للمطورين فقط.';
      $('devBanner').hidden = false;
    }
    paintNav(); paintGame(); paintRoom(); loadLinks();
    const s = session(); if (s) await s.ready;
    beat(true); // the window opened last takes control (a reload never waits for the old window to time out)
    await refresh().catch(() => feedback('تعذر الاتصال بالسيرفر', true));
    // /game/<mode>: open that game's settings, unless a session is already under way (a reload keeps it)
    booted = true;
    // another game's settings screen (nothing running yet) gives way to the game this page is for;
    // a waiting room or a round already under way stays on screen until the host ends it
    const want = MODES.includes(pathMode) ? pathMode : mode;
    if (!state?.flow || state.flow.stage === 'GAME_LIBRARY' || (state.flow.stage === 'GAME_SETUP' && state.flow.mode !== want)) { mode = want; await playGame(want); }
    socket();
  }
  boot();
})();
