-- The game lobby survives a server restart, and name frames for players.
--
-- lobby_sessions: one row per account room while a lobby is open (state, join word, settings, participants).
-- It is read once when the room is created again after a restart, and deleted when the session ends.
CREATE TABLE lobby_sessions (
  room        text PRIMARY KEY CHECK (room ~ '^[a-z0-9]{2,32}$'),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- «إطارات الأسماء»: a frame = an avatar ring + a nameplate behind the name, with an optional animated effect.
-- Images are optional (PNG / WebP, transparent); the nameplate is drawn as a nine-slice (slice = top,right,bottom,left
-- in pixels), so names of any length keep the corners intact. Frames are cosmetic only.
CREATE TABLE frames (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z0-9_]{2,32}$'),
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  rarity       text NOT NULL DEFAULT 'common' CHECK (rarity IN ('common', 'rare', 'epic', 'legendary', 'mythic')),
  access       text NOT NULL DEFAULT 'grant' CHECK (access IN ('free', 'grant')),
  effect       text NOT NULL DEFAULT 'none' CHECK (effect IN ('none', 'cyan', 'gold', 'saudi', 'flame', 'ice', 'crown', 'royal')),
  avatar_img   bytea, avatar_type text CHECK (avatar_type IN ('image/png', 'image/webp')),
  plate_img    bytea, plate_type text CHECK (plate_type IN ('image/png', 'image/webp')),
  slice        integer[] NOT NULL DEFAULT '{0,0,0,0}' CHECK (array_length(slice, 1) = 4),
  img_v        integer NOT NULL DEFAULT 1,
  active       boolean NOT NULL DEFAULT true,
  builtin      boolean NOT NULL DEFAULT false,
  sort         integer NOT NULL DEFAULT 100,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_frames (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frame_id    text NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  source      text NOT NULL CHECK (source IN ('claim', 'grant')),
  granted_by  text,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, frame_id)
);
ALTER TABLE users ADD COLUMN frame text CHECK (frame IS NULL OR frame ~ '^[a-z0-9_]{2,32}$');
