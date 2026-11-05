/* SPONGE LIVE — owner panel: Sponge Coins economy (balances, coin orders, the skin wheel, skins, invitations).
   Every change goes through the server, which validates it and records who did it and why. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('ecoTitle')) return;
  const api = async (method, url, body) => {
    const res = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'تعذر إتمام الطلب');
    return data;
  };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const row = (tbody, cells) => { const tr = tbody.insertRow(); for (const c of cells) { const td = tr.insertCell(); if (c instanceof Node) td.append(c); else td.textContent = c ?? '—'; } return tr; };
  const msg = (id, t, ok = true) => { const m = $(id); m.textContent = t; m.className = 'pg-msg ' + (ok ? 'is-ok' : 'is-err'); m.hidden = !t; };
  const fmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Riyadh' });
  const when = (iso) => (iso ? fmt.format(new Date(iso)) : '—');
  const nf = (n) => Number(n || 0).toLocaleString('en-US');
  const R = { common: 'عادي', rare: 'نادر', epic: 'ملحمي', legendary: 'أسطوري', mythic: 'خرافي' };
  const ST = { pending: 'بانتظار الدفع', paid: 'مكتمل', failed: 'فشل', cancelled: 'ملغي', expired: 'منتهي', granted: 'مُنحت', held: 'قيد المراجعة', rejected: 'مرفوضة', capped: 'بعد الحد' };
  /** A small inline "reason + action" control (no browser dialogs). */
  function decide(placeholder, actions) {
    const box = el('div', 'pg-row'); const reason = el('input'); reason.placeholder = placeholder; reason.maxLength = 200;
    box.append(reason);
    for (const [label, fn, danger] of actions) { const b = el('button', 'pg-btn2' + (danger ? ' is-danger' : ''), label); b.type = 'button'; b.addEventListener('click', () => fn(reason.value, b)); box.append(b); }
    return box;
  }

  /* overview, invitations, daily rewards, logs */
  async function overview() {
    try {
      const d = await api('GET', '/api/manage/economy');
      $('ecoTotals').textContent = `المحافظ: ${nf(d.totals.wallets)} • عملات مكتسبة متداولة: ${nf(d.totals.earned)} • عملات مشتراة متداولة: ${nf(d.totals.purchased)}`;
      $('dailyStat').textContent = `المكافآت اليومية آخر 24 ساعة: ${nf(d.daily24h.claims)} مكافأة لـ ${nf(d.daily24h.users)} حساب`;
      const tb = $('refRows'); tb.replaceChildren();
      if (!d.referrals.length) row(tb, ['لا توجد دعوات بعد']);
      for (const r of d.referrals) row(tb, [when(r.at), `${r.refereeName} · ${r.referee}`, r.referrer, ST[r.status] || r.status, r.reason || '—',
        r.status === 'held' ? decide('سبب القرار', [['منح', (why) => refDecide(r.referee, true, why)], ['رفض', (why) => refDecide(r.referee, false, why), true]]) : '—']);
      const lb = $('ecoLogRows'); lb.replaceChildren();
      if (!d.logs.length) row(lb, ['لا توجد عمليات بعد']);
      for (const l of d.logs) row(lb, [when(l.at), l.actor, l.action, l.target || '—', l.reason || '—']);
    } catch (e) { $('ecoTotals').textContent = e.message; }
  }
  async function refDecide(publicId, approve, reason) {
    try { const r = await api('POST', '/api/manage/referral-decide', { publicId, approve, reason }); msg('refMsg', 'النتيجة: ' + (ST[r.result] || r.result)); overview(); }
    catch (e) { msg('refMsg', e.message, false); }
  }
  $('adjustForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try {
      const r = await api('POST', '/api/manage/wallet-adjust', { publicId: f.publicId.value.trim(), amount: Number(f.amount.value), bucket: f.bucket.value, reason: f.reason.value });
      msg('adjustMsg', `تم — الرصيد الآن ${nf(r.wallet.balance)} (مكتسب ${nf(r.wallet.earned)}، مشترى ${nf(r.wallet.purchased)})`); f.reset(); overview();
    } catch (er) { msg('adjustMsg', er.message, false); }
  });

  /* coin orders */
  async function orders() {
    const tb = $('ordersRows');
    try {
      const d = await api('GET', '/api/manage/purchases?status=' + $('ordersStatus').value); tb.replaceChildren();
      if (!d.purchases.length) row(tb, ['لا توجد طلبات بهذه الحالة']);
      for (const o of d.purchases) {
        const ref = el('code', '', o.ref); ref.dir = 'ltr';
        const action = o.status === 'pending' && o.provider === 'whatsapp'
          ? decide('مرجع التحويل / السبب', [['تأكيد الدفع', (why) => orderDecide(o.ref, 'paid', why)], ['لم يُدفع', (why) => orderDecide(o.ref, 'failed', why), true]])
          : (o.note || (o.confirmedBy ? 'بواسطة ' + o.confirmedBy : '—'));
        row(tb, [when(o.createdAt), ref, o.publicId, nf(o.coins) + ' عملة', o.amount.toFixed(2) + ' ريال', o.provider === 'whatsapp' ? 'واتساب' : 'إلكتروني', ST[o.status] || o.status, action]);
      }
    } catch (e) { msg('ordersMsg', e.message, false); }
  }
  async function orderDecide(ref, decision, reason) {
    try { await api('POST', '/api/manage/order-decide', { ref, decision, reason }); msg('ordersMsg', decision === 'paid' ? 'أُضيفت العملات للمحفظة ✓' : 'سُجّل القرار'); orders(); overview(); }
    catch (e) { msg('ordersMsg', e.message, false); }
  }
  $('ordersStatus').addEventListener('change', orders);

  /* the wheel */
  const KEYS = ['common', 'rare', 'epic', 'legendary', 'mythic'];
  const sumOdds = () => { const f = $('oddsForm'); const s = KEYS.reduce((n, k) => n + Math.round(Number(f[k].value || 0) * 100), 0) / 100; $('oddsSum').textContent = s.toFixed(2) + '%'; $('oddsSum').className = s === 100 ? 'is-ok' : 'is-err'; };
  let sim = null;
  async function wheel() {
    try {
      const d = await api('GET', '/api/manage/wheel'); const f = $('oddsForm');
      for (const k of KEYS) f[k].value = ((d.config.configured[k] || 0) / 100).toString();
      f.cost1.value = d.config.cost1; f.cost10.value = d.config.cost10; sumOdds();
      const tb = $('distRows'); tb.replaceChildren();
      for (const k of KEYS) { const real = d.distribution.find((x) => x.rarity === k); row(tb, [R[k], ((d.config.odds[k] || 0) / 100) + '%', sim ? (sim.observed[k] || 0) + '%' : '—', real ? `${real.pct}% (${nf(real.n)})` : '0', real ? nf(real.duplicates) : '0']); }
      const sb = $('spinRows'); sb.replaceChildren();
      if (!d.spins.length) row(sb, ['لا توجد لفات بعد']);
      for (const s of d.spins.slice(0, 30)) row(sb, [when(s.at), s.publicId, String(s.count), nf(s.cost)]);
    } catch (e) { msg('oddsMsg', e.message, false); }
  }
  $('oddsForm').addEventListener('input', sumOdds);
  $('oddsForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try { await api('POST', '/api/manage/wheel-odds', { odds: Object.fromEntries(KEYS.map((k) => [k, Number(f[k].value || 0)])), cost1: Number(f.cost1.value), cost10: Number(f.cost10.value), reason: f.reason.value }); msg('oddsMsg', 'حُفظت النسب — تظهر للمستخدمين فورًا'); f.reason.value = ''; wheel(); overview(); }
    catch (er) { msg('oddsMsg', er.message, false); }
  });
  $('simulateBtn').addEventListener('click', async () => { const b = $('simulateBtn'); b.disabled = true; try { sim = await api('POST', '/api/manage/wheel-simulate', { n: 100000 }); msg('oddsMsg', 'محاكاة على الخادم — لا تُحفظ ولا تُخصم'); wheel(); } catch (er) { msg('oddsMsg', er.message, false); } b.disabled = false; });

  /* skins */
  async function skins() {
    const tb = $('skinRows');
    try {
      const d = await api('GET', '/api/manage/skins'); tb.replaceChildren();
      for (const s of d.skins) {
        const img = el('img'); if (s.thumb) img.src = s.thumb; img.alt = ''; img.width = 44; img.height = 44;
        const name = el('input'); name.value = s.name; name.maxLength = 40;
        const rar = el('select'); for (const k of KEYS) { const o = new Option(R[k], k); o.selected = k === s.rarity; rar.append(o); }
        const acc = el('select'); for (const [k, t] of [['free', 'مجاني'], ['wheel', 'العجلة / شراء'], ['grant', 'منحة فقط']]) { const o = new Option(t, k); o.selected = k === s.access; acc.append(o); }
        const inWheel = el('input'); inWheel.type = 'checkbox'; inWheel.checked = s.inWheel;
        const price = el('input'); price.type = 'number'; price.min = '1'; price.value = s.price ?? ''; price.placeholder = '—';
        const active = el('input'); active.type = 'checkbox'; active.checked = s.active; active.disabled = s.default;
        const save = el('button', 'pg-btn2', 'حفظ'); save.type = 'button';
        save.addEventListener('click', async () => {
          try { await api('POST', '/api/manage/skin-save', { id: s.id, name: name.value, rarity: rar.value, access: acc.value, inWheel: inWheel.checked, price: price.value === '' ? null : Number(price.value), active: active.checked }); msg('skinsMsg', 'حُفظ «' + name.value + '»'); skins(); wheel(); }
          catch (e) { msg('skinsMsg', e.message, false); }
        });
        const id = el('code', '', s.id); id.dir = 'ltr';
        row(tb, [img, id, name, rar, acc, inWheel, price, active, nf(s.owners), save]);
      }
    } catch (e) { msg('skinsMsg', e.message, false); }
  }
  const asDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('تعذر قراءة الملف')); r.readAsDataURL(file); });
  $('skinUpload').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try {
      const model = f.model.files[0], thumb = f.thumb.files[0];
      await api('POST', '/api/manage/skin-upload', { id: f.id.value.trim(), name: f.name.value, rarity: f.rarity.value,
        model: model ? (await asDataUrl(model)).replace(/^data:[^;]*;/, 'data:model/gltf-binary;') : undefined, thumb: thumb ? await asDataUrl(thumb) : undefined });
      msg('skinsMsg', 'رُفعت الملفات ✓ — فعّل السكن من الجدول عندما يكون جاهزًا'); f.reset(); skins();
    } catch (er) { msg('skinsMsg', er.message, false); }
  });

  overview(); orders(); wheel(); skins();
})();
