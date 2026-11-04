/* SPONGE LIVE — page behaviours shared by every screen: bubbles, 3D tilt on cards,
   a short cinematic transition into a game, and the sound / effects switches. */
(() => {
  'use strict';
  const fx = () => window.SpongeFx;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(() => {
    if (!document.body.classList.contains('no-bubbles')) fx()?.bubbles(document.body);

    // 3D tilt follows the pointer on any .sp-tilt element (cards, game tiles).
    document.addEventListener('pointermove', (e) => {
      const el = e.target.closest?.('.sp-tilt'); if (!el || reduced() || fx()?.effectsOff) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--ry', ((e.clientX - r.left) / r.width - .5) * 14 + 'deg');
      el.style.setProperty('--rx', (.5 - (e.clientY - r.top) / r.height) * 12 + 'deg');
    }, { passive: true });
    document.addEventListener('pointerout', (e) => { const el = e.target.closest?.('.sp-tilt'); if (el && !el.contains(e.relatedTarget)) { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); } });

    // Cinematic step into a game: a quick ocean iris from the clicked card, then navigate.
    document.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[data-transition]');
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || reduced() || fx()?.effectsOff) return;
      e.preventDefault();
      const c = document.createElement('div'); c.className = 'sp-curtain';
      c.style.setProperty('--cx', e.clientX + 'px'); c.style.setProperty('--cy', e.clientY + 'px');
      document.body.append(c); a.classList.add('is-chosen'); fx()?.play('start');
      requestAnimationFrame(() => c.classList.add('is-on'));
      setTimeout(() => { location.href = a.href; }, 340);
    });
    addEventListener('pageshow', () => document.querySelectorAll('.sp-curtain').forEach((c) => c.remove()));

    // Switches: <button data-sp-toggle="sound|fx">
    const paint = () => document.querySelectorAll('[data-sp-toggle]').forEach((b) => {
      const on = b.dataset.spToggle === 'sound' ? !fx()?.muted : !fx()?.effectsOff;
      b.setAttribute('aria-pressed', String(on));
      const label = b.querySelector('[data-sp-label]');
      if (label) label.textContent = b.dataset.spToggle === 'sound' ? (on ? 'الصوت يعمل' : 'الصوت مكتوم') : (on ? 'المؤثرات تعمل' : 'المؤثرات متوقفة');
      const use = b.querySelector('use');
      if (use && b.dataset.spToggle === 'sound') use.setAttribute('href', '/icons.svg#' + (on ? 'i-volume' : 'i-volume-off'));
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest?.('[data-sp-toggle]'); if (!b) return;
      if (b.dataset.spToggle === 'sound') { fx()?.setMuted(!fx()?.muted); fx()?.play('tick'); } else fx()?.setEffects(!!fx()?.effectsOff);
      paint();
    });
    paint();
  });
})();
