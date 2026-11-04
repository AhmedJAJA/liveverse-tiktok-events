-- Streaming accounts become trusted only after a proof of ownership: the streamer types a one-time code in the
-- chat of their own LIVE, and the platform reports that message as sent by that very account. One verified
-- owner per platform account; no platform tokens are stored (the proof does not need any).
ALTER TABLE linked_accounts ADD COLUMN platform_user_id text CHECK (platform_user_id IS NULL OR platform_user_id ~ '^[A-Za-z0-9_-]{1,40}$');
ALTER TABLE linked_accounts ADD COLUMN verified_at timestamptz;
ALTER TABLE linked_accounts ADD COLUMN verify_method text CHECK (verify_method IS NULL OR verify_method IN ('live-chat-code'));
ALTER TABLE linked_accounts ADD COLUMN last_live_at timestamptz;
-- Rows written before this migration were never proven.
UPDATE linked_accounts SET verified = false WHERE verified_at IS NULL;
CREATE UNIQUE INDEX linked_accounts_one_owner ON linked_accounts (platform, lower(handle)) WHERE verified;

-- The live session of each host, kept by the server (heartbeats, live checks, the game on screen).
CREATE TABLE live_sessions (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  room               text NOT NULL,
  game_session_id    uuid,
  platform           text CHECK (platform IS NULL OR platform IN ('tiktok', 'kick')),
  handle             text,
  platform_user_id   text,
  verified           boolean NOT NULL DEFAULT false,
  subscription_active boolean NOT NULL DEFAULT false,
  state              text NOT NULL CHECK (state IN ('offline', 'connected', 'in_studio', 'waiting', 'running', 'disconnected', 'ended')),
  listed             boolean NOT NULL DEFAULT false,
  current_game       text,
  players            integer NOT NULL DEFAULT 0,
  last_heartbeat_at  timestamptz,
  last_live_check_at timestamptz,
  live_confirmed     boolean NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
