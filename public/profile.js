/* SPONGE LIVE — public profile (/u/SPG-XXXXXX). The server applies the owner's privacy switches before answering. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const AVATARS = { sponge: '🧽', star: '⭐', crab: '🦀', squid: '🦑', shell: '🐚', fish: '🐠', whale: '🐳', jelly: '🪼' };
  const fmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeZone: 'Asia/Riyadh' });
  const id = location.pathname.split('/').pop();
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const link = (text, href, cls) => { const a = el('a', 'ds-btn ' + cls, text); a.href = href; return a; };
  /** The relation comes from the server for the signed-in visitor; a guest is invited to sign in. Block / report live in «المجتمع». */
  function paintRelation(p) {
    const box = $('rel'), msg = $('relMsg'), community = '/account?find=' + encodeURIComponent(p.publicId) + '#community';
    const button = (text, cls, action, ok) => {
      const b = el('button', 'ds-btn ' + cls, text); b.type = 'button';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const r = await fetch('/api/me/' + action, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.publicId }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || 'تعذر إتمام الطلب');
          msg.textContent = ok; msg.className = 'pg-msg is-ok'; msg.hidden = false; paintRelation({ ...p, relation: d.relation });
        } catch (e) { msg.textContent = e.message; msg.className = 'pg-msg is-err'; msg.hidden = false; b.disabled = false; }
      });
      return b;
    };
    const r = p.relation, items = [];
    if (r === undefined) items.push(link('سجّل الدخول لإضافته صديقًا', '/login?next=' + encodeURIComponent(location.pathname), 'is-blue'));
    else if (r === 'self') items.push(link('إدارة ملفي', '/account#profile', 'is-ghost'));
    else {
      if (r === 'none') items.push(button('إضافة صديق', 'is-blue', 'friend-request', 'أُرسل طلب الصداقة ✓'));
      if (r === 'incoming') items.push(button('قبول طلب الصداقة', 'is-blue', 'friend-accept', 'أصبحتما صديقين ✓'));
      if (r === 'outgoing') items.push(el('span', 'pg-badge is-warn', 'طلبك ينتظر الرد'));
      if (r === 'friends') items.push(el('span', 'pg-badge is-on', 'صديقك ✓'));
      if (r === 'unavailable') items.push(el('span', 'pg-badge is-off', 'لا يستقبل طلبات صداقة'));
      if (r === 'blocked') items.push(el('span', 'pg-badge is-bad', 'حظرت هذا الحساب'));
      items.push(link(r === 'blocked' ? 'إلغاء الحظر من المجتمع' : 'حظر أو إبلاغ', community, 'is-ghost'));
    }
    box.replaceChildren(...items); box.hidden = false;
  }
  fetch('/api/u/' + encodeURIComponent(id), { cache: 'no-store' }).then(async (r) => {
    const p = await r.json();
    $('main').setAttribute('aria-busy', 'false');
    if (!r.ok) { $('pageError').textContent = p.error || 'لا يوجد حساب بهذا المعرف'; $('pageError').hidden = false; return; }
    document.title = p.displayName + ' — SPONGE LIVE';
    $('name').textContent = p.displayName; $('pid').textContent = p.publicId; $('since').textContent = 'عضو منذ ' + fmt.format(new Date(p.memberSince));
    if (p.picture && p.avatar === 'sponge') { const img = document.createElement('img'); img.className = 'pg-avatar-img'; img.alt = ''; img.referrerPolicy = 'no-referrer'; img.src = p.picture; $('avatar').replaceChildren(img); }
    else $('avatar').textContent = AVATARS[p.avatar] || '🧽';
    if (p.friendsCount !== null && p.friendsCount !== undefined) { const n = p.friendsCount; $('friends').textContent = n === 0 ? 'لا أصدقاء بعد' : n === 1 ? 'صديق واحد' : n === 2 ? 'صديقان' : n <= 10 ? n + ' أصدقاء' : n + ' صديقًا'; $('friends').hidden = false; }
    if (p.skin) { $('skinImg').src = p.skin.thumb; $('skinImg').alt = 'شخصية ' + p.displayName + ': ' + p.skin.name; $('skinName').textContent = p.skin.name; $('skinBox').hidden = false; }
    paintRelation(p);
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
