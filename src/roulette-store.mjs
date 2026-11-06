// سبونج لايف — «الروليت»: what happened, recorded. Each match (its published rules and players), each turn (who
// held it, who faced the revolver, the chamber, the outcome) and the winner go to PostgreSQL. Writes are queued in
// order and never block the game; a failed write is logged, the match goes on.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slim = (p) => (p ? { id: String(p.id).slice(0, 80), name: String(p.name || '').slice(0, 40), number: p.number } : null);

export class RouletteStore {
  constructor(pool) { this.pool = pool; this.queue = Promise.resolve(); this.failures = 0; }
  record(room, e) {
    if (!this.pool || !e?.match) return;
    this.queue = this.queue.then(() => this.write(room, e)).catch((err) => { this.failures++; console.warn('[roulette] record', e.type, err.message); });
  }
  /** Resolves when everything queued so far is written (tests, shutdown). */
  flush() { return this.queue; }
  async write(room, e) {
    const at = new Date(e.at || Date.now());
    if (e.type === 'start') {
      await this.pool.query(`INSERT INTO roulette_matches (id, room, owner_id, demo, rules, players, started_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [e.match, room.id, UUID.test(String(room.ownerId || '')) ? room.ownerId : null, !!e.demo, JSON.stringify(e.rules || {}), JSON.stringify((e.players || []).map(slim)), at]);
    } else if (e.type === 'turn') {
      await this.pool.query(`INSERT INTO roulette_turns (match_id, turn, holder, target, outcome, reason, chamber, chambers, how, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (match_id, turn) DO NOTHING`,
        [e.match, e.turn, JSON.stringify(slim(e.holder)), e.target ? JSON.stringify(slim(e.target)) : null, e.outcome, e.reason || null, e.chamber ?? null, e.of ?? null, e.how || null, at]);
    } else if (e.type === 'finish') {
      await this.pool.query(`UPDATE roulette_matches SET ended_at=$2, reason=$3, winner=$4, stats=$5 WHERE id=$1 AND ended_at IS NULL`,
        [e.match, at, e.reason || null, e.winner ? JSON.stringify(e.winner) : null, JSON.stringify(e.stats || {})]);
    }
  }
  /** The latest matches of a room with their turns (newest first). */
  async recent(roomId, limit = 5) {
    if (!this.pool) return [];
    const m = (await this.pool.query('SELECT * FROM roulette_matches WHERE room=$1 ORDER BY started_at DESC LIMIT $2', [roomId, Math.min(50, Math.max(1, limit))])).rows;
    if (!m.length) return [];
    const t = (await this.pool.query('SELECT * FROM roulette_turns WHERE match_id = ANY($1::uuid[]) ORDER BY turn', [m.map((x) => x.id)])).rows;
    return m.map((x) => ({ ...x, turns: t.filter((r) => r.match_id === x.id) }));
  }
}
