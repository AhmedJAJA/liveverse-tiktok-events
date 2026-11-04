/* SPONGE LIVE — shared ambience: rising bubbles, original sound effects, and the
   viewer's "effects" / "sound" switches. Classic script; exposes window.SpongeFx. */
(() => {
  'use strict';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} }
  };
  const params = new URLSearchParams(location.search);
  let muted = params.get('mute') === '1' || store.get('sponge_mute', '0') === '1';
  let fxOff = params.get('fx') === '0' || store.get('sponge_fx', '1') === '0';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  function applyFx() {
    root.classList.toggle('fx-off', fxOff);
    if (fxOff) { if (!root.classList.contains('au-perf')) { root.classList.add('au-perf'); root.dataset.fxPerf = '1'; } }
    else if (root.dataset.fxPerf) { root.classList.remove('au-perf'); delete root.dataset.fxPerf; }
  }
  applyFx();

  /* ---------- sound: everything is synthesised here, no audio files ---------- */
  let ctx = null, master = null;
  function audio() {
    if (muted) return null;
    try {
      if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = .5; master.connect(ctx.destination); }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    } catch { return null; }
  }
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { if (ctx?.state === 'suspended') ctx.resume().catch(() => {}); }, { passive: true });
  function tone(freq, start, dur, { type = 'sine', gain = .25, to = null } = {}) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + start, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + .015); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + .02);
  }
  const SFX = {
    join: () => { tone(420, 0, .12, { to: 980, gain: .22 }); tone(1300, .07, .06, { gain: .08 }); },          // bubble pop
    out: () => { tone(520, 0, .32, { type: 'triangle', to: 140, gain: .2 }); },
    win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .11, .28, { type: 'triangle', gain: .2 })); tone(1568, .46, .5, { gain: .1 }); },
    tick: () => tone(1100, 0, .04, { type: 'square', gain: .06 }),
    warn: () => tone(880, 0, .09, { type: 'square', gain: .1 }),
    boom: () => { tone(120, 0, .5, { type: 'sawtooth', to: 40, gain: .3 }); tone(60, .05, .6, { gain: .25 }); },
    start: () => { tone(392, 0, .12, { type: 'triangle' }); tone(587, .12, .2, { type: 'triangle' }); },
    correct: () => { tone(660, 0, .1, { type: 'triangle' }); tone(990, .09, .16, { type: 'triangle' }); },
    wrong: () => tone(220, 0, .25, { type: 'sawtooth', gain: .12 })
  };
  // An original, looping sea-shanty style tune for musical chairs.
  const TUNE = [392, 440, 494, 523, 494, 440, 392, 330, 349, 392, 440, 392, 349, 330, 294, 330];
  let musicTimer = 0, musicStep = 0;
  function startMusic() {
    if (musicTimer || muted) return;
    const beat = () => { const f = TUNE[musicStep++ % TUNE.length]; tone(f, 0, .22, { type: 'triangle', gain: .14 }); if (musicStep % 2) tone(f / 2, 0, .2, { type: 'sine', gain: .1 }); };
    beat(); musicTimer = setInterval(beat, 240);
  }
  function stopMusic() { clearInterval(musicTimer); musicTimer = 0; }

  /* ---------- bubbles: three depth layers on one canvas ---------- */
  function bubbles(host = document.body) {
    if (host.querySelector(':scope > .sp-bubbles')) return;
    const canvas = document.createElement('canvas'); canvas.className = 'sp-bubbles'; canvas.setAttribute('aria-hidden', 'true');
    host.prepend(canvas);
    const g = canvas.getContext('2d'); let w = 0, h = 0, list = [], raf = 0;
    const resize = () => { const r = Math.min(2, devicePixelRatio || 1); w = canvas.width = innerWidth * r; h = canvas.height = innerHeight * r; const n = Math.round(Math.min(70, innerWidth / 22)); list = Array.from({ length: n }, () => spawn(true)); };
    const spawn = (anywhere) => { const depth = Math.random(); return { x: Math.random() * w, y: anywhere ? Math.random() * h : h + 30, r: (2 + depth * 9) * (w / innerWidth), s: (.25 + depth * .9) * (w / innerWidth), d: depth, p: Math.random() * 6.28 }; };
    const frame = () => {
      g.clearRect(0, 0, w, h);
      for (const b of list) {
        b.y -= b.s; b.p += .02; const x = b.x + Math.sin(b.p) * 6 * b.d;
        if (b.y < -20) Object.assign(b, spawn(false));
        g.beginPath(); g.arc(x, b.y, b.r, 0, 6.283);
        g.strokeStyle = `rgba(150,235,255,${.18 + b.d * .35})`; g.lineWidth = 1 + b.d; g.stroke();
        g.beginPath(); g.arc(x - b.r * .35, b.y - b.r * .35, b.r * .28, 0, 6.283); g.fillStyle = `rgba(255,255,255,${.12 + b.d * .3})`; g.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    const run = () => { cancelAnimationFrame(raf); if (fxOff || reduced() || document.hidden) { g.clearRect(0, 0, w, h); return; } frame(); };
    addEventListener('resize', () => { resize(); run(); }); document.addEventListener('visibilitychange', run);
    resize(); run();
    window.SpongeFx._rerun = run;
  }

  /** A short burst of bubbles around an element (player joined / won). */
  function burst(el, count = 12) {
    if (fxOff || reduced() || !el) return;
    for (let i = 0; i < count; i++) {
      const b = document.createElement('i'); b.className = 'sp-burst';
      b.style.setProperty('--a', (i / count * 360) + 'deg'); b.style.setProperty('--d', (30 + (i % 4) * 14) + 'px'); b.style.setProperty('--s', (5 + (i % 3) * 4) + 'px');
      el.append(b); setTimeout(() => b.remove(), 900);
    }
  }

  window.SpongeFx = {
    play(name) { if (!muted && SFX[name]) try { SFX[name](); } catch {} },
    startMusic, stopMusic, bubbles, burst,
    get muted() { return muted; }, get effectsOff() { return fxOff; },
    setMuted(v) { muted = !!v; store.set('sponge_mute', muted ? '1' : '0'); if (muted) stopMusic(); },
    setEffects(on) { fxOff = !on; store.set('sponge_fx', fxOff ? '0' : '1'); applyFx(); window.SpongeFx._rerun?.(); }
  };
})();
