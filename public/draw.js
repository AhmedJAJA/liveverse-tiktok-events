/* سبونج لايف — "ارسم وخمّن" client. Talks to /api/draw/* and polls room state.
   No innerHTML: every node is built with createElement/textContent. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const AVATAR_COLORS = ['#7dffc8', '#ffd36c', '#ff8fb3', '#7fe3ff', '#c9a7ff', '#ffb38a', '#a5f36c', '#f1f1f1'];
  const INK = ['#1b1b1f', '#ffffff', '#e5383b', '#ff9f1c', '#ffd60a', '#2ec4b6', '#3a86ff', '#8338ec', '#ff6fb5', '#6b4226'];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    sget(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } },
    sset(k, v) { try { v ? sessionStorage.setItem(k, JSON.stringify(v)) : sessionStorage.removeItem(k); } catch {} }
  };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  let profile = store.get('sky_draw_profile', { name: '', color: AVATAR_COLORS[0] });
  if (!AVATAR_COLORS.includes(profile.color)) profile.color = AVATAR_COLORS[0];
  let seat = store.sget('sky_draw_seat'); // { code, id, secret }
  let view = null, pollTimer = 0, tickTimer = 0, offset = 0, lastKey = '', online = true;
  let sound = store.get('sky_draw_sound', true);
  let mode = 'guest';

  /* ---------- identity ---------- */
  const initial = (n) => Array.from(String(n || '؟').trim())[0] || '؟';
  function paintIdentity() {
    const name = $('playerName').value.trim() || profile.name;
    for (const el of [$('avatarButton'), $('barAvatar')]) el.style.setProperty('--av', profile.color);
    $('avatarPreview').textContent = initial(name);
    $('barAvatar').textContent = initial(view?.me?.name || name);
    $('barName').textContent = view?.me?.name || name || 'زائر';
  }
  $('playerName').value = profile.name || '';
  $('playerName').addEventListener('input', () => { profile.name = $('playerName').value.trim(); store.set('sky_draw_profile', profile); paintIdentity(); });
  $('avatarButton').addEventListener('click', () => {
    profile.color = AVATAR_COLORS[(AVATAR_COLORS.indexOf(profile.color) + 1) % AVATAR_COLORS.length];
    store.set('sky_draw_profile', profile); paintIdentity(); beep(660, .06);
  });
  function setTab(next) {
    mode = next;
    $('tabGuest').setAttribute('aria-selected', String(next === 'guest'));
    $('tabAccount').setAttribute('aria-selected', String(next === 'account'));
    const me = window.SkySession?.me() || {};
    if (next === 'account') {
      if (me.user) {
        $('playerName').value = me.user.displayName || me.user.username || '';
        $('identHint').textContent = 'تدخل باسم حسابك. يمكنك إنشاء غرفة مجانًا.';
      } else {
        $('identHint').textContent = 'سجّل الدخول لتلعب باسم حسابك.';
        window.SkyAccount?.open({ tab: 'login', onDone: () => setTab('account') });
      }
    } else $('identHint').textContent = 'الضيوف يمكنهم الانضمام لأي غرفة تسمح بالضيوف.';
    profile.name = $('playerName').value.trim(); paintIdentity();
  }
  $('tabGuest').addEventListener('click', () => setTab('guest'));
  $('tabAccount').addEventListener('click', () => setTab('account'));

  /* ---------- sound ---------- */
  let ctx = null;
  function beep(freq = 520, dur = .08) {
    if (!sound) return;
    try {
      ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq; o.type = 'triangle';
      g.gain.setValueAtTime(.12, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + dur);
      o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur);
    } catch {}
  }
  function paintSound() {
    $('soundToggle').setAttribute('aria-pressed', String(sound));
    $('soundToggle').querySelector('use').setAttribute('href', '/icons.svg#' + (sound ? 'i-volume' : 'i-volume-off'));
  }
  $('soundToggle').addEventListener('click', () => { sound = !sound; store.set('sky_draw_sound', sound); paintSound(); beep(); });

  /* ---------- how-to slides ---------- */
  const slides = [...$('howSlides').children];
  let slide = 0, slideTimer = 0;
  const dots = slides.map((_, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', 'الشريحة ' + (i + 1));
    b.addEventListener('click', () => go(i)); return b;
  });
  $('howDots').append(...dots);
  function go(i) {
    slide = (i + slides.length) % slides.length;
    slides.forEach((s, j) => s.classList.toggle('is-on', j === slide));
    dots.forEach((d, j) => d.setAttribute('aria-current', String(j === slide)));
    clearTimeout(slideTimer);
    if (!reduced()) slideTimer = setTimeout(() => go(slide + 1), 6000);
  }
  // RTL: "previous" sits on the right, so its chevron points right.
  $('howPrev').addEventListener('click', () => go(slide - 1));
  $('howNext').addEventListener('click', () => go(slide + 1));
  go(0);

  /* ---------- code boxes ---------- */
  const boxes = [...document.querySelectorAll('.dr-code-box')];
  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      const chars = box.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (chars.length > 1) { fillCode(chars, i); return; }
      box.value = chars;
      if (chars && i < boxes.length - 1) boxes[i + 1].focus();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) { boxes[i - 1].focus(); boxes[i - 1].value = ''; e.preventDefault(); }
    });
    box.addEventListener('paste', (e) => { e.preventDefault(); fillCode((e.clipboardData?.getData('text') || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), 0); });
  });
  function fillCode(chars, from) {
    for (let j = from, k = 0; j < boxes.length && k < chars.length; j++, k++) boxes[j].value = chars[k];
    boxes[Math.min(boxes.length - 1, from + chars.length)].focus();
  }
  const code = () => boxes.map((b) => b.value).join('');
  const preset = new URLSearchParams(location.search).get('code');
  if (preset) fillCode(preset.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5), 0);

  /* ---------- api ---------- */
  async function api(action, body, { method = 'POST' } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (seat) { headers['X-Draw-Player'] = seat.id; headers['X-Draw-Secret'] = seat.secret; }
    const owner = window.SkySession?.ownerToken?.();
    if (owner && action === 'create') Object.assign(headers, { Authorization: 'Bearer ' + owner });
    const url = '/api/draw/' + action + (method === 'GET' && seat ? '?code=' + encodeURIComponent(seat.code) : '');
    const res = await fetch(url, { method, headers, credentials: 'same-origin', cache: 'no-store', ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}) });
    let data = {}; try { data = await res.json(); } catch {}
    if (!res.ok) { const e = new Error(data.error || 'تعذر تنفيذ الطلب'); e.status = res.status; throw e; }
    return data;
  }
  const showError = (el, msg) => { el.textContent = msg || ''; el.hidden = !msg; };
  function needName() {
    const name = $('playerName').value.trim();
    if (name.length < 2) { showError($('joinError'), 'اكتب اسمك أولًا (حرفان على الأقل)'); $('playerName').focus(); return null; }
    profile.name = name; store.set('sky_draw_profile', profile); return name;
  }

  $('joinForm').addEventListener('submit', async (e) => {
    e.preventDefault(); showError($('joinError'), '');
    const name = needName(); if (!name) return;
    if (code().length !== 5) { showError($('joinError'), 'رمز الغرفة من 5 خانات'); boxes[code().length]?.focus(); return; }
    $('joinButton').disabled = true;
    try { enter(await api('join', { code: code(), name, color: profile.color })); }
    catch (err) { showError($('joinError'), err.message); beep(200, .15); }
    finally { $('joinButton').disabled = false; }
  });
  $('createButton').addEventListener('click', async () => {
    showError($('joinError'), '');
    const name = needName(); if (!name) return;
    $('createButton').disabled = true;
    try { enter(await api('create', { name, color: profile.color })); }
    catch (err) {
      showError($('joinError'), err.message);
      if (err.status === 403 && !window.SkySession?.me()?.user && window.SkyAccount) window.SkyAccount.open({ tab: 'login', onDone: () => $('createButton').click() });
    } finally { $('createButton').disabled = false; }
  });

  function enter(result) {
    seat = { code: result.code, id: result.player.id, secret: result.player.secret };
    store.sset('sky_draw_seat', seat);
    history.replaceState(null, '', '/draw?code=' + seat.code);
    beep(780, .1);
    poll();
  }
  function exitRoom(message) {
    seat = null; view = null; store.sset('sky_draw_seat', null);
    clearTimeout(pollTimer); clearInterval(tickTimer);
    $('gameView').hidden = true; $('entryView').hidden = false;
    history.replaceState(null, '', '/draw');
    showError($('joinError'), message || '');
    paintIdentity();
  }

  /* ---------- polling ---------- */
  async function poll() {
    clearTimeout(pollTimer);
    if (!seat) return;
    try {
      const next = await api('state', null, { method: 'GET' });
      setOnline(true);
      offset = next.serverTime - Date.now();
      render(next);
    } catch (err) {
      if (err.status === 400) { exitRoom(err.message); return; }
      setOnline(false);
    }
    const busy = view?.phase === 'playing';
    pollTimer = setTimeout(poll, document.hidden ? 4000 : busy ? 1200 : 1800);
  }
  function setOnline(ok) {
    if (ok === online) return; online = ok;
    $('connState').classList.toggle('is-off', !ok);
    $('connState').querySelector('span').textContent = ok ? 'متصل' : 'انقطع الاتصال…';
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && seat) poll(); });

  /* ---------- render ---------- */
  function avatar(p) {
    const s = document.createElement('span'); s.className = 'dr-av'; s.style.setProperty('--av', p.color); s.textContent = initial(p.name); return s;
  }
  function render(v) {
    const prev = view; view = v;
    $('entryView').hidden = true; $('gameView').hidden = false;
    $('roomCode').textContent = v.code; $('lobbyCode').textContent = v.code;
    paintIdentity();
    // roster
    $('rosterCount').textContent = '(' + v.players.length + '/8)';
    $('roster').replaceChildren(...v.players.map((p) => {
      const li = document.createElement('li'); li.classList.toggle('is-done', !!p.done);
      const name = document.createElement('span'); name.textContent = p.name + (p.id === v.me.id ? ' (أنت)' : '');
      const tag = document.createElement('small'); tag.textContent = p.host ? 'المضيف' : v.phase === 'playing' ? (p.done ? 'أرسل ✓' : 'يعمل…') : '';
      li.append(avatar(p), name, tag); return li;
    }));
    $('leaveButton').hidden = v.phase === 'playing';
    // header
    $('stepInfo').textContent = v.phase === 'playing' ? 'الخطوة ' + (v.step + 1) + ' من ' + v.steps : v.phase === 'album' ? 'الألبوم' : 'غرفة الانتظار';
    clearInterval(tickTimer);
    $('timer').hidden = !(v.phase === 'playing' && v.endsAt);
    if (!$('timer').hidden) { tickTimer = setInterval(paintTimer, 250); paintTimer(); }

    const key = v.phase + ':' + v.round + ':' + v.step + ':' + (v.task?.done ? 1 : 0);
    const changed = key !== lastKey; lastKey = key;
    for (const id of ['lobbyPane', 'textPane', 'drawPane', 'waitPane', 'albumPane']) $(id).hidden = true;
    showError($('gameError'), '');

    if (v.phase === 'lobby') {
      $('lobbyPane').hidden = false;
      $('startButton').hidden = !v.host; $('guestsWrap').hidden = !v.host;
      $('allowGuests').checked = !!v.allowGuests;
      $('startButton').disabled = v.players.length < 2;
      $('lobbyHint').textContent = v.host ? (v.players.length < 2 ? 'انتظر انضمام لاعب واحد على الأقل.' : 'الجميع جاهز؟ اضغط ابدأ.') : 'المضيف سيبدأ اللعبة قريبًا.';
    } else if (v.phase === 'playing') {
      const t = v.task;
      if (!t) { $('waitPane').hidden = false; $('waitHint').textContent = 'انضممت بعد بدء الجولة، ستشارك في الجولة القادمة.'; }
      else if (t.done) { $('waitPane').hidden = false; $('waitHint').textContent = 'سننتقل للخطوة التالية عندما يرسل الجميع أو ينتهي الوقت.'; }
      else if (t.kind === 'text') { $('textPane').hidden = false; if (changed) setupText(t); }
      else { $('drawPane').hidden = false; if (changed) setupDraw(t); }
      if (changed && prev?.step !== v.step) beep(880, .09);
    } else if (v.phase === 'album') {
      $('albumPane').hidden = false; renderAlbum(v);
      if (changed) beep(990, .12);
    }
  }
  function paintTimer() {
    if (!view?.endsAt) return;
    const left = Math.max(0, Math.ceil((view.endsAt - (Date.now() + offset)) / 1000));
    $('timerText').textContent = left;
    $('timer').classList.toggle('is-low', left <= 10);
  }

  /* text: first sentence or describing a drawing */
  function setupText(t) {
    const describe = !!t.prompt;
    $('textTitle').textContent = describe ? 'ماذا ترى في هذه الرسمة؟' : 'اكتب جملة يرسمها غيرك';
    $('describeFigure').hidden = !describe;
    if (describe) {
      if (t.prompt.data) { $('describeImage').src = t.prompt.data; $('describeImage').alt = 'رسمة لاعب آخر'; }
      else { $('describeImage').removeAttribute('src'); $('describeImage').alt = 'لم يرسم اللاعب شيئًا — اخترع وصفًا!'; }
    }
    $('textHint').textContent = describe ? 'صف الرسمة بجملة قصيرة، دون أن ترى الجملة الأصلية.' : 'مثال: قطة تقود دراجة فوق القمر';
    $('textInput').value = ''; $('textInput').placeholder = describe ? 'أظن أنها…' : 'اكتب جملتك هنا';
    $('textInput').focus({ preventScroll: true });
  }
  $('textPane').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = $('textInput').value.trim();
    if (data.length < 2) { showError($('gameError'), 'اكتب حرفين على الأقل'); return; }
    $('textSubmit').disabled = true;
    try { await api('submit', { code: seat.code, data }); beep(700); poll(); }
    catch (err) { showError($('gameError'), err.message); }
    finally { $('textSubmit').disabled = false; }
  });

  /* ---------- canvas ---------- */
  const canvas = $('canvas'), g = canvas.getContext('2d');
  let strokes = [], current = null, ink = INK[0], size = 9;
  $('palette').append(...INK.map((c, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.style.setProperty('--sw', c);
    b.setAttribute('aria-label', 'لون ' + (i + 1)); b.setAttribute('aria-pressed', String(i === 0));
    b.addEventListener('click', () => { ink = c; for (const x of $('palette').children) x.setAttribute('aria-pressed', String(x === b)); });
    return b;
  }));
  for (const b of $('sizes').children) b.addEventListener('click', () => {
    size = Number(b.dataset.size); for (const x of $('sizes').children) x.setAttribute('aria-pressed', String(x === b));
  });
  function redraw() {
    g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const s of strokes) {
      g.strokeStyle = s.c; g.fillStyle = s.c; g.lineWidth = s.w;
      if (s.p.length === 1) { g.beginPath(); g.arc(s.p[0][0], s.p[0][1], s.w / 2, 0, Math.PI * 2); g.fill(); continue; }
      g.beginPath(); g.moveTo(s.p[0][0], s.p[0][1]);
      for (let i = 1; i < s.p.length; i++) g.lineTo(s.p[i][0], s.p[i][1]);
      g.stroke();
    }
  }
  const point = (e) => { const r = canvas.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * canvas.width / r.width), Math.round((e.clientY - r.top) * canvas.height / r.height)]; };
  canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); current = { c: ink, w: size, p: [point(e)] }; strokes.push(current); redraw(); });
  canvas.addEventListener('pointermove', (e) => { if (!current) return; current.p.push(point(e)); redraw(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(ev, () => { current = null; });
  $('undoButton').addEventListener('click', () => { strokes.pop(); redraw(); });
  $('clearButton').addEventListener('click', () => { if (strokes.length) { strokes = []; redraw(); } });
  function setupDraw(t) {
    strokes = []; redraw();
    $('drawPrompt').textContent = t.prompt?.data || 'ارسم أي شيء يخطر ببالك';
  }
  // Keep the upload under the server's limit by shrinking the image if needed.
  function exportPng() {
    let url = canvas.toDataURL('image/png');
    for (const scale of [.75, .5, .35]) {
      if (url.length <= 118000) break;
      const c = document.createElement('canvas'); c.width = Math.round(canvas.width * scale); c.height = Math.round(canvas.height * scale);
      c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
      url = c.toDataURL('image/png');
    }
    return url;
  }
  $('drawSubmit').addEventListener('click', async () => {
    if (!strokes.length) { showError($('gameError'), 'ارسم شيئًا قبل الإرسال'); return; }
    $('drawSubmit').disabled = true;
    try { await api('submit', { code: seat.code, data: exportPng() }); beep(700); poll(); }
    catch (err) { showError($('gameError'), err.message); }
    finally { $('drawSubmit').disabled = false; }
  });

  /* ---------- album ---------- */
  function renderAlbum(v) {
    const a = v.album;
    $('albumOwner').textContent = a.owner;
    $('albumIndex').textContent = '(' + (a.index + 1) + ' من ' + a.total + ')';
    $('albumList').replaceChildren(...a.entries.map((e) => {
      const li = document.createElement('li');
      const bubble = document.createElement('div'); bubble.className = 'dr-bubble'; bubble.classList.toggle('is-missed', !!e.missed);
      const by = document.createElement('small'); by.textContent = e.by + (e.kind === 'drawing' ? ' رسم:' : ' كتب:');
      bubble.append(by);
      if (e.kind === 'drawing') {
        if (e.data) { const img = document.createElement('img'); img.src = e.data; img.alt = 'رسمة ' + e.by; img.loading = 'lazy'; bubble.append(img); }
        else bubble.append('(لم يرسم شيئًا)');
      } else bubble.append(e.data);
      li.append(avatar({ name: e.by, color: e.color }), bubble);
      return li;
    }));
    $('albumHost').hidden = !v.host;
    const last = a.index === a.total - 1 && a.entries.length >= v.steps;
    $('albumNext').disabled = last;
    $('albumPrev').disabled = a.index === 0 && a.step === 0;
    $('albumHint').textContent = v.host ? 'أنت تتحكم بعرض الألبوم للجميع.' : 'المضيف يعرض القصص خطوة بخطوة.';
  }
  for (const [id, action] of [['albumNext', 'next'], ['albumPrev', 'prev'], ['albumAll', 'all']])
    $(id).addEventListener('click', async () => { try { await api('album', { code: seat.code, action }); poll(); } catch (err) { showError($('gameError'), err.message); } });
  $('restartButton').addEventListener('click', async () => { try { await api('restart', { code: seat.code }); poll(); } catch (err) { showError($('gameError'), err.message); } });
  $('startButton').addEventListener('click', async () => {
    $('startButton').disabled = true;
    try { await api('start', { code: seat.code }); poll(); } catch (err) { showError($('gameError'), err.message); $('startButton').disabled = false; }
  });
  $('allowGuests').addEventListener('change', async () => { try { await api('guests', { code: seat.code, allow: $('allowGuests').checked }); } catch (err) { showError($('gameError'), err.message); } });
  $('leaveButton').addEventListener('click', async () => { try { await api('leave', { code: seat.code }); } catch {} exitRoom(); });
  $('roomCode').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.origin + '/draw?code=' + seat.code); $('stepInfo').textContent = 'نُسخ رابط الغرفة ✓'; } catch {}
  });

  /* ---------- boot ---------- */
  paintSound(); paintIdentity(); redraw();
  window.SkySession?.ready.then(() => {
    const me = window.SkySession.me();
    if (me?.user) { if (!profile.name) $('playerName').value = me.user.displayName || ''; setTab('account'); }
    paintIdentity();
  });
  if (seat) poll();
})();
