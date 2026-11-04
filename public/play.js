/* SKY LIVE — game join page (/play?mode=…).
   Viewers join from the stream chat with the join word; the room's host sees the controls.
   Every node is built with createElement/textContent (no HTML strings). */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const MODES = ['quiz', 'bomb', 'bowling', 'glass', 'guess', 'race', 'truefalse', 'higherlower', 'redlight', 'wheel', 'minority', 'rps'];
  const mode = MODES.includes(params.get('mode')) ? params.get('mode') : 'quiz';
  const NO_TIMER = ['race', 'wheel'];
  let game = { mode, title: '', minPlayers: 1, rules: [], setup: '/event?mode=' + mode };
  let state = null, seen = new Set(), firstPaint = true, busy = false, retries = 0, prepared = false;

  const session = () => window.SkySession;
  const ownerToken = () => session()?.ownerToken?.() || '';
  /** Host = whoever controls this room; an explicit ?room= of someone else is a read-only view. */
  function isHost() {
    const s = session(); if (!s) return false;
    if (!s.hasControl()) return false;
    const explicit = s.explicitRoom();
    if (!explicit) return true;
    const own = ownerToken() ? 'main' : (s.me().room || '');
    return explicit === own;
  }
  const roomPath = (p) => session() ? session().withRoom(p) : p;
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const initial = (n) => Array.from(String(n || '؟').replace(/^@/, '').trim())[0] || '؟';
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
    document.title = (game.title || 'انضم للعبة') + ' | SKY LIVE';
    document.body.dataset.category = game.category || 'smart';
    $('gameTitle').textContent = game.title || '';
    $('gameCategory').textContent = game.categoryLabel || '';
    $('gameSummary').textContent = game.summary || '';
    $('gameRules').replaceChildren(...(game.rules || []).map((r) => { const li = document.createElement('li'); li.textContent = r; return li; }));
    for (const id of ['gameCover', 'backdropCover']) $(id).src = '/covers/' + mode + '.svg';
    $('setupLink').href = game.setup || '/studio';
    $('guessFields').hidden = mode !== 'guess';
    $('advanceButton').hidden = NO_TIMER.includes(mode);
    $('drawButton').hidden = mode !== 'wheel';
  }

  /* ---------- roster ---------- */
  function avatarNode(p) {
    const box = document.createElement('span'); box.className = 'pl-av';
    const letter = document.createElement('span'); letter.textContent = initial(p.name); box.append(letter);
    if (p.avatar && /^https:\/\//.test(p.avatar)) {
      const img = document.createElement('img'); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.decoding = 'async'; img.src = p.avatar;
      img.addEventListener('error', () => img.remove(), { once: true });
      box.append(img);
    }
    return box;
  }
  function renderRoster(list) {
    const ol = $('players');
    const items = [...list].reverse(); // newest first so arrivals are visible
    const nodes = items.map((p) => {
      const key = p.number + '\u0000' + p.name;
      const li = document.createElement('li'); li.className = 'pl-player';
      if (!seen.has(key) && !firstPaint) li.classList.add('is-new');
      if (p.host) li.classList.add('is-host');
      seen.add(key);
      const no = document.createElement('b'); no.className = 'pl-no'; no.textContent = '#' + p.number;
      const name = document.createElement('span'); name.className = 'pl-name'; name.textContent = p.name;
      li.append(avatarNode(p), name, no);
      if (p.host) { const t = document.createElement('small'); t.className = 'pl-tag'; t.textContent = 'المشرف'; li.append(t); }
      else if (p.bot) { const t = document.createElement('small'); t.className = 'pl-tag is-bot'; t.textContent = 'تجريبي'; li.append(t); }
      return li;
    });
    ol.replaceChildren(...nodes);
    $('rosterEmpty').hidden = list.length > 0;
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
    state = s;
    const reg = s.registration || {};
    const host = isHost();
    const view = viewFor(s);
    document.body.dataset.view = view;
    const word = reg.keyword || 'انضم';
    for (const el of document.querySelectorAll('#joinWord,.pl-word-sm,.pl-word-inline')) el.textContent = word;
    const count = Number(s.playerCount || 0);
    $('playerCount').textContent = num(count);
    $('playerCountLabel').textContent = count === 1 ? 'لاعب منضم' : 'لاعبين منضمين';
    renderRoster(Array.isArray(s.roster) ? s.roster : []);

    const need = Math.max(0, (reg.minPlayers || game.minPlayers || 1) - count);
    $('needNote').textContent = view === 'join' ? (need ? 'ينقص ' + num(need) + (need === 1 ? ' لاعب' : ' لاعبين') + ' للبدء' : 'العدد مكتمل — جاهزون للبدء') : '';
    $('needNote').classList.toggle('is-ready', !need);

    // Main call text.
    const sub = view === 'busy' ? 'تُلعب الآن «' + (s.status.title || '') + '» — انتظر انتهاءها'
      : view === 'done' ? 'انتهت الجولة — بانتظار الجولة التالية'
      : reg.phase === 'open' ? (count ? 'بانتظار انضمام المزيد من اللاعبين' : 'بانتظار انضمام اللاعبين')
      : 'بانتظار انضمام اللاعبين';
    $('callSubText').textContent = sub;
    $('joinCall').hidden = view === 'live';

    // Live game.
    const showFrame = view === 'live' || view === 'done';
    $('liveView').hidden = !showFrame;
    if (showFrame) {
      const src = roomPath('/overlay') + (roomPath('/overlay').includes('?') ? '&' : '?') + 'embedded=1';
      if ($('liveFrame').dataset.src !== src) { $('liveFrame').dataset.src = src; $('liveFrame').src = src; }
      $('liveNotice').textContent = s.status.notice || '';
      document.querySelector('.pl-live-tag').lastChild.textContent = view === 'live' ? 'اللعبة جارية' : 'النتائج';
    }
    const waiting = Number(reg.waitingCount || 0);
    $('lateNote').hidden = !(view === 'live' || view === 'done');
    $('lateCount').textContent = waiting ? ' • ' + num(waiting) + ' بالانتظار' : '';

    // Host controls.
    $('adminBar').hidden = !host;
    $('overlayLink').hidden = !host; $('setupLink').hidden = !host;
    $('overlayLink').href = roomPath('/overlay');
    if (host) {
      $('adminJoin').hidden = view !== 'join';
      $('adminLive').hidden = !(view === 'live' || view === 'busy');
      $('adminDone').hidden = view !== 'done';
      $('drawButton').hidden = !(mode === 'wheel' && view === 'live');
      $('advanceButton').hidden = view !== 'live' || NO_TIMER.includes(mode);
      const seated = !!reg.hostSeated;
      $('hostSeatButton').setAttribute('aria-pressed', String(seated));
      $('hostSeatLabel').textContent = seated ? 'إلغاء مشاركتي' : 'شارك كلاعب';
      $('startButton').disabled = busy || need > 0 || reg.phase !== 'open';
      $('startLabel').textContent = need > 0 ? 'ابدأ اللعبة (ينقص ' + num(need) + ')' : 'ابدأ اللعبة';
      $('demoButton').hidden = s.connection?.state === 'connected';
    }
    if (host && view === 'join' && reg.phase !== 'open' && !busy && prepared) prepare();
  }

  /* ---------- host actions ---------- */
  async function run(button, fn) {
    if (busy) return; busy = true; if (button) button.disabled = true;
    try { await fn(); feedback(''); }
    catch (err) { feedback(err.message, true); }
    finally { busy = false; if (button) button.disabled = false; if (state) render(state); }
  }
  let preparing = false;
  async function prepare() {
    if (preparing) return;
    prepared = true; preparing = true;
    try { await admin('prepare', { mode }); }
    catch (err) { feedback(err.message, true); }
    finally { preparing = false; }
  }
  $('hostSeatButton').addEventListener('click', (e) => run(e.currentTarget, async () => {
    if (state?.registration?.hostSeated) { await admin('host-unseat'); feedback('ألغيت مشاركتك — ما زلت تدير اللعبة.'); }
    else { await admin('host-seat'); feedback('أنت الآن ضمن اللاعبين، وتطبق عليك قواعد اللعبة نفسها.'); }
  }));
  $('demoButton').addEventListener('click', (e) => run(e.currentTarget, async () => {
    const r = await admin('demo-players', { count: Math.max(3, (state?.registration?.minPlayers || 1)) });
    await admin('simulation', { autoplay: true }).catch(() => {});
    feedback('أُضيف ' + num(Array.isArray(r.added) ? r.added.length : r.added) + ' لاعبين تجريبيين يلعبون تلقائيًا.');
  }));
  $('startButton').addEventListener('click', (e) => run(e.currentTarget, async () => {
    if (mode === 'guess') {
      const prompt = $('guessPrompt').value.trim(), answer = $('guessAnswer').value.trim();
      if (!prompt || !answer) { $(prompt ? 'guessAnswer' : 'guessPrompt').focus(); throw new Error('اكتب التلميح والإجابة السرية قبل البدء'); }
      await admin('configure', { mode, prompt, answer });
    }
    await admin('start');
    if (mode === 'wheel') feedback('دخل كل المشاركين السحب — اضغط «اسحب الفائز».');
  }));
  $('drawButton').addEventListener('click', (e) => run(e.currentTarget, async () => { const r = await admin('draw'); feedback('🏆 الفائز: ' + r.result.name); }));
  $('advanceButton').addEventListener('click', (e) => run(e.currentTarget, () => admin('advance')));
  $('stopButton').addEventListener('click', (e) => run(e.currentTarget, async () => {
    await admin('stop');
    if (state?.status?.mode !== mode) await admin('prepare', { mode });
  }));
  $('againButton').addEventListener('click', (e) => run(e.currentTarget, () => admin('prepare', { mode })));

  /* ---------- data ---------- */
  async function refresh() {
    const res = await fetch(roomPath('/api/state'), { cache: 'no-store' });
    if (res.ok) render(await res.json());
  }
  function socket() {
    let ws;
    try { ws = new WebSocket(session() ? session().wsUrl() : (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws'); } catch { return; }
    ws.addEventListener('open', () => { retries = 0; });
    ws.addEventListener('message', (ev) => { try { const p = JSON.parse(ev.data); if (p.type === 'state') render(p.data); } catch {} });
    ws.addEventListener('close', () => setTimeout(socket, Math.min(15000, 1500 * (++retries))));
    ws.addEventListener('error', () => ws.close());
  }
  function paintRoom() {
    const s = session(), badge = $('roomBadge');
    if (!s || !isHost()) { badge.hidden = true; return; }
    const me = s.me();
    badge.hidden = false;
    badge.textContent = ownerToken() ? 'غرفة المالك' : me.user ? 'غرفتك' : 'غرفة تجريبية';
    badge.title = ownerToken() || me.live ? 'رسائل شات بثك المربوط تصل هنا مباشرة' : 'لربط بث حقيقي تحتاج حسابًا مشتركًا — جرّب الآن باللاعبين التجريبيين';
  }

  async function boot() {
    try {
      const site = await (await fetch('/api/site', { cache: 'no-store' })).json();
      const found = (site.games || []).find((g) => g.mode === mode);
      if (found) game = found;
    } catch {}
    paintGame();
    const s = session();
    if (s) {
      await s.ready;
      // No login wall: a streamer without a room gets a private trial room silently.
      if (!s.hasControl() && !s.explicitRoom()) {
        try { await fetch('/api/account/guest', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await s.refresh(); } catch {}
      }
    }
    paintRoom();
    if (isHost()) await prepare();
    await refresh().catch(() => feedback('تعذر الاتصال بالسيرفر', true));
    socket();
  }
  boot();
})();
