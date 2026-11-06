/* سبونج لايف — «الروليت»: the one timeline every screen follows.
   Each scene is a pure function of the server clock (phase start, deadline): OBS, the studio and a phone that joins
   late all draw the same frame at the same moment, and a refresh lands in the middle of the scene, not at its start.
   Nothing here decides anything — the outcome comes from the server at the reveal. */

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOutCubic = (t) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const easeOutBack = (t, s = 1.55) => { t = clamp01(t) - 1; return 1 + t * t * ((s + 1) * t + s); };
export const easeInQuad = (t) => clamp01(t) * clamp01(t);
/** Fraction of [a, b] reached at u. */
export const span = (u, a, b) => clamp01((u - a) / (b - a));

/* ------------------------------------------------------------------ the names reel
   The reel rolls REEL_STOP cards and stops exactly on the holder at the end of the scene: it speeds up over the
   first ACCEL of the time, then slows down (quartic) to a smooth stop. Position and speed stay continuous. */
const ACCEL = 0.12;
export function reelPosition(u, stop) {
  u = clamp01(u);
  const a = ACCEL, c2 = stop / (Math.pow(1 - a, 3) * (1 + a)), c1 = (2 * c2 * Math.pow(1 - a, 3)) / a;
  return u <= a ? c1 * u * u : stop - c2 * Math.pow(1 - u, 4);
}

/* ------------------------------------------------------------------ the revolver scene («aim»), u = 0 … 1
   enter  the prop slides in, the camera pushes towards it
   spin   the cylinder turns several times and slows down on the chamber that will fire («الخزنة تدور»)
   cock   the hammer goes back (a click)
   hold   a breath of suspense — the outcome is already decided on the server, not yet published */
export const AIM = Object.freeze({ enter: [0, 0.14], spin: [0.14, 0.62], cock: [0.62, 0.72], hold: [0.72, 1] });
/** Cylinder angle: `to` (0-based chamber at the top, under the hammer) reached at the end of the spin. */
export function drumTurn(u, chambers, to) {
  const step = (Math.PI * 2) / chambers;
  const final = to * step;
  const turns = Math.PI * 2 * (2 + Math.min(chambers, 6) * 0.25);
  return final - turns * (1 - easeOutCubic(span(u, AIM.spin[0], AIM.spin[1])));
}
/** Index of the chamber passing under the hammer (for the ratchet clicks). */
export const drumNotch = (angle, chambers) => Math.floor(angle / ((Math.PI * 2) / chambers) + 1e-6);
/** 0 = hammer down, 1 = cocked. */
export const hammerAim = (u) => easeOutBack(span(u, AIM.cock[0], AIM.cock[1]), 2.2);

/* ------------------------------------------------------------------ the reveal, t = ms since it began */
export const REVEAL = Object.freeze({ trigger: 90, flash: 160, recoil: 650, settle: 1300 });
export function hammerReveal(t) { return t < REVEAL.trigger ? 1 - easeInQuad(t / REVEAL.trigger) : 0; }
/** Recoil of the prop after the shot: a fast kick, a damped spring back. */
export function recoil(t) {
  const s = t - REVEAL.trigger; if (s <= 0) return 0;
  if (s < 70) return easeOutCubic(s / 70);
  const k = (s - 70) / (REVEAL.recoil - 70); if (k >= 1) return 0;
  return Math.exp(-4.2 * k) * Math.cos(k * Math.PI * 1.6);
}
/** Muzzle flash brightness 0 … 1. */
export function flash(t) { const s = t - REVEAL.trigger; return s <= 0 || s > REVEAL.flash ? 0 : s < 30 ? s / 30 : 1 - (s - 30) / (REVEAL.flash - 30); }
/** Camera shake amount (fades out); multiplied by the effects level. */
export function shake(t) { const s = t - REVEAL.trigger; return s <= 0 || s > 600 ? 0 : Math.pow(1 - s / 600, 2); }
/** Deterministic noise in −1 … 1 (same on every screen). */
export function noise(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }

/* ------------------------------------------------------------------ the winner */
export const WIN = Object.freeze({ rise: 1100, spin: 9000 });
