import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {WebSocket} from 'ws';

async function freePort(){
  const holder=createServer();holder.listen(0,'127.0.0.1');await once(holder,'listening');
  const port=holder.address().port;await new Promise(resolve=>holder.close(resolve));return port;
}
function viewer(base){
  const ws=new WebSocket(base.replace('http','ws')+'/ws');
  const v={ws,latest:null,count:0};
  ws.on('message',raw=>{const packet=JSON.parse(raw);if(packet.type==='state'){v.latest=packet.data;v.count++;}});
  return once(ws,'open').then(()=>v);
}
const until=async(check,ms=4000)=>{const end=Date.now()+ms;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,20));}throw new Error('timed out');};
const view=b=>({matchId:b.matchId,turn:b.turn,phase:b.phase,holder:b.holder?.number,endsAt:b.endsAt,alive:b.alive.map(p=>p.number)});

test('16–17. TIME BOMB: viewers stay in sync, late viewers recover the live match, admin is server-protected',async()=>{
  const port=await freePort();
  const token=randomBytes(24).toString('hex');
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,ADMIN_TOKEN:token,PORT:String(port),NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('server start timeout')),8000).unref())]);
    const base='http://127.0.0.1:'+port;
    const post=async(action,body={},auth=token)=>{
      const res=await fetch(base+'/api/admin/'+action,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:JSON.stringify(body)});
      return {status:res.status,data:await res.json()};
    };
    // Admin powers are enforced by the server, not by hiding buttons.
    for(const action of ['bomb-demo','bomb-pause','bomb-pass','bomb-restart','bomb-settings','bomb-end'])
      assert.equal((await post(action,{},null)).status,401,action);
    assert.equal((await post('bomb-demo',{count:3},'wrong-token')).status,401);

    const a=await viewer(base),b=await viewer(base);
    assert.equal((await post('configure',{mode:'bomb',title:'القنبلة المؤقتة',bombSeconds:15})).status,200);
    assert.equal((await post('bomb-settings',{autoBots:false})).status,200);
    assert.equal((await post('bomb-demo',{count:6})).data.added,6);
    assert.equal((await post('start')).status,200);
    await until(()=>a.latest?.bomb?.phase==='armed'&&b.latest?.bomb?.phase==='armed');
    assert.deepEqual(view(a.latest.bomb),view(b.latest.bomb),'both viewers see the same holder and deadline');
    assert.equal(a.latest.bomb.endsAt-a.latest.serverTime<=15000,true);

    const first=a.latest.bomb;
    const target=first.alive.find(p=>p.number!==first.holder.number).number;
    assert.equal((await post('bomb-pass',{target,turn:first.turn,match:first.matchId})).status,200);
    await until(()=>a.latest.bomb.holder?.number===target&&b.latest.bomb.holder?.number===target);
    assert.equal(a.latest.bomb.endsAt,first.endsAt,'the deadline is identical after a pass');
    // A duplicate/stale request for the same turn after the holder changed is rejected.
    const again=await post('bomb-pass',{target:first.holder.number,turn:first.turn-1,match:first.matchId});
    assert.equal(again.status,400);

    // A viewer that (re)connects mid-match receives the authoritative state immediately.
    a.ws.close();
    const late=await viewer(base);
    await until(()=>late.latest?.bomb);
    assert.deepEqual(view(late.latest.bomb),view(b.latest.bomb));
    const viaHttp=await (await fetch(base+'/api/state')).json();
    assert.deepEqual(view(viaHttp.bomb),view(b.latest.bomb),'page refresh (HTTP) matches the live socket state');

    // Pause keeps time; resume continues; manual end frees the engine.
    assert.equal((await post('bomb-pause')).status,200);
    await until(()=>b.latest.bomb.phase==='paused');
    const frozen=b.latest.bomb.remainingMs;
    await new Promise(r=>setTimeout(r,400));
    assert.equal((await (await fetch(base+'/api/state')).json()).bomb.remainingMs,frozen);
    assert.equal((await post('bomb-resume')).status,200);
    await until(()=>b.latest.bomb.phase==='armed');
    assert.equal((await post('bomb-end')).status,200);
    await until(()=>b.latest.bomb.phase==='finished'&&b.latest.status.active===false);
    assert.equal((await post('bomb-restart')).status,200);
    await until(()=>b.latest.bomb.phase==='armed'&&b.latest.bomb.turn===1&&b.latest.bomb.passes.length===0);
    late.ws.close();b.ws.close();
  }finally{child.kill();}
});
