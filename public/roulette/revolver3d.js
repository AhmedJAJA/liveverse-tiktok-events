/* سبونج لايف — «الروليت»: the revolver prop and the winner's trophy in WebGL (three.js r170, self-hosted).
   An original prop made for the game — a stylised revolver, not a real mechanism: a gunmetal frame, a polished
   cylinder with one chamber per chamber of the match, a hammer, a cyan light strip, and a lacquered walnut grip with
   checkering, a steel backstrap and a cyan-inlaid medallion. Everything is built from
   code (no model file to download), once, and reused for every turn. It only renders while its scene is on screen.
   Every pose is a function of the server clock (timeline.js): no state of its own, nothing random. */
import { AIM, REVEAL, span, lerp, clamp01, easeOutCubic, easeOutBack, easeInOutCubic, drumTurn, hammerAim, hammerReveal, recoil, flash, shake, noise, WIN } from './timeline.js';

let T = null;
const loadThree = () => (T ? Promise.resolve(T) : import('/vendor/three/three.module.min.js').then((m) => (T = m)));

/** Brand colours, read from shared-theme.css so the prop matches the page. */
function token(name, fallback) {
  try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fallback; } catch { return fallback; }
}

/* ------------------------------------------------------------------ procedural textures (canvas, once) */
function canvasTexture(size, draw, { srgb = true, repeat = null } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new T.CanvasTexture(c);
  if (srgb) t.colorSpace = T.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat, repeat); }
  t.anisotropy = 4;
  return t;
}
/** The grip: lacquered walnut — grain in the colour map, a checkered panel in the colour and relief (bump) maps.
    The grip's UVs are its side profile in prop units (see buildRevolver): x 0.3…1, y −1.2…−0.24 (offset by +1.2). */
const GRIP_PANEL = [[0.47, 0.86], [0.66, 0.9], [0.86, 0.22], [0.56, 0.16]]; // the checkered panel, in texture units
function panelPath(g, s) {
  g.beginPath(); GRIP_PANEL.forEach(([x, y], i) => (i ? g.lineTo(x * s, (1 - y) * s) : g.moveTo(x * s, (1 - y) * s))); g.closePath();
}
function checker(g, s, line, gap) {
  g.save(); panelPath(g, s); g.clip();
  g.strokeStyle = line; g.lineWidth = s / 340;
  for (const dir of [1, -1]) for (let k = -s; k < s * 2; k += gap) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + dir * s * 0.62, s); g.stroke(); }
  g.restore();
}
function gripMaps() {
  const map = canvasTexture(512, (g, s) => {
    g.fillStyle = '#4a2814'; g.fillRect(0, 0, s, s);
    // grain: long, slightly wavy streaks, lighter and darker, along the grip (vertical in the texture)
    for (let i = 0; i < 90; i++) {
      const x0 = (noise(i) * 0.5 + 0.5) * s, w = 1 + (noise(i + 200) * 0.5 + 0.5) * 5, dark = i % 3 !== 0;
      g.strokeStyle = dark ? `rgba(28,12,4,${0.25 + (noise(i + 9) * 0.5 + 0.5) * 0.35})` : `rgba(160,92,44,${0.12 + (noise(i + 4) * 0.5 + 0.5) * 0.2})`;
      g.lineWidth = w; g.beginPath();
      for (let y = 0; y <= s; y += 16) { const x = x0 + Math.sin(y / (40 + i % 7 * 9) + i) * (6 + i % 5 * 3); y ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    }
    // the checkered panel reads a little darker, with a fine border
    g.save(); panelPath(g, s); g.fillStyle = 'rgba(20,8,2,.28)'; g.fill(); g.strokeStyle = 'rgba(12,5,1,.8)'; g.lineWidth = s / 160; g.stroke(); g.restore();
    checker(g, s, 'rgba(10,4,1,.55)', s / 46);
  });
  const bump = canvasTexture(512, (g, s) => {
    g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, s, s);
    g.save(); panelPath(g, s); g.fillStyle = '#ffffff'; g.fill(); g.strokeStyle = '#000'; g.lineWidth = s / 120; g.stroke(); g.restore();
    checker(g, s, '#000000', s / 46);
  }, { srgb: false });
  for (const t of [map, bump]) { t.wrapS = t.wrapT = T.RepeatWrapping; t.offset.set(0, 1.2); }
  return { map, bump };
}
const glowTexture = () => canvasTexture(128, (g, s) => {
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.18, 'rgba(255,244,190,.95)'); grd.addColorStop(0.42, 'rgba(255,170,40,.55)'); grd.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
});
const starTexture = () => canvasTexture(256, (g, s) => {
  g.translate(s / 2, s / 2);
  for (let i = 0; i < 9; i++) {
    g.rotate((Math.PI * 2) / 9 + noise(i) * 0.2);
    const len = s * (0.3 + (noise(i + 50) * 0.5 + 0.5) * 0.2);
    const grd = g.createLinearGradient(0, 0, len, 0); grd.addColorStop(0, 'rgba(255,250,220,1)'); grd.addColorStop(1, 'rgba(255,160,40,0)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(0, -s * 0.03); g.lineTo(len, 0); g.lineTo(0, s * 0.03); g.fill();
  }
});
const smokeTexture = () => canvasTexture(128, (g, s) => {
  for (let i = 0; i < 7; i++) {
    const x = s / 2 + noise(i) * s * 0.16, y = s / 2 + noise(i + 9) * s * 0.16, r = s * (0.22 + (noise(i + 20) * 0.5 + 0.5) * 0.16);
    const grd = g.createRadialGradient(x, y, 0, x, y, r); grd.addColorStop(0, 'rgba(210,222,240,.42)'); grd.addColorStop(1, 'rgba(210,222,240,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
  }
});
const sparkTexture = () => canvasTexture(64, (g, s) => {
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,236,160,.8)'); grd.addColorStop(1, 'rgba(255,214,42,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(s / 2, 4); g.lineTo(s / 2, s - 4); g.moveTo(4, s / 2); g.lineTo(s - 4, s / 2); g.stroke();
});

/* ------------------------------------------------------------------ studio lighting for reflections
   A tiny room with a few light panels, pre-filtered once (PMREM): the steel and the gold reflect a soft studio
   instead of a black void. Built like three.js' RoomEnvironment, with the brand's cyan and blue. */
function studioEnvironment(renderer, cyan, blue, warm = false) {
  const room = new T.Scene();
  const box = new T.Mesh(new T.BoxGeometry(12, 8, 12), new T.MeshBasicMaterial({ color: warm ? 0x2a1c08 : 0x0a1430, side: T.BackSide }));
  room.add(box);
  if (warm) { cyan = 0xfff1d0; blue = 0xffcf7a; }
  const panel = (w, h, color, intensity, x, y, z, ry = 0, rx = 0) => {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(intensity), side: T.DoubleSide }));
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); room.add(m);
  };
  panel(6, 1.4, 0xffffff, 4.2, 0, 3.9, 0, 0, Math.PI / 2);   // top softbox
  panel(1.2, 5, cyan, 3.2, -5.9, 0.5, -1, Math.PI / 2);        // cyan strip, left
  panel(3.5, 3, blue, 2.4, 5.9, 0.4, 1.5, -Math.PI / 2);       // blue panel, right
  panel(4, 2, 0xffffff, 1.6, 0, 0.6, 5.9, Math.PI);            // front fill
  panel(2, 0.6, 0xffe0a0, 2.0, 2.5, -2, -5.9);                 // warm kicker
  const pmrem = new T.PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, 0.035).texture;
  pmrem.dispose(); room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return env;
}

/* ------------------------------------------------------------------ the revolver (muzzle towards −x) */
function extrude(shape, depth, bevel = 0.03, curve = 12) {
  const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 3, curveSegments: curve });
  g.translate(0, 0, -depth / 2);
  return g;
}
const BARREL_Y = 0.37, DRUM_Y = 0.17, DRUM_R = 0.36, CHAMBER_R = 0.2, MUZZLE_X = -2.06;
function drumGeometry(n) {
  const step = (Math.PI * 2) / n, rn = Math.min(0.075, DRUM_R * Math.sin(step / 2) * 0.55), d = 2 * Math.asin(rn / (2 * DRUM_R));
  const flute = (i) => Math.PI / 2 + (i + 0.5) * step;
  const s = new T.Shape();
  const c0 = flute(0);
  s.moveTo(DRUM_R * Math.cos(c0 + d), DRUM_R * Math.sin(c0 + d));
  for (let i = 0; i < n; i++) {
    const a = flute(i), b = flute(i + 1);
    s.absarc(0, 0, DRUM_R, a + d, b - d, false);
    const cx = DRUM_R * Math.cos(b), cy = DRUM_R * Math.sin(b);
    const p1 = [DRUM_R * Math.cos(b - d) - cx, DRUM_R * Math.sin(b - d) - cy], p2 = [DRUM_R * Math.cos(b + d) - cx, DRUM_R * Math.sin(b + d) - cy];
    s.absarc(cx, cy, rn, Math.atan2(p1[1], p1[0]), Math.atan2(p2[1], p2[0]), true);
  }
  const holeR = Math.min(0.088, CHAMBER_R * Math.sin(step / 2) * 0.82);
  for (let i = 0; i < n; i++) { const a = Math.PI / 2 + i * step, h = new T.Path(); h.absarc(CHAMBER_R * Math.cos(a), CHAMBER_R * Math.sin(a), holeR, 0, Math.PI * 2, true); s.holes.push(h); }
  const g = new T.ExtrudeGeometry(s, { depth: 0.74, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 3, curveSegments: 24 });
  g.translate(0, 0, -0.37); g.rotateY(-Math.PI / 2); // the cylinder's axis along x (its face looks down the barrel)
  return { geo: g, holeR, step };
}
function buildRevolver(mats, chambers) {
  const gun = new T.Group(); gun.name = 'revolver';
  // frame: one side profile with a window for the cylinder, softened by a bevel
  const f = new T.Shape();
  f.moveTo(-0.5, 0.64); f.lineTo(0.42, 0.64); f.quadraticCurveTo(0.6, 0.64, 0.62, 0.48); f.lineTo(0.64, -0.18);
  f.quadraticCurveTo(0.6, -0.34, 0.44, -0.34); f.lineTo(-0.42, -0.34); f.quadraticCurveTo(-0.52, -0.34, -0.52, -0.22); f.lineTo(-0.52, 0.56); f.quadraticCurveTo(-0.52, 0.64, -0.5, 0.64);
  const w = new T.Path(); w.moveTo(-0.41, 0.55); w.lineTo(0.4, 0.55); w.lineTo(0.4, -0.22); w.lineTo(-0.41, -0.22); w.lineTo(-0.41, 0.55); f.holes.push(w);
  const frame = new T.Mesh(extrude(f, 0.3, 0.045), mats.steel); gun.add(frame);
  // barrel, under-lug, rib, sight, muzzle
  const barrel = new T.Mesh(new T.CylinderGeometry(0.122, 0.135, 1.5, 48, 1), mats.steel);
  barrel.rotation.z = Math.PI / 2; barrel.position.set(-1.27, BARREL_Y, 0); gun.add(barrel);
  const lug = new T.Mesh(new T.CylinderGeometry(0.07, 0.075, 1.08, 32), mats.steel); lug.rotation.z = Math.PI / 2; lug.position.set(-1.07, 0.15, 0); gun.add(lug);
  const web = new T.Mesh(new T.BoxGeometry(1.08, 0.2, 0.09), mats.steel); web.position.set(-1.07, 0.26, 0); gun.add(web);
  const rib = new T.Mesh(new T.BoxGeometry(1.52, 0.08, 0.11), mats.dark); rib.position.set(-1.27, 0.5, 0); gun.add(rib);
  const sight = new T.Mesh(new T.BoxGeometry(0.09, 0.11, 0.05), mats.dark); sight.position.set(-1.96, 0.58, 0); gun.add(sight);
  const crown = new T.Mesh(new T.TorusGeometry(0.115, 0.028, 16, 48), mats.cyan); crown.rotation.y = Math.PI / 2; crown.position.set(MUZZLE_X + 0.03, BARREL_Y, 0); gun.add(crown);
  const bore = new T.Mesh(new T.CircleGeometry(0.075, 32), mats.hole); bore.rotation.y = -Math.PI / 2; bore.position.set(MUZZLE_X + 0.02, BARREL_Y, 0); gun.add(bore);
  for (const z of [0.127, -0.127]) { const strip = new T.Mesh(new T.BoxGeometry(1.18, 0.028, 0.012), mats.cyan); strip.position.set(-1.3, BARREL_Y, z); gun.add(strip); }
  // the cylinder (rebuilt when the number of chambers changes)
  const drum = new T.Group(); drum.position.set(0, DRUM_Y, 0); gun.add(drum);
  // hammer on its pivot
  const hp = new T.Group(); hp.position.set(0.52, 0.5, 0); gun.add(hp);
  const hs = new T.Shape();
  hs.moveTo(-0.06, -0.08); hs.lineTo(0.07, -0.08); hs.lineTo(0.1, 0.12); hs.quadraticCurveTo(0.18, 0.24, 0.27, 0.27); hs.lineTo(0.24, 0.34); hs.quadraticCurveTo(0.08, 0.32, 0.0, 0.2); hs.lineTo(-0.06, 0.08); hs.lineTo(-0.06, -0.08);
  const hammer = new T.Mesh(extrude(hs, 0.1, 0.02), mats.dark); hp.add(hammer);
  // trigger guard and trigger
  const guard = new T.Mesh(new T.TorusGeometry(0.2, 0.032, 14, 40, Math.PI), mats.steel); guard.rotation.z = Math.PI; guard.position.set(0.16, -0.34, 0); gun.add(guard);
  const tp = new T.Group(); tp.position.set(0.18, -0.32, 0); gun.add(tp);
  const ts = new T.Shape(); ts.moveTo(-0.03, 0); ts.lineTo(0.03, 0); ts.quadraticCurveTo(0.06, -0.12, 0.0, -0.22); ts.quadraticCurveTo(0.01, -0.1, -0.03, 0);
  tp.add(new T.Mesh(extrude(ts, 0.05, 0.01), mats.dark));
  // the grip: lacquered walnut with a checkered panel, a steel backstrap and butt cap, a cyan-inlaid steel medallion
  const g = new T.Shape();
  g.moveTo(0.3, -0.3); g.lineTo(0.62, -0.24); g.quadraticCurveTo(0.74, -0.32, 0.8, -0.52); g.lineTo(0.94, -1.0); g.quadraticCurveTo(0.98, -1.2, 0.78, -1.2);
  g.lineTo(0.52, -1.16); g.quadraticCurveTo(0.42, -1.12, 0.42, -0.98); g.lineTo(0.38, -0.66); g.quadraticCurveTo(0.34, -0.44, 0.3, -0.3);
  const grip = new T.Mesh(extrude(g, 0.36, 0.06, 20), mats.grip); grip.name = 'grip'; gun.add(grip);
  const back = new T.CatmullRomCurve3([[0.6, -0.25], [0.72, -0.33], [0.79, -0.52], [0.93, -1.0], [0.9, -1.17]].map(([x, y]) => new T.Vector3(x + 0.035, y, 0)));
  gun.add(new T.Mesh(new T.TubeGeometry(back, 40, 0.045, 10, false), mats.steel));
  const cap = new T.Mesh(new T.BoxGeometry(0.46, 0.07, 0.4), mats.steel); cap.position.set(0.68, -1.2, 0); cap.rotation.z = -0.1; gun.add(cap);
  for (const z of [0.245, -0.245]) {
    const med = new T.Mesh(new T.CylinderGeometry(0.075, 0.075, 0.02, 40), mats.steel); med.rotation.x = Math.PI / 2; med.position.set(0.66, -0.64, z); gun.add(med);
    const inlay = new T.Mesh(new T.TorusGeometry(0.05, 0.01, 8, 40), mats.cyan); inlay.position.set(0.66, -0.64, z * 1.05); gun.add(inlay);
    const screw = new T.Mesh(new T.CylinderGeometry(0.026, 0.026, 0.03, 16), mats.steel); screw.rotation.x = Math.PI / 2; screw.position.set(0.66, -1.0, z * 0.98); gun.add(screw);
  }
  const api = { gun, drum, hammerPivot: hp, triggerPivot: tp, chambers: 0, muzzle: new T.Vector3(MUZZLE_X, BARREL_Y, 0) };
  api.setChambers = (n) => {
    n = Math.max(2, Math.min(6, n | 0));
    if (api.chambers === n) return;
    for (const c of [...drum.children]) { drum.remove(c); c.geometry?.dispose(); }
    const { geo, holeR, step } = drumGeometry(n);
    drum.add(new T.Mesh(geo, mats.drum));
    // inside each chamber: a dark bottom, so the holes read as chambers (all look the same — nothing is revealed)
    const cap = new T.CircleGeometry(holeR * 0.98, 24);
    for (let i = 0; i < n; i++) for (const x of [-0.3, 0.3]) {
      const a = Math.PI / 2 + i * step, m = new T.Mesh(cap, mats.hole);
      m.position.set(x, CHAMBER_R * Math.sin(a), CHAMBER_R * Math.cos(a)); m.rotation.y = x < 0 ? -Math.PI / 2 : Math.PI / 2; drum.add(m);
    }
    const pin = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.84, 16), mats.dark); pin.rotation.z = Math.PI / 2; drum.add(pin);
    api.chambers = n;
  };
  api.setChambers(chambers);
  return api;
}

/* ------------------------------------------------------------------ the trophy */
function buildTrophy(mats) {
  const t = new T.Group(); t.name = 'trophy';
  // the cup: a smooth profile turned around its axis (outer wall up to the rim, then the inner wall back down)
  const ctrl = [[0.001, 0.3], [0.15, 0.3], [0.17, 0.36], [0.115, 0.5], [0.095, 0.68], [0.16, 0.78], [0.38, 0.88], [0.55, 1.08], [0.635, 1.36], [0.665, 1.62], [0.7, 1.72]].map(([x, y]) => new T.Vector2(x, y));
  const outer = new T.SplineCurve(ctrl).getPoints(48);
  const inner = new T.SplineCurve([[0.7, 1.72], [0.6, 1.73], [0.56, 1.6], [0.5, 1.34], [0.36, 1.1], [0.14, 0.94], [0.001, 0.9]].map(([x, y]) => new T.Vector2(x, y))).getPoints(28);
  t.add(new T.Mesh(new T.LatheGeometry([...outer, ...inner.slice(1)], 72), mats.gold));
  for (const s of [1, -1]) {
    const h = new T.Mesh(new T.TorusGeometry(0.24, 0.048, 18, 48, Math.PI), mats.gold);
    h.position.set(s * 0.6, 1.3, 0); h.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    t.add(h);
  }
  const base1 = new T.Mesh(new T.CylinderGeometry(0.5, 0.56, 0.2, 64), mats.base); base1.position.y = 0.1; t.add(base1);
  const base2 = new T.Mesh(new T.CylinderGeometry(0.34, 0.42, 0.12, 64), mats.gold); base2.position.y = 0.26; t.add(base2);
  const band = new T.Mesh(new T.TorusGeometry(0.535, 0.012, 8, 72), mats.cyan); band.rotation.x = Math.PI / 2; band.position.y = 0.14; t.add(band);
  // a star on the front of the cup
  const st = new T.Shape();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.075 : 0.18, a = Math.PI / 2 + (i * Math.PI) / 5, x = r * Math.cos(a), y = r * Math.sin(a); if (i) st.lineTo(x, y); else st.moveTo(x, y); }
  const star = new T.Mesh(extrude(st, 0.05, 0.015), mats.cyan); star.position.set(0, 1.3, 0.66); star.rotation.x = -0.12; t.add(star);
  return t;
}

/* ------------------------------------------------------------------ the duel table (felt top, walnut rim) */
const TABLE_Y = -1.5;
function feltTexture(cyan) {
  return canvasTexture(512, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s / 2);
    grd.addColorStop(0, '#2a5d80'); grd.addColorStop(0.35, '#15405f'); grd.addColorStop(0.75, '#0a2238'); grd.addColorStop(1, '#05111f'); g.fillStyle = grd; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(255,255,255,${0.012 + (noise(i) * 0.5 + 0.5) * 0.02})`; g.fillRect((noise(i + 5) * 0.5 + 0.5) * s, (noise(i + 9) * 0.5 + 0.5) * s, 1.5, 1.5); }
    g.strokeStyle = cyan; g.globalAlpha = 0.5; g.lineWidth = s / 160; g.beginPath(); g.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 0.22; g.lineWidth = s / 300; g.beginPath(); g.arc(s / 2, s / 2, s * 0.33, 0, Math.PI * 2); g.stroke();
  });
}
const shadowTexture = () => canvasTexture(128, (g, s) => {
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); grd.addColorStop(0, 'rgba(0,0,0,.62)'); grd.addColorStop(0.55, 'rgba(0,0,0,.28)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
});
function buildTable(mats, tex) {
  const t = new T.Group(); t.name = 'table'; t.position.y = TABLE_Y;
  const top = new T.Mesh(new T.CylinderGeometry(4.6, 4.6, 0.1, 96, 1), [mats.wood, mats.felt, mats.wood]); t.add(top); // side, top, bottom
  const rim = new T.Mesh(new T.TorusGeometry(4.62, 0.12, 14, 120), mats.wood); rim.rotation.x = Math.PI / 2; rim.position.y = 0.04; t.add(rim);
  const shadow = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: tex.shadow, transparent: true, depthWrite: false, name: 'shadow' }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.056; t.add(shadow);
  return { group: t, shadow };
}

/** The average colour of a canvas (sRGB «rgb(…)»), e.g. the grip's wood. */
function avgColour(canvas) {
  const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); g.drawImage(canvas, 0, 0, 1, 1);
  const [r, gg, b] = g.getImageData(0, 0, 1, 1).data; return `rgb(${r},${gg},${b})`;
}
/* ------------------------------------------------------------------ the scene */
export async function createStage3D({ chambers = 2, quality = 'high' } = {}) {
  await loadThree();
  const low = quality === 'low';
  const canvas = document.createElement('canvas'); canvas.className = 'rr-gl';
  let renderer;
  try { renderer = new T.WebGLRenderer({ canvas, antialias: !low, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: false }); }
  catch (err) { throw new Error('WebGL unavailable: ' + err.message); }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  const cyan = token('--sl-cyan', '#38D4FF'), blue = token('--sl-primary', '#176DF0');
  const green = token('--sl-success', '#2FD9A0'), red = token('--sl-danger', '#FF4D6A'), navy = token('--sl-navy', '#061A44');
  const scene = new T.Scene();
  scene.environment = studioEnvironment(renderer, cyan, blue);
  const warmEnv = studioEnvironment(renderer, cyan, blue, true); // gold reflects a warm studio, not the cyan one
  const wood = gripMaps();
  const mats = {
    steel: new T.MeshPhysicalMaterial({ color: 0x8592a5, metalness: 1, roughness: 0.27, clearcoat: 0.45, clearcoatRoughness: 0.18, envMapIntensity: 1.3 }),
    drum: new T.MeshPhysicalMaterial({ color: 0xc2cedd, metalness: 1, roughness: 0.22, clearcoat: 0.4, envMapIntensity: 1.35 }),
    dark: new T.MeshStandardMaterial({ color: 0x2b3446, metalness: 0.9, roughness: 0.38, envMapIntensity: 1.1 }),
    hole: new T.MeshBasicMaterial({ color: 0x03060d }),
    cyan: new T.MeshStandardMaterial({ color: cyan, emissive: cyan, emissiveIntensity: 1.8, roughness: 0.3, metalness: 0.2 }),
    grip: new T.MeshPhysicalMaterial({ color: 0xffffff, map: wood.map, bumpMap: wood.bump, bumpScale: 2.4, roughness: 0.5, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.32, envMapIntensity: 0.55 }),
    felt: new T.MeshStandardMaterial({ color: 0x5d6b80, map: feltTexture(cyan), roughness: 1, metalness: 0, envMapIntensity: 0.08 }),
    wood: new T.MeshPhysicalMaterial({ color: 0x6a3a1c, roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.7 }),
    gold: new T.MeshPhysicalMaterial({ color: 0xffd060, metalness: 1, roughness: 0.15, clearcoat: 0.6, clearcoatRoughness: 0.1, envMap: warmEnv, envMapIntensity: 1.7, side: T.DoubleSide }),
    base: new T.MeshStandardMaterial({ color: navy, metalness: 0.6, roughness: 0.35, envMapIntensity: 1.0 }),
  };
  for (const [k, m] of Object.entries(mats)) m.name = k;
  // lights: key, cyan rim, blue fill, and two that the scene drives (the result glow, the muzzle flash)
  scene.add(new T.AmbientLight(0x8fb8ff, 0.18));
  const key = new T.DirectionalLight(0xffffff, 2.3); key.position.set(2.5, 4, 5); scene.add(key);
  const rim = new T.DirectionalLight(new T.Color(cyan).lerp(new T.Color(0xffffff), 0.45), 2.0); rim.position.set(-2.5, 3.4, -4); scene.add(rim);
  const fill = new T.DirectionalLight(blue, 0.9); fill.position.set(-2, -1.5, 3); scene.add(fill);
  const mood = new T.PointLight(green, 0, 14, 1.6); mood.position.set(-3.6, 0.8, 2.6); scene.add(mood);
  const muzzleLight = new T.PointLight(0xffb347, 0, 9, 1.4); scene.add(muzzleLight);

  const rv = buildRevolver(mats, chambers);
  const rig = new T.Group(); rig.add(rv.gun); scene.add(rig);
  const trophy = buildTrophy(mats); trophy.visible = false; scene.add(trophy);
  // the duel table under the revolver: felt and a walnut rim, a soft contact shadow; the pool of light on the felt is
  // painted into its texture (a real spotlight made every shader heavier and the first revolver frame slower, and a
  // visible light cone lit up the canvas' rectangle on the page)
  const tableTex = { shadow: shadowTexture() };
  const table = buildTable(mats, tableTex); scene.add(table.group);
  const lookAt = new T.Vector3();

  // effects: flash sprites, smoke puffs, sparkles (shared textures, additive where light)
  const tex = { glow: glowTexture(), star: starTexture(), smoke: smokeTexture(), spark: sparkTexture() };
  const sprite = (map, additive, opacity = 1) => new T.Sprite(new T.SpriteMaterial({ map, transparent: true, depthWrite: false, opacity, blending: additive ? T.AdditiveBlending : T.NormalBlending }));
  const flashGlow = sprite(tex.glow, true), flashStar = sprite(tex.star, true);
  scene.add(flashGlow, flashStar);
  const smoke = Array.from({ length: low ? 6 : 14 }, () => { const s = sprite(tex.smoke, false, 0); scene.add(s); return s; });
  const sparks = Array.from({ length: low ? 8 : 18 }, () => { const s = sprite(tex.spark, true, 0); scene.add(s); return s; });

  const camera = new T.PerspectiveCamera(28, 16 / 9, 0.1, 60);
  let host = null, width = 0, height = 0, portrait = false;
  const dpr = () => Math.min(window.devicePixelRatio || 1, low ? 1 : 1.6);
  function resize() {
    if (!host) return;
    const r = host.getBoundingClientRect(), w = Math.max(2, Math.round(r.width)), h = Math.max(2, Math.round(r.height));
    if (w === width && h === height) return;
    width = w; height = h; portrait = h > w * 1.05;
    renderer.setPixelRatio(dpr()); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const muzzleWorld = new T.Vector3();
  const v3 = new T.Vector3();

  /** One frame. `s` describes where the scene is on the server clock (see stage.js). */
  function frame(s) {
    resize();
    const fx = s.effects === 'high' ? 1.35 : s.effects === 'low' ? 0.45 : 1;
    const reduced = !!s.reduced;
    if (s.scene === 'trophy') return frameTrophy(s, fx, reduced);
    rig.visible = true; trophy.visible = false;
    rv.setChambers(s.chambers || 2);
    const u = s.phase === 'aim' ? clamp01(s.u) : 1;
    const t = s.phase === 'reveal' ? s.ms : -1;
    // the prop comes in (from the right, turning), then floats slightly while the cylinder turns
    const enter = reduced ? 1 : easeOutBack(span(u, AIM.enter[0], AIM.enter[1]) * (s.phase === 'aim' ? 1 : 1), 1.2);
    const breath = Math.sin((s.clock || 0) / 900) * 0.025;
    rig.position.set(lerp(3.2, 0, enter) + 0.15, breath + (portrait ? -0.05 : 0.05), 0);
    rig.rotation.set(0, lerp(-0.9, 0.34, enter), lerp(0.4, 0, enter));
    // aim: the cylinder spins and stops on the chamber that fires; the hammer goes back
    const angle = s.phase === 'aim' ? drumTurn(u, rv.chambers, s.chamberTop || 0) : (s.chamberTop || 0) * ((Math.PI * 2) / rv.chambers);
    rv.drum.rotation.x = angle;
    let cock = s.phase === 'aim' ? hammerAim(u) : hammerReveal(t);
    rv.hammerPivot.rotation.z = -0.62 * cock;
    rv.triggerPivot.rotation.z = s.phase === 'reveal' && t < 400 ? 0.32 * clamp01(t / REVEAL.trigger) : 0;
    // hold: a slow push towards the target
    const hold = s.phase === 'aim' ? easeInOutCubic(span(u, AIM.hold[0], AIM.hold[1])) : 1;
    let kick = 0, shk = 0, fl = 0;
    if (s.phase === 'reveal' && s.outcome === 'out') { kick = recoil(t); shk = reduced ? 0 : shake(t) * fx; fl = flash(t); }
    else if (s.phase === 'reveal' && s.outcome === 'empty') { kick = 0.12 * Math.max(0, recoil(t)); }
    rv.gun.rotation.z = kick * 0.42; rv.gun.position.x = kick * 0.22;
    // camera: framed on the prop; pushes in during the hold; shakes on the shot
    const baseZ = portrait ? 8.2 : 6.6;
    const z = baseZ - hold * 0.55 - (s.phase === 'reveal' ? 0.55 : 0);
    const jx = shk * 0.16 * noise(Math.floor(t / 16)), jy = shk * 0.12 * noise(Math.floor(t / 16) + 77);
    // the canvas may be wider than the prop's place (the flash and the smoke need room): pan so the prop sits at s.at
    const visW = 2 * z * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;
    const pan = portrait ? 0 : -((s.at ?? 0.5) - 0.5) * visW * 0.96;
    // cinematic aim: the camera starts low and to the side of the table and swings round to face the duel as the
    // cylinder turns; the shot punches in, an empty chamber eases back. A function of the clock only (and calm when
    // the viewer prefers reduced motion).
    const swing = reduced || s.phase !== 'aim' ? 0 : 1 - easeInOutCubic(span(u, 0, 0.82));
    const punch = s.phase === 'reveal' && !reduced ? (s.outcome === 'out' ? Math.max(0, recoil(t)) * 0.45 : s.outcome === 'empty' ? -0.18 * clamp01(t / 600) : 0) : 0;
    const yaw = 0.34 * swing, ox = 0.65, oz = z - punch, oy = 1.23 - 0.42 * swing;
    lookAt.set(-0.35 + jx * 0.5 + pan, -0.18 + jy * 0.5, 0);
    camera.position.set(lookAt.x + ox * Math.cos(yaw) + oz * Math.sin(yaw) + jx * 0.5, lookAt.y + oy + jy * 0.5, -ox * Math.sin(yaw) + oz * Math.cos(yaw));
    camera.lookAt(lookAt);
    table.group.visible = true;
    table.shadow.position.set(rig.position.x + 0.1, 0.056, 0); table.shadow.scale.set(3.6 - breath * 4, 1.5, 1);
    // light: green when the chamber was empty, red when it fired
    const tgt = s.phase === 'reveal' && s.outcome ? (s.outcome === 'out' ? red : green) : null;
    if (tgt) { mood.color.set(tgt); mood.intensity = (s.outcome === 'out' ? 26 : 18) * clamp01(t / 250) * fx; } else mood.intensity = 0;
    rim.intensity = 2.0 + (s.phase === 'aim' ? hold * 1.0 : 0);
    // muzzle flash and smoke
    rv.gun.updateMatrixWorld(true);
    muzzleWorld.copy(rv.muzzle).applyMatrix4(rv.gun.matrixWorld);
    v3.copy(muzzleWorld).add(new T.Vector3(-0.2, 0, 0).applyQuaternion(rig.quaternion));
    flashGlow.position.copy(v3); flashStar.position.copy(v3);
    const fs = fl * (1.6 + fx * 0.6);
    flashGlow.scale.setScalar(Math.max(0.0001, fs * 1.5)); flashGlow.material.opacity = fl;
    flashStar.scale.setScalar(Math.max(0.0001, fs * 2.2)); flashStar.material.opacity = fl * 0.95; flashStar.material.rotation = (t / 900) % (Math.PI * 2);
    muzzleLight.position.copy(v3); muzzleLight.intensity = fl * 60 * fx;
    smoke.forEach((p, i) => {
      if (s.phase !== 'reveal' || s.outcome !== 'out' || reduced) { p.material.opacity = 0; return; }
      // puffs leave the muzzle one after another in a narrow cone (forward, then rising), grow and thin out
      const life = (t - REVEAL.trigger - 20 - i * 38) / (1700 + (noise(i + 11) * 0.5 + 0.5) * 900);
      if (life <= 0 || life >= 1) { p.material.opacity = 0; return; }
      const d = easeOutCubic(life), dir = 0.08 + (noise(i) * 0.5 + 0.5) * 0.5; // mostly forward, a little up
      const reach = 0.3 + (noise(i + 3) * 0.5 + 0.5) * 0.45;
      p.position.set(muzzleWorld.x - 0.06 - Math.cos(dir) * reach * d, muzzleWorld.y + Math.sin(dir) * reach * d + life * life * 0.42, muzzleWorld.z + noise(i + 7) * 0.12 * d);
      p.scale.setScalar(0.07 + d * (0.32 + (noise(i + 5) * 0.5 + 0.5) * 0.3) + life * 0.25);
      p.material.opacity = 0.26 * Math.min(1, life * 10) * Math.pow(1 - life, 1.8);
      p.material.rotation = noise(i) * 3 + life * (noise(i + 2) > 0 ? 1 : -1);
    });
    // empty chamber: a few sparks at the hammer (the «تكة»)
    sparks.forEach((p, i) => {
      if (s.phase !== 'reveal' || s.outcome !== 'empty' || reduced || i > 7) { p.material.opacity = 0; return; }
      const life = (t - REVEAL.trigger) / 520; if (life <= 0 || life >= 1) { p.material.opacity = 0; return; }
      const a = (i / 8) * Math.PI * 2;
      v3.set(0.52 + Math.cos(a) * life * 0.45, 0.62 + Math.sin(a) * life * 0.45, 0.1).applyMatrix4(rv.gun.matrixWorld);
      p.position.copy(v3); p.scale.setScalar(0.12 * (1 - life) + 0.02); p.material.opacity = 1 - life;
    });
    renderer.render(scene, camera);
  }
  function frameTrophy(s, fx, reduced) {
    rig.visible = false; trophy.visible = true; table.group.visible = false;
    flashGlow.material.opacity = flashStar.material.opacity = 0; muzzleLight.intensity = 0;
    smoke.forEach((p) => (p.material.opacity = 0));
    const t = Math.max(0, s.ms || 0);
    const rise = reduced ? 1 : easeOutBack(t / WIN.rise, 1.25);
    trophy.position.set(0, lerp(-2.4, -0.95, rise), 0);
    trophy.rotation.y = reduced ? 0 : lerp(-Math.PI * 2, 0, easeOutCubic(t / WIN.rise)) + Math.sin(t / 1900) * 0.42 * clamp01((t - WIN.rise) / 800);
    const sweep = (t % 4200) / 4200;
    mood.color.set(token('--sl-yellow', '#FFD62A')); mood.intensity = 10 + 10 * Math.sin(sweep * Math.PI) * fx; mood.position.set(lerp(-3, 3, sweep), 1.6, 2.6);
    const tz = portrait ? 6.6 : 5.6, tw = 2 * tz * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect, tpan = portrait ? 0 : -((s.at ?? 0.5) - 0.5) * tw * 0.96;
    camera.position.set(tpan, 0.35, tz); camera.lookAt(tpan, 0.05, 0);
    sparks.forEach((p, i) => {
      if (reduced) { p.material.opacity = 0; return; }
      const period = 1500 + (i % 5) * 260, life = ((t + i * 377) % period) / period;
      const a = noise(i) * Math.PI, r = 0.9 + (noise(i + 30) * 0.5 + 0.5) * 0.7;
      p.position.set(Math.cos(a + t / 4000) * r, -0.6 + (noise(i + 60) * 0.5 + 0.5) * 2.1, Math.sin(a + t / 4000) * r * 0.6 + 0.4);
      p.scale.setScalar(0.06 + 0.12 * Math.sin(Math.PI * life)); p.material.opacity = Math.sin(Math.PI * life) * clamp01(t / 600) * fx;
    });
    renderer.render(scene, camera);
  }
  return {
    canvas,
    attach(el) { if (host === el && canvas.parentNode === el) return; host = el; el.append(canvas); width = height = 0; resize(); },
    frame,
    resize() { width = height = 0; resize(); },
    dispose() {
      scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
      Object.values(tex).forEach((t) => t.dispose()); Object.values(tableTex).forEach((t) => t.dispose()); mats.felt.map.dispose(); wood.map.dispose(); wood.bump.dispose(); scene.environment?.dispose(); warmEnv.dispose();
      renderer.dispose(); renderer.forceContextLoss?.(); canvas.remove();
    },
    info: () => renderer.info,
    /** What the prop is made of (for tests and the report): material names, and the grip's base colour and relief. */
    describe() {
      const names = new Set(); scene.traverse((o) => o.visible !== false && o.isMesh && [].concat(o.material).forEach((m) => m.name && names.add(m.name)));
      const gm = rv.gun.getObjectByName('grip').material, c = new T.Color(); c.setStyle(avgColour(gm.map.image));
      return { materials: [...names], grip: { color: [c.r, c.g, c.b], relief: !!gm.bumpMap }, camera: { position: camera.position.toArray(), target: lookAt.toArray() } };
    },
  };
}

/** WebGL here, and enough of a device to draw it smoothly? (`auto` graphics) */
export function canUse3D(pref = 'auto') {
  if (pref === 'low') return false;
  try { const c = document.createElement('canvas'); if (!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))) return false; } catch { return false; }
  if (pref === 'high') return true;
  try { if (localStorage.getItem('sl_gfx') === 'low') return false; } catch {}
  return !((navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2));
}
