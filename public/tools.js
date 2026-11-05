/* سبونج لايف — stream tools control page. Commands go to the server; the overlay links show the result. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const session = () => window.SkySession;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const say = (m, err) => { $('toolFeedback').textContent = m || ''; $('toolFeedback').classList.toggle('is-error', !!err); };
  let state = null, offset = 0, ws = null, retry = 0;

  async function tool(action, extra = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const t = session()?.ownerToken(); if (t) headers.Authorization = 'Bearer ' + t;
    const res = await fetch('/api/admin/tools', { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify({ action, ...extra }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'تعذر تنفيذ الأمر');
    paint({ tools: data.tools });
    return data;
  }
  const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  function avatar(p) {
    const a = el('span', 'tl-ava'); a.append(el('span', '', Array.from(p.name || '؟')[0]));
    if (p.avatar && /^https:\/\//.test(p.avatar)) { const i = el('img'); i.alt = ''; i.referrerPolicy = 'no-referrer'; i.loading = 'lazy'; i.addEventListener('error', () => i.remove(), { once: true }); i.src = p.avatar; a.append(i); }
    return a;
  }
  function chip(p, extra) { const li = el('li', 'tl-chip'); li.append(avatar(p), el('bdi', '', p.name)); if (extra) li.append(el('small', 'num', extra)); return li; }
  function paint(view) {
    if (view.connection) $('linkWarn').hidden = view.connection.state === 'connected';
    if (!view.tools) return;
    state = view.tools; offset = (state.serverNow || Date.now()) - Date.now();
    const d = state.draw, w = state.wall;
    $('drawState').textContent = d.open ? 'مفتوح — اكتب «' + d.keyword + '»' : d.winner ? 'تم السحب' : 'مغلق';
    $('drawState').classList.toggle('is-on', d.open);
    $('drawCount').textContent = String(d.count);
    $('drawRecent').replaceChildren(...d.recent.map((p) => chip(p)));
    $('drawWinner').hidden = !d.winner; $('drawWinner').textContent = d.winner ? '🏆 الفائز: ' + d.winner.name : '';
    $('wallState').textContent = w.on ? 'يعمل' : 'متوقف'; $('wallState').classList.toggle('is-on', w.on);
    $('wallToggle').textContent = w.on ? 'إيقاف' : 'تشغيل';
    $('wallList').replaceChildren(...w.chatters.map((p) => chip(p, p.count + ' رسالة')));
    tick();
  }
  function tick() {
    if (!state) return;
    const c = state.countdown, now = Date.now() + offset;
    const left = c.endsAt ? c.endsAt - now : c.left;
    $('cdPreview').textContent = left != null ? fmt(left) : fmt(Number($('cdSeconds').value) * 1000);
    $('cdState').textContent = c.endsAt && left > 0 ? 'يعمل' : c.left ? 'متوقف مؤقتًا' : c.endsAt ? 'انتهى' : 'متوقف';
    $('cdState').classList.toggle('is-on', !!(c.endsAt && left > 0));
  }
  setInterval(tick, 250);
  $('cdSeconds').addEventListener('change', tick);

  document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', async () => {
    const action = b.dataset.tool, extra = {};
    if (action === 'countdown-start') Object.assign(extra, { seconds: Number($('cdSeconds').value), label: $('cdLabel').value });
    if (action === 'draw-open') extra.keyword = $('drawKeyword').value;
    b.disabled = true;
    try { await tool(action, extra); say(action === 'draw-pick' ? 'تم اختيار فائز.' : 'تم.'); } catch (e) { say(e.message, true); } finally { b.disabled = false; }
  }));
  $('wallToggle').addEventListener('click', () => tool('wall', { on: !state?.wall.on }).catch((e) => say(e.message, true)));
  $('wallClear').addEventListener('click', () => tool('wall', { on: state?.wall.on !== false, clear: true }).catch((e) => say(e.message, true)));

  function links() {
    const room = session().room();
    for (const t of ['countdown', 'draw', 'wall']) {
      $('link-' + t).textContent = location.origin + '/tool?tool=' + t + (room && room !== 'main' ? '&room=' + encodeURIComponent(room) : '');
    }
  }
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const text = $('link-' + b.dataset.copy).textContent;
    try { await navigator.clipboard.writeText(text); b.textContent = 'تم النسخ ✓'; setTimeout(() => (b.textContent = 'نسخ'), 1500); }
    catch { const r = document.createRange(); r.selectNodeContents($('link-' + b.dataset.copy)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); say('حدد الرابط وانسخه يدويًا'); }
  }));

  function connect() {
    try { ws?.close(); } catch {}
    ws = new WebSocket(session().wsUrl());
    ws.addEventListener('message', (e) => { try { const m = JSON.parse(e.data); if (m.type === 'state') paint(m.data); } catch {} });
    ws.addEventListener('open', () => { retry = 0; });
    ws.addEventListener('close', () => setTimeout(connect, Math.min(10_000, 1000 * 2 ** retry++)));
  }
  session().ready.then(() => { links(); connect(); });
})();
