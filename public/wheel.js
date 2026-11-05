/* سبونج لايف — «عجلة السكنات» (the page side). The server decides and stores every prize before this file
   animates anything: the wheel only travels to the slice of the rarity the server already chose.
   - The wheel is drawn from the published odds: each rarity's slice is exactly its share of 360°.
   - Every request carries a one-time key; if the connection drops, the same key fetches the stored result
     (nothing is charged twice). A key left pending is offered back when the page opens again.
   - Sounds are synthesised (WebAudio), original, quiet, and can be muted.
   - Legendary and mythic prizes open a short cinematic with the 3D model; every animation can be skipped. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('whWheel')) return;
  const SC = window.SpongeCoins;
  const RAR = {
    common: { name: 'عادي', color: '#C9D3E3', dark: '#7F8BA3' }, rare: { name: 'نادر', color: '#3FA3FF', dark: '#1659B8' },
    epic: { name: 'ملحمي', color: '#B06BFF', dark: '#5B2AB0' }, legendary: { name: 'أسطوري', color: '#FFC83A', dark: '#B97A00' },
    mythic: { name: 'خرافي', color: '#FF3D6E', dark: '#9E0F3A' },
  };
  const ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const nf = (n) => Number(n || 0).toLocaleString('en-US');
  const api = async (method, url, body) => {
    const res = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'تعذر إتمام الطلب'), { status: res.status });
    return data;
  };
  const say = (text, kind = 'is-info') => { const m = $('whMsg'); m.textContent = text; m.className = 'pg-msg ' + kind; m.hidden = !text; };

  let state = null, slices = [], angle = 0, busy = false, opened = false;

  /* ---------------- sound (synthesised, original) ---------------- */
  let ctx = null, muted = (() => { try { return localStorage.getItem('sl_wheel_sound') === 'off'; } catch { return false; } })();
  const audio = () => { if (muted) return null; try { ctx ||= new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); return ctx; } catch { return null; } };
  function tone(freq, at, dur, type = 'triangle', vol = 0.06) {
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
    o.type = type; o.frequency.setValueAtTime(freq, t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const tick = () => tone(1500, 0, 0.035, 'square', 0.025);
  function fanfare(rarity) {
    const notes = { common: [523, 659], rare: [523, 659, 784], epic: [523, 659, 784, 988], legendary: [523, 659, 784, 1047, 1319], mythic: [392, 523, 659, 784, 1047, 1319, 1568] }[rarity] || [523];
    notes.forEach((f, i) => tone(f, i * 0.09, 0.32, 'triangle', 0.07));
    if (rarity === 'legendary' || rarity === 'mythic') for (let i = 0; i < 8; i++) tone(2000 + i * 180, 0.5 + i * 0.04, 0.12, 'sine', 0.025);
  }
  function paintSound() { $('whSound').setAttribute('aria-pressed', String(!muted)); $('whSound').textContent = muted ? '🔇' : '🔊'; }
  $('whSound').addEventListener('click', () => { muted = !muted; try { localStorage.setItem('sl_wheel_sound', muted ? 'off' : 'on'); } catch {} paintSound(); });
  paintSound();

  /* ---------------- the wheel (SVG from the published odds) ---------------- */
  const NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, parent) { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent?.append(n); return n; }
  const pt = (deg, r) => { const a = ((deg - 90) * Math.PI) / 180; return [200 + r * Math.cos(a), 200 + r * Math.sin(a)]; };
  function drawWheel(odds) {
    const box = $('whWheel'); box.replaceChildren();
    const s = svg('svg', { viewBox: '0 0 400 400', class: 'wh-svg' }, box);
    const defs = svg('defs', {}, s);
    const rim = svg('linearGradient', { id: 'whRim', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    [['0', '#FFF4A8'], ['.4', '#FFD23A'], ['.75', '#E39A06'], ['1', '#9E5A00']].forEach(([o, c]) => svg('stop', { offset: o, 'stop-color': c }, rim));
    for (const r of ORDER) { const g = svg('radialGradient', { id: 'whG' + r, cx: '50%', cy: '50%', r: '50%' }, defs); svg('stop', { offset: '.25', 'stop-color': RAR[r].dark }, g); svg('stop', { offset: '1', 'stop-color': RAR[r].color }, g); }
    svg('circle', { cx: 200, cy: 200, r: 198, fill: 'url(#whRim)' }, s);
    svg('circle', { cx: 200, cy: 200, r: 182, fill: '#061A44' }, s);
    slices = []; let a0 = 0;
    for (const r of ORDER) {
      const pct = odds[r]; if (!pct) continue;
      const span = (pct / 100) * 360, a1 = a0 + span, [x0, y0] = pt(a0, 180), [x1, y1] = pt(a1, 180);
      svg('path', { d: `M200 200 L${x0.toFixed(2)} ${y0.toFixed(2)} A180 180 0 ${span > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`, fill: `url(#whG${r})`, stroke: '#FFE38A', 'stroke-width': 1.6 }, s);
      if (span >= 20) { // a label when the slice is wide enough; narrow slices are still exact (see the odds list)
        const mid = a0 + span / 2, [lx, ly] = pt(mid, span > 60 ? 118 : 140);
        const t = svg('text', { x: lx.toFixed(1), y: ly.toFixed(1), class: 'wh-label', transform: `rotate(${mid.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})` }, s);
        t.textContent = RAR[r].name + ' ' + pct + '%';
      }
      slices.push({ rarity: r, a0, a1 }); a0 = a1;
    }
    for (let i = 0; i < 24; i++) { const [bx, by] = pt(i * 15, 190); svg('circle', { cx: bx.toFixed(1), cy: by.toFixed(1), r: 4, class: 'wh-bulb' + (i % 2 ? ' is-alt' : '') }, s); }
    $('whWheel').style.setProperty('--wh-angle', angle + 'deg');
  }
  function sliceAt(deg) { const d = ((-deg % 360) + 360) % 360; return slices.find((x) => d >= x.a0 && d < x.a1) || slices[slices.length - 1]; }
  /** Rotates to the slice of `rarity` (chosen by the server), with ticks as slices pass the pointer. */
  function spinTo(rarity, { long = true } = {}) {
    return new Promise((resolve) => {
      const sl = slices.find((x) => x.rarity === rarity) || slices[0];
      const span = sl.a1 - sl.a0, target = sl.a0 + span / 2 + (Math.random() - 0.5) * span * 0.6;
      const from = angle, turns = reduced ? 0 : long ? 6 : 3;
      const end = from + turns * 360 + ((((-target - from) % 360) + 360) % 360);
      const ms = reduced ? 250 : long ? 5200 : 2600, start = performance.now(); let last = sliceAt(from), done = false;
      const skip = () => { done = true; };
      $('whStage').addEventListener('click', skip, { once: true });
      const step = (now) => {
        const k = done ? 1 : Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - k, 4); // fast start, long realistic slow-down
        angle = from + (end - from) * e; $('whWheel').style.setProperty('--wh-angle', angle + 'deg');
        const cur = sliceAt(angle); if (cur !== last) { last = cur; tick(); $('whStage').classList.remove('is-tick'); void $('whStage').offsetWidth; $('whStage').classList.add('is-tick'); }
        if (k < 1) requestAnimationFrame(step); else { angle = end % 360; $('whWheel').style.setProperty('--wh-angle', angle + 'deg'); $('whStage').removeEventListener('click', skip); resolve(); }
      };
      requestAnimationFrame(step);
    });
  }

  /* ---------------- data ---------------- */
  function paint(w) {
    state = w;
    $('whEarned').textContent = nf(w.earned); $('whCost1').textContent = nf(w.cost1); $('whCost10').textContent = nf(w.cost10);
    const save = w.cost1 * 10 - w.cost10; $('whSave').textContent = save > 0 ? `توفّر ${nf(save)}` : ''; $('whSave').hidden = save <= 0;
    $('whSpin1').disabled = busy || w.earned < w.cost1; $('whSpin10').disabled = busy || w.earned < w.cost10;
    drawWheel(w.odds);
    $('whOdds').replaceChildren(...ORDER.filter((r) => w.odds[r]).map((r) => {
      const li = el('li', 'wh-odd is-r-' + r); li.style.setProperty('--rc', RAR[r].color);
      const head = el('div', 'wh-odd-head'); head.append(el('b', '', RAR[r].name), el('span', 'wh-pct', w.odds[r] + '%'));
      const row = el('div', 'wh-odd-skins');
      for (const s of w.pool[r] || []) { const i = el('img'); i.src = s.thumb; i.alt = s.name; i.title = s.name; i.loading = 'lazy'; i.width = 44; i.height = 44; row.append(i); }
      li.append(head, row); return li;
    }));
    $('whRecent').replaceChildren(...(w.recent.length ? w.recent.map((s) => {
      const li = el('li'); const t = el('small', '', (s.count === 10 ? '10 لفات' : 'لفة') + ' • ' + new Date(s.at).toLocaleString('ar-SA-u-nu-latn', { dateStyle: 'short', timeStyle: 'short' }));
      const dots = el('span', 'wh-dots'); for (const r of s.results) { const d = el('i'); d.style.setProperty('--rc', RAR[r.rarity]?.color || '#fff'); d.title = RAR[r.rarity]?.name || ''; dots.append(d); }
      li.append(t, dots); return li;
    }) : [el('li', 'ds-empty', 'لا توجد لفات بعد.')]));
    if (w.earned < w.cost1) say(`تحتاج ${nf(w.cost1)} عملة مكتسبة للفة — استلم مكافأتك اليومية أو ادعُ أصدقاءك.`, 'is-info'); else if (!busy) say('');
  }
  async function load() { try { paint(await api('GET', '/api/me/wheel')); await recoverPending(); } catch (e) { say(e.message, 'is-err'); } }

  /* ---------------- spinning ---------------- */
  const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9_-]/g, '');
  const PENDING = 'sl_spin_pending';
  async function spin(count) {
    if (busy || !state) return;
    busy = true; paint(state); audio();
    const key = newKey();
    try { sessionStorage.setItem(PENDING, JSON.stringify({ key, count })); } catch {}
    let res = null;
    for (let attempt = 0; attempt < 3 && !res; attempt++) {
      try { res = await api('POST', '/api/me/wheel-spin', { count, key }); }
      catch (e) {
        if (e.status) { busy = false; try { sessionStorage.removeItem(PENDING); } catch {} say(e.message, 'is-err'); paint(state); return; }
        await new Promise((r) => setTimeout(r, 900)); // connection problem: the same key is safe to send again
      }
    }
    if (!res) { busy = false; paint(state); say('انقطع الاتصال. نتيجتك محفوظة إن وصل الطلب للخادم — أعد فتح الصفحة لاستعادتها.', 'is-err'); return; }
    try { sessionStorage.removeItem(PENDING); } catch {}
    SC?.setBalance(res.balance);
    const best = res.results.reduce((b, r) => (ORDER.indexOf(r.rarity) > ORDER.indexOf(b.rarity) ? r : b), res.results[0]);
    $('whStage').classList.add('is-spinning');
    await spinTo(best.rarity);
    $('whStage').classList.remove('is-spinning');
    busy = false;
    await reveal(res);
    load();
  }
  async function recoverPending() {
    let p = null; try { p = JSON.parse(sessionStorage.getItem(PENDING) || 'null'); } catch {}
    if (!p?.key) return;
    try { const r = await api('GET', '/api/me/wheel-result?key=' + encodeURIComponent(p.key)); sessionStorage.removeItem(PENDING); say('استعدنا نتيجة لفتك السابقة ✓', 'is-ok'); await reveal(r); load(); }
    catch (e) { if (e.status === 404) { sessionStorage.removeItem(PENDING); say('لفتك السابقة لم تصل للخادم، ولم يُخصم شيء.', 'is-info'); } }
  }
  $('whSpin1').addEventListener('click', () => spin(1));
  $('whSpin10').addEventListener('click', () => spin(10));

  /* ---------------- the reveal (skippable) ---------------- */
  let viewer = null;
  function closeOverlay(o) { viewer?.dispose(); viewer = null; o.remove(); document.body.classList.remove('wh-open'); }
  async function reveal(res) {
    const o = el('div', 'wh-over'); o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', 'جوائزك');
    document.body.append(o); document.body.classList.add('wh-open');
    const items = res.results;
    let i = 0, skipAll = false;
    const showSummary = () => {
      viewer?.dispose(); viewer = null; o.dataset.rarity = ''; o.replaceChildren();
      const card = el('div', 'wh-sum'); card.append(el('h2', '', items.length > 1 ? 'جوائز اللفات العشر' : 'جائزتك'));
      const grid = el('div', 'wh-sum-grid');
      for (const r of items) {
        const b = el('div', 'wh-prize is-r-' + r.rarity); b.style.setProperty('--rc', RAR[r.rarity].color);
        const img = el('img'); img.src = r.skin.thumb; img.alt = ''; img.width = 120; img.height = 120;
        b.append(el('span', 'wh-tag', RAR[r.rarity].name), img, el('b', '', r.skin.name), el('small', '', r.duplicate ? 'مكرر — أُضيف كشظية' : 'جديد في حقيبتك ✓'));
        grid.append(b);
      }
      const actions = el('div', 'wh-actions');
      const go = el('a', 'ds-btn is-blue', 'افتح حقيبتي'); go.href = '#skins';
      const ok = el('button', 'ds-btn is-ghost', 'إغلاق'); ok.type = 'button';
      go.addEventListener('click', () => closeOverlay(o)); ok.addEventListener('click', () => closeOverlay(o));
      actions.append(go, ok); card.append(grid, actions); o.append(card); ok.focus();
    };
    const showOne = async (r) => {
      o.replaceChildren(); o.dataset.rarity = r.rarity;
      const big = r.rarity === 'legendary' || r.rarity === 'mythic';
      const card = el('div', 'wh-card is-r-' + r.rarity); card.style.setProperty('--rc', RAR[r.rarity].color);
      card.append(el('span', 'wh-tag', RAR[r.rarity].name));
      const stage = el('div', big ? 'wh-3d sv-stage' : 'wh-img');
      if (!big) { const img = el('img'); img.src = r.skin.thumb; img.alt = ''; img.width = 260; img.height = 260; stage.append(img); }
      card.append(stage, el('h2', '', r.skin.name), el('p', 'wh-new', r.duplicate ? 'لديك هذا السكن — أُضيف كنسخة إضافية (شظية)' : 'سكن جديد في حقيبتك!'));
      const actions = el('div', 'wh-actions');
      if (!r.duplicate || big) { const eq = el('button', 'ds-btn is-gold', big ? 'تجهيز الآن' : 'تجهيز'); eq.type = 'button'; eq.addEventListener('click', async () => { eq.disabled = true; try { await api('POST', '/api/me/skin-equip', { id: r.skin.id }); eq.textContent = 'تم التجهيز ✓'; viewer?.play('win'); } catch (e) { eq.textContent = e.message; } }); actions.append(eq); }
      const next = el('button', 'ds-btn is-blue', i < items.length - 1 ? `التالي (${i + 1}/${items.length})` : 'عرض الكل'); next.type = 'button';
      const skip = el('button', 'ds-btn is-ghost', 'تخطي'); skip.type = 'button';
      actions.append(next); if (items.length > 1 && i < items.length - 1) actions.append(skip);
      card.append(actions); o.append(card);
      fanfare(r.rarity);
      if (big && !reduced) { o.classList.add('is-cinema'); setTimeout(() => o.classList.remove('is-cinema'), 1400); }
      if (big) {
        try {
          const mod = await import('/skin-viewer.js');
          viewer?.dispose(); viewer = await mod.mountViewer(stage, { model: r.skin.model, animations: { idle: 'idle', walk: 'walk', win: 'win', lose: 'lose' }, rarity: r.rarity, accent: r.skin.accent, label: r.skin.name, autoRotate: true });
          viewer.reveal(); setTimeout(() => viewer?.play('win'), 700);
        } catch { const img = el('img'); img.src = r.skin.thumb; img.alt = ''; stage.append(img); }
      }
      await new Promise((resolve) => { next.addEventListener('click', resolve, { once: true }); skip.addEventListener('click', () => { skipAll = true; resolve(); }, { once: true }); o.addEventListener('keydown', (e) => { if (e.key === 'Escape') { skipAll = true; resolve(); } }); next.focus(); });
    };
    for (i = 0; i < items.length && !skipAll; i++) await showOne(items[i]);
    showSummary();
  }

  window.SpongeWheel = {
    open() { if (!opened) { opened = true; } load(); },
    close() {},
  };
  if (document.body.dataset.sec === 'wheel') window.SpongeWheel.open();
})();
