/* SPONGE LIVE — the studio (/studio?mode=…): game list, the selected game, and a tabbed control drawer.
   Only the selected game is prepared and only its settings are shown. Viewers join from the stream chat.
   Every node is built with createElement/textContent (no HTML strings). */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const MODES = ['quiz', 'drawguess', 'chairs', 'bowling', 'bomb', 'categories', 'rps', 'roles', 'roulette', 'redlight', 'country', 'flag',
    'guess', 'race', 'glass', 'truefalse', 'higherlower', 'minority', 'wheel'];
  let mode = MODES.includes(params.get('mode')) ? params.get('mode') : 'quiz';
  const NO_TIMER = ['race', 'wheel'];
  const ROUND_GAMES = { drawguess: [3, 5, 8], bowling: [2, 3, 5], country: [5, 8, 12], flag: [5, 10, 15], truefalse: [5, 8, 12], higherlower: [5, 8, 12], categories: [8, 12, 20] };
  const VARIANTS = {
    rps: { key: 'format', label: 'شكل اللعب', options: [['duel', 'مواجهات ثنائية'], ['sky', 'الكل ضد بوبل (3 حيوات)']] },
    roulette: { key: 'rule', label: 'قاعدة العجلة', options: [['eliminate', 'كل دورة تُقصي لاعبًا'], ['winner', 'دورة واحدة تختار الفائز']] },
    categories: { key: 'scoring', label: 'عند الخطأ', options: [['elimination', 'إقصاء اللاعب'], ['points', 'خصم 3 نقاط']] },
    drawguess: { key: 'winners', label: 'الفائزون في كل جولة', options: [[1, 'أول إجابة صحيحة فقط'], [3, 'أول ثلاث إجابات']] }
  };
  let game = { mode, title: '', minPlayers: 1, rules: [], setup: '/event?mode=' + mode };
  let state = null, seen = new Set(), firstPaint = true, busy = false, retries = 0, prepared = false, preparing = false, site = null, ws = null, me = {};

  const session = () => window.SkySession;
  const fx = () => window.SpongeFx;
  const ownerToken = () => session()?.ownerToken?.() || '';
  /** Host = whoever controls this room; an explicit ?room= of someone else is a read-only view. */
  function isHost() { return true; } // the server only serves /studio to a signed-in host
  const roomPath = (p) => session() ? session().withRoom(p) : p;
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const initial = (n) => Array.from(String(n || '؟').replace(/^@/, '').trim())[0] || '؟';
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  function feedback(msg, error = false) { const f = $('feedback'); f.textContent = msg || ''; f.classList.toggle('is-error', !!error); }

  /** The subscription ended while the studio was open: the round on screen is kept (viewers and OBS still see it),
      but the server refuses new commands until the account is renewed. */
  function expired(message) {
    if (document.getElementById('expiredBanner')) return;
    const b = el('div', 'st-expired'); b.id = 'expiredBanner'; b.setAttribute('role', 'alert');
    const t = el('span', '', message || 'انتهى اشتراكك أو تجربتك — الجولة الحالية محفوظة على الشاشة، جدّد للمتابعة.');
    const a = el('a', '', 'تجديد الاشتراك'); a.href = '/account#plans';
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
    document.title = (game.title || 'شاشة اللعبة') + ' | SPONGE LIVE';
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
    $('gameCover').closest('.pl-cover').classList.toggle('is-art', cover.startsWith('/games/'));
    $('setupLink').href = game.setup || '/studio';
    $('guessFields').hidden = mode !== 'guess';
    const v = VARIANTS[mode];
    $('variantWrap').hidden = !v;
    if (v) { $('variantLabel').textContent = v.label; $('variantSelect').replaceChildren(...v.options.map(([val, label]) => { const o = el('option', '', label); o.value = String(val); return o; })); }
    const r = ROUND_GAMES[mode];
    $('roundsWrap').hidden = !r;
    if (r) $('roundsSelect').replaceChildren(...r.map((n) => { const o = el('option', '', String(n)); o.value = String(n); return o; }));
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
    if (s.status.mode === mode && s.status.results && s.registration.phase !== 'open') return 'done';
    return 'join';
  }
  function render(s) {
    if (!s?.status) return;
    const prev = state; state = s;
    const reg = s.registration || {};
    const host = isHost();
    const view = viewFor(s);
    document.body.dataset.view = view;
    const word = reg.keyword || 'انضم';
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
    $('callSubText').textContent = view === 'busy' ? 'تُلعب الآن «' + (s.status.title || '') + '» — انتظر انتهاءها'
      : view === 'done' ? 'انتهت الجولة — بانتظار الجولة التالية'
      : reg.phase === 'open' ? (count ? 'بانتظار انضمام المزيد من اللاعبين' : 'بانتظار انضمام اللاعبين')
      : 'الانضمام مغلق حاليًا — بانتظار المشرف';
    $('joinCall').hidden = view === 'live';

    const showFrame = view === 'live' || view === 'done';
    $('liveView').hidden = !showFrame;
    if (showFrame) {
      const base = roomPath('/overlay'), src = base + (base.includes('?') ? '&' : '?') + 'embedded=1' + (host ? '&mute=1' : '');
      if ($('liveFrame').dataset.src !== src) { $('liveFrame').dataset.src = src; $('liveFrame').src = src; }
      $('liveNotice').textContent = s.status.notice || '';
      document.querySelector('.pl-live-tag').lastChild.textContent = view === 'live' ? 'اللعبة جارية' : 'النتائج';
    }
    $('lateNote').hidden = !showFrame;
    $('lateCount').textContent = reg.waitingCount ? ' • ' + num(reg.waitingCount) + ' بالانتظار' : '';
    if (prev && !prev.status.active && s.status.active && s.status.mode === mode) fx()?.play('start');

    // Host controls.
    $('adminBar').hidden = !host; $('hostPanel').hidden = !host;
    $('overlayLink').hidden = !host; $('overlayLink').href = roomPath('/overlay');
    if (host) paintHost(s, view, need);
    else $('hostTools').hidden = true;
    if (host && view === 'join' && reg.phase === 'idle' && !busy && prepared) prepare();
  }
  function paintHost(s, view, need) {
    const reg = s.registration || {}, active = !!s.status.active;
    $('adminJoin').hidden = view !== 'join';
    $('adminLive').hidden = !(view === 'live' || view === 'busy');
    $('adminDone').hidden = view !== 'done';
    $('drawButton').hidden = !(mode === 'wheel' && view === 'live');
    $('advanceButton').hidden = view !== 'live' || NO_TIMER.includes(mode);
    const seated = !!reg.hostSeated;
    $('hostSeatButton').setAttribute('aria-pressed', String(seated));
    $('hostSeatLabel').textContent = seated ? 'إلغاء مشاركتي' : 'دخّلني أنا';
    $('startButton').disabled = busy || need > 0 || reg.phase === 'idle';
    $('startLabel').textContent = need > 0 ? 'ابدأ اللعبة (ينقص ' + num(need) + ')' : 'ابدأ اللعبة';
    $('demoButton').hidden = s.connection?.state === 'connected';
    $('regState').textContent = reg.phase === 'open' ? 'الانضمام مفتوح' : 'الانضمام مغلق';
    $('regToggle').textContent = reg.phase === 'open' ? 'إغلاق الانضمام' : 'فتح الانضمام';
    $('regToggle').disabled = active;
    if (document.activeElement !== $('keywordInput')) $('keywordInput').value = reg.keyword || 'انضم';
    if (document.activeElement !== $('maxInput')) $('maxInput').value = String(reg.maxPlayers || 1500);
    $('autoHost').checked = reg.hostJoin === 'auto';
    for (const id of ['stopButton', 'liveStopButton']) $(id).disabled = !active;
    for (const id of ['keywordForm', 'addForm']) $(id).querySelectorAll('input,button').forEach((n) => { n.disabled = active; });
    paintTools(s, view);
  }

  /* ---------- host tools for the running game ---------- */
  let secretRound = -1, rolesAt = 0;
  async function paintTools(s, view) {
    const party = s.party, live = view === 'live';
    const draw = live && mode === 'drawguess' && party, judge = live && mode === 'categories' && party?.judging, roles = live && mode === 'roles';
    $('hostTools').hidden = !(draw || judge || roles);
    $('sketchTool').hidden = !draw; $('judgeTool').hidden = !judge; $('rolesTool').hidden = !roles;
    if (draw && party.round !== secretRound) {
      secretRound = party.round; clearSketch(true);
      try { const r = await admin('secret'); $('secretWord').textContent = r.secret?.word || '—'; } catch { $('secretWord').textContent = '—'; }
    }
    if (judge) $('judgeAnswer').textContent = '«' + (party.answer || '') + '»';
    if (roles) {
      $('roleLink').textContent = location.origin + '/role' + (session()?.room() && session().room() !== 'main' ? '?room=' + session().room() : '');
      if (Date.now() - rolesAt > 2500) { rolesAt = Date.now(); admin('roles-admin').then(paintRoles).catch(() => {}); }
    }
  }
  function paintRoles(r) {
    const list = $('rolesList');
    if (r.hidden) { list.replaceChildren(el('li', 'pl-hint', 'أنت تلعب في هذه الجولة، لذلك أدوار اللاعبين مخفية عنك أيضًا.')); return; }
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
  async function prepare() {
    if (preparing) return;
    prepared = true; preparing = true;
    try { await admin('prepare', { mode }); }
    catch (err) { feedback(err.message, true); }
    finally { preparing = false; }
  }
  $('hostSeatButton').addEventListener('click', (e) => run(e.currentTarget, async () => {
    if (state?.registration?.hostSeated) { await admin('host-unseat'); feedback('ألغيت مشاركتك — ما زلت تدير اللعبة.'); }
    else { await admin('host-seat'); feedback('أنت الآن ضمن المتسابقين، وتطبق عليك قواعد اللعبة نفسها.'); }
  }));
  $('autoHost').addEventListener('change', (e) => run(null, async () => {
    await admin('registration-settings', { hostJoin: e.target.checked ? 'auto' : 'manual' });
    feedback(e.target.checked ? 'ستدخل تلقائيًا كلاعب في كل لعبة تفتحها.' : 'لن تدخل تلقائيًا بعد الآن.');
  }));
  $('regToggle').addEventListener('click', (e) => run(e.currentTarget, async () => {
    if (state?.registration?.phase === 'open') await admin('registration-close'); else await admin('prepare', { mode });
  }));
  $('keywordForm').addEventListener('submit', (e) => { e.preventDefault(); run(null, async () => {
    const keyword = $('keywordInput').value.trim(), maxPlayers = Number($('maxInput').value);
    await admin('registration-settings', { keyword, maxPlayers });
    feedback('حُفظت كلمة الانضمام «' + keyword + '» والحد ' + num(maxPlayers) + ' متسابق.');
  }); });
  $('addForm').addEventListener('submit', (e) => { e.preventDefault(); run(null, async () => {
    const name = $('addName').value.trim(); if (!name) throw new Error('اكتب اسم اللاعب');
    await admin('add-player', { name }); $('addName').value = ''; feedback('أُضيف ' + name);
  }); });
  $('demoButton').addEventListener('click', (e) => run(e.currentTarget, async () => {
    const r = await admin('demo-players', { count: Math.max(4, (state?.registration?.minPlayers || 1)) });
    await admin('simulation', { autoplay: true }).catch(() => {});
    feedback('وضع التجربة: أُضيف ' + num(Array.isArray(r.added) ? r.added.length : r.added) + ' لاعبين تجريبيين يلعبون تلقائيًا (معلَّمون بـ «تجريبي»).');
  }));
  $('variantSelect').addEventListener('change', (e) => run(null, async () => {
    const v = VARIANTS[mode]; const raw = e.target.value; const value = typeof v.options[0][0] === 'number' ? Number(raw) : raw;
    await admin('configure', { mode, variant: { [v.key]: value } }); feedback('حُفظ: ' + e.target.selectedOptions[0].textContent);
  }));
  $('roundsSelect').addEventListener('change', (e) => run(null, async () => { await admin('configure', { mode, rounds: Number(e.target.value) }); feedback('عدد الجولات: ' + e.target.value); }));
  async function startGame() {
    if (mode === 'guess') {
      const prompt = $('guessPrompt').value.trim(), answer = $('guessAnswer').value.trim();
      if (!prompt || !answer) { $(prompt ? 'guessAnswer' : 'guessPrompt').focus(); throw new Error('اكتب التلميح والإجابة السرية قبل البدء'); }
      await admin('configure', { mode, prompt, answer });
    }
    if (state?.registration?.phase === 'closed' && !state.status.active) await admin('prepare', { mode });
    await admin('start');
    if (mode === 'wheel') feedback('دخل كل المشاركين السحب — اضغط «اسحب الفائز».');
  }
  $('startButton').addEventListener('click', (e) => run(e.currentTarget, startGame));
  $('drawButton').addEventListener('click', (e) => run(e.currentTarget, async () => { const r = await admin('draw'); feedback('🏆 الفائز: ' + r.result.name); }));
  $('advanceButton').addEventListener('click', (e) => run(e.currentTarget, () => admin('advance')));
  const stop = async () => { await admin('stop'); if (state?.status?.mode !== mode) await admin('prepare', { mode }); };
  $('liveStopButton').addEventListener('click', (e) => run(e.currentTarget, stop));
  $('stopButton').addEventListener('click', (e) => run(e.currentTarget, stop));
  $('restartButton').addEventListener('click', (e) => run(e.currentTarget, async () => {
    if (state?.status?.active) await admin('stop');
    await admin('prepare', { mode });
    feedback('أُعيد فتح الجولة بنفس المتسابقين — اضغط «ابدأ اللعبة».');
  }));
  $('endButton').addEventListener('click', (e) => run(e.currentTarget, async () => {
    if (state?.status?.active) await admin('stop');
    if (state?.registration?.phase === 'open') await admin('registration-close').catch(() => {});
    location.href = '/#games';
  }));
  $('againButton').addEventListener('click', (e) => run(e.currentTarget, () => admin('prepare', { mode })));

  /* ---------- presence: the server only lists a stream while its studio window keeps beating ---------- */
  let beatTimer = 0;
  async function beat(takeover = false) {
    clearTimeout(beatTimer);
    try {
      const r = await admin('heartbeat', { tab: TAB, screen: document.body.dataset.screen === 'game' ? 'game' : 'games', ...(takeover ? { takeover: true } : {}) });
      $('windowBanner').hidden = r.primary;
      paintListed(r);
    } catch { /* offline or plan ended: the server stops listing the stream by itself */ }
    beatTimer = setTimeout(() => beat(), 15_000);
  }
  const REASONS = { 'no-subscription': 'لا يوجد اشتراك فعال', 'not-verified': 'لم تُثبت ملكية حساب البث', 'not-live': 'البث غير مباشر الآن', 'studio-closed': 'الاستوديو مغلق', 'no-game': 'شغّل لعبة ليظهر بثك' };
  function paintListed(r) {
    const t = $('sideListed');
    t.textContent = r.listed ? 'ظاهر الآن في البثوث النشطة ✓' : 'غير ظاهر في البثوث النشطة — ' + (REASONS[(r.reasons || []).find((x) => x !== 'studio-closed')] || 'غير متصل');
    t.classList.toggle('is-on', !!r.listed);
  }
  $('takeOver').addEventListener('click', () => beat(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) beat(); });

  /* ---------- proof of account ownership ---------- */
  let verifyTimer = 0, verifyEnds = 0;
  function showVerify(v) {
    $('verifyPanel').hidden = false; $('verifyPanel').classList.remove('is-done');
    $('verifyTitle').textContent = 'أثبت أن الحساب حسابك'; $('verifyHelp').hidden = false;
    $('verifyHandle').textContent = '@' + v.handle; $('verifyPlatform').textContent = v.platform === 'kick' ? 'Kick' : 'TikTok';
    $('verifyCode').textContent = v.code; $('verifyCopy').hidden = false; $('verifyCode').hidden = false;
    verifyEnds = Date.parse(v.expiresAt) || Date.now() + 600_000;
    clearInterval(verifyTimer);
    const tick = () => { const s = Math.max(0, Math.round((verifyEnds - Date.now()) / 1000)); $('verifyLeft').textContent = s ? 'ينتهي الرمز خلال ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : 'انتهت مهلة الرمز — اربط مرة أخرى'; if (!s) clearInterval(verifyTimer); };
    tick(); verifyTimer = setInterval(tick, 1000);
  }
  function paintVerify(c) {
    if (!c || $('verifyPanel').hidden) return;
    if (c.verified) {
      clearInterval(verifyTimer);
      $('verifyPanel').classList.add('is-done'); $('verifyTitle').textContent = 'تم التحقق من ملكية الحساب ✓';
      $('verifyHelp').hidden = true; $('verifyCode').hidden = true; $('verifyCopy').hidden = true;
      $('verifyLeft').textContent = 'حسابك موثّق الآن — لن تحتاج الرمز مرة أخرى لهذا الحساب.';
      setTimeout(() => { $('verifyPanel').hidden = true; }, 6000);
    } else if (!c.verifying && c.state !== 'connected' && c.state !== 'connecting') { clearInterval(verifyTimer); $('verifyPanel').hidden = true; }
  }
  $('verifyCopy').addEventListener('click', () => { navigator.clipboard?.writeText($('verifyCode').textContent).then(() => feedback('نُسخ الرمز — الصقه في تعليقات بثك.')).catch(() => {}); });

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
    ws.addEventListener('message', (ev) => { try { const p = JSON.parse(ev.data); if (p.type === 'state') render(p.data); } catch {} });
    ws.addEventListener('close', () => { if (leaving) return; document.body.classList.add('is-offline'); setTimeout(() => { socket(); refresh().catch(() => {}); }, Math.min(15000, 1500 * (++retries))); });
    ws.addEventListener('error', () => ws.close());
  }
  function paintRoom() {
    const badge = $('roomBadge');
    badge.hidden = false;
    badge.textContent = me.owner || ownerToken() ? 'غرفة المالك' : me.access === 'promo' ? (me.level === 'live' ? 'استوديو كامل' : 'وضع التجربة') : me.user ? 'غرفتك' : 'غرفة';
    $('tab-codes').hidden = !(me.owner || ownerToken());
  }

  /* ---------- game library: category filters, search and a grid of cards ---------- */
  const allGames = () => [...(site?.games || []), ...(site?.extraGames || [])];
  const coverAt = (g, w) => (g.cover?.startsWith('/games/') ? g.cover.replace('.webp', '-' + w + '.webp') : g.cover || '/covers/' + g.mode + '.svg');
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
    document.body.dataset.screen = name;
    setTimeout(() => beat(), 0);
    if (name === 'games') { history.replaceState(null, '', '/studio'); document.title = 'الاستوديو | SPONGE LIVE'; }
    scrollTo({ top: 0, behavior: 'instant' });
  }
  function openRules(m) {
    const g = allGames().find((x) => x.mode === m); if (!g) return;
    $('rulesTitle').textContent = g.title; $('rulesSummary').textContent = g.summary || ''; $('rulesCat').textContent = g.categoryLabel || '';
    $('rulesCover').src = coverAt(g, 200);
    $('rulesList').replaceChildren(...(g.rules || []).map((r) => el('li', '', r)));
    $('rulesPlay').dataset.play = m;
    if (typeof $('rulesDialog').showModal === 'function') $('rulesDialog').showModal();
  }
  async function playGame(m) {
    showScreen('game');
    if (m === mode && prepared) { paintGame(); history.replaceState(null, '', '/studio?mode=' + mode); return; }
    await selectGame(m);
  }
  $('gameNav').addEventListener('click', (e) => {
    const how = e.target.closest('[data-how]'); if (how) { openRules(how.dataset.how); return; }
    const play = e.target.closest('[data-play]'); if (play) playGame(play.dataset.play);
  });
  $('rulesPlay').addEventListener('click', () => { $('rulesDialog').close(); playGame($('rulesPlay').dataset.play); });
  $('backToGames').addEventListener('click', () => showScreen('games'));
  $('gamesLink').addEventListener('click', () => showScreen('games'));
  async function selectGame(next) {
    if (!MODES.includes(next)) return;
    mode = next;
    game = [...(site?.games || []), ...(site?.extraGames || [])].find((x) => x.mode === mode) || { mode, title: mode, rules: [] };
    history.replaceState(null, '', '/studio?mode=' + mode);
    seen = new Set(); firstPaint = true; secretRound = -1; prepared = false;
    paintGame(); feedback('');
    if (state?.status?.active && state.status.mode !== mode) { render(state); return; } // a round of another game is running: offer to stop it
    await prepare();
  }

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

  /* ---------- stream connection ---------- */
  $('platformSelect').addEventListener('change', () => {
    const kick = $('platformSelect').value === 'kick';
    $('handleInput').placeholder = kick ? 'اسم قناة Kick' : 'اسم حساب TikTok';
    $('kickWrap').hidden = !kick;
  });
  $('connectForm').addEventListener('submit', (e) => { e.preventDefault(); run($('connectButton'), async () => {
    const username = $('handleInput').value.trim().replace(/^@/, '');
    if (!username) { $('handleInput').focus(); throw new Error('اكتب اسم الحساب'); }
    const platform = $('platformSelect').value;
    $('planNotice').hidden = true;
    const r = await admin('connect', { username, platform, ...(platform === 'kick' && $('kickChatroom').value ? { chatroomId: $('kickChatroom').value.trim() } : {}) });
    if (r.verify) showVerify(r.verify); else $('verifyPanel').hidden = true;
    feedback(r.verify ? 'متصل بالبث — بقي إثبات ملكية الحساب بالرمز' : 'تم ربط بثك الموثّق.');
  }); });
  $('disconnectButton').addEventListener('click', (e) => run(e.currentTarget, async () => { await admin('disconnect'); $('verifyPanel').hidden = true; clearInterval(verifyTimer); }));
  function paintConnection(c) {
    const st = c?.state || 'disconnected';
    $('connState').dataset.state = st;
    $('connText').textContent = { connected: 'متصل' + (c.username ? ' @' + c.username : '') + (c.verified ? ' ✓' : c.verifying ? ' — بانتظار رمز التحقق' : ''), connecting: 'جارٍ الاتصال…', error: 'خطأ في الاتصال', disconnected: 'غير متصل' }[st] || st;
    $('connState').title = c?.detail || '';
    $('sideDot').dataset.state = st;
    paintVerify(c);
    $('sideConn').textContent = (c?.platform === 'kick' || $('platformSelect').value === 'kick' ? 'Kick' : 'TikTok') + ' — ' + $('connText').textContent;
    $('disconnectButton').hidden = !['connected', 'connecting'].includes(st);
    $('connectButton').hidden = st === 'connected';
    if (st === 'connected' && c.username && document.activeElement !== $('handleInput')) $('handleInput').value = c.username;
  }
  function paintLeaders(list) {
    $('leaders').replaceChildren(...(list || []).slice(0, 10).map((p, i) => { const li = el('li'); li.append(el('b', 'num', String(i + 1)), el('span', '', p.name), el('small', 'num', String(p.score))); return li; }));
  }
  $('resetButton').addEventListener('click', (e) => run(e.currentTarget, async () => { await admin('reset'); await admin('prepare', { mode }); feedback('صُفّرت النقاط وقائمة المتسابقين.'); }));

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
    location.href = '/';
  });

  async function boot() {
    try { site = await (await fetch('/api/site', { cache: 'no-store' })).json(); } catch {}
    try { me = await (await fetch('/api/access/me', { credentials: 'same-origin', cache: 'no-store' })).json(); if (!me.signedIn && !ownerToken()) { location.href = '/?next=' + encodeURIComponent(location.pathname + location.search); return; } } catch {}
    game = [...(site?.games || []), ...(site?.extraGames || [])].find((x) => x.mode === mode) || game;
    paintNav(); paintGame(); paintRoom();
    if (params.has('mode')) document.body.dataset.screen = 'game';
    const s = session(); if (s) await s.ready;
    if (document.body.dataset.screen === 'game') await prepare(); // the library alone never starts a game session
    beat(true); // the window opened last takes control (a reload never waits for the old window to time out)
    await refresh().catch(() => feedback('تعذر الاتصال بالسيرفر', true));
    socket();
  }
  boot();
})();
