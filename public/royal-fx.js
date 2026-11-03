/* SKY LIVE — Royal FX (progressive enhancement, no dependencies).
   Adds decorative, aria-hidden layers on top of existing markup; it never
   replaces content, ids or listeners, so every page keeps working without it. */
(() => {
  'use strict';
  const d = document;
  if (!d.body || d.body.classList.contains('broadcast')) return; // OBS overlay stays untouched
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  const ORBIT = '.gold-button,.btn-gold,.button.primary,.button.success,.play-button,.presenter-start,.start-game,.verify-access';
  const BORDER = '.connect-card,.pass-card,.cta-card,.hero-player.rank-one,.season-hero,.event-hero';
  const SPOT = '.game-tile,.category-card,.hero-player,.how-grid>div,.daily-strip,.tools-strip,.surface,.form-strip,.audience-setting,.advanced-panel,.connect-card,.pass-card,.cta-card';
  const REVEAL = '.sky-home>section,.event-options>*';

  const layer = (cls) => { const s = d.createElement('span'); s.className = cls; s.setAttribute('aria-hidden', 'true'); return s; };
  const ensurePositioned = (el) => { if (getComputedStyle(el).position === 'static') el.style.position = 'relative'; };

  /* ---------- Cinematic stage: aurora, silk ribbon, gold dust, grain ---------- */
  function buildStage() {
    if (d.querySelector('.fx-stage')) return;
    const stage = d.createElement('div');
    stage.className = 'fx-stage';
    stage.setAttribute('aria-hidden', 'true');
    ['fx-aurora fx-aurora-a', 'fx-aurora fx-aurora-b', 'fx-aurora fx-aurora-c', 'fx-ribbon'].forEach((c) => stage.appendChild(d.createElement('i')).className = c);
    const dust = stage.appendChild(d.createElement('canvas')); dust.className = 'fx-dust';
    const grain = stage.appendChild(d.createElement('i')); grain.className = 'fx-grain';
    stage.appendChild(d.createElement('i')).className = 'fx-vignette';
    d.body.prepend(stage);
    paintGrain(grain);
    runDust(dust);
  }

  function paintGrain(node) {
    try {
      const c = d.createElement('canvas'); c.width = c.height = 180;
      const g = c.getContext('2d'); const img = g.createImageData(180, 180);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255 | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      g.putImageData(img, 0, 0);
      node.style.backgroundImage = 'url(' + c.toDataURL('image/png') + ')';
    } catch { node.remove(); }
  }

  function runDust(canvas) {
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let w = 0, h = 0, dpr = 1, raf = 0, motes = [];
    const count = () => Math.round(Math.min(90, Math.max(28, (w * h) / 26000)));
    const spawn = (y) => ({ x: Math.random() * w, y: y ?? Math.random() * h, r: .4 + Math.random() * 1.6, vy: -(.08 + Math.random() * .32), vx: (Math.random() - .5) * .12, a: .15 + Math.random() * .55, t: Math.random() * Math.PI * 2 });
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = innerWidth; h = innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      motes = Array.from({ length: count() }, () => spawn());
      draw(0);
    }
    function draw(step) {
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        if (step) { m.t += .02; m.x += m.vx + Math.sin(m.t) * .12; m.y += m.vy; if (m.y < -6) Object.assign(m, spawn(h + 6)); }
        const flicker = m.a * (.7 + .3 * Math.sin(m.t * 2));
        const glow = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r * 4);
        glow.addColorStop(0, 'rgba(255,241,194,' + flicker + ')');
        glow.addColorStop(.35, 'rgba(212,175,55,' + flicker * .55 + ')');
        glow.addColorStop(1, 'rgba(212,175,55,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 4, 0, Math.PI * 2); ctx.fill();
      }
    }
    const loop = () => { draw(1); raf = requestAnimationFrame(loop); };
    const start = () => { cancelAnimationFrame(raf); if (!reduce.matches && !d.hidden) raf = requestAnimationFrame(loop); };
    let resizeTimer = 0;
    addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { resize(); start(); }, 150); }, { passive: true });
    d.addEventListener('visibilitychange', start);
    reduce.addEventListener?.('change', start);
    resize(); start();
  }

  /* ---------- Decorate components ---------- */
  const offscreen = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const e of entries) e.target.classList.toggle('fx-paused', !e.isIntersecting);
  }, { rootMargin: '120px' }) : null;

  function decorate(root) {
    root.querySelectorAll(ORBIT).forEach((el) => {
      if (el.querySelector(':scope>.fx-orbit')) return;
      ensurePositioned(el);
      el.classList.add('fx-orbit-host');
      el.appendChild(layer('fx-orbit'));
      offscreen?.observe(el);
    });
    root.querySelectorAll(BORDER).forEach((el) => {
      if (el.querySelector(':scope>.fx-border')) return;
      ensurePositioned(el);
      el.appendChild(layer('fx-border'));
      offscreen?.observe(el);
    });
    if (finePointer.matches) root.querySelectorAll(SPOT).forEach((el) => {
      if (el.querySelector(':scope>.fx-spot')) return;
      ensurePositioned(el);
      el.classList.add('fx-spot-host');
      el.prepend(layer('fx-spot'));
      el.appendChild(layer('fx-spot-ring'));
    });
    root.querySelectorAll('svg.i>use').forEach((use) => {
      const svg = use.parentNode; if (svg.dataset.fxIcon) return;
      const ref = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
      const id = ref.split('#i-')[1]; if (id) svg.dataset.fxIcon = id;
    });
  }

  /* Spotlight: one delegated, rAF-throttled listener updates two CSS variables */
  let frame = 0;
  d.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch') return;
    const host = ev.target.closest?.('.fx-spot-host'); if (!host) return;
    const { clientX, clientY } = ev;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const b = host.getBoundingClientRect();
      host.style.setProperty('--fx-x', (clientX - b.left) + 'px');
      host.style.setProperty('--fx-y', (clientY - b.top) + 'px');
    });
  }, { passive: true });

  /* Scroll reveal for landing sections and event settings */
  function reveal() {
    if (reduce.matches || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('fx-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: .05 });
    d.querySelectorAll(REVEAL).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight) return; // already on screen: never hide visible content
      el.classList.add('fx-reveal'); el.style.transitionDelay = Math.min(i % 4, 3) * 70 + 'ms'; io.observe(el);
    });
  }

  /* Re-apply when scripts re-render buttons, cards or icons */
  let pending = 0;
  const mo = new MutationObserver(() => { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; decorate(d.body); }); });

  function init() {
    buildStage();
    decorate(d.body);
    reveal();
    mo.observe(d.body, { childList: true, subtree: true });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
