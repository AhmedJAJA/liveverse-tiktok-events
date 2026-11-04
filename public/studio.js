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

  async function admin(action, body = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const t = ownerToken(); if (t) Object.assign(headers, { Authorization: 'Bearer ' + t });
    const res = await fetch('/api/admin/' + action, { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify(body) });
    let data = {}; try { data = await res.json(); } catch {}
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
    document.querySelectorAll('.st-game').forEach((b) => b.setAttribute('aria-current', String(b.dataset.mode === mode)));
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

  /* ---------- data ---------- */
  let leaving = false;
  addEventListener('pagehide', () => { leaving = true; try { ws?.close(); } catch {} });
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

  /* ---------- game navigation ---------- */
  function navItem(g) {
    const li = el('li'), b = el('button', 'st-game'); b.type = 'button'; b.dataset.mode = g.mode;
    const img = el('img'); img.alt = ''; img.width = 44; img.height = 56; img.loading = 'lazy'; img.decoding = 'async';
    img.src = g.cover?.startsWith('/games/') ? g.cover.replace('.webp', '-120.webp') : g.cover;
    b.append(img, el('span', '', g.title)); li.append(b); return li;
  }
  function paintNav() {
    $('gameNav').replaceChildren(...(site?.games || []).map(navItem));
    $('extraNav').replaceChildren(...(site?.extraGames || []).map(navItem));
    document.querySelectorAll('.st-game').forEach((b) => b.setAttribute('aria-current', String(b.dataset.mode === mode)));
  }
  document.querySelector('.st-games').addEventListener('click', (e) => {
    const b = e.target.closest('.st-game'); if (!b || b.dataset.mode === mode) return;
    selectGame(b.dataset.mode);
  });
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
    await admin('connect', { username, platform, ...(platform === 'kick' && $('kickChatroom').value ? { chatroomId: $('kickChatroom').value.trim() } : {}) });
    feedback('جارٍ الاتصال بالبث…');
  }); });
  $('disconnectButton').addEventListener('click', (e) => run(e.currentTarget, () => admin('disconnect')));
  function paintConnection(c) {
    const st = c?.state || 'disconnected';
    $('connState').dataset.state = st;
    $('connText').textContent = { connected: 'متصل' + (c.username ? ' @' + c.username : ''), connecting: 'جارٍ الاتصال…', error: 'خطأ في الاتصال', disconnected: 'غير متصل' }[st] || st;
    $('connState').title = c?.detail || '';
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
    const s = session(); if (s) await s.ready;
    await prepare();
    await refresh().catch(() => feedback('تعذر الاتصال بالسيرفر', true));
    socket();
  }
  boot();
})();
