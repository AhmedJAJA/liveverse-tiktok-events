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

  /* ---------- bubbles: a few CSS-animated elements ----------
     The previous full-screen canvas redrew every frame on the main thread (measured ~60% CPU on a
     throttled phone). These bubbles only animate transform/opacity, which the compositor handles. */
  function bubbles(host = document.body) {
    if (host.querySelector(':scope > .sp-bubbles')) return;
    const box = document.createElement('div'); box.className = 'sp-bubbles'; box.setAttribute('aria-hidden', 'true');
    const n = innerWidth < 700 ? 9 : 16;
    for (let i = 0; i < n; i++) {
      const b = document.createElement('i'), depth = (i * 37 % 10) / 10;
      b.style.setProperty('--x', ((i * 61) % 100) + '%');
      b.style.setProperty('--s', (8 + depth * 22).toFixed(0) + 'px');
      b.style.setProperty('--t', (14 + (1 - depth) * 16).toFixed(1) + 's');
      b.style.setProperty('--d', (-(i * 2.3) % 26).toFixed(1) + 's');
      b.style.setProperty('--o', (.25 + depth * .45).toFixed(2));
      box.append(b);
    }
    host.prepend(box);
  }
  // Nothing animates while the tab is hidden.
  const onVis = () => root.classList.toggle('is-hidden', document.hidden);
  document.addEventListener('visibilitychange', onVis); onVis();

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
    setEffects(on) { fxOff = !on; store.set('sponge_fx', fxOff ? '0' : '1'); applyFx(); }
  };
})();
