const $=id=>document.getElementById(id);
let lastWinner;
const modeLabels={quiz:'QUIZ',guess:'GUESS',race:'RACE',wheel:'WHEEL'};
function update(s) {
 const status=s.status;
 $('overlayRound').textContent=`ROUND ${String(s.round).padStart(2,'0')} / ${modeLabels[status.mode]||'EVENT'}`;
 $('overlayTitle').textContent=status.title || 'تحدي الجمهور';
 $('overlayPrompt').textContent=status.mode==='race'?'اكتب !join ثم !go لتتقدم نحو خط النهاية':status.mode==='wheel'?'اكتب !join أو !انضم لتدخل السحب':status.prompt || '';
 $('overlayOptions').hidden=status.mode!=='quiz';
 if(status.mode==='quiz'){
  $('overlayOptions').replaceChildren();(status.options||[]).forEach((op,i)=>{const box=document.createElement('div');const letter=document.createTextNode(String.fromCharCode(65+i)+'  ');const value=document.createElement('span');value.textContent=op;box.append(letter,value);$('overlayOptions').append(box);});
 }
 $('overlayRace').hidden=status.mode!=='race';
 $('overlayWheel').hidden=status.mode!=='wheel';
 if(status.mode==='race') {
  const race=$('overlayRace');race.replaceChildren();
  for(const p of s.race.slice(0,7)){
   const row=document.createElement('div');row.className='racer';const name=document.createElement('strong');name.textContent=p.name;
   const progress=document.createElement('div');progress.className='race-track';const fill=document.createElement('div');fill.className='race-fill';fill.style.width=Math.min(100,100*p.progress/(status.target||12))+'%';progress.append(fill);
   const count=document.createElement('small');count.textContent=`${p.progress}/${status.target||12}`;
   row.append(name,progress,count);race.append(row);
  }
 }
 $('overlayWheelCount').textContent=s.entriesCount+' مشاركين';
 $('overlayHint').textContent=({quiz:'اكتب رقم الإجابة الصحيحة في الشات',guess:'اكتب الحل الصحيح في الشات',race:'!join للانضمام • !go للتقدم',wheel:'!join للمشاركة في السحب'})[status.mode];
 $('overlayStatus').textContent=status.active?'الجولة جارية الآن':status.notice || 'جاهز للبدء';
 const standing=$('overlayStandings');standing.replaceChildren();s.leaderboard.slice(0,3).forEach((p,i)=>{const item=document.createElement('span');item.textContent=`${['🥇','🥈','🥉'][i]} ${p.name} · ${p.score}`;standing.append(item);});
 if(status.lastEvent?.winner){
  if(lastWinner!==status.lastEvent.at){lastWinner=status.lastEvent.at;const banner=$('winnerBanner');$('winnerName').textContent=status.lastEvent.winner.name;banner.hidden=false;banner.classList.remove('appear');void banner.offsetWidth;banner.classList.add('appear');}
 }else $('winnerBanner').hidden=true;
}
function connect() {const ws=new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ws');ws.addEventListener('message',e=>{try{const x=JSON.parse(e.data);if(x.type==='state')update(x.data);}catch{}});ws.addEventListener('close',()=>setTimeout(connect,3000));ws.addEventListener('error',()=>ws.close());}
fetch('/api/state').then(r=>r.json()).then(update).catch(()=>{});connect();
