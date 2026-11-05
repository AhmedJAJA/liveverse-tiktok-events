/* سبونج لايف — «إطارات الأسماء» in «حقيبتي» (the «السكنات» page): list, free claim, equip, preview.
   The server decides what the account owns and what it may equip (src/frames.mjs). */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('mfGrid')) return;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const api = async (method, url, body) => {
    const res = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'تعذر إتمام الطلب');
    return data;
  };
  const msg = (t, ok = true) => { const m = $('mfMsg'); m.textContent = t || ''; m.className = 'pg-msg ' + (ok ? 'is-ok' : 'is-err'); m.hidden = !t; };
  let me = { name: 'اسمك', avatar: '' }, st = null, busy = false, loaded = false;
  const F = () => window.SpongeFrames;
  function avatar(src) {
    const box = el('span', 'mf-av'); box.append(el('span', '', (Array.from(me.name)[0] || '؟')));
    if (src && /^(https:\/\/|\/)/.test(src)) { const img = el('img'); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.src = src; img.addEventListener('error', () => img.remove(), { once: true }); box.append(img); }
    return box;
  }
  function preview(frame) {
    const box = el('div', 'mf-pill');
    box.append(F() ? F().avatar(avatar(me.avatar), frame) : avatar(me.avatar), F() ? F().plate(me.name, frame) : el('b', '', me.name));
    return box;
  }
  function paint() {
    if (!st) return;
    const eq = st.frames.find((f) => f.equipped) || null;
    $('mfPreview').replaceChildren(preview(eq), el('small', 'ds-small', eq ? 'الإطار الحالي: ' + eq.name : 'بدون إطار'));
    $('mfRemove').hidden = !eq;
    $('mfGrid').replaceChildren(...st.frames.map((f) => {
      const li = el('li', 'mf-item' + (f.equipped ? ' is-on' : '')); li.dataset.rarity = f.rarity;
      const demo = el('div', 'mf-demo'); demo.append(preview(f));
      const info = el('div', 'mf-info'); info.append(el('b', '', f.name), el('small', '', f.rarityName + (f.owned ? (f.source === 'grant' ? ' • مُنح لك' : ' • في مجموعتك') : ' • مجاني')));
      const b = el('button', 'ds-btn ' + (f.equipped ? 'is-ghost' : f.owned ? 'is-blue' : 'is-gold'), f.equipped ? 'مُجهَّز' : f.owned ? 'تجهيز' : 'أضفه مجانًا');
      b.type = 'button'; b.disabled = f.equipped; b.dataset.id = f.id; b.dataset.act = f.owned ? 'equip' : 'claim';
      li.append(demo, info, b);
      return li;
    }));
    if (!st.frames.length) $('mfGrid').replaceChildren(el('li', 'ds-small', 'لا توجد إطارات متاحة الآن.'));
    $('mfLite').checked = !!F()?.lite();
  }
  async function load() {
    try {
      const [frames, who] = await Promise.all([api('GET', '/api/me/frames'), api('GET', '/api/access/me').catch(() => ({}))]);
      st = frames; const a = who.account || {};
      me = { name: a.displayName || a.username || 'اسمك', avatar: a.picture || '' };
      loaded = true; paint();
    } catch (e) { if (e.message !== 'login') msg(e.message, false); }
  }
  $('mfGrid').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-id]'); if (!b || busy) return;
    busy = true; b.disabled = true;
    try {
      st = await api('POST', b.dataset.act === 'claim' ? '/api/me/frame-claim' : '/api/me/frame-equip', { id: b.dataset.id });
      if (b.dataset.act === 'claim') st = await api('POST', '/api/me/frame-equip', { id: b.dataset.id });
      msg('جُهّز الإطار — يظهر في ألعابك القادمة ✓'); paint();
    } catch (er) { msg(er.message, false); b.disabled = false; }
    busy = false;
  });
  $('mfRemove').addEventListener('click', async () => { try { st = await api('POST', '/api/me/frame-equip', { id: null }); msg('أُزيل الإطار'); paint(); } catch (er) { msg(er.message, false); } });
  $('mfLite').addEventListener('change', (e) => F()?.setLite(e.target.checked));
  // load when «السكنات» is opened (and again on each visit)
  const check = () => { if (document.body.dataset.sec === 'skins') load(); };
  new MutationObserver(check).observe(document.body, { attributes: true, attributeFilter: ['data-sec'] });
  check();
})();
