/* SPONGE LIVE — admin panel. Every action is checked and logged on the server (/api/manage/*). */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
  const fmtDate = (iso) => (iso ? fmt.format(new Date(iso)) : '—');
  const ACTIONS = { 'subscription-grant': 'منح اشتراك', 'subscription-extend': 'تمديد اشتراك', 'subscription-stop': 'إيقاف اشتراك', 'email-verify-manual': 'تأكيد بريد يدويًا', 'account-disable': 'إيقاف حساب', 'account-enable': 'إعادة تفعيل حساب', 'trial-code-revoke': 'إلغاء رمز تجربة', 'promo-create': 'إنشاء رمز', 'promo-revoke': 'إلغاء رمز', 'promo-update': 'تعديل رمز', 'promo-delete': 'حذف رمز' };
  const STATUS = { active: 'فعّال', expired: 'منتهي', scheduled: 'لاحقًا', cancelled: 'موقوف', disabled: 'ملغى', used: 'مستخدم' };
  let current = null;
  const api = async (method, url, body) => {
    const res = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'تعذر إتمام الطلب');
    return data;
  };
  const err = (t) => { $('pageError').textContent = t; $('pageError').hidden = !t; };
  const msg = (t, ok = true) => { const m = $('userMsg'); m.textContent = t; m.className = 'pg-msg ' + (ok ? 'is-ok' : 'is-err'); m.hidden = !t; };
  const row = (tbody, cells) => { const tr = tbody.insertRow(); for (const c of cells) { const td = tr.insertCell(); if (c instanceof Node) td.append(c); else td.textContent = c ?? '—'; } return tr; };
  const button = (text, fn, danger) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'pg-btn2' + (danger ? ' is-danger' : ''); b.textContent = text; b.addEventListener('click', fn); return b; };

  async function users(q = '') {
    try {
      const d = await api('GET', '/api/manage/users?q=' + encodeURIComponent(q));
      $('stats').textContent = `الحسابات: ${d.stats.users} · المؤكَّدة: ${d.stats.verified} · اشتراكات مدفوعة فعّالة: ${d.stats.paid} · تجارب فعّالة: ${d.stats.trials}`;
      const tb = $('userRows'); tb.replaceChildren();
      if (!d.users.length) row(tb, ['لا نتائج']);
      for (const u of d.users) row(tb, [u.publicId, u.username + (u.disabled ? ' (موقوف)' : ''), u.email, u.access.active ? u.access.planName : 'لا يوجد', fmtDate(u.access.endsAt), button('فتح', () => open(u.publicId))]);
    } catch (e) { err(e.message); }
  }
  async function open(publicId) {
    try {
      const d = await api('GET', '/api/manage/user?id=' + encodeURIComponent(publicId));
      current = d.user.publicId;
      $('userPanel').hidden = false; $('userTitle').textContent = 'الحساب ' + d.user.publicId;
      const dl = $('userInfo'); dl.replaceChildren();
      const add = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); };
      add('المستخدم', d.user.username + ' — ' + d.user.displayName); add('البريد', d.user.email + (d.user.verified ? ' (مؤكَّد)' : ' (غير مؤكَّد)'));
      add('أُنشئ', fmtDate(d.user.createdAt)); add('الاشتراك الحالي', d.access.active ? d.access.planName + ' حتى ' + fmtDate(d.access.endsAt) : 'لا يوجد');
      add('التجربة', { available: 'لم تُستخدم', ready: 'رمز جاهز غير مفعّل', active: 'فعّالة', expired: 'انتهت' }[d.trial.status] || d.trial.status);
      $('verifyButton').hidden = d.user.verified;
      const tb = $('userSubs'); tb.replaceChildren();
      for (const h of d.history) row(tb, [h.planName, fmtDate(h.startsAt), fmtDate(h.endsAt), { trial: 'تجربة', payment: 'دفع', admin: 'الإدارة' }[h.source] || h.source, STATUS[h.status] || h.status]);
      msg(''); $('userPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { err(e.message); }
  }
  const userAction = (path, body, done) => async () => {
    if (!current) return;
    try { await api('POST', '/api/manage/' + path, { publicId: current, ...body }); msg(done); await open(current); users($('searchForm').elements.q.value); audit(); }
    catch (e) { msg(e.message, false); }
  };
  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); users(e.currentTarget.elements.q.value.trim()); });
  $('grantForm').addEventListener('submit', (e) => { e.preventDefault(); const f = e.currentTarget; userAction('grant', { days: Number(f.elements.days.value), note: f.elements.note.value }, 'تم منح الاشتراك')(); });
  $('extendForm').addEventListener('submit', (e) => { e.preventDefault(); userAction('extend', { days: Number(e.currentTarget.elements.days.value) }, 'تم التمديد')(); });
  $('stopButton').addEventListener('click', () => { if (confirm('إيقاف كل اشتراكات هذا الحساب الفعّالة؟')) userAction('stop', {}, 'تم إيقاف الاشتراك')(); });
  $('verifyButton').addEventListener('click', userAction('verify', {}, 'تم تأكيد البريد'));
  $('trialRevokeButton').addEventListener('click', userAction('trial-code-revoke', {}, 'تم'));
  $('disableButton').addEventListener('click', () => { if (confirm('إيقاف هذا الحساب وتسجيل خروجه؟')) userAction('disable', { disabled: true }, 'تم إيقاف الحساب')(); });

  async function codes() {
    try {
      const d = await api('GET', '/api/manage/codes');
      const tb = $('codeRows'); tb.replaceChildren();
      for (const c of d.codes) row(tb, [c.hint, c.label || '—', c.uses + ' / ' + (c.maxUses || '∞'), STATUS[c.status] || c.status,
        c.status === 'active' ? button('إلغاء', async () => { try { await api('POST', '/api/manage/code-revoke', { id: c.id }); codes(); audit(); } catch (e) { err(e.message); } }, true) : '']);
    } catch (e) { err(e.message); }
  }
  $('codeForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.currentTarget;
    try {
      const d = await api('POST', '/api/manage/code-create', { label: f.elements.label.value, maxUses: Number(f.elements.maxUses.value), level: f.elements.level.value, expiresAt: f.elements.expiresAt.value ? new Date(f.elements.expiresAt.value).toISOString() : null });
      $('newCode').textContent = 'الرمز الجديد (يظهر مرة واحدة فقط): ' + d.code.code; $('newCode').hidden = false; f.reset(); codes(); audit();
    } catch (er) { err(er.message); }
  });
  async function audit() {
    try {
      const d = await api('GET', '/api/manage/audit?limit=60');
      const tb = $('auditRows'); tb.replaceChildren();
      for (const l of d.log) row(tb, [fmtDate(l.at), l.actor, ACTIONS[l.action] || l.action, l.target || '—']);
    } catch (e) { err(e.message); }
  }
  users(); codes(); audit();
})();
