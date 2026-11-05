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
  const SECTIONS = ['settings', 'profile', 'bag', 'skins', 'wallet', 'billing', 'community', 'challenge'];
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
    const navSec = sec === 'billing' ? 'settings' : sec === 'skins' ? 'bag' : sec;
    for (const a of document.querySelectorAll('.ds-nav a[data-sec]')) { if (a.dataset.sec === navSec) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    closeMenu();
    if (sec === 'settings') loadSessions();
    if (sec === 'community') loadCommunity();
    if (sec === 'wallet') loadWallet();
    syncViewers(sec);
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

  /* ---------- «ملفي»: level, XP and the player / streamer view (all counted by the server) ---------- */
  const nf = (n) => Number(n || 0).toLocaleString('en-US');
  let lastXp = null, remainTimer = 0;
  function paintProgress(p) {
    const u = p.user, a = p.access, g = p.progress || { xp: 0, level: 1, levelXp: 0, nextXp: 500, pct: 0, player: {}, streamer: {}, rules: {} };
    const links = Object.values(p.linked || {}).filter((l) => l && !l.needsReauth);
    const streamerAcct = a.active || links.length > 0 || (g.streamer.sessions || 0) > 0;
    const type = streamerAcct ? 'حساب ستريمر' : 'حساب لاعب';
    $('accountType').textContent = type; $('accountType2').textContent = type;
    $('planChip').textContent = a.active ? a.planName : 'بدون اشتراك'; $('planChip').classList.toggle('is-on', !!a.active);
    $('statusDot').classList.toggle('is-on', !!a.active); $('statusDot').title = a.active ? 'الاشتراك فعّال' : 'لا يوجد اشتراك فعّال';
    $('publicId2').textContent = u.publicId; $('cmMyId').textContent = u.publicId;
    paintMySkin(p);
    if (wallet) paintDaily(wallet);
    badge($('profEmailBadge'), u.verified ? 'موثّق' : 'غير موثّق', u.verified ? 'is-on' : 'is-warn');
    $('profLinked').textContent = links.length ? Object.entries(p.linked).filter(([, l]) => l && !l.needsReauth).map(([k, l]) => (k === 'kick' ? 'Kick' : 'TikTok') + ' @' + l.handle).join('، ') : 'لا توجد منصات مرتبطة';
    $('profEnds').textContent = a.active ? fmtDate(a.endsAt) : '—';
    // level and XP
    $('levelNow').textContent = String(g.level);
    $('xpNow').textContent = 'XP ' + nf(g.levelXp);
    $('xpNext').textContent = nf(g.nextXp) + ' XP للمستوى التالي';
    $('xpBar').setAttribute('aria-valuenow', String(g.pct));
    $('xpFill').style.setProperty('--pct', g.pct + '%');
    if (lastXp !== null && g.xp > lastXp) { $('xpBar').classList.remove('is-up'); void $('xpBar').offsetWidth; $('xpBar').classList.add('is-up'); }
    lastXp = g.xp;
    const R = g.rules || {};
    $('xpRules').textContent = `تكسب XP من أحداث لعب حقيقية فقط: ${R.entry} لكل مشاركة في جولة، ${R.win} لكل فوز، ${R.playMinute} لكل دقيقة لعب، ${R.session} لكل جلسة بث، ${R.streamMinute} لكل دقيقة تشغيل ألعاب، و${R.streamRound} لكل جولة مكتملة في بثك. المستوى الأول يحتاج 500 XP، وكل مستوى بعده يحتاج 250 XP إضافية.`;
    // statistics
    const pl = g.player || {}, sr = g.streamer || {};
    $('pEntries').textContent = nf(pl.entries); $('pWins').textContent = nf(pl.wins); $('pHours').textContent = String(pl.hours || 0); $('pWeeks').textContent = nf(pl.weeks);
    $('playerNote').hidden = links.length > 0;
    $('sSessions').textContent = nf(sr.sessions); $('sHours').textContent = String(sr.hours || 0); $('sLongest').textContent = String(sr.longestHours || 0);
    $('sPlayers').textContent = nf(sr.players); $('sGames').textContent = nf(sr.games); $('sLinked').textContent = String(links.length);
    $('sLinkedText').textContent = links.length ? 'منصة مرتبطة: ' + links.map((l) => '@' + l.handle).join('، ') : 'منصة مرتبطة';
    let mode = ''; try { mode = localStorage.getItem('sponge_profile_mode') || ''; } catch {}
    setMode(mode || (streamerAcct ? 'streamer' : 'player'));
    // time left in the subscription (from the server's end date)
    clearInterval(remainTimer);
    $('remainBox').hidden = !a.active;
    if (a.active) {
      const end = Date.parse(a.endsAt);
      $('remainUntil').textContent = 'ينتهي ' + fmtDate(a.endsAt);
      const tick = () => { const ms = Math.max(0, end - Date.now()); const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s2 = Math.floor(ms / 1e3) % 60; $('remainClock').textContent = (d ? d + 'd ' : '') + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s2).padStart(2, '0'); };
      tick(); remainTimer = setInterval(tick, 1000);
    }
  }
  function setMode(mode) {
    for (const b of document.querySelectorAll('.pf-seg [data-mode]')) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
    $('statsPlayer').hidden = mode !== 'player'; $('statsStreamer').hidden = mode !== 'streamer';
  }
  document.querySelector('.pf-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]'); if (!b) return;
    setMode(b.dataset.mode); try { localStorage.setItem('sponge_profile_mode', b.dataset.mode); } catch {}
  });
  $('xpHelp').addEventListener('click', () => { const open = $('xpRules').hidden; $('xpRules').hidden = !open; $('xpHelp').setAttribute('aria-expanded', String(open)); });
  $('editToggle').addEventListener('click', () => {
    const open = $('editCard').hidden; $('editCard').hidden = !open; $('editToggle').setAttribute('aria-expanded', String(open));
    if (open) $('editCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // the bottom bar steps aside while the keyboard is up
  /* ---------- render ---------- */
  function render(p) {
    profile = p;
    const u = p.user, a = p.access;
    $('main').setAttribute('aria-busy', 'false');
    $('navAdmin').hidden = !u.isAdmin; $('navStudio').hidden = !a.active;
    // profile
    $('displayName').textContent = u.displayName;
    if (u.picture && u.avatar === 'sponge') { const img = el('img', 'pg-avatar-img'); img.src = u.picture; img.alt = ''; img.width = 96; img.height = 96; img.referrerPolicy = 'no-referrer'; $('avatarView').replaceChildren(img); }
    else $('avatarView').textContent = AVATARS[u.avatar] || '🧽';
    $('publicId').textContent = u.publicId; $('username').textContent = u.username; $('profEmail').textContent = u.email;
    $('createdAt').textContent = fmtDate(u.createdAt); $('lastLogin').textContent = fmtDate(u.lastLoginAt);
    $('profPlan').textContent = a.active ? a.planName : 'لا يوجد اشتراك فعّال';
    for (const id of ['publicLink', 'publicLink2']) $(id).href = '/u/' + u.publicId;
    paintProgress(p);
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
    $('methodOnline').hidden = !p.billing.enabled;
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
    if (!list.length) { const td = rows.insertRow().insertCell(); td.colSpan = 7; td.className = 'ds-empty'; td.textContent = 'لا توجد اشتراكات بعد'; return; }
    for (const h of list) {
      const tr = rows.insertRow();
      for (const v of [h.planName || PLAN_NAMES[h.plan], SOURCE[h.source] || h.source || '—', fmtDate(h.startsAt), fmtDate(h.endsAt), h.price ? h.price + ' ريال' : 'مجاني']) tr.insertCell().textContent = v;
      const s = STATUS[h.status] || [h.status, 'is-off']; const b = el('span'); badge(b, s[0], s[1]); tr.insertCell().append(b);
      const r = el('button', 'ds-link', 'عرض'); r.type = 'button'; r.setAttribute('aria-label', 'عرض إيصال ' + (h.planName || PLAN_NAMES[h.plan])); r.addEventListener('click', () => showReceipt(h)); tr.insertCell().append(r);
    }
  }
  /** A receipt built only from the server's subscription record — an activation receipt, never a tax invoice. */
  function showReceipt(h) {
    const rows = [['رقم الإيصال', 'SL-' + String(h.id).replace(/-/g, '').slice(0, 12).toUpperCase()], ['صاحب الحساب', profile.user.displayName], ['المعرف الدائم', profile.user.publicId],
      ['الباقة', h.planName || PLAN_NAMES[h.plan]], ['طريقة التفعيل', SOURCE[h.source] || h.source || '—'], ['من', fmtDate(h.startsAt)], ['إلى', fmtDate(h.endsAt)],
      ['المبلغ', h.price ? h.price + ' ' + (h.currency === 'SAR' || !h.currency ? 'ريال سعودي' : h.currency) : 'مجاني'], ['الحالة', (STATUS[h.status] || [h.status])[0]]];
    $('rcList').replaceChildren(...rows.flatMap(([k, v]) => { const dd = el('dd', '', v); if (/SPG-|SL-/.test(v)) dd.dir = 'ltr'; return [el('dt', '', k), dd]; }));
    const d = $('receipt'); if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }
  $('rcClose').addEventListener('click', () => $('receipt').close());
  $('rcPrint').addEventListener('click', () => { document.body.classList.add('is-printing'); print(); });
  addEventListener('afterprint', () => document.body.classList.remove('is-printing'));
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
  $('copyId').addEventListener('click', async () => {
    const text = profile?.user.publicId || ''; if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
    $('copiedNote').hidden = false; clearTimeout($('copiedNote')._t); $('copiedNote')._t = setTimeout(() => { $('copiedNote').hidden = true; }, 1800);
  });
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

  /* ---------- «المجتمع»: friends by SPG ID, requests, blocking and reports (the server decides every relation) ---------- */
  const REL_TEXT = { friends: ['صديق', 'is-on'], outgoing: ['طلبك ينتظر الرد', 'is-warn'], incoming: ['أرسل لك طلبًا', 'is-warn'], blocked: ['محظور', 'is-bad'], unavailable: ['لا يستقبل طلبات', 'is-off'], none: ['', ''], self: ['هذا حسابك', 'is-off'] };
  let cmTab = 'friends', cmBusy = false, reportTarget = null;
  function memberAvatar(m) {
    const span = el('span', 'cm-ava');
    if (m.picture && m.avatar === 'sponge') { const img = el('img'); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.loading = 'lazy'; img.src = m.picture; span.append(img); }
    else span.textContent = AVATARS[m.avatar] || '🧽';
    span.setAttribute('aria-hidden', 'true'); return span;
  }
  function memberButton(text, cls, fn) { const b = el('button', 'ds-btn ' + cls); b.type = 'button'; b.append(el('span', 'ds-spin'), el('span', '', text)); b.querySelector('.ds-spin').setAttribute('aria-hidden', 'true'); b.addEventListener('click', () => act(b, () => fn(b))); return b; }
  async function relate(action, m, okText) { await api('POST', '/api/me/' + action, { id: m.publicId }); toast(okText); await loadCommunity(true); if (!$('findResult').hidden && $('findResult').dataset.id === m.publicId) await findMember(m.publicId); }
  /** Confirm by a second click on the same button (no browser dialogs). */
  function confirmTwice(b, text, fn) { if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.lastChild.textContent = text; setTimeout(() => { if (b.isConnected) { b.dataset.confirm = ''; b.lastChild.textContent = b.dataset.label; } }, 4000); return; } b.dataset.confirm = ''; return fn(); }
  function actionsFor(m, rel) {
    const out = [];
    const danger = (label, confirmText, fn) => { const b = memberButton(label, 'is-ghost is-danger', (btn) => confirmTwice(btn, confirmText, fn)); b.dataset.label = label; return b; };
    if (rel === 'none') out.push(memberButton('إضافة صديق', 'is-blue', () => relate('friend-request', m, 'أُرسل طلب الصداقة ✓')));
    if (rel === 'incoming') out.push(memberButton('قبول', 'is-blue', () => relate('friend-accept', m, 'أصبحتما صديقين ✓')), memberButton('رفض', 'is-ghost', () => relate('friend-decline', m, 'رُفض الطلب')));
    if (rel === 'outgoing') out.push(memberButton('إلغاء الطلب', 'is-ghost', () => relate('friend-remove', m, 'أُلغي الطلب')));
    if (rel === 'friends') out.push(danger('إزالة', 'اضغط للتأكيد', () => relate('friend-remove', m, 'أُزيل من أصدقائك')));
    if (rel === 'blocked') out.push(memberButton('إلغاء الحظر', 'is-ghost', () => relate('unblock', m, 'أُلغي الحظر')));
    else if (rel !== 'self') {
      out.push(danger('حظر', 'تأكيد الحظر', () => relate('block', m, 'حُظر الحساب — لن يستطيع إرسال طلبات لك')));
      out.push(memberButton('إبلاغ', 'is-ghost', () => openReport(m)));
    }
    return out;
  }
  function memberRow(m, rel, tag = 'li') {
    const row = el(tag, 'cm-row'), who = el('a', 'cm-who'); who.href = '/u/' + m.publicId;
    const txt = el('span'); txt.append(el('b', '', m.displayName), el('small', '', m.publicId)); txt.lastChild.dir = 'ltr';
    who.append(memberAvatar(m), txt); row.append(who);
    const [t, c] = REL_TEXT[rel] || ['', '']; if (t && rel !== 'friends') row.append(el('span', 'pg-badge ' + c, t));
    if (m.since) row.append(el('small', 'cm-since', (rel === 'friends' ? 'منذ ' : '') + fmtDate(m.since)));
    const acts = el('div', 'cm-acts'); acts.append(...actionsFor(m, rel)); row.append(acts);
    return row;
  }
  function paintCount(n) { for (const id of ['navIncoming', 'bottomIncoming']) { const x = $(id); if (!x) continue; x.textContent = n > 9 ? '9+' : String(n); x.hidden = !n; } }
  async function loadCommunity(force = false) {
    if (cmBusy && !force) return; cmBusy = true;
    try {
      const r = await api('GET', '/api/me/friends');
      const rel = { friends: 'friends', incoming: 'incoming', outgoing: 'outgoing', blocked: 'blocked' };
      for (const k of Object.keys(rel)) {
        const list = $('cm-' + k); list.replaceChildren(...(r[k].length ? r[k].map((m) => memberRow(m, rel[k])) : [el('li', 'ds-empty', list.dataset.empty)]));
        $('n' + k[0].toUpperCase() + k.slice(1)).textContent = r[k].length;
      }
      $('nIncoming').classList.toggle('is-hot', r.incoming.length > 0);
      paintCount(r.incoming.length);
    } catch (e) { if (e.message !== 'login') toast(e.message, true); } finally { cmBusy = false; }
  }
  function cmSelect(tab, focus) {
    cmTab = tab;
    for (const b of document.querySelectorAll('.cm-tabs [role=tab]')) { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); }
    for (const k of ['friends', 'incoming', 'outgoing', 'blocked']) $('cm-' + k).hidden = k !== tab;
  }
  const tabs = [...document.querySelectorAll('.cm-tabs [role=tab]')];
  for (const b of tabs) {
    b.addEventListener('click', () => cmSelect(b.dataset.tab));
    b.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(b), n = tabs.length;
      // RTL: the right arrow goes to the previous tab
      const j = e.key === 'ArrowLeft' ? (i + 1) % n : e.key === 'ArrowRight' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (j >= 0) { e.preventDefault(); cmSelect(tabs[j].dataset.tab, true); }
    });
  }
  async function findMember(id) {
    const box = $('findResult'), m = $('findMsg'); say(m, '', '');
    try {
      const r = await api('GET', '/api/me/find?id=' + encodeURIComponent(id));
      box.dataset.id = r.member.publicId; box.replaceChildren(memberRow(r.member, r.member.relation, 'div')); box.hidden = false;
    } catch (err) { box.hidden = true; box.replaceChildren(); say(m, err.message, 'is-err'); }
  }
  $('findForm').addEventListener('submit', (e) => {
    e.preventDefault();
    let id = $('findId').value.trim().toUpperCase().replace(/\s+/g, '');
    if (/^[A-Z0-9]{6}$/.test(id)) id = 'SPG-' + id;
    if (!/^SPG-[A-Z0-9]{6}$/.test(id)) { say($('findMsg'), 'اكتب المعرف كاملًا بهذا الشكل: SPG-XXXXXX', 'is-err'); $('findId').focus(); return; }
    $('findId').value = id;
    act(e.currentTarget.querySelector('button'), () => findMember(id));
  });
  $('cmCopy').addEventListener('click', (e) => { if (profile?.user.publicId) copy(profile.user.publicId, e.currentTarget); });
  function openReport(m) {
    reportTarget = m; const f = $('reportForm'); f.reset(); say($('reportMsg'), '', '');
    $('reportWho').textContent = m.displayName + ' — ' + m.publicId;
    const d = $('reportDialog'); if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }
  const closeReport = () => { const d = $('reportDialog'); if (d.open) d.close(); reportTarget = null; };
  $('reportCancel').addEventListener('click', closeReport);
  $('reportForm').addEventListener('submit', (e) => {
    e.preventDefault(); const f = e.currentTarget, reason = f.elements.reason.value;
    if (!reason) { say($('reportMsg'), 'اختر سبب البلاغ', 'is-err'); return; }
    act(f.querySelector('button[type=submit]'), async () => {
      try {
        const m = reportTarget;
        await api('POST', '/api/me/report', { id: m.publicId, reason, note: f.elements.note.value });
        if (f.elements.block.checked) await api('POST', '/api/me/block', { id: m.publicId });
        closeReport(); toast(f.elements.block.checked ? 'وصل البلاغ للإدارة وحُظر الحساب ✓' : 'وصل البلاغ للإدارة ✓');
        await loadCommunity(true); if (!$('findResult').hidden) await findMember(m.publicId);
      } catch (err) { say($('reportMsg'), err.message, 'is-err'); }
    });
  });

  /* ---------- 3D skins: «شخصيتي» in ملفي and «السكنات» in حقيبتي ----------
     three.js and a model are fetched only when one of these sections is opened, and only one 3D view is alive at a
     time (leaving the section frees it). Ownership and the equipped skin always come from the server. */
  const LABELS = { idle: 'وقوف', walk: 'مشي', win: 'فوز', lose: 'خسارة' };
  const views = {}; let viewerMod = null, skinState = null, skPicked = null, skFilter = 'all';
  const hasGL = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
  function stageStatus(pre, text) { const n = $(pre + 'Status'); n.textContent = text; n.hidden = !text; }
  function paintAnims(pre, names, active = 'idle') {
    const box = $(pre + 'Anims');
    box.replaceChildren(...['idle', 'walk', 'win', 'lose'].filter((n) => names.includes(n)).map((n) => {
      const b = el('button', 'sv-anim', LABELS[n]); b.type = 'button'; b.dataset.anim = n; b.setAttribute('aria-pressed', String(n === active));
      b.addEventListener('click', () => { views[pre]?.play(n); for (const x of box.children) x.setAttribute('aria-pressed', String(x === b)); });
      return b;
    }));
  }
  const queue = {};
  /** One request at a time per stage, so two quick calls never create two WebGL views. */
  function showModel(pre, skin, animations) { queue[pre] = (queue[pre] || Promise.resolve()).then(() => showModelNow(pre, skin, animations)).catch(() => {}); return queue[pre]; }
  async function showModelNow(pre, skin, animations) {
    const stage = $(pre + 'Stage'), poster = $(pre + 'Poster');
    if (poster.getAttribute('src') !== skin.thumb) poster.src = skin.thumb;
    stage.dataset.state = 'poster';
    if (!hasGL) { stageStatus(pre, 'جهازك لا يدعم العرض ثلاثي الأبعاد — نعرض صورة الشخصية.'); $(pre + 'Anims').replaceChildren(); return; }
    stageStatus(pre, 'جارٍ تحميل الشخصية…');
    try {
      viewerMod ||= await import('/skin-viewer.js');
      if (document.body.dataset.sec !== (pre === 'my' ? 'profile' : 'skins')) return; // the visitor moved on meanwhile
      const onState = (st, info) => {
        if (st === 'ready') { stageStatus(pre, ''); paintAnims(pre, info.animations); }
        if (st === 'error') { stageStatus(pre, 'تعذر تحميل الشخصية — تحقق من الاتصال ثم أعد المحاولة.'); stage.dataset.state = 'poster'; }
      };
      if (!views[pre]) views[pre] = await viewerMod.mountViewer(stage, { model: skin.model, animations, label: skin.name, onState });
      else await views[pre].setModel(skin.model, animations);
    } catch { stageStatus(pre, 'تعذر تشغيل العرض ثلاثي الأبعاد.'); }
  }
  function syncViewers(sec) {
    for (const [pre, v] of Object.entries(views)) if ((pre === 'my' && sec !== 'profile') || (pre === 'sk' && sec !== 'skins')) { v.dispose(); delete views[pre]; $(pre + 'Stage').dataset.state = 'poster'; }
    if (sec === 'profile' && profile) showModel('my', profile.skin, profile.skinAnimations);
    if (sec === 'skins') loadSkins();
  }
  function paintMySkin(p) {
    if (!p.skin) return;
    $('myCharName').textContent = p.skin.name;
    const poster = $('myPoster'); if (poster.getAttribute('src') !== p.skin.thumb) poster.src = p.skin.thumb;
    if (document.body.dataset.sec === 'profile' && !views.my) showModel('my', p.skin, p.skinAnimations);
  }
  for (const pre of ['my', 'sk']) $(pre + 'Stage').querySelector('.sv-tools').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]'), v = views[pre]; if (!b || !v) return;
    ({ 'zoom-in': () => v.zoom(0.85), 'zoom-out': () => v.zoom(1.18), 'turn-left': () => v.rotate(-0.5), 'turn-right': () => v.rotate(0.5), reset: () => v.reset() })[b.dataset.view]();
  });

  async function loadSkins() {
    try { skinState = await api('GET', '/api/me/skins'); } catch (e) { if (e.message !== 'login') say($('skMsg'), e.message, 'is-err'); return; }
    if (!skPicked || !skinState.skins.some((x) => x.id === skPicked)) skPicked = skinState.equipped;
    paintSkins();
  }
  function skinBadge(x) { return x.equipped ? ['مُجهّز', 'is-on'] : x.owned ? ['في مجموعتك', 'is-warn'] : x.access === 'free' ? ['مجاني', 'is-off'] : ['قريبًا', 'is-off']; }
  function paintSkins() {
    const st = skinState, owned = st.skins.filter((x) => x.owned);
    $('skAll').textContent = st.skins.length; $('skOwned').textContent = owned.length;
    $('skCredit').textContent = Object.values(st.packs).map((p) => 'الشخصيات: ' + p.credit).join(' • ');
    const list = skFilter === 'owned' ? owned : st.skins;
    $('skGrid').replaceChildren(...list.map((x) => {
      const li = el('li'), b = el('button', 'sk-item'); b.type = 'button'; b.dataset.id = x.id;
      b.setAttribute('aria-pressed', String(x.id === skPicked)); b.style.setProperty('--sk-accent', x.accent);
      const img = el('img'); img.src = x.thumb; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.width = 160; img.height = 160;
      const [t, c] = skinBadge(x); const badge = el('span', 'pg-badge ' + c, t);
      b.append(img, el('b', '', x.name), badge);
      b.addEventListener('click', () => { skPicked = x.id; paintSkins(); });
      li.append(b); return li;
    }));
    const pick = st.skins.find((x) => x.id === skPicked);
    $('skPreviewName').textContent = pick.name; $('skPreviewBlurb').textContent = pick.blurb;
    $('skPreviewTag').textContent = pick.equipped ? 'السكن المُجهّز حاليًا' : 'معاينة';
    const [t, c] = skinBadge(pick); badge($('skPreviewBadge'), t, c); $('skPreviewBadge').hidden = false;
    $('skClaim').hidden = pick.owned || pick.access !== 'free';
    $('skEquip').hidden = !pick.owned || pick.equipped;
    if (document.body.dataset.sec === 'skins' && $('skStage').dataset.skin !== pick.id) { $('skStage').dataset.skin = pick.id; showModel('sk', pick, st.animations); }
  }
  for (const b of document.querySelectorAll('.sk-filter [role=tab]')) b.addEventListener('click', () => {
    skFilter = b.dataset.filter;
    for (const x of document.querySelectorAll('.sk-filter [role=tab]')) { const on = x === b; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; }
    if (skinState) paintSkins();
  });
  $('skClaim').addEventListener('click', (e) => act(e.currentTarget, async () => {
    try { skinState = await api('POST', '/api/me/skin-claim', { id: skPicked }); paintSkins(); say($('skMsg'), 'أُضيفت الشخصية إلى مجموعتك ✓ — يمكنك تجهيزها الآن.', 'is-ok'); }
    catch (err) { say($('skMsg'), err.message, 'is-err'); }
  }));
  $('skEquip').addEventListener('click', (e) => act(e.currentTarget, async () => {
    try {
      skinState = await api('POST', '/api/me/skin-equip', { id: skPicked }); paintSkins();
      const now = skinState.skins.find((x) => x.equipped);
      if (profile) { profile.skin = now; paintMySkin(profile); }
      say($('skMsg'), `تم تجهيز «${now.name}» ✓ — تظهر الآن في ملفك.`, 'is-ok'); views.sk?.play('win');
    } catch (err) { say($('skMsg'), err.message, 'is-err'); }
  }));

  /* ---------- «عملات الإسفنجة»: wallet, daily reward (server clock), invitations ----------
     Every number comes from the server; the page only shows it. The daily reward is asked for when the
     dashboard opens and when the timer reaches zero — the server pays it at most once per 24 hours. */
  const SC = window.SpongeCoins;
  const TX_KIND = { daily: 'مكافأة يومية', referral: 'دعوة صديق', purchase: 'شراء عملات', spin: 'عجلة السكنات', skin_buy: 'شراء سكن', admin: 'تعديل من الإدارة' };
  const INV = { pending: ['بانتظار تأكيد البريد', 'is-warn'], granted: ['+50 ✓', 'is-on'], held: ['قيد المراجعة', 'is-warn'], rejected: ['غير مؤهلة', 'is-off'], capped: ['بعد اكتمال الحد', 'is-off'] };
  let wallet = null, dailyBusy = false;
  function paintWallet(w) {
    wallet = w; SC.setBalance(w.balance);
    $('wEarned').textContent = SC.nf(w.earned); $('wPurchased').textContent = SC.nf(w.purchased);
    $('wTotEarned').textContent = SC.nf(w.totalEarned); $('wTotBought').textContent = SC.nf(w.totalBought); $('wTotSpent').textContent = SC.nf(w.totalSpent);
    paintDaily(w);
    if (w.transactions) $('txList').replaceChildren(...(w.transactions.length ? w.transactions.map((t) => {
      const li = el('li'); const left = el('span'); left.append(el('b', '', TX_KIND[t.kind] || t.kind), el('small', '', fmtDate(t.at) + (t.note && t.note !== TX_KIND[t.kind] ? ' — ' + t.note : '')));
      const amt = el('b', 'wl-amt ' + (t.amount > 0 ? 'is-plus' : 'is-minus'), (t.amount > 0 ? '+' : '') + SC.nf(t.amount)); amt.dir = 'ltr';
      li.append(left, amt); return li;
    }) : [el('li', 'ds-empty', 'لا توجد معاملات بعد — مكافأتك اليومية الأولى تظهر هنا.')]));
  }
  function paintDaily(w) {
    const verified = profile?.user?.verified !== false;
    const ready = !w.daily.nextAt || Date.parse(w.daily.nextAt) <= Date.parse(w.serverNow);
    for (const [label, timer] of [['dailyLabel', 'dailyTimer'], ['stripDailyLabel', 'stripDaily']]) {
      if (!verified) { $(label).textContent = 'أكّد بريدك لتبدأ مكافآتك اليومية'; $(timer).textContent = '—'; continue; }
      $(label).textContent = ready ? 'مكافأتك جاهزة' : 'مكافأتك اليومية القادمة';
      if (ready) $(timer).textContent = '00:00:00';
      else SC.countdown($(timer), w.daily.nextAt, w.serverNow, () => claimDaily(false));
    }
    $('dailyClaim').hidden = !(verified && ready);
    $('navDaily').hidden = !(verified && ready);
    if (!verified) say($('dailyMsg'), 'المكافأة اليومية للحسابات المؤكدة فقط — أكّد بريدك من الإعدادات أو سجّل الدخول بـ Google.', 'is-info'); else say($('dailyMsg'), '', '');
  }
  async function claimDaily(manual) {
    if (dailyBusy) return; dailyBusy = true;
    try {
      const r = await SC.claimDaily();
      if (r.granted) SC.celebrate({ amount: r.amount, balance: r.balance, nextAt: r.daily.nextAt, serverNow: r.serverNow });
      else if (manual && r.reason === 'wait') toast('استلمت مكافأتك — موعد القادمة في العدّاد');
      paintWallet(r);
    } catch (e) { if (manual) toast(e.message, true); } finally { dailyBusy = false; }
  }
  $('dailyClaim').addEventListener('click', (e) => act(e.currentTarget, () => claimDaily(true)));
  async function loadWallet() {
    try { paintWallet(await api('GET', '/api/me/wallet')); } catch (e) { if (e.message !== 'login') toast(e.message, true); }
    try {
      const v = await api('GET', '/api/me/invites');
      $('inviteLink').value = v.link;
      $('inviteCount').textContent = `${v.completed} من ${v.cap} دعوات`;
      $('inviteEarned').textContent = `ربحت ${SC.nf(v.earned)} عملة إسفنجة`;
      $('inviteFill').style.setProperty('--pct', Math.round((v.completed / v.cap) * 100) + '%');
      $('inviteBar').setAttribute('aria-valuenow', String(v.completed));
      $('inviteMore').textContent = v.remaining ? `باقي ${v.remaining} دعوات مكافأة${v.pending ? ` • ${v.pending} بانتظار تأكيد البريد` : ''}${v.held ? ` • ${v.held} قيد المراجعة` : ''}` : 'اكتملت دعواتك العشر — شكرًا لنشر SPONGE LIVE! 🎉';
      $('inviteCard').classList.toggle('is-complete', !v.remaining);
      $('inviteList').replaceChildren(...v.list.map((r) => { const li = el('li'); const [t, c] = INV[r.status] || [r.status, 'is-off']; li.append(el('span', '', r.name), el('span', 'pg-badge ' + c, t)); return li; }));
    } catch {}
  }
  $('inviteCopy').addEventListener('click', (e) => copy($('inviteLink').value, e.currentTarget));
  if (navigator.share) { $('inviteShare').hidden = false; $('inviteShare').addEventListener('click', () => navigator.share({ title: 'SPONGE LIVE', text: 'انضم إلي في SPONGE LIVE — ألعاب البث التفاعلية', url: $('inviteLink').value }).catch(() => {})); }
  // the wallet strip in «ملفي» and the side panel badge need the wallet on every visit; the reward is asked for once
  api('GET', '/api/me/wallet').then(paintWallet).then(() => claimDaily(false)).catch(() => {});
  const findParam = (params.get('find') || '').toUpperCase();
  if (/^SPG-[A-Z0-9]{6}$/.test(findParam)) { $('findId').value = findParam; findMember(findParam); history.replaceState(null, '', location.pathname + location.hash); }
  initialSection();
  load();
  if (document.body.dataset.sec !== 'community') loadCommunity();
})();
