/* SKY LIVE homepage: real session scores, connection state and working studio links. */
const byId = id => document.getElementById(id);
const allowedAvatars = ['tiktokcdn.com','tiktokcdn-us.com','tiktokcdn-eu.com','tiktokcdn-in.com','byteoversea.com','ibytedtos.com','ibyteimg.com','muscdn.com'];
let sessionState = null;
let socketRetry = 0;
let adminToken = sessionStorage.getItem('liveverse_admin') || '';
let dialogIntent = 'connect';
let siteGames = [];
let lastConnState = '';
const menuToggle = byId('menuToggle');
const nav = byId('navLinks');

if (menuToggle && nav) {
  menuToggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'إغلاق القائمة' : 'فتح القائمة');
  });
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    nav.classList.remove('open');
    menuToggle.setAttribute('aria-expanded','false');
  }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && nav.classList.contains('open')) {
      nav.classList.remove('open');
      menuToggle.setAttribute('aria-expanded','false');
      menuToggle.focus();
    }
  });
}

function initSmartImages() {
  document.querySelectorAll('img[data-smart-img]').forEach(img => {
    const frame = img.closest('.img-skeleton');
    const fallback = frame?.querySelector('.img-fallback-card');
    function loaded() { frame?.classList.remove('img-skeleton','has-img-error'); if(fallback)fallback.hidden=true; }
    function failed() { img.hidden=true; frame?.classList.add('has-img-error'); frame?.classList.remove('img-skeleton'); if(fallback)fallback.hidden=false; }
    if (img.complete) { if(img.naturalWidth)loaded(); else failed(); }
    else { img.addEventListener('load',loaded,{once:true});img.addEventListener('error',failed,{once:true}); }
  });
}
initSmartImages();

function safeAvatar(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return '';
    if (!allowedAvatars.some(host => url.hostname === host || url.hostname.endsWith('.'+host))) return '';
    return url.href;
  } catch { return ''; }
}
function initials(name) { return Array.from(String(name || '؟').trim())[0] || '؟'; }
function appendAvatar(box, person) {
  box.replaceChildren();
  const avatar = safeAvatar(person?.avatar);
  if (!avatar) { box.textContent=initials(person?.name);return; }
  const image=document.createElement('img');
  image.alt='';
  image.loading='lazy';
  image.decoding='async';
  image.referrerPolicy='no-referrer';
  image.addEventListener('error', () => { box.textContent=initials(person?.name); }, {once:true});
  image.src=avatar;
  box.append(image);
}
function renderChampions(list) {
  const box = byId('seasonChampions');
  box.replaceChildren();
  if (!list.length || !list.some(p => Number(p.score) > 0)) {
    const empty=document.createElement('span');
    empty.className='season-empty';
    empty.textContent='كن أول أبطال الجلسة';
    box.append(empty);
    return;
  }
  for(const person of list.filter(p => Number(p.score)>0).slice(0,3)) {
    const chip=document.createElement('span');
    chip.className='champion-chip';
    const avatar=document.createElement('span');
    avatar.className='chip-avatar';
    appendAvatar(avatar,person);
    const label=document.createElement('b');
    label.textContent=person.name;
    chip.append(avatar,label);
    box.append(chip);
  }
}
function renderLeaderboard(list) {
  const display = [
    ['One','الأول'],['Two','الثاني'],['Three','الثالث']
  ];
  for(let i=0;i<display.length;i++) {
    const [suffix,ordinal]=display[i];
    const player=list[i];
    byId('name'+suffix).textContent=player?.name || (i===0?'بانتظار البطل':'المركز '+ordinal);
    byId('points'+suffix).textContent=Number(player?.score||0).toLocaleString('en-US');
    const box=byId('avatar'+suffix);
    if (player) appendAvatar(box,player);
    else {
      box.replaceChildren();
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('class','i');
      const use=document.createElementNS('http://www.w3.org/2000/svg','use');
      use.setAttribute('href','/icons.svg#i-crown');
      svg.append(use);box.append(svg);
    }
  }
  const score=Math.max(0,Number(list[0]?.score||0));
  const nextGoal=Math.max(50,Math.ceil((score+1)/50)*50);
  const prevGoal=Math.max(0,nextGoal-50);
  const current=score-prevGoal;
  const pct=Math.max(0,Math.min(100,(current/50)*100));
  byId('scoreLevel').textContent='الهدف '+nextGoal.toLocaleString('en-US');
  byId('scoreProgress').textContent=score.toLocaleString('en-US')+' / '+nextGoal.toLocaleString('en-US')+' نقطة';
  byId('passFill').style.width=pct+'%';
  const progress=byId('passProgress');
  progress.setAttribute('aria-valuenow',String(current));
  progress.setAttribute('aria-valuetext',score+' من '+nextGoal+' نقطة');
}
function renderConnection(connection) {
  const state=connection?.state || 'disconnected';
  const badge=byId('liveConnectionBadge');
  badge.classList.toggle('connected',state==='connected');
  badge.classList.toggle('connecting',state==='connecting');
  badge.classList.toggle('error',state==='error');
  const messages={connected:'متصل بالبث',connecting:'جارٍ الاتصال',error:'خطأ بالاتصال',disconnected:'غير متصل'};
  byId('liveConnectionStatus').textContent=messages[state]||'غير متصل';
  byId('connectionNote').textContent=connection?.detail || 'ربط تجريبي • يمكنك تجربة الفعاليات دون الاتصال ببث فعلي.';
  if (state==='connected' && connection.username && !byId('liveUsername').value) {
    byId('liveUsername').value=connection.username;
  }
}
function populate(state) {
  if(!state || !state.status)return;
  sessionState=state;
  renderConnection(state.connection);
  const leaderboard=Array.isArray(state.leaderboard)?state.leaderboard:[];
  renderChampions(leaderboard);
  renderLeaderboard(leaderboard);
  byId('headerPlayers').textContent=Number(state.playerCount||0).toLocaleString('en-US')+' مشارك';
  if(state.connection?.state!==lastConnState){lastConnState=state.connection?.state;renderLive(state);}
  renderKeyword(state.registration?.keyword);
}
async function refresh() {
  const response=await fetch(roomPath('/api/state'),{cache:'no-store'});
  if (!response.ok)throw new Error('تعذر قراءة بيانات البث');
  populate(await response.json());
}
function socket() {
  const ws=new WebSocket(window.SkySession?window.SkySession.wsUrl():(location.protocol==='https:'?'wss':'ws')+'://'+location.host+'/ws');
  ws.addEventListener('open',()=>{socketRetry=0;});
  ws.addEventListener('message',event=>{
    try {const packet=JSON.parse(event.data);if(packet.type==='state')populate(packet.data);}catch { /* ignore invalid packet */ }
  });
  ws.addEventListener('close',()=>{
    const delay=Math.min(15000,2000*(++socketRetry));
    setTimeout(socket,delay);
  });
  ws.addEventListener('error',()=>ws.close());
}
const roomPath=path=>window.SkySession?window.SkySession.withRoom(path):path;
const hasControl=()=>!!adminToken||!!window.SkySession?.hasControl();
function openAccount(tab, onDone) {
  if(window.SkyAccount)window.SkyAccount.open({tab,onDone});
  else showAdminDialog('','login');
}
async function callAdmin(action, body, token=adminToken) {
  const headers={'Content-Type':'application/json'};
  if(token)Object.assign(headers,{Authorization:'Bearer '+token});
  const response=await fetch('/api/admin/'+action,{method:'POST',headers,credentials:'same-origin',body:JSON.stringify(body||{})});
  let result={};
  try{result=await response.json();}catch{}
  if(!response.ok){const error=new Error(result.error||'تعذر تنفيذ الطلب');error.code=response.status;throw error;}
  return result;
}
function showAdminDialog(message='', intent='connect') {
  dialogIntent=intent;
  const dialog=byId('adminDialog');
  byId('landingAuthError').hidden=!message;
  byId('landingAuthError').textContent=message;
  if(!dialog.open)dialog.showModal();
  byId('landingAdminToken').focus();
}
async function connectBroadcast() {
  const platform=byId('livePlatform')?.value==='kick'?'kick':'tiktok';
  const username=byId('liveUsername').value.trim().replace(/^@/,'');
  const valid=platform==='kick'?/^[A-Za-z0-9_-]{2,30}$/:/^[\w.]{2,30}$/;
  if(!valid.test(username)) {
    byId('connectionNote').textContent=platform==='kick'?'أدخل اسم قناتك على Kick كما يظهر في الرابط، بدون مسافات.':'أدخل اسم مستخدم TikTok صحيحًا، بدون رابط أو مسافات.';
    byId('liveUsername').focus();
    return;
  }
  if(!hasControl()){openAccount('login',()=>connectBroadcast());return;}
  const button=byId('liveConnectButton');
  button.disabled=true;
  byId('liveConnectionStatus').textContent='جارٍ الاتصال';
  byId('liveConnectionBadge').classList.add('connecting');
  try {
    await callAdmin('connect',{username,platform});
    byId('connectionNote').textContent='تم ربط البث. يمكنك بدء التسجيل من الاستوديو.';
    await refresh();
  } catch(error) {
    byId('connectionNote').textContent=error.message;
    if(error.code===401){
      if(adminToken){adminToken='';sessionStorage.removeItem('liveverse_admin');showAdminDialog('انتهت صلاحية الرمز. أعد إدخال رمز الإدارة.');}
      else openAccount('login',()=>connectBroadcast());
    }
    else await refresh().catch(()=>{});
  } finally {button.disabled=false;}
}
byId('liveConnectForm').addEventListener('submit',event=>{event.preventDefault();connectBroadcast();});
byId('adminClose').addEventListener('click',()=>byId('adminDialog').close());
byId('adminLoginForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const token=byId('landingAdminToken').value.trim();
  const button=byId('adminSubmit');
  button.disabled=true;
  try {
    await callAdmin('verify',{},token);
    adminToken=token;
    sessionStorage.setItem('liveverse_admin',token);
    byId('landingAdminToken').value='';
    byId('adminDialog').close();
    markAdmin();
    if (dialogIntent==='connect') await connectBroadcast();
    else byId('connectionNote').textContent='تم تفعيل صلاحية المشرف. يمكنك الآن ربط البث أو فتح الاستوديو.';
  } catch(error) {
    byId('landingAuthError').textContent=error.message;
    byId('landingAuthError').hidden=false;
  } finally {button.disabled=false;}
});

/* ---------- Home page: admin entry, site catalogue, live session, hero preview ---------- */
function markAdmin() {
  const button=byId('headerLogin');
  if(!button||!adminToken)return;
  button.textContent='الاستوديو';
  button.dataset.admin='1';
}
byId('footerLogin')?.addEventListener('click',event=>{
  if(event.currentTarget.dataset.admin){location.href='/studio';return;}
  showAdminDialog('','login');
});
byId('headerLogin')?.addEventListener('click',event=>{
  if(event.currentTarget.dataset.admin){location.href='/studio';return;}
  openAccount('login',()=>{location.href='/studio';});
});
byId('footerAccount')?.addEventListener('click',()=>openAccount('login'));
byId('heroTry')?.addEventListener('click',event=>{
  if(hasControl())return; // already has a room: go straight to the studio
  event.preventDefault();
  openAccount('register',()=>{location.href='/studio';});
});
function markAccount() {
  const me=window.SkySession?.me()||{};
  const button=byId('headerLogin');
  if(!button||button.dataset.admin)return;
  if(me.user||me.guest){button.textContent='لوحتي';button.dataset.admin='1';}
}
window.SkySession?.onChange(markAccount);
markAdmin();

const number=n=>Number(n||0).toLocaleString('en-US');
const plural=n=>n===1?'لعبة واحدة':n===2?'لعبتان':(n>=3&&n<=10?n+' ألعاب':n+' لعبة');
function renderGallery(games) {
  const box=byId('gameGallery');
  if(!box||!games.length)return;
  const cards=games.map(game=>{
    const a=document.createElement('a');a.className='sh-cover';a.href=game.href;a.dataset.mode=game.mode;
    const img=document.createElement('img');img.src=game.cover;img.alt='';img.width=180;img.height=180;img.loading='lazy';img.decoding='async';
    const title=document.createElement('span');title.className='sh-cover-title';
    const b=document.createElement('b');b.textContent=game.title;
    const small=document.createElement('small');small.textContent=game.categoryLabel||game.category;
    title.append(b,small);a.append(img,title);a.title=game.summary||game.title;
    return a;
  });
  box.replaceChildren(...cards);
}
function renderPricing(pricing, support) {
  if(!pricing)return;
  byId('priceMonthly').textContent=number(pricing.monthly);
  byId('priceAnnual').textContent=number(pricing.annual);
  document.querySelectorAll('.sh-cur').forEach(el=>{el.textContent=pricing.currency;});
  const saving=byId('priceSaving');
  saving.hidden=!(pricing.annualSaving>0);
  saving.textContent='وفّر '+number(pricing.annualSaving)+' '+pricing.currency;
  for (const id of ['planMonthlyCta','planAnnualCta']) {
    const link=byId(id);
    if(support?.url){link.href=support.url;link.target='_blank';link.rel='noopener';link.removeAttribute('aria-disabled');}
    else {link.href='#start';link.setAttribute('aria-disabled','true');link.textContent='الاشتراك قريبًا';}
  }
  byId('pricingNote').textContent=support?.url
    ? 'يتم التفعيل بعد التواصل عبر: '+support.label+'. الأسعار قابلة للتغيير.'
    : 'الاشتراك يُفعَّل يدويًا حاليًا؛ ستتوفر قناة التواصل قريبًا. الأسعار قابلة للتغيير.';
}
async function loadSite() {
  const response=await fetch('/api/site',{cache:'no-store'});
  if(!response.ok)return;
  const site=await response.json();
  siteGames=Array.isArray(site.games)?site.games:[];
  byId('heroGameCount').textContent=number(site.gameCount);
  byId('heroMaxPlayers').textContent=number(site.maxPlayers);
  if(byId('heroElimCount'))byId('heroElimCount').textContent=number(site.eliminationCount);
  byId('galleryCount').textContent=plural(Number(site.gameCount||0));
  renderGallery(siteGames);
  renderPricing(site.pricing,site.support);
}
/* Covers link straight to each game's join page (/play?mode=…). */
/* Every connected room is listed; the server sorts by players and flags the busiest one. */
const liveTemplate=byId('liveCard');
let streamsTimer=0;
async function loadStreams() {
  clearTimeout(streamsTimer);
  try {
    const response=await fetch('/api/streams',{cache:'no-store'});
    if(response.ok)renderStreams(await response.json());
  } catch { /* keep the previous list */ }
  streamsTimer=setTimeout(loadStreams,document.hidden?30000:10000);
}
function renderStreams(data) {
  const list=Array.isArray(data?.streams)?data.streams:[];
  const box=byId('liveCards'),empty=byId('liveEmpty');
  if(!box||!liveTemplate)return;
  empty.hidden=list.length>0;
  byId('liveSummary').textContent=list.length
    ?(list.length===1?'بث واحد متصل':number(list.length)+' بثوث متصلة')+' • '+number(data.totalPlayers)+' لاعب'
    :'لا يوجد بث متصل الآن';
  const cards=list.slice(0,6).map(stream=>{
    const card=liveTemplate.cloneNode(true);
    card.removeAttribute('id');card.hidden=false;card.classList.add('is-clone');
    card.querySelectorAll('[id]').forEach(el=>{el.dataset.ref=el.id;el.removeAttribute('id');});
    const ref=name=>card.querySelector('[data-ref="'+name+'"]');
    const handle=String(stream.username||'').replace(/^@/,'');
    ref('liveHandle').textContent='@'+handle;
    ref('liveInitial').textContent=(Array.from(handle)[0]||'S').toUpperCase();
    ref('livePlayers').textContent=number(stream.players);
    ref('liveGame').textContent=stream.game||'';
    ref('livePlatformName').textContent=stream.platform==='kick'?'Kick':'TikTok';
    if(typeof stream.cover==='string'&&/^\/covers\/[a-z]+\.svg$/.test(stream.cover))ref('liveCover').src=stream.cover;
    ref('liveOpen').href='/overlay'+(stream.room&&stream.room!=='main'?'?room='+encodeURIComponent(stream.room):'');
    const top=card.querySelector('.sh-top-badge');if(top)top.hidden=!stream.top;
    card.classList.toggle('is-top',!!stream.top);
    return card;
  });
  box.querySelectorAll('.is-clone').forEach(el=>el.remove());
  box.append(...cards);
}
function renderLive() { loadStreams(); }
function renderKeyword(keyword) {
  const word=String(keyword||'انضم').slice(0,32);
  document.querySelectorAll('.sh-keyword').forEach(el=>{el.textContent=word;});
  const float=document.querySelector('.sh-float-b b');
  if(float)float.textContent='«'+word+'»';
}
function heroPreview() {
  const slides=[...document.querySelectorAll('#phoneSlides img')];
  const feed=byId('phoneFeed');
  if(!slides.length||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const demo=[['س','سارا','انضمت للتحدي'],['O','Omar','انضم للتحدي'],['ل','لولو','اختارت الإجابة 1'],['K','Khaled','وصل خط النهاية'],['م','مها','انضمت للتحدي']];
  let i=0,j=0;
  setInterval(()=>{
    if(document.hidden)return;
    slides[i].classList.remove('is-on');i=(i+1)%slides.length;slides[i].classList.add('is-on');
    const [initial,name,action]=demo[j++%demo.length];
    const li=document.createElement('li');
    const av=document.createElement('span');av.className='sh-mini-av';av.textContent=initial;
    const text=document.createElement('span');const b=document.createElement('b');b.textContent=name;text.append(b,' '+action);
    li.append(av,text);feed.append(li);
    while(feed.children.length>3)feed.firstElementChild.remove();
  },3200);
}
heroPreview();
loadSite().catch(()=>{}).finally(loadStreams);

refresh().catch(()=>{byId('connectionNote').textContent='تعذر تحميل حالة البث. حدّث الصفحة للمحاولة مجددًا.';});
socket();
