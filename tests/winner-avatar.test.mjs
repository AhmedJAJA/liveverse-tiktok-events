import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Engine } from '../src/engine.mjs';

const avatarA='https://p16-sign.tiktokcdn-us.com/tos-useast5-avt-0068-tx/profile1.jpeg';
const avatarB='https://p16-sign.tiktokcdn-us.com/tos-useast5-avt-0068-tx/profile2.jpeg';
function setup() {
  let time=10_000;
  const engine=new Engine({now:()=>time});
  engine.openRegistration();
  const chat=(id,name,text,avatar='')=>engine.receiveChat({id,username:name,text,avatar});
  return {engine,chat,tick:(ms=1000)=>{time+=ms;}};
}

test('winning a quiz preserves the avatar captured during TikTok registration',()=>{
  const {engine,chat,tick}=setup();
  chat('u1','أحمد','انضم',avatarA);
  chat('u2','سارة','انضم',avatarB);
  engine.start();
  tick(1234);
  chat('u1','أحمد','1',avatarA);
  tick(500);
  chat('u2','سارة','1',avatarB);
  engine.stop();
  const result=engine.snapshot().status;
  assert.equal(result.results.rankings.length,2);
  assert.equal(result.results.rankings[0].avatar,avatarA);
  assert.equal(result.results.rankings[1].avatar,avatarB);
  assert.equal(result.winner.avatar,avatarA);
  assert.equal(result.lastEvent.winner.avatar,avatarA);
  assert.equal(result.results.rankings[0].name,'أحمد');
});

test('uses the latest safe profile image from a contestant chat when answering',()=>{
  const {engine,chat,tick}=setup();
  chat('u1','أحمد','انضم');
  engine.start();
  tick(1000);
  chat('u1','أحمد','1',avatarA);
  engine.stop();
  assert.equal(engine.snapshot().status.results.rankings[0].avatar,avatarA);
});

test('does not publish untrusted avatar URLs on the winner board',()=>{
  const {engine,chat,tick}=setup();
  chat('u1','أحمد','انضم','https://malicious.example/profile.png');
  engine.start();
  tick(1000);
  chat('u1','أحمد','1','javascript:alert(1)');
  engine.stop();
  assert.equal(engine.snapshot().status.results.rankings[0].avatar,undefined);
  assert.equal(engine.snapshot().status.winner.avatar,undefined);
});

test('results podium and winner banner use the shared image-or-initial fallback renderer',()=>{
  const js=fs.readFileSync(new URL('../public/overlay.js',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../public/royal-core.css',import.meta.url),'utf8');
  const html=fs.readFileSync(new URL('../public/overlay.html',import.meta.url),'utf8');
  assert.match(js,/function podiumCard\(/);
  assert.match(js,/paintAvatar\(avatar,p\)/);
  assert.match(js,/paintAvatar\(\$\('winnerAvatar'\),s\.lastEvent\.winner\)/);
  assert.match(html,/id="winnerAvatar"/);
  // Avatar photos are styled once, in the shared core, for every avatar surface.
  assert.match(css,/:is\([^)]*\.podium-avatar[^)]*\) img/);
  assert.match(css,/:is\([^)]*\.result-avatar[^)]*\) img/);
});

test('winning wheel or race preserves the contestant avatar in winner announcement',()=>{
  const {engine,chat}=setup();
  chat('u1','أحمد','انضم',avatarA);
  engine.configure({mode:'wheel'});
  engine.start();
  engine.drawWheel();
  const state=engine.snapshot().status;
  assert.equal(state.winner.avatar,avatarA);
  assert.equal(state.lastEvent.winner.avatar,avatarA);
});

test('all pages implement smart image loading, skeleton shimmer and luxury fallback UI without raw Image unavailable text',()=>{
  const files=['home.html','home.js','studio.html','studio.js','index.html','app.js','overlay.html','overlay.js','royal-core.css'];
  for(const f of files){
    const content=fs.readFileSync(new URL('../public/'+f,import.meta.url),'utf8');
    assert.doesNotMatch(content,/Image unavailable\./i);
  }
  const appJs=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const overlayJs=fs.readFileSync(new URL('../public/overlay.js',import.meta.url),'utf8');
  const themeCss=fs.readFileSync(new URL('../public/royal-core.css',import.meta.url),'utf8');
  const studioJs=fs.readFileSync(new URL('../public/studio.js',import.meta.url),'utf8');
  assert.match(studioJs,/img\.addEventListener\('error', \(\) => img\.remove\(\)/); // a broken avatar falls back to the initial
  assert.match(appJs,/createAvatarFallbackSvg/);
  assert.match(appJs,/replaceBrokenImageWithSvg/);
  assert.match(appJs,/window\.addEventListener\('error'/);
  assert.match(appJs,/is-loading-avatar/);
  assert.match(appJs,/is-fallback-avatar/);
  assert.match(overlayJs,/is-loading-avatar/);
  assert.match(overlayJs,/is-fallback-avatar/);
  assert.match(themeCss,/\.img-skeleton/);
  assert.match(themeCss,/\.img-fallback-card/);
  assert.match(themeCss,/\.avatar-svg-placeholder/);
});
