/* LIVEVERSE ARENA: read-only broadcast view. All player data uses textContent. */
const $ = id => document.getElementById(id);
if (new URLSearchParams(location.search).get('embedded') === '1') document.documentElement.classList.add('embedded');
const modeInfo = {
  quiz: { en:'LIVE QUIZ', short:'QUIZ', ar:'السؤال الحالي', instruction:'اكتب حرف أو رقم الإجابة في الشات • محاولة واحدة فقط' },
  guess: { en:'GUESS IT', short:'GUESS', ar:'خمن الإجابة', instruction:'اكتب التخمين في التعليقات • محاولة واحدة فقط' },
  race: { en:'CHAT RACE', short:'RACE', ar:'السباق المباشر', instruction:'المسجلون يتقدمون بكتابة !go' },
  wheel: { en:'LUCKY DRAW', short:'WHEEL', ar:'عجلة المشاركين', instruction:'يدخل المسجلون في الفعالية للسحب مباشرة' }
};
const stateCache = { questionKey:null, leaderboardKey:null, raceKey:null, resultsKey:null, lastWinnerAt:null, lastSubmissionCount:0 };
let clock = { endsAt: null, duration:30, offset:0, active:false };
let countdownTimers = [];
const formatMs = ms => (Math.max(0, Number(ms)||0)/1000).toFixed(2) + ' ث';
const number = v => new Intl.NumberFormat('en-US').format(Number(v)||0);
function node(tag, className, value) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (value !== undefined) item.textContent = String(value);
  return item;
}
function triggerRoundStartCountdown() {
  const overlay = $('roundStartCountdown');
  const numEl = $('countdownNumber');
  const labelEl = $('countdownLabel');
  if (!overlay || !numEl || !labelEl) return;
  countdownTimers.forEach(clearTimeout);
  countdownTimers = [];
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
  const steps = [
    { val: '3', text: 'استعد للتحدي الملكي', delay: 0 },
    { val: '2', text: 'جهّز إجابتك في الشات', delay: 420 },
    { val: '1', text: 'السرعة تحسم الصدارة', delay: 840 },
    { val: 'انطلق!', text: 'أرسل إجابتك الآن', delay: 1260 }
  ];
  for (const step of steps) {
    countdownTimers.push(setTimeout(() => {
      numEl.textContent = step.val;
      labelEl.textContent = step.text;
      numEl.classList.remove('pop');
      void numEl.offsetWidth;
      numEl.classList.add('pop');
    }, step.delay));
  }
  countdownTimers.push(setTimeout(() => {
    overlay.hidden = true;
  }, 1720));
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
const memberColors = ['#D4AF37','#977328','#B8923A','#7D6024','#C6A34B','#8B6C28','#A88534'];
function createRoyalCrownSvg() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'crown-svg-icon');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.1');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'm2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14');
  svg.append(p);
  return svg;
}
function paintAvatar(container, player) {
  const key=JSON.stringify([player?.name,player?.avatar]);
  if (container.dataset.person === key) return;
  container.dataset.person=key;
  const initial=Array.from(player?.name?.trim()||'؟')[0].toUpperCase();
  container.dataset.initial=initial;
  container.classList.remove('is-loading-avatar','has-loaded-avatar','is-fallback-avatar');
  container.replaceChildren(document.createTextNode(initial));
  if (player?.avatar && /^https:\/\//.test(player.avatar)) {
    container.classList.add('is-loading-avatar');
    const img=document.createElement('img');
    img.alt='';img.decoding='async';img.referrerPolicy='no-referrer';
    img.className='avatar-photo';
    img.addEventListener('load',()=>{
      container.classList.remove('is-loading-avatar');
      container.classList.add('has-loaded-avatar');
      img.classList.add('is-loaded');
    },{once:true});
    img.addEventListener('error',()=>{
      console.warn('[Sky Live Media] تعذر تحميل صورة المتسابق، تم تفعيل الواجهة البديلة:',player.avatar);
      container.classList.remove('is-loading-avatar','has-loaded-avatar');
      container.classList.add('is-fallback-avatar');
      container.setAttribute('title',(player?.name||'متسابق')+' • الصورة غير متاحة حاليًا');
      container.replaceChildren(document.createTextNode(initial));
    },{once:true});
    img.src=player.avatar;container.replaceChildren(img);
  }
}
function renderOptions(items) {
  const list=$('overlayOptions');list.replaceChildren();
  const letters = ['A', 'B', 'C', 'D'];
  items.slice(0,4).forEach((option,i)=>{
    const card=node('div','choice');card.dataset.option=String(i+1);
    const badge=node('span','choice-index');
    badge.append(node('span','',String(i+1)),node('small','choice-letter',letters[i]||String(i+1)));
    const label=node('span','choice-label',option);
    label.classList.toggle('is-long',option.length>22);label.classList.toggle('is-very-long',option.length>48);
    const votes=node('span','choice-mark');
    votes.append(node('span','choice-count','0'),node('span','choice-avatars'));
    const bar=node('span','choice-vote-bar');bar.setAttribute('aria-hidden','true');
    card.append(badge,label,votes,bar);list.append(card);
  });
}
function updateVoteCounts(counts, voters = []) {
  const total=counts.reduce((sum,n)=>sum+n,0);
  $('overlayOptions').querySelectorAll('.choice').forEach((choice,i)=>{
    const count=Number(counts[i])||0;
    const countEl = choice.querySelector('.choice-count');
    const formatted = number(count);
    if (countEl.textContent !== formatted) {
      countEl.textContent = formatted;
      choice.classList.remove('choice-voted');
      void choice.offsetWidth;
      choice.classList.add('choice-voted');
    }
    choice.querySelector('.choice-mark').setAttribute('aria-label',formatted+' إجابة لهذا الخيار');
    choice.querySelector('.choice-vote-bar').style.width=(total?100*count/total:0)+'%';
    const stack=choice.querySelector('.choice-avatars');
    const people=(voters[i]||[]).slice(0,3);const key=JSON.stringify(people);
    if(stack.dataset.people!==key){
      stack.dataset.people=key;stack.replaceChildren();
      for(const person of people){const avatar=node('span','vote-avatar');avatar.title=person.name;paintAvatar(avatar,person);stack.append(avatar);}
    }
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
function triggerConfetti() {
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const stage = $('confettiStage');
  if (!stage) return;
  stage.replaceChildren();
  const colors = ['#D4AF37', '#F4D58D', '#977328', '#F7F3E9', '#E2E8F0', '#B8860B'];
  for (let i = 0; i < 42; i++) {
    const piece = node('i', 'confetti-piece');
    piece.style.setProperty('--cx', `${(i * 2.38) % 100}%`);
    piece.style.setProperty('--cdelay', `${(i % 10) * 0.055}s`);
    piece.style.setProperty('--cdur', `${2.1 + (i % 5) * 0.24}s`);
    piece.style.setProperty('--ccolor', colors[i % colors.length]);
    piece.style.setProperty('--crot', `${(i % 2 ? 1 : -1) * (180 + (i * 23) % 180)}deg`);
    stage.append(piece);
  }
}
function podiumCard(p, rank) {
  const card=node('div',`podium-card place-${rank}`);
  if (rank===1) {
    const crown=node('span','podium-crown anim-trophy');
    crown.append(createRoyalCrownSvg());
    card.append(crown);
  }
  const avatar=node('div','podium-avatar');
  paintAvatar(avatar,p);
  const rankTitle=['المركز الأول','المركز الثاني','المركز الثالث'][rank-1]||String(rank);
  card.append(avatar,
    node('strong','podium-name',p.name),node('span','podium-time',formatMs(p.elapsedMs)),
    node('span','podium-points',`+${p.points} نقاط`),node('div','podium-base',rankTitle));
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
  $('resultsRoundLabel').textContent=`نتائج السؤال ${round}`;
  $('resultsSubtitle').textContent=results.correctCount?'الترتيب حسب أسرع إجابة صحيحة وصلت إلى السيرفر':'انتهى الوقت! هذه الجولة بدون إجابات صحيحة';
  $('resultsCorrect').textContent=results.correctAnswer||'—';
  $('resultsAnswers').textContent=`${number(results.correctCount)} صحيحة / ${number(results.totalAnswers)} إجابة`;
  const podium=$('resultsPodium');const list=$('resultsOthers');podium.replaceChildren();list.replaceChildren();
  if(!results.rankings?.length){
    podium.append(node('div','results-empty anim-cross','لم تُسجّل إجابة صحيحة هذه المرة • الجولة القادمة فرصتك!'));
  }else{
    triggerConfetti();
    results.rankings.slice(0,3).forEach((p,i)=>podium.append(podiumCard(p,i+1)));
    const others=results.rankings.slice(3,10);
    if(!others.length){list.append(node('div','standings-empty','بقية المراكز ستظهر هنا عند مشاركة المزيد من المتسابقين'));}
    for(const p of others){
      const row=node('div','result-other-row');
      const nameCell=node('span','result-person');
      const avatar=node('span','result-avatar');
      paintAvatar(avatar,p);
      nameCell.append(avatar,node('strong','result-person-name',p.name));
      row.append(node('span','',String(p.rank).padStart(2,'0')),nameCell,node('span','result-speed',formatMs(p.elapsedMs)),node('b','',`+${p.points}`));
      list.append(row);
    }
  }
  screen.classList.remove('appear');void screen.offsetWidth;screen.classList.add('appear');
}
function renderRegistration(reg) {
  const screen=$('registrationOverlay'),visible=!!reg&&['open','idle'].includes(reg.phase);
  screen.hidden=!visible;
  if(!visible) return;
  $('signupStateLabel').textContent=reg.phase==='open'?'التسجيل مفتوح':'بانتظار فتح التسجيل';
  $('signupEmptyHint').textContent=reg.phase==='open'?'اكتب كلمة الانضمام في شات البث وبيظهر اسمك وصورتك هنا مباشرة':'تبدأ المشاركة بعد فتح التسجيل. استعد للتحدي!';
  $('signupKeyword').textContent=reg.keyword||'انضم';
  $('signupKeyword').classList.toggle('is-long',(reg.keyword||'').length>8);
  $('signupTitle').textContent=window.lastLiveverseState?.status?.title||'تحدي المعلومات';
  $('signupCount').textContent=number(reg.count||0);
  $('signupReady').textContent=reg.count?number(reg.count)+' متسابقًا جاهزًا':'بانتظار المشاركين';
  const latest=reg.recent?.[0]||null;
  $('signupLatestName').textContent=latest?.name||'بانتظارك';
  $('signupLatestName').title=latest?.name||'';
  $('signupLatestNumber').textContent='#'+number(reg.count||0);
  paintAvatar($('signupLatestAvatar'),latest);
  $('signupLatestDescription').textContent=latest?'رقم الانضمام #'+number(reg.count||0):'مكانك محجوز للتحدي الملكي';
  $('signupEmpty').hidden=!!reg.count;
  const vertical=matchMedia('(max-aspect-ratio:4/5)').matches;
  const slots=vertical?30:matchMedia('(max-width:1200px)').matches?60:77;
  const members=Array.isArray(reg.participants)?reg.participants.slice(-slots):[];
  const key=JSON.stringify([reg.session,reg.count,members,slots]);
  if (screen.dataset.lastRegistrants===key)return;
  const firstPaint=!screen.dataset.lastRegistrants;
  screen.dataset.lastRegistrants=key;
  const wall=$('signupRecent'),latestNumber=members.at(-1)?.number;
  const numbers=new Set(members.map(p=>String(p.number)));
  for(const card of [...wall.children]) if(!numbers.has(card.dataset.number)) card.remove();
  const existing=new Map([...wall.children].map(card=>[card.dataset.number,card]));
  members.forEach((player, idx) => {
    let card=existing.get(String(player.number));
    if(!card){
      card=node('div','signup-member-card');card.dataset.number=String(player.number);
      card.append(node('span','member-avatar'),node('bdi','member-name'));
      if(firstPaint)card.style.animationDelay=`${Math.min(idx*0.018, 0.45)}s`;
      wall.append(card);
    }
    card.classList.toggle('is-latest',player.number===latestNumber);
    card.style.setProperty('--member-color',memberColors[(player.number-1)%memberColors.length]);
    card.title=player.name;card.querySelector('.member-name').textContent=player.name;
    paintAvatar(card.querySelector('.member-avatar'),player);
  });
  const spotlight=screen.querySelector('.signup-spotlight');
  spotlight.style.setProperty('--member-color',memberColors[Math.max(0,(reg.count||1)-1)%memberColors.length]);
  if(spotlight.dataset.latest!==String(reg.count)){
    spotlight.dataset.latest=String(reg.count);spotlight.classList.remove('joined');
    void spotlight.offsetWidth;spotlight.classList.add('joined');
  }
}
function fitBroadcastText() {
  for(const element of [$('overlayPrompt'),...document.querySelectorAll('.choice-label')]) {
    if(!element.getClientRects().length)continue;
    element.style.removeProperty('font-size');
    const parent=element.parentElement,style=getComputedStyle(parent);
    let available=parent.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
    if(element.classList.contains('choice-label')&&matchMedia('(max-aspect-ratio:4/5)').matches) available-=parent.querySelector('.choice-mark').offsetHeight+parseFloat(style.rowGap);
    let size=parseFloat(getComputedStyle(element).fontSize),minimum=element.id==='overlayPrompt'?16:13;
    while(size>minimum&&(element.scrollHeight>available+1||element.scrollWidth>element.clientWidth+1))element.style.fontSize=(--size)+'px';
  }
}
window.addEventListener('resize',()=>{if(window.lastLiveverseState)renderRegistration(window.lastLiveverseState.registration);requestAnimationFrame(fitBroadcastText);});
document.fonts?.ready.then(fitBroadcastText);
function update(data) {
  if (!data || !data.status) return;
  window.lastLiveverseState=data;
  const s=data.status, mode=modeInfo[s.mode]||modeInfo.quiz;
  const phase=['open','idle'].includes(data.registration?.phase)?'registration':s.results?'results':s.active?'active':'waiting';
  const arena=$('arena');arena.dataset.mode=s.mode;arena.dataset.phase=phase;
  arena.querySelector('.arena-body').hidden=phase==='registration'||phase==='results';
  $('overlayRound').replaceChildren(document.createTextNode(s.mode==='quiz'?'السؤال ':'الجولة '),node('b','',data.round||1));
  renderProgressDots(data.round||1);
  $('footerRound').textContent=String(data.round||1).padStart(3,'0');
  $('overlayLiveText').textContent=phase==='registration'?'التسجيل مفتوح':phase==='results'?'انتهت الجولة':phase==='active'?'البث المباشر':'في انتظار البداية';
  $('modeTag').textContent=mode.en;
  $('questionMode').textContent=mode.short;
  $('questionLabel').textContent=mode.ar;
  $('stageTag').textContent=phase==='active'?'التحدي بدأ':phase==='results'?'اكتملت الجولة':'استعد للتحدي';
  $('overlayTitle').textContent=s.title||'تحدي الجمهور';
  $('overlayPrompt').textContent=s.mode==='race'?'سجّل دخولك وابدأ السباق نحو المركز الأول!':s.mode==='wheel'?'ادخل السحب وانتظر لحظة اختيار الفائز!':s.prompt||'استعد للسؤال التالي';
  $('overlayHint').textContent=s.mode==='quiz'?'اكتب رقم الإجابة 1 – 4 في الشات':mode.instruction;
  $('overlayOptions').hidden=s.mode!=='quiz';
  $('overlayRace').hidden=s.mode!=='race';
  $('overlayWheel').hidden=s.mode!=='wheel';
  const questionKey=JSON.stringify([s.mode,s.options,s.prompt,data.round]);
  if(s.mode==='quiz' && questionKey!==stateCache.questionKey) {
    renderOptions(s.options||[]);
    const qCard = $('questionCard');
    qCard.classList.remove('question-enter');
    void qCard.offsetWidth;
    qCard.classList.add('question-enter');
  }
  if(s.mode==='quiz') {
    updateVoteCounts(s.choiceCounts||[],s.choiceVoters||[]);
    const correctAns = s.results?.correctAnswer || '';
    $('overlayOptions').querySelectorAll('.choice').forEach(choice => {
      const labelTxt = choice.querySelector('.choice-label')?.textContent || '';
      const isRight = !!correctAns && (correctAns.includes(labelTxt) || correctAns.startsWith(choice.dataset.option));
      choice.classList.toggle('is-correct', !!s.results && isRight);
      choice.classList.toggle('is-wrong', !!s.results && !isRight);
    });
  }
  $('overlayPrompt').classList.toggle('is-long',(s.prompt||'').length>70);
  $('overlayPrompt').classList.toggle('is-very-long',(s.prompt||'').length>125);
  if(questionKey!==stateCache.questionKey)requestAnimationFrame(fitBroadcastText);
  stateCache.questionKey=questionKey;
  if(s.mode==='race') renderRace(data.race||[],s.target);
  $('overlayWheelCount').textContent=number(data.entriesCount||0)+' مشارك';
  $('wheelEntriesPreview').textContent=(data.entries||[]).slice(0,3).join(' • ')||'أسماء المسجلين في الفعالية';
  $('overlayPlayers').textContent=number(data.registration?.count ?? data.playerCount ?? 0);
  const subCount = s.mode==='wheel'?data.entriesCount||0:s.mode==='race'?(data.race||[]).length:s.submissionCount||0;
  $('overlaySubmissions').textContent=number(subCount);
  if (subCount > stateCache.lastSubmissionCount) {
    const box = $('answerTotalBox');
    box.classList.remove('pulse-hit');
    void box.offsetWidth;
    box.classList.add('pulse-hit');
  }
  stateCache.lastSubmissionCount = subCount;
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
  if(phase==='active'&&update.previousPhase&&update.previousPhase!==phase){
    triggerRoundStartCountdown();
    requestAnimationFrame(fitBroadcastText);
  } else if (phase !== 'active') {
    $('roundStartCountdown').hidden = true;
  }
  update.previousPhase=phase;
  const banner=$('winnerBanner');
  if(s.lastEvent?.winner && !s.results){
    if(stateCache.lastWinnerAt!==s.lastEvent.at){
      stateCache.lastWinnerAt=s.lastEvent.at;
      $('winnerName').textContent=s.lastEvent.winner.name;
      paintAvatar($('winnerAvatar'),s.lastEvent.winner);
      triggerConfetti();
      banner.hidden=false;banner.classList.remove('appear');void banner.offsetWidth;banner.classList.add('appear');
    }
  }else banner.hidden=true;
}
function connect() {
  const protocol=location.protocol==='https:'?'wss':'ws';
  const ws=new WebSocket(`${protocol}://${location.host}/ws`);
  ws.addEventListener('open',()=>{$('connectionNotice').hidden=true;});
  ws.addEventListener('message',event=>{try{const packet=JSON.parse(event.data);if(packet.type==='state')update(packet.data);}catch(error){console.warn('Invalid live data',error);}});
  ws.addEventListener('close',()=>{$('connectionNotice').hidden=false;setTimeout(connect,3000);});
  ws.addEventListener('error',()=>ws.close());
}
function guardOverlayImages() {
  const onFail = img => {
    if (!img || img.dataset.fallbackApplied === '1') return;
    img.dataset.fallbackApplied = '1';
    console.warn('[Sky Live Media] تعذر تحميل الصورة، تم تفعيل الواجهة البديلة:', img.currentSrc || img.src);
    img.alt = '';
    img.hidden = true;
    const parent = img.parentElement;
    if (parent && parent.dataset.initial !== undefined) {
      parent.classList.remove('is-loading-avatar', 'has-loaded-avatar');
      parent.classList.add('is-fallback-avatar', 'is-fallback-ready');
      parent.replaceChildren(document.createTextNode(parent.dataset.initial || '؟'));
      return;
    }
    if (parent && !parent.querySelector('.brand-mark-fallback')) {
      const fb = node('span', 'brand-mark-fallback is-fallback-ready', 'SL');
      fb.title = 'الصورة غير متاحة حاليًا';
      parent.prepend(fb);
    }
  };
  window.addEventListener('error', event => {
    const target = event.target;
    if (target && target.tagName === 'IMG') onFail(target);
  }, true);
  window.addEventListener('load', event => {
    const target = event.target;
    if (target && target.tagName === 'IMG') {
      if (target.naturalWidth > 0) target.classList.add('is-loaded');
      else onFail(target);
    }
  }, true);
  document.querySelectorAll('img').forEach(img => {
    if (img.complete) {
      if (img.naturalWidth > 0) img.classList.add('is-loaded');
      else onFail(img);
    }
  });
}
guardOverlayImages();
fetch('/api/state').then(res=>{if(!res.ok)throw new Error('API not available');return res.json();}).then(update).catch(()=>{$('overlayStatus').textContent='جارٍ الاتصال بالمنصة...';});
connect();
