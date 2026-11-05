/* سبونج لايف — sign in / sign up / forgot / reset. The server creates the account, its permanent ID and the session;
   this page only shows what the server answered (nothing is "signed in" here before the server says so). */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const MODES = { '/login': 'login', '/signup': 'signup', '/forgot': 'forgot', '/reset': 'reset' };
  const mode = MODES[location.pathname] || 'login';
  document.body.dataset.mode = mode;
  const safeNext = (n) => (n && /^\/(account|game\/|games|admin|u\/|go\/|tools|event|#games)(?:[/?#A-Za-z0-9_=&.%-]*)$/.test(n) && !n.startsWith('//') ? n : null);
  const next = safeNext(params.get('next'));
  const intent = params.get('intent') || (params.get('trial') === '1' ? 'trial' : '');
  const wantsTrial = intent === 'trial';
  const keep = location.search;

  // tabs and links keep ?next / ?intent
  for (const a of [$('tabLogin'), $('tabSignup'), $('toSignup'), $('toLogin'), $('forgotLink')]) if (a) a.href = a.getAttribute('href') + keep;
  const forms = { login: 'loginForm', signup: 'signupForm', forgot: 'forgotForm', reset: 'resetForm' };
  for (const [m, id] of Object.entries(forms)) $(id).hidden = m !== mode;
  if (mode === 'login' || mode === 'signup') $(mode === 'login' ? 'tabLogin' : 'tabSignup').setAttribute('aria-current', 'page');
  const TITLES = { login: ['مرحباً بك في سبونج لايف', 'سجّل دخولك وابدأ تجربة ألعاب البث المباشر، واجمع السكنات والمكافآت، ونافس اللاعبين.', 'تسجيل الدخول'],
    signup: ['أنشئ حسابك في سبونج لايف', 'حساب واحد لألعاب بثّك وسكناتك وعملاتك — بمعرّف دائم لا يتغير.', 'إنشاء حساب'],
    forgot: ['نسيت كلمة المرور؟', 'اكتب بريدك أو اسم المستخدم وسنرسل لك رابطًا لتعيين كلمة مرور جديدة.', 'استعادة كلمة المرور'],
    reset: ['كلمة مرور جديدة', 'اختر كلمة مرور جديدة لحسابك — ستُسجّل خارج الأجهزة الأخرى.', 'تعيين كلمة المرور'] };
  $('authTitle').textContent = TITLES[mode][0]; $('authSub').textContent = TITLES[mode][1];
  document.title = TITLES[mode][2] + ' — سبونج لايف';

  function notice(text, kind = 'is-info') { const n = $('authNotice'); n.textContent = text || ''; n.className = 'pg-msg ' + kind; n.hidden = !text; }
  function gError(text) { $('googleError').textContent = text || ''; $('googleError').hidden = !text; }
  if (intent === 'studio' || wantsTrial) notice('سجّل الدخول وابدأ اللعب — كل الألعاب مجانية.');
  if (params.get('reset') === '1') notice('تم تعيين كلمة المرور الجديدة ✓ سجّل الدخول بها الآن.', 'is-ok');
  if (params.get('signed_out') === '1') notice('تم تسجيل خروجك، يرجى تسجيل الدخول مجدداً.');
  // back from Google with a problem (the server decided; the message explains what to do)
  const ge = params.get('google_error');
  if (ge) {
    const msg = window.SpongeGoogle?.ERRORS?.[ge] || 'تعذر تسجيل الدخول باستخدام Google.';
    if (ge === 'link_needed') notice(msg); else gError(msg);
    history.replaceState(null, '', location.pathname + (next ? '?next=' + encodeURIComponent(next) : ''));
  }
  const remember = () => (mode === 'signup' ? $('rememberSignup') : $('rememberMe')).checked;

  /** After a successful sign-in/up: carry on with what the visitor came to do (every game is free). */
  async function continueIntent(data) {
    const go = (u) => location.replace(u);
    if (next) return go(next);
    if (intent === 'studio' || wantsTrial) return go('/games');
    return go(data.next || '/games');
  }

  // «المتابعة باستخدام Google»
  if ((mode === 'login' || mode === 'signup') && window.SpongeGoogle) {
    window.SpongeGoogle.render($('googleBox'), async (credential) => {
      gError('');
      try { await continueIntent(await window.SpongeGoogle.signIn(credential, { remember: remember() })); }
      catch (err) { if (err.data?.needsLink) notice(window.SpongeGoogle.ERRORS.link_needed); else gError(err.message); }
    }, { mode: 'login', next: next || (wantsTrial ? '' : ''), remember, text: mode === 'login' ? 'signin_with' : 'signup_with' }).then((shown) => { $('googleOr').hidden = !shown; });
  }

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
      const missing = Object.fromEntries(Object.entries(body).filter(([k, v]) => !v && k !== 'remember' && k !== 'token').map(([k]) => [k, 'مطلوب']));
      if (Object.keys(missing).length) { showFields(form, missing); return; }
      busy = true; const btn = form.querySelector('button[type="submit"]'); btn.disabled = true; errorEl.hidden = true; showFields(form, {});
      try {
        const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (res.ok) { await after(data); return; }
        errorEl.textContent = res.status === 429 ? (data.error || 'محاولات كثيرة. انتظر قليلًا ثم حاول.') : res.status >= 500 ? 'حدث خطأ مؤقت، حاول مرة أخرى.' : (data.error || 'تعذر إتمام الطلب'); errorEl.hidden = false;
        if (data.fields) showFields(form, data.fields);
      } catch { errorEl.textContent = 'تعذر الاتصال بالخادم. تحقق من الإنترنت ثم حاول.'; errorEl.hidden = false; }
      finally { busy = false; btn.disabled = false; }
    });
  }
  const val = (f, n) => f.elements[n].value;
  bind($('signupForm'), $('signupError'), '/api/auth/register',
    (f) => ({ username: val(f, 'username').trim().toLowerCase(), email: val(f, 'email').trim(), password: val(f, 'password'), confirm: val(f, 'confirm'), remember: remember() }),
    (d) => (intent || next ? continueIntent(d) : location.replace('/account?welcome=1')));
  bind($('loginForm'), $('loginError'), '/api/auth/login',
    (f) => ({ identifier: val(f, 'identifier').trim(), password: val(f, 'password'), remember: remember() }),
    async (d) => { if (d.googleLinked) { notice('تم ربط حساب Google بحسابك ✓', 'is-ok'); await new Promise((r) => setTimeout(r, 900)); } return continueIntent(d); });
  bind($('forgotForm'), $('forgotError'), '/api/auth/forgot',
    (f) => ({ identifier: val(f, 'identifier').trim() }),
    (d) => {
      const done = $('forgotDone');
      done.textContent = d.mail ? 'إذا كان هذا الحساب موجودًا فستصلك رسالة فيها رابط صالح لمدة 30 دقيقة. تحقق من البريد والرسائل غير المرغوبة.'
        : 'إرسال البريد غير مفعّل على الموقع بعد: تواصل مع فريق سبونج لايف عبر واتساب باسم المستخدم أو البريد المسجّل، وسنرسل لك رابطًا آمنًا لتعيين كلمة مرور جديدة.';
      done.hidden = false;
      if (!d.mail && /^https:\/\//.test(d.support?.url || '')) { const a = document.createElement('a'); a.href = d.support.url; a.target = '_blank'; a.rel = 'noopener'; a.className = 'au-link'; a.textContent = ' تواصل عبر واتساب'; done.append(a); }
    });
  const token = params.get('token') || '';
  if (mode === 'reset') { history.replaceState(null, '', '/reset'); if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) { $('resetError').textContent = 'الرابط غير صالح — اطلب رابطًا جديدًا من «نسيت كلمة المرور».'; $('resetError').hidden = false; } }
  bind($('resetForm'), $('resetError'), '/api/auth/reset',
    (f) => ({ token, password: val(f, 'password'), confirm: val(f, 'confirm') }),
    (d) => location.replace(d.next || '/login?reset=1'));
})();
