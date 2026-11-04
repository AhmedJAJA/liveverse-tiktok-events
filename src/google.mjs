// SPONGE LIVE — verify Google ID tokens (Google Identity Services / OpenID Connect) on the server.
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
