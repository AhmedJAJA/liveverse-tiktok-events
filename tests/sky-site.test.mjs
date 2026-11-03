import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const home=read('public/landing.html');
const studio=read('public/index.html');
const overlay=read('public/overlay.html');
const styles=read('public/sky-landing.css');
const theme=read('public/sky-live-theme.css');
const server=read('server.mjs');

test('Sky Live brand and approved artwork are wired throughout the website',()=>{
  for(const html of [home,studio,overlay]) assert.match(html,/SKY LIVE|Sky Live/i);
  assert.match(home,/src="\/sky-live\.webp"/);
  assert.match(home,/href="\/sky-landing\.css"/);
  assert.match(home,/href="\/sky-live-theme\.css"/);
  assert.match(server,/'sky-live\.webp'/);
  assert.match(server, /'sky-landing\.css'/);
  const webp=fs.readFileSync(new URL('../public/sky-live.webp',import.meta.url));
  assert.ok(webp.length>1500,'approved photo image must be nonempty');
  assert.equal(webp.subarray(0,4).toString('ascii'),'RIFF');
  assert.equal(webp.subarray(8,12).toString('ascii'),'WEBP');
});
test('website has working navigation to existing studio and read-only overlay',()=>{
  assert.match(server,/['"]\/['"]:\s*['"]landing\.html['"]/);
  assert.match(server,/['"]\/studio['"]:\s*['"]index\.html['"]/);
  assert.match(server,/['"]\/overlay['"]:\s*['"]overlay\.html['"]/);
  assert.match(home,/href="\/studio"/);
  assert.match(home,/href="\/overlay"/);
  assert.match(studio,/id="presenterStart"/);
  assert.match(studio,/id="settingsDialog"/);
  assert.match(overlay,/id="roundResultsOverlay"/);
});
test('pricing and platform marketing does not pretend unavailable services work',()=>{
  assert.match(home,/id="pricing"/);
  assert.match(home,/لا يوجد نظام دفع/);
  assert.match(home,/TikTok LIVE/);
  assert.match(home,/ربط تجريبي/);
  assert.match(home,/Kick/);
  assert.match(home,/الربط المباشر غير مفعّل/);
  assert.match(home,/قيد التخطيط/);
  assert.match(home,/PLANNED/);
});
test('mobile styles and motion preference are respected',()=>{
  assert.match(styles,/@media\(max-width:750px\)/);
  assert.match(styles,/prefers-reduced-motion:reduce/);
  assert.match(theme,/prefers-reduced-motion:reduce/);
});
