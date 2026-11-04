/* SPONGE LIVE event settings and authentic chat-driven game launch. */
const $ = id => document.getElementById(id);
const GAME_MODES = Object.freeze({
 glass: {title:'الجسر الزجاجي',category:'إقصاء',description:'سؤال كل خطوة ولوحين: اكتب رقم إجابتك — واللي غلط ينكسر تحته',label:'طول اللعبة',timeLabel:'وقت القفزة',badgeUnit:'ث',lengths:{short:5,normal:10,long:15},seconds:10},
 quiz: {title:'تحدي المعلومات',category:'ذكاء',description:'سؤال وأربع إجابات: اكتب رقم الاختيار الصحيح في الشات — والأسرع يتصدر',label:'مدة الجولة',timeLabel:'وقت الإجابة',badgeUnit:'ث',lengths:{short:15,normal:30,long:60},seconds:30},
 guess: {title:'خمّن الكلمة',category:'ذكاء وسرعة',description:'شاهد التلميح وأرسل تخمينك في الشات — أول إجابة صحيحة تحصد النقاط',label:'مدة الجولة',timeLabel:'وقت التخمين',badgeUnit:'ث',lengths:{short:15,normal:30,long:60},seconds:30},
 race: {title:'سباق الجمهور',category:'سرعة',description:'متابعينك يكتبون !go في الشات ليتقدموا نحو خط النهاية — والأسرع يفوز',label:'طول السباق',timeLabel:'هدف السباق',badgeUnit:'حركة',lengths:{short:5,normal:12,long:25},seconds:0},
 rps: {title:'حجر ورقة مقص',category:'إقصاء',description:'تحدَّ بوبل: اكتب حجر أو ورقة أو مقص — ثلاث حيوات وآخر باقٍ يفوز',label:'عدد الجولات',timeLabel:'وقت الجولة',badgeUnit:'جولة',lengths:{short:8,normal:15,long:25},seconds:15,party:true},
 minority: {title:'الأقلية تفوز',category:'ذكاء وسرعة',description:'خياران في كل جولة: اكتب 1 أو 2 — الجهة الأقل عددًا تنجو',label:'عدد الجولات',timeLabel:'وقت الجولة',badgeUnit:'جولة',lengths:{short:6,normal:10,long:15},seconds:15,party:true},
 higherlower: {title:'أعلى أم أقل',category:'ذكاء وسرعة',description:'هل الورقة التالية أعلى أم أقل؟ اكتب إجابتك في الشات',label:'عدد الجولات',timeLabel:'وقت الجولة',badgeUnit:'جولة',lengths:{short:5,normal:8,long:12},seconds:10,party:true},
 truefalse: {title:'حقيقة أم كذب',category:'ذكاء وسرعة',description:'عبارة في كل جولة: اكتب صح أو خطأ — الأسرع يحصد نقاطًا أكثر',label:'عدد الجولات',timeLabel:'وقت الجولة',badgeUnit:'جولة',lengths:{short:5,normal:8,long:12},seconds:15,party:true},
 redlight: {title:'الضوء الأحمر',category:'إقصاء',description:'عند الأخضر اكتب رقمًا من 1 إلى 5 للتقدم — أي حركة عند الأحمر تقصيك',label:'عدد الإشارات',timeLabel:'إشارات',badgeUnit:'إشارة',lengths:{short:10,normal:16,long:24},seconds:0,party:true},
 bowling: {title:'البولينج',category:'حظ',description:'اكتب رقمًا من 1 إلى 10 لترمي الكرة — رقم الحظ مخفي في كل إطار',label:'عدد الإطارات',timeLabel:'وقت الرمية',badgeUnit:'إطار',lengths:{short:2,normal:3,long:5},seconds:10,party:true},
 wheel: {title:'عجلة الأسماء',category:'حظ',description:'المسجلون يدخلون السحب تلقائيًا — اختر فائزًا عشوائيًا بضغطة واحدة',label:'عدد المشاركين',timeLabel:'سحب مباشر',badgeUnit:'',lengths:{short:10,normal:20,long:30},seconds:0}
});
const params = new URLSearchParams(location.search);
const game = Object.hasOwn(GAME_MODES,params.get('mode')) ? params.get('mode') : 'glass';
const meta = GAME_MODES[game];
const DEFAULT_MAX = 30;
let selectedLength = 'normal';
let selectedAudience = 'all';
let currentState = null;
let token = sessionStorage.getItem('liveverse_admin') || '';
const canControl = () => !!token || !!window.SkySession?.hasControl();
const roomPath = (p) => window.SkySession ? window.SkySession.withRoom(p) : p;
let launchBusy=false;
let resumeAfterAuth=false;
let socketRetries=0;
let audienceDirty=false;
let pendingAudience=null;
let audienceSaveQueue=Promise.resolve();

function makeSvgNode(tag,attributes={}) {
 const item=document.createElementNS('http://www.w3.org/2000/svg',tag);
 for(const [k,v] of Object.entries(attributes)) item.setAttribute(k,String(v));
 return item;
}
function createGlassBridge() {
 const surface=$('bridgePanels'),sparks=$('bridgeSparks');
 if (!surface || !sparks)return;
 const yRows=[109,125,143,166,194,229,273,329,398,490];
 const left = y=>295-(y-109)*.535;
 const right = y=>345+(y-109)*.535;
 const center = () => 320;
 for(let row=0;row<yRows.length-1;row++){
   const y1=yRows[row]+2,y2=yRows[row+1]-3;
   for(let side=0;side<2;side++){
     const cut=side===0? -5:5;
     const coords=side===0?[
       [left(y1)+4,y1],[center()+cut,y1],[center()+cut,y2],[left(y2)+6,y2]
     ]:[
       [center()+cut,y1],[right(y1)-4,y1],[right(y2)-6,y2],[center()+cut,y2]
     ];
     const points=coords.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
     const opacity=.4+row*.055;
     surface.append(makeSvgNode('polygon',{points,fill:'url(#glassPanel)',opacity:opacity.toFixed(2),stroke:'#0D3742','stroke-width':Math.max(1,2.6-row*.13)}));
     const inset=side===0 ? [left(y1)+7,center()-12] : [center()+12,right(y1)-7];
     surface.append(makeSvgNode('line',{x1:inset[0],y1:y1+2,x2:inset[1],y2:y1+2,stroke:'#A2D1D9','stroke-width':1.1,opacity:0.3+row*.02}));
   }
 }
 // Intentionally deterministic particle positions to prevent jitter between page loads.
 for(let i=0;i<48;i++){
   const x=((i*137+37)%614)+12,y=((i*79+23)%460)+10;
   const rad=i%9===0?2.7:i%4===0?1.8:1;
   sparks.append(makeSvgNode('circle',{cx:x,cy:y,r:rad,fill:'#B6E2E7',opacity:(.3+(i%6)*.09).toFixed(2)}));
 }
 const shards=[[414,265,430,271,421,293],[446,288,462,301,448,307],[473,300,488,305,479,330],[423,333,438,349,428,354],[454,355,472,363,461,380],[490,340,505,350,489,367]];
 for(const shard of shards)sparks.append(makeSvgNode('polygon',{points:shard.join(' '),fill:'#B5F3F4',opacity:'.65'}));
}
createGlassBridge();

function configureVisuals() {
 document.body.dataset.game=game;
 $('eventName').textContent=meta.title;
 $('eventCategory').textContent=meta.category;
 $('eventDescription').textContent=meta.description;
 $('lengthHeading').textContent=meta.label;
 $('statDurationLabel').textContent=meta.timeLabel;
 $('timeFieldName').textContent=meta.timeLabel;
 document.title=meta.title+' | SPONGE LIVE';
 if(game==='glass'){
  $('stepSeconds').value='10';
  $('stepSeconds').closest('.advanced-row').hidden=false;
 }else if(['quiz','guess'].includes(game)){
  $('stepSeconds').value='30';
  $('stepSeconds').closest('.advanced-row').hidden=false;
 }else if(meta.party && meta.seconds){
  $('stepSeconds').value=String(meta.seconds);
  $('stepSeconds').closest('.advanced-row').hidden=false;
 }else{
  $('stepSeconds').closest('.advanced-row').hidden=true;
 }
 $('advancedSettings').querySelector('summary small').textContent=['glass','quiz','guess'].includes(game)||(meta.party&&meta.seconds)?'3':'2';
 const cover=$('modeCoverArt'); if(cover&&meta.party){cover.src='/covers/'+game+'.svg';cover.hidden=false;}
 updateStats();
 if(game==='guess')ensureGuessFields();
}
function ensureGuessFields() {
 const container=$('advancedSettings').querySelector('.advanced-fields');
 const row=document.createElement('label');
 row.className='advanced-row';
 row.id='guessAnswerRow';
 const info=document.createElement('span'),title=document.createElement('strong'),desc=document.createElement('small');
 title.textContent='الإجابة السرية';desc.textContent='لا تظهر للمشاركين أثناء الجولة';info.append(title,desc);
 const input=document.createElement('input');input.id='guessAnswer';input.maxLength=80;input.placeholder='الإجابة الصحيحة';input.required=true;input.dir='auto';
 input.style.cssText='max-width:130px;min-height:42px;font-size:.8rem;border:1px solid #5F8491;border-radius:11px;background:#121F36;padding:6px 8px';
 row.append(info,input);
 const extra=document.createElement('label');extra.className='advanced-row';
 const intro=document.createElement('span');const t=document.createElement('strong');t.textContent='التلميح الظاهر للجمهور';intro.append(t);
 const hint=document.createElement('input');hint.id='guessPrompt';hint.maxLength=200;hint.placeholder='تلميح للمشاهدين';hint.dir='auto';
 hint.style.cssText='max-width:160px;min-height:42px;font-size:.8rem;border:1px solid #5F8491;border-radius:11px;background:#121F36;padding:6px 8px';
 extra.append(intro,hint);container.prepend(extra);container.prepend(row);
 $('advancedSettings').querySelector('summary small').textContent='5';
}
function numPlayers() {
 let n=Number($('maxPlayers').value);
 if(!Number.isFinite(n))n=DEFAULT_MAX;
 n=Math.min(30,Math.max(1,Math.round(n)));
 $('maxPlayers').value=String(n);
 return n;
}
function updateStats() {
 $('statPlayers').textContent=String(numPlayers());
 const n=meta.lengths[selectedLength];
 $('statDuration').textContent=meta.party ? String(n)+' '+meta.badgeUnit : game==='glass' ? $('stepSeconds').value+' ث' : game==='wheel' ? 'سحب' : (game==='race'?String(n):String(n)+' ث');
}
function setLength(value) {
 if(!Object.hasOwn(meta.lengths,value))return;
 selectedLength=value;
 document.querySelectorAll('.length-option').forEach(el=>{
   const active=el.dataset.length===value;
   el.classList.toggle('active',active);
   el.setAttribute('aria-pressed',String(active));
 });
 if(['quiz','guess'].includes(game))$('stepSeconds').value=String(meta.lengths[value]);
 if(game==='glass')$('stepSeconds').value='10';
 updateStats();
}
function setAudience(value, persist=false) {
 if(!['all','followers','subscribers'].includes(value))return;
 if(persist && currentState?.status?.active){
   report('لا يمكن تغيير أهلية التسجيل أثناء الجولة. أنهِ الجولة أولًا.',true);
   return;
 }
 selectedAudience=value;
 document.querySelectorAll('.audience-option').forEach(el=>{
   const active=el.dataset.audience===value;
   el.classList.toggle('active',active);
   el.setAttribute('aria-pressed',String(active));
 });
 $('audienceHint').hidden=value==='all';
 $('audienceHint').textContent=value==='followers'
  ? 'يسجّل الموقع المتابعين المؤكدين فقط. إذا تابعت الحساب الآن، اكتب «انضم» مرة أخرى ليتم التحقق.'
  : 'المشتركون فقط: لا يُقبل التسجيل إذا لم تؤكد بيانات TikTok وجود اشتراك فعّال.';
 if(persist) {
   audienceDirty=true;
   void persistAudience(value);
 }
}
function persistAudience(value) {
 if(!canControl()){
   pendingAudience=value;
   openAuth('أدخل رمز الإدارة لحفظ شرط المتابعة وتطبيقه على التسجيل.');
   return Promise.resolve(false);
 }
 const job=audienceSaveQueue.catch(()=>{}).then(async()=>{
   if(value!==selectedAudience)return false;
   try {
     const result=await admin('registration-settings',{audience:value});
     if(value===selectedAudience){
       audienceDirty=false;
       pendingAudience=null;
       const n=Number(result.registration?.removed||0);
       const label=value==='followers'?'المتابعون فقط':value==='subscribers'?'المشتركون فقط':'الجميع';
       report('تم تطبيق «'+label+'» على السيرفر فورًا.'+(n?' واستبعاد '+n+' غير مؤهلين من التسجيل.':''));
     }
     await requestState().catch(()=>{});
     return true;
   }catch(error){
     if(value===selectedAudience){
       if(error.code===401){
         token='';sessionStorage.removeItem('liveverse_admin');
         pendingAudience=value;
         openAuth('رمز الإدارة غير صحيح. أعد إدخاله لتطبيق شرط المتابعة.');
       }else{
         audienceDirty=false;
         setAudience(currentState?.registration?.audience||'all');
         report('لم يتم تطبيق شرط التسجيل: '+error.message,true);
       }
     }
     return false;
   }
 });
 audienceSaveQueue=job;
 return job;
}
function joinWord() {
 const word=$('joinKeyword').value.trim();
 $('joinBannerWord').textContent=word||'انضم';
 return word;
}
function report(msg,error=false){
 const node=$('eventFeedback');node.textContent=msg;node.classList.toggle('error',error);
}
function viewState(data) {
 if(!data?.status)return;
 currentState=data;
 // Show the server-enforced setting, not an unsaved default from the browser.
 if(!audienceDirty && data.registration?.audience && selectedAudience!==data.registration.audience)
   setAudience(data.registration.audience);
 if(data.status.active) {
   $('startButtonLabel').textContent=game==='wheel'&&data.status.mode==='wheel'?'اختيار الفائز':'الجولة جارية';
 }else if(data.registration?.phase==='open'){
   $('startButtonLabel').textContent=(data.playerCount||0)>0?'ابدأ الجولة':'انتظار المشاركين';
 }else if(data.registration?.phase==='closed' && (data.playerCount||0)>0){
   $('startButtonLabel').textContent='ابدأ الجولة';
 }else{
   $('startButtonLabel').textContent='ابدأ اللعبة';
 }
 // Existing registration is authoritative. Do not reset fields while the host is editing them.
 if(data.registration?.phase==='open'){
   const count=Number(data.playerCount||0);
   report('التسجيل مفتوح: '+count+' مشارك. اكتبوا «'+(data.registration.keyword||'انضم')+'» في الشات.');
 }
}
async function requestState(){
 const res=await fetch(roomPath('/api/state'),{cache:'no-store'});
 if(!res.ok)throw new Error('تعذر الاتصال بالسيرفر');
 viewState(await res.json());
}
function eventSocket() {
 const proto=location.protocol==='https:'?'wss':'ws';
 let socket;
 try{socket=new WebSocket(window.SkySession?window.SkySession.wsUrl():proto+'://'+location.host+'/ws');}catch{return;}
 socket.addEventListener('open',()=>{socketRetries=0;});
 socket.addEventListener('message',ev=>{
   try{const data=JSON.parse(ev.data);if(data.type==='state')viewState(data.data);}catch{}
 });
 socket.addEventListener('close',()=>setTimeout(eventSocket,Math.min(15000,2000*(++socketRetries))));
 socket.addEventListener('error',()=>socket.close());
}
async function admin(action,body={}){
 if(!canControl())throw Object.assign(new Error('يلزم تفعيل صلاحية الإدارة'),{code:401});
 const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;
 const response=await fetch('/api/admin/'+action,{method:'POST',headers,credentials:'same-origin',body:JSON.stringify(body)});
 let data={};try{data=await response.json();}catch{}
 if(!response.ok)throw Object.assign(new Error(data.error||'تعذر تنفيذ الطلب'),{code:response.status});
 return data;
}
function openAuth(message=''){
 $('accessError').hidden=!message;$('accessError').textContent=message;
 if(!$('accessDialog').open)$('accessDialog').showModal();
 $('eventAdminToken').focus();
}
function configForGame() {
 const len=meta.lengths[selectedLength];
 const config={mode:game,title:meta.title};
 if(game==='glass') Object.assign(config,{glassSteps:len,glassStepDuration:Number($('stepSeconds').value)});
 if(['quiz','guess'].includes(game))config.duration=Number($('stepSeconds').value);
 if(game==='guess'){
   const answer=$('guessAnswer')?.value.trim();
   const prompt=$('guessPrompt')?.value.trim();
   if(!answer||!prompt)throw new Error('اكتب التلميح والإجابة الصحيحة من الإعدادات المتقدمة أولًا');
   Object.assign(config,{answer,prompt});
 }
 if(game==='race')config.target=len;
 if(meta.party){config.rounds=len; if(meta.seconds)config.roundSeconds=Number($('stepSeconds').value);}
 return config;
}
async function startEvent() {
 if(launchBusy)return;
 let state=currentState;
 if(state?.status.active){
   if(game==='wheel' && state.status.mode==='wheel'){
     if(!canControl()){resumeAfterAuth=true;openAuth();return;}
     launchBusy=true;
     try{const result=await admin('draw');report('🏆 الفائز: '+result.result.name);await requestState();}catch(error){report(error.message,true);}finally{launchBusy=false;}
     return;
   }
   report('هناك فعالية قيد التشغيل حاليًا. أنهِ الجولة من الاستوديو قبل بدء فعالية أخرى.',true);
   return;
 }
 if(!canControl()){resumeAfterAuth=true;openAuth();return;}
 // Finish saving the selected follower restriction before opening signups.
 await audienceSaveQueue.catch(()=>{});
 if(audienceDirty) {
   const applied=await persistAudience(selectedAudience);
   if(!applied)return;
 }
 state=currentState;
 let configuration;
 try{configuration=configForGame();}catch(error){report(error.message,true);$('advancedSettings').open=true;return;}
 const word=joinWord();
 if(!word || word.length>32 || !/[\p{L}\p{N}]/u.test(word)){report('كلمة الانضمام غير صالحة. اختر كلمة من 1 إلى 32 حرفًا.',true);return;}
 const limit=numPlayers();
 const phase=state?.registration?.phase || 'idle';
 const count=Number(state?.playerCount||0);
 const reset=$('resetSession').checked;
 launchBusy=true;
 const button=$('startGameButton');button.disabled=true;
 let openDisplay=null;
 // Opening an output window must happen inside the user gesture, never in a delayed callback.
 if($('openOverlay').checked)openDisplay=window.open('/overlay','_blank','noopener');
 try {
   if(phase==='idle' || reset || count===0) {
     await admin('configure',configuration);
     await admin('registration-open',{keyword:word,maxPlayers:limit,audience:selectedAudience,reset});
     report('فُتح التسجيل. اطلب من جمهورك كتابة «'+word+'» في تعليقات البث، ثم اضغط «ابدأ الجولة» بعد دخولهم.');
   }else{
     if(count>limit)throw new Error('عدد المتسابقين الحاليين ('+count+') أكبر من الحد المحدد. ارفع الحد أو ابدأ جلسة جديدة.');
     if(phase==='open' && (state.registration.keyword!==word || state.registration.maxPlayers!==limit || state.registration.audience!==selectedAudience)) {
       // Keep the enrolled users but update admission settings while registration is open.
       await admin('registration-open',{keyword:word,maxPlayers:limit,audience:selectedAudience});
     }
     if(game==='quiz') {
       await admin('bank-next',{category:'all',difficulty:'all',start:false});
     }
     await admin('configure',configuration);
     if(phase==='open')await admin('registration-close');
     await admin('start');
     report(game==='glass'?'بدأ الجسر الزجاجي! يختار المتسابقون اللوح 1 أو 2 في التعليقات.':'بدأت الجولة! افتح شاشة البث لعرض التحدي.');
   }
   await requestState();
 }catch(error){
   report(error.message,true);
   if(error.code===401){token='';sessionStorage.removeItem('liveverse_admin');resumeAfterAuth=true;openAuth('رمز الإدارة غير صحيح. أعد إدخاله.');}
 }finally{
   button.disabled=false;launchBusy=false;
 }
}
function resetDefaults(){
 $('joinKeyword').value='انضم';$('joinBannerWord').textContent='انضم';
 $('maxPlayers').value=String(DEFAULT_MAX);
 $('resetSession').checked=false;
 $('openOverlay').checked=false;
 $('stepSeconds').value=String(meta.seconds||10);
 setLength('normal');setAudience('all',true);
 $('advancedSettings').open=false;
 report('تمت إعادة الإعدادات إلى الوضع الافتراضي.');
}

$('joinKeyword').addEventListener('input',joinWord);
$('maxPlayers').addEventListener('input',updateStats);
$('maxPlayers').addEventListener('change',updateStats);
$('increasePlayers').addEventListener('click',()=>{$('maxPlayers').value=String(Math.min(30,numPlayers()+1));updateStats();});
$('decreasePlayers').addEventListener('click',()=>{$('maxPlayers').value=String(Math.max(1,numPlayers()-1));updateStats();});
$('stepSeconds').addEventListener('change',updateStats);
$('accountAccess')?.addEventListener('click',()=>{ $('accessDialog').close(); window.SkyAccount?.open({ onDone: () => { if(window.SkySession?.hasControl()){ report('تم الدخول — أصبحت تتحكم في غرفتك الخاصة.'); if(resumeAfterAuth){resumeAfterAuth=false;startEvent();} } } }); });
document.querySelectorAll('.length-option').forEach(btn=>btn.addEventListener('click',()=>setLength(btn.dataset.length)));
document.querySelectorAll('.audience-option').forEach(btn=>btn.addEventListener('click',()=>setAudience(btn.dataset.audience,true)));
$('resetDefaults').addEventListener('click',resetDefaults);
$('startGameButton').addEventListener('click',startEvent);
$('closeAccess').addEventListener('click',()=>$('accessDialog').close());
$('accessForm').addEventListener('submit',async ev=>{
 ev.preventDefault();
 const value=$('eventAdminToken').value.trim();
 const button=$('accessForm').querySelector('button[type=submit]');
 button.disabled=true;
 try{
  const res=await fetch('/api/admin/verify',{method:'POST',headers:{Authorization:'Bearer '+value}});
  if(!res.ok)throw new Error('رمز الإدارة غير صحيح');
  token=value;sessionStorage.setItem('liveverse_admin',value);
  $('eventAdminToken').value='';$('accessDialog').close();
  report('صلاحية الإدارة مفعّلة.');
  if(pendingAudience!==null){
    const audience=pendingAudience;
    pendingAudience=null;
    await persistAudience(audience);
  }
  if(resumeAfterAuth){resumeAfterAuth=false;await startEvent();}
 }catch(error){$('accessError').textContent=error.message;$('accessError').hidden=false;}
 finally{button.disabled=false;}
});
configureVisuals();
requestState().catch(()=>report('تعذر جلب حالة الموقع، تحقق من اتصال الإنترنت.',true));
eventSocket();
