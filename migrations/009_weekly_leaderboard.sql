-- Weekly leaderboard: counted by the server from real, listed game sessions only (subscription + linked
-- stream + live + studio open + game on screen). A week starts Sunday 00:00 Asia/Riyadh.
CREATE TABLE weekly_player_stats (
  week_start date    NOT NULL,
  platform   text    NOT NULL CHECK (platform IN ('tiktok', 'kick')),
  player_id  text    NOT NULL,
  name       text    NOT NULL,
  avatar     text,
  wins       integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  entries    integer NOT NULL DEFAULT 0 CHECK (entries >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, platform, player_id)
);
CREATE INDEX weekly_player_wins ON weekly_player_stats (week_start, wins DESC, entries DESC);
CREATE INDEX weekly_player_entries ON weekly_player_stats (week_start, entries DESC, wins DESC);

CREATE TABLE weekly_streamer_stats (
  week_start date    NOT NULL,
  user_id    uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sessions   integer NOT NULL DEFAULT 0 CHECK (sessions >= 0),
  players    integer NOT NULL DEFAULT 0 CHECK (players >= 0),
  minutes    integer NOT NULL DEFAULT 0 CHECK (minutes >= 0),
  PRIMARY KEY (week_start, user_id)
);
CREATE INDEX weekly_streamer_minutes ON weekly_streamer_stats (week_start, minutes DESC);
