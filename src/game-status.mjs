// سبونج لايف — one switch for every game: «متاحة» (available) or «قيد التطوير» (dev).
//
// The library, the game pages, every game command on the server and the join pages all ask this module, so a
// game under development cannot be started from a direct link, an old page, an API call or the WebSocket
// (the WebSocket is read-only anyway). Every game is under development by default; the owner releases a game
// from the admin panel once it is finished and reviewed (a row in game_flags), without a deploy.
//
// Authorised developers may still open and test a game under development: the site owner, site admins and the
// accounts listed in SKY_GAME_TESTERS (SPG-XXXXXX, comma separated). The server checks that on every request —
// nothing in the browser can grant it.

export const GAME_STATES = Object.freeze(['available', 'dev']);
export const DEV_MESSAGE = 'نعمل حالياً على تطوير هذه اللعبة لتقديم تجربة أفضل. ستعود قريباً!';
/** The first game to come back: first in the library, with its own badge. */
export const SPOTLIGHT = Object.freeze({ mode: 'roulette', badge: 'أول لعبة قادمة — قيد التطوير' });

const clean = (s) => (GAME_STATES.includes(s) ? s : null);

export class GameStatus {
  /**
   * @param {object} o
   * @param {string[]} o.modes            every game mode of the catalogue
   * @param {string}  [o.defaultStatus]   'dev' (production default) or 'available' (local testing of the older games)
   * @param {string}  [o.testers]         SPG ids allowed to test games under development
   */
  constructor({ modes, defaultStatus = 'dev', testers = '' } = {}) {
    this.modes = new Set(modes || []);
    this.default = clean(defaultStatus) || 'dev';
    this.flags = new Map(); // mode -> { status, updatedAt, updatedBy }
    this.testers = new Set(String(testers || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^SPG-[A-Z0-9]{6}$/.test(s)));
    this.pool = null;
  }
  has(mode) { return this.modes.has(mode); }
  status(mode) { return this.flags.get(mode)?.status || this.default; }
  isAvailable(mode) { return this.status(mode) === 'available'; }
  /** Load the owner's saved switches (PostgreSQL); without a database the defaults stay. */
  async attach(pool) {
    this.pool = pool;
    const rows = (await pool.query('SELECT mode, status, updated_at, updated_by FROM game_flags')).rows;
    for (const r of rows) if (this.modes.has(r.mode) && clean(r.status)) this.flags.set(r.mode, { status: r.status, updatedAt: new Date(r.updated_at).getTime(), updatedBy: r.updated_by || null });
    return this;
  }
  /** The owner (or an admin) releases a game or puts it back under development. */
  async set(mode, status, by) {
    if (!this.modes.has(mode)) throw Object.assign(new Error('لعبة غير معروفة'), { status: 404 });
    if (!clean(status)) throw Object.assign(new Error('الحالة يجب أن تكون «متاحة» أو «قيد التطوير»'), { status: 400 });
    const entry = { status, updatedAt: Date.now(), updatedBy: String(by || '').slice(0, 64) || null };
    if (this.pool) await this.pool.query(`INSERT INTO game_flags (mode, status, updated_at, updated_by) VALUES ($1,$2,now(),$3)
      ON CONFLICT (mode) DO UPDATE SET status=EXCLUDED.status, updated_at=EXCLUDED.updated_at, updated_by=EXCLUDED.updated_by`, [mode, status, entry.updatedBy]);
    this.flags.set(mode, entry);
    return this.view(mode);
  }
  view(mode) { const f = this.flags.get(mode); return { mode, status: this.status(mode), updatedAt: f?.updatedAt ? new Date(f.updatedAt).toISOString() : null, updatedBy: f?.updatedBy || null, spotlight: mode === SPOTLIGHT.mode }; }
  list() { return [...this.modes].map((m) => this.view(m)); }
  /** A catalogue entry as the site shows it: the live status, and the spotlight badge for the first game back. */
  decorate(game) {
    const status = this.status(game.mode);
    return { ...game, status, ...(game.mode === SPOTLIGHT.mode ? { spotlight: true, spotlightBadge: status === 'dev' ? SPOTLIGHT.badge : null } : {}) };
  }
  isTester(publicId) { return this.testers.has(String(publicId || '').toUpperCase()); }
}

/** The error every refused game command carries (HTTP 423 Locked): the same message the library shows. */
export function devError(mode, title) {
  return Object.assign(new Error(DEV_MESSAGE), { status: 423, gameStatus: 'dev', mode, title: title || '' });
}
