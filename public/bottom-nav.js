/* SPONGE LIVE — shared mobile bottom navigation (home, «لوحة التحكم», public profiles).
   One component for every page: include /bottom-nav.css and this script (defer, before the page script).
   - Phones and tablets only (≤ 980px); desktops keep the header and the side panel.
   - Links are real: on /account they switch sections in place (hash, no reload); elsewhere they go through
     /go/<section>, where the server decides — studio vs renewal vs sign-in — from the session.
   - The active item follows the actual URL (path + hash), never a fixed class; the home page has none.
   - No canvas, no timers, no network requests; browser back / forward is left alone. */
(() => {
  'use strict';
  if (document.getElementById('bottomNav')) return;
  const ITEMS = [
    { key: 'profile', label: 'ملفي', icon: 'i-user' },
    { key: 'community', label: 'المجتمع', icon: 'i-users', count: 'bottomIncoming' },
    { key: 'bag', label: 'حقيبتي', icon: 'i-gift' },
    { key: 'studio', label: 'ألعاب البث', icon: 'i-games' },
    { key: 'challenge', label: 'التحديات', icon: 'i-trophy', soon: true },
  ];
  // «لوحة التحكم» sections → the item that represents them (settings / billing have none)
  const SECTION_ITEM = { profile: 'profile', community: 'community', bag: 'bag', skins: 'bag', challenge: 'challenge' };
  const onAccount = () => location.pathname === '/account';
  const hrefFor = (key) => (key === 'studio' ? '/go/studio' : onAccount() ? '#' + key : '/go/' + key);
  const SVG = 'http://www.w3.org/2000/svg';

  const nav = document.createElement('nav');
  nav.className = 'bn'; nav.id = 'bottomNav'; nav.setAttribute('aria-label', 'التنقل السريع');
  for (const it of ITEMS) {
    const a = document.createElement('a');
    a.className = 'bn-item'; a.dataset.key = it.key; a.href = hrefFor(it.key);
    const box = document.createElement('span'); box.className = 'bn-ic';
    const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'bn-svg');
    const use = document.createElementNS(SVG, 'use'); use.setAttribute('href', '/icons.svg#' + it.icon); svg.append(use); box.append(svg);
    const label = document.createElement('span'); label.className = 'bn-label'; label.textContent = it.label;
    a.append(box, label);
    if (it.soon) { const b = document.createElement('small'); b.className = 'bn-badge is-soon'; b.textContent = 'قريبًا'; a.append(b); a.setAttribute('aria-label', it.label + ' — قريبًا'); }
    if (it.count) { const b = document.createElement('small'); b.className = 'bn-badge is-count'; b.id = it.count; b.hidden = true; a.append(b); }
    nav.append(a);
  }

  function paintActive() {
    const sec = onAccount() ? (location.hash.slice(1) || document.body?.dataset.sec || '') : '';
    const active = SECTION_ITEM[sec] || null;
    for (const a of nav.children) {
      a.href = hrefFor(a.dataset.key);
      if (a.dataset.key === active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
  }
  addEventListener('hashchange', paintActive);
  addEventListener('popstate', paintActive);
  addEventListener('pageshow', paintActive); // back-forward cache

  // a short "press" bounce on the icon (CSS animation, restarted per tap)
  nav.addEventListener('pointerdown', (e) => {
    const a = e.target.closest('.bn-item'); if (!a) return;
    a.classList.remove('is-pressed'); void a.offsetWidth; a.classList.add('is-pressed');
  });
  nav.addEventListener('animationend', (e) => e.target.closest?.('.bn-item')?.classList.remove('is-pressed'));

  // step aside while the keyboard is open (focused field, or the visual viewport shrinks)
  const typing = (on) => document.documentElement.classList.toggle('bn-typing', on);
  addEventListener('focusin', (e) => { if (e.target.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),textarea,select,[contenteditable=true]')) typing(true); });
  addEventListener('focusout', () => setTimeout(() => { const f = document.activeElement; if (!f || !f.matches?.('input,textarea,select,[contenteditable=true]')) typing(false); }, 60));
  if (window.visualViewport) {
    const vv = window.visualViewport;
    vv.addEventListener('resize', () => { if (innerHeight - vv.height > 150) typing(true); else if (!document.activeElement?.matches?.('input,textarea,select')) typing(false); });
  }

  document.documentElement.classList.add('has-bn');
  document.body.append(nav);
  paintActive();
})();
