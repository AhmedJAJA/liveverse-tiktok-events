import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const publicFile=(name)=>fs.readFileSync(new URL('../public/'+name, import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const files=['home.html','studio.html','index.html','overlay.html','play.html'];
test('the official SPONGE LIVE image is shipped in light WebP/PNG sizes and the old SKY logo is gone',()=>{
  for(const [f,max] of [['brand/sponge-512.webp',40000],['brand/sponge-256.webp',15000],['brand/sponge-128.webp',8000],['brand/sponge-192.png',40000],['brand/favicon-64.png',8000]]){
    const buf=fs.readFileSync(new URL('../public/'+f,import.meta.url));
    assert.ok(buf.length>500 && buf.length<max,f+' '+buf.length);
  }
  assert.ok(!fs.existsSync(new URL('../public/sky-live.webp',import.meta.url)));
  assert.ok(!fs.existsSync(new URL('../public/sky-live-mark.svg',import.meta.url)));
});
test('public pages are branded SPONGE LIVE without the former identity',()=>{
  for(const name of files){
    const html=publicFile(name);
    assert.match(html,/SPONGE LIVE/,name);
    assert.doesNotMatch(html,/SKY LIVE|Royal Edition|ROYAL EDITION|LIVEVERSE|sky-live/i,name);
  }
});
test('server offers images, icons and fonts with correct MIME, compression and cache headers',()=>{
  assert.match(server,/\.webp': 'image\/webp'/);
  assert.match(server,/\.woff': 'font\/woff'/);
  assert.match(server,/'\/favicon\.ico': 'brand\/favicon-64\.png'/);
  assert.match(server,/'\/': 'home\.html'/);
  assert.match(server,/'\/studio': 'studio\.html'/);
  assert.match(server,/'\/dashboard': 'index\.html'/);
  assert.match(server,/'\/overlay': 'overlay\.html'/);
  assert.match(server,/gzipSync/);
  assert.match(server,/immutable/);
  assert.match(server,/ETag/);
});
test('enforces the SPONGE LIVE ocean palette across public pages and the core theme',()=>{
  const css=publicFile('royal-core.css');
  for(const hex of ['#050B17','#0A132A','#102045','#37B3D4','#8CD9F1','#E7F2F6']) assert.ok(css.includes(hex),'Missing ocean palette color '+hex);
  for(const name of files) assert.match(publicFile(name),/name="theme-color" content="#020A22"/,name);
  for(const name of ['studio.html','index.html','overlay.html','play.html']) assert.match(publicFile(name),/href="\/sponge\.css"/,name);
});
