import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Engine } from '../src/engine.mjs';

test('registration wall shows only real enrolled viewers and not account identifiers', () => {
  let time=1000;
  const engine=new Engine({ now:()=>time });
  engine.openRegistration({keyword:'انضم'});
  engine.receiveChat({id:'secret-tiktok-id',username:'منى',text:'انضم'});
  engine.receiveChat({id:'secret-tiktok-id',username:'منى',text:'انضم'});
  engine.receiveChat({id:'another-id',username:'ناصر',text:'مرحبا'});
  const reg=engine.snapshot().registration;
  assert.equal(reg.count,1);
  assert.equal(reg.participants.length,1);
  assert.deepEqual(reg.participants[0],{name:'منى',number:1});
  assert.ok(!JSON.stringify(reg).includes('secret-tiktok-id'));
});
test('live choice counters count first answer only and keep answer secret',()=>{
  let time=2000;
  const engine=new Engine({now:()=>time});
  engine.openRegistration();
  engine.receiveChat({id:'one',username:'Player 1',text:'انضم'});
  engine.receiveChat({id:'two',username:'Player 2',text:'انضم'});
  engine.start();
  time+=100;
  engine.receiveChat({id:'one',username:'Player 1',text:'2'});
  time+=400;
  engine.receiveChat({id:'one',username:'Player 1',text:'1'});
  time+=400;
  engine.receiveChat({id:'two',username:'Player 2',text:'1'});
  const state=engine.snapshot();
  assert.deepEqual(state.status.choiceCounts,[1,1,0,0]);
  assert.equal(state.status.submissionCount,2);
  assert.equal(state.status.answer,undefined);
  assert.equal(state.registration.count,2);
});
test('broadcast theme and overlay source contain required registration layout hooks',()=>{
  const html=fs.readFileSync(new URL('../public/overlay.html',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../public/royal-broadcast.css',import.meta.url),'utf8');
  const js=fs.readFileSync(new URL('../public/overlay.js',import.meta.url),'utf8');
  for(const id of ['signupRecent','signupLatestName','signupLatestNumber','signupLatestAvatar','signupReady','quizProgressDots']) assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(css,/signup-member-grid/);
  assert.match(css,/choice:nth-child\(4\)/);
  assert.match(js,/updateVoteCounts/);
  assert.match(js,/renderRegistration/);
});
