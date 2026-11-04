/* SPONGE LIVE — «حسابي». Everything shown here comes from the server; the countdown only re-renders the
   end time the server gave, it never decides access. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const AVATARS = { sponge: '🧽', star: '⭐', crab: '🦀', squid: '🦑', shell: '🐚', fish: '🐠', whale: '🐳', jelly: '🪼' };
  const PLAN_NAMES = { trial: 'التجربة المجانية', weekly: 'شفيق العادي', monthly: 'أمير الهامور', manual: 'اشتراك من الإدارة' };
  const STATUS = { active: ['فعّال', 'is-on'], expired: ['منتهي', 'is-off'], scheduled: ['يبدأ لاحقًا', 'is-warn'], cancelled: ['موقوف', 'is-bad'] };
  const params = new URLSearchParams(location.search);
  const fmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
  const fmtDate = (iso) => (iso ? fmt.format(new Date(iso)) : '—');
  let profile = null, tick = 0;

  const api = async (method, url, body) => {
    const res = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.login) { location.replace('/login?next=/account'); throw new Error('login'); }
    if (!res.ok) throw Object.assign(new Error(data.error || 'تعذر إتمام الطلب'), { data, status: res.status });
    return data;
  };
  const notice = (text, kind = 'is-info') => { const n = $('pageNotice'); n.textContent = text; n.className = 'pg-msg ' + kind; n.hidden = !text; };
  const error = (text) => { $('pageError').textContent = text; $('pageError').hidden = !text; if (text) $('pageError').scrollIntoView({ block: 'nearest' }); };
  const badge = (el, text, cls) => { el.textContent = text; el.className = 'pg-badge ' + cls; };
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

  function render(p) {
    profile = p;
    const u = p.user;
    $('profile').setAttribute('aria-busy', 'false');
    $('displayName').textContent = u.displayName; $('avatarView').textContent = AVATARS[u.avatar] || '🧽';
    $('publicId').textContent = u.publicId; $('username').textContent = u.username; $('email').textContent = u.email;
    $('createdAt').textContent = fmtDate(u.createdAt);
    badge($('emailBadge'), u.verified ? 'مؤكَّد' : 'غير مؤكَّد', u.verified ? 'is-on' : 'is-warn');
    $('verifyRow').hidden = u.verified;
    $('navAdmin').hidden = !u.isAdmin;
    // current access
    const a = p.access;
    badge($('accessBadge'), a.active ? 'فعّال' : 'غير فعّال', a.active ? 'is-on' : 'is-off');
    $('accessPlan').textContent = a.active ? a.planName : 'لا يوجد اشتراك فعّال';
    $('accessEnds').textContent = a.active ? fmtDate(a.endsAt) : '—';
    $('openStudio').hidden = !a.active; $('navStudio').hidden = $('openStudio').hidden;
    // trial
    const t = p.trial;
    $('trialClaim').hidden = !(t.status === 'available'); $('trialActivate').hidden = t.status !== 'ready';
    $('trialCode').hidden = t.status !== 'ready'; $('trialTimes').hidden = !['active', 'expired'].includes(t.status);
    if (t.status === 'ready') { $('trialCodeValue').textContent = t.code; $('trialText').textContent = 'هذا رمز تجربتك الخاص بحسابك. فعّله الآن، أو انسخه وأدخله في نافذة الرمز الترويجي — تبدأ الـ24 ساعة لحظة التفعيل.'; }
    else if (t.status === 'active') { $('trialText').textContent = 'تجربتك المجانية تعمل الآن.'; }
    else if (t.status === 'expired') { $('trialText').textContent = 'انتهت تجربتك المجانية ولا يمكن تفعيلها مرة أخرى. اشترك في باقة لمواصلة استخدام الاستوديو.'; }
    else $('trialText').textContent = u.verified ? 'مرة واحدة لكل حساب. تبدأ الـ24 ساعة من لحظة التفعيل.' : 'أكّد بريدك الإلكتروني أولًا لتحصل على التجربة المجانية.';
    if (t.startedAt) { $('trialStart').textContent = fmtDate(t.startedAt); $('trialEnd').textContent = fmtDate(t.endsAt); }
    $('trialClaim').disabled = !u.verified;
    // billing
    $('billingNote').hidden = p.billing.enabled;
    for (const b of document.querySelectorAll('[data-checkout]')) b.disabled = !p.billing.enabled || !u.verified;
    // linked accounts
    const linked = (x) => (x ? '@' + x.handle + (x.lastConnectedAt ? ' — آخر اتصال ' + fmtDate(x.lastConnectedAt) : ' — لم يكتمل الاتصال') : 'لا يوجد');
    $('linkedTiktok').textContent = linked(p.linked.tiktok); $('linkedKick').textContent = linked(p.linked.kick);
    // history
    const rows = $('historyRows'); rows.replaceChildren();
    if (!p.history.length) { const tr = rows.insertRow(); const td = tr.insertCell(); td.colSpan = 5; td.textContent = 'لا يوجد اشتراكات بعد'; }
    for (const h of p.history) {
      const tr = rows.insertRow();
      for (const v of [h.planName || PLAN_NAMES[h.plan], fmtDate(h.startsAt), fmtDate(h.endsAt), h.price ? h.price + ' ' + (h.currency === 'SAR' ? 'ريال' : h.currency) : 'مجاني']) tr.insertCell().textContent = v;
      const s = STATUS[h.status] || [h.status, 'is-off']; const b = document.createElement('span'); badge(b, s[0], s[1]); tr.insertCell().append(b);
    }
    // edit form
    const f = $('editForm'); if (!f.dataset.ready) {
      f.elements.displayName.value = u.displayName;
      const box = $('avatarChoices');
      for (const [key, emoji] of Object.entries(AVATARS)) {
        const label = document.createElement('label'); const inp = document.createElement('input'); const span = document.createElement('span');
        inp.type = 'radio'; inp.name = 'avatar'; inp.value = key; inp.checked = key === u.avatar; inp.setAttribute('aria-label', key);
        span.textContent = emoji; label.append(inp, span); box.append(label);
      }
      f.dataset.ready = '1';
    }
    countdown();
  }
  function countdown() {
    clearTimeout(tick);
    if (!profile?.access.active) { $('accessLeft').textContent = '—'; return; }
    const left = new Date(profile.access.endsAt).getTime() - Date.now();
    $('accessLeft').textContent = remaining(left);
    if (left <= 0) { load(); return; } // the server decides what happens at expiry
    tick = setTimeout(countdown, document.hidden ? 15000 : 1000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) countdown(); });
  async function load() { try { render(await api('GET', '/api/me/profile')); } catch (e) { if (e.message !== 'login') error(e.message); } }

  async function act(button, fn) {
    if (button.disabled) return; button.disabled = true; error('');
    try { await fn(); } catch (e) { if (e.message !== 'login') error(e.message); } finally { button.disabled = false; }
  }
  $('copyId').addEventListener('click', (e) => copy(profile?.user.publicId || '', e.currentTarget));
  $('copyTrial').addEventListener('click', (e) => copy(profile?.trial.code || '', e.currentTarget));
  $('resendButton').addEventListener('click', (e) => act(e.currentTarget, async () => {
    const r = await api('POST', '/api/auth/resend', {});
    if (r.already) { notice('بريدك مؤكَّد بالفعل.', 'is-ok'); return load(); }
    notice(r.sent ? 'أرسلنا رابط التأكيد إلى بريدك. افتحه خلال 48 ساعة.' : r.devLink ? 'خدمة البريد غير مهيأة (وضع التطوير). رابط التأكيد: ' + r.devLink : 'خدمة البريد غير مهيأة بعد. تواصل مع الدعم مع معرّفك ليُؤكَّد بريدك.', r.sent ? 'is-ok' : 'is-info');
  }));
  $('trialClaim').addEventListener('click', (e) => act(e.currentTarget, async () => { await api('POST', '/api/me/trial-claim', {}); await load(); notice('رمز تجربتك جاهز. فعّله متى ما كنت مستعدًا للبث.', 'is-ok'); }));
  $('trialActivate').addEventListener('click', (e) => act(e.currentTarget, async () => { await api('POST', '/api/me/trial-activate', {}); await load(); notice('تم تفعيل التجربة المجانية — لديك 24 ساعة. افتح الاستوديو وابدأ.', 'is-ok'); }));
  for (const b of document.querySelectorAll('[data-checkout]')) b.addEventListener('click', () => act(b, async () => {
    const r = await api('POST', '/api/me/checkout', { plan: b.dataset.checkout });
    location.assign(r.url); // the gateway's own payment page
  }));
  $('voucherForm').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.currentTarget, m = $('voucherMsg'), code = f.elements.code.value.trim();
    if (!code) { f.elements.code.focus(); return; }
    act(f.querySelector('button'), async () => {
      try {
        const r = await api('POST', '/api/me/redeem', { code });
        m.textContent = `تم تفعيل «${r.voucher.planName}» حتى ${fmtDate(r.voucher.endsAt)} ✓`; m.className = 'pg-msg is-ok'; m.hidden = false; f.reset(); await load();
      } catch (err) { m.textContent = err.message; m.className = 'pg-msg is-err'; m.hidden = false; }
    });
  });
  $('editForm').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.currentTarget, msg = $('editMsg');
    act(f.querySelector('button'), async () => {
      try {
        await api('POST', '/api/me/update', { displayName: f.elements.displayName.value.trim(), avatar: f.elements.avatar.value || undefined });
        msg.textContent = 'تم الحفظ — معرّفك الدائم لم يتغير.'; msg.className = 'pg-msg is-ok'; msg.hidden = false; await load();
      } catch (err) { msg.textContent = err.message; msg.className = 'pg-msg is-err'; msg.hidden = false; }
    });
  });
  $('logoutButton').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}); location.replace('/'); });

  /* messages from the URL */
  if (params.get('verified') === '1') notice('تم تأكيد بريدك الإلكتروني ✓ يمكنك الآن الحصول على التجربة المجانية.', 'is-ok');
  else if (params.get('verified') === '0') notice('رابط التأكيد غير صالح أو منتهي. اطلب رابطًا جديدًا من هذه الصفحة.', 'is-err');
  else if (params.get('need') === 'plan') notice('الاستوديو يحتاج تجربة أو اشتراكًا فعّالًا. فعّل تجربتك المجانية أو اشترك في باقة.');
  else if (params.get('welcome') === '1') notice('أهلًا بك! حسابك جاهز ومعرّفك الدائم ظاهر بالأسفل. أكّد بريدك من الرابط المرسل إليك لتفعيل التجربة المجانية.', 'is-ok');
  const plan = params.get('plan'); if (plan === 'weekly' || plan === 'monthly') $(plan === 'weekly' ? 'planWeekly' : 'planMonthly').scrollIntoView({ block: 'center' });
  /* back from the payment page: ask the server, which asks the gateway — reaching this page proves nothing */
  const paymentId = params.get('payment');
  if (paymentId) {
    notice('نتحقق من عملية الدفع مع بوابة الدفع…');
    let tries = 0;
    const check = async () => {
      try {
        const r = await api('GET', '/api/me/payment?id=' + encodeURIComponent(paymentId));
        if (r.status === 'paid') { notice('تم تأكيد الدفع وتفعيل اشتراكك ✓', 'is-ok'); return load(); }
        if (r.status === 'failed' || r.status === 'expired') { notice('لم تكتمل عملية الدفع، ولم يُفعّل أي اشتراك. يمكنك المحاولة مرة أخرى.', 'is-err'); return; }
      } catch {}
      if (++tries < 10) setTimeout(check, 3000); else notice('لم يصل تأكيد الدفع بعد. سيتفعّل اشتراكك تلقائيًا فور تأكيد البوابة — حدّث الصفحة بعد قليل.');
    };
    check();
  }
  load();
})();
