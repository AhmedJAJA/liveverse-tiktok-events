/* SKY LIVE homepage: real session scores, connection state and working studio links. */
const byId = id => document.getElementById(id);
const allowedAvatars = ['tiktokcdn.com','tiktokcdn-us.com','tiktokcdn-eu.com','tiktokcdn-in.com','byteoversea.com','ibytedtos.com','ibyteimg.com','muscdn.com'];
let sessionState = null;
let socketRetry = 0;
let adminToken = sessionStorage.getItem('liveverse_admin') || '';
let dialogIntent = 'connect';
let siteGames = [];
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
  renderLive(state);
  renderKeyword(state.registration?.keyword);
}
async function refresh() {
  const response=await fetch('/api/state',{cache:'no-store'});
  if (!response.ok)throw new Error('تعذر قراءة بيانات البث');
  populate(await response.json());
}
function socket() {
  const proto=location.protocol==='https:'?'wss':'ws';
  const ws=new WebSocket(proto+'://'+location.host+'/ws');
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
async function callAdmin(action, body, token=adminToken) {
  const response=await fetch('/api/admin/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body||{})});
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
  const username=byId('liveUsername').value.trim().replace(/^@/,'');
  if(!/^[\w.]{2,30}$/.test(username)) {
    byId('connectionNote').textContent='أدخل اسم مستخدم TikTok صحيحًا، بدون رابط أو مسافات.';
    byId('liveUsername').focus();
    return;
  }
  if(!adminToken){showAdminDialog();return;}
  const button=byId('liveConnectButton');
  button.disabled=true;
  byId('liveConnectionStatus').textContent='جارٍ الاتصال';
  byId('liveConnectionBadge').classList.add('connecting');
  try {
    await callAdmin('connect',{username});
    byId('connectionNote').textContent='تم ربط البث. يمكنك بدء التسجيل من الاستوديو.';
    await refresh();
  } catch(error) {
    byId('connectionNote').textContent=error.message;
    if(error.code===401){adminToken='';sessionStorage.removeItem('liveverse_admin');showAdminDialog('انتهت صلاحية الرمز. أعد إدخال رمز الإدارة.');}
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
for (const id of ['headerLogin','footerLogin']) byId(id)?.addEventListener('click',event=>{
  if(event.currentTarget.dataset.admin){location.href='/studio';return;}
  showAdminDialog('','login');
});
markAdmin();

const number=n=>Number(n||0).toLocaleString('en-US');
const plural=n=>n===1?'لعبة واحدة':n===2?'لعبتان':(n>=3&&n<=10?n+' ألعاب':n+' لعبة');
function renderGallery(games) {
  const box=byId('gameGallery');
  if(!box||!games.length)return;
  const cards=games.map(game=>{
    const a=document.createElement('a');a.className='sh-cover';a.href=game.href;
    const img=document.createElement('img');img.src=game.cover;img.alt='';img.width=180;img.height=180;img.loading='lazy';img.decoding='async';
    const title=document.createElement('span');title.className='sh-cover-title';
    const b=document.createElement('b');b.textContent=game.title;
    const small=document.createElement('small');small.textContent=game.category;
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
  byId('galleryCount').textContent=plural(Number(site.gameCount||0));
  renderGallery(siteGames);
  renderPricing(site.pricing,site.support);
  if(sessionState)renderLive(sessionState);
}
function renderLive(state) {
  const connected=state.connection?.state==='connected';
  const card=byId('liveCard'),empty=byId('liveEmpty');
  if(!card)return;
  card.hidden=!connected;empty.hidden=connected;
  const players=Number(state.playerCount||0);
  byId('liveSummary').textContent=connected?'بث واحد متصل • '+number(players)+' لاعب':'لا يوجد بث متصل الآن';
  if(!connected)return;
  const handle=String(state.connection.username||'').replace(/^@/,'');
  byId('liveHandle').textContent='@'+handle;
  byId('liveInitial').textContent=(Array.from(handle)[0]||'S').toUpperCase();
  byId('livePlayers').textContent=number(players);
  const game=siteGames.find(g=>g.mode===state.status?.mode);
  byId('liveGame').textContent=game?.title||state.status?.title||'';
  if(game)byId('liveCover').src=game.cover;
}
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
loadSite().catch(()=>{});

refresh().catch(()=>{byId('connectionNote').textContent='تعذر تحميل حالة البث. حدّث الصفحة للمحاولة مجددًا.';});
socket();
