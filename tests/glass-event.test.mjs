import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Engine, MODES } from '../src/engine.mjs';

const read = path => fs.readFileSync(new URL('../'+path, import.meta.url),'utf8');

test('glass bridge is an implemented chat-driven game, not a visual-only option',()=>{
  assert.ok(MODES.includes('glass'));
  let time=10_000;
  const engine=new Engine({now:()=>time,random:()=>0});
  engine.openRegistration({keyword:'انضم',maxPlayers:2,audience:'all'});
  for(const id of ['a','b','c'])engine.receiveChat({id,username:id,text:'انضم'});
  assert.equal(engine.players.size,2);
  engine.configure({mode:'glass',glassSteps:5,glassStepDuration:10});
  engine.start();
  assert.equal(engine.snapshot().glass.step,1);
  assert.equal(engine.snapshot().glass.remaining,2);
  engine.receiveChat({id:'a',username:'a',text:'1'});
  engine.receiveChat({id:'a',username:'a',text:'2'});
  engine.receiveChat({id:'b',username:'b',text:'2'});
  assert.deepEqual(engine.snapshot().glass.choiceCounts,[1,1]);
  assert.ok(!JSON.stringify(engine.snapshot()).includes('safeSide'));
  time+=10_000;engine.tick();
  assert.equal(engine.snapshot().glass.remaining,1);
  assert.equal(engine.snapshot().glass.step,2);
  assert.deepEqual(engine.snapshot().glass.choiceCounts,[0,0]);
  for(let i=2;i<=5;i++){
    engine.receiveChat({id:'a',username:'a',text:'1'});
    time+=10_000;engine.tick();
  }
  const result=engine.snapshot();
  assert.equal(result.status.active,false);
  assert.equal(result.status.results.correctCount,1);
  assert.equal(result.status.results.rankings[0].name,'a');
  assert.equal(engine.players.get('a').score,10);
  assert.equal(engine.players.get('b').score,0);
});
test('glass bridge eliminates players missing the deadline and does not award false wins',()=>{
  let now=1000;const e=new Engine({now:()=>now,random:()=>1});
  e.openRegistration({maxPlayers:30});
  e.receiveChat({id:'p',username:'Player',text:'انضم'});
  e.configure({mode:'glass',glassSteps:5,glassStepDuration:10});
  e.start();
  e.receiveChat({id:'p',username:'Player',text:'1'});
  now+=10000;e.tick();
  const state=e.snapshot();
  assert.equal(state.status.active,false);
  assert.equal(state.status.results.correctCount,0);
  assert.equal(state.status.winner,null);
});
test('registration limits and eligibility are enforced on server, not just frontend',()=>{
  const e=new Engine();
  assert.throws(()=>e.openRegistration({maxPlayers:0}),/عدد اللاعبين/);
  assert.throws(()=>e.openRegistration({maxPlayers:1501}),/عدد اللاعبين/);
  assert.throws(()=>e.openRegistration({audience:'unknown'}),/نوع الجمهور/);
  e.openRegistration({maxPlayers:2,audience:'followers'});
  e.receiveChat({id:'a',username:'A',text:'انضم'});
  e.receiveChat({id:'b',username:'B',text:'انضم',isFollower:true});
  e.receiveChat({id:'c',username:'C',text:'انضم',isSubscriber:true});
  e.receiveChat({id:'d',username:'D',text:'انضم',isFollower:true});
  assert.equal(e.players.size,2);
  assert.equal(e.registration.count,undefined);
  e.openRegistration({reset:true,maxPlayers:3,audience:'subscribers'});
  e.receiveChat({id:'c',username:'C',text:'انضم',isFollower:true});
  e.receiveChat({id:'b',username:'B',text:'انضم',isSubscriber:true});
  assert.equal(e.players.size,1);
  assert.equal(e.snapshot().registration.audience,'subscribers');
});
test('rejected eligibility and invalid input do not leak hidden glass answer',()=>{
  const e=new Engine({random:()=>1});
  e.openRegistration({maxPlayers:30,audience:'subscribers'});
  e.receiveChat({id:'p',username:'P',text:'انضم',isSubscriber:true});
  e.configure({mode:'glass',glassSteps:5,glassStepDuration:10});
  e.start();
  const text=JSON.stringify(e.snapshot());
  assert.doesNotMatch(text,/"safeSide"/);
  assert.doesNotMatch(text,/"answer":"2"/);
  e.receiveChat({id:'p',username:'P',text:'3'});
  assert.equal(e.snapshot().glass.voted,0);
  e.receiveChat({id:'p',username:'P',text:'٢'});
  assert.equal(e.snapshot().glass.voted,1);
});
test('event details route matches approved screenshot layout and safely binds to admin endpoints',()=>{
  const page=read('public/event.html');
  const css=read('public/event.css');
  const js=read('public/event.js');
  const server=read('server.mjs');
  const landing=read('public/landing.html');
  for(const id of ['eventName','eventCategory','joinBannerWord','joinKeyword','maxPlayers','advancedSettings','startGameButton','accessDialog','bridgePanels'])
    assert.ok(page.includes('id="'+id+'"'),id);
  for(const heading of ['رجوع للألعاب','طول اللعبة','الافتراضي','كلمة الانضمام','أقصى لاعبين (حتى 30)','من ينضم؟','إعدادات متقدمة','ابدأ اللعبة'])
    assert.ok(page.includes(heading),heading);
  for(const selector of ['.event-hero','.event-visual','.join-banner','.length-selector','.form-strip','.audience-selector','.advanced-panel','.start-game'])
    assert.ok(css.includes(selector),selector);
  assert.match(css,/@media \(max-width:560px\)/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(server,/'\/event': 'event\.html'/);
  for(const asset of ['event.html','event.js','event.css'])assert.ok(server.includes("'"+asset+"'"),asset);
  // Home covers open each game's join page; this setup page stays the advanced settings screen.
  // SPONGE LIVE home lists its twelve games; this page stays reachable from the studio and the join page.
  for(const mode of ['quiz','drawguess','chairs','bowling','bomb','categories','rps','roles','roulette','redlight','country','flag'])assert.ok(landing.includes('/play?mode='+mode),mode);
  for(const act of ['registration-open','registration-close','configure','start','bank-next'])assert.ok(js.includes("'"+act+"'"),act);
  assert.match(js,/sessionStorage\.getItem\('liveverse_admin'\)/);
  assert.doesNotMatch(js,/\/api\/dev-token/);
});
