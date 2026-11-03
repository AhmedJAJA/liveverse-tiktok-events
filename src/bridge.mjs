// TikTok LIVE integration is unofficial, so connectivity is best-effort.
// The app works in demo mode without any LIVE connection.
export class LiveBridge {
  constructor(engine) { this.engine = engine; this.connection = null; this.username = ''; this.generation = 0; this.retry = null; }
  async connect(username) {
    username = String(username || '').trim().replace(/^@/, '');
    if (!/^[\w.]{2,30}$/.test(username)) throw new Error('اسم مستخدم TikTok غير صالح');
    await this.disconnect();
    const generation = ++this.generation;
    this.username = username;
    this.engine.setConnection('connecting', username, 'جارٍ محاولة الاتصال...');
    try { await this.attempt(generation); }
    catch(err) {
      if (generation === this.generation) {
        this.engine.setConnection('error', username, String(err?.message || err).slice(0,140));
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
        isFollower: user.followStatus === 1 || user.followStatus === 2 || user.followRole === 1 || user.followRole === 2 || user.followInfo?.followStatus === 1 || user.followInfo?.followStatus === 2 || event.followRole === 1 || event.followRole === 2,
        isSubscriber: user.isSubscriber === true || event.isSubscriber === true });
    });
    connection.on(ControlEvent.DISCONNECTED, () => {
      if (generation !== this.generation) return;
      this.engine.setConnection('disconnected', this.username, 'انقطع البث أو الاتصال؛ إعادة المحاولة');
      this.schedule(generation);
    });
    connection.on(ControlEvent.ERROR, err => {
      if (generation === this.generation) this.engine.setConnection('error', this.username, String(err?.message || err).slice(0,140));
    });
    await connection.connect();
    if (generation !== this.generation) { await connection.disconnect().catch(() => {}); return; }
    this.engine.setConnection('connected', this.username, 'متصل بالبث المباشر');
  }
  schedule(generation) {
    if (this.retry || generation !== this.generation) return;
    this.retry = setTimeout(async () => {
      this.retry = null;
      if (generation !== this.generation) return;
      this.engine.setConnection('connecting', this.username, 'إعادة الاتصال...');
      try { await this.attempt(generation); } catch(err) {
        if (generation === this.generation) {
          this.engine.setConnection('error', this.username, String(err?.message || err).slice(0,140));
          this.schedule(generation);
        }
      }
    }, 20000);
    this.retry.unref?.();
  }
  async disconnect() {
    this.generation++;
    clearTimeout(this.retry); this.retry = null;
    const old = this.connection; this.connection = null;
    if (old) { try { await old.disconnect(); } catch {} }
    this.engine.setConnection('disconnected', '', 'تم الفصل');
  }
}

