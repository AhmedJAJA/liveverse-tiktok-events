/* SPONGE LIVE — "المتابعة باستخدام Google" button (Google Identity Services).
   The page never trusts Google's answer itself: the ID token goes to our server, which checks the
   signature, audience, issuer, expiry and the nonce bound to this browser. No secrets live here. */
(() => {
  'use strict';
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
  /**
   * Render Google's official button into `box`. `onCredential(token)` receives the ID token.
   * Returns false (and leaves the box hidden) when Google sign-in is not configured on the server.
   */
  async function render(box, onCredential, { text = 'continue_with' } = {}) {
    box.hidden = true;
    let cfg;
    try { cfg = await fetch('/api/auth/google', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json()); } catch { return false; }
    if (!cfg.enabled) return false;
    try { await loadGis(); } catch { return false; }
    window.google.accounts.id.initialize({ client_id: cfg.clientId, nonce: cfg.nonce, callback: (r) => r?.credential && onCredential(r.credential), ux_mode: 'popup', context: 'signin', itp_support: true });
    box.replaceChildren();
    box.hidden = false;
    window.google.accounts.id.renderButton(box, { type: 'standard', theme: 'filled_black', size: 'large', shape: 'pill', text, locale: 'ar', width: Math.min(box.clientWidth || 320, 400) });
    return true;
  }
  /** Send the token to the server: sign in / sign up, or link to the signed-in account. */
  async function signIn(credential, { link = false } = {}) {
    const res = await fetch(link ? '/api/me/link-google' : '/api/auth/google', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential, link }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'تعذر تسجيل الدخول باستخدام Google'), { data, status: res.status });
    return data;
  }
  window.SpongeGoogle = { render, signIn };
})();
