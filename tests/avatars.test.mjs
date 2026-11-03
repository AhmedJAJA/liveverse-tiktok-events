import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, safeAvatarUrl } from '../src/engine.mjs';

const avatar='https://p16-sign-sg.tiktokcdn.com/tos-avt-0068/sample.jpeg?signature=public-image';
test('TikTok profile photos survive registration, later messages and public cards',()=>{
  let time=1000;const engine=new Engine({now:()=>time});
  engine.openRegistration();
  engine.receiveChat({id:'private-id',username:'نور',text:'انضم',avatar});
  assert.equal(engine.snapshot().registration.recent[0].avatar,avatar);
  assert.deepEqual(engine.snapshot().registration.participants,[{name:'نور',number:1,avatar}]);
  assert.equal(engine.snapshot().leaderboard[0].avatar, avatar);
  engine.start();time+=500;
  engine.receiveChat({id:'private-id',username:'نور',text:'2'});
  const voter=engine.snapshot().status.choiceVoters[1][0];
  assert.deepEqual(voter,{name:'نور',number:1,avatar});
  assert.equal(voter.id,undefined);
  assert.equal(voter.correct,undefined);
  assert.equal(engine.snapshot().status.answer,undefined);
});
test('visible voter stacks contain at most three people while counts remain exact',()=>{
  let time=1000;const engine=new Engine({now:()=>time});engine.openRegistration();
  for(let i=0;i<8;i++)engine.receiveChat({id:'id'+i,username:'مشاهد '+i,text:'انضم'});
  engine.start();time+=500;
  for(let i=0;i<8;i++)engine.receiveChat({id:'id'+i,username:'مشاهد '+i,text:'3'});
  assert.equal(engine.snapshot().status.choiceCounts[2],8);
  assert.equal(engine.snapshot().status.choiceVoters[2].length,3);
  time+=500;engine.receiveChat({id:'id0',username:'مشاهد 0',text:'1'});
  assert.equal(engine.snapshot().status.choiceCounts[0],0);
  assert.equal(engine.snapshot().status.choiceVoters[0].length,0);
  assert.equal(engine.snapshot().status.submissionCount,8);
});
test('new rounds clear the previous voter photos without clearing registration',()=>{
  const engine=new Engine();engine.openRegistration();
  engine.receiveChat({id:'p',username:'نور',text:'انضم',avatar});engine.start();
  engine.receiveChat({id:'p',username:'نور',text:'1',avatar});engine.stop();engine.start();
  assert.deepEqual(engine.snapshot().status.choiceVoters,[[],[],[],[]]);
  assert.equal(engine.snapshot().registration.participants[0].avatar,avatar);
});
test('only bounded HTTPS profile-image URLs from supported CDNs are accepted',()=>{
  assert.equal(safeAvatarUrl(avatar),avatar);
  assert.equal(safeAvatarUrl('https://p16.tiktokcdn-us.com/photo.jpeg'),'https://p16.tiktokcdn-us.com/photo.jpeg');
  for(const value of ['http://p16.tiktokcdn.com/a','javascript:alert(1)','data:image/svg+xml,abc','https://tiktokcdn.com.evil.example/a','https://eviltiktokcdn.com/a','https://user:pass@p16.tiktokcdn.com/a','https://p16.tiktokcdn.com:81/a','https://127.0.0.1/a','https://example.com/a',{},null,'x'.repeat(3000)])assert.equal(safeAvatarUrl(value),'');
});
test('invalid profile images fall back to text without changing enrollment',()=>{
  const engine=new Engine();engine.openRegistration();
  engine.receiveChat({id:'p',username:'اسم طويل <script>',text:'انضم',avatar:'javascript:alert(1)'});
  assert.equal(engine.snapshot().registration.count,1);
  assert.equal(engine.snapshot().registration.participants[0].avatar,undefined);
});
