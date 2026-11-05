/* سبونج لايف — private role page for «الأدوار المخفية».
   The page asks the server for a one-time code; the player writes «دوري <code>» in the stream chat,
   which ties this browser to that viewer. Roles never travel to the public broadcast. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const room = new URLSearchParams(location.search).get('room') || '';
  const q = (p) => p + (room ? (p.includes('?') ? '&' : '?') + 'room=' + encodeURIComponent(room) : '');
  const KEY = 'sponge_role_' + (room || 'main');
  let token = ''; try { token = sessionStorage.getItem(KEY) || ''; } catch {}
  let timer = 0, lastRole = '';
  const HELP = {
    impostor: 'أنت المخادع: في الليل اختر من يخرج، وفي النهار لا تنكشف.',
    detective: 'أنت المحقق: في كل ليلة افحص لاعبًا واحدًا لتعرف إن كان مخادعًا.',
    citizen: 'أنت مواطن: راقب النقاش وصوّت في النهار لإخراج المخادع.',
    insider: 'هذه الكلمة السرية — لمّح لها في الشات بدون ما تقولها، وصوّت على اللي تحس إنه برا السالفة.',
    outsider: 'أنت برا السالفة! ما تعرف الكلمة — اقرأ تلميحاتهم وتظاهر إنك تعرفها، وإذا انكشفت اكتب الكلمة في الشات.'
  };
  const GAME_NAME = { roles: 'الأدوار المخفية — صفحتك الخاصة', outsider: 'برا السالفة — صفحتك الخاصة' };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const say = (m, err) => { $('roleFeedback').textContent = m || ''; $('roleFeedback').classList.toggle('is-error', !!err); };

  async function claim() {
    const res = await fetch(q('/api/role/claim'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { say(data.error || 'لا توجد لعبة أدوار جارية الآن', true); return; }
    token = data.token; try { sessionStorage.setItem(KEY, token); } catch {}
    $('codeText').textContent = 'دوري ' + data.code;
  }
  async function poll() {
    clearTimeout(timer);
    try {
      const res = await fetch(q('/api/role/me'), { headers: { 'X-Role-Token': token }, cache: 'no-store' });
      const v = await res.json();
      if (v.game) $('gameName').textContent = GAME_NAME[v.game] || $('gameName').textContent;
      if (v.idle) { say('لا توجد لعبة أدوار جارية الآن — انتظر المشرف.'); }
      else if (!v.linked) { if (!token || $('codeText').textContent.includes('····')) await claim(); }
      else paint(v);
    } catch { say('انقطع الاتصال… نحاول مجددًا', true); }
    timer = setTimeout(poll, 2500);
  }
  function paint(v) {
    $('linkStep').hidden = true; $('roleStep').hidden = false;
    $('roleName').textContent = v.player.name + ' #' + v.player.number + (v.alive ? '' : ' — خرجت من اللعبة');
    $('roleLabel').textContent = v.roleLabel;
    document.body.dataset.role = v.role;
    $('roleHelp').textContent = HELP[v.role] || '';
    $('roleWord').hidden = !v.category;
    $('roleWord').textContent = v.category ? (v.word ? v.category + ': ' + v.word : 'الفئة: ' + v.category) : '';
    if (lastRole !== v.role) { lastRole = v.role; window.SpongeFx?.play('start'); }
    $('roleMates').hidden = !v.teammates?.length;
    $('roleMates').textContent = v.teammates?.length ? 'زملاؤك المخادعون: ' + v.teammates.map((p) => p.name).join('، ') : '';
    $('roleActions').hidden = !v.canAct;
    $('actionTitle').textContent = v.role === 'impostor' ? 'من يخرج الليلة؟' : 'من تريد فحصه؟';
    $('roleTargets').replaceChildren(...(v.targets || []).map((p) => {
      const b = el('button', 'pl-btn ' + (v.chosen === p.number ? 'pl-btn-gold' : 'pl-btn-ghost'), '#' + p.number + ' ' + p.name);
      b.type = 'button';
      b.addEventListener('click', () => act(p.number));
      return b;
    }));
    $('roleInspected').hidden = !v.inspected?.length;
    $('roleInspected').replaceChildren(...(v.inspected || []).map((p) => el('li', p.suspect ? 'is-bad' : 'is-good', p.name + ': ' + (p.suspect ? 'مخادع!' : 'بريء'))));
    say(v.finished ? 'انتهت اللعبة.' : v.phase === 'night' ? 'الليل الآن.' : v.phase === 'day' || v.phase === 'vote' ? 'التصويت: اكتب في الشات «صوت» ورقم اللاعب.' : v.phase === 'talk' ? 'وقت التلميح في الشات.' : v.phase === 'guess' ? 'فرصة اللي برا السالفة: يكتب الكلمة في الشات.' : '');
  }
  async function act(number) {
    const res = await fetch(q('/api/role/act'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Role-Token': token }, body: JSON.stringify({ number }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) say(data.error || 'تعذر التنفيذ', true); else { say('تم.'); poll(); }
  }
  poll();
})();
