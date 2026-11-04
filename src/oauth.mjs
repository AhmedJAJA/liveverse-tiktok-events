// SPONGE LIVE — official sign-in with the streaming platforms (no typed usernames).
//   TikTok: Login Kit for Web, OAuth 2.0 Authorization Code (+ state); scopes user.info.basic,user.info.profile.
//   Kick:   OAuth 2.1 Authorization Code + PKCE (S256); scopes user:read channel:read events:subscribe.
// Tokens never reach the browser: they are encrypted (AES-256-GCM, key from TOKEN_ENC_KEY) before they are stored.
// Signing in with a platform proves who owns the account; reading LIVE chat is a separate path (see server.mjs).
import { createCipheriv, createDecipheriv, createHash, createVerify, randomBytes } from 'node:crypto';

const test = process.env.NODE_ENV === 'test';
/** Endpoints; tests point them at a local stand-in (never outside NODE_ENV=test). */
const url = (name, real) => (test && process.env[name]) || real;
export const ENDPOINTS = {
  tiktok: {
    authorize: url('TIKTOK_AUTH_URL', 'https://www.tiktok.com/v2/auth/authorize/'),
    token: url('TIKTOK_TOKEN_URL', 'https://open.tiktokapis.com/v2/oauth/token/'),
    revoke: url('TIKTOK_REVOKE_URL', 'https://open.tiktokapis.com/v2/oauth/revoke/'),
    userinfo: url('TIKTOK_USERINFO_URL', 'https://open.tiktokapis.com/v2/user/info/'),
  },
  kick: {
    authorize: url('KICK_AUTH_URL', 'https://id.kick.com/oauth/authorize'),
    token: url('KICK_TOKEN_URL', 'https://id.kick.com/oauth/token'),
    revoke: url('KICK_REVOKE_URL', 'https://id.kick.com/oauth/revoke'),
    api: url('KICK_PUBLIC_API', 'https://api.kick.com/public/v1'),
  },
};
export const SCOPES = { tiktok: 'user.info.basic,user.info.profile', kick: 'user:read channel:read events:subscribe' };

export class OAuthError extends Error { constructor(message, code = 'oauth', status = 400) { super(message); this.code = code; this.status = status; } }

/* ------------------------------------------------------------------ token encryption */
export class TokenBox {
  constructor(keyB64 = process.env.TOKEN_ENC_KEY || '') {
    const key = Buffer.from(String(keyB64), 'base64');
    this.key = key.length === 32 ? key : null;
  }
  get ready() { return !!this.key; }
  seal(plain) {
    if (!this.key) throw new OAuthError('مفتاح تشفير الرموز غير مضبوط على الخادم', 'config', 503);
    if (!plain) return null;
    const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', this.key, iv);
    const out = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return 'v1.' + Buffer.concat([iv, c.getAuthTag(), out]).toString('base64');
  }
  open(sealed) {
    if (!sealed || !this.key) return null;
    try {
      const raw = Buffer.from(String(sealed).replace(/^v1\./, ''), 'base64');
      const d = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12)); d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
    } catch { return null; }
  }
}

/* ------------------------------------------------------------------ providers */
const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const pkcePair = () => { const verifier = b64url(randomBytes(48)); return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }; };

async function postForm(href, fields, fetchImpl) {
  let res;
  try { res = await fetchImpl(href, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(10_000) }); }
  catch { throw new OAuthError('تعذر الوصول إلى خادم المنصة', 'network', 502); }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
async function getJson(href, token, fetchImpl, init = {}) {
  let res;
  try { res = await fetchImpl(href, { ...init, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) }, signal: AbortSignal.timeout(10_000) }); }
  catch { throw new OAuthError('تعذر الوصول إلى خادم المنصة', 'network', 502); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new OAuthError('انتهى تفويض المنصة — أعد ربط حسابك', 'unauthorized', 401);
  return { ok: res.ok, status: res.status, data };
}
/** Normalised token response: { accessToken, refreshToken, expiresAt, refreshExpiresAt, scope, platformUserId? } */
function tokens(d, now) {
  if (!d.access_token) throw new OAuthError('رفضت المنصة رمز التفويض', 'token', 400);
  return {
    accessToken: String(d.access_token), refreshToken: d.refresh_token ? String(d.refresh_token) : null,
    expiresAt: now + Math.max(60, Number(d.expires_in) || 3600) * 1000,
    refreshExpiresAt: d.refresh_expires_in ? now + Number(d.refresh_expires_in) * 1000 : null,
    scope: String(d.scope || ''), platformUserId: d.open_id ? String(d.open_id) : null,
  };
}

export class Providers {
  constructor({ appUrl = '', fetchImpl = globalThis.fetch, now = () => Date.now(), env = process.env } = {}) {
    this.appUrl = String(appUrl).replace(/\/$/, ''); this.fetch = fetchImpl; this.now = now;
    this.cfg = {
      // Trimmed: values pasted into a dashboard often carry a stray space or newline.
      tiktok: { id: String(env.TIKTOK_CLIENT_KEY || '').trim(), secret: String(env.TIKTOK_CLIENT_SECRET || '').trim() },
      kick: { id: String(env.KICK_CLIENT_ID || '').trim(), secret: String(env.KICK_CLIENT_SECRET || '').trim() },
    };
    this.kickKey = null; this.kickKeyAt = 0;
  }
  enabled(p) { return !!(this.cfg[p]?.id && this.cfg[p]?.secret); }
  status() { return { tiktok: this.enabled('tiktok'), kick: this.enabled('kick'), twitch: false }; }
  redirectUri(p) { return this.appUrl + '/api/oauth/' + p + '/callback'; }

  /** Where the browser goes to sign in with the platform. */
  authorizeUrl(p, { state, challenge }) {
    const c = this.cfg[p];
    if (p === 'tiktok') {
      const q = new URLSearchParams({ client_key: c.id, response_type: 'code', scope: SCOPES.tiktok, redirect_uri: this.redirectUri(p), state });
      return ENDPOINTS.tiktok.authorize + '?' + q;
    }
    const q = new URLSearchParams({ client_id: c.id, response_type: 'code', redirect_uri: this.redirectUri(p), scope: SCOPES.kick, state, code_challenge: challenge, code_challenge_method: 'S256' });
    return ENDPOINTS.kick.authorize + '?' + q;
  }
  async exchange(p, { code, verifier }) {
    const c = this.cfg[p], now = this.now();
    const fields = p === 'tiktok'
      ? { client_key: c.id, client_secret: c.secret, code, grant_type: 'authorization_code', redirect_uri: this.redirectUri(p) }
      : { client_id: c.id, client_secret: c.secret, code, grant_type: 'authorization_code', redirect_uri: this.redirectUri(p), code_verifier: verifier };
    const r = await postForm(ENDPOINTS[p].token, fields, this.fetch);
    if (!r.ok || r.data.error) {
      // The provider's own error code helps tell a wrong key from an expired code; it carries no secrets.
      const d = r.data || {}, clip = (v) => String(v ?? '').replace(/[^\w .:/-]/g, '').slice(0, 160);
      console.warn('[oauth] ' + p + ' token exchange refused: status=' + r.status + ' error=' + clip(d.error?.code || d.error) + ' description=' + clip(d.error_description || d.error?.message || d.message) + ' log_id=' + clip(d.log_id));
      throw new OAuthError('تعذر إكمال التفويض مع المنصة', 'token', 400);
    }
    return tokens(r.data, now);
  }
  async refresh(p, refreshToken) {
    const c = this.cfg[p], now = this.now();
    if (!refreshToken) throw new OAuthError('انتهى تفويض المنصة — أعد ربط حسابك', 'unauthorized', 401);
    const fields = p === 'tiktok'
      ? { client_key: c.id, client_secret: c.secret, grant_type: 'refresh_token', refresh_token: refreshToken }
      : { client_id: c.id, client_secret: c.secret, grant_type: 'refresh_token', refresh_token: refreshToken };
    const r = await postForm(ENDPOINTS[p].token, fields, this.fetch);
    if (!r.ok || r.data.error || !r.data.access_token) throw new OAuthError('انتهى تفويض المنصة — أعد ربط حسابك', 'unauthorized', 401);
    const t = tokens(r.data, now);
    if (!t.refreshToken) t.refreshToken = refreshToken; // keep the old one when the platform does not rotate it
    return t;
  }
  async revoke(p, accessToken) {
    if (!accessToken || !this.enabled(p)) return false;
    const c = this.cfg[p];
    const fields = p === 'tiktok' ? { client_key: c.id, client_secret: c.secret, token: accessToken } : { client_id: c.id, client_secret: c.secret, token: accessToken, token_hint_type: 'access_token' };
    try { const r = await postForm(ENDPOINTS[p].revoke, fields, this.fetch); return r.ok; } catch { return false; }
  }

  /** The identity of the signed-in platform account, read with its own token. */
  async identity(p, accessToken) {
    if (p === 'tiktok') {
      const r = await getJson(ENDPOINTS.tiktok.userinfo + '?fields=open_id,union_id,avatar_url,avatar_large_url,display_name,username,profile_web_link,profile_deep_link', accessToken, this.fetch);
      const u = r.data?.data?.user;
      if (!r.ok || !u?.open_id) throw new OAuthError('تعذر قراءة بيانات حساب TikTok', 'userinfo', 502);
      // the username, or else the one in the profile link TikTok returns (https://www.tiktok.com/@name)
      const fromLink = /tiktok\.com\/@([A-Za-z0-9._]{1,40})/.exec(String(u.profile_web_link || u.profile_deep_link || ''))?.[1] || '';
      const handle = /^[A-Za-z0-9._]{1,40}$/.test(String(u.username || '')) ? String(u.username) : fromLink;
      return { platformUserId: String(u.open_id), handle, displayName: String(u.display_name || ''), avatar: String(u.avatar_large_url || u.avatar_url || '') };
    }
    const r = await getJson(ENDPOINTS.kick.api + '/users', accessToken, this.fetch);
    const u = (r.data?.data || [])[0];
    if (!r.ok || !u?.user_id) throw new OAuthError('تعذر قراءة بيانات حساب Kick', 'userinfo', 502);
    const ch = await this.kickChannel(accessToken).catch(() => null);
    return { platformUserId: String(u.user_id), handle: ch?.slug || String(u.name || '').toLowerCase(), displayName: String(u.name || ''), avatar: String(u.profile_picture || '') };
  }
  /** Kick: the signed-in broadcaster's channel and whether it is live right now (official API). */
  async kickChannel(accessToken) {
    const r = await getJson(ENDPOINTS.kick.api + '/channels', accessToken, this.fetch);
    const c = (r.data?.data || [])[0];
    if (!r.ok || !c) throw new OAuthError('تعذر قراءة قناة Kick', 'channel', 502);
    return { broadcasterUserId: String(c.broadcaster_user_id), slug: String(c.slug || ''), live: !!c.stream?.is_live, viewers: Number(c.stream?.viewer_count) || 0 };
  }
  /** Kick: ask Kick to deliver this channel's chat messages to our webhook. */
  async kickSubscribeChat(accessToken, broadcasterUserId) {
    const r = await getJson(ENDPOINTS.kick.api + '/events/subscriptions', accessToken, this.fetch, { method: 'POST', body: JSON.stringify({ broadcaster_user_id: Number(broadcasterUserId), events: [{ name: 'chat.message.sent', version: 1 }], method: 'webhook' }) });
    if (!r.ok) throw new OAuthError('رفضت Kick الاشتراك في رسائل الشات', 'subscribe', 502);
    return (r.data?.data || []).map((x) => x.subscription_id).filter(Boolean);
  }
  /** Kick webhooks are signed with Kick's RSA key: {message id}.{timestamp}.{raw body}, RSA-SHA256. */
  async kickWebhookValid(headers, rawBody) {
    const sig = headers['kick-event-signature'], id = headers['kick-event-message-id'], ts = headers['kick-event-message-timestamp'];
    if (!sig || !id || !ts) return false;
    if (!this.kickKey || this.now() - this.kickKeyAt > 24 * 3600_000) {
      try {
        const res = await this.fetch(ENDPOINTS.kick.api + '/public-key', { signal: AbortSignal.timeout(8000) });
        const k = (await res.json())?.data?.public_key; if (k) { this.kickKey = k; this.kickKeyAt = this.now(); }
      } catch {}
    }
    if (!this.kickKey) return false;
    try { return createVerify('RSA-SHA256').update(id + '.' + ts + '.' + rawBody).verify(this.kickKey, String(sig), 'base64'); } catch { return false; }
  }
}
