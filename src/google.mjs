// سبونج لايف — verify Google ID tokens (Google Identity Services / OpenID Connect) on the server.
// Checks: RS256 signature against Google's published keys, issuer, audience (our client ID), expiry,
// issue time, and the nonce bound to this browser. Only the stable subject ID ("sub") identifies the person.
import { createPublicKey, createVerify } from 'node:crypto';

const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const SKEW_S = 60;

export class GoogleVerifier {
  constructor({ clientId, jwksUrl = 'https://www.googleapis.com/oauth2/v3/certs', now = () => Date.now(), fetchImpl = fetch } = {}) {
    this.clientId = clientId; this.jwksUrl = jwksUrl; this.now = now; this.fetch = fetchImpl;
    this.keys = new Map(); this.expires = 0; this.loading = null;
  }
  get enabled() { return !!this.clientId; }

  async loadKeys(force = false) {
    if (!force && this.keys.size && this.now() < this.expires) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const res = await this.fetch(this.jwksUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error('google keys ' + res.status);
      const { keys = [] } = await res.json();
      const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1]) || 3600;
      this.keys = new Map(keys.filter((k) => k.kty === 'RSA' && k.kid).map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })]));
      this.expires = this.now() + Math.min(maxAge, 86400) * 1000;
    })().finally(() => { this.loading = null; });
    return this.loading;
  }

  /** Returns the verified identity or throws. */
  async verify(idToken, { nonce } = {}) {
    if (!this.enabled) throw new Error('google sign-in is not configured');
    const parts = String(idToken || '').split('.');
    if (parts.length !== 3 || parts.some((p) => !/^[\w-]+$/.test(p))) throw new Error('malformed token');
    const decode = (p) => JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    const header = decode(parts[0]), claims = decode(parts[1]);
    if (header.alg !== 'RS256' || !header.kid) throw new Error('unexpected token algorithm');
    await this.loadKeys();
    let key = this.keys.get(header.kid);
    if (!key) { await this.loadKeys(true); key = this.keys.get(header.kid); } // Google rotated its keys
    if (!key) throw new Error('unknown signing key');
    const ok = createVerify('RSA-SHA256').update(parts[0] + '.' + parts[1]).verify(key, Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new Error('bad signature');
    const t = Math.floor(this.now() / 1000);
    if (!ISSUERS.has(claims.iss)) throw new Error('wrong issuer');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(this.clientId)) throw new Error('wrong audience');
    if (!(Number(claims.exp) > t - SKEW_S)) throw new Error('token expired');
    if (Number(claims.iat) > t + SKEW_S) throw new Error('token issued in the future');
    if (nonce !== undefined && (!claims.nonce || claims.nonce !== nonce)) throw new Error('nonce mismatch');
    if (!claims.sub || typeof claims.sub !== 'string') throw new Error('missing subject');
    return {
      sub: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : '',
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      name: typeof claims.name === 'string' ? claims.name : '',
      picture: typeof claims.picture === 'string' ? claims.picture : '',
    };
  }
}

/**
 * «المتابعة باستخدام Google» as a full-page OpenID Connect Authorization Code flow (no popup, works in mobile
 * browsers): our server sends the browser to Google with state (CSRF), nonce and PKCE (S256); Google sends it back
 * with a one-time code; the server exchanges the code with the client secret (never sent to the browser) and
 * verifies the returned ID token with GoogleVerifier (signature, issuer, audience, expiry, nonce).
 */
export class GoogleOAuth {
  constructor({ clientId, clientSecret, verifier, authUrl = 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl = 'https://oauth2.googleapis.com/token', fetchImpl = fetch } = {}) {
    this.clientId = clientId || ''; this.clientSecret = clientSecret || ''; this.verifier = verifier;
    this.authUrl = authUrl; this.tokenUrl = tokenUrl; this.fetch = fetchImpl;
  }
  get enabled() { return !!(this.clientId && this.clientSecret && this.verifier?.enabled); }
  authorizeUrl({ redirectUri, state, challenge, nonce, loginHint = '' }) {
    const q = new URLSearchParams({ client_id: this.clientId, response_type: 'code', scope: 'openid email profile', redirect_uri: redirectUri,
      state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account', include_granted_scopes: 'false', access_type: 'online' });
    if (loginHint) q.set('login_hint', loginHint);
    return this.authUrl + '?' + q;
  }
  /** Exchange the one-time code; returns the verified identity (throws on any problem). */
  async exchange({ code, codeVerifier, redirectUri, nonce }) {
    if (!this.enabled) throw new Error('google code flow is not configured');
    if (!code || typeof code !== 'string' || code.length > 2048) throw new Error('missing code');
    const res = await this.fetch(this.tokenUrl, { method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ code, client_id: this.clientId, client_secret: this.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: codeVerifier }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id_token) throw Object.assign(new Error('token exchange failed: ' + (data.error || res.status)), { code: data.error === 'invalid_grant' ? 'expired' : 'temporary' });
    // only the ID token is used; Google's access token is never kept or used as our session
    return this.verifier.verify(data.id_token, { nonce });
  }
}
