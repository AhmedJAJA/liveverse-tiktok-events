const el = id => document.getElementById(id);
let state;
let authToken = sessionStorage.getItem('liveverse_admin') || '';
let currentMode = 'quiz';
let toastTimeout;
const instructions = {
  quiz: ['أول إجابة صحيحة تفوز بـ 5 نقاط', 'المشاهد يكتب رقم الإجابة في التعليقات: 1 أو 2 أو 3 أو 4'],
  guess: ['أول شخص يكتب الإجابة الصحيحة يفوز', 'اكتب الإجابة في الحقل المخصص؛ لا تظهر للجمهور في شاشة OBS.'],
  race: ['كل مشاهد يتقدم بكتابة !go', 'المشاهد يكتب !join للانضمام ثم !go للتقدم. هناك مهلة 1.2 ثانية لكل حركة.'],
  wheel: ['جمع الأسماء ثم السحب العشوائي', 'المشاهد يكتب !join أو !انضم للمشاركة. اضغط اختيار الفائز عند انتهاء التسجيل.']
};
const modeLabels = { quiz: 'الأسئلة', guess: 'التخمين', race: 'السباق', wheel: 'العجلة' };
function toast(message, error=false) { const box=el('toast'); box.textContent=message; box.classList.toggle('error', error); box.classList.add('show'); clearTimeout(toastTimeout); toastTimeout=setTimeout(()=>box.classList.remove('show'),4500); }
function safeText(v) { return String(v ?? ''); }
async function api(action, data={}) {
  if (!authToken) { toast('أدخل رمز الإدارة وفعّله أولًا', true); throw new Error('Authentication required'); }
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
  el('roundNumber').textContent=String(state.round).padStart(2,'0');
  el('statusText').textContent=state.status.active?'جولة جارية':'في الانتظار';
  const live=state.connection.state;
  const online=live==='connected';
  const badge=el('networkBadge');badge.classList.toggle('online',online);
  badge.innerHTML=''; const dot=document.createElement('span');dot.className='status-dot';badge.append(dot,document.createTextNode(online?'متصل بالبث':live==='connecting'?'جارٍ الاتصال':live==='error'?'فشل الاتصال':'وضع المعاينة'));
  el('liveStatus').textContent=online?'متصل':live==='connecting'?'جارٍ الاتصال':'غير متصل';
  el('liveSubtitle').textContent=state.connection.username ? '@'+state.connection.username : 'TikTok LIVE';
  el('connectionDetail').textContent=state.connection.detail||'لا يوجد اتصال حاليًا';
  const top=el('leaderboard');top.replaceChildren();
  if (!state.leaderboard.length) { top.append(empty('لم يحصل أحد على نقاط بعد.')); }
  else state.leaderboard.slice(0,10).forEach((p,i)=>{const row=document.createElement('div');row.className='leader-row';const rank=document.createElement('span');rank.className='rank '+(i<3?'top-'+i:'');rank.textContent=String(i+1).padStart(2,'0');const name=document.createElement('strong');name.textContent=p.name;const score=document.createElement('span');score.className='score';score.textContent=p.score+' PTS';row.append(rank,name,score);top.append(row);});
  const feed=el('chatFeed');feed.replaceChildren();
  if (!state.recent.length) feed.append(empty('التعليقات ستظهر هنا عند الاتصال أو المحاكاة.'));
  else state.recent.slice(0,12).forEach(c=>{const row=document.createElement('div');row.className='feed-row';const icon=document.createElement('span');icon.className='chat-icon';icon.textContent='✦';const user=document.createElement('strong');user.textContent=c.name;const text=document.createElement('span');text.textContent=c.message;const time=document.createElement('small');time.textContent=new Date(c.at).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'});row.append(icon,user,text,time);feed.append(row);});
  if(state.status.lastEvent?.winner && state.status.lastEvent.at!==populate.lastWinner) { populate.lastWinner=state.status.lastEvent.at;toast('🏆 '+state.status.lastEvent.winner.name+' فاز بالجولة!'); }
}
function empty(text) { const div=document.createElement('div');div.className='empty';div.textContent=text;return div; }
function socket() {
  const proto=location.protocol==='https:'?'wss':'ws';
  const ws=new WebSocket(`${proto}://${location.host}/ws`);
  ws.addEventListener('message', e=>{ try { const msg=JSON.parse(e.data); if(msg.type==='state') populate(msg.data); } catch {} });
  ws.addEventListener('close',()=>setTimeout(socket,2500));
  ws.addEventListener('error',()=>ws.close());
}
async function verify() {authToken=el('adminToken').value.trim(); try {await api('verify');sessionStorage.setItem('liveverse_admin',authToken);el('authLabel').textContent='✓ صلاحية الإدارة مفعّلة في هذه الجلسة';el('authLabel').classList.add('valid');toast('تم تفعيل الإدارة');}catch{authToken='';sessionStorage.removeItem('liveverse_admin');}}
function configureData() {return {mode:currentMode,title:el('gameTitle').value,prompt:el('gamePrompt').value,options:[1,2,3,4].map(i=>el('opt'+i).value),answer:el('gameAnswer').value,target:Number(el('gameTarget').value)};}
function wire() {
  el('adminToken').value=authToken;
  if(authToken) el('authLabel').textContent='رمز سابق محفوظ مؤقتًا لهذه الجلسة؛ يمكنك التحقق مجددًا.';
  el('verifyButton').addEventListener('click',verify);
  document.querySelectorAll('.mode').forEach(btn=>btn.addEventListener('click',()=>setMode(btn.dataset.mode)));
  el('gameForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('configure',configureData());toast('تم حفظ إعدادات الجولة');}catch{}});
  el('startButton').addEventListener('click',async()=>{try{await api('configure',configureData());await api('start');toast('بدأت الجولة!');}catch{}});
  el('stopButton').addEventListener('click',async()=>{try{await api('stop');toast('تم إيقاف الجولة');}catch{}});
  el('drawButton').addEventListener('click',async()=>{try{await api('draw');}catch{}});
  el('connectButton').addEventListener('click',async()=>{try{toast('محاولة الاتصال بالبث...');await api('connect',{username:el('tiktokUser').value});toast('تم الاتصال بالبث');}catch{}});
  el('disconnectButton').addEventListener('click',async()=>{try{await api('disconnect');toast('تم فصل البث');}catch{}});
  el('simulateButton').addEventListener('click',async()=>{try{await api('simulate',{username:el('demoName').value,text:el('demoMessage').value});el('demoMessage').value='';}catch{}});
  el('demoMessage').addEventListener('keydown',e=>{if(e.key==='Enter')el('simulateButton').click();});
  el('resetScoresButton').addEventListener('click',async()=>{if(!confirm('متأكد من تصفير جميع نقاط الجلسة؟'))return;try{await api('reset');toast('تم تصفير النقاط');}catch{}});
}
wire();fetch('/api/state').then(r=>r.json()).then(populate).catch(()=>toast('تعذر الاتصال بالسيرفر',true));socket();
