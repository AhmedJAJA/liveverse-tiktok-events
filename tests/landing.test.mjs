import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const landing=read('public/landing.html'), css=read('public/landing.css'), js=read('public/landing.js'),server=read('server.mjs'),studio=read('public/index.html');

test('homepage serves original marketing page and preserves existing admin studio',()=>{
  assert.match(server, /'\/': 'landing\.html'/);
  assert.match(server, /'\/studio': 'index\.html'/);
  assert.match(server, /'\/dashboard': 'index\.html'/);
  assert.match(server, /'\/overlay': 'overlay\.html'/);
  assert.match(studio, /id="broadcastFrame"/);
  assert.match(studio,/id="settingsDialog"/);
});
test('every landing asset is allowed by the server whitelist',()=>{
  for(const path of ['landing.html','landing.css','landing.js','liveverse-brand.svg']){
    assert.ok(server.includes("'"+path+"'"),path);
  }
});
test('landing has functional direct links for studio and read-only overlay',()=>{
  assert.match(landing,/href="\/studio"/);
  assert.match(landing,/href="\/overlay"/);
  for(const id of ['how','games','platforms','start'])assert.match(landing,new RegExp('id="'+id+'"'));
  for(const id of ['navLinks','menuToggle'])assert.match(landing,new RegExp('id="'+id+'"'));
});
test('landing menu operates with accessibility feedback',()=>{
  assert.match(js,/aria-expanded/);
  assert.match(js,/Escape/);
  assert.match(landing,/aria-controls="navLinks"/);
});
test('landing respects reduced motion and responsive displays',()=>{
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /@media\(max-width:560px\)/);
  assert.match(css, /@media\(max-width:850px\)/);
});
test('design avoids claiming to provide unsupported social platform APIs',()=>{
  assert.doesNotMatch(landing,/Kick\.com|دعم كيك|خمسون لعبة|٥٥ لعبة/);
  assert.match(landing, /ربط تجريبي/);
  assert.match(landing, /مكتبة غير رسمية/);
});
