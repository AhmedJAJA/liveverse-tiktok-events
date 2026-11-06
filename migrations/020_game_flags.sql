-- سبونج لايف — one switch per game: 'available' or 'dev' («قيد التطوير»). No row = the server default
-- (every game is under development until the owner releases it from the admin panel).
CREATE TABLE IF NOT EXISTS game_flags (
  mode       text PRIMARY KEY,
  status     text NOT NULL CHECK (status IN ('available', 'dev')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
