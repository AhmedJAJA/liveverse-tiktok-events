/* SPONGE LIVE — Sponge Coins helpers shared by the home page and «لوحة التحكم».
   - claimDaily(): asks the server for today's reward (the server decides; repeat calls are harmless).
   - celebrate(): a light celebration (DOM + CSS only, no canvas) with +amount and the next reward time.
   - countdown(el, nextAt, serverNow): HH:MM:SS from the SERVER clock (offset measured once), every second.
   Exposed as window.SpongeCoins. */
(() => {
  'use strict';
  const nf = (n) => Number(n || 0).toLocaleString('en-US');
  const COIN = '/brand/coin-64.webp';
  let offset = 0; // server clock − device clock, so a changed device clock changes nothing
  const syncClock = (serverNow) => { const t = Date.parse(serverNow || ''); if (t) offset = t - Date.now(); };
  const serverTime = () => Date.now() + offset;
  const hms = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':'); };

  async function claimDaily() {
    const res = await fetch('/api/me/daily-claim', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'تعذر التحقق من المكافأة');
    syncClock(data.serverNow);
    return data;
  }

  const timers = new WeakMap();
  /** Live HH:MM:SS until nextAt; calls onDue() once when it reaches zero. */
  function countdown(el, nextAt, serverNow, onDue) {
    if (serverNow) syncClock(serverNow);
    clearInterval(timers.get(el));
    const due = Date.parse(nextAt || '') || 0;
    const tick = () => {
      const left = due - serverTime();
      if (left <= 0) { clearInterval(timers.get(el)); el.textContent = '00:00:00'; el.dataset.ready = '1'; onDue?.(); return; }
      el.dataset.ready = ''; el.textContent = hms(left);
    };
    tick(); timers.set(el, setInterval(tick, 1000));
  }

  /** A short celebration: coins fly up, +amount, the new balance and the next reward time. */
  function celebrate({ amount, balance, nextAt, serverNow, title = 'مكافأتك اليومية!' }) {
    document.querySelector('.sc-pop')?.remove();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const box = document.createElement('div'); box.className = 'sc-pop'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'scPopTitle');
    const card = document.createElement('div'); card.className = 'sc-pop-card';
    const burst = document.createElement('div'); burst.className = 'sc-burst'; burst.setAttribute('aria-hidden', 'true');
    if (!reduced) for (let i = 0; i < 14; i++) {
      const c = document.createElement('img'); c.src = COIN; c.alt = ''; c.className = 'sc-fly';
      c.style.setProperty('--dx', Math.round((Math.random() - 0.5) * 320) + 'px');
      c.style.setProperty('--dy', Math.round(-120 - Math.random() * 200) + 'px');
      c.style.setProperty('--r', Math.round((Math.random() - 0.5) * 720) + 'deg');
      c.style.setProperty('--d', (i * 0.04).toFixed(2) + 's');
      burst.append(c);
    }
    const big = document.createElement('img'); big.src = '/brand/coin-256.webp'; big.alt = ''; big.className = 'sc-pop-coin'; big.width = 120; big.height = 120;
    const h = document.createElement('h2'); h.id = 'scPopTitle'; h.textContent = title;
    const plus = document.createElement('p'); plus.className = 'sc-plus'; plus.dir = 'ltr'; plus.textContent = '+' + nf(amount);
    const unit = document.createElement('p'); unit.className = 'sc-unit'; unit.textContent = 'عملة إسفنجة أُضيفت إلى محفظتك';
    const bal = document.createElement('p'); bal.className = 'sc-bal'; bal.textContent = 'رصيدك الآن: ' + nf(balance);
    const next = document.createElement('p'); next.className = 'sc-next';
    const t = document.createElement('b'); t.dir = 'ltr'; next.append('مكافأتك القادمة بعد ', t);
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'sc-ok'; ok.textContent = 'رائع!';
    card.append(burst, big, h, plus, unit, bal, next, ok);
    box.append(card); document.body.append(box);
    countdown(t, nextAt, serverNow);
    const close = () => { clearInterval(timers.get(t)); box.classList.add('is-out'); setTimeout(() => box.remove(), reduced ? 0 : 220); };
    ok.addEventListener('click', close); box.addEventListener('click', (e) => { if (e.target === box) close(); });
    addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); removeEventListener('keydown', esc); } });
    ok.focus();
    // the balance pills on the page count up
    for (const el of document.querySelectorAll('[data-coin-balance]')) bump(el, balance);
  }
  function bump(el, to) {
    const from = Number(el.dataset.value || 0), start = performance.now(), ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900;
    el.dataset.value = to; el.classList.add('is-bump');
    const step = (now) => { const k = ms ? Math.min(1, (now - start) / ms) : 1; el.textContent = nf(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); else setTimeout(() => el.classList.remove('is-bump'), 400); };
    requestAnimationFrame(step);
  }
  function setBalance(value) { for (const el of document.querySelectorAll('[data-coin-balance]')) { el.dataset.value = value; el.textContent = nf(value); } }

  window.SpongeCoins = { claimDaily, celebrate, countdown, setBalance, bump, nf, hms };
})();
