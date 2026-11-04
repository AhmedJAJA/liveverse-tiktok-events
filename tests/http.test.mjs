import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';

test('HTTP host flow, read-only viewer, fonts and live answer summaries work together',async()=>{
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const token=randomBytes(24).toString('hex');
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),ADMIN_TOKEN:token,NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',chunk=>errors+=chunk);
  try{
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw new Error(errors||'Server exited');}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Server startup timed out')),8000).unref())]);
    const base='http://127.0.0.1:'+port;
    const post=async(action,data={})=>{
      const response=await fetch(base+'/api/admin/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data)});
      assert.equal(response.status,200,action+': '+response.status);return response.json();
    };
    for(const route of ['/','/overlay','/studio','/royal-core.css','/royal-broadcast.css','/royal-studio.css','/home.css','/studio.css','/icons.svg','/sponge-mark.svg','/fonts/tajawal-arabic-800-normal.woff2','/fonts/inter-display-semibold.woff']){
      const response=await fetch(base+route);assert.equal(response.status,200,route);
      if(route.endsWith('.woff2'))assert.equal(response.headers.get('content-type'),'font/woff2');
      if(route.endsWith('.woff'))assert.equal(response.headers.get('content-type'),'font/woff');
      assert.ok((await response.arrayBuffer()).byteLength>100);
    }
    assert.equal((await fetch(base+'/.env.local')).status,404);
    // A production or test server must never allow anonymous token discovery.
    assert.equal((await fetch(base+'/api/dev-token')).status,404);
    assert.equal((await fetch(base+'/api/admin/start',{method:'POST'})).status,401);
    await post('registration-open',{keyword:'انضم'});
    await post('simulate',{username:'أحمد',text:'انضم'});
    await post('simulate',{username:'منى',text:'انضم'});
    await post('configure',{prompt:'أي خيار صحيح؟',options:['الأول','الثاني','الثالث','الرابع'],answer:'2'});
    await post('start');
    await post('simulate',{username:'أحمد',text:'2'});
    await post('simulate',{username:'منى',text:'1'});
    await post('simulate',{username:'غير مسجل',text:'2'});
    let state=await(await fetch(base+'/api/state')).json();
    assert.equal(state.registration.phase,'closed');
    assert.equal(state.status.answer,undefined);
    assert.deepEqual(state.status.choiceCounts,[1,1,0,0]);
    assert.equal(state.status.choiceVoters[1][0].name,'أحمد');
    await post('stop');state=await(await fetch(base+'/api/state')).json();
    assert.equal(state.status.results.correctAnswer,'الثاني');
    assert.equal(state.status.results.rankings[0].name,'أحمد');
    assert.equal(state.status.results.totalAnswers,2);
    await post('registration-open');state=await(await fetch(base+'/api/state')).json();
    assert.equal(state.registration.count,2);assert.equal(state.status.results,null);
  }finally{
    if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}
  }
});
