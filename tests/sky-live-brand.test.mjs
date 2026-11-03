import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const publicFile=(name)=>fs.readFileSync(new URL('../public/'+name, import.meta.url),'utf8');
const logo=fs.readFileSync(new URL('../public/sky-live.webp', import.meta.url));
const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const files=['landing.html','index.html','overlay.html'];
test('real Sky Live artwork is committed as a valid, optimized WebP image',()=>{
  assert.equal(logo.toString('ascii',0,4),'RIFF');
  assert.equal(logo.toString('ascii',8,12),'WEBP');
  assert.ok(logo.length>3000 && logo.length<100000);
});
test('public pages are branded SKY LIVE without displaying the former logo',()=>{
  for(const name of files){
    const html=publicFile(name);
    assert.match(html,/SKY LIVE/);
    assert.match(html,/sky-live\.webp/);
    assert.doesNotMatch(html,/LIVEVERSE/);
    assert.doesNotMatch(html,/src="\/liveverse-brand\.svg"/);
  }
});
test('new responsive style is loaded on homepage, studio, broadcast',()=>{
  for(const name of files)assert.match(publicFile(name),/href="\/sky-live-theme\.css"/);
  const css=publicFile('sky-live-theme.css');
  for(const selector of ['.hero','.site-header','body.presenter','.settings-dialog','.sky-studio-mark','.sky-overlay-mark','.arena .signup-screen','.arena .results-screen'])
    assert.ok(css.includes(selector),'Missing '+selector);
  assert.match(css,/max-width:560px/);
  assert.match(css,/prefers-reduced-motion/);
});
test('server offers image with correct MIME, favicon and preserves public routes',()=>{
  assert.match(server,/\.webp': 'image\/webp'/);
  assert.match(server, /'\/favicon\.ico': 'sky-live\.webp'/);
  assert.match(server, /'sky-live\.webp'/);
  assert.match(server, /'sky-live-theme\.css'/);
  assert.match(server, /'\/studio': 'index\.html'/);
  assert.match(server, /'\/overlay': 'overlay\.html'/);
});
test('enforces Royal Black — Obsidian & Gold luxury palette across public pages and theme CSS',()=>{
  const css=publicFile('sky-live-theme.css');
  for(const hex of ['#08090C','#101116','#191A20','#D4AF37','#F4D58D','#977328','#F7F3E9']){
    assert.ok(css.includes(hex),'Missing Royal Black palette color '+hex);
  }
  assert.doesNotMatch(css,/#020b26|#051a4d|#0a3585/i);
  for(const name of files){
    const html=publicFile(name);
    assert.match(html,/content="#08090C"/);
    assert.doesNotMatch(html,/#020b26/i);
  }
});

