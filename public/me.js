/* SPONGE LIVE — account dashboard («لوحة التحكم»). Everything shown comes from the server; the page never decides
   access, plans, ownership or privacy — it only asks and shows the answer. Sections switch without reloading. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const AVATARS = { sponge: '🧽', star: '⭐', crab: '🦀', squid: '🦑', shell: '🐚', fish: '🐠', whale: '🐳', jelly: '🪼' };
  const PLAN_NAMES = { trial: 'التجربة المجانية', weekly: 'شفيق العادي', monthly: 'أمير الهامور', manual: 'اشتراك من الإدارة' };
  const STATUS = { active: ['فعّال', 'is-on'], expired: ['منتهي', 'is-off'], scheduled: ['يبدأ لاحقًا', 'is-warn'], cancelled: ['موقوف', 'is-bad'] };
  const PAY = { paid: ['مدفوعة ✓', 'is-on'], pending: ['بانتظار التأكيد', 'is-warn'], failed: ['فشلت', 'is-bad'], expired: ['منتهية', 'is-off'], refunded: ['مستردة', 'is-off'] };
  const SOURCE = { trial: 'تجربة مجانية', voucher: 'كود اشتراك', payment: 'دفع إلكتروني', admin: 'الإدارة', manual: 'الإدارة' };
  const SECTIONS = ['settings', 'profile', 'bag', 'billing', 'community', 'challenge'];
  const params = new URLSearchParams(location.search);
  const fmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' });
  const fmtDate = (iso) => (iso ? fmt.format(new Date(iso)) : '—');
  let profile = null, tick = 0;

  /* ---------- helpers ---------- */
  const api = async (method, url, body) => {
    const res = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.login) { location.replace('/login?next=/account'); throw new Error('login'); }
    if (!res.ok) throw Object.assign(new Error(data.error || 'تعذر إتمام الطلب'), { data, status: res.status });
    return data;
  };
  const notice = (text, kind = 'is-info') => { const n = $('pageNotice'); n.textContent = text; n.className = 'pg-msg ' + kind; n.hidden = !text; };
  const error = (text) => { $('pageError').textContent = text; $('pageError').hidden = !text; if (text) $('pageError').scrollIntoView({ block: 'nearest' }); };
  const say = (el, text, kind) => { el.textContent = text; el.className = 'pg-msg ' + kind; el.hidden = !text; };
  const badge = (el, text, cls) => { el.textContent = text; el.className = 'pg-badge ' + cls; };
  let toastTimer = 0;
  function toast(text, bad = false) { const t = $('toast'); t.textContent = text; t.classList.toggle('is-err', bad); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600); }
  function remaining(ms) {
    if (ms <= 0) return '00:00:00';
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const hms = [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
    return d ? `${d} يوم ${hms}` : hms;
  }
  async function copy(text, button) {
    try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
    const old = button.textContent; button.textContent = 'تم النسخ ✓'; setTimeout(() => (button.textContent = old), 1500);
  }
  /** One click = one request: the button is locked and shows a spinner until the server answers. */
  async function act(button, fn) {
    if (!button || button.disabled) return; button.disabled = true; button.classList.add('is-busy'); error('');
    try { await fn(); } catch (e) { if (e.message !== 'login') toast(e.message, true); } finally { button.disabled = false; button.classList.remove('is-busy'); }
  }
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

  /* ---------- sections (hash routing, no reload) ---------- */
  function show(sec) {
    if (!SECTIONS.includes(sec)) sec = 'settings';
    document.body.dataset.sec = sec;
    for (const s of document.querySelectorAll('.ds-sec')) s.hidden = s.dataset.sec !== sec;
    const navSec = sec === 'billing' ? 'settings' : sec;
    for (const a of document.querySelectorAll('.ds-nav a[data-sec]')) { if (a.dataset.sec === navSec) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    closeMenu();
    if (sec === 'settings') loadSessions();
  }
  addEventListener('hashchange', () => { const h = location.hash.slice(1); if (SECTIONS.includes(h)) { show(h); scrollTo({ top: 0 }); } else if (document.getElementById(h)) { show('settings'); document.getElementById(h).scrollIntoView({ block: 'start' }); } });
  function initialSection() {
    const h = location.hash.slice(1);
    if (SECTIONS.includes(h)) return show(h);
    show('settings');
    if (h === 'trial' || h === 'plans') requestAnimationFrame(() => $('subCard').scrollIntoView({ block: 'start' }));
    else if (h && document.getElementById(h)) requestAnimationFrame(() => document.getElementById(h).scrollIntoView({ block: 'start' }));
  }
  function openMenu() { document.body.classList.add('is-menu'); $('scrim').hidden = false; $('sideOpen').setAttribute('aria-expanded', 'true'); }
  function closeMenu() { document.body.classList.remove('is-menu'); $('scrim').hidden = true; $('sideOpen').setAttribute('aria-expanded', 'false'); }
  $('sideOpen').addEventListener('click', openMenu); $('sideClose').addEventListener('click', closeMenu); $('scrim').addEventListener('click', closeMenu);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  /* ---------- render ---------- */
  function render(p) {
    profile = p;
    const u = p.user, a = p.access;
    $('main').setAttribute('aria-busy', 'false');
    $('navAdmin').hidden = !u.isAdmin; $('navStudio').hidden = !a.active;
    // profile
    $('displayName').textContent = u.displayName;
    if (u.picture && u.avatar === 'sponge') { const img = el('img', 'pg-avatar-img'); img.src = u.picture; img.alt = ''; img.width = 72; img.height = 72; img.referrerPolicy = 'no-referrer'; $('avatarView').replaceChildren(img); }
    else $('avatarView').textContent = AVATARS[u.avatar] || '🧽';
    $('publicId').textContent = u.publicId; $('username').textContent = u.username; $('profEmail').textContent = u.email;
    $('createdAt').textContent = fmtDate(u.createdAt); $('lastLogin').textContent = fmtDate(u.lastLoginAt);
    $('profPlan').textContent = a.active ? a.planName : 'لا يوجد اشتراك فعّال';
    for (const id of ['publicLink', 'publicLink2']) $(id).href = '/u/' + u.publicId;
    const st = p.streamer || {};
    $('statSessions').textContent = String(st.sessions || 0); $('statPlayers').textContent = String(st.playersTotal || 0); $('statGames').textContent = String(Object.keys(st.games || {}).length);
    // email & password
    $('email').textContent = u.email;
    badge($('emailBadge'), u.verified ? 'موثّق' : 'غير موثّق', u.verified ? 'is-on' : 'is-warn');
    $('resendButton').hidden = u.verified;
    $('pwText').textContent = u.hasPassword ? 'مُعيّنة — يمكنك تغييرها بعد تأكيد هويتك' : u.googleLinked ? 'تم تسجيل دخولك باستخدام Google. يمكنك إضافة كلمة مرور لحسابك بعد التحقق من هويتك.' : 'غير مُعيّنة';
    $('pwButton').textContent = u.hasPassword ? 'تغيير كلمة المرور' : 'التحقق عبر Google لإضافة كلمة مرور';
    $('pwButton').hidden = !u.hasPassword && !u.googleLinked;
    // methods
    $('methodPw').textContent = u.hasPassword ? 'مُفعّلة' : 'غير مُعيّنة';
    badge($('methodPwBadge'), u.hasPassword ? 'متاحة' : 'لا يوجد', u.hasPassword ? 'is-on' : 'is-off');
    $('methodGoogle').textContent = u.googleLinked ? 'مرتبط بحسابك' : 'غير مرتبط';
    badge($('methodGoogleBadge'), u.googleLinked ? 'مرتبط' : 'غير مرتبط', u.googleLinked ? 'is-on' : 'is-off');
    $('googleUnlink').hidden = !u.googleLinked;
    $('googleUnlink').disabled = !u.hasPassword;
    $('googleUnlink').title = u.hasPassword ? '' : 'أضف كلمة مرور أولًا — لا يمكن إزالة آخر وسيلة دخول';
    if (!u.googleLinked && !googleMounted) mountGoogleLink(); else if (u.googleLinked) $('googleLinkWrap').hidden = true;
    // subscription
    paintPlan(p);
    // platforms
    for (const card of document.querySelectorAll('.ds-plat[data-platform="tiktok"],.ds-plat[data-platform="kick"]')) paintPlatform(card, p.linked[card.dataset.platform], a.active, !!p.platforms?.[card.dataset.platform]);
    // privacy
    for (const t of document.querySelectorAll('#toggles input[data-key]')) t.checked = !!p.privacy?.[t.dataset.key];
    // bag + billing
    paintHistory(p.history); paintPayments(p.payments);
    for (const b of document.querySelectorAll('[data-checkout]')) b.hidden = !p.billing.enabled;
    if (p.billing.enabled) $('billingHow').textContent = 'ادفع إلكترونيًا عبر بوابة الدفع، أو اطلب عبر واتساب واستلم كود اشتراك تفعّله في الإعدادات.';
    const t = p.trial;
    badge($('trialState'), ({ active: 'تعمل الآن', expired: 'استُخدمت', available: 'متاحة لك', ready: 'متاحة لك' })[t.status] || 'غير متاحة', t.status === 'active' ? 'is-on' : ['available', 'ready'].includes(t.status) ? 'is-warn' : 'is-off');
    // edit form
    const f = $('editForm'); if (!f.dataset.ready) {
      f.elements.displayName.value = u.displayName;
      for (const [key, emoji] of Object.entries(AVATARS)) {
        const label = el('label'), inp = el('input'), span = el('span', '', emoji);
        inp.type = 'radio'; inp.name = 'avatar'; inp.value = key; inp.checked = key === u.avatar; inp.setAttribute('aria-label', key);
        label.append(inp, span); $('avatarChoices').append(label);
      }
      f.dataset.ready = '1';
    }
    countdown();
  }
  function paintPlan(p) {
    const a = p.access, t = p.trial;
    const current = (p.history || []).find((h) => h.status === 'active');
    $('planName').textContent = a.active ? a.planName : 'لا يوجد اشتراك فعّال';
    badge($('planBadge'), a.active ? 'فعّال' : 'غير فعّال', a.active ? 'is-on' : 'is-off');
    $('planStart').textContent = current ? fmtDate(current.startsAt) : '—';
    $('planEnd').textContent = a.active ? fmtDate(a.endsAt) : '—';
    const paid = (p.history || []).some((h) => ['weekly', 'monthly'].includes(h.plan));
    $('planEmpty').hidden = paid || a.active;
    $('planEmpty').textContent = t.status === 'expired' ? 'انتهت تجربتك المجانية. اختر باقة «شفيق العادي» أو «أمير الهامور» لمواصلة البث.' : 'لا توجد باقات مدفوعة بعد. ابدأ تجربتك المجانية أو اختر باقة.';
    $('trialStart').hidden = !['available', 'ready'].includes(t.status) || a.active;
    $('trialStart').disabled = !!(p.trialNeedsVerifiedEmail && !p.user.verified);
  }
  function paintHistory(list) {
    const rows = $('historyRows'); rows.replaceChildren();
    if (!list.length) { const td = rows.insertRow().insertCell(); td.colSpan = 6; td.className = 'ds-empty'; td.textContent = 'لا توجد اشتراكات بعد'; return; }
    for (const h of list) {
      const tr = rows.insertRow();
      for (const v of [h.planName || PLAN_NAMES[h.plan], SOURCE[h.source] || h.source || '—', fmtDate(h.startsAt), fmtDate(h.endsAt), h.price ? h.price + ' ريال' : 'مجاني']) tr.insertCell().textContent = v;
      const s = STATUS[h.status] || [h.status, 'is-off']; const b = el('span'); badge(b, s[0], s[1]); tr.insertCell().append(b);
    }
  }
  function paintPayments(list) {
    const rows = $('paymentRows'); rows.replaceChildren();
    if (!list.length) { const td = rows.insertRow().insertCell(); td.colSpan = 4; td.className = 'ds-empty'; td.textContent = 'لا توجد عمليات دفع إلكتروني بعد. الاشتراكات المفعّلة بكود تظهر في «حقيبتي».'; return; }
    for (const x of list) {
      const tr = rows.insertRow();
      for (const v of [fmtDate(x.createdAt), PLAN_NAMES[x.plan] || x.plan, x.amount + ' ' + (x.currency === 'SAR' ? 'ريال' : x.currency)]) tr.insertCell().textContent = v;
      const s = PAY[x.status] || [x.status, 'is-off']; const b = el('span'); badge(b, s[0], s[1]); tr.insertCell().append(b);
    }
  }
  function countdown() {
    clearTimeout(tick);
    if (!profile?.access.active) { $('planLeft').textContent = '—'; return; }
    const left = new Date(profile.access.endsAt).getTime() - Date.now();
    $('planLeft').textContent = remaining(left);
    if (left <= 0) { load(); return; } // the server decides what happens at expiry
    tick = setTimeout(countdown, document.hidden ? 15000 : 1000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) countdown(); });
  async function load() { try { render(await api('GET', '/api/me/profile')); } catch (e) { if (e.message !== 'login') error(e.message); } }

  /* ---------- redeem ---------- */
  $('voucherForm').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.currentTarget, m = $('voucherMsg'), code = f.elements.code.value.trim();
    if (!code) { f.elements.code.focus(); return; }
    act(f.querySelector('button'), async () => {
      try {
        const r = await api('POST', '/api/me/redeem', { code });
        say(m, `تم تفعيل «${r.voucher.planName}» حتى ${fmtDate(r.voucher.endsAt)} ✓`, 'is-ok'); f.reset(); await load();
      } catch (err) { say(m, err.message, 'is-err'); }
    });
  });

  /* ---------- platforms: linked only by signing in with the platform (official OAuth), never by a typed name ---------- */
  const NAMES = { tiktok: 'TikTok', kick: 'Kick' };
  function paintPlatform(card, link, active, offered) {
    const q = (r) => card.querySelector(`[data-role="${r}"]`), name = NAMES[card.dataset.platform];
    const linked = !!link?.verified, stale = linked && link.needsReauth;
    badge(q('badge'), stale ? 'يحتاج إعادة ربط' : linked ? 'مرتبط ✓' : 'غير مرتبط', stale ? 'is-warn' : linked ? 'is-on' : 'is-off');
    q('linked').hidden = !linked; q('unlink').hidden = !linked;
    const sign = q('signin'), why = q('why');
    sign.hidden = linked && !stale;
    sign.querySelector('span').textContent = stale ? 'إعادة الربط باستخدام ' + name : 'المتابعة باستخدام ' + name;
    const blocked = !offered ? 'ربط ' + name + ' غير مفعّل على الموقع بعد — يحتاج إعداد تطبيق ' + name + ' الرسمي من مالك الموقع.' : !active ? 'تحتاج إلى اشتراك فعال أو تجربتك المجانية لربط حسابك.' : '';
    sign.classList.toggle('is-disabled', !!blocked); sign.setAttribute('aria-disabled', String(!!blocked));
    why.hidden = !blocked || (linked && !stale); why.textContent = blocked;
    if (linked) {
      q('handle').textContent = (link.displayName ? link.displayName + ' · ' : '') + '@' + link.handle;
      q('avaLetter').textContent = (link.handle[0] || '?').toUpperCase();
      q('ava').querySelector('img')?.remove();
      if (link.avatar && /^https:\/\//.test(link.avatar)) { const img = el('img'); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.decoding = 'async'; img.addEventListener('error', () => img.remove(), { once: true }); img.src = link.avatar; q('ava').append(img); }
      q('since').textContent = 'مرتبط رسميًا منذ ' + fmtDate(link.verifiedAt);
      q('text').textContent = stale ? 'انتهى تفويض ' + name + ' — أعد الربط لتتمكن من الاتصال ببثك.' : 'حسابك مرتبط — اختر ' + name + ' عند بدء جلستك في الاستوديو دون كتابة أي اسم.';
    } else q('text').textContent = 'سجّل الدخول إلى ' + name + ' ووافق على الصلاحيات مرة واحدة، ثم ابدأ جلساتك من الاستوديو.';
  }
  for (const card of document.querySelectorAll('.ds-plat[data-platform="tiktok"],.ds-plat[data-platform="kick"]')) {
    const platform = card.dataset.platform, q = (r) => card.querySelector(`[data-role="${r}"]`);
    q('signin').addEventListener('click', (e) => { if (q('signin').classList.contains('is-disabled')) e.preventDefault(); else q('signin').classList.add('is-busy'); });
    q('unlink').addEventListener('click', (e) => {
      const b = e.currentTarget, label = 'إلغاء ربط ' + NAMES[platform];
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'اضغط مرة أخرى لتأكيد إلغاء الربط'; setTimeout(() => { b.dataset.confirm = ''; b.textContent = label; }, 4000); return; }
      act(b, async () => { try { await api('POST', '/api/me/stream-unlink', { platform }); toast('أُلغي ربط ' + NAMES[platform] + ' وأُوقف الاتصال ببثه'); b.dataset.confirm = ''; b.textContent = label; await load(); } catch (err) { toast(err.message, true); } });
    });
  }

  /* ---------- re-authentication for sensitive changes ---------- */
  let pending = null;
  async function needIdentity(title, then) {
    try { const s = await api('GET', '/api/me/sessions'); if (s.reauthed) return then(); } catch {}
    pending = then;
    const u = profile.user;
    $('reauth').hidden = false; $('reauthTitle').textContent = title; $('reauthMsg').hidden = true;
    $('reauthForm').hidden = !u.hasPassword; $('reauthGoogleWrap').hidden = !u.googleLinked;
    if (u.googleLinked) mountReauthGoogle();
    if (u.hasPassword) $('reauthPw').focus();
    $('reauth').scrollIntoView({ block: 'nearest' });
  }
  function reauthDone() { $('reauth').hidden = true; $('reauthPw').value = ''; const f = pending; pending = null; f?.(); }
  $('reauthForm').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.currentTarget.querySelector('button'), async () => {
      try { await api('POST', '/api/me/reauth', { password: $('reauthPw').value }); reauthDone(); }
      catch (err) { say($('reauthMsg'), err.message, 'is-err'); }
    });
  });
  $('reauthCancel').addEventListener('click', () => { pending = null; $('reauth').hidden = true; });
  let reauthMounted = false;
  function mountReauthGoogle() {
    if (reauthMounted || !window.SpongeGoogle) return; reauthMounted = true;
    window.SpongeGoogle.render($('reauthGoogle'), async (credential) => {
      try { await api('POST', '/api/me/reauth', { credential }); reauthDone(); }
      catch (err) { say($('reauthMsg'), err.message, 'is-err'); }
    }, { text: 'continue_with' }).then((shown) => { if (!shown) $('reauthGoogleWrap').hidden = true; });
  }

  /* ---------- e-mail & password ---------- */
  const openForm = (id) => { for (const f of ['emailForm', 'pwForm']) $(f).hidden = f !== id; $(id).querySelector('input').focus(); };
  for (const f of ['emailForm', 'pwForm']) $(f).querySelector('[data-cancel]').addEventListener('click', () => { $(f).hidden = true; $(f).reset(); });
  $('emailChange').addEventListener('click', () => needIdentity('أكّد هويتك لتغيير البريد', () => openForm('emailForm')));
  $('pwButton').addEventListener('click', () => needIdentity(profile.user.hasPassword ? 'أكّد هويتك لتغيير كلمة المرور' : 'تحقق عبر Google لإضافة كلمة مرور', () => openForm('pwForm')));
  $('emailForm').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.currentTarget;
    act(f.querySelector('button[type=submit]'), async () => {
      try { const r = await api('POST', '/api/me/email', { email: f.elements.email.value.trim() }); f.hidden = true; f.reset(); say($('loginMsg'), r.sent ? 'تم تغيير البريد ✓ أرسلنا رابط توثيق إلى بريدك الجديد.' : 'تم تغيير البريد ✓ البريد الجديد غير موثّق حتى يُؤكَّد.', 'is-ok'); await load(); }
      catch (err) { if (err.data?.reauth) needIdentity('انتهت مهلة التأكيد — أكّد هويتك مرة أخرى', () => openForm('emailForm')); else say($('loginMsg'), err.message, 'is-err'); }
    });
  });
  $('pwForm').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.currentTarget;
    act(f.querySelector('button[type=submit]'), async () => {
      try { await api('POST', '/api/me/password', { password: f.elements.password.value, confirm: f.elements.confirm.value }); f.hidden = true; f.reset(); say($('loginMsg'), 'تم حفظ كلمة المرور ✓ سُجّل خروج أجهزتك الأخرى.', 'is-ok'); await load(); loadSessions(); }
      catch (err) { if (err.data?.reauth) needIdentity('انتهت مهلة التأكيد — أكّد هويتك مرة أخرى', () => openForm('pwForm')); else say($('loginMsg'), err.message, 'is-err'); }
    });
  });
  $('resendButton').addEventListener('click', (e) => act(e.currentTarget, async () => {
    try {
      const r = await api('POST', '/api/auth/resend', {});
      if (r.already) { toast('بريدك موثّق بالفعل'); return load(); }
      say($('loginMsg'), r.sent ? 'أرسلنا رابط التوثيق إلى بريدك. افتحه خلال 48 ساعة.' : 'خدمة البريد غير مهيأة بعد. تواصل مع الدعم مع معرّفك ليُوثَّق بريدك.', r.sent ? 'is-ok' : 'is-info');
    } catch (err) { say($('loginMsg'), err.message, 'is-err'); }
  }));

  /* ---------- subscription ---------- */
  $('subRefresh').addEventListener('click', (e) => act(e.currentTarget, async () => { await load(); toast('تم التحديث'); }));
  $('trialStart').addEventListener('click', (e) => act(e.currentTarget, async () => {
    try {
      const r = await api('POST', '/api/me/trial-start', {});
      await load();
      if (r.started) { notice('تم تفعيل تجربتك المجانية بنجاح ✓', 'is-ok'); toast('بدأت تجربتك المجانية — 24 ساعة'); }
    } catch (err) { error(err.message); }
  }));
  for (const b of document.querySelectorAll('[data-checkout]')) b.addEventListener('click', () => act(b, async () => {
    try { const r = await api('POST', '/api/me/checkout', { plan: b.dataset.checkout }); location.assign(r.url); } catch (err) { error(err.message); }
  }));

  /* ---------- privacy: each switch is saved on the server, then confirmed ---------- */
  for (const t of document.querySelectorAll('#toggles input[data-key]')) t.addEventListener('change', async () => {
    const row = t.closest('.ds-toggle'); row.classList.add('is-saving'); t.disabled = true;
    try { const r = await api('POST', '/api/me/privacy', { key: t.dataset.key, value: t.checked }); profile.privacy = r.privacy; t.checked = !!r.privacy[t.dataset.key]; toast('تم حفظ الإعداد ✓'); }
    catch (err) { t.checked = !t.checked; toast(err.message, true); }
    finally { row.classList.remove('is-saving'); t.disabled = false; }
  });

  /* ---------- security: sessions & sign-in methods ---------- */
  let sessionsLoading = false;
  async function loadSessions() {
    if (sessionsLoading || !$('sessionList')) return; sessionsLoading = true;
    try {
      const r = await api('GET', '/api/me/sessions');
      const list = $('sessionList');
      list.replaceChildren(...r.sessions.map((x) => {
        const li = el('li', x.current ? 'is-current' : '');
        const info = el('div'); info.append(el('b', '', (x.device || 'جهاز') + (x.current ? ' — هذا الجهاز' : '')), el('small', '', 'آخر استخدام ' + fmtDate(x.lastSeenAt) + (x.remember ? ' • تذكرني 30 يومًا' : ' • حتى إغلاق المتصفح')));
        li.append(info);
        if (!x.current) { const b = el('button', 'ds-btn is-ghost is-danger', 'إنهاء'); b.type = 'button'; b.addEventListener('click', () => act(b, async () => { await api('POST', '/api/me/sessions-revoke', { id: x.id }); toast('أُنهيت الجلسة'); loadSessions(); })); li.append(b); }
        return li;
      }));
      if (!r.sessions.length) list.replaceChildren(el('li', 'ds-empty', 'لا توجد جلسات'));
      $('signOutOthers').disabled = r.sessions.filter((x) => !x.current).length === 0;
    } catch {} finally { sessionsLoading = false; }
  }
  $('signOutOthers').addEventListener('click', (e) => act(e.currentTarget, async () => {
    const r = await api('POST', '/api/me/sessions-revoke', { others: true });
    say($('securityMsg'), r.removed ? 'سُجّل خروج ' + r.removed + ' من الأجهزة الأخرى ✓' : 'لا توجد أجهزة أخرى.', 'is-ok'); loadSessions();
  }));
  $('googleUnlink').addEventListener('click', () => needIdentity('أكّد هويتك لإزالة ربط Google', async () => {
    try { await api('POST', '/api/me/google-unlink', {}); say($('securityMsg'), 'أُزيل ربط Google ✓ ادخل بكلمة المرور من الآن.', 'is-ok'); googleMounted = false; await load(); }
    catch (err) { say($('securityMsg'), err.message, 'is-err'); }
  }));
  let googleMounted = false;
  function mountGoogleLink() {
    googleMounted = true;
    if (!window.SpongeGoogle) return;
    window.SpongeGoogle.render($('googleBox'), async (credential) => {
      try { await window.SpongeGoogle.signIn(credential, { link: true }); say($('securityMsg'), 'تم ربط Google ✓ معرّفك الدائم لم يتغير.', 'is-ok'); reauthMounted = false; await load(); }
      catch (err) { say($('securityMsg'), err.message, 'is-err'); }
    }, { text: 'continue_with' }).then((shown) => { $('googleLinkWrap').hidden = !shown; });
  }

  /* ---------- profile ---------- */
  $('copyId').addEventListener('click', (e) => copy(profile?.user.publicId || '', e.currentTarget));
  $('editForm').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.currentTarget;
    act(f.querySelector('button'), async () => {
      try { await api('POST', '/api/me/update', { displayName: f.elements.displayName.value.trim(), avatar: f.elements.avatar.value || undefined }); say($('editMsg'), 'تم الحفظ — معرّفك الدائم لم يتغير.', 'is-ok'); await load(); }
      catch (err) { say($('editMsg'), err.message, 'is-err'); }
    });
  });
  $('logoutButton').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}); location.replace('/'); });

  /* ---------- messages from the URL ---------- */
  const LINK_ERRORS = { denied: 'أُلغي التفويض — لم يُربط أي حساب.', state: 'انتهت صلاحية طلب الربط أو فُتح في متصفح آخر. حاول مرة أخرى.', plan: 'تحتاج إلى اشتراك فعال لربط بثك المباشر.', unavailable: 'هذا الربط غير مفعّل على الموقع بعد.', network: 'تعذر الوصول إلى المنصة. حاول بعد قليل.', failed: 'تعذر إكمال الربط مع المنصة. حاول مرة أخرى.', busy: 'الخادم مشغول، حاول بعد قليل.' };
  if (params.get('linked')) notice('تم ربط ' + (params.get('linked') === 'kick' ? 'Kick' : 'TikTok') + ' رسميًا ✓', 'is-ok');
  else if (params.get('link_error')) notice(LINK_ERRORS[params.get('link_error')] || LINK_ERRORS.failed, 'is-err');
  if (params.get('linked') || params.get('link_error')) history.replaceState(null, '', '/account#settings');
  if (params.get('verified') === '1') notice('تم توثيق بريدك الإلكتروني ✓', 'is-ok');
  else if (params.get('verified') === '0') notice('رابط التوثيق غير صالح أو منتهي. اطلب رابطًا جديدًا من «البريد وكلمة المرور».', 'is-err');
  else if (params.get('verify') === 'trial') notice('لتفعيل التجربة المجانية وثّق بريدك الإلكتروني أو اربط حساب Google.');
  else if (params.get('need') === 'plan') notice('الاستوديو يحتاج تجربة أو اشتراكًا فعّالًا. فعّل تجربتك المجانية أو اشترك في باقة.');
  else if (params.get('welcome') === '1') notice('أهلًا بك! حسابك جاهز ومعرّفك الدائم في «ملفي».', 'is-ok');
  const paymentId = params.get('payment');
  if (paymentId) {
    notice('نتحقق من عملية الدفع مع بوابة الدفع…');
    let tries = 0;
    const check = async () => {
      try {
        const r = await api('GET', '/api/me/payment?id=' + encodeURIComponent(paymentId));
        if (r.status === 'paid') { notice('تم تأكيد الدفع وتفعيل اشتراكك ✓', 'is-ok'); return load(); }
        if (r.status === 'failed' || r.status === 'expired') { notice('لم تكتمل عملية الدفع، ولم يُفعّل أي اشتراك.', 'is-err'); return; }
      } catch {}
      if (++tries < 10) setTimeout(check, 3000); else notice('لم يصل تأكيد الدفع بعد. سيتفعّل اشتراكك تلقائيًا فور تأكيد البوابة.');
    };
    check();
  }
  initialSection();
  load();
})();
