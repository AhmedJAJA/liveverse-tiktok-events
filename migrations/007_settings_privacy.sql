-- «الإعدادات»: privacy switches (enforced by the public profile and the active-streams list) and real
-- streamer statistics, counted by the server from verified game sessions only.
ALTER TABLE users ADD COLUMN privacy jsonb NOT NULL DEFAULT '{}';
ALTER TABLE users ADD CONSTRAINT users_privacy_object CHECK (jsonb_typeof(privacy) = 'object');

CREATE TABLE streamer_stats (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sessions        integer NOT NULL DEFAULT 0 CHECK (sessions >= 0),
  players_total   integer NOT NULL DEFAULT 0 CHECK (players_total >= 0),
  games           jsonb   NOT NULL DEFAULT '{}',
  last_session_at timestamptz
);
