const el = id => document.getElementById(id);
let state;
let authToken = sessionStorage.getItem('liveverse_admin') || '';
let currentMode = 'quiz';
let toastTimeout;
const instructions = {
  quiz: ['إجابة واحدة لكل مشاهد • ترتيب الأسرع بعد انتهاء الوقت', 'أول اختيار صحيح أو خاطئ يُعتمد ولا يمكن تغييره. ترتيب الفائزين حسب سرعة الإجابة الصحيحة.'],
  guess: ['محاولة واحدة • ترتيب الإجابات الصحيحة حسب السرعة', 'أول تخمين فقط لكل مشاهد؛ لا يمكن تعديله حتى لو كان خاطئًا.'],
  race: ['المسجلون يتقدمون بكتابة !go', 'سجل اسمك أولًا في شاشة التسجيل، ثم اكتب !go للتقدم. مهلة 1.2 ثانية لكل حركة.'],
  wheel: ['سحب عشوائي بين المسجلين', 'الأسماء المسجلة في الفعالية تدخل السحب تلقائيًا، ثم يختار المضيف الفائز.']
};
const modeLabels = { quiz: 'الأسئلة', guess: 'التخمين', race: 'السباق', wheel: 'العجلة' };
function toast(message, error=false) { const box=el('toast'); const dialog=el('settingsDialog'); (dialog?.open?dialog:document.body).append(box); box.textContent=message; box.classList.toggle('error', error); box.classList.add('show'); clearTimeout(toastTimeout); toastTimeout=setTimeout(()=>box.classList.remove('show'),4500); }
function safeText(v) { return String(v ?? ''); }
async function api(action, data={}) {
  if (!authToken) { openSettings('adminToken'); toast('أدخل رمز الإدارة وفعّله أولًا', true); throw new Error('Authentication required'); }
  const res=await fetch('/api/admin/'+action,{ method:'POST', headers:{ 'Content-Type':'application/json',Authorization:'Bearer '+authToken },body:JSON.stringify(data)});
  const result=await res.json();
  if (!res.ok) { toast(result.error || 'تعذر تنفيذ الطلب', true); throw new Error(result.error || 'Request failed'); }
  return result;
}
function setMode(mode) {
  currentMode=mode;
  document.querySelectorAll('.mode').forEach(btn=>btn.classList.toggle('is-selected',btn.dataset.mode===mode));
  el('modeHint').textContent=instructions[mode][0]; el('instruction').textContent=instructions[mode][1];
  el('questionWrap').hidden=mode==='race'||mode==='wheel';
  el('optionsWrap').hidden=mode!=='quiz';
  el('answerWrap').hidden=mode==='race'||mode==='wheel';
  el('targetWrap').hidden=mode!=='race';
  el('durationWrap').hidden=mode!=='quiz'&&mode!=='guess';
  el('drawButton').hidden=mode!=='wheel';
  el('answerLabel').textContent=mode==='quiz'?'الإجابة الصحيحة':'الكلمة أو الإجابة الصحيحة';
  const answer=el('gameAnswer');
  if (mode==='guess' && answer.tagName==='SELECT') {
    const input=document.createElement('input'); input.id='gameAnswer'; input.maxLength=80; input.placeholder='الإجابة لا تظهر للمشاهدين'; input.required=true; answer.replaceWith(input);
  } else if (mode==='quiz' && answer.tagName!=='SELECT') {
    const select=document.createElement('select'); select.id='gameAnswer';
    ['الأول','الثاني','الثالث','الرابع'].forEach((x,i)=>{const opt=document.createElement('option');opt.value=String(i+1);opt.textContent=String.fromCharCode(65+i)+' — الخيار '+x;select.append(opt);});
    answer.replaceWith(select);
  }
  const placeholder={quiz:'تحدي المعلومات',guess:'خمن الكلمة',race:'سباق الجمهور',wheel:'عجلة المشاركين'};
  el('gameTitle').value=placeholder[mode];
}
function populate(snapshot) {
  state=snapshot;
  el('totalPlayers').textContent=state.playerCount.toLocaleString('ar-SA');
  paintRoundStatus(state);
  paintRegistration(state.registration);
  paintPresenter(state);
  el('roundNumber').textContent=String(state.round).padStart(2,'0');
  el('statusText').textContent=state.registration?.phase==='open'?'التسجيل مفتوح':state.status.active?'جولة جارية':'في الانتظار';
  const live=state.connection.state;
  const online=live==='connected';
  const badge=el('networkBadge');badge.classList.toggle('online',online);
  badge.innerHTML=''; const dot=document.createElement('span');dot.className='status-dot';badge.append(dot,document.createTextNode(online?'متصل بالبث':live==='connecting'?'جارٍ الاتصال':live==='error'?'فشل الاتصال':'وضع المعاينة'));
  el('liveStatus').textContent=online?'متصل':live==='connecting'?'جارٍ الاتصال':'غير متصل';
  el('liveSubtitle').textContent=state.connection.username ? '@'+state.connection.username : 'TikTok LIVE';
  el('connectionDetail').textContent=state.connection.detail||'لا يوجد اتصال حاليًا';
  const top=el('leaderboard');top.replaceChildren();
  if (!state.leaderboard.length) { top.append(empty('لم يحصل أحد على نقاط بعد.')); }
  else state.leaderboard.slice(0,10).forEach((p,i)=>{const row=document.createElement('div');row.className='leader-row';const rank=document.createElement('span');rank.className='rank '+(i<3?'top-'+i:'');rank.textContent=String(i+1).padStart(2,'0');const name=document.createElement('strong');name.textContent=p.name;const score=document.createElement('span');score.className='score';score.textContent=p.score+' نقطة';row.append(rank,name,score);top.append(row);});
  const feed=el('chatFeed');feed.replaceChildren();
  if (!state.recent.length) feed.append(empty('التعليقات ستظهر هنا عند الاتصال أو المحاكاة.'));
  else state.recent.slice(0,12).forEach(c=>{const row=document.createElement('div');row.className='feed-row';const icon=document.createElement('span');icon.className='chat-icon';icon.textContent='✦';const user=document.createElement('strong');user.textContent=c.name;const text=document.createElement('span');text.textContent=c.message;const time=document.createElement('small');time.textContent=new Date(c.at).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'});row.append(icon,user,text,time);feed.append(row);});
  if(state.status.lastEvent?.winner && state.status.lastEvent.at!==populate.lastWinner) { populate.lastWinner=state.status.lastEvent.at;toast('🏆 '+state.status.lastEvent.winner.name+' تصدّر الجولة!'); }
}
function paintRegistration(reg) {
  if (!reg) return;
  const phase = reg.phase;
  const badge = el('regStateBadge');
  badge.textContent = phase === 'open' ? '● التسجيل مفتوح' : phase === 'closed' ? '✓ التسجيل مغلق' : 'لم يبدأ التسجيل';
  badge.className = 'reg-state ' + (phase === 'open' ? 'open' : phase === 'closed' ? 'closed' : '');
  el('registrationCount').textContent = Number(reg.count || 0).toLocaleString('ar-SA');
  el('registrationStatusText').textContent = phase === 'open'
    ? `التسجيل مفتوح • اكتب «${reg.keyword}» في الشات • يمكنك بدء السؤال لإغلاق التسجيل تلقائيًا`
    : phase === 'closed' ? `تم تسجيل ${reg.count} متسابقًا. جاهزون للجولات التالية. لإضافة آخرين افتح التسجيل مجددًا.`
    : 'ابدأ بث TikTok واتصل به ليظهر التسجيل تلقائيًا، أو افتحه يدويًا للتجربة.';
  if (document.activeElement !== el('registrationKeyword')) el('registrationKeyword').value = reg.keyword || 'انضم';
  el('closeRegistrationButton').disabled = phase !== 'open';
  el('openRegistrationButton').textContent = phase === 'open' ? 'التسجيل مفتوح الآن' : phase === 'closed' ? 'إعادة فتح التسجيل' : '✦ فتح التسجيل للمشاهدين';
  el('openRegistrationButton').disabled = phase === 'open' || !!state?.status.active;
  el('newRegistrationButton').disabled = !!state?.status.active;
  const list=el('registrationRecent'); list.replaceChildren();
  const entries=reg.recent||[];
  if (!entries.length) {list.append(empty('بانتظار أول متسابق...'));return;}
  entries.forEach(x=>{const item=document.createElement('span');item.className='reg-person';item.textContent='✓ '+x.name;list.append(item);});
}
const formatSeconds = ms => (Math.max(0, ms) / 1000).toFixed(2) + ' ث';
let liveClock = { endsAt: null, serverOffset: 0 };
function updateRoundClock() {
  const clock = el('roundCountdown');
  if (!clock || !liveClock.endsAt) return;
  const ms = Math.max(0, liveClock.endsAt - (Date.now() + liveClock.serverOffset));
  const seconds = Math.ceil(ms / 1000);
  clock.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2,'0');
  clock.classList.toggle('time-critical', seconds <= 10);
}
function paintRoundStatus(data) {
  const { status } = data;
  const timedMode = status.mode === 'quiz' || status.mode === 'guess';
  const liveTimed = timedMode && status.active && status.endsAt;
  el('roundTimeCard').hidden = !liveTimed;
  liveClock = { endsAt: liveTimed ? status.endsAt : null, serverOffset: data.serverTime - Date.now() };
  if (liveTimed) {
    updateRoundClock();
    el('roundAnswerCount').textContent = (status.submissionCount || 0).toLocaleString('ar-SA') + ' إجابة مسجلة';
  }
  const results = timedMode ? status.results : null;
  const section = el('roundResults'); section.hidden = !results;
  if (!results) return;
  el('roundResultsSummary').textContent = `${results.correctCount} إجابة صحيحة من ${results.totalAnswers} مشاركة • ترتيب حسب سرعة وصول الإجابة`;
  el('roundWinnerMark').textContent = results.correctCount ? '🏆' : '⌛';
  const list = el('roundResultsList'); list.replaceChildren();
  if (!results.rankings.length) { list.append(empty('لم يسجل أحد إجابة صحيحة في هذه الجولة.')); }
  for (const person of results.rankings) {
    const item = document.createElement('div'); item.className = 'round-rank-row';
    const rank = document.createElement('span'); rank.className='round-rank-number'; rank.textContent = ['🥇','🥈','🥉'][person.rank - 1] || '#' + person.rank;
    const username = document.createElement('strong'); username.textContent = person.name;
    const time = document.createElement('span'); time.textContent = formatSeconds(person.elapsedMs);
    const pts = document.createElement('b'); pts.textContent = '+' + person.points + ' نقاط';
    item.append(rank, username, time, pts); list.append(item);
  }
  el('roundResultsAnswer').textContent = 'الإجابة الصحيحة: ' + results.correctAnswer;
}
setInterval(updateRoundClock, 200);
function empty(text) { const div=document.createElement('div');div.className='empty';div.textContent=text;return div; }
function socket() {
  const proto=location.protocol==='https:'?'wss':'ws';
  const ws=new WebSocket(`${proto}://${location.host}/ws`);
  ws.addEventListener('message', e=>{ try { const msg=JSON.parse(e.data); if(msg.type==='state') populate(msg.data); } catch {} });
  ws.addEventListener('close',()=>setTimeout(socket,2500));
  ws.addEventListener('error',()=>ws.close());
}
async function verify() {authToken=el('adminToken').value.trim(); try {await api('verify');sessionStorage.setItem('liveverse_admin',authToken);el('authLabel').textContent='✓ صلاحية الإدارة مفعّلة في هذه الجلسة';el('authLabel').classList.add('valid');toast('تم تفعيل الإدارة');await refreshBank();}catch{authToken='';sessionStorage.removeItem('liveverse_admin');}}
function paintBank(summary) {
  if (!summary || !Number.isInteger(summary.total)) return;
  el('bankCount').textContent = summary.total.toLocaleString('ar-SA') + ' سؤال';
  el('bankRemaining').textContent = 'المتبقي: ' + summary.remaining.toLocaleString('ar-SA') + ' | المستخدمة: ' + summary.used.toLocaleString('ar-SA');
}
async function refreshBank() {
  if (!authToken) return;
  const res = await fetch('/api/admin/bank', { headers: { Authorization: 'Bearer ' + authToken } });
  if (!res.ok) throw new Error('تعذر قراءة بيانات بنك الأسئلة');
  paintBank(await res.json());
}
function loadBankIntoForm(q) {
  setMode('quiz');
  el('gameTitle').value = 'تحدي المعلومات';
  el('gamePrompt').value = q.question;
  q.options.forEach((option, i) => { el('opt' + (i + 1)).value = option; });
  el('gameAnswer').value = q.answer;
  const sourceEl = el('bankSource');
  sourceEl.replaceChildren();
  if (/^https:\/\//.test(q.source)) {
    sourceEl.hidden = false;
    sourceEl.append(document.createTextNode('مرجع متعلق بالسؤال: '));
    const link = document.createElement('a');
    link.href = q.source; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = 'فتح المرجع ↗'; sourceEl.append(link);
  } else { sourceEl.hidden = true; }
}
async function drawBankQuestion(start = false) {
  try {
    if (state?.status.active) { toast('أوقف الجولة الحالية قبل تحميل سؤال جديد', true); return; }
    const result = await api('bank-next', { category: el('bankCategory').value, difficulty: el('bankDifficulty').value, start });
    loadBankIntoForm(result.question);
    paintBank(result.bank);
    toast(start ? 'بدأ السؤال الجديد! اكتبوا الإجابة في التعليقات' : 'تم تحميل السؤال وحفظه. اضغط بدء الجولة لعرضه.');
    if (start) el('settingsDialog').close();
  } catch {}
}
function configureData() {return {mode:currentMode,title:el('gameTitle').value,prompt:el('gamePrompt').value,options:[1,2,3,4].map(i=>el('opt'+i).value),answer:el('gameAnswer').value,target:Number(el('gameTarget').value),duration:Number(el('gameDuration').value)};}
let presenterBusy = false;
function openSettings(focusId) {
  const dialog=el('settingsDialog');
  if(!dialog.open) dialog.showModal();
  if(focusId){const input=el(focusId);input?.focus();input?.scrollIntoView({block:'center'});}
}
function paintPresenter(data) {
  const active=!!data.status.active, open=data.registration?.phase==='open';
  const count=data.registration?.count||0;
  document.body.dataset.phase=open?'registration':active?'active':data.status.results?'results':'waiting';
  el('presenterKeyword').textContent=active&&data.status.mode==='quiz'?'1–4':data.registration?.keyword||'انضم';
  el('presenterAudienceCount').textContent=count.toLocaleString('ar-SA');
  el('presenterQuestionNumber').textContent=String(data.round||0).padStart(2,'0');
  el('presenterRegistrationLabel').textContent=open?'إغلاق التسجيل':'فتح التسجيل';
  el('presenterRegistration').disabled=active||presenterBusy;
  el('presenterStop').disabled=!active||presenterBusy;
  el('presenterNext').disabled=active||!count||open||data.status.mode!=='quiz'||presenterBusy;
  el('presenterStart').disabled=active||!count||presenterBusy;
  el('presenterStartLabel').textContent=(data.status.results?'بدء الجولة التالية':'بدء اللعبة')+' ('+count+')';
  el('presenterStatus').textContent=open?'التسجيل مفتوح • انضم من تعليقات البث':active?'تُعتمد أول إجابة لكل متسابق':data.status.results?'انتهت الجولة • النتائج على الشاشة':count?'المشاركون جاهزون • ابدأ الجولة':'افتح التسجيل لاستقبال المشاركين';
}
async function presenterAction(button, action) {
  if(presenterBusy)return;
  presenterBusy=true;if(state)paintPresenter(state);
  try{await action();}catch{}finally{presenterBusy=false;if(state)paintPresenter(state);}
}
async function startPresentedRound() {
  if(state?.status.results&&state.status.mode==='quiz'){await drawBankQuestion(true);return;}
  await api('start');el('settingsDialog').close();
}
function wirePresenter() {
  el('presenterSettings').addEventListener('click',()=>openSettings());
  el('closeSettings').addEventListener('click',()=>el('settingsDialog').close());
  el('settingsDialog').addEventListener('click',event=>{
    if(event.target!==el('settingsDialog'))return;
    const r=event.target.getBoundingClientRect();
    if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();
  });
  el('presenterRegistration').addEventListener('click',event=>presenterAction(event.currentTarget,async()=>{
    const open=state?.registration?.phase==='open';
    await api(open?'registration-close':'registration-open',{keyword:el('registrationKeyword').value});
  }));
  el('presenterStart').addEventListener('click',event=>presenterAction(event.currentTarget,startPresentedRound));
  el('presenterNext').addEventListener('click',event=>presenterAction(event.currentTarget,()=>drawBankQuestion(true)));
  el('presenterStop').addEventListener('click',event=>presenterAction(event.currentTarget,()=>api('stop')));
  el('presenterFullscreen').addEventListener('click',async()=>{
    try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('استخدم زر ملء الشاشة في متصفحك');}
  });
  document.addEventListener('fullscreenchange',()=>el('presenterFullscreen').setAttribute('aria-label',document.fullscreenElement?'الخروج من ملء الشاشة':'ملء الشاشة'));
}
function askConfirm(btn, promptText, action) {
  if (btn.dataset.confirming === '1') {
    delete btn.dataset.confirming;
    btn.textContent = btn.dataset.origLabel || btn.textContent;
    btn.classList.remove('is-confirming');
    action();
    return;
  }
  btn.dataset.origLabel = btn.textContent;
  btn.dataset.confirming = '1';
  btn.textContent = 'تأكيد؟ اضغط مرة أخرى';
  btn.classList.add('is-confirming');
  toast(promptText);
  setTimeout(() => {
    if (btn.dataset.confirming === '1') {
      delete btn.dataset.confirming;
      btn.textContent = btn.dataset.origLabel || btn.textContent;
      btn.classList.remove('is-confirming');
    }
  }, 4500);
}
function wire() {
  el('adminToken').value=authToken;
  if(authToken) el('authLabel').textContent='رمز سابق محفوظ مؤقتًا لهذه الجلسة؛ يمكنك التحقق مجددًا.';
  el('verifyButton').addEventListener('click',verify);
  el('openRegistrationButton').addEventListener('click', async()=>{
    try { await api('registration-open',{keyword:el('registrationKeyword').value}); toast('التسجيل مفتوح! اكتبوا كلمة الانضمام في الشات.'); } catch {}
  });
  el('closeRegistrationButton').addEventListener('click', async()=>{
    try { await api('registration-close'); toast('تم إغلاق التسجيل. يمكن بدء الجولة.'); } catch {}
  });
  el('newRegistrationButton').addEventListener('click', e=>{
    askConfirm(e.currentTarget, 'سيُمسح جميع المتسابقين ونقاطهم وتُفتح مرحلة تسجيل جديدة — اضغط مجددًا للتأكيد.', async()=>{
      try { await api('registration-open',{keyword:el('registrationKeyword').value, reset:true}); toast('بدأ تسجيل جديد وتم تصفير نتائج الفعالية السابقة'); } catch {}
    });
  });

  el('loadQuestionButton').addEventListener('click', () => drawBankQuestion(false));
  el('playQuestionButton').addEventListener('click', () => drawBankQuestion(true));
  el('bankResetButton').addEventListener('click', e => {
    askConfirm(e.currentTarget, 'سيُسمح بإعادة استخدام جميع الأسئلة في الجلسة — اضغط مجددًا للتأكيد.', async () => {
      try { const r = await api('bank-reset'); paintBank(r.bank); toast('تم تصفير سجل الأسئلة المستخدمة'); } catch {}
    });
  });
  document.querySelectorAll('.mode').forEach(btn=>btn.addEventListener('click',()=>setMode(btn.dataset.mode)));
  el('gameForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('configure',configureData());toast('تم حفظ إعدادات الجولة');}catch{}});
  el('startButton').addEventListener('click',async()=>{try{await api('configure',configureData());await api('start');toast('بدأت الجولة!');}catch{}});
  el('stopButton').addEventListener('click',async()=>{try{await api('stop');toast('تم إيقاف الجولة');}catch{}});
  el('drawButton').addEventListener('click',async()=>{try{await api('draw');}catch{}});
  el('connectButton').addEventListener('click',async()=>{try{toast('محاولة الاتصال بالبث...');await api('connect',{username:el('tiktokUser').value});toast('تم الاتصال بالبث');}catch{}});
  el('disconnectButton').addEventListener('click',async()=>{try{await api('disconnect');toast('تم فصل البث');}catch{}});
  el('simulateButton').addEventListener('click',async()=>{try{await api('simulate',{username:el('demoName').value,text:el('demoMessage').value});el('demoMessage').value='';}catch{}});
  el('demoMessage').addEventListener('keydown',e=>{if(e.key==='Enter')el('simulateButton').click();});
  el('resetScoresButton').addEventListener('click',e=>{
    askConfirm(e.currentTarget, 'سيتم مسح المتسابقين ونقاطهم — اضغط مجددًا للتأكيد.', async()=>{
      try{await api('reset');toast('تم تصفير النقاط');}catch{}
    });
  });
}
async function autoDevAuth() {
  if (authToken) return;
  try {
    const r = await fetch('/api/dev-token');
    if (!r.ok) return;
    const { token } = await r.json();
    if (token) {
      authToken = token;
      el('adminToken').value = token;
      sessionStorage.setItem('liveverse_admin', token);
      el('authLabel').textContent = '✓ صلاحية الإدارة مفعّلة تلقائيًا لبيئة التطوير';
      el('authLabel').classList.add('valid');
      await refreshBank();
    }
  } catch {}
}
wire();wirePresenter();if (authToken) refreshBank().catch(() => {});else autoDevAuth();fetch('/api/state').then(r=>r.json()).then(populate).catch(()=>toast('تعذر الاتصال بالسيرفر',true));socket();

