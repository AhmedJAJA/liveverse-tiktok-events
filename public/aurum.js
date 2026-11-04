/* SPONGE LIVE — AURUM UI runtime (no dependencies, progressive enhancement).
   Native rebuilds of Aceternity UI effects. It only adds aria-hidden decorative
   layers and CSS variables; it never changes text, ids, values or listeners
   that the game scripts own, so every page works the same without it. */
(() => {
  'use strict';
  const d = document, body = d.body;
  if (!body) return;
  const broadcast = body.classList.contains('broadcast');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  // Performance mode (dashboard toggle, or ?perf=1 on the OBS screen) switches the heavy layers off.
  try { if (localStorage.getItem('sky_perf') === '1') d.documentElement.classList.add('au-perf'); } catch { /* storage blocked */ }
  const perf = () => d.documentElement.classList.contains('au-perf');
  const runners = new Set();
  new MutationObserver(() => { for (const run of runners) run(); }).observe(d.documentElement, { attributes: true, attributeFilter: ['class'] });
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const supportsPath = typeof CSS !== 'undefined' && CSS.supports?.('offset-path', 'path("M0 0H1")');

  /* Page wiring: which existing elements receive which effect. */
  const CONFIG = {
    movingBorder: [
      ['.gold-button,.btn-gold,.button.primary,.play-button,.presenter-start,.start-game,.verify-access,.sh-btn-gold', { dur: 3, size: 80 }],
      ['.signup-command', { dur: 5, size: 180, w: 2 }],
      ['.connect-card,.cta-card,.season-hero,.event-hero,.question-card,.sh-final,.sh-plan.is-annual,.sh-platforms', { dur: 7, size: 160 }],
      ['.sh-phone', { dur: 6, size: 140, w: 2 }],
      ['.hero-player.rank-one,.winner-stage,.victory-card', { dur: 4.2, size: 120, w: 2 }],
      ['.mode,.signup-member-card,.length-option,.audience-option', { dur: 4, size: 110, when: true }]
    ],
    spotlight: '.sh-quick-row,.game-tile,.category-card,.hero-player,.mode,.stat,.panel,.how-grid>div,.form-strip,.audience-setting,.advanced-panel,.connect-card,.pass-card,.cta-card,.daily-strip,.tools-strip,.block,.reg-person,.leader-row',
    reveal: '.landing h1,.landing h2,.event-page .setting-block h2,.event-page .section-row h2,.presenter .section-heading h2,.presenter .block-head h3,.bomb-page h2',
    retext: '#overlayPrompt,#signupLatestName,#winnerName,#signupTitle,#bombHolderName,#bombWinnerName,.event-caption h1,#presenterStartLabel',
    shimmer: '.sh-gold,.sh-plan.is-annual .sh-price b,.season-copy h2 span,#signupKeyword,.results-heading h2 span,.signup-counter b,.winner-banner-copy strong,.event-caption h1,.how-grid span',
    glowing: '.sh-step,.sh-plan,.sh-platform,.sh-champions,.sh-pass,.presenter .stat,.presenter .panel,.how-grid>div',
    card3d: '.sh-cover,.sh-live-card,.presenter .mode',
    spot: '.sh-hero,.sh-final',
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
    // Same path family as Aceternity's BackgroundBeams: each path shifted 7px right / 8px up.
    const n = broadcast ? 30 : 50;
    const path = (i) => { const x = i * 7, y = i * 8; return `M${-380 + x} ${-189 - y}C${-380 + x} ${-189 - y} ${-312 + x} ${216 - y} ${152 + x} ${343 - y}C${616 + x} ${470 - y} ${684 + x} ${875 - y} ${684 + x} ${875 - y}`; };
    const all = Array.from({ length: n }, (_, i) => path(i));
    const animate = !reduce.matches;
    // Every path carries its own gradient whose x1/x2/y1/y2 sweep 0% → 100% (10–20s, 0–10s delay).
    const grads = all.map((_, i) => {
      const dur = rand(10, 20).toFixed(2) + 's', begin = rand(0, 10).toFixed(2) + 's', y2 = (93 + rand(0, 8)).toFixed(1) + '%';
      const sweep = (attr, to) => animate ? `<animate attributeName="${attr}" values="0%;${to}" dur="${dur}" begin="${begin}" repeatCount="indefinite"/>` : '';
      return `<linearGradient id="au-bg-${i}" x1="0%" x2="0%" y1="0%" y2="0%">${sweep('x1', '100%')}${sweep('x2', '95%')}${sweep('y1', '100%')}${sweep('y2', y2)}
        <stop stop-color="#C2F3FF" stop-opacity="0"/><stop stop-color="#C2F3FF"/><stop offset="32.5%" stop-color="#37B3D4"/><stop offset="100%" stop-color="#227F9C" stop-opacity="0"/></linearGradient>`;
    }).join('');
    const wrap = tpl(`<div class="au-beams${container === body ? ' is-fixed' : ''}" aria-hidden="true"><svg viewBox="0 0 696 316" preserveAspectRatio="xMidYMid slice" focusable="false">
      <path class="au-beam-base" d="${all.join('')}" stroke="url(#au-beam-fade)" stroke-opacity=".05" stroke-width=".5"/>
      ${all.map((d, i) => `<path class="au-beam" d="${d}" stroke="url(#au-bg-${i})" stroke-opacity=".4" stroke-width=".5"/>`).join('')}
      <defs>${grads}
        <radialGradient id="au-beam-fade" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(352 34) rotate(90) scale(555 1560.62)"><stop offset=".0667" stop-color="#63C9E6"/><stop offset=".2432" stop-color="#63C9E6"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
      </defs>
    </svg></div>`);
    container.prepend(wrap);
    const svg = wrap.firstElementChild;
    if (visibility && svg.pauseAnimations) new IntersectionObserver(([e]) => { e.isIntersecting ? svg.unpauseAnimations() : svg.pauseAnimations(); }).observe(wrap);
    d.addEventListener('visibilitychange', () => { if (svg.pauseAnimations) d.hidden ? svg.pauseAnimations() : svg.unpauseAnimations(); });
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
    if (reduce.matches || perf()) return;
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
    const run = () => { cancelAnimationFrame(raf); raf = 0; if (on && !d.hidden && !reduce.matches && !perf()) raf = requestAnimationFrame(loop); else draw(false); };
    runners.add(run);
    new ResizeObserver(() => { size(); draw(false); }).observe(wrap);
    if (visibility) new IntersectionObserver(([e]) => { on = e.isIntersecting; run(); }).observe(host);
    d.addEventListener('visibilitychange', run);
    size(); run();
  }


  /* ================= 3D Card (CardContainer: rotateY/rotateX = offset / 25, perspective 1000px) ================= */
  function card3d(host) {
    if (host.classList.contains('au-3d')) return;
    host.classList.add('au-3d'); host.parentElement?.classList.add('au-3d-scene');
    host.querySelectorAll(':scope>.sh-cover-title,:scope>.crest,:scope>.sh-live-info,:scope>.sh-live-top').forEach((el) => el.classList.add('au-3d-item'));
  }
  let t3Frame = 0, t3Host = null;
  d.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch' || reduce.matches) return;
    const host = ev.target.closest?.('.au-3d');
    if (t3Host && t3Host !== host) { t3Host.style.setProperty('--au-ry', '0deg'); t3Host.style.setProperty('--au-rx', '0deg'); t3Host.classList.remove('is-tilting'); }
    t3Host = host; if (!host) return;
    const { clientX, clientY } = ev;
    cancelAnimationFrame(t3Frame);
    t3Frame = requestAnimationFrame(() => {
      const b = host.getBoundingClientRect();
      host.style.setProperty('--au-ry', ((clientX - b.left - b.width / 2) / 25).toFixed(2) + 'deg');
      host.style.setProperty('--au-rx', ((clientY - b.top - b.height / 2) / 25).toFixed(2) + 'deg');
      host.classList.add('is-tilting');
    });
  }, { passive: true });
  d.addEventListener('pointerleave', () => { if (t3Host) { t3Host.style.setProperty('--au-ry', '0deg'); t3Host.style.setProperty('--au-rx', '0deg'); t3Host.classList.remove('is-tilting'); t3Host = null; } }, true);

  /* ================= Glowing Effect (inactiveZone .7, proximity 64, spread 20, movementDuration 2s) ================= */
  const glows = new Set();
  function glowing(host) {
    if (host.querySelector(':scope>.au-glow')) return;
    positioned(host);
    const g = span('au-glow'); g.angle = 0; g.target = 0; host.append(g); glows.add(g);
  }
  let glowFrame = 0, glowPoint = null, glowAnim = 0;
  function glowTick() {
    if (!glowPoint) return;
    let moving = false;
    for (const g of glows) {
      const host = g.parentElement; if (!host) { glows.delete(g); continue; }
      const b = host.getBoundingClientRect();
      if (b.bottom < -100 || b.top > innerHeight + 100) { g.style.setProperty('--au-active', '0'); continue; }
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2, [mx, my] = glowPoint, prox = 64;
      const inactive = .5 * Math.min(b.width, b.height) * .7;
      const near = mx > b.left - prox && mx < b.right + prox && my > b.top - prox && my < b.bottom + prox;
      const active = near && Math.hypot(mx - cx, my - cy) >= inactive;
      g.style.setProperty('--au-active', active ? '1' : '0');
      if (!active) continue;
      g.target = (180 * Math.atan2(my - cy, mx - cx)) / Math.PI + 90;
      const diff = ((g.target - g.angle + 180) % 360 + 360) % 360 - 180;
      if (Math.abs(diff) > .3) { g.angle += diff * .06; moving = true; }   // eased approach ≈ 2s like the original
      g.style.setProperty('--au-start', g.angle.toFixed(2));
    }
    glowAnim = moving ? requestAnimationFrame(glowTick) : 0;
  }
  if (!broadcast) {
    d.addEventListener('pointermove', (ev) => {
      if (ev.pointerType === 'touch' || reduce.matches) return;
      glowPoint = [ev.clientX, ev.clientY];
      cancelAnimationFrame(glowFrame);
      glowFrame = requestAnimationFrame(() => { if (!glowAnim) glowAnim = requestAnimationFrame(glowTick); });
    }, { passive: true });
    addEventListener('scroll', () => { if (glowPoint && !glowAnim) glowAnim = requestAnimationFrame(glowTick); }, { passive: true });
  }

  /* ================= Spotlight (blurred light beam that sweeps into the hero) ================= */
  function heroSpot(host) {
    if (host.querySelector(':scope>.au-spot')) return;
    positioned(host);
    host.prepend(tpl(`<svg class="au-spot" viewBox="0 0 3787 2842" fill="none" aria-hidden="true" focusable="false"><g filter="url(#au-spot-blur)"><ellipse cx="1924.71" cy="273.501" rx="1924.71" ry="273.501" transform="matrix(-0.822377 -0.568943 -0.568943 0.822377 3631.88 2291.09)" fill-opacity=".21"/></g><defs><filter id="au-spot-blur" x="0.86" y="0.84" width="3785.16" height="2840.26" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="bg"/><feBlend mode="normal" in="SourceGraphic" in2="bg" result="shape"/><feGaussianBlur stdDeviation="151"/></filter></defs></svg>`));
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
        // Aceternity AnimatedTooltip: x = offset from the element centre, mapped [-100,100] → [-45°,45°] and [-50,50]px.
        const x = Math.max(-100, Math.min(100, clientX - (b.left + b.width / 2)));
        tip.style.setProperty('--au-rot', (x * .45).toFixed(2) + 'deg');
        tip.style.setProperty('--au-shift', (x * .5).toFixed(1) + 'px');
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
    if (fine.matches && !broadcast) {
      root.querySelectorAll(CONFIG.spotlight).forEach(spotlight);
      root.querySelectorAll(CONFIG.glowing).forEach(glowing);
      root.querySelectorAll(CONFIG.card3d).forEach(card3d);
    }
    root.querySelectorAll(CONFIG.shimmer).forEach((el) => el.classList.add('au-shimmer'));
    tagIcons(root);
  }
  let pending = 0;
  const mo = new MutationObserver(() => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; decorate(body); }); });

  function init() {
    stage();
    beams(d.querySelector(CONFIG.beams));
    if (!broadcast) d.querySelectorAll(CONFIG.spot).forEach(heroSpot);
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

  window.Aurum = Object.freeze({ burst, sparkleField, movingBorder, spotlight, reveal, glowing, card3d });
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
