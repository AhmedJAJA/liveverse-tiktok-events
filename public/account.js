/* سبونج لايف account window (login / register / guest / recovery / profile).
   Classic script: window.SkyAccount.open({ tab, guest, onDone }). Needs session.js. */
(() => {
  'use strict';
  const d = document;
  let dialog = null, opener = null, options = {}, busy = false;
  const h = (tag, attrs = {}, ...kids) => {
    const el = d.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'text') el.textContent = v; else if (k === 'class') el.className = v; else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid) el.append(kid);
    return el;
  };
  const icon = (id) => { const s = d.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true'); const u = d.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '/icons.svg#i-' + id); s.append(u); return s; };
  function score(pw) {
    let s = 0; if (pw.length >= 8) s++; if (pw.length >= 12) s++;
    if (/[a-z؀-ۿ]/i.test(pw) && /\d/.test(pw)) s++;
    if (/[^\p{L}\p{N}]/u.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw))) s++;
    return s;
  }
  function field({ name, label, type = 'text', auto, dir, hint, max }) {
    const id = 'acc-' + name;
    const input = h('input', { id, name, type, autocomplete: auto, dir, maxlength: max, 'aria-describedby': id + '-err' + (hint ? ' ' + id + '-hint' : ''), required: true, spellcheck: 'false' });
    const wrap = h('div', { class: 'acc-field' }, h('label', { for: id, text: label }));
    if (type === 'password') {
      const toggle = h('button', { type: 'button', class: 'acc-eye', 'aria-label': 'إظهار كلمة المرور', 'aria-pressed': 'false' }, icon('eye'));
      toggle.addEventListener('click', () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; toggle.setAttribute('aria-pressed', String(show)); toggle.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'); toggle.classList.toggle('is-on', show); input.focus(); });
      wrap.append(h('div', { class: 'acc-input has-eye' }, input, toggle));
    } else wrap.append(h('div', { class: 'acc-input' }, input));
    if (hint) wrap.append(h('p', { class: 'acc-hint', id: id + '-hint', text: hint }));
    wrap.append(h('p', { class: 'acc-error', id: id + '-err', role: 'alert' }));
    return wrap;
  }
  function setErrors(form, fields = {}, message = '') {
    form.querySelectorAll('.acc-field').forEach((f) => { f.classList.remove('has-error'); f.querySelector('.acc-error').textContent = ''; f.querySelector('input')?.removeAttribute('aria-invalid'); });
    for (const [name, msg] of Object.entries(fields)) {
      const input = form.querySelector(`[name="${name}"]`); if (!input) continue;
      const f = input.closest('.acc-field'); f.classList.add('has-error'); f.querySelector('.acc-error').textContent = msg; input.setAttribute('aria-invalid', 'true');
    }
    const top = form.querySelector('.acc-form-error'); top.textContent = message; top.hidden = !message;
    const first = form.querySelector('[aria-invalid="true"]'); first?.focus();
  }
  async function post(path, body) {
    const res = await fetch('/api/account/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body || {}) });
    let data = {}; try { data = await res.json(); } catch {}
    if (!res.ok) { const err = new Error(data.error || 'تعذّر إتمام الطلب'); err.fields = data.fields || {}; throw err; }
    return data;
  }
  async function submit(form, path, body) {
    if (busy) return; busy = true;
    const btn = form.querySelector('.acc-submit'); btn.disabled = true; btn.classList.add('is-loading');
    try { await post(path, body); const me = await window.SkySession.refresh(); finish(me); }
    catch (err) { setErrors(form, err.fields, err.message); }
    finally { busy = false; btn.disabled = false; btn.classList.remove('is-loading'); }
  }
  function finish(me) { const cb = options.onDone; close(); cb?.(me); }

  function loginForm() {
    const form = h('form', { class: 'acc-form', novalidate: true, 'data-tab': 'login' },
      field({ name: 'username', label: 'اسم المستخدم أو البريد', auto: 'username', dir: 'ltr', max: 120 }),
      field({ name: 'password', label: 'كلمة المرور', type: 'password', auto: 'current-password', dir: 'ltr', max: 128 }),
      h('p', { class: 'acc-form-error', role: 'alert', hidden: true }),
      h('button', { type: 'submit', class: 'acc-submit', text: 'دخول' }),
      h('button', { type: 'button', class: 'acc-link acc-forgot', text: 'نسيت كلمة المرور؟' }));
    form.addEventListener('submit', (e) => { e.preventDefault(); const f = new FormData(form); submit(form, 'login', { username: f.get('username'), password: f.get('password') }); });
    form.querySelector('.acc-forgot').addEventListener('click', async () => {
      const f = new FormData(form);
      try {
        const r = await post('forgot', { identifier: f.get('username') });
        const box = form.querySelector('.acc-form-error'); box.hidden = false; box.classList.add('is-info'); box.textContent = r.message;
        if (r.support?.url) { const a = h('a', { href: r.support.url, target: '_blank', rel: 'noopener', class: 'acc-link', text: ' ' + r.support.label }); box.append(a); }
      } catch (err) { setErrors(form, {}, err.message); }
    });
    return form;
  }
  function registerForm() {
    const pw = field({ name: 'password', label: 'كلمة المرور', type: 'password', auto: 'new-password', dir: 'ltr', max: 128, hint: '8 أحرف على الأقل، مع حروف وأرقام' });
    const meter = h('div', { class: 'acc-meter', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
    const meterText = h('span', { class: 'acc-meter-text', 'aria-live': 'polite' });
    pw.insertBefore(h('div', { class: 'acc-strength' }, meter, meterText), pw.querySelector('.acc-error'));
    const input = pw.querySelector('input');
    input.addEventListener('input', () => {
      const s = input.value ? score(input.value) : 0;
      meter.dataset.score = String(s);
      meterText.textContent = input.value ? ['ضعيفة جدًا', 'ضعيفة', 'متوسطة', 'قوية', 'قوية جدًا'][s] : '';
    });
    const form = h('form', { class: 'acc-form', novalidate: true, 'data-tab': 'register' },
      field({ name: 'username', label: 'اسم المستخدم', auto: 'username', dir: 'ltr', max: 20, hint: 'حروف إنجليزية وأرقام و _ . (3–20)' }),
      field({ name: 'displayName', label: 'الاسم الظاهر', auto: 'nickname', max: 32 }),
      field({ name: 'email', label: 'البريد الإلكتروني', type: 'email', auto: 'email', dir: 'ltr', max: 120 }),
      pw,
      h('p', { class: 'acc-form-error', role: 'alert', hidden: true }),
      h('button', { type: 'submit', class: 'acc-submit', text: 'إنشاء الحساب' }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const fields = {};
      if (!/^[A-Za-z0-9_.]{3,20}$/.test(f.username || '')) fields.username = 'من 3 إلى 20 حرفًا إنجليزيًا أو رقمًا';
      if ((f.displayName || '').trim().length < 2) fields.displayName = 'اكتب اسمًا من حرفين على الأقل';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email || '')) fields.email = 'البريد غير صحيح';
      if ((f.password || '').length < 8) fields.password = '8 أحرف على الأقل'; else if (score(f.password) < 2) fields.password = 'كلمة المرور ضعيفة';
      if (Object.keys(fields).length) return setErrors(form, fields, '');
      submit(form, 'register', f);
    });
    return form;
  }
  function profile(me) {
    const u = me.user;
    const obs = location.origin + '/overlay?room=' + encodeURIComponent(me.room || '');
    const copy = h('button', { type: 'button', class: 'acc-copy', text: 'نسخ' });
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(obs); copy.textContent = 'تم النسخ'; } catch { copy.textContent = 'انسخه يدويًا'; } });
    const logout = h('button', { type: 'button', class: 'acc-ghost', text: 'تسجيل الخروج' });
    logout.addEventListener('click', async () => { await window.SkySession.logout(); finish(window.SkySession.me()); });
    const plan = u ? 'كل الألعاب مجانية — اختر لعبة وابدأ' : 'سجّل الدخول لتشغيل الألعاب مجانًا';
    return h('div', { class: 'acc-profile' },
      h('div', { class: 'acc-avatar', 'aria-hidden': 'true', text: Array.from((u?.displayName || 'زائر').trim())[0] }),
      h('strong', { class: 'acc-name', text: u ? u.displayName : 'زائر' }),
      u ? h('span', { class: 'acc-handle', dir: 'ltr', text: '@' + u.username }) : null,
      h('p', { class: 'acc-plan' + (u?.planActive ? ' is-active' : ''), text: plan }),
      h('label', { class: 'acc-obs-label', for: 'acc-obs', text: 'رابط شاشة البث الخاصة بك (OBS)' }),
      h('div', { class: 'acc-obs' }, h('input', { id: 'acc-obs', value: obs, readonly: true, dir: 'ltr' }), copy),
      h('a', { class: 'acc-submit', href: '/games', text: 'اختر لعبة' }),
      logout);
  }
  function build(me) {
    const closeBtn = h('button', { type: 'button', class: 'acc-close', 'aria-label': 'إغلاق' }, icon('close'));
    closeBtn.addEventListener('click', close);
    const head = h('header', { class: 'acc-head' },
      h('img', { src: '/sponge-mark.svg', alt: '', width: '56', height: '56' }),
      h('h2', { id: 'accTitle', dir: 'ltr', text: 'سبونج لايف' }),
      h('p', { text: me.user || me.guest ? 'حسابك وغرفتك الخاصة' : 'ادخل لتشغيل ألعاب البث المباشر بغرفتك الخاصة' }));
    const body = h('div', { class: 'acc-body' });
    if (me.user || me.guest) {
      body.append(profile(me));
      if (me.guest) {
        const up = h('button', { type: 'button', class: 'acc-link', text: 'أنشئ حسابًا لحفظ غرفتك' });
        up.addEventListener('click', () => render({ ...me, user: null, guest: false }, 'register'));
        body.append(up);
      }
    } else {
      const tabs = h('div', { class: 'acc-tabs', role: 'tablist', 'aria-label': 'نوع الدخول' });
      const panels = {};
      for (const [key, label, make] of [['login', 'دخول', loginForm], ['register', 'إنشاء حساب', registerForm]]) {
        const tab = h('button', { type: 'button', role: 'tab', id: 'acc-tab-' + key, 'aria-controls': 'acc-panel-' + key, class: 'acc-tab', text: label });
        const panel = h('div', { role: 'tabpanel', id: 'acc-panel-' + key, 'aria-labelledby': 'acc-tab-' + key }, make());
        tab.addEventListener('click', () => select(key));
        tab.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); select(key === 'login' ? 'register' : 'login', true); } });
        tabs.append(tab); panels[key] = { tab, panel };
      }
      function select(key, focus) {
        for (const [k, { tab, panel }] of Object.entries(panels)) { const on = k === key; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; panel.hidden = !on; }
        if (focus) panels[key].tab.focus();
      }
      body.append(tabs, panels.login.panel, panels.register.panel);
      select(options.tab === 'register' ? 'register' : 'login');
      if (options.guest !== false) {
        const guest = h('button', { type: 'button', class: 'acc-guest' }, icon('user-plus'), h('span', { text: 'المتابعة كزائر — غرفة تجريبية' }));
        guest.addEventListener('click', async () => { guest.disabled = true; try { await post('guest'); finish(await window.SkySession.refresh()); } catch (err) { guest.disabled = false; alertBox(body, err.message); } });
        body.append(h('div', { class: 'acc-or', text: 'أو' }), guest);
      }
    }
    return h('div', { class: 'acc-panel' }, closeBtn, head, body);
  }
  function alertBox(body, msg) { const p = body.querySelector('.acc-form-error:not([hidden])') || body.querySelector('.acc-form-error'); if (p) { p.hidden = false; p.textContent = msg; } }
  function render(me, tab) {
    if (tab) options.tab = tab;
    dialog.replaceChildren(build(me));
    const first = dialog.querySelector('[aria-selected="true"]') ? dialog.querySelector('[role="tabpanel"]:not([hidden]) input') : dialog.querySelector('.acc-submit, a, button:not(.acc-close)');
    requestAnimationFrame(() => first?.focus());
  }
  function trap(e) {
    if (e.key !== 'Tab' || !dialog?.open) return;
    const items = [...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),[tabindex="0"]')].filter((x) => x.offsetParent !== null && !x.closest('[hidden]'));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && d.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  async function open(opts = {}) {
    options = opts; opener = d.activeElement;
    if (!dialog) {
      dialog = h('dialog', { class: 'acc-dialog', 'aria-labelledby': 'accTitle' });
      d.body.append(dialog);
      dialog.addEventListener('keydown', trap);
      dialog.addEventListener('close', () => { opener?.focus?.(); });
      dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
    }
    const me = await window.SkySession.ready.then(() => window.SkySession.me());
    render(me);
    if (!dialog.open) dialog.showModal();
  }
  function close() { if (dialog?.open) dialog.close(); }
  window.SkyAccount = Object.freeze({ open, close });
})();
