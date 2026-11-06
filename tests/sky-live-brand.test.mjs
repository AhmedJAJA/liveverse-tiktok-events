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
test('public pages are branded «سبونج لايف» without the former identity',()=>{
  for(const name of files){
    const html=publicFile(name);
    assert.match(html,/سبونج لايف/,name); assert.doesNotMatch(html,/SPONGE LIVE/,name);
    assert.doesNotMatch(html,/SKY LIVE|Royal Edition|ROYAL EDITION|LIVEVERSE|sky-live/i,name);
  }
});
test('server offers images, icons and fonts with correct MIME, compression and cache headers',()=>{
  assert.match(server,/\.webp': 'image\/webp'/);
  assert.match(server,/\.woff': 'font\/woff'/);
  assert.match(server,/'\/favicon\.ico': 'brand\/favicon-64\.png'/);
  assert.match(server,/'\/': 'home\.html'/);
  assert.match(server,/gamePage \? 'studio\.html'/, 'each game page is served by the game screen');
  assert.match(server,/'\/dashboard': 'index\.html'/);
  assert.match(server,/'\/overlay': 'overlay\.html'/);
  assert.match(server,/gzipSync/);
  assert.match(server,/immutable/);
  assert.match(server,/ETag/);
});
test('enforces the SPONGE LIVE ocean palette across public pages and the core theme',()=>{
  // one palette: shared-theme.css defines the official colours, the core theme points at them
  const theme=publicFile('shared-theme.css'), css=publicFile('royal-core.css');
  for(const hex of ['#020A22','#061A44','#0B1737','#10234D','#176DF0','#38D4FF','#FFD62A','#EAF8FF','#9EADD0']) assert.ok(theme.includes(hex),'Missing official colour '+hex);
  for(const token of ['--obsidian:var(--sl-deep)','--gold:var(--sl-cyan)','--text:var(--sl-text)']) assert.ok(css.includes(token),token);
  for(const name of files) assert.match(publicFile(name),/name="theme-color" content="#020A22"/,name);
  for(const name of ['studio.html','index.html','overlay.html','play.html']) assert.match(publicFile(name),/href="\/sponge\.css"/,name);
});
