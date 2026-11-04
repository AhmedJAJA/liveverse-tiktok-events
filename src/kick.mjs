// Kick chat integration — EXPERIMENTAL.
// Kick has no official public chat API for third parties. Its web player reads chat
// from a public Pusher channel (`chatrooms.<id>.v2`); this bridge subscribes to the
// same channel read-only. The channel id comes from kick.com's channel endpoint,
// which is often behind bot protection — the host can paste the numeric chatroom id
// instead. Every failure is reported in the dashboard as a clear connection state.
import { WebSocket } from 'ws';

export const KICK_PUSHER_URL = process.env.KICK_PUSHER_URL ||
  'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false';

const SUB_BADGES = new Set(['subscriber', 'founder', 'og', 'sub_gifter']);

/** Map a Kick ChatMessageEvent payload to the engine's chat shape. */
export function parseKickChat(payload) {
  const sender = payload?.sender || {};
  const stable = sender.id ?? sender.slug ?? sender.username;
  if (stable === undefined || stable === null || stable === '') return null;
  const text = String(payload?.content ?? '').replace(/\[emote:\d+:[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const badges = Array.isArray(sender.identity?.badges) ? sender.identity.badges : [];
  return {
    id: 'kick:' + String(stable),
    username: String(sender.username || sender.slug || 'مشاهد'),
    handle: String(sender.slug || sender.username || ''),
    text,
    msgId: payload?.id ? 'kick:' + String(payload.id) : '',
    // Kick does not expose follow status in chat events, so viewers are never treated as confirmed followers.
    isFollower: false,
    isSubscriber: badges.some((b) => SUB_BADGES.has(String(b?.type || '').toLowerCase()))
  };
}

export function validKickSlug(raw) {
  const slug = String(raw ?? '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?kick\.com\//i, '').split(/[/?#]/)[0];
  return /^[A-Za-z0-9_-]{2,30}$/.test(slug) ? slug.toLowerCase() : null;
}

export class KickBridge {
  constructor(engine, { fetchImpl = globalThis.fetch, WebSocketImpl = WebSocket, url = KICK_PUSHER_URL } = {}) {
    this.engine = engine; this.fetch = fetchImpl; this.WS = WebSocketImpl; this.url = url;
    this.ws = null; this.generation = 0; this.retry = null; this.slug = ''; this.chatroomId = null;
  }
  async lookup(slug) {
    if (typeof this.fetch !== 'function') throw new Error('بيئة الخادم لا تدعم الاتصال بـ Kick');
    let res;
    try { res = await this.fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json', 'User-Agent': 'SkyLive/1.0' } }); }
    catch { throw new Error('تعذّر الوصول إلى Kick. أدخل رقم غرفة الشات يدويًا من إعدادات الربط.'); }
    if (!res.ok) throw new Error(`رفض Kick طلب قراءة القناة (${res.status}). أدخل رقم غرفة الشات يدويًا.`);
    const data = await res.json().catch(() => null);
    const id = Number(data?.chatroom?.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error('لم يُعثر على غرفة الشات لهذه القناة');
    return id;
  }
  async connect(username, { chatroomId } = {}) {
    const slug = validKickSlug(username);
    if (!slug) throw new Error('اسم قناة Kick غير صالح');
    await this.disconnect(false);
    const generation = ++this.generation;
    this.slug = slug;
    this.engine.setConnection('connecting', slug, 'جارٍ الاتصال بشات Kick (تجريبي)…', 'kick');
    try {
      const manual = chatroomId === undefined || chatroomId === null || chatroomId === '' ? null : Number(chatroomId);
      if (manual !== null && (!Number.isInteger(manual) || manual <= 0)) throw new Error('رقم غرفة الشات غير صالح');
      this.chatroomId = manual ?? await this.lookup(slug);
      if (generation !== this.generation) return;
      await this.open(generation);
    } catch (err) {
      if (generation === this.generation) this.engine.setConnection('error', slug, String(err?.message || err).slice(0, 160), 'kick');
      throw err;
    }
  }
  open(generation) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(); };
      const ws = new this.WS(this.url);
      this.ws = ws;
      const timer = setTimeout(() => { done(new Error('انتهت مهلة الاتصال بشات Kick')); try { ws.close(); } catch {} }, 12000);
      timer.unref?.();
      const channel = `chatrooms.${this.chatroomId}.v2`;
      ws.on('message', (raw) => {
        if (generation !== this.generation) return;
        let packet; try { packet = JSON.parse(String(raw)); } catch { return; }
        if (packet.event === 'pusher:connection_established') ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel } }));
        else if (packet.event === 'pusher_internal:subscription_succeeded') {
          this.engine.setConnection('connected', this.slug, 'متصل بشات Kick (تجريبي)', 'kick'); done();
        } else if (packet.event === 'pusher:ping') ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
        else if (packet.event === 'pusher:error') done(new Error('رفض خادم الشات الاشتراك في القناة'));
        else if (packet.event === 'App\\Events\\ChatMessageEvent') {
          let data = packet.data; try { if (typeof data === 'string') data = JSON.parse(data); } catch { return; }
          const chat = parseKickChat(data);
          if (chat) this.engine.receiveChat(chat);
        }
      });
      ws.on('error', () => done(new Error('تعذّر فتح اتصال شات Kick')));
      ws.on('close', () => {
        done(new Error('أُغلق اتصال شات Kick'));
        if (generation !== this.generation) return;
        this.engine.setConnection('disconnected', this.slug, 'انقطع شات Kick؛ إعادة المحاولة', 'kick');
        this.schedule(generation);
      });
    });
  }
  schedule(generation) {
    if (this.retry || generation !== this.generation) return;
    this.retry = setTimeout(async () => {
      this.retry = null;
      if (generation !== this.generation) return;
      this.engine.setConnection('connecting', this.slug, 'إعادة الاتصال بشات Kick…', 'kick');
      try { await this.open(generation); } catch (err) {
        if (generation === this.generation) { this.engine.setConnection('error', this.slug, String(err?.message || err).slice(0, 160), 'kick'); this.schedule(generation); }
      }
    }, 15000);
    this.retry.unref?.();
  }
  async disconnect(report = true) {
    this.generation++;
    clearTimeout(this.retry); this.retry = null;
    const old = this.ws; this.ws = null;
    if (old) { try { old.close(); } catch {} }
    if (report) this.engine.setConnection('disconnected', '', 'تم الفصل', 'kick');
  }
}
