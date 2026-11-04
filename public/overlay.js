/* SKY LIVE ARENA: read-only broadcast view. All player data uses textContent. */
const $ = id => document.getElementById(id);
if (new URLSearchParams(location.search).get('embedded') === '1') document.documentElement.classList.add('embedded');
const modeInfo = {
  quiz: { en:'LIVE QUIZ', short:'QUIZ', ar:'السؤال الحالي', instruction:'اكتب رقم الإجابة 1 – 4 في الشات • محاولة واحدة فقط' },
  guess: { en:'GUESS IT', short:'GUESS', ar:'خمن الإجابة', instruction:'اكتب تخمينك في التعليقات • محاولة واحدة فقط' },
  race: { en:'CHAT RACE', short:'RACE', ar:'السباق المباشر', instruction:'المسجلون يتقدمون بكتابة !go أو انطلق' },
  wheel: { en:'LUCKY DRAW', short:'WHEEL', ar:'عجلة المشاركين', instruction:'كل المسجلين في الفعالية داخل السحب تلقائيًا' },
  bomb: { en:'TIME BOMB', short:'BOMB', ar:'القنبلة المؤقتة', instruction:'حامل القنبلة يكتب !مرر ثم رقم اللاعب قبل الانفجار' },
  glass: { en:'GLASS BRIDGE', short:'GLASS', ar:'الجسر الزجاجي', instruction:'اكتب 1 أو 2 لاختيار اللوح الآمن — محاولة واحدة لكل خطوة' },
  rps: { en:'ROCK PAPER SCISSORS', short:'RPS', ar:'حجر ورقة مقص', instruction:'اكتب حجر أو ورقة أو مقص — Sky يكشف اختياره بعد الوقت' },
  minority: { en:'MINORITY WINS', short:'MINORITY', ar:'الأقلية تفوز', instruction:'اكتب 1 أو 2 — الجهة الأقل عددًا تنجو' },
  higherlower: { en:'HIGHER OR LOWER', short:'HI-LO', ar:'أعلى أم أقل', instruction:'اكتب أعلى أو أقل — الورقة التالية تحسم' },
  truefalse: { en:'TRUE OR FALSE', short:'T / F', ar:'حقيقة أم كذب', instruction:'اكتب صح أو خطأ — الأسرع يحصد نقاطًا أكثر' },
  redlight: { en:'RED LIGHT', short:'RED LIGHT', ar:'الضوء الأحمر', instruction:'عند الأخضر اكتب رقمًا من 1 إلى 5 — الحركة عند الأحمر تقصيك' },
  bowling: { en:'BOWLING', short:'BOWLING', ar:'البولينج', instruction:'اكتب رقمًا من 1 إلى 10 لترمي الكرة' }
};
const PARTY = new Set(['rps','minority','higherlower','truefalse','redlight','bowling']);
const params = new URLSearchParams(location.search);
if (params.get('perf') === '1') document.documentElement.classList.add('au-perf');
const apiPath = path => (window.SkySession ? window.SkySession.withRoom(path) : path);
const stateCache = { questionKey:null, leaderboardKey:null, raceKey:null, resultsKey:null, lastWinnerAt:null, lastSubmissionCount:0 };
let clock = { endsAt: null, duration:30, offset:0, active:false };
let countdownTimers = [];
const reducedMotion = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
const formatMs = ms => (Math.max(0, Number(ms)||0)/1000).toFixed(2) + ' ث';
const number = v => new Intl.NumberFormat('en-US').format(Number(v)||0);
const SVG_NS = 'http://www.w3.org/2000/svg';
function node(tag, className, value) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (value !== undefined) item.textContent = String(value);
  return item;
}
/* Icon from the shared sprite (/icons.svg). Decorative: hidden from assistive tech. */
function icon(id, className = 'i') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '/icons.svg#' + id);
  svg.append(use);
  return svg;
}
function restartAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}
function triggerRoundStartCountdown(mode = 'quiz') {
  const finalLine = mode==='race' ? 'اكتب !go وانطلق نحو النهاية' : mode==='wheel' ? 'العجلة تدور الآن' : 'أرسل إجابتك الآن';
  const overlay = $('roundStartCountdown');
  const numEl = $('countdownNumber');
  const labelEl = $('countdownLabel');
  if (!overlay || !numEl || !labelEl) return;
  countdownTimers.forEach(clearTimeout);
  countdownTimers = [];
  if (reducedMotion()) { overlay.hidden = true; return; }
  overlay.hidden = false;
  const steps = [
    { val: '3', text: 'استعد للتحدي', delay: 0 },
    { val: '2', text: mode==='wheel'?'كل المسجلين داخل السحب':'جهّز نفسك في الشات', delay: 420 },
    { val: '1', text: mode==='wheel'?'الحظ يختار البطل':'السرعة تحسم الصدارة', delay: 840 },
    { val: 'انطلق', text: finalLine, delay: 1260 }
  ];
  for (const step of steps) {
    countdownTimers.push(setTimeout(() => {
      numEl.textContent = step.val;
      labelEl.textContent = step.text;
      numEl.classList.toggle('is-word', step.val.length > 1);
      restartAnimation(numEl, 'pop');
      restartAnimation(overlay.querySelector('.countdown-dial'), 'tick');
    }, step.delay));
  }
  countdownTimers.push(setTimeout(() => { overlay.hidden = true; }, 1760));
}
function renderClock() {
  const seconds = clock.active && clock.endsAt != null
    ? Math.max(0, Math.ceil((clock.endsAt - (Date.now() + clock.offset)) / 1000))
    : clock.duration;
  const pct = clock.active && clock.endsAt != null ? Math.max(0, Math.min(1, (clock.endsAt - (Date.now() + clock.offset))/(clock.duration*1000))) : 1;
  const label = $('arena').dataset.mode === 'quiz' ? String(seconds) : `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  if ($('overlaySeconds').textContent !== label) $('overlaySeconds').textContent = label;
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
const memberColors = ['#a96c87','#6b8d9d','#8e83ad','#9e8a58','#699787','#a87965','#7489b2'];
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
  items.slice(0,4).forEach((option,i)=>{
    const card=node('div','choice');card.dataset.option=String(i+1);
    card.style.setProperty('--i', i);
    // Jewel medallion: a distinct cut per answer so viewers can tell them apart at a glance.
    const badge=node('span','choice-index');
    badge.append(icon('g-'+(i+1),'choice-gem'),node('span','choice-num',String(i+1)));
    const label=node('span','choice-label',option);
    label.classList.toggle('is-long',option.length>22);label.classList.toggle('is-very-long',option.length>48);
    const votes=node('span','choice-mark');
    votes.append(node('span','choice-avatars'),node('span','choice-count','0'));
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
      restartAnimation(choice, 'choice-voted');
    }
    choice.classList.toggle('has-votes', count > 0);
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
  race.slice(0,7).forEach((p,i)=>{
    const row=node('div','racer');
    if(i===0&&p.progress>0)row.classList.add('is-leading');
    const track=node('div','race-track');const fill=node('div','race-fill');
    fill.style.width = Math.min(100,Math.max(0,100*Number(p.progress)/(target||12)))+'%';
    fill.append(node('i','race-runner'));track.append(fill,icon('i-flag','race-finish'));
    row.append(node('span','racer-pos num',String(i+1).padStart(2,'0')),node('strong','',p.name),track,node('small','num',`${p.progress}/${target||12}`));panel.append(row);
  });
}
/* Gold particle celebration: metallic leaves, diamonds and champagne sparks. */
function triggerConfetti() {
  if (reducedMotion()) return;
  const stage = $('confettiStage');
  if (!stage) return;
  stage.replaceChildren();
  const colors = ['#F1D58C', '#D4AF37', '#FBEBB8', '#B98A28', '#F6F1E7', '#E6C463'];
  const shapes = ['leaf','diamond','spark','ribbon'];
  for (let i = 0; i < 70; i++) {
    const piece = node('i', 'confetti-piece shape-' + shapes[i % shapes.length]);
    piece.style.setProperty('--cx', `${(i * 14.29 + (i % 7) * 3.1) % 100}%`);
    piece.style.setProperty('--cdelay', `${(i % 14) * 0.07}s`);
    piece.style.setProperty('--cdur', `${2.6 + (i % 6) * 0.32}s`);
    piece.style.setProperty('--ccolor', colors[i % colors.length]);
    piece.style.setProperty('--crot', `${(i % 2 ? 1 : -1) * (220 + (i * 37) % 260)}deg`);
    piece.style.setProperty('--sway', `${(i % 3 - 1) * (18 + i % 5 * 6)}px`);
    piece.style.setProperty('--scale', `${0.7 + (i % 4) * 0.18}`);
    stage.append(piece);
  }
  clearTimeout(triggerConfetti.timer);
  triggerConfetti.timer = setTimeout(() => stage.replaceChildren(), 5200);
}
function podiumCard(p, rank) {
  const card=node('div',`podium-card place-${rank}`);
  card.style.setProperty('--d', `${[0.45,0.2,0.7][rank-1]||0.8}s`);
  if (rank===1) card.append(icon('i-crown','podium-crown'));
  const avatar=node('div','podium-avatar');
  paintAvatar(avatar,p);
  const time=node('span','podium-time');if(p.detail)time.append(icon('i-star','i i-sm'),node('span','',p.detail));else time.append(icon('i-timer','i i-sm'),node('span','num',formatMs(p.elapsedMs)));
  const points=node('span','podium-points',`+${p.points} نقاط`);
  const base=node('div','podium-base');base.append(node('b','num',String(rank)),node('small','caps',['Gold','Silver','Bronze'][rank-1]||''));
  card.append(avatar,node('strong','podium-name',p.name),time,points,base);
  return card;
}
function renderResults(status, round) {
  const results=status.results;
  const show=!!results && (['quiz','guess','glass'].includes(status.mode)||PARTY.has(status.mode));
  const screen=$('roundResultsOverlay');
  screen.hidden=!show;
  if (!show) {stateCache.resultsKey=null;return;}
  const key=`${round}:${results.completedAt}`;
  if (stateCache.resultsKey===key) return;
  stateCache.resultsKey=key;
  const partyMode=PARTY.has(status.mode);
  $('resultsRoundLabel').textContent=partyMode?`نتائج ${modeInfo[status.mode].ar}`:`نتائج السؤال ${round}`;
  $('resultsSubtitle').textContent=partyMode?'الترتيب النهائي للعبة':results.correctCount?'الترتيب حسب أسرع إجابة صحيحة وصلت إلى السيرفر':'انتهى الوقت — هذه الجولة بدون إجابات صحيحة';
  $('resultsCorrect').textContent=results.correctAnswer||'—';
  $('resultsAnswers').textContent=`${number(results.correctCount)} صحيحة من ${number(results.totalAnswers)}`;
  const podium=$('resultsPodium');const list=$('resultsOthers');podium.replaceChildren();list.replaceChildren();
  screen.classList.toggle('is-empty', !results.rankings?.length);
  if(!results.rankings?.length){
    const empty=node('div','results-empty');
    empty.append(icon('i-hourglass','i i-xl'),node('strong','','لم تُسجّل إجابة صحيحة هذه المرة'),node('span','','الجولة القادمة فرصتك للصدارة'));
    podium.append(empty);
  }else{
    triggerConfetti();
    results.rankings.slice(0,3).forEach((p,i)=>podium.append(podiumCard(p,i+1)));
    const others=results.rankings.slice(3,10);
    if(!others.length){list.append(node('div','standings-empty','بقية المراكز تظهر هنا عند مشاركة المزيد من المتسابقين'));}
    others.forEach((p,idx)=>{
      const row=node('div','result-other-row');
      row.style.setProperty('--d', `${0.9 + idx*0.07}s`);
      const nameCell=node('span','result-person');
      const avatar=node('span','result-avatar');
      paintAvatar(avatar,p);
      nameCell.append(avatar,node('strong','result-person-name',p.name));
      const speed=node('span','result-speed');if(p.detail)speed.append(node('span','',p.detail));else speed.append(icon('i-bolt','i i-sm'),node('span','num',formatMs(p.elapsedMs)));
      row.append(node('span','result-rank num',String(p.rank).padStart(2,'0')),nameCell,speed,node('b','num',`+${p.points}`));
      list.append(row);
    });
  }
  restartAnimation(screen,'appear');
}
function renderRegistration(reg) {
  const screen=$('registrationOverlay'),visible=!!reg&&['open','idle'].includes(reg.phase);
  screen.hidden=!visible;
  if(!visible) return;
  screen.dataset.phase=reg.phase;
  $('signupStateLabel').textContent=reg.phase==='open'?'التسجيل مفتوح':'بانتظار فتح التسجيل';
  $('signupEmptyHint').textContent=reg.phase==='open'?'اكتب كلمة الانضمام في شات البث وبيظهر اسمك وصورتك هنا مباشرة':'تبدأ المشاركة بعد فتح التسجيل. استعد للتحدي!';
  $('signupKeyword').textContent=reg.keyword||'انضم';
  $('signupKeyword').classList.toggle('is-long',(reg.keyword||'').length>8);
  $('signupTitle').textContent=window.lastLiveverseState?.status?.title||'تحدي المعلومات';
  const countText=number(reg.count||0);
  if($('signupCount').textContent!==countText){$('signupCount').textContent=countText;restartAnimation($('signupCount'),'bump');}
  $('signupReady').textContent=reg.count?number(reg.count)+' متسابقًا جاهزًا':'بانتظار المشاركين';
  $('signupReady').classList.toggle('is-ready',!!reg.count);
  const latest=reg.recent?.[0]||null;
  $('signupLatestName').textContent=latest?.name||'بانتظارك';
  $('signupLatestName').title=latest?.name||'';
  $('signupLatestNumber').textContent='#'+number(reg.count||0);
  paintAvatar($('signupLatestAvatar'),latest);
  $('signupLatestDescription').textContent=latest?'انضم برقم '+number(reg.count||0)+' — أهلًا بك في التحدي':'اسمك الجاي هنا';
  $('signupEmpty').hidden=!!reg.count;
  screen.classList.toggle('has-players',!!reg.count);
  // The broadcast canvas is fixed-composition, so the wall size only depends on orientation.
  const vertical=matchMedia('(max-aspect-ratio:4/5)').matches;
  const slots=vertical?30:48;
  const members=Array.isArray(reg.participants)?reg.participants.slice(-slots).reverse():[];
  const key=JSON.stringify([reg.session,reg.count,members,slots]);
  if (screen.dataset.lastRegistrants===key)return;
  const firstPaint=!screen.dataset.lastRegistrants;
  screen.dataset.lastRegistrants=key;
  const wall=$('signupRecent'),latestNumber=members[0]?.number;
  const numbers=new Set(members.map(p=>String(p.number)));
  for(const card of [...wall.children]) if(!numbers.has(card.dataset.number)) card.remove();
  const existing=new Map([...wall.children].map(card=>[card.dataset.number,card]));
  // Walk oldest → newest and prepend only new cards, so the newest sits first and
  // existing cards are never re-inserted (which would replay their entrance animation).
  [...members].reverse().forEach((player, idx, list) => {
    let card=existing.get(String(player.number));
    if(!card){
      card=node('div','signup-member-card');card.dataset.number=String(player.number);
      card.append(node('span','member-avatar'),node('bdi','member-name'),node('span','member-num num','#'+player.number));
      if(firstPaint)card.style.animationDelay=`${Math.min((list.length-1-idx)*0.018, 0.45)}s`;
      wall.prepend(card);
    }
    card.classList.toggle('is-latest',player.number===latestNumber);
    card.style.setProperty('--member-color',memberColors[(player.number-1)%memberColors.length]);
    card.title=player.name;card.querySelector('.member-name').textContent=player.name;
    paintAvatar(card.querySelector('.member-avatar'),player);
  });
  const spotlight=screen.querySelector('.signup-spotlight');
  if(spotlight.dataset.latest!==String(reg.count)){
    spotlight.dataset.latest=String(reg.count);
    if(reg.count) restartAnimation(spotlight,'joined');
  }
}
function fitBroadcastText() {
  for(const element of [$('overlayPrompt'),...document.querySelectorAll('.choice-label')]) {
    if(!element.getClientRects().length)continue;
    element.style.removeProperty('font-size');
    // The prompt is measured against its card's content box; an answer label is its own
    // fixed-height box, so its scrollHeight already includes padding — compare to clientHeight.
    let available=element.clientHeight;
    if(element.id==='overlayPrompt'){
      const parent=element.parentElement,style=getComputedStyle(parent);
      available=parent.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
    }
    let size=parseFloat(getComputedStyle(element).fontSize),minimum=element.id==='overlayPrompt'?16:12;
    while(size>minimum&&(element.scrollHeight>available+1||element.scrollWidth>element.clientWidth+1))element.style.fontSize=(--size)+'px';
  }
}
window.addEventListener('resize',()=>{if(window.lastLiveverseState)renderRegistration(window.lastLiveverseState.registration);requestAnimationFrame(fitBroadcastText);});
document.fonts?.ready.then(fitBroadcastText);
/* ===================== TIME BOMB (render only — the server decides everything) ===================== */
const bombView={initialized:false,matchId:null,holderKey:null,holder:null,explosionKey:null,endKey:null,data:null,offset:0,second:null,frame:null,blastTimer:null,victoryTimer:null};
const bombSound={ctx:null,unlock(){try{if(!this.ctx){const C=window.AudioContext||window.webkitAudioContext;if(C)this.ctx=new C();}this.ctx?.resume?.();}catch{}}};
['pointerdown','keydown'].forEach(type=>window.addEventListener(type,()=>bombSound.unlock(),{passive:true}));
function bombAudio(){ if(!bombView.data?.sound||reducedMotion())return null; bombSound.unlock(); const ctx=bombSound.ctx; return ctx&&ctx.state==='running'?ctx:null; }
function bombTone(freq,dur,type='square',gain=.05,delay=0){
  const ctx=bombAudio();if(!ctx)return;
  const t=ctx.currentTime+delay,o=ctx.createOscillator(),g=ctx.createGain();
  o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  o.connect(g).connect(ctx.destination);o.start(t);o.stop(t+dur+.02);
}
function bombNoise(dur,from,to,gain=.4){
  const ctx=bombAudio();if(!ctx)return;
  const len=Math.floor(ctx.sampleRate*dur),buf=ctx.createBuffer(1,len,ctx.sampleRate),d=buf.getChannelData(0);
  for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2);
  const src=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain(),t=ctx.currentTime;
  src.buffer=buf;f.type='lowpass';f.frequency.setValueAtTime(from,t);f.frequency.exponentialRampToValueAtTime(to,t+dur);g.gain.value=gain;
  src.connect(f).connect(g).connect(ctx.destination);src.start(t);
}
const bombSfx={
  tick(sec){ if(sec<=5){bombTone(1500,.05,'square',.06);bombTone(1150,.05,'square',.045,.5);} else bombTone(1100,.035,'square',.04); },
  pass(){ bombNoise(.32,4000,500,.22); bombTone(620,.12,'triangle',.05); },
  boom(){ bombNoise(1.6,1800,60,.9); bombTone(55,.9,'sine',.5); },
  win(){ [523.25,659.25,783.99,1046.5,1318.5].forEach((f,i)=>bombTone(f,.45,'triangle',.07,i*.12)); }
};
function bombPerson(container,person){ paintAvatar(container,person||null); }
function bombChip(player){
  const chip=node('div','bomb-chip');chip.dataset.number=String(player.number);
  const av=node('span','bomb-chip-avatar');bombPerson(av,player);
  chip.append(av,node('bdi','bomb-chip-name',player.name),node('span','bomb-chip-num num','#'+player.number));
  return chip;
}
function renderBombRoster(b){
  const roster=$('bombRoster');
  const holderNo=b.holder?.number??null;
  // Slots match the fixed canvas grid: landscape 9×2 (or 27×2 compact), portrait 4×4 (or 10×5 compact).
  const portrait=matchMedia('(max-aspect-ratio:4/5)').matches;
  const normalSlots=portrait?16:18,compactSlots=portrait?50:54;
  const compact=b.alive.length>normalSlots,cap=compact?compactSlots:normalSlots;
  const limit=b.alive.length>cap?cap-1:cap;
  roster.classList.toggle('is-compact',compact);
  let list=b.alive.slice(0,limit);
  if(holderNo!==null&&!list.some(p=>p.number===holderNo)){const h=b.alive.find(p=>p.number===holderNo);if(h)list=[h,...list.slice(0,limit-1)];}
  const key=JSON.stringify([compact,list.map(p=>[p.number,p.name,p.avatar]),holderNo,b.alive.length]);
  if(roster.dataset.key===key)return;
  roster.dataset.key=key;
  const existing=new Map([...roster.children].filter(c=>c.dataset.number).map(c=>[c.dataset.number,c]));
  const next=[];
  for(const p of list){const chip=existing.get(String(p.number))||bombChip(p);chip.classList.toggle('is-holder',p.number===holderNo);next.push(chip);}
  if(b.alive.length>list.length)next.push(node('div','bomb-chip is-more num','+'+(b.alive.length-list.length)));
  roster.replaceChildren(...next);
  const out=$('bombOutStrip');out.replaceChildren();
  for(const p of b.eliminated.slice(-10).reverse()){const av=node('span','bomb-out-avatar');av.title=p.name+' #'+p.number;bombPerson(av,p);out.append(av);}
}
function renderBombLog(b){
  const list=$('bombPasses');
  const passes=b.passes.slice(0,6);
  const key=JSON.stringify(passes.map(p=>[p.turn,p.from?.number,p.to?.number,p.at]));
  if(list.dataset.key===key)return;
  const firstRender=!list.dataset.key;list.dataset.key=key;
  list.replaceChildren();
  passes.forEach((p,i)=>{
    const li=node('li','bomb-pass'+(p.turn===b.turn?'':' is-old'));
    if(i===0&&!firstRender)li.classList.add('is-new');
    const route=node('span','pass-route');
    route.append(node('b','num','#'+p.from.number),icon('i-arrow','i i-sm'),node('b','num','#'+p.to.number));
    const names=node('span','pass-names',p.from.name+' ← '+p.to.name);
    li.append(route,names,node('span','pass-time num',(p.remainingMs/1000).toFixed(1)+' ث'));
    list.append(li);
  });
  $('bombPassesEmpty').hidden=passes.some(p=>p.turn===b.turn);
}
function animateBombFlight(fromNo,toNo){
  if(reducedMotion())return;
  const stage=$('bombStage'),layer=$('bombFlight');
  const box=stage.getBoundingClientRect();
  const find=n=>$('bombRoster').querySelector(`[data-number="${n}"]`);
  const from=find(fromNo)||$('bombHolder'),to=$('bombHolder');
  const a=from.getBoundingClientRect(),c=to.querySelector('.holder-ring').getBoundingClientRect();
  const start={x:a.left+a.width/2-box.left,y:a.top+a.height/2-box.top},end={x:c.left+c.width/2-box.left,y:c.top+c.height/2-box.top};
  const flyer=node('span','bomb-flyer');flyer.append(icon('i-bomb','i'));layer.append(flyer);
  const lift=Math.min(start.y,end.y)-box.height*.18;
  flyer.animate([
    {transform:`translate(${start.x}px,${start.y}px) scale(.6) rotate(0deg)`,opacity:0},
    {transform:`translate(${(start.x+end.x)/2}px,${lift}px) scale(1.25) rotate(220deg)`,opacity:1,offset:.5},
    {transform:`translate(${end.x}px,${end.y}px) scale(.8) rotate(420deg)`,opacity:.2}
  ],{duration:700,easing:'cubic-bezier(.3,.1,.3,1)'}).finished.then(()=>flyer.remove(),()=>flyer.remove());
  const toChip=find(toNo);
  if(toChip)restartAnimation(toChip,'is-receiving');
}
function bombDebris(){
  const holder=$('bombDebris');if(holder.childElementCount)return;
  for(let i=0;i<28;i++){const d=node('i','debris');const angle=i/28*Math.PI*2;d.style.setProperty('--dx',Math.cos(angle)*(260+(i%5)*70)+'px');d.style.setProperty('--dy',Math.sin(angle)*(200+(i%4)*60)+'px');d.style.setProperty('--dr',(i%2?1:-1)*(180+i*23)+'deg');d.style.setProperty('--ds',(.6+(i%4)*.25).toFixed(2));holder.append(d);}
  const embers=$('bombEmbers');
  for(let i=0;i<34;i++){const e=node('i','ember');e.style.setProperty('--ex',((i*29)%100)+'%');e.style.setProperty('--ed',((i%9)*.35).toFixed(2)+'s');e.style.setProperty('--et',(3.2+(i%5)*.6).toFixed(2)+'s');e.style.setProperty('--es',(.6+(i%3)*.35).toFixed(2));embers.append(e);}
}
function showBombBlast(b){
  bombDebris();
  const blast=$('bombBlast'),p=b.explosion.player;
  bombPerson($('bombVictimAvatar'),p);
  $('bombVictimName').textContent=p.name;
  $('bombVictimNumber').textContent='#'+p.number;
  $('bombNextIn').textContent=b.phase==='finished'?'بقي لاعب واحد فقط…':'الدورة التالية تبدأ بعد لحظات';
  blast.hidden=false;restartAnimation(blast,'is-on');
  if(!reducedMotion()){$('arena').classList.remove('is-shaking');void $('arena').offsetWidth;$('arena').classList.add('is-shaking');}
  bombSfx.boom();
  clearTimeout(bombView.blastTimer);
  const hold=b.phase==='exploded'&&b.nextTurnAt?Math.max(1200,b.nextTurnAt-(Date.now()+bombView.offset)-250):2400;
  bombView.blastTimer=setTimeout(()=>{blast.hidden=true;$('arena').classList.remove('is-shaking');},hold);
}
function showBombVictory(b,delay){
  clearTimeout(bombView.victoryTimer);
  bombView.victoryTimer=setTimeout(()=>{
    const v=$('bombVictory'),won=!!b.winner;
    v.querySelector('.victory-card:not(.is-ended)').hidden=!won;$('bombEndedCard').hidden=won;
    if(won){
      bombDebris();
      bombPerson($('bombWinnerAvatar'),b.winner);
      $('bombWinnerName').textContent=b.winner.name;
      $('bombWinnerNumber').textContent='#'+b.winner.number;
      $('bombWinnerStats').textContent='نجا من بين '+number(b.total)+' لاعبًا بعد '+number(b.eliminated.length)+' انفجارات';
      bombSfx.win();
    }
    $('bombBlast').hidden=true;v.hidden=false;restartAnimation(v,'is-on');
  },delay);
}
function bombFrame(){
  bombView.frame=null;
  const b=bombView.data;
  if(!b||$('bombStage').hidden)return;
  const remaining=b.phase==='armed'&&b.endsAt?Math.max(0,b.endsAt-(Date.now()+bombView.offset)):b.phase==='paused'?b.remainingMs:b.phase==='idle'?b.seconds*1000:0;
  const total=b.seconds*1000||15000;
  const pct=Math.max(0,Math.min(1,remaining/total));
  const sec=Math.ceil(remaining/1000);
  if(sec!==bombView.second){
    const prev=bombView.second;bombView.second=sec;
    $('bombSeconds').textContent=String(sec);
    if(b.phase==='armed'&&prev!==null&&sec<prev&&sec>0)bombSfx.tick(sec);
    if(b.phase==='armed')restartAnimation($('bombSeconds'),'tick');
  }
  const stage=$('bombStage');
  stage.dataset.heat=b.phase!=='armed'?'calm':sec<=2?'critical':sec<=5?'hot':sec<=10?'warm':'calm';
  const fuse=$('bombFusePath');
  fuse.setAttribute('stroke-dasharray',(pct*100).toFixed(2)+' 100');
  const len=fuse.getTotalLength(),pt=fuse.getPointAtLength(len*pct);
  $('bombSpark').setAttribute('transform',`translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
  $('bombSpark').style.opacity=b.phase==='armed'||b.phase==='paused'?'1':'0';
  if(b.phase==='armed')bombView.frame=requestAnimationFrame(bombFrame);
}
function renderBomb(b,serverTime){
  bombView.offset=(Number(serverTime)||Date.now())-Date.now();
  const prev=bombView.data;bombView.data=b;
  const first=!bombView.initialized;bombView.initialized=true;
  if(bombView.matchId!==b.matchId){bombView.matchId=b.matchId;bombView.holderKey=null;$('bombRoster').dataset.key='';$('bombPasses').dataset.key='';}
  $('bombAlive').textContent=number(b.alive.length);
  $('bombOut').textContent=number(b.eliminated.length);
  $('bombTurn').textContent=number(Math.max(1,b.turn));
  $('bombPaused').hidden=b.phase!=='paused';
  $('bombStage').dataset.phase=b.phase;
  // holder + pass animation
  const holderKey=b.holder?b.matchId+':'+b.turn+':'+b.holder.number:null;
  if(holderKey&&holderKey!==bombView.holderKey){
    const samePrevTurn=prev&&prev.matchId===b.matchId&&prev.turn===b.turn&&prev.holder;
    bombPerson($('bombHolderAvatar'),b.holder);
    $('bombHolderName').textContent=b.holder.name;
    $('bombHolderNumber').textContent='#'+b.holder.number;
    restartAnimation($('bombHolder'),samePrevTurn?'holder-swap':'holder-enter');
    renderBombRoster(b);
    if(samePrevTurn&&!first){animateBombFlight(prev.holder.number,b.holder.number);bombSfx.pass();}
  }
  bombView.holderKey=holderKey||bombView.holderKey;
  $('bombHolder').classList.toggle('is-empty',!b.holder);
  renderBombRoster(b);
  renderBombLog(b);
  // explosion → elimination → (next turn | winner)
  const expKey=b.explosion?b.matchId+':'+b.explosion.turn:null;
  if(expKey&&expKey!==bombView.explosionKey){
    bombView.explosionKey=expKey;
    if(!(first&&b.phase!=='exploded'))showBombBlast(b);
  }
  if(['armed','paused'].includes(b.phase)){clearTimeout(bombView.victoryTimer);$('bombVictory').hidden=true;if(b.phase==='armed'){clearTimeout(bombView.blastTimer);$('bombBlast').hidden=true;}}
  const endKey=b.phase==='finished'?b.matchId+':'+(b.winner?.number??'manual'):null;
  if(endKey&&endKey!==bombView.endKey){bombView.endKey=endKey;showBombVictory(b,first?0:b.winner?2200:300);}
  if(!endKey)bombView.endKey=null;
  if(!bombView.frame)bombView.frame=requestAnimationFrame(bombFrame);
}
function hideBomb(){
  $('bombStage').hidden=true;$('bombBlast').hidden=true;$('bombVictory').hidden=true;
  clearTimeout(bombView.blastTimer);clearTimeout(bombView.victoryTimer);
}
/* ---------- Party games (rps, minority, higherlower, truefalse, redlight, bowling) ---------- */
const partyCache = { key:null };
function hearts(n) { const box=node('span','party-hearts'); for(let i=0;i<3;i++){const h=icon('i-flame','i heart'+(i<n?' is-on':''));box.append(h);} box.setAttribute('aria-label',n+' حيوات'); return box; }
function chip(p, extra) { const c=node('span','party-chip'); const av=node('span','member-avatar party-av'); paintAvatar(av,p); c.append(av,node('bdi','party-name',p.name)); if(extra)c.append(extra); return c; }
function renderParty(party, mode) {
  const panel=$('partyPanel');
  if(!party){panel.hidden=true;return;}
  panel.hidden=false;
  panel.dataset.mode=mode; panel.dataset.phase=party.phase;
  const key=JSON.stringify([mode,party.round,party.phase,party.reveal,party.players,party.track,party.lanes,party.light,party.card,party.alive,party.out]);
  if(key===partyCache.key)return; partyCache.key=key;
  panel.replaceChildren();
  const head=node('div','party-head');
  head.append(node('span','party-round',`الجولة ${number(party.round)} / ${number(party.rounds)}`));
  if(['rps','minority','redlight'].includes(mode)) head.append(node('span','party-alive',`${number(party.alive)} من ${number(party.total)} في اللعبة`));
  panel.append(head);
  const r=party.reveal;
  if(mode==='rps'){
    if(party.phase==='reveal'&&r){
      const banner=node('div','party-banner'); banner.append(node('small','','Sky اختار'),node('strong','party-big',r.house),node('span','',r.note|| (r.eliminated?.length?`خرج ${number(r.eliminated.length)}`:`${number(r.lost)} خسروا حياة`)));
      panel.append(banner);
    }
    const grid=node('div','party-grid'); (party.players||[]).forEach(p=>grid.append(chip(p,hearts(p.lives)))); panel.append(grid);
  } else if(mode==='minority'){
    if(party.phase==='reveal'&&r){ const b=node('div','party-banner'); b.append(node('small','',r.tie?'تعادل':'الأقلية'),node('strong','party-big',r.tie?'الكل ينجو':(party.options[r.minority]||'')),node('span','',r.note||`خرج ${number(r.eliminatedCount)}`)); panel.append(b); }
    const grid=node('div','party-grid'); (party.players||[]).forEach(p=>grid.append(chip(p))); panel.append(grid);
  } else if(mode==='higherlower'||mode==='truefalse'){
    const row=node('div','party-split');
    if(mode==='higherlower'){
      const cards=node('div','party-cards');
      const c1=node('div','party-card'); c1.append(node('b','',party.phase==='reveal'&&r?r.from:party.card));
      cards.append(c1);
      if(party.phase==='reveal'&&r){ const c2=node('div','party-card is-next'); c2.append(node('b','',r.to)); cards.append(icon(r.right===0?'i-arrow':'i-arrow','i party-arrow'+(r.right===0?' is-up':' is-down')),c2); }
      row.append(cards);
    } else if(party.phase==='reveal'&&r){ const b=node('div','party-banner'); b.append(node('small','','الإجابة'),node('strong','party-big '+(r.truth?'is-true':'is-false'),r.truth?'صح':'خطأ'),node('span','',`${number(r.correct)} إجابة صحيحة`)); row.append(b); }
    const list=node('ol','party-standings'); (party.players||[]).slice(0,6).forEach((p,i)=>{const li=node('li','');li.append(node('span','num',String(i+1)),chip(p),node('b','num',number(p.points)));list.append(li);}); row.append(list);
    panel.append(row);
  } else if(mode==='redlight'){
    const light=node('div','party-light is-'+party.light); light.append(node('i',''),node('strong','',party.light==='green'?'أخضر — تحرّك':'أحمر — تجمّد!'));
    const track=node('div','party-track');
    (party.track||[]).forEach(p=>{const rowEl=node('div','party-lane'+(p.alive?'':' is-out'));const bar=node('div','party-bar');const fill=node('i','');fill.style.width=Math.min(100,100*p.progress/(party.target||20))+'%';bar.append(fill,icon('i-flag','party-finish'));rowEl.append(chip(p),bar,node('small','num',`${p.progress}/${party.target}`));track.append(rowEl);});
    const wrap=node('div','party-split'); wrap.append(light,track); panel.append(wrap);
  } else if(mode==='bowling'){
    if(party.phase==='reveal'&&r){ const b=node('div','party-banner'); b.append(node('small','','حارة الحظ'),node('strong','party-big num',String(r.lucky)),node('span','',`${number(r.strikes)} ضربة كاملة`)); panel.append(b); }
    const lanes=node('div','party-lanes');
    (party.lanes||[]).forEach(p=>{const lane=node('div','party-bowl');const frames=node('span','party-frames');(p.frames||[]).forEach(f=>frames.append(node('i','num'+(f===10?' is-strike':''),f===10?'X':String(f))));lane.append(chip(p),frames,node('b','num',number(p.total)));lanes.append(lane);});
    panel.append(lanes);
  }
}
function markPartyChoices(party, mode) {
  const cards=[...$('overlayOptions').querySelectorAll('.choice')];
  const r=party?.phase==='reveal'?party.reveal:null;
  let win=-1;
  if(r){ if(mode==='rps')win=(r.houseIndex+1)%3; else if(mode==='minority')win=r.tie?-1:r.minority; else if(mode==='higherlower'||mode==='truefalse')win=r.right; }
  cards.forEach((c,i)=>{c.classList.toggle('is-correct',!!r&&i===win);c.classList.toggle('is-dim',!!r&&win>=0&&i!==win);});
}
function renderMascot(branding) {
  const box=$('arenaMascot'); if(!box||!window.SkyMascot)return;
  const key=JSON.stringify(branding?.mascot||{});
  if(box.dataset.key===key)return; box.dataset.key=key;
  box.replaceChildren(window.SkyMascot.element(branding?.mascot||{}, { size: 40 }));
}
function update(data) {
  if (!data || !data.status) return;
  window.lastLiveverseState=data;
  const s=data.status, mode=modeInfo[s.mode]||modeInfo.quiz;
  const phase=['open','idle'].includes(data.registration?.phase)?'registration':s.results?'results':s.active?'active':'waiting';
  const arena=$('arena');arena.dataset.mode=s.mode;arena.dataset.phase=phase;
  const bombMode=s.mode==='bomb';
  arena.querySelector('.arena-body').hidden=phase==='registration'||phase==='results'||bombMode;
  if(bombMode&&phase!=='registration'&&data.bomb){$('bombStage').hidden=false;renderBomb(data.bomb,data.serverTime);}else hideBomb();
  $('overlayRound').replaceChildren(document.createTextNode(s.mode==='quiz'?'السؤال ':'الجولة '),node('b','num',String(data.round||1).padStart(2,'0')));
  renderProgressDots(data.round||1);
  $('footerRound').textContent=String(data.round||1).padStart(3,'0');
  $('overlayLive').classList.toggle('is-live',phase==='active'||phase==='registration');
  $('overlayLiveText').textContent=phase==='registration'?'التسجيل مفتوح':phase==='results'?'انتهت الجولة':phase==='active'?'على الهواء':'في انتظار البداية';
  $('modeTag').textContent=mode.en;
  $('questionMode').textContent=mode.short;
  $('questionLabel').textContent=mode.ar;
  $('stageTag').textContent=phase==='active'?'التحدي بدأ':phase==='results'?'اكتملت الجولة':'استعد للتحدي';
  $('overlayTitle').textContent=s.title||'تحدي الجمهور';
  $('overlayPrompt').textContent=s.mode==='race'?'سجّل دخولك وابدأ السباق نحو المركز الأول':s.mode==='wheel'?'كل المسجلين داخل السحب — من سيكون الفائز؟':s.mode==='glass'?'الجسر الزجاجي • الخطوة '+(s.glassStep||1)+' من '+(s.glassSteps||10)+' — أي لوح آمن؟':s.prompt||'استعد للسؤال التالي';
  $('overlayHint').textContent=s.mode==='quiz'?'اكتب رقم الإجابة 1 – 4 في الشات':mode.instruction;
  $('overlayOptions').hidden=s.mode!=='quiz'&&s.mode!=='glass';
  $('overlayRace').hidden=s.mode!=='race';
  $('overlayWheel').hidden=s.mode!=='wheel';
  $('overlayWheel').classList.toggle('is-spinning',s.mode==='wheel'&&!!s.active);
  const party=PARTY.has(s.mode)?data.party:null;
  const partyOptions=party?.options||[];
  if(PARTY.has(s.mode)){
    $('overlayOptions').hidden=!partyOptions.length;
    $('overlayHint').textContent=mode.instruction;
    $('overlayPrompt').textContent=party?.prompt||s.title||mode.ar;
    $('overlayRound').replaceChildren(document.createTextNode('الجولة '),node('b','num',String(party?.round||1).padStart(2,'0')));
  }
  renderParty(party, s.mode);
  renderMascot(data.branding);
  const questionKey=JSON.stringify([s.mode,PARTY.has(s.mode)?partyOptions:s.options,PARTY.has(s.mode)?party?.prompt:s.prompt,data.round,s.glassStep,party?.round]);
  if((s.mode==='quiz'||s.mode==='glass'||(PARTY.has(s.mode)&&partyOptions.length)) && questionKey!==stateCache.questionKey) {
    renderOptions(s.mode==='glass'?['اللوح الأول','اللوح الثاني']:PARTY.has(s.mode)?partyOptions:(s.options||[]));
    restartAnimation($('questionCard'),'question-enter');
    restartAnimation($('overlayOptions'),'choices-enter');
  }
  if(s.mode==='quiz') updateVoteCounts(s.choiceCounts||[],s.choiceVoters||[]);
   if(s.mode==='glass') updateVoteCounts(data.glass?.choiceCounts||[0,0],[[],[]]);
  if(PARTY.has(s.mode)&&partyOptions.length){updateVoteCounts(party?.counts||[],[]);markPartyChoices(party,s.mode);}
  $('overlayPrompt').classList.toggle('is-long',(s.prompt||'').length>70);
  $('overlayPrompt').classList.toggle('is-very-long',(s.prompt||'').length>125);
  if(questionKey!==stateCache.questionKey)requestAnimationFrame(fitBroadcastText);
  stateCache.questionKey=questionKey;
  if(s.mode==='race') renderRace(data.race||[],s.target);
  $('overlayWheelCount').textContent=number(data.entriesCount||0)+' مشارك في السحب';
  $('wheelEntriesPreview').textContent=(data.entries||[]).slice(0,4).join(' • ')||'أسماء المسجلين في الفعالية';
  $('overlayPlayers').textContent=number(data.registration?.count ?? data.playerCount ?? 0);
  const subCount = party?party.submitted||0:s.mode==='wheel'?data.entriesCount||0:s.mode==='race'?(data.race||[]).length:s.submissionCount||0;
  $('overlaySubmissions').textContent=number(subCount);
  if (subCount > stateCache.lastSubmissionCount) restartAnimation($('answerTotalBox'),'pulse-hit');
  stateCache.lastSubmissionCount = subCount;
  $('overlayStatus').textContent=s.active?'الجولة جارية • أرسل إجابتك الآن':s.results?'اكتملت الجولة • النتائج ظهرت':s.notice||'جاهز لبدء الجولة';
  $('footerDetail').textContent=phase==='active'?'إجابتك الأولى فقط هي المعتمدة':phase==='results'?'الصدارة للأسرع في الإجابة الصحيحة':'انتظر انطلاق المنافسة';
  clock={endsAt:(party?party.endsAt:s.endsAt)??null,duration:party?Math.max(1,(party.phaseMs||party.seconds*1000)/1000):s.mode==='glass'?(Number(data.glass?.duration)||10):(Number(s.duration)||30),offset:(Number(data.serverTime)||Date.now())-Date.now(),active:!!s.active&&(['quiz','guess','glass'].includes(s.mode)||!!party)};
  renderClock();
  $('overlayTimer').hidden=['race','wheel'].includes(s.mode);
  updateStandings(data.leaderboard||[]);
  renderResults(s,data.round);
  // Signup takes priority over a stale results screen from the previous round.
  if(phase==='registration') $('roundResultsOverlay').hidden=true;
  renderRegistration(data.registration);
  if(phase==='active'&&update.previousPhase&&update.previousPhase!==phase&&!bombMode){
    triggerRoundStartCountdown(s.mode);
    requestAnimationFrame(fitBroadcastText);
  } else if (phase !== 'active') {
    $('roundStartCountdown').hidden = true;
  }
  update.previousPhase=phase;
  const banner=$('winnerBanner');
  if(s.lastEvent?.winner && !s.results && !bombMode){
    if(stateCache.lastWinnerAt!==s.lastEvent.at){
      stateCache.lastWinnerAt=s.lastEvent.at;
      $('winnerName').textContent=s.lastEvent.winner.name;
      $('winnerPoints').textContent=`+${number(s.lastEvent.winner.score||5)} نقاط`;
      paintAvatar($('winnerAvatar'),s.lastEvent.winner);
      triggerConfetti();
      banner.hidden=false;restartAnimation(banner,'appear');
    }
  }else banner.hidden=true;
}
function connect() {
  const protocol=location.protocol==='https:'?'wss':'ws';
  const ws=new WebSocket(window.SkySession?window.SkySession.wsUrl():`${protocol}://${location.host}/ws`);
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
fetch(apiPath('/api/state')).then(res=>{if(!res.ok)throw new Error('API not available');return res.json();}).then(update).catch(()=>{$('overlayStatus').textContent='جارٍ الاتصال بالمنصة...';});
connect();
