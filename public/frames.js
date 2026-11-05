/* SPONGE LIVE — «إطارات الأسماء» on any page: SpongeFrames.avatar(node, frame) wraps an avatar in its frame ring,
   SpongeFrames.plate(name, frame) draws the nameplate. A frame comes from the server (equipped by a verified account);
   without one the plain avatar and name are returned — nothing is invented for guests. Images are drawn with CSSOM
   only (no inline style attributes, so the page's CSP holds). */
(() => {
  'use strict';
  const KEY = 'sl_frame_fx';
  const SVG = 'http://www.w3.org/2000/svg';
  const safeSrc = (u) => (typeof u === 'string' && /^\/frames\/u\/[a-z0-9_]{2,32}-(avatar|plate)\.(png|webp)(\?v=\d+)?$/.test(u) ? u : null);
  const EFFECTS = ['cyan', 'gold', 'saudi', 'ice', 'flame', 'crown', 'royal'];
  function crown() {
    const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 48 30'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', 'M3 26 L6 8 L15 17 L24 3 L33 17 L42 8 L45 26 Z'); p.setAttribute('fill', '#FFD62A'); p.setAttribute('stroke', '#8A5A00'); p.setAttribute('stroke-width', '1.6'); p.setAttribute('stroke-linejoin', 'round');
    s.append(p);
    for (const [cx, cy, c] of [[6, 8, '#FF6A8A'], [24, 3, '#38D4FF'], [42, 8, '#2FD9A0']]) { const d = document.createElementNS(SVG, 'circle'); d.setAttribute('cx', cx); d.setAttribute('cy', cy); d.setAttribute('r', '2.6'); d.setAttribute('fill', c); s.append(d); }
    return s;
  }
  const api = {
    lite() { try { return localStorage.getItem(KEY) === 'off'; } catch { return false; } },
    setLite(on) { try { localStorage.setItem(KEY, on ? 'off' : 'on'); } catch {} document.body.classList.toggle('fx-lite', !!on); },
    /** Wrap `node` (the round avatar) in the frame's ring. */
    avatar(node, frame) {
      if (!frame || !frame.id) return node;
      const box = document.createElement('span'); box.className = 'fr-av'; box.dataset.frame = frame.id;
      const effect = EFFECTS.includes(frame.effect) ? frame.effect : 'none'; box.dataset.effect = effect;
      box.append(node);
      const src = safeSrc(frame.avatar);
      if (src) { const img = document.createElement('img'); img.className = 'fr-img'; img.alt = ''; img.decoding = 'async'; img.src = src; img.addEventListener('error', () => img.remove(), { once: true }); box.append(img); }
      else if (effect !== 'none') { const ring = document.createElement('i'); ring.className = 'fr-ring'; ring.setAttribute('aria-hidden', 'true'); box.append(ring); }
      if (effect === 'ice' || effect === 'flame') { const sp = document.createElement('i'); sp.className = 'fr-spark'; sp.setAttribute('aria-hidden', 'true'); box.append(sp); }
      if (effect === 'crown' || effect === 'royal') { const c = document.createElement('i'); c.className = 'fr-crown'; c.append(crown()); box.append(c); }
      return box;
    },
    /** The name, on the frame's nameplate (nine-slice image when the frame has one). */
    plate(name, frame, cls = '') {
      const el = document.createElement('span'); el.className = 'fr-plate' + (cls ? ' ' + cls : '');
      const b = document.createElement('bdi'); b.textContent = name; el.append(b);
      if (!frame || !frame.id) { el.classList.add('is-plain'); return el; }
      el.dataset.effect = EFFECTS.includes(frame.effect) ? frame.effect : 'none';
      const src = safeSrc(frame.plate);
      if (src) {
        const sl = Array.isArray(frame.slice) && frame.slice.length === 4 ? frame.slice.map((n) => Math.max(0, Math.min(400, Number(n) || 0))) : [12, 12, 12, 12];
        el.classList.add('has-img');
        el.style.setProperty('--fr-src', 'url("' + src + '")');
        el.style.setProperty('--fr-slice', sl.join(' '));
        el.style.setProperty('--fr-bw', sl.map((n) => Math.round(n / 2) + 'px').join(' ')); // images are drawn at 2× for sharp screens
      }
      return el;
    },
  };
  window.SpongeFrames = api;
  const apply = () => document.body && document.body.classList.toggle('fx-lite', api.lite());
  if (document.body) apply(); else document.addEventListener('DOMContentLoaded', apply, { once: true });
})();
