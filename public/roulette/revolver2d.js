/* سبونج لايف — «الروليت»: the same prop and trophy drawn in SVG, for «مستوى الرسوميات: منخفض» and for devices
   without WebGL. Same timeline, same poses (timeline.js) — only lighter. Attributes and CSSOM only (the CSP allows
   no inline style attributes). */
import { AIM, REVEAL, span, lerp, clamp01, easeOutBack, easeOutCubic, drumTurn, hammerAim, hammerReveal, recoil, flash, shake, noise, WIN } from './timeline.js';

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, parent = null) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.append(n);
  return n;
}
let uid = 0;

const token = (name, fallback) => { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; } };

export function createStage2D({ chambers = 2 } = {}) {
  const id = 'rr2d' + ++uid;
  const CYAN = token('--sl-cyan', '#38D4FF'), NAVY = token('--sl-navy', '#061A44');
  const svg = el('svg', { viewBox: '-1200 -620 2400 1240', class: 'rr-gl rr-svg', 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid meet' });
  const defs = el('defs', {}, svg);
  const lin = (gid, stops, x2 = 0, y2 = 1) => { const g = el('linearGradient', { id: id + gid, x1: 0, y1: 0, x2, y2 }, defs); stops.forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, g)); };
  lin('steel', [[0, '#eef3fa'], [0.35, '#aeb9c9'], [0.55, '#6f7c90'], [0.8, '#c9d3e0'], [1, '#56627a']]);
  lin('drum', [[0, '#dbe3ee'], [0.5, '#7c8aa0'], [1, '#3d4759']]);
  lin('grip', [[0, '#ffe36a'], [0.6, '#ffd02a'], [1, '#e2a400']], 1, 1);
  lin('gold', [[0, '#fff2b8'], [0.35, '#ffd24a'], [0.7, '#d89400'], [1, '#ffe48a']], 1, 0);
  const rg = el('radialGradient', { id: id + 'flash' }, defs);
  [[0, '#ffffff'], [0.25, '#fff2b0'], [0.55, 'rgba(255,170,40,.6)'], [1, 'rgba(255,90,20,0)']].forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, rg));
  const pores = el('pattern', { id: id + 'pores', width: 46, height: 46, patternUnits: 'userSpaceOnUse' }, defs);
  el('rect', { width: 46, height: 46, fill: 'url(#' + id + 'grip)' }, pores);
  for (let i = 0; i < 6; i++) el('circle', { cx: 6 + ((i * 17) % 40), cy: 5 + ((i * 29) % 40), r: 2.2 + (i % 3), fill: 'rgba(150,96,0,.55)' }, pores);
  const clip = el('clipPath', { id: id + 'drumclip' }, defs); el('rect', { x: -190, y: -170, width: 380, height: 360, rx: 60 }, clip);

  // the prop (muzzle to the left), drawn around the cylinder at 0,0
  const world = el('g', {}, svg);
  const gun = el('g', {}, world);
  el('rect', { x: -1080, y: -158, width: 860, height: 116, rx: 50, fill: 'url(#' + id + 'steel)', stroke: '#1d2738', 'stroke-width': 6 }, gun); // barrel
  el('rect', { x: -1050, y: -92, width: 600, height: 18, rx: 9, fill: CYAN }, gun);                                            // light strip
  el('rect', { x: -900, y: -40, width: 700, height: 70, rx: 35, fill: 'url(#' + id + 'steel)', stroke: '#1d2738', 'stroke-width': 6 }, gun);  // under-lug
  el('rect', { x: -1080, y: -196, width: 860, height: 44, rx: 12, fill: '#2b3446' }, gun);                                                     // rib
  el('rect', { x: -1086, y: -160, width: 26, height: 120, rx: 10, fill: CYAN }, gun);                                          // muzzle crown
  el('path', { d: 'M-260 -240 H210 Q320 -240 330 -150 L340 150 Q330 230 230 230 H-230 Q-280 230 -280 170 V-190 Q-280 -240 -260 -240 Z M-200 -175 V150 H200 V-175 Z', 'fill-rule': 'evenodd', fill: 'url(#' + id + 'steel)', stroke: '#1d2738', 'stroke-width': 8 }, gun); // frame
  const drumG = el('g', { 'clip-path': 'url(#' + id + 'drumclip)' }, gun);
  el('rect', { x: -190, y: -170, width: 380, height: 360, rx: 60, fill: 'url(#' + id + 'drum)' }, drumG);
  const flutes = el('g', {}, drumG);
  const fluteBars = Array.from({ length: 8 }, () => el('rect', { x: -170, width: 340, height: 34, rx: 17, fill: '#2a3344', opacity: 0.85 }, flutes));
  const hammerG = el('g', { transform: 'translate(250 -210)' }, gun);
  el('path', { d: 'M-30 40 L30 40 L40 -50 Q80 -110 140 -120 L130 -150 Q50 -150 -10 -70 Z', fill: '#2b3446', stroke: '#141b28', 'stroke-width': 6 }, hammerG);
  el('path', { d: 'M-20 230 Q120 420 260 230', fill: 'none', stroke: 'url(#' + id + 'steel)', 'stroke-width': 26, 'stroke-linecap': 'round' }, gun); // guard
  const trig = el('g', { transform: 'translate(110 230)' }, gun);
  el('path', { d: 'M-12 0 Q30 70 -8 120 Q4 60 -26 0 Z', fill: '#2b3446' }, trig);
  el('path', { d: 'M180 220 L420 250 Q500 270 520 380 L590 640 Q600 720 520 720 L360 700 Q300 690 300 620 L270 420 Q250 300 180 220 Z', fill: 'url(#' + id + 'pores)', stroke: '#b07a00', 'stroke-width': 8 }, gun); // sponge grip
  el('circle', { cx: 430, cy: 470, r: 46, fill: CYAN, stroke: '#e9fbff', 'stroke-width': 6 }, gun);
  // flash and smoke at the muzzle
  const fx = el('g', { transform: 'translate(-1130 -100)' }, world);
  const glow = el('circle', { r: 260, fill: 'url(#' + id + 'flash)', opacity: 0 }, fx);
  const star = el('path', { d: Array.from({ length: 18 }, (_, i) => { const r = i % 2 ? 60 : 300 + (i % 4) * 40, a = (i * Math.PI) / 9; return (i ? 'L' : 'M') + (r * Math.cos(a)).toFixed(0) + ' ' + (r * Math.sin(a)).toFixed(0); }).join(' ') + 'Z', fill: '#fff6cf', opacity: 0 }, fx);
  const puffs = Array.from({ length: 6 }, () => el('circle', { r: 60, fill: 'rgba(214,226,244,.2)', opacity: 0 }, fx));
  // the trophy
  const trophy = el('g', { opacity: 0 }, svg);
  el('ellipse', { cx: 0, cy: 520, rx: 300, ry: 46, fill: 'rgba(0,0,0,.35)' }, trophy);
  el('rect', { x: -240, y: 400, width: 480, height: 110, rx: 30, fill: NAVY, stroke: CYAN, 'stroke-width': 8 }, trophy);
  el('path', { d: 'M-90 400 L-60 250 Q-60 200 0 200 Q60 200 60 250 L90 400 Z', fill: 'url(#' + id + 'gold)' }, trophy);
  el('path', { d: 'M-330 -420 H330 Q330 160 0 210 Q-330 160 -330 -420 Z', fill: 'url(#' + id + 'gold)', stroke: '#a86b00', 'stroke-width': 10 }, trophy);
  el('path', { d: 'M-330 -330 Q-520 -330 -480 -140 Q-440 20 -250 60', fill: 'none', stroke: 'url(#' + id + 'gold)', 'stroke-width': 40, 'stroke-linecap': 'round' }, trophy);
  el('path', { d: 'M330 -330 Q520 -330 480 -140 Q440 20 250 60', fill: 'none', stroke: 'url(#' + id + 'gold)', 'stroke-width': 40, 'stroke-linecap': 'round' }, trophy);
  el('path', { d: 'M0 -260 L40 -150 L155 -150 L62 -82 L98 30 L0 -38 L-98 30 L-62 -82 L-155 -150 L-40 -150 Z', fill: CYAN, stroke: '#e9fbff', 'stroke-width': 6 }, trophy);
  const shine = el('rect', { x: -400, y: -440, width: 80, height: 700, fill: 'rgba(255,255,255,.35)', transform: 'skewX(-18)' }, trophy);

  let n = Math.max(2, Math.min(6, chambers | 0));
  function frame(s) {
    if (s.scene === 'trophy') {
      world.setAttribute('opacity', '0'); trophy.setAttribute('opacity', '1');
      const t = Math.max(0, s.ms || 0), rise = s.reduced ? 1 : easeOutBack(t / WIN.rise, 1.25);
      trophy.setAttribute('transform', `translate(0 ${lerp(700, 0, rise).toFixed(1)}) scale(${(0.8 + 0.2 * rise).toFixed(3)})`);
      shine.setAttribute('x', String(-700 + ((t % 3200) / 3200) * 1400));
      return;
    }
    world.setAttribute('opacity', '1'); trophy.setAttribute('opacity', '0');
    if (s.chambers) n = Math.max(2, Math.min(6, s.chambers | 0));
    const u = s.phase === 'aim' ? clamp01(s.u) : 1, t = s.phase === 'reveal' ? s.ms : -1;
    const enter = s.reduced ? 1 : easeOutBack(span(u, AIM.enter[0], AIM.enter[1]), 1.2);
    let kick = 0, shk = 0, fl = 0;
    if (s.phase === 'reveal' && s.outcome === 'out') { kick = recoil(t); shk = s.reduced ? 0 : shake(t); fl = flash(t); }
    const jx = shk * 26 * noise(Math.floor(t / 16)), jy = shk * 20 * noise(Math.floor(t / 16) + 77);
    world.setAttribute('transform', `translate(${(lerp(1300, 0, enter) + jx).toFixed(1)} ${jy.toFixed(1)}) rotate(${(lerp(18, 0, enter) - kick * 16).toFixed(2)} 300 300) scale(0.92)`);
    gun.setAttribute('transform', `translate(${(kick * 60).toFixed(1)} 0)`);
    // the cylinder seen from the side: its flutes run past as it turns
    const angle = s.phase === 'aim' ? drumTurn(u, n, s.chamberTop || 0) : (s.chamberTop || 0) * ((Math.PI * 2) / n);
    const pitch = 360 / Math.max(3, n), off = ((angle / (Math.PI * 2)) * n * pitch) % pitch;
    fluteBars.forEach((b, i) => b.setAttribute('y', String((-170 - pitch + i * pitch + off).toFixed(1))));
    const cock = s.phase === 'aim' ? hammerAim(u) : hammerReveal(t);
    hammerG.setAttribute('transform', `translate(250 -210) rotate(${(cock * 34).toFixed(2)} 0 40)`);
    trig.setAttribute('transform', `translate(110 230) rotate(${(s.phase === 'reveal' && t < 400 ? 18 * clamp01(t / REVEAL.trigger) : 0).toFixed(2)})`);
    glow.setAttribute('opacity', fl.toFixed(3)); star.setAttribute('opacity', (fl * 0.95).toFixed(3));
    star.setAttribute('transform', `scale(${(0.4 + fl).toFixed(3)}) rotate(${(t / 9) % 360})`);
    puffs.forEach((p, i) => {
      const life = s.phase === 'reveal' && s.outcome === 'out' && !s.reduced ? (t - REVEAL.trigger - i * 90) / 2200 : -1;
      if (life <= 0 || life >= 1) { p.setAttribute('opacity', '0'); return; }
      const d = easeOutCubic(life);
      p.setAttribute('cx', String((-40 - d * (160 + noise(i) * 60)).toFixed(1))); p.setAttribute('cy', String((-d * (220 + noise(i + 3) * 80)).toFixed(1)));
      p.setAttribute('r', String((30 + d * 170).toFixed(1))); p.setAttribute('opacity', (Math.sin(Math.PI * Math.min(1, life * 1.6)) * (1 - life * 0.5)).toFixed(3));
    });
  }
  return { canvas: svg, attach(host) { if (svg.parentNode !== host) host.append(svg); }, frame, resize() {}, dispose() { svg.remove(); }, info: () => ({ svg: true }) };
}
