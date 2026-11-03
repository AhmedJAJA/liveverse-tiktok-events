const toggle=document.getElementById('menuToggle');
const nav=document.getElementById('navLinks');
if(toggle&&nav){
  toggle.addEventListener('click',()=>{
    const open=nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',open?'إغلاق القائمة':'فتح القائمة');
  });
  nav.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>{
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-label','فتح القائمة');
  }));
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&nav.classList.contains('open')){
      nav.classList.remove('open');toggle.setAttribute('aria-expanded','false');toggle.focus();
    }
  });
}

function initSmartImages(){
  document.querySelectorAll('img').forEach(img=>{
    const frame=img.closest('.img-skeleton')||img.parentElement;
    const fallback=frame?frame.querySelector('.img-fallback-card'):null;
    const markLoaded=()=>{
      img.classList.add('is-loaded');
      img.classList.remove('is-broken');
      if(frame)frame.classList.remove('img-skeleton','has-img-error');
      if(fallback)fallback.hidden=true;
    };
    const markFallback=()=>{
      console.warn('[Sky Live Media] تعذر تحميل الصورة، تم تفعيل الواجهة البديلة:',img.currentSrc||img.src);
      img.classList.add('is-broken');
      img.hidden=true;
      if(frame){
        frame.classList.remove('img-skeleton');
        frame.classList.add('has-img-error');
      }
      if(fallback){
        fallback.hidden=false;
      }else if(frame&&!frame.querySelector('.brand-mark-fallback')){
        const badge=document.createElement('span');
        badge.className='brand-mark-fallback';
        badge.setAttribute('title','الصورة غير متاحة حاليًا');
        badge.textContent='SL';
        frame.prepend(badge);
      }
    };
    if(img.complete){
      if(img.naturalWidth>0)markLoaded();
      else markFallback();
    }else{
      img.addEventListener('load',markLoaded,{once:true});
      img.addEventListener('error',markFallback,{once:true});
    }
  });
}
initSmartImages();
