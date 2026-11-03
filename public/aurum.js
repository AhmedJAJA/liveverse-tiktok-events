/* SKY LIVE — AURUM UI runtime (no dependencies, progressive enhancement).
   Native rebuilds of Aceternity UI effects. It only adds aria-hidden decorative
   layers and CSS variables; it never changes text, ids, values or listeners
   that the game scripts own, so every page works the same without it. */
(() => {
  'use strict';
  const d = document, body = d.body;
  if (!body) return;
  const broadcast = body.classList.contains('broadcast');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const supportsPath = typeof CSS !== 'undefined' && CSS.supports?.('offset-path', 'path("M0 0H1")');

  /* Page wiring: which existing elements receive which effect. */
  const CONFIG = {
    movingBorder: [
      ['.gold-button,.btn-gold,.button.primary,.play-button,.presenter-start,.start-game,.verify-access,.sh-btn-gold', { dur: 3.6, size: 70 }],
      ['.signup-command', { dur: 5, size: 180, w: 2 }],
      ['.connect-card,.cta-card,.season-hero,.event-hero,.question-card,.sh-final,.sh-plan.is-annual,.sh-platforms', { dur: 7, size: 160 }],
      ['.sh-phone', { dur: 6, size: 140, w: 2 }],
      ['.hero-player.rank-one,.winner-stage,.victory-card', { dur: 4.2, size: 120, w: 2 }],
      ['.mode,.signup-member-card,.length-option,.audience-option', { dur: 4, size: 110, when: true }]
    ],
    spotlight: '.sh-step,.sh-plan,.sh-platform,.sh-champions,.sh-pass,.sh-quick-row,.game-tile,.category-card,.hero-player,.mode,.stat,.panel,.how-grid>div,.form-strip,.audience-setting,.advanced-panel,.connect-card,.pass-card,.cta-card,.daily-strip,.tools-strip,.block,.reg-person,.leader-row',
    reveal: '.landing h1,.landing h2,.event-page .setting-block h2,.event-page .section-row h2,.presenter .section-heading h2,.presenter .block-head h3,.bomb-page h2',
    retext: '#overlayPrompt,#signupLatestName,#winnerName,#signupTitle,#bombHolderName,#bombWinnerName,.event-caption h1,#presenterStartLabel',
    shimmer: '.sh-gold,.sh-plan.is-annual .sh-price b,.season-copy h2 span,#signupKeyword,.results-heading h2 span,.signup-counter b,.winner-banner-copy strong,.event-caption h1,.how-grid span',
    tooltip: '[data-tooltip],[data-au-tip]',
    beams: broadcast ? '.arena' : 'body'
  };

  const tpl = (markup) => { const t = d.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstElementChild; };
  const span = (cls) => { const s = d.createElement('span'); s.className = cls; s.setAttribute('aria-hidden', 'true'); return s; };
  const positioned = (el) => { if (getComputedStyle(el).position === 'static') el.style.position = 'relative'; };
  const rand = (a, b) => a + Math.random() * (b - a);

  const visibility = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const e of entries) e.target.classList.toggle('au-paused', !e.isIntersecting);
  }, { rootMargin: '150px' }) : null;

  /* ================= Moving Border ================= */
  function roundedRect(w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    const f = (n) => Math.round(n * 10) / 10;
    return `path("M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}V${f(h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}H${f(r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z")`;
  }
  const mbSize = 'ResizeObserver' in window ? new ResizeObserver((entries) => {
    for (const e of entries) {
      const host = e.target.parentElement; if (!host) continue;
      const w = e.target.clientWidth, h = e.target.clientHeight; if (!w || !h) continue;
      const r = parseFloat(getComputedStyle(host).borderTopLeftRadius) || 0;
      e.target.style.setProperty('--au-mb-path', roundedRect(w, h, r));
    }
  }) : null;
  function movingBorder(host, o) {
    if (host.querySelector(':scope>.au-mb')) return;
    positioned(host);
    host.classList.add('au-mb-host');
    if (o.when) host.classList.add('au-mb-when-active');
    const ring = span('au-mb');
    ring.style.setProperty('--au-mb-dur', o.dur + 's');
    ring.style.setProperty('--au-mb-size', o.size + 'px');
    if (o.w) ring.style.setProperty('--au-mb-w', o.w + 'px');
    if (supportsPath && mbSize) {
      ring.append(span('au-mb-orb'), span('au-mb-orb'));
      mbSize.observe(ring);
    } else ring.classList.add('is-fallback');
    host.append(ring);
    visibility?.observe(host);
  }

  /* ================= Card Spotlight ================= */
  function spotlight(host) {
    if (host.querySelector(':scope>.au-cs')) return;
    positioned(host);
    host.classList.add('au-cs-host');
    const layer = span('au-cs'); layer.append(d.createElement('i'), d.createElement('i'));
    host.prepend(layer);
    host.append(span('au-cs-edge'));
  }
  let csFrame = 0;
  d.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch') return;
    const host = ev.target.closest?.('.au-cs-host'); if (!host) return;
    const { clientX, clientY } = ev;
    cancelAnimationFrame(csFrame);
    csFrame = requestAnimationFrame(() => {
      const b = host.getBoundingClientRect();
      host.style.setProperty('--au-x', (clientX - b.left) + 'px');
      host.style.setProperty('--au-y', (clientY - b.top) + 'px');
    });
  }, { passive: true });

  /* ================= Background Beams ================= */
  function beams(container) {
    if (!container || container.querySelector(':scope>.au-beams')) return;
    const n = broadcast ? 30 : 40;
    let paths = '';
    for (let i = 0; i < n; i++) {
      const x = i * 7, y = i * 8;
      paths += `M${-380 + x} ${-189 - y}C${-380 + x} ${-189 - y} ${-312 + x} ${216 - y} ${152 + x} ${343 - y}C${616 + x} ${470 - y} ${684 + x} ${875 - y} ${684 + x} ${875 - y}`;
    }
    const lit = [];
    for (let i = 0; i < n; i += broadcast ? 3 : 2) {
      const x = i * 7, y = i * 8;
      lit.push(`M${-380 + x} ${-189 - y}C${-380 + x} ${-189 - y} ${-312 + x} ${216 - y} ${152 + x} ${343 - y}C${616 + x} ${470 - y} ${684 + x} ${875 - y} ${684 + x} ${875 - y}`);
    }
    const wrap = tpl(`<div class="au-beams${container === body ? ' is-fixed' : ''}" aria-hidden="true"><svg viewBox="0 0 696 316" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <linearGradient id="au-beam-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF6D8"/><stop offset=".4" stop-color="#F1D58C"/><stop offset=".7" stop-color="#D4AF37"/><stop offset="1" stop-color="#9C7A22" stop-opacity="0"/></linearGradient>
        <radialGradient id="au-beam-fade" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(352 34) rotate(90) scale(555 1560)"><stop offset=".07" stop-color="#D4AF37" stop-opacity=".55"/><stop offset=".55" stop-color="#9C7A22" stop-opacity=".2"/><stop offset="1" stop-color="#9C7A22" stop-opacity="0"/></radialGradient>
      </defs>
      <path class="au-beam-base" d="${paths}"/>
      ${lit.map((p) => `<path class="au-beam is-glow" d="${p}" pathLength="1"/><path class="au-beam" d="${p}" pathLength="1"/>`).join('')}
    </svg></div>`);
    const live = wrap.querySelectorAll('.au-beam');
    for (let i = 0; i < live.length; i += 2) {
      const dur = rand(9, 19).toFixed(1) + 's', delay = (-rand(0, 18)).toFixed(1) + 's';
      for (const el of [live[i], live[i + 1]]) { el.style.setProperty('--d', dur); el.style.setProperty('--dl', delay); }
    }
    container.prepend(wrap);
  }

  /* ================= Sparkles ================= */
  // Four-point star, the Aceternity sparkle silhouette.
  function star(ctx, x, y, r, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.beginPath();
    const k = r * .2;
    ctx.moveTo(0, -r); ctx.quadraticCurveTo(k, -k, r, 0); ctx.quadraticCurveTo(k, k, 0, r); ctx.quadraticCurveTo(-k, k, -r, 0); ctx.quadraticCurveTo(-k, -k, 0, -r);
    ctx.fill(); ctx.restore();
  }
  const GOLDS = ['255,246,216', '241,213,140', '230,196,99', '212,175,55', '255,255,255'];
  let burstCanvas = null, burstCtx = null, burstParts = [], burstRaf = 0;
  function burst(target, opts = {}) {
    if (reduce.matches) return;
    const rect = target?.getBoundingClientRect ? target.getBoundingClientRect() : null;
    const cx = opts.x ?? (rect ? rect.left + rect.width / 2 : innerWidth / 2);
    const cy = opts.y ?? (rect ? rect.top + rect.height / 2 : innerHeight / 2);
    // On the fixed broadcast canvas (and its scaled studio preview) particle sizes follow the canvas scale.
    const k = broadcast ? Math.max(.35, Math.max(innerWidth, innerHeight) / 1920) : 1;
    const count = opts.count ?? 70, spread = (opts.spread ?? (rect ? Math.max(rect.width, rect.height) * .5 : 200)) * k;
    if (!burstCanvas) {
      burstCanvas = d.createElement('canvas'); burstCanvas.className = 'au-burst'; burstCanvas.setAttribute('aria-hidden', 'true');
      body.append(burstCanvas); burstCtx = burstCanvas.getContext('2d');
    }
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (burstCanvas.width !== innerWidth * dpr) { burstCanvas.width = innerWidth * dpr; burstCanvas.height = innerHeight * dpr; }
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(1.5, 7.5) * (spread / 200 + .6);
      burstParts.push({ x: cx + Math.cos(a) * rand(0, spread * .2), y: cy + Math.sin(a) * rand(0, spread * .2), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(.5, 2.5), r: rand(3, 11) * k, rot: rand(0, 3), vr: rand(-.12, .12), life: 1, decay: rand(.008, .02), c: GOLDS[i % GOLDS.length] });
    }
    if (!burstRaf) burstRaf = requestAnimationFrame(stepBurst);
  }
  function stepBurst() {
    const ctx = burstCtx, dpr = burstCanvas.width / innerWidth;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, innerWidth, innerHeight);
    burstParts = burstParts.filter((p) => p.life > 0);
    for (const p of burstParts) {
      p.x += p.vx; p.y += p.vy; p.vx *= .97; p.vy = p.vy * .97 + .09; p.rot += p.vr; p.life -= p.decay;
      const tw = .55 + .45 * Math.sin(p.life * 28);
      ctx.fillStyle = `rgba(${p.c},${Math.max(0, p.life * tw)})`;
      ctx.shadowColor = `rgba(${p.c},.9)`; ctx.shadowBlur = 8;
      star(ctx, p.x, p.y, p.r * (.5 + p.life * .5), p.rot);
    }
    if (burstParts.length) burstRaf = requestAnimationFrame(stepBurst);
    else { burstRaf = 0; ctx.clearRect(0, 0, innerWidth, innerHeight); }
  }
  // Ambient field (SparklesCore): twinkling gold particles that drift upward inside a container.
  function sparkleField(host, density = 1) {
    if (host.querySelector(':scope>.au-sparkles')) return;
    positioned(host);
    const wrap = span('au-sparkles'), canvas = d.createElement('canvas'); wrap.append(canvas); host.prepend(wrap);
    const ctx = canvas.getContext('2d'); let w = 0, h = 0, parts = [], raf = 0, on = true;
    const make = (y) => ({ x: rand(0, w), y: y ?? rand(0, h), r: rand(.6, 2.2), vy: -rand(.05, .35), vx: rand(-.12, .12), t: rand(0, 6.3), s: rand(.02, .06), c: GOLDS[Math.random() * 4 | 0] });
    const size = () => {
      const dpr = Math.min(devicePixelRatio || 1, 1.5); w = wrap.clientWidth; h = wrap.clientHeight; if (!w || !h) return;
      canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      parts = Array.from({ length: Math.round(Math.min(160, (w * h) / 9000) * density) }, () => make());
    };
    const draw = (move) => {
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        if (move) { p.x += p.vx; p.y += p.vy; p.t += p.s; if (p.y < -4) Object.assign(p, make(h + 4)); }
        const a = .25 + .75 * Math.abs(Math.sin(p.t));
        ctx.fillStyle = `rgba(${p.c},${a})`;
        if (p.r > 1.7) star(ctx, p.x, p.y, p.r * 2.4, p.t * .3);
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
      }
    };
    const loop = () => { draw(true); raf = requestAnimationFrame(loop); };
    const run = () => { cancelAnimationFrame(raf); raf = 0; if (on && !d.hidden && !reduce.matches) raf = requestAnimationFrame(loop); else draw(false); };
    new ResizeObserver(() => { size(); draw(false); }).observe(wrap);
    if (visibility) new IntersectionObserver(([e]) => { on = e.isIntersecting; run(); }).observe(host);
    d.addEventListener('visibilitychange', run);
    size(); run();
  }

  /* ================= Animated Tooltip ================= */
  let tip = null, tipHost = null, tipFrame = 0;
  function ensureTip() {
    if (tip) return tip;
    tip = tpl('<div class="au-tip" id="au-tip" role="tooltip"><span class="au-tip-body"></span></div>');
    body.append(tip); d.documentElement.classList.add('au-tips');
    return tip;
  }
  function showTip(host) {
    const text = host.getAttribute('data-tooltip') || host.getAttribute('data-au-tip'); if (!text) return;
    ensureTip(); tipHost = host;
    tip.firstChild.textContent = text;
    const b = host.getBoundingClientRect();
    const below = b.top < 90;
    tip.classList.toggle('is-below', below);
    const x = Math.min(Math.max(b.left + b.width / 2, 150), innerWidth - 150);
    tip.style.setProperty('--tx', x + 'px');
    tip.style.setProperty('--ty', (below ? b.bottom : b.top) + 'px');
    tip.style.setProperty('--au-rot', '0deg'); tip.style.setProperty('--au-shift', '0px');
    host.setAttribute('aria-describedby', 'au-tip');
    requestAnimationFrame(() => tip.classList.add('is-on'));
  }
  function hideTip(host) {
    if (!tip || (host && host !== tipHost)) return;
    tip.classList.remove('is-on'); tipHost?.removeAttribute('aria-describedby'); tipHost = null;
  }
  function wireTooltips() {
    if (broadcast) return;
    d.addEventListener('pointerover', (ev) => {
      if (ev.pointerType === 'touch') return;
      const host = ev.target.closest?.(CONFIG.tooltip); if (host && host !== tipHost) showTip(host);
    });
    d.addEventListener('pointerout', (ev) => {
      const host = ev.target.closest?.(CONFIG.tooltip); if (host && !host.contains(ev.relatedTarget)) hideTip(host);
    });
    d.addEventListener('pointermove', (ev) => {
      if (!tipHost || !tipHost.contains(ev.target)) return;
      const { clientX } = ev;
      cancelAnimationFrame(tipFrame);
      tipFrame = requestAnimationFrame(() => {
        if (!tipHost) return;
        const b = tipHost.getBoundingClientRect();
        const rel = Math.max(-1, Math.min(1, (clientX - (b.left + b.width / 2)) / Math.max(b.width / 2, 1)));
        tip.style.setProperty('--au-rot', (rel * 8).toFixed(2) + 'deg');
        tip.style.setProperty('--au-shift', (rel * 16).toFixed(1) + 'px');
      });
    }, { passive: true });
    d.addEventListener('focusin', (ev) => { const host = ev.target.closest?.(CONFIG.tooltip); if (host && ev.target.matches(':focus-visible')) showTip(host); });
    d.addEventListener('focusout', (ev) => { const host = ev.target.closest?.(CONFIG.tooltip); if (host) hideTip(host); });
    addEventListener('scroll', () => hideTip(), { passive: true });
    d.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hideTip(); });
  }

  /* ================= Text Reveal / Retext / Shimmer ================= */
  const revealIO = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-revealed'); revealIO.unobserve(e.target); }
  }, { threshold: .2 }) : null;
  function splitWords(el) {
    if (el.dataset.auSplit) return;
    el.dataset.auSplit = '1';
    let i = 0;
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          const parts = child.textContent.split(/(\s+)/);
          if (parts.every((p) => !p.trim())) continue;
          const frag = d.createDocumentFragment();
          for (const p of parts) {
            if (!p) continue;
            if (!p.trim()) { frag.append(p); continue; }
            const w = d.createElement('span'); w.className = 'au-w'; w.textContent = p; w.style.setProperty('--i', i++); frag.append(w);
          }
          child.replaceWith(frag);
        } else if (child.nodeType === 1 && !child.matches('svg,.au-w')) {
          // gradient-clipped spans keep their own paint; reveal them as one word
          if (getComputedStyle(child).backgroundClip === 'text' || child.classList.contains('au-shimmer')) { child.classList.add('au-w'); child.style.setProperty('--i', i++); }
          else walk(child);
        }
      }
    };
    walk(el);
  }
  function reveal(el) {
    if (reduce.matches || !revealIO) return;
    if (el.closest('[hidden],dialog:not([open])') && !el.closest('dialog')) return;
    splitWords(el); revealIO.observe(el);
  }
  const retextSeen = new WeakMap();
  const retextMO = new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target.closest(CONFIG.retext) : r.target.parentElement?.closest(CONFIG.retext);
      if (!el || reduce.matches) continue;
      const text = el.textContent;
      if (retextSeen.get(el) === text) continue;
      retextSeen.set(el, text);
      el.classList.remove('au-retext'); void el.offsetWidth; el.classList.add('au-retext');
    }
  });

  /* ================= Celebrations (Sparkles) ================= */
  function celebrate() {
    const watch = (sel, fn) => { const el = d.querySelector(sel); if (!el) return; let was = !el.hidden;
      new MutationObserver(() => { const now = !el.hidden && !el.closest('[hidden]'); if (now && !was) fn(el); was = now; }).observe(el, { attributes: true, attributeFilter: ['hidden'] }); };
    watch('#winnerBanner', (el) => { const crest = el.querySelector('.winner-crest') || el; burst(crest, { count: 140, spread: 420 }); setTimeout(() => burst(crest, { count: 90, spread: 300 }), 650); });
    watch('#roundResultsOverlay', (el) => setTimeout(() => burst(el.querySelector('.results-podium') || el, { count: 120, spread: 500 }), 500));
    watch('#bombVictory', (el) => burst(el.querySelector('.victory-crest') || el, { count: 150, spread: 420 }));
    const spot = d.querySelector('.signup-spotlight');
    if (spot) new MutationObserver(() => { if (spot.classList.contains('joined')) burst(spot.querySelector('.spotlight-medallion') || spot, { count: 60, spread: 220 }); }).observe(spot, { attributes: true, attributeFilter: ['class'] });
    // Studio: choosing a game drops a small gold burst on the selected card.
    d.addEventListener('click', (ev) => { const m = ev.target.closest?.('.mode'); if (m) burst(m.querySelector('.crest') || m, { count: 26, spread: 90 }); });
  }

  /* ================= Cinematic stage (aurora, gold dust, grain) ================= */
  function stage() {
    if (broadcast || d.querySelector('.au-stage')) return;
    const s = tpl('<div class="au-stage" aria-hidden="true"><i class="au-aurora a"></i><i class="au-aurora b"></i><i class="au-aurora c"></i><i class="au-grain"></i><i class="au-vignette"></i></div>');
    body.prepend(s);
    try {
      const c = d.createElement('canvas'); c.width = c.height = 160;
      const g = c.getContext('2d'), img = g.createImageData(160, 160);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255 | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      g.putImageData(img, 0, 0);
      s.querySelector('.au-grain').style.backgroundImage = 'url(' + c.toDataURL('image/png') + ')';
    } catch { /* grain is optional */ }
    sparkleField(s, .55);
  }

  /* ================= Icons: per-symbol micro-motion hooks ================= */
  function tagIcons(root) {
    root.querySelectorAll('svg.i>use,svg>use[href^="/icons.svg#i-"]').forEach((use) => {
      const svg = use.parentNode; if (svg.dataset.auIcon) return;
      const id = (use.getAttribute('href') || '').split('#i-')[1]; if (id) svg.dataset.auIcon = id;
    });
  }

  /* ================= Apply & keep applying ================= */
  function decorate(root) {
    for (const [sel, opts] of CONFIG.movingBorder) root.querySelectorAll(sel).forEach((el) => movingBorder(el, opts));
    if (fine.matches && !broadcast) root.querySelectorAll(CONFIG.spotlight).forEach(spotlight);
    root.querySelectorAll(CONFIG.shimmer).forEach((el) => el.classList.add('au-shimmer'));
    tagIcons(root);
  }
  let pending = 0;
  const mo = new MutationObserver(() => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; decorate(body); }); });

  function init() {
    stage();
    beams(d.querySelector(CONFIG.beams));
    decorate(body);
    d.querySelectorAll(CONFIG.reveal).forEach(reveal);
    d.querySelectorAll(CONFIG.retext).forEach((el) => { retextSeen.set(el, el.textContent); retextMO.observe(el, { childList: true, characterData: true, subtree: true }); });
    wireTooltips();
    celebrate();
    // Ambient sparkles around celebration moments and the registration spotlight.
    d.querySelectorAll('.signup-spotlight,.winner-banner,.bomb-victory,.season-hero,.results-heading,.sh-final,.sh-hero').forEach((el) => sparkleField(el, broadcast ? .6 : .8));
    mo.observe(body, { childList: true, subtree: true });
    d.documentElement.classList.add('au-ready');
  }

  window.Aurum = Object.freeze({ burst, sparkleField, movingBorder, spotlight, reveal });
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
