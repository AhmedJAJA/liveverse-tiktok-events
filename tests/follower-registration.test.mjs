import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/engine.mjs';
import { isConfirmedFollower, isConfirmedSubscriber } from '../src/bridge.mjs';

test('TikTok modern followStatus and legacy followRole: only verified followers are accepted', () => {
  for (const v of [1, 2, '1', '2']) {
    assert.equal(isConfirmedFollower({user:{followStatus:v}}),true,'status '+v);
  }
  for (const v of [0, '0', 3, null, undefined]) {
    assert.equal(isConfirmedFollower({user:{followStatus:v}}),false,'status '+v);
  }
  assert.equal(isConfirmedFollower({user:{followInfo:{followStatus:1}}}),true);
  assert.equal(isConfirmedFollower({user:{followRole:2}}),true);
  assert.equal(isConfirmedFollower({followRole:1}),true);
  assert.equal(isConfirmedFollower({user:{followStatus:0,followRole:1}}),false,'explicit nonfollow wins');
  assert.equal(isConfirmedFollower({user:{followInfo:{followStatus:0},followRole:2}}),false,'nested nonfollow wins');
  assert.equal(isConfirmedFollower({user:{}}),false,'unknown state must not be treated as following');
  assert.equal(isConfirmedFollower({}),false,'missing sender must be rejected');
  assert.equal(isConfirmedSubscriber({user:{isSubscriber:true}}),true);
  assert.equal(isConfirmedSubscriber({user:{isSubscriber:false}}),false);
});

test('followers-only mode rejects unverified and unfollowed users then accepts after following and reposting join word', () => {
  let now=3000;
  const e=new Engine({now:()=>now});
  e.openRegistration({audience:'followers',keyword:'انضم',maxPlayers:30});
  e.receiveChat({id:'notfollowing',username:'NonFollower',text:'انضم',isFollower:false});
  e.receiveChat({id:'unknown',username:'Unknown',text:'انضم'});
  e.receiveChat({id:'subscriber',username:'Subscriber',text:'انضم',isSubscriber:true});
  assert.equal(e.snapshot().playerCount,0);
  now+=500;
  e.receiveChat({id:'notfollowing',username:'NonFollower',text:'انضم',isFollower:true});
  assert.equal(e.snapshot().playerCount,1);
  assert.deepEqual(e.snapshot().registration.participants.map(x=>x.name),['NonFollower']);
});

test('changing from everybody to followers immediately removes earlier nonfollowers and keeps verified participants',()=>{
  const e=new Engine();
  e.openRegistration({keyword:'انضم',audience:'all',maxPlayers:30});
  e.receiveChat({id:'n',username:'NonFollower',text:'انضم',isFollower:false});
  e.receiveChat({id:'f',username:'Follower',text:'انضم',isFollower:true});
  e.receiveChat({id:'u',username:'Unknown',text:'انضم'});
  assert.equal(e.snapshot().playerCount,3);
  const session=e.registration.session, opened=e.registration.openedAt;
  const result=e.updateRegistration({audience:'followers',maxPlayers:1});
  assert.deepEqual({removed:result.removed,remaining:result.remaining}, {removed:2,remaining:1});
  assert.equal(e.snapshot().registration.audience,'followers');
  assert.equal(e.registration.phase,'open');
  assert.equal(e.registration.session,session,'updating restriction must not start a new registration');
  assert.equal(e.registration.openedAt,opened);
  assert.deepEqual(e.snapshot().registration.participants.map(x=>x.name),['Follower']);
  assert.equal(e.snapshot().playerCount,1);
  assert.equal(e.snapshot().registration.recent.some(x=>x.name==='NonFollower'),false);
  assert.equal(e.snapshot().leaderboard.some(x=>x.name==='Unknown'),false);
});

test('reopening registration with restricted audience prunes old ineligible entrants',()=>{
  const e=new Engine();
  e.openRegistration({audience:'all'});
  e.receiveChat({id:'a',username:'Any',text:'انضم'});
  e.receiveChat({id:'b',username:'RealFollower',text:'انضم',isFollower:true});
  e.openRegistration({audience:'followers'});
  assert.equal(e.snapshot().playerCount,1);
  assert.deepEqual(e.snapshot().registration.participants.map(x=>x.name),['RealFollower']);
});

test('subscriber mode also excludes follower-only users and unknown subscription flags',()=>{
  let now=1000;const e=new Engine({now:()=>now});
  e.openRegistration({audience:'subscribers'});
  e.receiveChat({id:'f',username:'Follower',text:'انضم',isFollower:true});
  e.receiveChat({id:'s',username:'Subscriber',text:'انضم',isSubscriber:true});
  assert.equal(e.snapshot().playerCount,1);
  assert.equal(e.snapshot().registration.participants[0].name,'Subscriber');
});

test('saving audience before LIVE starts carries over when the host opens registration',()=>{
  const e=new Engine();
  const result=e.updateRegistration({audience:'followers',maxPlayers:30});
  assert.equal(result.phase,'idle');
  e.setConnection('connected','broadcaster','connected');
  assert.equal(e.snapshot().registration.phase,'idle','connecting never opens registration');
  e.openRegistration({});
  assert.equal(e.snapshot().registration.phase,'open');
  assert.equal(e.snapshot().registration.audience,'followers');
  e.receiveChat({id:'n',username:'NoFollow',text:'انضم'});
  e.receiveChat({id:'f',username:'YesFollow',text:'انضم',isFollower:true});
  assert.equal(e.snapshot().playerCount,1);
});

