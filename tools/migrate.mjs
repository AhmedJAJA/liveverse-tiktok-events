#!/usr/bin/env node
// Apply pending database migrations: DATABASE_URL=postgres://… npm run migrate
import { createPool, migrate } from '../src/db.mjs';

const pool = createPool();
if (!pool) { console.error('DATABASE_URL is not set'); process.exit(1); }
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `applied ${applied.length} migration(s)` : 'database is up to date');
} catch (err) { console.error(err.message); process.exitCode = 1; }
finally { await pool.end(); }
