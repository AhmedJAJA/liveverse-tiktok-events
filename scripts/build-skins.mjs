#!/usr/bin/env node
/* Builds public/skins/<id>.glb from the original KayKit Adventurers GLB files.
   Usage: node scripts/build-skins.mjs <path to Characters/gltf> [skin id …]
   For each skin in src/skins.mjs it keeps only the listed meshes (one loadout) and the four animations
   (idle / walk / win / lose), drops every buffer, accessor and mesh nothing uses any more, and writes a
   compact GLB. The skeleton, the embedded texture and the materials are kept as they are. No dependencies. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKINS, SKIN_ANIMATIONS } from '../src/skins.mjs';

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [srcDir, ...only] = process.argv.slice(2);
  if (!srcDir) { console.error('usage: node scripts/build-skins.mjs <KayKit Characters/gltf folder> [skin id …]'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  for (const skin of SKINS) {
    if (only.length && !only.includes(skin.id)) continue;
    const input = fs.readFileSync(path.join(srcDir, skin.source));
    const { json, bin } = slim(readGlb(input), new Set(skin.keep), SKIN_ANIMATIONS);
    const glb = writeGlb(json, bin);
    fs.writeFileSync(path.join(OUT, skin.id + '.glb'), glb);
    console.log(`${skin.id}.glb  ${(input.length / 1024).toFixed(0)} KB → ${(glb.length / 1024).toFixed(0)} KB  (${json.meshes.length} meshes, ${json.animations.length} animations)`);
  }
}
