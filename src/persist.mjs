// SPONGE LIVE — keeps the in-memory promo-code and session stores in PostgreSQL.
// The stores stay synchronous (fast checks on every request); every change is written through, in order,
// so codes and logins survive restarts and redeploys on hosts whose disk is wiped.

class SerialWriter {
  constructor(pool, label) { this.pool = pool; this.label = label; this.chain = Promise.resolve(); }
  run(sql, params) {
    this.chain = this.chain.then(() => this.pool.query(sql, params)).catch((err) => console.error('[' + this.label + '] write failed:', err.message));
    return this.chain;
  }
  drain() { return this.chain; }
}

const ts = (ms) => (ms ? new Date(ms) : null);
const ms = (d) => (d ? new Date(d).getTime() : null);

export class PromoMirror {
  constructor(pool) { this.w = new SerialWriter(pool, 'promo-db'); this.pool = pool; }
  put(c) {
    return this.w.run(`INSERT INTO promo_codes (id, code_hash, hint, kind, label, level, max_uses, uses, expires_at, active, created_by, created_at, last_used_at)
      VALUES ($1,$2,$3,'access',$4,$5,$6,$7,$8,$9,'owner',$10,$11)
      ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label, level=EXCLUDED.level, max_uses=EXCLUDED.max_uses, uses=EXCLUDED.uses,
        expires_at=EXCLUDED.expires_at, active=EXCLUDED.active, last_used_at=EXCLUDED.last_used_at`,
    [c.id, c.hash, c.hint, c.label, c.level, c.maxUses, c.uses, ts(c.expiresAt), c.active, ts(c.createdAt) || new Date(), ts(c.lastUsedAt)]);
  }
  del(id) { return this.w.run("DELETE FROM promo_codes WHERE id=$1 AND kind='access'", [id]); }
  drain() { return this.w.drain(); }
  /** Load (or create) the shared pepper and the owner's access codes. Codes from a local file are uploaded once. */
  static async attach(pool, store) {
    const mirror = new PromoMirror(pool);
    const row = (await pool.query("SELECT value FROM settings WHERE key='promo_pepper'")).rows[0];
    if (row) {
      const rows = (await pool.query("SELECT * FROM promo_codes WHERE kind='access'")).rows;
      const fileCodes = store.pepper === row.value ? [...store.codes.values()] : [];
      store.replaceAll(row.value, rows.map((r) => ({ id: r.id, hash: r.code_hash, hint: r.hint, label: r.label, maxUses: r.max_uses, uses: r.uses, expiresAt: ms(r.expires_at), active: r.active, level: r.level, createdAt: ms(r.created_at), lastUsedAt: ms(r.last_used_at) })));
      store.mirror = mirror;
      for (const c of fileCodes) if (!store.codes.has(c.id)) { store.add(c); mirror.put(c); }
    } else {
      await pool.query("INSERT INTO settings (key, value) VALUES ('promo_pepper', $1) ON CONFLICT (key) DO NOTHING", [store.pepper]);
      store.mirror = mirror;
      for (const c of store.codes.values()) mirror.put(c);
      await mirror.drain();
    }
    return mirror;
  }
}

export class SessionMirror {
  constructor(pool) { this.w = new SerialWriter(pool, 'session-db'); }
  put(s) {
    if (s.kind === 'guest') return;
    const { key, kind, expires, ...data } = s;
    return this.w.run('INSERT INTO sessions (key_hash, kind, data, expires_at) VALUES ($1,$2,$3,$4) ON CONFLICT (key_hash) DO UPDATE SET data=EXCLUDED.data, expires_at=EXCLUDED.expires_at', [key, kind, data, new Date(expires)]);
  }
  del(key) { return this.w.run('DELETE FROM sessions WHERE key_hash=$1', [key]); }
  prune() { return this.w.run('DELETE FROM sessions WHERE expires_at < now()'); }
  drain() { return this.w.drain(); }
  static async attach(pool, sessions) {
    const mirror = new SessionMirror(pool);
    const rows = (await pool.query('SELECT key_hash, kind, data, expires_at FROM sessions WHERE expires_at > now()')).rows;
    const local = [...sessions.map.values()];
    sessions.map.clear();
    for (const r of rows) sessions.map.set(r.key_hash, { ...r.data, key: r.key_hash, kind: r.kind, expires: ms(r.expires_at) });
    sessions.mirror = mirror;
    for (const s of local) if (!sessions.map.has(s.key) && s.kind !== 'guest') { sessions.map.set(s.key, s); mirror.put(s); }
    return mirror;
  }
}
