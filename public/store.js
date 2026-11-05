/* سبونج لايف — «متجر العملات» (page side). Prices, limits and order states come from the server; the page
   sends only the package id and the age confirmation. Coins are added by the server after a trusted payment
   confirmation (the gateway's record, or the owner confirming a WhatsApp payment). */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('stGrid')) return;
  const SC = window.SpongeCoins;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const sar = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ريال';
  const api = async (method, url, body) => {
    const res = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'تعذر إتمام الطلب'), { status: res.status });
    return data;
  };
  const say = (text, kind = 'is-info') => { const m = $('stMsg'); m.textContent = text; m.className = 'pg-msg ' + kind; m.hidden = !text; };
  const STATUS = { pending: ['بانتظار الدفع', 'is-warn'], paid: ['مكتمل ✓', 'is-on'], failed: ['لم يكتمل', 'is-bad'], cancelled: ['ملغي', 'is-off'], expired: ['منتهي', 'is-off'] };
  let data = null, busy = false;

  function paint(d) {
    data = d;
    $('stPay').hidden = false;
    $('stPay').textContent = d.payment === 'online' ? 'الدفع الإلكتروني متاح — تُضاف العملات فور تأكيد بوابة الدفع.' : 'الدفع حاليًا عبر واتساب: تحصل على رقم طلب، وبعد تأكيد الدفع تُضاف العملات لمحفظتك.';
    $('stCap').textContent = d.limits.monthlyCap; $('stUsed').textContent = d.limits.used30d;
    const per = (p) => (p.price / p.coins) * 1000;
    const base = per(d.packages[0]);
    $('stGrid').replaceChildren(...d.packages.map((p, i) => {
      const li = el('li', 'st-card' + (p.featured ? ' is-featured' : ''));
      li.style.setProperty('--i', i);
      if (p.badge) li.append(el('span', 'st-badge', p.badge));
      const coins = el('div', 'st-coins'); coins.setAttribute('aria-hidden', 'true');
      for (let k = 0; k < Math.min(4, i + 1); k++) { const c = el('img'); c.src = '/brand/coin-128.webp'; c.alt = ''; c.width = 72; c.height = 72; c.style.setProperty('--k', k); coins.append(c); }
      const amt = el('b', 'st-amount', p.coins.toLocaleString('en-US')); amt.dir = 'ltr';
      const save = Math.round((1 - per(p) / base) * 100);
      const buy = el('button', 'ds-btn ' + (p.featured ? 'is-gold' : 'is-blue') + ' st-buy'); buy.type = 'button';
      buy.append(el('span', 'ds-spin'), el('span', '', 'شراء — ' + sar(p.price)));
      buy.querySelector('.ds-spin').setAttribute('aria-hidden', 'true');
      buy.addEventListener('click', () => order(p, buy));
      li.append(coins, amt, el('span', 'st-unit', 'عملة إسفنجة'), el('p', 'st-blurb', p.blurb), el('p', 'st-price', sar(p.price)));
      if (save > 0) li.append(el('small', 'st-save', `أرخص بـ ${save}% لكل عملة`));
      li.append(buy);
      return li;
    }));
    $('stOrders').replaceChildren(...(d.orders.length ? d.orders.map((o) => {
      const li = el('li'); const left = el('span'); const ref = el('code', '', o.ref); ref.dir = 'ltr';
      left.append(el('b', '', o.coins.toLocaleString('en-US') + ' عملة — ' + sar(o.amount)), ref);
      const [t, c] = STATUS[o.status] || [o.status, 'is-off'];
      li.append(left, el('span', 'pg-badge ' + c, t));
      if (o.status === 'pending' && o.provider === 'whatsapp') {
        const x = el('button', 'ds-link', 'إلغاء'); x.type = 'button';
        x.addEventListener('click', async () => { x.disabled = true; try { paint(await api('POST', '/api/me/coins-cancel', { ref: o.ref })); } catch (e) { say(e.message, 'is-err'); x.disabled = false; } });
        li.append(x);
      }
      return li;
    }) : [el('li', 'ds-empty', 'لا توجد طلبات بعد.')]));
  }
  async function order(p, button) {
    if (busy) return;
    if (!$('stAdult').checked) { say('أكّد أولًا أن عمرك 18 سنة أو أكثر، أو أن ولي أمرك وافق على الشراء.', 'is-err'); $('stAdult').focus(); return; }
    busy = true; button.disabled = true; button.classList.add('is-busy'); say('');
    try {
      const r = await api('POST', '/api/me/coins-order', { package: p.id, adult: true });
      if (r.url) { location.href = r.url; return; } // the gateway's own page
      $('stDlgCoins').textContent = r.order.coins.toLocaleString('en-US') + ' عملة إسفنجة';
      $('stDlgPrice').textContent = sar(r.order.amount);
      $('stDlgRef').textContent = r.order.ref; $('stDlgWa').href = r.whatsapp;
      const dlg = $('stDialog'); if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      load();
    } catch (e) { say(e.message, 'is-err'); }
    finally { busy = false; button.disabled = false; button.classList.remove('is-busy'); }
  }
  $('stDlgClose').addEventListener('click', () => $('stDialog').close());
  $('stDlgCopy').addEventListener('click', async (e) => { try { await navigator.clipboard.writeText($('stDlgRef').textContent); e.currentTarget.textContent = 'تم النسخ ✓'; } catch {} });
  async function load() { try { paint(await api('GET', '/api/me/store')); } catch (e) { say(e.message, 'is-err'); } }

  // back from the payment page: ask the server (it checks with the gateway) until the order settles
  const back = new URLSearchParams(location.search).get('coins');
  if (back && /^[0-9a-f-]{36}$/i.test(back)) {
    history.replaceState(null, '', location.pathname + location.hash);
    let tries = 0;
    const check = async () => {
      try {
        const r = await api('GET', '/api/me/coins-order?id=' + encodeURIComponent(back));
        if (r.order.status === 'paid') { SC?.celebrate({ amount: r.order.coins, balance: r.wallet.balance, nextAt: r.wallet.daily.nextAt, serverNow: r.wallet.serverNow, title: 'تمت عملية الشراء!' }); load(); return; }
        if (r.order.status === 'failed' || r.order.status === 'expired') { say('لم تكتمل عملية الدفع، ولم يُخصم شيء.', 'is-err'); load(); return; }
      } catch {}
      if (++tries < 10) setTimeout(check, 3000); else say('لم يصل تأكيد الدفع بعد — ستُضاف العملات تلقائيًا فور تأكيد البوابة.');
    };
    check();
  }
  window.SpongeStore = { open: load };
  if (document.body.dataset.sec === 'store') load();
})();
