import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = path => fs.readFileSync(new URL('../public/'+path, import.meta.url), 'utf8');
const home=file('index.html');
const overlay=file('overlay.html');
const landing=file('home.html');
const core=file('royal-core.css');
const studio=file('royal-studio.css');
const broadcast=file('royal-broadcast.css');
const landingCss=file('home.css');
const sprite=file('icons.svg');
const script=file('app.js');
const overlayJs=file('overlay.js');

test('every page loads the shared royal core before its own surface stylesheet',()=>{
  for(const [html,surface] of [[home,'royal-studio.css'],[overlay,'royal-broadcast.css']]) {
    const coreAt=html.indexOf('href="/royal-core.css"'), surfaceAt=html.indexOf('href="/'+surface+'"');
    assert.ok(coreAt>0,'core missing');
    assert.ok(surfaceAt>coreAt,surface+' must load after core');
  }
});
test('design tokens define the royal black and gold palette in one place',()=>{
  // SPONGE LIVE: the ocean palette lives in royal-core tokens and the sponge.css theme layer.
  for(const color of ['#050B17','#0A132A','#102045','#37B3D4','#8CD9F1','#E7F2F6']) assert.ok(core.includes(color),color);
  const sponge=fs.readFileSync(new URL('../public/sponge.css',import.meta.url),'utf8');
  for(const token of ['--sp-deep','--sp-cyan','--sp-yellow','--sp-yellow-btn','--sp-neon']) assert.ok(sponge.includes(token+':'),token);
  for(const token of ['--obsidian','--carbon','--graphite','--gold','--champagne','--ivory','--metal']) assert.ok(core.includes(token+':'),token);
  // surfaces consume tokens instead of redefining the palette
  for(const css of [studio,broadcast,landingCss]) assert.doesNotMatch(css,/--gold:\s*#/);
});
test('surface styles cover the presenter, controls, broadcast views and landing',()=>{
  for(const selector of ['.presenter-toolbar','.presenter-actions','.presenter-stage','.presenter-footer','.settings-dialog','.modes','.leaderboard']) assert.ok(studio.includes(selector),selector);
  for(const selector of ['.question-card','.choice','.signup-spotlight','.signup-member-grid','.results-screen','.podium-card','.winner-banner','.round-start-countdown','.clock-face']) assert.ok(broadcast.includes(selector),selector);
  for(const selector of ['.hm-card','.hm-enter','.hm-cards','.hm-error','.hm-logo']) assert.ok(landingCss.includes(selector),selector);
});
test('presenter controls remain connected and live stats contain no fake data',()=>{
  for(const id of ['presenterRegistration','presenterSettings','presenterNext','presenterStop','presenterFullscreen','presenterStart','presenterAudienceCount','presenterQuestionNumber'])
    assert.ok(home.includes('id="'+id+'"'),id);
  assert.match(script,/el\('presenterAudienceCount'\)\.textContent=count/);
  assert.match(script,/el\('presenterQuestionNumber'\)\.textContent=/);
  assert.match(script,/presenterKeyword'\)\.textContent=active/);
});
test('every icon referenced by markup or scripts exists in the sprite',()=>{
  const ids=new Set([...sprite.matchAll(/<symbol id="([^"]+)"/g)].map(m=>m[1]));
  const used=new Set([...[home,overlay,landing].join('\n').matchAll(/\/icons\.svg#([\w-]+)/g)].map(m=>m[1]));
  for(const m of overlayJs.matchAll(/icon\('([\w-]*\w)'/g)) used.add(m[1]);
  for(let i=1;i<=4;i++) used.add('g-'+i); // answer glyphs built as 'g-'+(i+1)
  assert.ok(used.size>15);
  for(const id of used) assert.ok(ids.has(id),'missing icon '+id);
});
test('primary interface controls use SVG icons, not emoji',()=>{
  const emoji=/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  const toolbar=home.slice(home.indexOf('<header class="presenter-toolbar"'),home.indexOf('</footer>'));
  assert.doesNotMatch(toolbar,emoji);
  assert.match(toolbar,/<use href="\/icons\.svg#i-/);
  assert.doesNotMatch(overlay,emoji);
  assert.doesNotMatch(script,emoji);
});
test('mobile, accessibility and reduced motion are supported',()=>{
  assert.match(studio,/@media \(max-width:780px\)/);
  assert.match(studio,/@media \(prefers-reduced-motion:reduce\)/);
  assert.match(core,/:focus-visible/);
  assert.match(core,/@media \(prefers-reduced-motion:reduce\)/);
  assert.match(broadcast,/max-aspect-ratio:4\/5/);
  assert.match(overlay,/id="signupRecent"/);
  assert.match(overlay,/id="roundResultsOverlay"/);
  assert.match(script,/aria-pressed/);
});
test('original own branding used, no impersonation or external third-party source',()=>{
  for(const content of [broadcast,studio,landingCss,home,overlay]) assert.doesNotMatch(content,/hudhudlive\.com/i);
  assert.match(home,/SPONGE LIVE/);
  assert.match(overlay,/SPONGE LIVE/);
  for(const content of [core,studio,broadcast,landingCss]) assert.doesNotMatch(content,/@import|https?:\/\//);
});
test('every element id is unique on each page (duplicate ids break getElementById lookups)',()=>{
  for(const [name,html] of [['index.html',home],['overlay.html',overlay],['home.html',landing]]){
    const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);
    const dupes=ids.filter((id,i)=>ids.indexOf(id)!==i);
    assert.deepEqual(dupes,[],name);
  }
});
