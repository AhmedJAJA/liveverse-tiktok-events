/* سبونج لايف — «الروليت»: original sound effects, synthesised with WebAudio (no audio files): the reel ticks, the
   cylinder's ratchet, the hammer, a heartbeat, the dry «تكة» of an empty chamber, the shot, and the winner's fanfare.
   Off when the host turns «الأصوات» off, when the page is muted (?mute=1 — the host's own preview), or before the
   browser allows sound. Levels go through a compressor so the shot never clips the stream's audio. */
export function createSfx() {
  let ctx = null, out = null, verb = null, enabled = true;
  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => { try { fn(); } catch { /* a listener never breaks the sound */ } });
  const muted = () => !enabled || !!window.SpongeFx?.muted || new URLSearchParams(location.search).get('mute') === '1';
  function audio() {
    if (muted()) return null;
    try {
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
        ctx = new C();
        ctx.onstatechange = changed; // «blocked» → «running» after the first click: the screen hides its hint
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.25;
        out = ctx.createGain(); out.gain.value = 0.7; out.connect(comp).connect(ctx.destination);
        // a short room for the shot's tail
        const len = Math.floor(ctx.sampleRate * 1.3), ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
        verb = ctx.createConvolver(); verb.buffer = ir; const vg = ctx.createGain(); vg.gain.value = 0.32; verb.connect(vg).connect(out);
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx.state === 'running' ? ctx : null;
    } catch { return null; }
  }
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { if (ctx?.state === 'suspended') ctx.resume().catch(() => {}); }, { passive: true });
  function tone(freq, { at = 0, dur = 0.12, type = 'sine', gain = 0.2, to = null, attack = 0.004, dest = null } = {}) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || out); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise({ at = 0, dur = 0.1, gain = 0.3, type = 'bandpass', freq = 3000, to = null, q = 1, dest = null, curve = 2 } = {}) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + at, len = Math.max(1, Math.floor(a.sampleRate * dur)), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, curve);
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; f.type = type; f.frequency.setValueAtTime(freq, t); if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur); f.Q.value = q; g.gain.value = gain;
    src.connect(f).connect(g).connect(dest || out); src.start(t);
    return g;
  }
  const fx = {
    setEnabled(on) { const was = enabled; enabled = !!on; if (was !== enabled) changed(); },
    /** 'muted' (sounds off, or the host's own preview), 'blocked' (the browser waits for a click), 'running', 'unsupported' */
    status() {
      if (muted()) return 'muted';
      const a = audio(); // creates the audio context if needed (allowed without a click; it just starts suspended)
      if (a) return 'running';
      return ctx ? 'blocked' : 'unsupported';
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    reelTick(speed = 1) { tone(1500 + Math.min(1, speed) * 500, { dur: 0.018, type: 'square', gain: 0.035 }); noise({ dur: 0.012, gain: 0.08, freq: 5200, q: 2 }); },
    whoosh() { noise({ dur: 0.45, gain: 0.16, type: 'bandpass', freq: 600, to: 3200, q: 0.8, curve: 1 }); },
    picked() { tone(1318.5, { dur: 0.35, type: 'triangle', gain: 0.12 }); tone(1975.5, { at: 0.08, dur: 0.5, type: 'triangle', gain: 0.1 }); tone(2637, { at: 0.16, dur: 0.6, gain: 0.05 }); noise({ dur: 0.3, gain: 0.08, type: 'highpass', freq: 3000, curve: 1.5 }); },
    ratchet() { noise({ dur: 0.012, gain: 0.22, freq: 3400, q: 3 }); tone(2300, { dur: 0.014, type: 'square', gain: 0.025 }); },
    cock() { noise({ dur: 0.02, gain: 0.35, freq: 2200, q: 4 }); tone(1600, { dur: 0.03, type: 'square', gain: 0.04 }); noise({ at: 0.07, dur: 0.025, gain: 0.45, freq: 3600, q: 5 }); tone(2900, { at: 0.07, dur: 0.05, type: 'triangle', gain: 0.06 }); },
    heartbeat() { tone(62, { dur: 0.16, gain: 0.34, to: 42 }); tone(58, { at: 0.2, dur: 0.18, gain: 0.26, to: 40 }); },
    click() { noise({ dur: 0.018, gain: 0.5, freq: 4200, q: 6 }); tone(3100, { dur: 0.09, type: 'triangle', gain: 0.07 }); tone(5200, { at: 0.005, dur: 0.05, gain: 0.03 }); },
    relief() { [783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, { at: 0.18 + i * 0.09, dur: 0.32, type: 'triangle', gain: 0.1 })); tone(1568, { at: 0.46, dur: 0.6, gain: 0.05 }); },
    bang() {
      const a = audio(); if (!a) return;
      noise({ dur: 0.03, gain: 0.9, type: 'highpass', freq: 2500, curve: 1 });                    // the crack
      noise({ dur: 0.7, gain: 0.95, type: 'lowpass', freq: 7000, to: 260, q: 0.7, curve: 2.6 }); // the blast
      noise({ dur: 0.9, gain: 0.5, type: 'lowpass', freq: 3000, to: 200, q: 0.5, dest: verb, curve: 2 }); // its tail in the room
      tone(110, { dur: 0.45, gain: 0.55, to: 34 });                                                 // the thump
    },
    outSting() { [392, 349.2, 293.7].forEach((f, i) => tone(f, { at: 0.42 + i * 0.16, dur: 0.3, type: 'sawtooth', gain: 0.045 })); tone(146.8, { at: 0.9, dur: 0.7, type: 'triangle', gain: 0.12 }); },
    hostOut() { tone(330, { dur: 0.2, type: 'sawtooth', gain: 0.05, to: 160 }); tone(160, { at: 0.18, dur: 0.5, type: 'triangle', gain: 0.1 }); },
    cancel() { tone(523.25, { dur: 0.16, type: 'triangle', gain: 0.07 }); tone(392, { at: 0.12, dur: 0.24, type: 'triangle', gain: 0.07 }); },
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, { at: i * 0.12, dur: 0.34, type: 'triangle', gain: 0.12 }));
      [1046.5, 1318.5, 1568].forEach((f) => tone(f, { at: 0.52, dur: 1.4, type: 'triangle', gain: 0.06, attack: 0.02 }));
      for (let i = 0; i < 8; i++) tone(2093 + (i % 4) * 330, { at: 0.6 + i * 0.07, dur: 0.12, gain: 0.025 });
    },
  };
  return fx;
}
