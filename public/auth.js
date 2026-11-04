/* SPONGE LIVE — sign up / sign in. The server creates the account, its permanent ID and the session. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const isLogin = location.pathname === '/login';
  const safeNext = (n) => (n && /^\/(account|studio|admin)(?:[/?#]|$)/.test(n) ? n : null);
  const next = safeNext(params.get('next'));
  const intent = params.get('intent') || (params.get('trial') === '1' ? 'trial' : '');
  const wantsTrial = intent === 'trial';

  $(isLogin ? 'tabLogin' : 'tabSignup').setAttribute('aria-current', 'page');
  for (const a of [$('tabLogin'), $('tabSignup')]) a.href += location.search;
  $('authTitle').textContent = isLogin ? 'تسجيل الدخول' : 'إنشاء حساب جديد';
  document.title = $('authTitle').textContent + ' — SPONGE LIVE';
  if (isLogin) { $('authSub').textContent = 'ادخل باسم المستخدم أو البريد الإلكتروني.'; $('signupForm').hidden = true; $('loginForm').hidden = false; }
  if (wantsTrial) notice(isLogin ? 'سجّل الدخول وتبدأ تجربتك المجانية لمدة 24 ساعة مباشرة.' : 'أنشئ حسابك وتبدأ تجربتك المجانية لمدة 24 ساعة مباشرة.');
  else if (intent === 'studio') notice('سجّل الدخول لدخول الاستوديو.');

  /** After a successful sign-in/up: carry on with what the visitor came to do. The server decides access. */
  async function continueIntent(data) {
    const go = (u) => location.replace(u);
    if (next) return go(next);
    if (wantsTrial) {
      if (data.account?.entitled) return go('/studio');
      const res = await fetch('/api/me/trial-start', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const r = await res.json().catch(() => ({}));
      if (res.ok) { if (r.started) notice('تم تفعيل تجربتك المجانية بنجاح ✓ جارٍ فتح الاستوديو…'); return setTimeout(() => go('/studio'), r.started ? 1200 : 0); }
      if (res.status === 409) return go('/account?need=plan');
      if (res.status === 403) return go('/account?verify=trial');
      return go('/account');
    }
    if (intent === 'studio') return go(data.account?.entitled ? '/studio' : '/account?need=plan');
    return go(data.next || '/account');
  }

  // «المتابعة باستخدام Google»: the button appears only when Google sign-in is configured on the server.
  if (window.SpongeGoogle) window.SpongeGoogle.render($('googleBox'), async (credential) => {
    $('googleError').hidden = true;
    try { await continueIntent(await window.SpongeGoogle.signIn(credential)); }
    catch (err) { $('googleError').textContent = err.message; $('googleError').hidden = false; }
  }, { text: isLogin ? 'signin_with' : 'signup_with' }).then((shown) => { $('googleOr').hidden = !shown; });

  function notice(text) { $('authNotice').textContent = text; $('authNotice').hidden = !text; }
  fetch('/api/auth/config', { cache: 'no-store' }).then((r) => r.json()).then((c) => {
    if (!c.enabled) { notice('الحسابات غير مفعّلة على هذا الخادم بعد. يمكنك الدخول بالرمز الترويجي من الصفحة الرئيسية.'); for (const b of document.querySelectorAll('.pg-form button')) b.disabled = true; }
  }).catch(() => {});

  function showFields(form, fields = {}) {
    for (const em of form.querySelectorAll('.pg-ferr')) {
      const msg = fields[em.dataset.for]; em.textContent = msg || ''; em.hidden = !msg;
      form.elements[em.dataset.for]?.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }
    const first = Object.keys(fields)[0]; if (first) form.elements[first]?.focus();
  }
  function bind(form, errorEl, url, payload, after) {
    let busy = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      const body = payload(form);
      const missing = Object.fromEntries(Object.entries(body).filter(([, v]) => !v).map(([k]) => [k, 'مطلوب']));
      if (Object.keys(missing).length) { showFields(form, missing); return; }
      busy = true; const btn = form.querySelector('button[type="submit"]'); btn.disabled = true; errorEl.hidden = true; showFields(form, {});
      try {
        const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (res.ok) { after(data); return; }
        errorEl.textContent = data.error || 'تعذر إتمام الطلب'; errorEl.hidden = false;
        if (data.fields) showFields(form, data.fields);
      } catch { errorEl.textContent = 'تعذر الاتصال بالخادم. تحقق من الإنترنت.'; errorEl.hidden = false; }
      finally { busy = false; btn.disabled = false; }
    });
  }
  const val = (f, n) => f.elements[n].value;
  bind($('signupForm'), $('signupError'), '/api/auth/register',
    (f) => ({ username: val(f, 'username').trim().toLowerCase(), email: val(f, 'email').trim(), password: val(f, 'password'), confirm: val(f, 'confirm') }),
    (d) => (intent ? continueIntent(d) : location.replace(d.next || '/account?welcome=1')));
  bind($('loginForm'), $('loginError'), '/api/auth/login',
    (f) => ({ identifier: val(f, 'identifier').trim(), password: val(f, 'password') }),
    (d) => continueIntent(d));
})();
