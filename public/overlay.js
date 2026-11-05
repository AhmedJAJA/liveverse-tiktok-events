/* SPONGE LIVE ARENA: read-only broadcast view. All player data uses textContent. */
const $ = id => document.getElementById(id);
if (new URLSearchParams(location.search).get('embedded') === '1') document.documentElement.classList.add('embedded');
const modeInfo = {
  quiz: { en:'LIVE QUIZ', short:'QUIZ', ar:'السؤال الحالي', instruction:'اكتب رقم الإجابة 1 – 4 في الشات • محاولة واحدة فقط' },
  guess: { en:'GUESS IT', short:'GUESS', ar:'خمن الإجابة', instruction:'اكتب تخمينك في التعليقات • محاولة واحدة فقط' },
  race: { en:'CHAT RACE', short:'RACE', ar:'السباق المباشر', instruction:'المسجلون يتقدمون بكتابة !go أو انطلق' },
  wheel: { en:'LUCKY DRAW', short:'WHEEL', ar:'عجلة المشاركين', instruction:'كل المسجلين في الفعالية داخل السحب تلقائيًا' },
  bomb: { en:'TIME BOMB', short:'BOMB', ar:'القنبلة المؤقتة', instruction:'حامل القنبلة يكتب !مرر ثم رقم اللاعب قبل الانفجار' },
  glass: { en:'GLASS BRIDGE', short:'GLASS', ar:'الجسر الزجاجي', instruction:'اكتب 1 أو 2 لاختيار اللوح الآمن — محاولة واحدة لكل خطوة' },
  rps: { en:'ROCK PAPER SCISSORS', short:'RPS', ar:'حجر ورقة مقص', instruction:'اكتب حجر أو ورقة أو مقص — بوبل يكشف اختياره بعد الوقت' },
  minority: { en:'MINORITY WINS', short:'MINORITY', ar:'الأقلية تفوز', instruction:'اكتب 1 أو 2 — الجهة الأقل عددًا تنجو' },
  higherlower: { en:'HIGHER OR LOWER', short:'HI-LO', ar:'أعلى أم أقل', instruction:'اكتب أعلى أو أقل — الورقة التالية تحسم' },
  truefalse: { en:'TRUE OR FALSE', short:'T / F', ar:'حقيقة أم كذب', instruction:'اكتب صح أو خطأ — الأسرع يحصد نقاطًا أكثر' },
  redlight: { en:'RED LIGHT', short:'RED LIGHT', ar:'الضوء الأحمر', instruction:'عند الأخضر اكتب رقمًا من 1 إلى 5 — الحركة عند الأحمر تقصيك' },
  bowling: { en:'BOWLING', short:'BOWLING', ar:'لعبة البولينج', instruction:'اكتب نقطة التصويب من 1 إلى 10 — الأقرب للنقطة المخفية يُسقط قوارير أكثر' },
  drawguess: { en:'GUESS THE DRAWING', short:'DRAW', ar:'خمن الرسمة', instruction:'اكتب تخمينك في الشات — أول إجابة صحيحة تربح الجولة' },
  chairs: { en:'MUSICAL CHAIRS', short:'CHAIRS', ar:'كراسي موسيقية', instruction:'لا تكتب أثناء الموسيقى • عند التوقف اكتب «اجلس» بسرعة' },
  categories: { en:'LETTER & CATEGORY', short:'CATEGORIES', ar:'اسم حيوان جماد نبات', instruction:'اللاعب المختار يكتب كلمة تبدأ بالحرف خلال 15 ثانية' },
  roles: { en:'HIDDEN ROLES', short:'ROLES', ar:'الأدوار المخفية', instruction:'افتح صفحة دورك • في النهار اكتب «صوت» ورقم اللاعب' },
  roulette: { en:'ROULETTE', short:'ROULETTE', ar:'الروليت', instruction:'العجلة تدور وتتوقف على نتيجة يحددها الخادم بعدل' },
  country: { en:'GUESS THE COUNTRY', short:'COUNTRY', ar:'خمن الدولة', instruction:'اكتب اسم الدولة — الإجابة المبكرة تربح نقاطًا أكثر' },
  flag: { en:'GUESS THE FLAG', short:'FLAG', ar:'خمن العلم', instruction:'اكتب اسم الدولة صاحبة العلم في الشات' },
  tug: { en:'TUG OF WAR', short:'TUG', ar:'شد الحبل', instruction:'اكتب «شد» في الشات لتسحب الحبل لفريقك' },
  outsider: { en:'OUT OF THE LOOP', short:'OUTSIDER', ar:'برا السالفة', instruction:'افتح صفحتك واكتب الرمز • لمّحوا للكلمة • صوّتوا بـ«صوت» ورقم اللاعب' }
};
modeInfo.rps = { en:'ROCK PAPER SCISSORS', short:'RPS', ar:'حجرة ورقة مقص', instruction:'مواجهات ثنائية: اكتب حجرة أو ورقة أو مقص — يُكشف الاختياران معًا' };
modeInfo.quiz.ar = 'تحدي المعرفة'; modeInfo.bomb.ar = 'القنبلة الموقوتة';
const PARTY = new Set(['rps','minority','higherlower','truefalse','redlight','bowling','drawguess','chairs','categories','roles','roulette','country','flag','tug','outsider']);
const RPS_ICON = ['✊','✋','✌️'];
let sketchData = '';
const fxPlay = (name) => window.SpongeFx?.play(name);
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
  if ($('arena').dataset.phase === 'reveal') { $('overlaySeconds').textContent = '0'; $('timerFace').style.setProperty('--timer-angle', '0deg'); $('topProgress').style.width = '0%'; $('overlayTimer').classList.remove('urgent', 'is-warn'); return; }
  const seconds = clock.active && clock.endsAt != null
    ? Math.max(0, Math.ceil((clock.endsAt - (Date.now() + clock.offset)) / 1000))
    : clock.duration;
  const pct = clock.active && clock.endsAt != null ? Math.max(0, Math.min(1, (clock.endsAt - (Date.now() + clock.offset))/(clock.duration*1000))) : 1;
  const label = $('arena').dataset.mode === 'quiz' ? String(seconds) : `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  if ($('overlaySeconds').textContent !== label) $('overlaySeconds').textContent = label;
  $('overlaySeconds').classList.toggle('is-wide', label.length > 2);
  $('timerFace').style.setProperty('--timer-angle', `${Math.round(pct*360)}deg`);
  $('topProgress').style.width = (clock.active ? Math.round(pct*100) : 0) + '%';
  // cyan → yellow in the last 10 seconds → red with a pulse in the last 5 (the time always comes from the server)
  const urgent = clock.active && seconds<=5, warn = clock.active && seconds<=10 && !urgent;
  $('overlayTimer').classList.toggle('urgent',urgent);
  $('overlayTimer').classList.toggle('is-warn',warn);
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
const memberColors = ['#A96C87','#6B8D9D','#8E83AD','#588D9E','#699787','#A87965','#7489B2'];
/* Skins: viewers whose TikTok / Kick account is linked to a SPONGE LIVE account appear as their equipped
   character (a rendered image — light even with dozens of players); eliminated players show the «lose» pose;
   the round winner gets the real 3D character doing its win move. */
let skinMap = {}, frameMap = {};
/** «إطارات الأسماء»: only for players whose linked account equipped one (the server decides; guests get none). */
const frameOf = (p) => p ? (frameMap['i:' + p.id] || (p.number ? frameMap['n:' + p.number] : null) || null) : null;
const skinOf = (p) => p ? (skinMap['i:' + p.id] || skinMap['n:' + p.number] || null) : null;
function paintSkin(container, player, skin) {
  const out = !!container.closest('.bomb-out-avatar, .is-eliminated, .is-out, .result-row.is-out');
  const key = JSON.stringify(['skin', skin.id, out]);
  if (container.dataset.person === key) return;
  container.dataset.person = key;
  container.classList.remove('is-loading-avatar', 'has-loaded-avatar', 'is-fallback-avatar');
  container.classList.add('has-skin'); container.dataset.rarity = skin.rarity;
  const img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; img.className = 'avatar-skin';
  img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true }); // the shared avatar CSS shows images once loaded
  img.src = out ? skin.lose : skin.thumb;
  img.addEventListener('error', () => { if (img.src.indexOf(skin.thumb) < 0) img.src = skin.thumb; }, { once: true });
  container.title = (player?.name || '') + ' • ' + skin.name;
  container.replaceChildren(img);
}
let winnerViewer = null, winnerViewerFor = '';
async function winner3d(host, player) {
  const skin = skinOf(player);
  if (!host) return;
  if (!skin) { winnerViewer?.dispose(); winnerViewer = null; winnerViewerFor = ''; host.hidden = true; return; }
  if (winnerViewerFor === skin.id + host.id && winnerViewer) { winnerViewer.play('win'); return; }
  winnerViewer?.dispose(); winnerViewer = null; winnerViewerFor = skin.id + host.id; host.hidden = false; host.replaceChildren();
  try {
    const mod = await import('/skin-viewer.js');
    if (winnerViewerFor !== skin.id + host.id) return;
    winnerViewer = await mod.mountViewer(host, { model: skin.model, animations: { idle: 'idle', walk: 'walk', win: 'win', lose: 'lose' }, rarity: skin.rarity, accent: skin.accent, autoRotate: false, label: skin.name });
    winnerViewer.reveal(); setTimeout(() => winnerViewer?.play('win'), 500);
  } catch { host.hidden = true; }
}
function paintAvatar(container, player) {
  const skin = skinOf(player);
  if (skin) return paintSkin(container, player, skin);
  container.classList.remove('has-skin'); delete container.dataset.rarity;
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
      console.warn('[SPONGE LIVE Media] تعذر تحميل صورة المتسابق، تم تفعيل الواجهة البديلة:',player.avatar);
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
    const label=node('span','choice-label',option);label.setAttribute('dir','auto');
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
  const colors = ['#8CD9F1', '#37B3D4', '#B8EDFB', '#2893B9', '#E7F2F6', '#63C9E6'];
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
  const fr = frameOf(p);
  const avBox = fr && window.SpongeFrames ? window.SpongeFrames.avatar(avatar, fr) : avatar;
  const name = fr && window.SpongeFrames ? window.SpongeFrames.plate(p.name, fr, 'podium-name') : node('strong','podium-name',p.name);
  card.append(avBox,name,time,points,base);
  return card;
}
/** Centre-stage moment for the champion: big photo, name, «الفائز بالمركز الأول», sea celebration. */
let spotTimer=0;
function showSpotlight(p, detail) {
  if(!p) return;
  const box=$('winnerSpotlight');
  paintAvatar($('spotAvatar'),p);
  $('spotName').textContent=p.name;
  $('spotDetail').textContent=detail||'';
  box.hidden=false; restartAnimation(box,'appear');
  fxPlay('win'); triggerConfetti(); window.SpongeFx?.burst($('spotAvatar'),20);
  clearTimeout(spotTimer); spotTimer=setTimeout(()=>{box.hidden=true;},5200);
}
const REVEAL_MS=3000;
function renderResults(status, round, data) {
  const results=status.results;
  const show=!!results && (['quiz','guess','glass'].includes(status.mode)||PARTY.has(status.mode));
  const screen=$('roundResultsOverlay');
  screen.hidden=!show;
  if (!show) {stateCache.resultsKey=null;return;}
  const key=`${round}:${results.completedAt}`;
  if (stateCache.resultsKey===key) return;
  stateCache.resultsKey=key;
  const partyMode=PARTY.has(status.mode);
  const ser=status.mode==='quiz'&&data?.series?.total>1?data.series:null, last=!partyMode&&(!ser||!ser.nextAt);
  $('resultsRoundLabel').textContent=partyMode?`نتائج ${modeInfo[status.mode].ar}`:ser?(last?`انتهت الجولة • ${ser.total} أسئلة`:`نتائج السؤال ${ser.index} من ${ser.total}`):`نتائج السؤال ${round}`;
  screen.classList.toggle('is-final',!!last);
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
    showSpotlight(results.rankings[0], results.rankings[0].detail || (results.summary||''));
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
  // Before the host opens registration nothing invites viewers to type: no word is accepted yet.
  const open=reg.phase==='open';
  $('signupCmdLabel').textContent=open?'اكتب في تعليقات البث':'المشرف يجهّز اللعبة';
  $('signupCmdSub').textContent=open?'للدخول إلى اللعبة باسمك وصورتك':'انتظر فتح التسجيل وكلمة الانضمام';
  $('signupKeyword').hidden=!open;
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
      winner3d($('bombSkin3d'),b.winner);
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
/* ---------------- SPONGE LIVE game screens ---------------- */
function banner(small, big, line, cls='') { const b=node('div','party-banner '+cls); b.append(node('small','',small),node('strong','party-big',big)); if(line)b.append(node('span','',line)); return b; }
function bigAvatar(p, cls='') { const box=node('div','sea-hero '+cls); const av=node('span','member-avatar sea-hero-av'); paintAvatar(av,p); box.append(av,node('strong','',p.name),node('small','num','#'+p.number)); return box; }
/** Players who just left the game slide out in a strip — the «المستبعدون» list. */
function renderOut(panel, r) {
  const out=(r&&(r.eliminated||(r.player&&r.how&&['night','vote'].includes(r.how)?[r.player]:null)))||null;
  if(!out?.length) return;
  const strip=node('div','sea-out'); strip.append(node('b','','المستبعدون'));
  out.slice(0,12).forEach(p=>strip.append(chip(p)));
  if((r.eliminatedCount||0)>12) strip.append(node('span','num','+'+number(r.eliminatedCount-12)));
  panel.append(strip);
}
function standingsList(players) { const list=node('ol','party-standings'); (players||[]).slice(0,6).forEach((p,i)=>{const li=node('li','');li.append(node('span','num',String(i+1)),chip(p),node('b','num',number(p.points||0)));list.append(li);}); return list; }
function wheelSvg(items, target, round, spinMs) {
  const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg'); svg.setAttribute('viewBox','-110 -110 220 220'); svg.setAttribute('class','sea-wheel');
  const g=document.createElementNS(ns,'g'); g.setAttribute('class','sea-wheel-spin');
  const n=Math.max(1,items.length), seg=360/n, colors=['#1E5BFF','#38D4FF','#7B5CFF','#FFC21A','#FF6A8A','#2FD9A0'];
  items.forEach((p,i)=>{
    const a0=(i*seg-90)*Math.PI/180, a1=((i+1)*seg-90)*Math.PI/180;
    const path=document.createElementNS(ns,'path');
    path.setAttribute('d',`M0 0 L${100*Math.cos(a0)} ${100*Math.sin(a0)} A100 100 0 ${seg>180?1:0} 1 ${100*Math.cos(a1)} ${100*Math.sin(a1)} Z`);
    path.setAttribute('fill',colors[i%colors.length]); path.setAttribute('stroke','#020A22'); path.setAttribute('stroke-width','1.5'); g.append(path);
    const mid=(i+.5)*seg-90, t=document.createElementNS(ns,'text');
    t.setAttribute('transform',`rotate(${mid}) translate(60 0)`); t.setAttribute('text-anchor','middle'); t.setAttribute('dominant-baseline','middle');
    t.setAttribute('class','sea-wheel-label'); t.textContent=Array.from(p.name).slice(0,n>16?6:10).join(''); g.append(t);
  });
  const hub=document.createElementNS(ns,'circle'); hub.setAttribute('r','16'); hub.setAttribute('class','sea-wheel-hub');
  svg.append(g,hub);
  // The server already chose `target`; the wheel only animates to it.
  const final=360*6+(360-(target+.5)*seg);
  g.style.setProperty('--spin',final+'deg'); g.style.setProperty('--spin-ms',Math.max(1500,(spinMs||7000)-900)+'ms');
  return svg;
}
const SEA_RENDER = {
  drawguess(panel, party, r) {
    const wrap=node('div','party-split sea-draw');
    const board=node('div','sea-board'); const img=document.createElement('img'); img.id='partySketch'; img.alt='رسمة المشرف'; if(sketchData)img.src=sketchData; else img.hidden=true;
    board.append(img, node('span','sea-board-empty',sketchData?'':'المشرف يستعد للرسم…'));
    const side=node('div','sea-side');
    if(party.phase==='reveal'&&r){ side.append(banner('الكلمة',r.word,r.solved?.[0]?'أول من عرفها: '+r.solved[0].name:'لم يعرفها أحد')); }
    else { const m=node('div','sea-mask num'); Array.from(party.mask||'').forEach(ch=>m.append(node('i',ch===' '?'is-space':'',ch==='_'?'':ch))); side.append(node('small','sea-label',`${number(party.letters||0)} حروف`),m); }
    side.append(standingsList(party.players));
    wrap.append(board,side); panel.append(wrap);
  },
  chairs(panel, party, r) {
    const ring=node('div','sea-chairs'+(party.music?' is-music':''));
    const seats=Math.max(1,party.seats||1), players=(party.players||[]).slice(0,16);
    for(let i=0;i<seats&&i<16;i++){ const c=node('span','sea-chair'+(i<(party.seatedCount||0)?' is-taken':'')); c.style.setProperty('--i',i); c.style.setProperty('--n',Math.min(seats,16)); c.append(icon('i-crown','i')); ring.append(c); }
    const orbit=node('div','sea-orbit'); players.forEach((p,i)=>{const t=chip(p);t.classList.add('sea-token');if(p.seated)t.classList.add('is-seated');t.style.setProperty('--i',i);t.style.setProperty('--n',players.length);orbit.append(t);});
    ring.append(orbit, node('strong','sea-chairs-center',party.music?'♪ الموسيقى تعمل':party.phase==='input'?'اجلس!':'—'));
    const side=node('div','sea-side');
    side.append(banner(party.music?'لا تكتب الآن':party.phase==='input'?'اكتب «اجلس»':'المقاعد',`${number(party.seatedCount||0)} / ${number(seats)}`,party.phase==='reveal'&&r?(r.note||`خرج ${number(r.eliminatedCount)}`):'مقاعد محجوزة'));
    const wrap=node('div','party-split'); wrap.append(ring,side); panel.append(wrap);
    if(party.music)window.SpongeFx?.startMusic(); else window.SpongeFx?.stopMusic();
  },
  categories(panel, party, r) {
    const wrap=node('div','party-split sea-cat');
    const card=node('div','sea-letter'); card.append(node('small','',party.category||''),node('strong','',party.letter||'؟'));
    const side=node('div','sea-side');
    if(party.chosen) side.append(bigAvatar(party.chosen,'is-turn'));
    if(party.judging) side.append(banner('بانتظار حكم المشرف','«'+(party.answer||'')+'»','تُقبل تلقائيًا إذا لم يحكم المشرف'));
    else if(party.phase==='reveal'&&r) side.append(banner(r.ok?'صحيح':'خطأ','«'+(r.answer||'—')+'»',r.why,r.ok?'is-good':'is-bad'));
    wrap.append(card,side); panel.append(wrap);
    const grid=node('div','party-grid'); (party.players||[]).forEach(p=>{const c=chip(p);if(!p.alive)c.classList.add('is-out');grid.append(c);}); panel.append(grid);
  },
  rps(panel, party, r) {
    const grid=node('div','sea-duels');
    const list=party.phase==='reveal'&&r?r.results:(party.duels||[]);
    list.forEach(d=>{
      const card=node('div','sea-duel');
      const side=(p,winner)=>{const s=node('div','sea-duel-side'+(winner===p.id?' is-win':winner&&winner!==p.id?' is-lose':''));s.append(chip(p));
        if(party.phase==='reveal'&&r) s.append(node('b','sea-pick',p.pick===null||p.pick===undefined?'—':RPS_ICON[p.pick])); else s.append(node('b','sea-ready',p.ready?'✓':'…')); return s;};
      card.append(side(d.a,d.winner),node('span','sea-vs','VS'),side(d.b,d.winner));
      if(d.note) card.append(node('small','sea-duel-note',d.note));
      grid.append(card);
    });
    const more=(party.phase==='reveal'&&r?r.duels:party.duelCount)-list.length; if(more>0)grid.append(node('div','sea-duel is-more','+'+number(more)+' مواجهة'));
    if(party.bye) panel.append(node('p','sea-bye','يتأهل مباشرة: '+party.bye.name));
    panel.append(grid);
  },
  roles(panel, party, r) {
    const head=node('div','sea-roles-head '+('is-'+(party.phase||'')));
    head.append(node('strong','',{assign:'توزيع الأدوار',night:'🌙 الليل',day:'☀️ النهار — التصويت',reveal:'الكشف',finished:'انتهت اللعبة'}[party.phase]||''),
      node('span','',party.phase==='assign'?`افتح ${location.host}/role واكتب الرمز في الشات • ${number(party.linked||0)} ربطوا صفحاتهم`:party.prompt||''));
    panel.append(head);
    if(party.phase==='reveal'&&r){
      if(r.player) panel.append(banner(r.how==='night'?'سقط في الليل':'أخرجه التصويت',r.player.name,'كان دوره: '+r.player.roleLabel,r.player.role==='impostor'?'is-good':'is-bad'));
      else panel.append(banner(r.how==='quiet'?'ليلة هادئة':r.how==='tie'?'تعادل في التصويت':'لا أصوات','لا أحد يخرج',''));
    }
    if(party.winner) panel.append(banner('النتيجة',party.winner==='citizens'?'فاز المواطنون':'فاز المخادعون','',party.winner==='citizens'?'is-good':'is-bad'));
    const grid=node('div','party-grid sea-roles');
    (party.players||[]).forEach(p=>{const c=chip(p,p.roleLabel?node('small','sea-role is-'+p.role,p.roleLabel):p.votes?node('b','sea-votes num',p.votes+' صوت'):node('small','num','#'+p.number));if(!p.alive)c.classList.add('is-out');grid.append(c);});
    panel.append(grid);
  },
  tug(panel, party, r) {
    const teams=party.teams||[];
    const score=node('div','tug-score');
    teams.forEach((t,i)=>{const s=node('div','tug-team is-t'+i);s.append(node('strong','',`الفريق ${t.name}`),node('b','num',number(t.score)),node('small','',`${number(t.size)} لاعب • ${number(t.pulls)} شدّة`));score.append(s);});
    panel.append(score);
    const field=node('div','tug-field'); const rope=node('div','tug-rope'); const knot=node('i','tug-knot');
    // −target (blue side) … +target (yellow side); RTL screen: blue on the right
    const pos=(party.target?party.rope/party.target:0);
    knot.style.setProperty('--pos',String(pos));
    field.append(node('span','tug-line is-t0'),node('span','tug-line is-t1'),rope,knot);
    panel.append(field);
    if(party.phase==='reveal'&&r) panel.append(banner('الشدّة '+number(party.round),r.team?'للفريق '+r.team:'تعادل',`النتيجة ${number(r.score[0])} – ${number(r.score[1])}`,r.winner===0?'is-t0':r.winner===1?'is-t1':''));
    if(party.finished) panel.append(banner('النتيجة',party.winner==null?'تعادل':'فاز الفريق '+teams[party.winner]?.name,'',party.winner===0?'is-t0':'is-t1'));
    const lists=node('div','tug-lists');
    teams.forEach((t,i)=>{const ol=node('ol','tug-top is-t'+i);(t.top||[]).forEach(p=>{const li=node('li','');li.append(chip(p,node('b','num',number(p.pulls))));ol.append(li);});lists.append(ol);});
    panel.append(lists);
  },
  outsider(panel, party, r) {
    const head=node('div','sea-roles-head '+('is-'+(party.phase||'')));
    head.append(node('strong','',{assign:'توزيع الكلمة',talk:'💬 وقت التلميح',vote:'🗳️ التصويت',reveal:'الكشف',guess:'🎯 فرصته الأخيرة',finished:'انتهت اللعبة'}[party.phase]||''),
      node('span','',party.phase==='assign'?`افتح ${location.host}/role واكتب الرمز في الشات • ${number(party.linked||0)} ربطوا صفحاتهم`:party.prompt||''));
    panel.append(head);
    panel.append(banner('الفئة',party.category||'',party.word?'الكلمة كانت: '+party.word:'الكل يعرف الكلمة… إلا واحد'));
    if(party.phase==='reveal'&&r){
      if(r.accused) panel.append(banner(r.caught?'انكشف!':'خطأ! بريء',r.accused.name,r.caught?'هو اللي برا السالفة — عنده فرصة يكتب الكلمة':'اللي برا السالفة نجا',r.caught?'is-good':'is-bad'));
      else panel.append(banner(r.tie?'تعادل في التصويت':'لا أصوات','ما أحد انكشف','اللي برا السالفة نجا','is-bad'));
    }
    if(party.outsider&&party.phase==='guess') panel.append(bigAvatar(party.outsider,'is-out'));
    if(party.winner) panel.append(banner('النتيجة',party.winner==='outsider'?'فاز اللي برا السالفة':'فاز اللي داخل السالفة',party.outsider?'كان برا السالفة: '+party.outsider.name:'',party.winner==='outsider'?'is-bad':'is-good'));
    const grid=node('div','party-grid sea-roles');
    (party.players||[]).forEach(p=>{const isOut=party.outsider&&party.outsider.id===p.id;const c=chip(p,isOut?node('small','sea-role is-impostor','برا السالفة'):p.votes?node('b','sea-votes num',p.votes+' صوت'):node('small','num','#'+p.number));grid.append(c);});
    panel.append(grid);
  },
  roulette(panel, party, r) {
    const wrap=node('div','party-split sea-roulette');
    const stage=node('div','sea-wheel-stage'); stage.append(node('i','sea-pointer'));
    const svg=wheelSvg(party.wheel||[],party.target||0,party.round,party.spinMs);
    stage.append(svg);
    if(party.phase==='input'&&!reducedMotion()) requestAnimationFrame(()=>requestAnimationFrame(()=>svg.firstChild.classList.add('is-spinning')));
    else svg.firstChild.classList.add('is-stopped');
    const side=node('div','sea-side');
    if(party.phase==='reveal'&&r){ side.append(bigAvatar(r.picked,r.rule==='winner'?'is-win':'is-out')); side.append(node('strong','sea-verdict',r.rule==='winner'?'اختارته العجلة!':'خرج من اللعبة')); }
    else side.append(banner('القاعدة',party.rule==='winner'?'اختيار فائز':'إقصاء لاعب',`${number((party.wheel||[]).length)} على العجلة`));
    wrap.append(stage,side); panel.append(wrap);
  },
  country(panel, party, r) {
    const wrap=node('div','party-split');
    const clues=node('ol','sea-clues');
    if(party.phase==='reveal'&&r){ const b=banner('الدولة',r.name,'العاصمة: '+r.capital); const f=document.createElement('img'); f.className='sea-flag-sm'; f.alt=''; f.src='/flags/'+r.iso+'.svg'; b.prepend(f); clues.append(b); }
    else (party.clues||[]).forEach((c,i)=>{const li=node('li','sea-clue');li.style.setProperty('--d',(i*.12)+'s');li.append(node('b','num',String(i+1)),node('span','',c));clues.append(li);});
    for(let i=(party.clues||[]).length;i<3&&party.phase!=='reveal';i++) clues.append(node('li','sea-clue is-locked','تلميح يظهر بعد قليل'));
    const side=node('div','sea-side'); side.append(standingsList(party.players));
    wrap.append(clues,side); panel.append(wrap);
  },
  flag(panel, party, r) {
    const wrap=node('div','party-split');
    const frame=node('div','sea-flag'); const iso=party.phase==='reveal'&&r?r.iso:party.flag;
    if(iso){ const img=document.createElement('img'); img.alt='العلم'; img.src='/flags/'+iso+'.svg'; frame.append(img); }
    if(party.phase==='reveal'&&r) frame.append(node('strong','sea-flag-name',r.name));
    const side=node('div','sea-side'); if(party.phase==='reveal'&&r&&r.solved?.length) side.append(node('p','sea-label','أول من عرفه: '+r.solved[0].name)); side.append(standingsList(party.players));
    wrap.append(frame,side); panel.append(wrap);
  }
};
function renderParty(party, mode) {
  const panel=$('partyPanel');
  if(!party){panel.hidden=true;return;}
  panel.hidden=false;
  panel.dataset.mode=mode; panel.dataset.phase=party.phase;
  const key=JSON.stringify([mode,party.round,party.phase,party.reveal,party.players,party.track,party.lanes,party.light,party.card,party.alive,party.out,party.duels,party.wheel&&party.round,party.clues,party.flag,party.mask,party.solved,party.chosen,party.judging,party.music,party.seatedCount,party.linked,party.winner,party.format]);
  if(key===partyCache.key)return; partyCache.key=key;
  panel.replaceChildren();
  const head=node('div','party-head');
  head.append(node('span','party-round',`الجولة ${number(party.round)} / ${number(party.rounds)}`));
  if(['rps','minority','redlight','chairs','categories','roles','roulette'].includes(mode)) head.append(node('span','party-alive',`${number(party.alive)} من ${number(party.total)} في اللعبة`));
  panel.append(head);
  const r=party.reveal;
  if(SEA_RENDER[mode]&&!(mode==='rps'&&!party.duels)){ SEA_RENDER[mode](panel,party,r); renderOut(panel,r); return; }
  if(mode==='rps'){
    if(party.phase==='reveal'&&r){
      const banner=node('div','party-banner'); banner.append(node('small','','بوبل اختار'),node('strong','party-big',r.house),node('span','',r.note|| (r.eliminated?.length?`خرج ${number(r.eliminated.length)}`:`${number(r.lost)} خسروا حياة`)));
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
  paintRoomCode(arguments[0]?.roomCode);
  if (!data || !data.status) return;
  window.lastLiveverseState=data;
  skinMap = data.skins || {}; frameMap = data.frames || {};
  const s=data.status, mode=modeInfo[s.mode]||modeInfo.quiz;
  const phase=['open','idle'].includes(data.registration?.phase)?'registration':s.results?'results':s.active?'active':'waiting';
  const arena=$('arena');
  // the answer reveal: when a quiz question ends, the board stays ~3 s with the right answer before the results
  if(!data._recv)data._recv=Date.now();
  const doneAgo=s.results?((Number(data.serverTime)||data._recv)+(Date.now()-data._recv)-s.results.completedAt):Infinity;
  const revealing=phase==='results'&&s.mode==='quiz'&&Number.isInteger(s.results?.correctIndex)&&doneAgo<REVEAL_MS;
  clearTimeout(update.revealTimer);
  if(revealing) update.revealTimer=setTimeout(()=>update(window.lastLiveverseState),REVEAL_MS-doneAgo+40);
  arena.dataset.mode=s.mode;arena.dataset.phase=revealing?'reveal':phase;
  const bombMode=s.mode==='bomb';
  arena.querySelector('.arena-body').hidden=phase==='registration'||(phase==='results'&&!revealing)||bombMode;
  if(bombMode&&phase!=='registration'&&data.bomb){$('bombStage').hidden=false;renderBomb(data.bomb,data.serverTime);}else hideBomb();
  const ser=s.mode==='quiz'&&data.series&&data.series.total>1?data.series:null;
  $('overlayRound').replaceChildren(document.createTextNode(s.mode==='quiz'?'السؤال ':'الجولة '),node('b','num',String(ser?ser.index||1:data.round||1)),...(ser?[document.createTextNode(' من '),node('b','num',String(ser.total))]:[]));
  $('gxGame').textContent=s.title||mode.ar||'';
  $('gxPlayers').textContent=number(data.registration?.count ?? data.playerCount ?? 0);
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
  if(s.mode==='quiz'){
    const ci=revealing?s.results.correctIndex:-1;
    $('overlayOptions').querySelectorAll('.choice').forEach((c,i)=>{c.classList.toggle('is-correct',ci===i);c.classList.toggle('is-dim',ci>=0&&ci!==i);});
    $('gxReveal').hidden=!revealing;
    if(revealing)$('gxRevealText').textContent=`الإجابة الصحيحة: ${s.results.correctAnswer||''} • ${number(s.results.correctCount)} إجابة صحيحة من ${number(s.results.totalAnswers)}`;
  } else $('gxReveal').hidden=true;
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
  if(!revealing) renderResults(s,data.round,data); else $('roundResultsOverlay').hidden=true;
  // Signup takes priority over a stale results screen from the previous round.
  if(phase==='registration') $('roundResultsOverlay').hidden=true;
  renderRegistration(data.registration);
  if(phase==='active'&&update.previousPhase&&update.previousPhase!==phase&&!bombMode){
    triggerRoundStartCountdown(s.mode);
    restartAnimation($('gxLogo'),'gx-shine');
    requestAnimationFrame(fitBroadcastText);
  } else if (phase !== 'active') {
    $('roundStartCountdown').hidden = true;
  }
  update.previousPhase=phase;
  // sound cues (muted with ?mute=1 or the sound switch)
  const regCount=Number(data.registration?.count||0);
  if(phase==='registration'&&regCount>(stateCache.lastRegCount??regCount)){fxPlay('join');window.SpongeFx?.burst($('signupLatestAvatar'),12);}
  stateCache.lastRegCount=regCount;
  const outKey=party?.phase==='reveal'?JSON.stringify([party.round,party.reveal?.eliminatedCount??party.reveal?.player?.number??0]):'';
  if(outKey&&outKey!==stateCache.outKey&&(party.reveal?.eliminatedCount||party.reveal?.player))fxPlay('out');
  stateCache.outKey=outKey;
  if(bombMode&&data.bomb?.phase==='exploded'&&stateCache.bombPhase!=='exploded')fxPlay('boom');
  stateCache.bombPhase=data.bomb?.phase;
  if(!party||s.mode!=='chairs'||!party.music)window.SpongeFx?.stopMusic();
  const banner=$('winnerBanner');
  if(s.lastEvent?.winner && !s.results && !bombMode){
    if(stateCache.lastWinnerAt!==s.lastEvent.at){
      stateCache.lastWinnerAt=s.lastEvent.at;
      $('winnerName').textContent=s.lastEvent.winner.name;
      $('winnerPoints').textContent=`+${number(s.lastEvent.winner.score||5)} نقاط`;
      paintAvatar($('winnerAvatar'),s.lastEvent.winner);
      winner3d($('winnerSkin3d'),s.lastEvent.winner);
      showSpotlight(s.lastEvent.winner,'+'+number(s.lastEvent.winner.score||5)+' نقاط');
      banner.hidden=false;restartAnimation(banner,'appear');
    }
  }else{ if(!banner.hidden&&winnerViewerFor.endsWith('winnerSkin3d'))winner3d($('winnerSkin3d'),null); banner.hidden=true; }
}
function showSketch(data) {
  sketchData = /^data:image\/png;base64,/.test(data) ? data : '';
  const img=document.getElementById('partySketch'); if(!img) return;
  if(sketchData){img.src=sketchData;img.hidden=false;img.nextElementSibling&&(img.nextElementSibling.textContent='');} else {img.removeAttribute('src');img.hidden=true;}
}
fetch(apiPath('/api/sketch')).then(r=>r.ok?r.json():null).then(d=>{if(d?.data)showSketch(d.data);}).catch(()=>{});
function connect() {
  const protocol=location.protocol==='https:'?'wss':'ws';
  const ws=new WebSocket(window.SkySession?window.SkySession.wsUrl():`${protocol}://${location.host}/ws`);
  ws.addEventListener('open',()=>{$('connectionNotice').hidden=true;});
  ws.addEventListener('message',event=>{try{const packet=JSON.parse(event.data);if(packet.type==='state')update(packet.data);else if(packet.type==='sketch')showSketch(packet.data?.data||'');}catch(error){console.warn('Invalid live data',error);}});
  ws.addEventListener('close',()=>{$('connectionNotice').hidden=false;setTimeout(connect,3000);});
  ws.addEventListener('error',()=>ws.close());
}
/** «كود الغرفة»: viewers type it on the home page to open this room's game page on their phone. */
function paintRoomCode(code) {
  let badge=document.getElementById('roomCodeBadge');
  if(!code){ if(badge) badge.hidden=true; return; }
  if(!badge){ badge=node('div','ov-roomcode'); badge.id='roomCodeBadge'; badge.append(node('small','','كود الغرفة'),node('b','num','')); document.body.append(badge); }
  badge.hidden=false; badge.querySelector('b').textContent=code;
}
function guardOverlayImages() {
  const onFail = img => {
    if (!img || img.dataset.fallbackApplied === '1') return;
    img.dataset.fallbackApplied = '1';
    console.warn('[SPONGE LIVE Media] تعذر تحميل الصورة، تم تفعيل الواجهة البديلة:', img.currentSrc || img.src);
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
setInterval(()=>{
  if(!clock.active||!clock.endsAt) return;
  const left=Math.ceil((clock.endsAt-(Date.now()+clock.offset))/1000);
  if(left>0&&left<=5) fxPlay('warn');
},1000);
guardOverlayImages();
fetch(apiPath('/api/state')).then(res=>{if(!res.ok)throw new Error('API not available');return res.json();}).then(update).catch(()=>{$('overlayStatus').textContent='جارٍ الاتصال بالمنصة...';});
connect();
