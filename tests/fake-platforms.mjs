// Local stand-ins for the official TikTok (Login Kit / Open API) and Kick (OAuth 2.1 + Public API) endpoints,
// used by the end-to-end tests: authorize is followed by the test itself, tokens/userinfo/channels/revoke/public-key
// answer like the real services, and Kick webhooks are signed with a test RSA key exactly as Kick signs them.
import http from 'node:http';
import { once } from 'node:events';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';

export async function fakePlatforms() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const users = { tiktok: new Map(), kick: new Map() };     // platform user id -> profile
  const codes = new Map();                                  // code -> { platform, uid, challenge }
  const access = new Map(), refresh = new Map();            // token -> { platform, uid }
  const revoked = [], subscriptions = [];
  const read = async (req) => { let b = ''; for await (const c of req) b += c; return b; };
  const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const bearer = (req) => access.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  const issue = (platform, uid) => {
    const a = 'at-' + randomBytes(8).toString('hex'), r = 'rt-' + randomBytes(8).toString('hex');
    access.set(a, { platform, uid }); refresh.set(r, { platform, uid });
    return platform === 'tiktok'
      ? { access_token: a, refresh_token: r, expires_in: fake.tokenLife, refresh_expires_in: 31536000, open_id: uid, scope: 'user.info.basic,user.info.profile', token_type: 'Bearer' }
      : { access_token: a, refresh_token: r, expires_in: fake.tokenLife, scope: 'user:read channel:read events:subscribe', token_type: 'Bearer' };
  };
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), body = req.method === 'POST' ? await read(req) : '';
    const form = Object.fromEntries(new URLSearchParams(body));
    // ---- TikTok
    if (url.pathname === '/tiktok/token') {
      if (form.client_key !== 'tt-key' || form.client_secret !== 'tt-secret') return send(res, 401, { error: 'invalid_client' });
      if (form.grant_type === 'authorization_code') {
        const c = codes.get(form.code); codes.delete(form.code);
        if (!c || c.platform !== 'tiktok' || !form.redirect_uri.endsWith('/api/oauth/tiktok/callback')) return send(res, 400, { error: 'invalid_grant' });
        return send(res, 200, issue('tiktok', c.uid));
      }
      const r = refresh.get(form.refresh_token);
      if (!r || fake.refuseRefresh) return send(res, 400, { error: 'invalid_grant' });
      refresh.delete(form.refresh_token); fake.refreshes++;
      return send(res, 200, issue('tiktok', r.uid));
    }
    if (url.pathname === '/tiktok/userinfo') {
      const t = bearer(req); if (!t || t.platform !== 'tiktok') return send(res, 401, { error: { code: 'access_token_invalid' } });
      const u = users.tiktok.get(t.uid);
      return send(res, 200, { data: { user: { open_id: t.uid, union_id: 'u-' + t.uid, display_name: u.name, avatar_url: u.avatar, username: u.username } }, error: { code: 'ok' } });
    }
    if (url.pathname === '/tiktok/revoke') { revoked.push(['tiktok', form.token]); access.delete(form.token); return send(res, 200, {}); }
    // ---- Kick
    if (url.pathname === '/kick/token') {
      if (form.client_id !== 'kick-id' || form.client_secret !== 'kick-secret') return send(res, 401, { error: 'invalid_client' });
      if (form.grant_type === 'authorization_code') {
        const c = codes.get(form.code); codes.delete(form.code);
        // PKCE: the verifier must hash to the challenge sent on authorize
        const ok = c && c.platform === 'kick' && createHash('sha256').update(String(form.code_verifier || '')).digest('base64url') === c.challenge;
        if (!ok) return send(res, 400, { error: 'invalid_grant' });
        return send(res, 200, issue('kick', c.uid));
      }
      const r = refresh.get(form.refresh_token);
      if (!r || fake.refuseRefresh) return send(res, 400, { error: 'invalid_grant' });
      refresh.delete(form.refresh_token); fake.refreshes++;
      return send(res, 200, issue('kick', r.uid));
    }
    if (url.pathname === '/kick/revoke') { revoked.push(['kick', form.token || url.searchParams.get('token')]); return send(res, 200, {}); }
    if (url.pathname === '/kick/v1/public-key') return send(res, 200, { data: { public_key: pem } });
    if (url.pathname.startsWith('/kick/v1/')) {
      const t = bearer(req); if (!t || t.platform !== 'kick') return send(res, 401, { message: 'Unauthorized' });
      const u = users.kick.get(t.uid);
      if (url.pathname === '/kick/v1/users') return send(res, 200, { data: [{ user_id: Number(t.uid), name: u.name, email: '', profile_picture: u.avatar }] });
      if (url.pathname === '/kick/v1/channels') return send(res, 200, { data: [{ broadcaster_user_id: Number(t.uid), slug: u.slug, stream: { is_live: u.live, viewer_count: u.live ? 12 : 0 } }] });
      if (url.pathname === '/kick/v1/events/subscriptions' && req.method === 'POST') { const b = JSON.parse(body); subscriptions.push(b); return send(res, 200, { data: [{ name: 'chat.message.sent', version: 1, subscription_id: 's' + subscriptions.length }] }); }
    }
    return send(res, 404, {});
  });
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
  const base = 'http://127.0.0.1:' + srv.address().port;
  const fake = {
    refreshes: 0, refuseRefresh: false, tokenLife: 86400, revoked, subscriptions,
    env: {
      TIKTOK_CLIENT_KEY: 'tt-key', TIKTOK_CLIENT_SECRET: 'tt-secret', KICK_CLIENT_ID: 'kick-id', KICK_CLIENT_SECRET: 'kick-secret',
      TOKEN_ENC_KEY: randomBytes(32).toString('base64'),
      TIKTOK_AUTH_URL: base + '/tiktok/authorize', TIKTOK_TOKEN_URL: base + '/tiktok/token', TIKTOK_REVOKE_URL: base + '/tiktok/revoke', TIKTOK_USERINFO_URL: base + '/tiktok/userinfo',
      KICK_AUTH_URL: base + '/kick/authorize', KICK_TOKEN_URL: base + '/kick/token', KICK_REVOKE_URL: base + '/kick/revoke', KICK_PUBLIC_API: base + '/kick/v1',
    },
    addTikTok(uid, { username, name = username, avatar = 'https://p16-sign.tiktokcdn.com/' + uid + '.jpeg' }) { users.tiktok.set(uid, { username, name, avatar }); },
    addKick(uid, { slug, name = slug, live = true, avatar = 'https://files.kick.com/images/user/' + uid + '/p.webp' }) { users.kick.set(String(uid), { slug, name, live, avatar }); },
    setKickLive(uid, live) { users.kick.get(String(uid)).live = live; },
    /** What the platform's sign-in page does after the person logs in and agrees: a code bound to that account. */
    approve(authorizeLocation, uid) {
      const u = new URL(authorizeLocation);
      const platform = u.pathname.startsWith('/tiktok') ? 'tiktok' : 'kick';
      const code = 'code-' + randomBytes(6).toString('hex');
      codes.set(code, { platform, uid: String(uid), challenge: u.searchParams.get('code_challenge') });
      return { code, state: u.searchParams.get('state'), params: u.searchParams };
    },
    /** A Kick webhook delivery, signed like Kick: RSA-SHA256 over "{message id}.{timestamp}.{body}". */
    kickWebhook(target, { broadcasterUserId, sender, content, forge = false }) {
      const id = 'msg-' + randomBytes(6).toString('hex'), ts = new Date().toISOString();
      const raw = JSON.stringify({ message_id: id, broadcaster: { user_id: Number(broadcasterUserId) }, sender: { user_id: sender.id, username: sender.name, channel_slug: sender.slug, identity: { badges: [] } }, content });
      const sig = createSign('RSA-SHA256').update(id + '.' + ts + '.' + raw).sign(privateKey, 'base64');
      return fetch(target + '/api/kick/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Kick-Event-Type': 'chat.message.sent', 'Kick-Event-Version': '1', 'Kick-Event-Message-Id': id, 'Kick-Event-Message-Timestamp': ts, 'Kick-Event-Signature': forge ? Buffer.from('nope').toString('base64') : sig }, body: raw });
    },
    close: () => new Promise((r) => srv.close(r)),
  };
  return fake;
}
