-- Leaderboard v2: player hours (each real second counted once even across simultaneous streams),
-- unique players and completed rounds per streamer, a closed-week archive, prizes managed by the owner,
-- and the «شركاء النجاح» partners shown on the home page.
ALTER TABLE weekly_player_stats ADD COLUMN handle text;
ALTER TABLE weekly_player_stats ADD COLUMN seconds integer NOT NULL DEFAULT 0 CHECK (seconds >= 0);
ALTER TABLE weekly_player_stats ADD COLUMN last_until timestamptz;
CREATE INDEX weekly_player_seconds ON weekly_player_stats (week_start, seconds DESC);
CREATE INDEX weekly_player_handle ON weekly_player_stats (platform, lower(handle));

ALTER TABLE weekly_streamer_stats ADD COLUMN rounds integer NOT NULL DEFAULT 0 CHECK (rounds >= 0);
CREATE TABLE weekly_streamer_players (
  week_start date NOT NULL,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform   text NOT NULL,
  player_id  text NOT NULL,
  PRIMARY KEY (week_start, user_id, platform, player_id)
);

-- the top five of every board, frozen when a week closes
CREATE TABLE leaderboard_archive (
  week_start date NOT NULL,
  board      text NOT NULL CHECK (board IN ('players', 'streamers')),
  metric     text NOT NULL,
  rows       jsonb NOT NULL DEFAULT '[]',
  closed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, board, metric)
);

-- prizes exist only when the owner announces them; nothing is shown otherwise
CREATE TABLE leaderboard_prizes (
  id          serial PRIMARY KEY,
  board       text NOT NULL CHECK (board IN ('players', 'streamers')),
  metric      text NOT NULL,
  rank_from   integer NOT NULL CHECK (rank_from BETWEEN 1 AND 5),
  rank_to     integer NOT NULL CHECK (rank_to BETWEEN 1 AND 5),
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  conditions  text NOT NULL DEFAULT '' CHECK (length(conditions) <= 300),
  starts_on   date NOT NULL,
  ends_on     date,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (rank_to >= rank_from)
);
CREATE TABLE leaderboard_awards (
  id          serial PRIMARY KEY,
  week_start  date NOT NULL,
  prize_id    integer NOT NULL REFERENCES leaderboard_prizes(id) ON DELETE CASCADE,
  rank        integer NOT NULL,
  winner      jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'void')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_start, prize_id, rank)
);

CREATE TABLE partners (
  id          serial PRIMARY KEY,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  handle      text NOT NULL CHECK (handle ~ '^[A-Za-z0-9_.]{1,40}$'),
  platform    text NOT NULL CHECK (platform IN ('tiktok', 'kick')),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 120),
  photo       bytea,
  photo_type  text CHECK (photo_type IS NULL OR photo_type IN ('image/png', 'image/jpeg', 'image/webp')),
  photo_v     integer NOT NULL DEFAULT 0,
  sort        integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  official    boolean NOT NULL DEFAULT false,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partners_shown ON partners (active, sort, id);
