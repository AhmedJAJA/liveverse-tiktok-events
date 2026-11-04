import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const publicFile=(name)=>fs.readFileSync(new URL('../public/'+name, import.meta.url),'utf8');
const logo=fs.readFileSync(new URL('../public/sky-live.webp', import.meta.url));
const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const files=['landing.html','index.html','overlay.html'];
test('royal Sky Live emblem is committed as a valid, optimized WebP image and an SVG mark',()=>{
  assert.equal(logo.toString('ascii',0,4),'RIFF');
  assert.equal(logo.toString('ascii',8,12),'WEBP');
  assert.ok(logo.length>3000 && logo.length<100000);
  const mark=publicFile('sky-live-mark.svg');
  assert.match(mark,/^<svg[^>]+viewBox="0 0 512 512"/);
  assert.match(mark,/aria-label="SKY LIVE"/);
});
test('public pages are branded SPONGE LIVE without displaying the former logo',()=>{
  for(const name of files){
    const html=publicFile(name);
    assert.match(html,/SPONGE LIVE/);
    assert.match(html,/sponge-mark\.svg/);
    assert.doesNotMatch(html,/SKY LIVE/);
    assert.doesNotMatch(html,/LIVEVERSE/);
    assert.doesNotMatch(html,/liveverse-brand\.svg|sky-live-brand\.svg/);
  }
});
test('royal design system is loaded on homepage, studio and broadcast',()=>{
  for(const name of files)assert.match(publicFile(name),/href="\/royal-core\.css"/);
  const css=publicFile('royal-core.css');
  for(const selector of ['.crest','.btn-gold','.avatar','.toast','.img-skeleton']) assert.ok(css.includes(selector),'Missing '+selector);
  assert.match(publicFile('royal-landing.css'),/max-width:560px/);
  assert.match(css,/prefers-reduced-motion/);
});
test('server offers images, icons and fonts with correct MIME and preserves public routes',()=>{
  assert.match(server,/\.webp': 'image\/webp'/);
  assert.match(server,/\.woff': 'font\/woff'/);
  assert.match(server, /'\/favicon\.ico': 'sky-live\.webp'/);
  for(const asset of ['sky-live.webp','sky-live-mark.svg','icons.svg','royal-core.css','royal-studio.css','royal-broadcast.css','royal-landing.css','fonts/inter-display-light.woff','fonts/inter-display-semibold.woff']) assert.ok(server.includes("'"+asset+"'"),asset);
  assert.match(server, /'\/studio': 'index\.html'/);
  assert.match(server, /'\/overlay': 'overlay\.html'/);
});
test('enforces the SPONGE LIVE ocean palette across public pages and the core theme',()=>{
  const css=publicFile('royal-core.css');
  for(const hex of ['#050B17','#0A132A','#102045','#37B3D4','#8CD9F1','#E7F2F6']){
    assert.ok(css.includes(hex),'Missing ocean palette color '+hex);
  }
  for(const sheet of ['royal-core.css','royal-studio.css','royal-broadcast.css','royal-landing.css'])
    assert.doesNotMatch(publicFile(sheet),/#020b26|#051a4d|#0a3585/i);
  for(const name of files){
    const html=publicFile(name);
    assert.match(html,/name="theme-color" content="#020A22"/);
    assert.match(html,/href="\/sponge\.css"/);
    assert.doesNotMatch(html,/#020b26/i);
  }
});
