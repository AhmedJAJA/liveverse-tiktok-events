/* SPONGE LIVE — public profile (/u/SPG-XXXXXX). The server applies the owner's privacy switches before answering. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const AVATARS = { sponge: '🧽', star: '⭐', crab: '🦀', squid: '🦑', shell: '🐚', fish: '🐠', whale: '🐳', jelly: '🪼' };
  const fmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeZone: 'Asia/Riyadh' });
  const id = location.pathname.split('/').pop();
  fetch('/api/u/' + encodeURIComponent(id), { cache: 'no-store' }).then(async (r) => {
    const p = await r.json();
    $('main').setAttribute('aria-busy', 'false');
    if (!r.ok) { $('pageError').textContent = p.error || 'لا يوجد حساب بهذا المعرف'; $('pageError').hidden = false; return; }
    document.title = p.displayName + ' — SPONGE LIVE';
    $('name').textContent = p.displayName; $('pid').textContent = p.publicId; $('since').textContent = 'عضو منذ ' + fmt.format(new Date(p.memberSince));
    if (p.picture && p.avatar === 'sponge') { const img = document.createElement('img'); img.className = 'pg-avatar-img'; img.alt = ''; img.referrerPolicy = 'no-referrer'; img.src = p.picture; $('avatar').replaceChildren(img); }
    else $('avatar').textContent = AVATARS[p.avatar] || '🧽';
    $('card').hidden = false;
    if (p.streamer) { $('sSessions').textContent = p.streamer.sessions; $('sPlayers').textContent = p.streamer.playersTotal; $('sGames').textContent = Object.keys(p.streamer.games || {}).length; $('streamer').hidden = false; }
    if (p.linked) {
      $('links').replaceChildren(...(p.linked.length ? p.linked.map((l) => {
        const li = document.createElement('li'), a = document.createElement('a');
        a.href = l.platform === 'kick' ? 'https://kick.com/' + encodeURIComponent(l.handle) : 'https://www.tiktok.com/@' + encodeURIComponent(l.handle);
        a.target = '_blank'; a.rel = 'noopener noreferrer'; a.className = 'ds-chip'; a.textContent = (l.platform === 'kick' ? 'Kick' : 'TikTok') + ' — @' + l.handle;
        li.append(a); return li;
      }) : [Object.assign(document.createElement('li'), { className: 'ds-empty', textContent: 'لا توجد حسابات موثقة' })]));
      $('linked').hidden = false;
    }
    if (p.player) $('player').hidden = false;
  }).catch(() => { $('pageError').textContent = 'تعذر تحميل الملف'; $('pageError').hidden = false; });
})();
