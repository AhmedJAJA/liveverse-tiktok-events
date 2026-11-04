// SPONGE LIVE — PostgreSQL connection and migrations.
// The database is optional for the games themselves; accounts, trials and subscriptions need it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(here, '..', 'migrations');

/** SSL for hosted databases (Render external URLs need it); none for local sockets/localhost or sslmode=disable. */
function sslFor(url) {
  if (process.env.DATABASE_SSL === '0' || /sslmode=disable/.test(url)) return false;
  if (process.env.DATABASE_SSL === '1') return { rejectUnauthorized: false };
  try { const host = new URL(url).hostname; if (!host || host === 'localhost' || host === '127.0.0.1' || !host.includes('.')) return false; } catch { return false; }
  return { rejectUnauthorized: false };
}

export function createPool(url = process.env.DATABASE_URL) {
  if (!url) return null;
  const pool = new pg.Pool({ connectionString: url, ssl: sslFor(url), max: Number(process.env.DATABASE_POOL_MAX) || 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000 });
  pool.on('error', (err) => console.error('[db] idle client error', err.message));
  return pool;
}

/** Run fn(client) inside a transaction. */
export async function tx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}

/** Apply every migrations/NNN_*.sql not yet recorded, in order, each in its own transaction, under an advisory lock. */
export async function migrate(pool, { log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
    const applied = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file); log?.('[db] applied migration ' + file);
      } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw new Error('migration ' + file + ' failed: ' + err.message); }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
}
