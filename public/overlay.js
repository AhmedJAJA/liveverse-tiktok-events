const $=id=>document.getElementById(id);
let lastWinner;
let currentResultsKey;
let clockInfo = { endsAt:null, offset:0 };
const formatTime = ms => (Math.max(0, ms)/1000).toFixed(2) + 's';
function refreshCountdown() {
  if (!clockInfo.endsAt) return;
  const seconds = Math.max(0, Math.ceil((clockInfo.endsAt - (Date.now() + clockInfo.offset))/1000));
  $('overlaySeconds').textContent = Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
  $('overlayTimer').classList.toggle('urgent',seconds<=10);
}
setInterval(refreshCountdown,200);
function displayRoundResults(data) {
  const result = data.status.results;
  const stage = $('roundResultsOverlay');
  stage.hidden = !result || !['quiz','guess'].includes(data.status.mode);
  if (stage.hidden) { currentResultsKey = null; return; }
  const key = data.round + ':' + result.completedAt;
  if (key === currentResultsKey) return;
  currentResultsKey = key;
  $('resultsSubtitle').textContent = result.correctCount ? 'الترتيب حسب أول إجابة صحيحة وصلت خلال الجولة' : 'ما أحد جاوب صح هذه الجولة';
  $('resultsAnswers').textContent = `${result.correctCount} صحيحة من ${result.totalAnswers} مشاركة`;
  $('resultsCorrect').textContent = '✓ الإجابة الصحيحة: ' + result.correctAnswer;
  const podium = $('resultsPodium'); podium.replaceChildren();
  const others = $('resultsOthers'); others.replaceChildren();
  result.rankings.slice(0,3).forEach((p,i) => {
    const box = document.createElement('div'); box.className = 'result-podium-place place-' + (i+1);
    const medal = document.createElement('span'); medal.className='result-medal'; medal.textContent = ['🥇','🥈','🥉'][i];
    const name = document.createElement('strong'); name.textContent = p.name;
    const time = document.createElement('span'); time.textContent = formatTime(p.elapsedMs);
    const points = document.createElement('b'); points.textContent = '+'+p.points+' نقطة';
    box.append(medal,name,time,points); podium.append(box);
  });
  result.rankings.slice(3,10).forEach(p=>{
    const row=document.createElement('div'); row.className='result-other-row';
    const rank=document.createElement('span');rank.textContent='#'+p.rank;
    const name=document.createElement('strong');name.textContent=p.name;
    const time=document.createElement('span');time.textContent=formatTime(p.elapsedMs);
    const pts=document.createElement('b');pts.textContent='+'+p.points;
    row.append(rank,name,time,pts);others.append(row);
  });
  if (!result.rankings.length) {
    const empty=document.createElement('p');empty.className='result-empty';empty.textContent='حظ أوفر للجميع! 🎯';podium.append(empty);
  }
  stage.classList.remove('appear'); void stage.offsetWidth; stage.classList.add('appear');
}

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
 $('overlayHint').textContent=({quiz:'إجابة واحدة فقط لكل مشاهد • الأسرع يتصدر',guess:'تخمين واحد لكل مشاهد • الأسرع يتصدر',race:'!join للانضمام • !go للتقدم',wheel:'!join للمشاركة في السحب'})[status.mode];
 const isTimed = ['quiz','guess'].includes(status.mode) && status.active && status.endsAt;
 $('overlayTimer').hidden = !isTimed;
 clockInfo = {endsAt: isTimed ? status.endsAt : null, offset: s.serverTime - Date.now()};
 if(isTimed){refreshCountdown(); $('overlaySubmissions').textContent = (status.submissionCount || 0) + ' إجابة';}
 $('overlayStatus').textContent=status.active?'الجولة جارية الآن':status.notice || 'جاهز للبدء';
 displayRoundResults(s);
 const standing=$('overlayStandings');standing.replaceChildren();s.leaderboard.slice(0,3).forEach((p,i)=>{const item=document.createElement('span');item.textContent=`${['🥇','🥈','🥉'][i]} ${p.name} · ${p.score}`;standing.append(item);});
 if(status.lastEvent?.winner && !status.results){
  if(lastWinner!==status.lastEvent.at){lastWinner=status.lastEvent.at;const banner=$('winnerBanner');$('winnerName').textContent=status.lastEvent.winner.name;banner.hidden=false;banner.classList.remove('appear');void banner.offsetWidth;banner.classList.add('appear');}
 }else $('winnerBanner').hidden=true;
}
function connect() {const ws=new WebSocket((location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ws');ws.addEventListener('message',e=>{try{const x=JSON.parse(e.data);if(x.type==='state')update(x.data);}catch{}});ws.addEventListener('close',()=>setTimeout(connect,3000));ws.addEventListener('error',()=>ws.close());}
fetch('/api/state').then(r=>r.json()).then(update).catch(()=>{});connect();
