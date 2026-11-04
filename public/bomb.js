/* TIME BOMB game page: intro + host control room. The server decides every rule;
   this page only renders state and sends authenticated admin requests. */
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('en-US').format(Number(n) || 0);
let state = null;
let offset = 0;
let token = sessionStorage.getItem('liveverse_admin') || '';
const canControl = () => !!token || !!window.SkySession?.hasControl();
let tab = 'alive';
let pendingAction = null;
let busy = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
function avatar(container, person) {
  const initial = Array.from(person?.name?.trim() || '؟')[0].toUpperCase();
  const key = JSON.stringify([person?.name, person?.avatar]);
  if (container.dataset.person === key) return;
  container.dataset.person = key;
  container.replaceChildren(document.createTextNode(initial));
  if (person?.avatar && /^https:\/\//.test(person.avatar)) {
    const img = document.createElement('img');
    img.alt = ''; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
    img.addEventListener('error', () => container.replaceChildren(document.createTextNode(initial)), { once: true });
    img.src = person.avatar; container.replaceChildren(img);
  }
}
function toast(message, error = false) {
  const box = $('toast'); box.textContent = message; box.classList.toggle('error', error); box.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.remove('show'), 4000);
}
function feedback(message, error = false) { const f = $('feedback'); f.textContent = message; f.classList.toggle('error', error); }

/* ---------- admin API (server-enforced) ---------- */
async function admin(action, body = {}) {
  if (!canControl()) throw Object.assign(new Error('يلزم رمز الإدارة'), { code: 401 });
  const headers = { 'Content-Type': 'application/json' }; if (token) Object.assign(headers, { Authorization: 'Bearer ' + token });
  const res = await fetch('/api/admin/' + action, { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify(body) });
  let data = {}; try { data = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error(data.error || 'تعذر تنفيذ الطلب'), { code: res.status });
  return data;
}
function openAuth(message = '') {
  $('authError').hidden = !message; $('authError').textContent = message;
  if (!$('authDialog').open) $('authDialog').showModal();
  $('authToken').focus();
}
/** Run a host action with one in-flight request at a time; prompts for the token when needed. */
async function run(button, action) {
  if (busy) return;
  if (!canControl()) { pendingAction = () => run(button, action); openAuth(); return; }
  busy = true; button?.classList.add('is-loading');
  try { await action(); }
  catch (error) {
    if (error.code === 401) { token = ''; sessionStorage.removeItem('liveverse_admin'); paintAuth(); pendingAction = () => run(button, action); openAuth('رمز الإدارة غير صحيح.'); }
    else { feedback(error.message, true); toast(error.message, true); }
  } finally { busy = false; button?.classList.remove('is-loading'); }
}
function paintAuth() {
  $('authLabel').textContent = token ? 'المشرف متصل' : canControl() ? 'غرفتك الخاصة' : 'دخول المشرف';
  $('authDot').classList.toggle('on', canControl());
  document.body.classList.toggle('is-admin', canControl());
}

/* ---------- actions ---------- */
const seconds = () => Number($('secondsSelect').value);
async function ensureBombMode() {
  if (state?.status?.active && state.status.mode !== 'bomb') throw new Error('توجد جولة من لعبة أخرى جارية. أنهِها من الاستوديو أولًا.');
  if (state?.status?.mode !== 'bomb' || (!state.status.active && state.bomb?.seconds !== seconds()))
    await admin('configure', { mode: 'bomb', title: 'القنبلة المؤقتة', bombSeconds: seconds() });
}
async function toggleRegistration() {
  const phase = state?.registration?.phase;
  if (phase === 'open') { await admin('registration-close'); feedback('أُغلق التسجيل. اضغط «بدء المباراة» عندما تكون جاهزًا.'); return; }
  if (state?.status?.active) throw new Error('لا يمكن فتح التسجيل أثناء المباراة.');
  await ensureBombMode();
  const keyword = $('keywordInput').value.trim() || 'انضم';
  await admin('registration-open', { keyword });
  feedback('التسجيل مفتوح — المشاهدون يكتبون «' + keyword + '» في شات البث.');
}
async function startMatch() {
  if (state?.status?.active) throw new Error('المباراة جارية بالفعل.');
  await ensureBombMode();
  await admin('start');
  feedback('انطلقت المباراة! القنبلة عند لاعب عشوائي.');
}

/* ---------- rendering ---------- */
function remainingMs(b) {
  if (!b) return 15000;
  if (b.phase === 'armed' && b.endsAt) return Math.max(0, b.endsAt - (Date.now() + offset));
  if (b.phase === 'paused') return b.remainingMs || 0;
  if (b.phase === 'idle') return b.seconds * 1000;
  return 0;
}
const phaseText = { idle: 'لا توجد مباراة', armed: 'جارية', paused: 'متوقفة مؤقتًا', exploded: 'انفجار — دورة جديدة قريبًا', finished: 'انتهت' };
function render(data) {
  if (!data?.status) return;
  state = data;
  offset = (Number(data.serverTime) || Date.now()) - Date.now();
  const reg = data.registration || {}, b = data.bomb, s = data.status;
  const bombMode = s.mode === 'bomb';
  const running = bombMode && s.active;
  $('registeredCount').textContent = fmt(reg.count || 0);
  $('ruleKeyword').textContent = reg.keyword || 'انضم';
  if (document.activeElement !== $('keywordInput') && reg.keyword) $('keywordInput').value = reg.keyword;
  $('phaseBadge').textContent = running ? 'المباراة جارية' : reg.phase === 'open' ? 'التسجيل مفتوح' : 'التسجيل مغلق';
  $('phaseBadge').classList.toggle('is-open', reg.phase === 'open' || running);
  $('registrationLabel').textContent = reg.phase === 'open' ? 'إغلاق التسجيل' : 'بدء التسجيل';
  $('registrationButton').disabled = !!s.active;
  $('startButton').disabled = !!s.active || (reg.count || 0) < 2;
  $('startLabel').textContent = running ? 'المباراة جارية' : b?.phase === 'finished' && bombMode ? 'مباراة جديدة' : 'بدء المباراة';
  if (b && !running && document.activeElement !== $('secondsSelect')) $('secondsSelect').value = String(b.seconds);
  $('ruleSeconds').textContent = fmt(b?.seconds || 15);
  if (b) { $('soundToggle').checked = !!b.sound; $('botsToggle').checked = !!b.autoBots; }

  // live card
  const show = bombMode && b && b.phase !== 'idle';
  $('matchState').textContent = show ? phaseText[b.phase] : 'لا توجد مباراة';
  $('matchState').dataset.phase = show ? b.phase : 'idle';
  $('liveHolder').textContent = show && b.holder ? b.holder.name + '  #' + b.holder.number : show && b.winner ? 'الفائز: ' + b.winner.name + ' #' + b.winner.number : '—';
  avatar($('liveHolderAvatar'), show ? (b.holder || b.winner) : null);
  $('liveTurn').textContent = fmt(show ? b.turn : 0);
  $('liveAlive').textContent = fmt(show ? b.alive.length : reg.count || 0);
  $('liveOut').textContent = fmt(show ? b.eliminated.length : 0);
  $('livePasses').textContent = fmt(show ? b.totalPasses : 0);
  $('pauseLabel').textContent = b?.phase === 'paused' ? 'استكمال' : 'إيقاف مؤقت';
  $('pauseButton').disabled = !running;
  $('endButton').disabled = !running;
  $('restartButton').disabled = !bombMode || !b || b.phase === 'idle' || (reg.count || 0) < 2;
  $('secondsSelect').disabled = running;
  // manual pass
  const select = $('passTarget');
  const options = running && b.phase === 'armed' ? b.alive.filter(p => p.number !== b.holder?.number) : [];
  const key = JSON.stringify(options.map(p => p.number));
  if (select.dataset.key !== key) {
    select.dataset.key = key;
    const keep = select.value;
    select.replaceChildren(el('option', '', options.length ? 'اختر لاعبًا' : '—'));
    select.firstChild.value = '';
    for (const p of options) { const o = el('option', '', '#' + p.number + ' — ' + p.name); o.value = String(p.number); select.append(o); }
    if (options.some(p => String(p.number) === keep)) select.value = keep;
  }
  $('passButton').disabled = !options.length;
  renderPlayers(data);
  renderTimeline(data);
}
function renderPlayers(data) {
  const b = data.bomb, inMatch = data.status.mode === 'bomb' && b && b.phase !== 'idle';
  const alive = inMatch ? b.alive : (data.registration?.participants || []).slice().reverse();
  const out = inMatch ? b.eliminated.slice().reverse() : [];
  $('tabAlive').textContent = fmt(inMatch ? b.alive.length : data.registration?.count || 0);
  $('tabOut').textContent = fmt(out.length);
  const list = tab === 'alive' ? alive : out;
  const box = $('playerList'); box.replaceChildren();
  if (!list.length) { box.append(el('li', 'bp-empty', tab === 'alive' ? 'سيظهر المسجلون هنا' : 'لا يوجد مُقصَون بعد')); return; }
  for (const p of list.slice(0, 120)) {
    const li = el('li', 'bp-player');
    if (inMatch && tab === 'alive' && b.holder?.number === p.number) li.classList.add('is-holder');
    if (tab === 'out') li.classList.add('is-out');
    const av = el('span', 'bp-mini-avatar'); avatar(av, p);
    li.append(av, el('bdi', 'bp-player-name', p.name), el('span', 'bp-player-num num', '#' + p.number));
    if (tab === 'out') li.append(el('small', 'bp-player-meta', 'الدورة ' + p.turn));
    else if (inMatch && b.holder?.number === p.number) li.append(el('small', 'bp-player-meta', 'يحمل القنبلة'));
    box.append(li);
  }
}
function renderTimeline(data) {
  const b = data.bomb, box = $('timeline');
  if (data.status.mode !== 'bomb' || !b || b.phase === 'idle') { box.replaceChildren(el('li', 'bp-empty', 'لا أحداث بعد')); return; }
  const events = [];
  for (const e of b.eliminated) events.push({ turn: e.turn, order: 1, kind: 'boom', text: 'انفجرت القنبلة عند ' + e.name, num: '#' + e.number });
  for (const p of b.passes) events.push({ turn: p.turn, order: 0, at: p.at, kind: 'pass', text: p.from.name + ' مرّرها إلى ' + p.to.name, num: '#' + p.from.number + ' ← #' + p.to.number, meta: (p.remainingMs / 1000).toFixed(1) + ' ث' });
  if (b.winner) events.push({ turn: b.turn + 1, order: 2, kind: 'win', text: 'الناجي الأخير: ' + b.winner.name, num: '#' + b.winner.number });
  events.sort((x, y) => y.turn - x.turn || y.order - x.order || (y.at || 0) - (x.at || 0));
  box.replaceChildren();
  for (const e of events.slice(0, 40)) {
    const li = el('li', 'bp-event is-' + e.kind);
    li.append(el('span', 'bp-event-dot'), el('span', 'bp-event-text', e.text), el('span', 'bp-event-num num', e.num));
    if (e.meta) li.append(el('small', 'bp-event-meta num', e.meta));
    box.append(li);
  }
}

/* ---------- animated hero timer / fuse ---------- */
function frame() {
  const b = state?.status?.mode === 'bomb' ? state.bomb : null;
  const live = b && ['armed', 'paused'].includes(b.phase);
  let ms, total;
  if (live) { ms = remainingMs(b); total = b.seconds * 1000; }
  else { total = 15000; ms = total - (Date.now() % total); } // idle demo loop
  const sec = Math.ceil(ms / 1000);
  $('demoTimer').textContent = '00:' + String(sec).padStart(2, '0');
  $('liveTimer').textContent = live ? String(sec) : b?.phase === 'exploded' ? '0' : String(b?.seconds || 15);
  document.body.dataset.heat = sec <= 3 ? 'critical' : sec <= 6 ? 'hot' : 'calm';
  const pct = Math.max(0, Math.min(1, ms / total));
  const fuse = $('bpFusePath');
  fuse.setAttribute('stroke-dasharray', (pct * 100).toFixed(2) + ' 100');
  const len = fuse.getTotalLength(), pt = fuse.getPointAtLength(len * pct);
  $('bpSpark').setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
  requestAnimationFrame(frame);
}

/* ---------- live data ---------- */
async function refresh() { await window.SkySession?.ready; paintAuth(); const res = await fetch(window.SkySession ? window.SkySession.withRoom('/api/state') : '/api/state', { cache: 'no-store' }); if (res.ok) render(await res.json()); }
function socket(retry = 0) {
  const ws = new WebSocket(window.SkySession ? window.SkySession.wsUrl() : (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws');
  ws.addEventListener('open', () => { retry = 0; });
  ws.addEventListener('message', ev => { try { const p = JSON.parse(ev.data); if (p.type === 'state') render(p.data); } catch {} });
  ws.addEventListener('close', () => setTimeout(() => socket(retry + 1), Math.min(10000, 1500 * (retry + 1))));
  ws.addEventListener('error', () => ws.close());
}

/* ---------- wiring ---------- */
$('registrationButton').addEventListener('click', e => run(e.currentTarget, toggleRegistration));
$('startButton').addEventListener('click', e => run(e.currentTarget, startMatch));
$('pauseButton').addEventListener('click', e => run(e.currentTarget, async () => { await admin(state?.bomb?.phase === 'paused' ? 'bomb-resume' : 'bomb-pause'); }));
$('endButton').addEventListener('click', e => run(e.currentTarget, async () => { await admin('bomb-end'); feedback('تم إنهاء المباراة يدويًا.'); }));
$('restartButton').addEventListener('click', e => run(e.currentTarget, async () => { await admin('bomb-restart'); feedback('بدأت مباراة جديدة بنفس اللاعبين المسجلين.'); }));
$('secondsSelect').addEventListener('change', e => run(null, async () => { await admin('bomb-settings', { seconds: seconds() }); toast('مدة الدورة: ' + seconds() + ' ثانية'); }));
$('soundToggle').addEventListener('change', e => run(null, async () => { await admin('bomb-settings', { sound: e.target.checked }); toast(e.target.checked ? 'الأصوات مفعّلة' : 'الأصوات مكتومة'); }));
$('botsToggle').addEventListener('change', e => run(null, async () => { await admin('bomb-settings', { autoBots: e.target.checked }); }));
document.querySelectorAll('[data-demo]').forEach(button => button.addEventListener('click', e => run(e.currentTarget, async () => {
  await ensureBombMode();
  const r = await admin('bomb-demo', { count: Number(button.dataset.demo) });
  toast('أُضيف ' + r.added + ' لاعبين تجريبيين');
})));
$('passButton').addEventListener('click', e => run(e.currentTarget, async () => {
  const target = Number($('passTarget').value);
  if (!target) throw new Error('اختر اللاعب المستلم أولًا');
  const b = state.bomb;
  await admin('bomb-pass', { target, turn: b.turn, match: b.matchId });
}));
document.querySelectorAll('.bp-tabs [data-tab]').forEach(button => button.addEventListener('click', () => {
  tab = button.dataset.tab;
  document.querySelectorAll('.bp-tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b === button)));
  if (state) renderPlayers(state);
}));
$('authAccount')?.addEventListener('click', () => { $('authDialog').close(); window.SkyAccount?.open({ onDone: () => { paintAuth(); refresh().catch(() => {}); if (pendingAction && canControl()) { const run = pendingAction; pendingAction = null; run(); } } }); });
$('authButton').addEventListener('click', () => token ? toast('صلاحية المشرف مفعّلة لهذه الجلسة') : window.SkySession?.hasControl() ? window.SkyAccount?.open({ onDone: () => location.reload() }) : openAuth());
$('authCancel').addEventListener('click', () => { pendingAction = null; $('authDialog').close(); });
$('authForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const value = $('authToken').value.trim();
  const res = await fetch('/api/admin/verify', { method: 'POST', headers: { Authorization: 'Bearer ' + value } });
  if (!res.ok) { $('authError').textContent = 'رمز الإدارة غير صحيح'; $('authError').hidden = false; return; }
  token = value; sessionStorage.setItem('liveverse_admin', value);
  $('authToken').value = ''; $('authDialog').close(); paintAuth(); toast('صلاحية المشرف مفعّلة');
  const next = pendingAction; pendingAction = null; next?.();
});
$('keywordInput').addEventListener('input', () => { $('ruleKeyword').textContent = $('keywordInput').value.trim() || 'انضم'; });

paintAuth();
refresh().catch(() => feedback('تعذر الاتصال بالسيرفر', true));
socket();
requestAnimationFrame(frame);
