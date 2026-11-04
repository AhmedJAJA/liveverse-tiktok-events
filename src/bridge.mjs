// TikTok LIVE integration is unofficial, so connectivity is best-effort.
// A viewer is eligible only when TikTok explicitly reports that they follow
// the broadcaster. followStatus takes precedence over legacy followRole: an
// explicit zero must never be overridden by an older or conflicting field.
export function isConfirmedFollower(event) {
  const user = event?.user || {};
  const status = user.followStatus ?? user.followInfo?.followStatus ??
    event?.followStatus ?? event?.followInfo?.followStatus;
  if (status !== undefined && status !== null && status !== '')
    return Number(status) === 1 || Number(status) === 2;
  const legacy = user.followRole ?? event?.followRole;
  return Number(legacy) === 1 || Number(legacy) === 2;
}
export function isConfirmedSubscriber(event) {
  return event?.user?.isSubscriber === true || event?.isSubscriber === true;
}
// The app works in demo mode without any LIVE connection.
export class LiveBridge {
  constructor(engine) { this.engine = engine; this.connection = null; this.username = ''; this.generation = 0; this.retry = null; }
  async connect(username) {
    username = String(username || '').trim().replace(/^@/, '');
    if (!/^[\w.]{2,30}$/.test(username)) throw new Error('اسم مستخدم TikTok غير صالح');
    await this.disconnect();
    const generation = ++this.generation;
    this.username = username;
    this.engine.setConnection('connecting', username, 'جارٍ محاولة الاتصال...', 'tiktok');
    try { await this.attempt(generation); }
    catch(err) {
      if (generation === this.generation) {
        this.engine.setConnection('error', username, String(err?.message || err).slice(0,140), 'tiktok');
        this.schedule(generation);
      }
      throw err;
    }
  }
  async attempt(generation) {
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = await import('tiktok-live-connector');
    if (generation !== this.generation) return;
    const previous = this.connection;
    this.connection = null;
    if (previous) { try { await previous.disconnect(); } catch {} }
    if (generation !== this.generation) return;
    const connection = new TikTokLiveConnection(this.username, { processInitialData: false });
    this.connection = connection;
    connection.on(WebcastEvent.CHAT, event => {
      if (generation !== this.generation) return;
      // v2.5+ modern protobuf: user.id, user.displayId and event.content.
      // Keep legacy fallbacks for older connector payload shapes.
      const user = event.user || {};
      const stableId = user.id || user.userId || user.displayId || user.uniqueId || event.userId || event.uniqueId;
      if (!stableId) return;
      this.engine.receiveChat({ id: String(stableId), username: user.nickname || user.displayId || user.uniqueId || event.nickname || 'مشاهد', text: event.content || event.comment || '', avatar: user.avatarThumb?.urlList?.[0] || user.avatarMedium?.urlList?.[0] || user.avatarLarge?.urlList?.[0] || event.profilePictureUrl || '',
        // TikTok supplies follower/subscriber flags inconsistently; unverified users are not considered eligible for restricted events.
        isFollower: isConfirmedFollower(event),
        isSubscriber: isConfirmedSubscriber(event),
        // Message id lets the engine ignore replays after a reconnect; the handle maps the streamer to the host seat.
        msgId: String(event.common?.msgId ?? event.msgId ?? ''),
        handle: String(user.uniqueId || user.displayId || event.uniqueId || '') });
    });
    // The streamer ended the LIVE: leave the active list now; reconnect attempts fail while the room is offline.
    if (WebcastEvent.STREAM_END) connection.on(WebcastEvent.STREAM_END, () => {
      if (generation !== this.generation) return;
      this.engine.setConnectionMeta?.({ liveConfirmed: false });
      this.engine.setConnection('disconnected', this.username, 'انتهى البث المباشر على TikTok', 'tiktok');
    });
    connection.on(ControlEvent.DISCONNECTED, () => {
      if (generation !== this.generation) return;
      this.engine.setConnection('disconnected', this.username, 'انقطع البث أو الاتصال؛ إعادة المحاولة', 'tiktok');
      this.schedule(generation);
    });
    connection.on(ControlEvent.ERROR, err => {
      if (generation === this.generation) this.engine.setConnection('error', this.username, String(err?.message || err).slice(0,140), 'tiktok');
    });
    await connection.connect();
    if (generation !== this.generation) { await connection.disconnect().catch(() => {}); return; }
    this.engine.setConnection('connected', this.username, 'متصل بالبث المباشر', 'tiktok');
    // The connector fetched the room info first and refuses offline rooms, so reaching this line means TikTok reports the user live.
    this.engine.setConnectionMeta?.({ liveConfirmed: true });
    // The room info fetched while connecting names the broadcaster and links their profile picture.
    try {
      const owner = connection.roomInfo?.data?.owner || connection.roomInfo?.owner || {};
      const pic = (k) => owner[k]?.url_list?.[0] || owner[k]?.urlList?.[0] || '';
      this.engine.setStreamer({ platformId: String(owner.id_str || owner.id || ''), displayName: owner.nickname || '', avatar: pic('avatar_large') || pic('avatar_medium') || pic('avatar_thumb') });
    } catch {}
  }
  schedule(generation) {
    if (this.retry || generation !== this.generation) return;
    this.retry = setTimeout(async () => {
      this.retry = null;
      if (generation !== this.generation) return;
      this.engine.setConnection('connecting', this.username, 'إعادة الاتصال...', 'tiktok');
      try { await this.attempt(generation); } catch(err) {
        if (generation === this.generation) {
          this.engine.setConnection('error', this.username, String(err?.message || err).slice(0,140), 'tiktok');
          this.schedule(generation);
        }
      }
    }, 20000);
    this.retry.unref?.();
  }
  async disconnect(report = true) {
    this.generation++;
    clearTimeout(this.retry); this.retry = null;
    const old = this.connection; this.connection = null;
    if (old) { try { await old.disconnect(); } catch {} }
    if (report) this.engine.setConnection('disconnected', '', 'تم الفصل', 'tiktok');
  }
}

