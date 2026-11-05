/* سبونج لايف — OBS overlay for one stream tool (?tool=countdown|draw|wall). Read-only; all text via textContent. */
(() => {
  'use strict';
  const stage = document.getElementById('stage');
  const kind = ['countdown', 'draw', 'wall'].includes(new URLSearchParams(location.search).get('tool')) ? new URLSearchParams(location.search).get('tool') : 'countdown';
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  let tools = null, offset = 0, lastKey = '', retry = 0;
  const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); const m = Math.floor(s / 60); return (m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s % 60).padStart(2, '0'); };
  function ava(p) { const a = el('span', 'ov-ava'); a.append(el('span', '', Array.from(p.name || '؟')[0])); if (p.avatar && /^https:\/\//.test(p.avatar)) { const i = el('img'); i.alt = ''; i.referrerPolicy = 'no-referrer'; i.addEventListener('error', () => i.remove(), { once: true }); i.src = p.avatar; a.append(i); } return a; }
  function face(p, note) { const li = el('li', 'ov-face'); li.append(ava(p), el('bdi', '', p.name)); if (note) li.append(el('small', '', note)); return li; }
  const brand = () => { const b = el('span', 'ov-brand'); b.append(el('b', '', 'سبونج'), document.createTextNode(' لايف')); return b; };
  function render() {
    if (!tools) return;
    const now = Date.now() + offset;
    if (kind === 'countdown') {
      const c = tools.countdown, left = c.endsAt ? c.endsAt - now : c.left;
      if (left == null) { stage.replaceChildren(); lastKey = ''; return; }
      if (lastKey !== 'cd') { lastKey = 'cd'; const card = el('div', 'ov-card ov-pop'); card.append(el('span', 'ov-label'), el('span', 'ov-time'), brand()); stage.replaceChildren(card); }
      stage.querySelector('.ov-label').textContent = c.label || (left > 0 ? 'العد التنازلي' : 'انتهى الوقت!');
      const t = stage.querySelector('.ov-time'); t.textContent = fmt(left); t.classList.toggle('is-low', left <= 10_000);
      return;
    }
    if (kind === 'draw') {
      const d = tools.draw, key = 'd|' + d.open + '|' + d.count + '|' + (d.winner?.name || '') + '|' + d.drawnAt;
      if (key === lastKey) return; lastKey = key;
      if (d.winner) { const card = el('div', 'ov-card ov-win ov-pop'); card.append(el('span', 'ov-label', '🏆 الفائز في السحب'), ava(d.winner), el('strong', '', d.winner.name), brand()); stage.replaceChildren(card); return; }
      if (!d.open) { stage.replaceChildren(); return; }
      const card = el('div', 'ov-card'); const faces = el('ul', 'ov-faces'); faces.append(...d.recent.slice(0, 6).map((p) => face(p)));
      card.append(el('span', 'ov-label', 'اكتب في الشات للدخول في السحب'), el('span', 'ov-key', d.keyword), el('span', 'ov-count', d.count + ' مشارك'), faces, brand());
      stage.replaceChildren(card); return;
    }
    const w = tools.wall, key = 'w|' + w.on + '|' + w.chatters.map((p) => p.name + p.count).join(',');
    if (key === lastKey) return; lastKey = key;
    if (!w.on || !w.chatters.length) { stage.replaceChildren(); return; }
    const card = el('div', 'ov-card'); const faces = el('ul', 'ov-faces'); faces.append(...w.chatters.map((p) => face(p, p.count + ' رسالة')));
    card.append(el('span', 'ov-label', 'أكثر المتفاعلين الآن'), faces, brand());
    stage.replaceChildren(card);
  }
  setInterval(render, 250);
  function connect() {
    const ws = new WebSocket(window.SkySession.wsUrl());
    ws.addEventListener('message', (e) => { try { const m = JSON.parse(e.data); if (m.type === 'state' && m.data.tools) { tools = m.data.tools; offset = (tools.serverNow || Date.now()) - Date.now(); render(); } } catch {} });
    ws.addEventListener('open', () => { retry = 0; });
    ws.addEventListener('close', () => setTimeout(connect, Math.min(10_000, 1000 * 2 ** retry++)));
  }
  window.SkySession.ready.then(connect);
})();
