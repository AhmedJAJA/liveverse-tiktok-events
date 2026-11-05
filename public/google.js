/* SPONGE LIVE — «المتابعة باستخدام Google».
   When the server has Google's code flow configured (client secret on the server only), the button is our own, built
   to Google's branding rules (white, the official four-colour G): a click sends the whole page to Google and back to
   /api/oauth/google/callback, where the server checks everything and opens the session. Otherwise Google's own
   button (Google Identity Services) is shown and its ID token is checked by the server. No secret lives here. */
(() => {
  'use strict';
  let cfgP = null;
  const config = () => (cfgP ||= fetch('/api/auth/google', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json()).catch(() => ({ enabled: false })));
  let gisLoading = null;
  function loadGis() {
    if (window.google?.accounts?.id) return Promise.resolve();
    if (gisLoading) return gisLoading;
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = resolve; s.onerror = () => { gisLoading = null; reject(new Error('gis')); };
      document.head.append(s);
    });
    return gisLoading;
  }
  const LABEL = { login: 'المتابعة باستخدام Google', link: 'ربط حساب Google', reauth: 'التأكيد عبر Google' };
  /** Our button (code flow). opts.mode: login | link | reauth; opts.next: where to land; opts.remember(): «تذكرني»;
      opts.before(): an async check that may cancel (e.g. confirm the password first). */
  function codeButton(box, opts) {
    const a = document.createElement('a');
    a.className = 'gbtn'; a.setAttribute('role', 'button');
    const logo = document.createElement('img'); logo.className = 'gbtn-g'; logo.src = '/brand/google-g.svg'; logo.alt = ''; logo.width = 20; logo.height = 20;
    const text = document.createElement('span'); text.className = 'gbtn-t'; text.textContent = opts.label || LABEL[opts.mode] || LABEL.login;
    const spin = document.createElement('i'); spin.className = 'gbtn-spin'; spin.setAttribute('aria-hidden', 'true');
    a.append(logo, text, spin);
    const status = document.createElement('p'); status.className = 'gbtn-status'; status.setAttribute('role', 'status'); status.hidden = true;
    const href = () => { const q = new URLSearchParams({ mode: opts.mode || 'login' }); if (opts.next) q.set('next', opts.next); if (opts.remember && !opts.remember()) q.set('remember', '0'); return '/api/oauth/google/start?' + q; };
    a.href = href();
    const reset = () => { a.classList.remove('is-busy'); a.removeAttribute('aria-disabled'); status.hidden = true; };
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      if (a.classList.contains('is-busy')) return; // one click = one sign-in
      if (opts.before && !(await opts.before())) return;
      a.classList.add('is-busy'); a.setAttribute('aria-disabled', 'true');
      status.textContent = 'جاري توجيهك إلى Google…'; status.hidden = false;
      location.assign(href());
    });
    addEventListener('pageshow', (e) => { if (e.persisted) reset(); }); // back from Google without finishing
    box.replaceChildren(a, status);
    box.hidden = false;
  }
  /**
   * Show the Google button in `box`. `onCredential(token)` is used only by the fallback (Google's own button).
   * Returns false (box stays hidden) when Google sign-in is not configured.
   */
  async function render(box, onCredential, opts = {}) {
    box.hidden = true;
    const cfg = await config();
    if (!cfg.enabled) return false;
    if (cfg.codeFlow) { codeButton(box, opts); return true; }
    try { await loadGis(); } catch { return false; }
    window.google.accounts.id.initialize({ client_id: cfg.clientId, nonce: cfg.nonce, callback: (r) => r?.credential && onCredential(r.credential), ux_mode: 'popup', context: 'signin', itp_support: true });
    const holder = document.createElement('div'); holder.className = 'gis-holder';
    box.replaceChildren(holder);
    box.hidden = false;
    window.google.accounts.id.renderButton(holder, { type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: opts.text || 'continue_with', locale: 'ar', logo_alignment: 'center', width: Math.min(box.clientWidth || 320, 400) });
    return true;
  }
  /** Fallback only: send Google's ID token to the server (sign in / sign up, or link to the signed-in account). */
  async function signIn(credential, { link = false, remember = true } = {}) {
    const res = await fetch(link ? '/api/me/link-google' : '/api/auth/google', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential, link, remember }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'تعذر تسجيل الدخول باستخدام Google'), { data, status: res.status });
    return data;
  }
  /** Messages for /login?google_error=… and /account?google_error=… (set by the server). */
  const ERRORS = {
    cancelled: 'تم إلغاء تسجيل الدخول.',
    denied: 'تعذر تسجيل الدخول باستخدام Google — لم تُمنح الموافقة.',
    expired: 'انتهت صلاحية محاولة تسجيل الدخول. حاول مرة أخرى.',
    state: 'تعذر التحقق من محاولة تسجيل الدخول — ابدأ من جديد في نفس المتصفح.',
    verify: 'تعذر التحقق من الحساب.',
    temporary: 'حدث خطأ مؤقت، حاول مرة أخرى.',
    busy: 'محاولات كثيرة. انتظر قليلًا ثم حاول.',
    unavailable: 'تسجيل الدخول باستخدام Google غير مفعّل على الموقع بعد.',
    no_email: 'حساب Google لا يشارك بريدًا إلكترونيًا — اسمح بمشاركة البريد وحاول مرة أخرى.',
    disabled: 'هذا الحساب موقوف. تواصل مع الدعم.',
    taken: 'حساب Google هذا مرتبط بحساب SPONGE LIVE آخر.',
    other_google: 'حسابك مرتبط بحساب Google آخر — استخدم الحساب المرتبط.',
    reauth: 'أكّد هويتك أولًا ثم اربط Google.',
    link_needed: 'الحساب مرتبط بطريقة تسجيل دخول أخرى: يوجد حساب SPONGE LIVE بهذا البريد. سجّل الدخول بكلمة المرور الآن وسيُربط Google به تلقائيًا — حسابك ومعرّفك وبياناتك كما هي.',
  };
  window.SpongeGoogle = { render, signIn, config, ERRORS };
})();
