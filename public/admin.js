/* سبونج لايف — admin panel. Every action is checked and logged on the server (/api/manage/*). */
(() => {
  'use strict';
  // a page restored from the back/forward cache is checked again (the session may have ended meanwhile)
  addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
  const fmtDate = (iso) => (iso ? fmt.format(new Date(iso)) : '—');
  const ACTIONS = { 'subscription-grant': 'منح اشتراك', 'subscription-extend': 'تمديد اشتراك', 'subscription-stop': 'إيقاف اشتراك', 'email-verify-manual': 'تأكيد بريد يدويًا', 'account-disable': 'إيقاف حساب', 'account-enable': 'إعادة تفعيل حساب', 'trial-code-revoke': 'إلغاء رمز تجربة', 'password-reset-link': 'رابط إعادة تعيين كلمة المرور', 'password-reset': 'إعادة تعيين كلمة المرور', 'google-link': 'ربط Google', 'promo-create': 'إنشاء رمز', 'promo-revoke': 'إلغاء رمز', 'promo-update': 'تعديل رمز', 'promo-delete': 'حذف رمز', 'voucher-create': 'إنشاء رموز اشتراك', 'voucher-revoke': 'إلغاء رمز اشتراك', 'partner-save': 'حفظ شريك', 'partner-delete': 'حذف شريك', 'prize-save': 'حفظ جائزة', 'award-status': 'تحديث استلام جائزة' };
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
      add('أُنشئ', fmtDate(d.user.createdAt)); add('اشتراك سابق ما زال ضمن مدته', d.access.active ? d.access.planName + ' حتى ' + fmtDate(d.access.endsAt) : 'لا يوجد');
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
  // «نسيت كلمة المرور» without an e-mail service: a one-time link for the owner to send to the person (WhatsApp)
  $('resetLinkButton').addEventListener('click', async () => {
    if (!current) return;
    try {
      const r = await api('POST', '/api/manage/password-reset-link', { publicId: current });
      const out = $('resetLinkOut'); out.replaceChildren(document.createTextNode('أرسل هذا الرابط لصاحب الحساب فقط — يعمل مرة واحدة خلال 30 دقيقة: '));
      const code = document.createElement('code'); code.dir = 'ltr'; code.textContent = r.link; out.append(code); out.hidden = false;
      try { await navigator.clipboard.writeText(r.link); out.append(document.createTextNode(' (نُسخ)')); } catch {}
      audit();
    } catch (e) { msg(e.message, false); }
  });
  $('disableButton').addEventListener('click', () => { if (confirm('إيقاف هذا الحساب وتسجيل خروجه؟')) userAction('disable', { disabled: true }, 'تم إيقاف الحساب')(); });

  async function codes() {
    try {
      const d = await api('GET', '/api/manage/codes');
      const names = { weekly: 'شفيق العادي', monthly: 'أمير الهامور' };
      $('voucherStats').textContent = d.vouchers.length ? d.vouchers.map((v) => `${names[v.plan]}: ${v.total} رمز، مستخدم ${v.used}، ملغى ${v.revoked}`).join(' · ') : 'لا توجد رموز اشتراك بعد';
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
  let lastCodes = null;
  $('voucherForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.currentTarget;
    try {
      const d = await api('POST', '/api/manage/voucher-create', { plan: f.elements.plan.value, count: Number(f.elements.count.value), label: f.elements.label.value });
      lastCodes = { plan: f.elements.plan.value, codes: d.codes };
      $('voucherOut').textContent = `أُنشئ ${d.codes.length} رمز. نزّلها الآن — لا تظهر مرة أخرى.`; $('voucherOut').hidden = false; $('voucherDownload').hidden = false;
      codes(); audit();
    } catch (er) { err(er.message); }
  });
  $('voucherDownload').addEventListener('click', () => {
    if (!lastCodes) return;
    const csv = 'code,plan\n' + lastCodes.codes.map((c) => c + ',' + lastCodes.plan).join('\n') + '\n';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `sponge-${lastCodes.plan}-codes.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('voucherRevokeForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.currentTarget;
    try { await api('POST', '/api/manage/voucher-revoke', { code: f.elements.code.value.trim() }); f.reset(); codes(); audit(); } catch (er) { err(er.message); }
  });
  async function audit() {
    try {
      const d = await api('GET', '/api/manage/audit?limit=60');
      const tb = $('auditRows'); tb.replaceChildren();
      for (const l of d.log) row(tb, [fmtDate(l.at), l.actor, ACTIONS[l.action] || l.action, l.target || '—']);
    } catch (e) { err(e.message); }
  }
  users(); codes(); audit();

  /* «شركاء النجاح» */
  const pmsg = (id, t, ok = true) => { const m = $(id); m.textContent = t; m.className = 'pg-msg ' + (ok ? 'is-ok' : 'is-err'); m.hidden = !t; };
  let partnerList = [];
  function paintPartners(list) {
    partnerList = list; const tb = $('partnerRows'); tb.replaceChildren();
    if (!list.length) row(tb, ['لا يوجد شركاء بعد']);
    for (const p of list) row(tb, [String(p.sort), p.name + (p.official ? ' ✓' : ''), '@' + p.handle + ' · ' + (p.platform === 'kick' ? 'Kick' : 'TikTok'), p.active ? 'ظاهر' : 'مخفي',
      (() => { const box = document.createElement('span'); box.append(button('تعديل', () => editPartner(p)), button(p.active ? 'إخفاء' : 'إظهار', () => savePartner({ ...p, active: !p.active, photo: undefined })), button('حذف', () => { if (confirmDelete(p)) api('POST', '/api/manage/partner-delete', { id: p.id }).then((d) => paintPartners(d.partners)).catch((e) => pmsg('partnerMsg', e.message, false)); }, true)); return box; })()]);
  }
  // a second click on «حذف» within 4 s confirms (no browser dialogs)
  let armed = null;
  function confirmDelete(p) { if (armed === p.id) { armed = null; return true; } armed = p.id; pmsg('partnerMsg', 'اضغط «حذف» مرة أخرى لتأكيد حذف ' + p.name, false); setTimeout(() => { if (armed === p.id) armed = null; }, 4000); return false; }
  function editPartner(p) {
    const f = $('partnerForm');
    f.id.value = p.id; f.name.value = p.name; f.handle.value = p.handle; f.platform.value = p.platform; f.description.value = p.description || ''; f.sort.value = p.sort; f.active.checked = p.active; f.official.checked = p.official;
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function savePartner(body) {
    try { const d = await api('POST', '/api/manage/partner-save', body); paintPartners(d.partners); pmsg('partnerMsg', 'تم الحفظ'); return true; }
    catch (e) { pmsg('partnerMsg', e.message, false); return false; }
  }
  const readFile = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
  $('partnerForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    const file = f.photo.files[0];
    if (file && file.size > 400_000) { pmsg('partnerMsg', 'حجم الصورة أكبر من 400 كيلوبايت', false); return; }
    const body = { id: f.id.value ? Number(f.id.value) : undefined, name: f.name.value, handle: f.handle.value, platform: f.platform.value, description: f.description.value, sort: Number(f.sort.value || 0), active: f.active.checked, official: f.official.checked, photo: file ? await readFile(file) : undefined };
    if (await savePartner(body)) { f.reset(); f.id.value = ''; }
  });
  $('partnerForm').addEventListener('reset', () => { $('partnerForm').id.value = ''; });
  api('GET', '/api/manage/partners').then((d) => paintPartners(d.partners)).catch(() => {});

  /* جوائز المتصدرين */
  const BOARD = { players: 'اللاعبون', streamers: 'الستريمرز' }, METRIC = { wins: 'الانتصارات', entries: 'المشاركات', hours: 'الساعات', players: 'اللاعبون', sessions: 'الجلسات', rounds: 'الجولات' };
  const AWARD = { pending: 'بانتظار التسليم', delivered: 'سُلّمت', void: 'ملغاة' };
  function paintPrizes(d) {
    const tb = $('prizeRows'); tb.replaceChildren();
    if (!d.prizes.length) row(tb, ['لا توجد جوائز معلنة — لن تظهر «عليها جوائز» في الصفحة الرئيسية']);
    for (const p of d.prizes) row(tb, [p.title + (p.active ? '' : ' (متوقفة)'), BOARD[p.board] + ' · ' + METRIC[p.metric], p.rankFrom === p.rankTo ? String(p.rankFrom) : p.rankFrom + '–' + p.rankTo, p.startsOn + (p.endsOn ? ' → ' + p.endsOn : ' →'),
      button(p.active ? 'إيقاف' : 'تفعيل', () => api('POST', '/api/manage/prize-save', { ...p, active: !p.active }).then(paintPrizes).catch((e) => pmsg('prizeMsg', e.message, false)))]);
    const ab = $('awardRows'); ab.replaceChildren();
    if (!d.awards.length) row(ab, ['لا يوجد فائزون مسجلون بعد']);
    for (const a of d.awards) {
      const sel = document.createElement('select');
      for (const [v, t] of Object.entries(AWARD)) { const o = new Option(t, v); o.selected = v === a.status; sel.append(o); }
      sel.addEventListener('change', () => api('POST', '/api/manage/award-status', { id: a.id, status: sel.value }).then(paintPrizes).catch((e) => pmsg('prizeMsg', e.message, false)));
      row(ab, [a.weekStart, a.title, String(a.rank), (a.winner.name || '') + (a.winner.publicId ? ' · ' + a.winner.publicId : a.winner.handle ? ' · @' + a.winner.handle : ''), sel]);
    }
  }
  $('prizeForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try { paintPrizes(await api('POST', '/api/manage/prize-save', { board: f.board.value, metric: f.metric.value, rankFrom: Number(f.rankFrom.value), rankTo: Number(f.rankTo.value), title: f.title.value, conditions: f.conditions.value, startsOn: f.startsOn.value || undefined, endsOn: f.endsOn.value || undefined })); f.reset(); pmsg('prizeMsg', 'أُضيفت الجائزة'); }
    catch (er) { pmsg('prizeMsg', er.message, false); }
  });
  api('GET', '/api/manage/prizes').then(paintPrizes).catch(() => {});

  /* بلاغات المستخدمين */
  const RSTATUS = { open: 'جديد', reviewed: 'تمت المراجعة', dismissed: 'مرفوض' };
  const fmtR = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Riyadh' });
  async function loadReports() {
    const tb = $('reportRows');
    try {
      const d = await api('GET', '/api/manage/reports?status=' + $('reportStatus').value); tb.replaceChildren();
      if (!d.reports.length) row(tb, ['لا توجد بلاغات بهذه الحالة']);
      for (const r of d.reports) {
        const sel = document.createElement('select');
        for (const [v, t] of Object.entries(RSTATUS)) { const o = new Option(t, v); o.selected = v === r.status; sel.append(o); }
        sel.addEventListener('change', () => api('POST', '/api/manage/report-status', { id: r.id, status: sel.value }).then(loadReports).catch((e) => pmsg('reportMsg', e.message, false)));
        row(tb, [fmtR.format(new Date(r.createdAt)), r.targetName + ' · ' + r.target + (r.total > 1 ? ` (${r.total} بلاغات)` : ''), r.reasonText, r.note || '—', r.reporter, sel]);
      }
    } catch (e) { pmsg('reportMsg', e.message, false); }
  }
  $('reportStatus').addEventListener('change', loadReports);
  loadReports();
})();
