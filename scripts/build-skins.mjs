#!/usr/bin/env node
/* Builds public/skins/<id>.glb from the original KayKit Adventurers GLB files.
   Usage: node scripts/build-skins.mjs <path to Characters/gltf> [skin id …]
   For each skin in src/skins.mjs it keeps only the listed meshes (one loadout) and the four animations
   (idle / walk / win / lose), drops every buffer, accessor and mesh nothing uses any more, and writes a
   compact GLB. The skeleton and materials are kept; skins with `recolor` get a recoloured palette texture
   (skin-tone cells untouched). Recolouring needs sharp (resolved through NODE_PATH, e.g. a global install). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SKINS } from '../src/skins.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'public', 'skins');

export function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67 || buf.readUInt32LE(4) !== 2) throw new Error('not a glTF 2.0 binary');
  let o = 12, json = null, bin = null;
  while (o < buf.length) {
    const len = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4), chunk = buf.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8')); else if (type === 0x004e4942) bin = chunk;
    o += 8 + len;
  }
  return { json, bin };
}
export function writeGlb(json, bin) {
  const pad = (b, fill) => { const n = (4 - (b.length % 4)) % 4; return n ? Buffer.concat([b, Buffer.alloc(n, fill)]) : b; };
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20), b = pad(bin, 0);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const ch = (len, type) => { const x = Buffer.alloc(8); x.writeUInt32LE(len, 0); x.writeUInt32LE(type, 4); return x; };
  return Buffer.concat([head, ch(j.length, 0x4e4f534a), j, ch(b.length, 0x004e4942), b]);
}

/** Keep `keepMeshes` (node names) and `keepAnims` (animation names → new names); compact everything else. */
export function slim({ json: src, bin }, keepMeshes, keepAnims) {
  const j = structuredClone(src);
  const missing = [...keepMeshes].filter((n) => !j.nodes.some((x) => x.name === n && x.mesh !== undefined));
  if (missing.length) throw new Error('meshes not found: ' + missing.join(', '));
  for (const n of j.nodes) if (n.mesh !== undefined && !keepMeshes.has(n.name)) { delete n.mesh; delete n.skin; }
  const animNames = new Map(Object.entries(keepAnims).map(([k, v]) => [v, k]));
  j.animations = (j.animations || []).filter((a) => animNames.has(a.name)).map((a) => ({ ...a, name: animNames.get(a.name) }));
  if (j.animations.length !== animNames.size) throw new Error('animations not found');

  // meshes still referenced
  const meshMap = new Map(); const meshes = [];
  for (const n of j.nodes) if (n.mesh !== undefined) { if (!meshMap.has(n.mesh)) { meshMap.set(n.mesh, meshes.length); meshes.push(j.meshes[n.mesh]); } n.mesh = meshMap.get(n.mesh); }
  j.meshes = meshes;
  // accessors still referenced
  const used = new Set();
  for (const m of j.meshes) for (const p of m.primitives) { for (const a of Object.values(p.attributes)) used.add(a); if (p.indices !== undefined) used.add(p.indices); for (const t of p.targets || []) for (const a of Object.values(t)) used.add(a); }
  for (const s of j.skins || []) if (s.inverseBindMatrices !== undefined) used.add(s.inverseBindMatrices);
  for (const a of j.animations) for (const s of a.samplers) { used.add(s.input); used.add(s.output); }
  const accMap = new Map(); const accessors = [];
  for (const [i, a] of j.accessors.entries()) if (used.has(i)) { accMap.set(i, accessors.length); accessors.push(a); }
  const ra = (i) => accMap.get(i);
  for (const m of j.meshes) for (const p of m.primitives) { for (const k of Object.keys(p.attributes)) p.attributes[k] = ra(p.attributes[k]); if (p.indices !== undefined) p.indices = ra(p.indices); for (const t of p.targets || []) for (const k of Object.keys(t)) t[k] = ra(t[k]); }
  for (const s of j.skins || []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = ra(s.inverseBindMatrices);
  for (const a of j.animations) for (const s of a.samplers) { s.input = ra(s.input); s.output = ra(s.output); }
  j.accessors = accessors;
  // buffer views still referenced, packed into a new binary chunk
  const views = new Set([...j.accessors.map((a) => a.bufferView), ...(j.images || []).map((i) => i.bufferView)].filter((v) => v !== undefined));
  const viewMap = new Map(); const bufferViews = []; const parts = []; let offset = 0;
  for (const [i, v] of j.bufferViews.entries()) {
    if (!views.has(i)) continue;
    const pad = (4 - (offset % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); offset += pad; }
    parts.push(bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));
    viewMap.set(i, bufferViews.length); bufferViews.push({ ...v, buffer: 0, byteOffset: offset }); offset += v.byteLength;
  }
  for (const a of j.accessors) if (a.bufferView !== undefined) a.bufferView = viewMap.get(a.bufferView);
  for (const im of j.images || []) if (im.bufferView !== undefined) im.bufferView = viewMap.get(im.bufferView);
  j.bufferViews = bufferViews;
  const out = Buffer.concat(parts);
  j.buffers = [{ byteLength: out.length }];
  j.asset = { ...j.asset, copyright: 'KayKit Adventurers by Kay Lousberg (www.kaylousberg.com), CC0', generator: (j.asset.generator || '') + ' + SPONGE LIVE build-skins' };
  return { json: j, bin: out };
}

/* ---------- palette recolouring (KayKit textures are an 8 × 4 grid of colour swatches) ---------- */
const rgb2hsl = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; if (mx === mn) return [0, 0, l]; const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h * 60, s, l]; };
const hsl2rgb = (h, s, l) => { h = ((h % 360) + 360) % 360 / 360; if (!s) { const v = Math.round(l * 255); return [v, v, v]; } const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255)); };
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
/** Skin tones (faces, hands) are never recoloured. */
const isSkin = (r, g, b) => r > 170 && g > 110 && b > 80 && r > g && g > b && r - b > 35 && r - b < 120 && g - b < 70;
export async function recolorPng(png, rc) {
  const sharp = createRequire(import.meta.url)('sharp');
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, cw = W / 8, ch = H / 4;
  for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 8; cx++) {
    const mid = (((cy * ch + ch / 2) | 0) * W + ((cx * cw + cw / 2) | 0)) * 4;
    if (isSkin(data[mid], data[mid + 1], data[mid + 2])) continue;
    const cell = cy * 8 + cx;
    for (let y = cy * ch; y < (cy + 1) * ch; y++) for (let x = cx * cw; x < (cx + 1) * cw; x++) {
      const i = (y * W + x) * 4; let [h, sat, l] = rgb2hsl(data[i], data[i + 1], data[i + 2]);
      if (sat < 0.14) { // greys, metal, white: tinted like a metal
        if (rc.metal) { h = rc.metal[0]; sat = rc.metal[1] * (0.55 + 0.45 * (1 - Math.abs(l - 0.5) * 2)); }
        l = clamp(l * (rc.metalLight || 1));
      } else {
        if (rc.hue !== undefined) { const rel = ((h - 30 + 540) % 360) - 180; h = rc.hue + rel * (rc.spread ?? 0.28) + (rc.cycle ? ((cell * 47) % 140) - 70 : 0); }
        else if (rc.shift) h += rc.shift;
        sat = clamp(sat * (rc.sat || 1)); l = clamp(l * (rc.light || 1), 0.04, 0.96);
      }
      const [r, g, b] = hsl2rgb(h, sat, l); data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
  }
  return sharp(data, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
}
/** Replaces the embedded texture: the new PNG is appended to the binary; slim() then drops the old bytes. */
export async function withRecolor({ json, bin }, rc) {
  const j = structuredClone(json), img = j.images[0], view = j.bufferViews[img.bufferView];
  const png = await recolorPng(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength), rc);
  const pad = (4 - (bin.length % 4)) % 4;
  j.bufferViews.push({ buffer: 0, byteOffset: bin.length + pad, byteLength: png.length });
  img.bufferView = j.bufferViews.length - 1; img.mimeType = 'image/png';
  return { json: j, bin: Buffer.concat([bin, Buffer.alloc(pad), png]) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [srcDir, ...only] = process.argv.slice(2);
  if (!srcDir) { console.error('usage: node scripts/build-skins.mjs <KayKit Characters/gltf folder> [skin id …]'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  for (const skin of SKINS) {
    if (only.length && !only.includes(skin.id)) continue;
    const input = fs.readFileSync(path.join(srcDir, skin.source));
    let src = readGlb(input);
    if (skin.recolor) src = await withRecolor(src, skin.recolor);
    const { json, bin } = slim(src, new Set(skin.keep), skin.anims);
    const glb = writeGlb(json, bin);
    fs.writeFileSync(path.join(OUT, skin.id + '.glb'), glb);
    console.log(`${skin.id}.glb  ${(input.length / 1024).toFixed(0)} KB → ${(glb.length / 1024).toFixed(0)} KB  (${json.meshes.length} meshes, ${json.animations.length} animations)`);
  }
}
