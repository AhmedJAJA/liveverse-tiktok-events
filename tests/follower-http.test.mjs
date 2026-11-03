import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';

test('HTTP follower filter is enforced immediately and cannot be changed by a viewer',async()=>{
  const holder=createServer();
  holder.listen(0,'127.0.0.1');await once(holder,'listening');
  const port=holder.address().port;await new Promise(resolve=>holder.close(resolve));
  const adminToken=randomBytes(24).toString('hex');
  const child=spawn(process.execPath,['server.mjs'],{
    cwd:new URL('..',import.meta.url),
    env:{...process.env,ADMIN_TOKEN:adminToken,PORT:String(port),NODE_ENV:'test'},
    stdio:['ignore','pipe','pipe']
  });
  let stderr='';child.stderr.on('data',b=>stderr+=b);
  try {
    await Promise.race([
      once(child.stdout,'data'),
      once(child,'exit').then(()=>{throw Error(stderr||'Server exited');}),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('Timeout starting server')),8000).unref())
    ]);
    const base='http://127.0.0.1:'+port;
    const state=async()=>{const res=await fetch(base+'/api/state');assert.equal(res.status,200);return res.json();};
    const call=async(action,data,authorized=true)=>{
      const headers={'Content-Type':'application/json'};
      if(authorized)headers.Authorization='Bearer '+adminToken;
      const res=await fetch(base+'/api/admin/'+action,{method:'POST',headers,body:JSON.stringify(data||{})});
      const body=await res.json();
      return {status:res.status,body};
    };
    assert.equal((await call('registration-settings',{audience:'all'},false)).status,401);
    let r=await call('registration-settings',{audience:'followers',maxPlayers:30});
    assert.equal(r.status,200);assert.equal(r.body.registration.audience,'followers');
    assert.equal((await state()).registration.audience,'followers');
    r=await call('registration-open',{keyword:'انضم'});
    assert.equal(r.status,200);
    await call('simulate',{username:'Outsider',text:'انضم',isFollower:false});
    await call('simulate',{username:'Follower',text:'انضم',isFollower:true});
    assert.equal((await state()).registration.count,1);
    assert.deepEqual((await state()).registration.participants.map(x=>x.name),['Follower']);

    // A public session starts open to everyone; changing the switch must remove prior nonfollowers.
    await call('registration-settings',{audience:'all'});
    await call('simulate',{username:'Unverified',text:'انضم'});
    assert.equal((await state()).registration.count,2);
    r=await call('registration-settings',{audience:'followers'});
    assert.equal(r.status,200);assert.equal(r.body.registration.removed,1);
    assert.equal((await state()).registration.count,1);
    assert.deepEqual((await state()).registration.participants.map(x=>x.name),['Follower']);
    await call('simulate',{username:'SomeoneElse',text:'انضم'});
    assert.equal((await state()).registration.count,1);

    // Subscribers must also be positively verified, not inferred from follower status.
    r=await call('registration-settings',{audience:'subscribers'});
    assert.equal(r.status,200);assert.equal((await state()).registration.count,0);
    await call('simulate',{username:'F2',text:'انضم',isFollower:true});
    await call('simulate',{username:'Sub',text:'انضم',isSubscriber:true});
    assert.equal((await state()).registration.count,1);
    assert.equal((await state()).registration.participants[0].name,'Sub');
  } finally {
    if(child.exitCode===null) {child.kill('SIGTERM');await once(child,'exit');}
  }
});
