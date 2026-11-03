/* LIVEVERSE ARENA: read-only broadcast view. All player data uses textContent. */
const $ = id => document.getElementById(id);
const modeInfo = {
  quiz: { en:'LIVE QUIZ', short:'QUIZ', ar:'السؤال الحالي', instruction:'اكتب حرف أو رقم الإجابة في الشات • محاولة واحدة فقط' },
  guess: { en:'GUESS IT', short:'GUESS', ar:'خمن الإجابة', instruction:'اكتب التخمين في التعليقات • محاولة واحدة فقط' },
  race: { en:'CHAT RACE', short:'RACE', ar:'السباق المباشر', instruction:'المسجلون يتقدمون بكتابة !go' },
  wheel: { en:'LUCKY DRAW', short:'WHEEL', ar:'عجلة المشاركين', instruction:'يدخل المسجلون في الفعالية للسحب مباشرة' }
};
const stateCache = { questionKey:null, leaderboardKey:null, raceKey:null, resultsKey:null, lastWinnerAt:null };
let clock = { endsAt: null, duration:30, offset:0, active:false };
const formatMs = ms => (Math.max(0, Number(ms)||0)/1000).toFixed(2) + 's';
const number = v => new Intl.NumberFormat('ar-SA').format(Number(v)||0);
function node(tag, className, value) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (value !== undefined) item.textContent = String(value);
  return item;
}
function renderClock() {
  const seconds = clock.active && clock.endsAt != null
    ? Math.max(0, Math.ceil((clock.endsAt - (Date.now() + clock.offset)) / 1000))
    : clock.duration;
  const pct = clock.active && clock.endsAt != null ? Math.max(0, Math.min(1, (clock.endsAt - (Date.now() + clock.offset))/(clock.duration*1000))) : 1;
  const label = $('arena').dataset.mode === 'quiz' ? String(seconds) : `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  $('overlaySeconds').textContent = label;
  $('timerFace').style.setProperty('--timer-angle', `${Math.round(pct*360)}deg`);
  $('topProgress').style.width = (clock.active ? Math.round(pct*100) : 0) + '%';
  const urgent = clock.active && seconds<=10;
  $('overlayTimer').classList.toggle('urgent',urgent);
  $('clockStatus').textContent = !clock.active?'بانتظار بدء التحدي':urgent?'الثواني الأخيرة!':'جميع الإجابات تُسجل الآن';
}
setInterval(renderClock,200);
function updateStandings(players) {
  const key = JSON.stringify(players.slice(0,3).map(({id,name,score})=>[id,name,score]));
  if (key === stateCache.leaderboardKey) return;
  stateCache.leaderboardKey = key;
  const list = $('overlayStandings');list.replaceChildren();
  if (!players.length) { list.append(node('div','standings-empty','مكانك بين الأبطال يبدأ بإجابة واحدة.')); return; }
  players.slice(0,3).forEach((p,i)=>{
    const row=node('div','standing-row');
    row.append(node('span','standing-pos',String(i+1).padStart(2,'0')),node('span','standing-name',p.name),node('strong','standing-score',p.score));
    list.append(row);
  });
}
function renderOptions(items) {
  const list=$('overlayOptions'); list.replaceChildren();
  items.slice(0,4).forEach((option,i)=>{
    const card=node('div','choice');
    card.dataset.option=String(i+1);
    const badge=node('span','choice-index');badge.append(node('span','',String(i+1)));
    const votes=node('span','choice-mark','◉ 0');votes.setAttribute('aria-label','عدد إجابات هذا الخيار');
    card.append(badge,node('span','choice-label',option),votes);
    list.append(card);
  });
}
function updateVoteCounts(counts) {
  $('overlayOptions').querySelectorAll('.choice').forEach((choice,i)=>{
    const mark=choice.querySelector('.choice-mark');
    if (mark) mark.textContent='◉ '+number(counts[i]||0);
  });
}
function renderProgressDots(round) {
  const dots=$('quizProgressDots');
  if (!dots) return;
  const selected=((Math.max(1,round)-1)%10);
  if(dots.children.length!==10) {
    dots.replaceChildren();
    for(let i=0;i<10;i++)dots.append(node('span',''));
  }
  [...dots.children].forEach((item,i)=>{
    item.classList.toggle('is-current',i===selected);
    item.classList.toggle('is-done',i<selected);
  });
}
function renderRace(race, target) {
  const key=JSON.stringify([race.slice(0,7),target]);
  if (key===stateCache.raceKey) return;
  stateCache.raceKey=key;
  const panel=$('overlayRace');panel.replaceChildren();
  if (!race.length){panel.append(node('div','racer-empty','بانتظار المتسابقين المسجلين'));return;}
  race.slice(0,7).forEach(p=>{
    const row=node('div','racer');
    const track=node('div','race-track');const fill=node('div','race-fill');
    fill.style.width = Math.min(100,Math.max(0,100*Number(p.progress)/(target||12)))+'%';track.append(fill);
    row.append(node('strong','',p.name),track,node('small','',`${p.progress}/${target||12}`));panel.append(row);
  });
}
function podiumCard(p, rank) {
  const card=node('div',`podium-card place-${rank}`);
  if (rank===1) card.append(node('span','podium-crown','♛'));
  card.append(node('div','podium-avatar',rank===1?'★':rank===2?'✦':'◆'),
    node('strong','podium-name',p.name),node('span','podium-time',formatMs(p.elapsedMs)),
    node('span','podium-points',`+${p.points} PTS`),node('div','podium-base',rank));
  return card;
}
function renderResults(status, round) {
  const results=status.results;
  const show=!!results && ['quiz','guess'].includes(status.mode);
  const screen=$('roundResultsOverlay');
  screen.hidden=!show;
  if (!show) {stateCache.resultsKey=null;return;}
  const key=`${round}:${results.completedAt}`;
  if (stateCache.resultsKey===key) return;
  stateCache.resultsKey=key;
  $('resultsRoundLabel').textContent=`ROUND ${String(round).padStart(2,'0')} • FINISHED`;
  $('resultsSubtitle').textContent=results.correctCount?'الترتيب حسب أسرع إجابة صحيحة وصلت إلى السيرفر':'انتهى الوقت! هذه الجولة بدون إجابات صحيحة';
  $('resultsCorrect').textContent=results.correctAnswer||'—';
  $('resultsAnswers').textContent=`${number(results.correctCount)} صحيحة / ${number(results.totalAnswers)} إجابة`;
  const podium=$('resultsPodium');const list=$('resultsOthers');podium.replaceChildren();list.replaceChildren();
  if(!results.rankings?.length){
    podium.append(node('div','results-empty','لم تُسجّل إجابة صحيحة هذه المرة • الجولة القادمة فرصتك!'));
  }else{
    results.rankings.slice(0,3).forEach((p,i)=>podium.append(podiumCard(p,i+1)));
    const others=results.rankings.slice(3,10);
    if(!others.length){list.append(node('div','standings-empty','بقية المراكز ستظهر هنا عند مشاركة المزيد من المتسابقين.'));}
    for(const p of others){
      const row=node('div','result-other-row');
      row.append(node('span','',String(p.rank).padStart(2,'0')),node('strong','',p.name),node('span','result-speed',formatMs(p.elapsedMs)),node('b','',`+${p.points}`));
      list.append(row);
    }
  }
  screen.classList.remove('appear');void screen.offsetWidth;screen.classList.add('appear');
}
function renderRegistration(reg) {
  const screen=$('registrationOverlay'),visible=!!reg&&reg.phase==='open';
  screen.hidden=!visible;
  if(!visible) return;
  $('signupKeyword').textContent=reg.keyword||'انضم';
  $('signupCount').textContent=number(reg.count||0);
  $('signupReady').textContent='جاهزون للبدء ('+number(reg.count||0)+')';
  const latest=reg.recent?.[0]||null;
  $('signupLatestName').textContent=latest?.name||'بانتظار أول متسابق';
  $('signupLatestNumber').textContent='#'+(reg.count||0);
  $('signupLatestAvatar').textContent=latest?.name?.trim()?.charAt(0)?.toUpperCase()||'✦';
  $('signupLatestDescription').textContent=latest?'المشارك رقم '+number(reg.count||0):'اكتب كلمة الانضمام لتظهر هنا';
  const small=matchMedia('(max-width:540px)').matches;
  const vertical=matchMedia('(max-aspect-ratio:4/5)').matches;
  const slots=small?30:vertical?48:66;
  const members=Array.isArray(reg.participants)?reg.participants.slice(-slots):[];
  const key=JSON.stringify([reg.session,reg.count,members,slots]);
  if (screen.dataset.lastRegistrants===key)return;
  screen.dataset.lastRegistrants=key;
  const wall=$('signupRecent');wall.replaceChildren();
  const latestNumber=members.at(-1)?.number;
  for(const player of members) {
    const card=node('div','signup-member-card');
    if(player.number===latestNumber) card.classList.add('is-latest');
    card.title=player.name;
    card.append(node('span','member-avatar',player.name.trim().charAt(0).toUpperCase()||'✦'),node('span','member-name',player.name));
    wall.append(card);
  }
  for(let i=members.length;i<slots;i++) {
    const card=node('div','signup-member-card is-empty');
    card.setAttribute('aria-hidden','true');card.append(node('span','member-avatar','✧'),node('span','member-name','بانتظار مشارك'));
    wall.append(card);
  }
}
window.addEventListener('resize',()=>{if(window.lastLiveverseState)renderRegistration(window.lastLiveverseState.registration);});
function update(data) {
  if (!data || !data.status) return;
  window.lastLiveverseState=data;
  const s=data.status, mode=modeInfo[s.mode]||modeInfo.quiz;
  const phase=data.registration?.phase==='open'?'registration':s.results?'results':s.active?'active':'waiting';
  const arena=$('arena');arena.dataset.mode=s.mode;arena.dataset.phase=phase;
  $('overlayRound').textContent=s.mode==='quiz'?'السؤال '+(data.round||1):`ROUND ${String(data.round||1).padStart(2,'0')}`;
  renderProgressDots(data.round||1);
  $('footerRound').textContent=String(data.round||1).padStart(3,'0');
  $('overlayLiveText').textContent=phase==='registration'?'JOIN NOW':phase==='results'?'FINISHED':phase==='active'?'LIVE NOW':'STANDBY';
  $('modeTag').textContent=mode.en;
  $('questionMode').textContent=mode.short;
  $('questionLabel').textContent=mode.ar;
  $('stageTag').textContent=phase==='active'?'التحدي بدأ':phase==='results'?'اكتملت الجولة':'استعد للتحدي';
  $('overlayTitle').textContent=s.title||'تحدي الجمهور';
  $('overlayPrompt').textContent=s.mode==='race'?'سجّل دخولك وابدأ السباق نحو المركز الأول!':s.mode==='wheel'?'ادخل السحب وأنتظر لحظة اختيار الفائز!':s.prompt||'استعد للسؤال التالي';
  $('overlayHint').textContent=s.mode==='quiz'?'اكتب رقم الإجابة من 1 إلى 4 في الشات • إجابة واحدة فقط':mode.instruction;
  $('overlayOptions').hidden=s.mode!=='quiz';
  $('overlayRace').hidden=s.mode!=='race';
  $('overlayWheel').hidden=s.mode!=='wheel';
  const questionKey=JSON.stringify([s.mode,s.options,s.prompt,data.round]);
  if(s.mode==='quiz' && questionKey!==stateCache.questionKey) renderOptions(s.options||[]);
  if(s.mode==='quiz') updateVoteCounts(s.choiceCounts||[]);
  stateCache.questionKey=questionKey;
  if(s.mode==='race') renderRace(data.race||[],s.target);
  $('overlayWheelCount').textContent=number(data.entriesCount||0)+' مشارك';
  $('wheelEntriesPreview').textContent=(data.entries||[]).slice(0,3).join(' • ')||'أسماء المسجلين في الفعالية';
  $('overlayPlayers').textContent=number(data.registration?.count ?? data.playerCount ?? 0);
  $('overlaySubmissions').textContent=number(s.mode==='wheel'?data.entriesCount||0:s.mode==='race'?(data.race||[]).length:s.submissionCount||0);
  $('overlayStatus').textContent=s.active?'الجولة جارية • أرسل إجابتك الآن':s.results?'اكتملت الجولة • النتائج ظهرت':s.notice||'جاهز لبدء الجولة';
  $('footerDetail').textContent=phase==='active'?'إجابتك الأولى فقط هي المعتمدة':phase==='results'?'الصدارة للأسرع في الإجابة الصحيحة':'انتظر انطلاق المنافسة';
  clock={endsAt:s.endsAt??null,duration:Number(s.duration)||30,offset:(Number(data.serverTime)||Date.now())-Date.now(),active:!!s.active&&['quiz','guess'].includes(s.mode)};
  renderClock();
  $('overlayTimer').hidden=['race','wheel'].includes(s.mode);
  updateStandings(data.leaderboard||[]);
  renderResults(s,data.round);
  // Signup takes priority over a stale results screen from the previous round.
  if(phase==='registration') $('roundResultsOverlay').hidden=true;
  renderRegistration(data.registration);
  const banner=$('winnerBanner');
  if(s.lastEvent?.winner && !s.results){
    if(stateCache.lastWinnerAt!==s.lastEvent.at){
      stateCache.lastWinnerAt=s.lastEvent.at;
      $('winnerName').textContent=s.lastEvent.winner.name;
      banner.hidden=false;banner.classList.remove('appear');void banner.offsetWidth;banner.classList.add('appear');
    }
  }else banner.hidden=true;
}
function connect() {
  const protocol=location.protocol==='https:'?'wss':'ws';
  const ws=new WebSocket(`${protocol}://${location.host}/ws`);
  ws.addEventListener('message',event=>{try{const packet=JSON.parse(event.data);if(packet.type==='state')update(packet.data);}catch(error){console.warn('Invalid live data',error);}});
  ws.addEventListener('close',()=>setTimeout(connect,3000));
  ws.addEventListener('error',()=>ws.close());
}
fetch('/api/state').then(res=>{if(!res.ok)throw new Error('API not available');return res.json();}).then(update).catch(()=>{$('overlayStatus').textContent='جارٍ الاتصال بالمنصة...';});
connect();
