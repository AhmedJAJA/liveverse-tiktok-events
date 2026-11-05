-- «السكنات» catalog in the database (the built-in skins are copied in on start; the owner edits them here),
-- rarities, uploaded models, duplicate copies (shards for a future exchange), and economy settings.
CREATE TABLE skins (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z0-9_]{2,32}$'),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  blurb       text NOT NULL DEFAULT '' CHECK (char_length(blurb) <= 160),
  rarity      text NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary', 'mythic')),
  access      text NOT NULL DEFAULT 'wheel' CHECK (access IN ('free', 'wheel', 'grant')),
  is_default  boolean NOT NULL DEFAULT false,
  accent      text NOT NULL DEFAULT '#5AA9FF' CHECK (accent ~ '^#[0-9A-Fa-f]{6}$'),
  in_wheel    boolean NOT NULL DEFAULT false,
  price_coins integer CHECK (price_coins IS NULL OR price_coins BETWEEN 1 AND 1000000),  -- direct purchase
  active      boolean NOT NULL DEFAULT true,
  sort        integer NOT NULL DEFAULT 100,
  builtin     boolean NOT NULL DEFAULT false,
  model       bytea,                       -- uploaded by the owner (GLB), otherwise the built-in file
  model_v     integer NOT NULL DEFAULT 0,
  thumb       bytea,                       -- uploaded poster (WebP/PNG)
  thumb_type  text CHECK (thumb_type IS NULL OR thumb_type IN ('image/webp', 'image/png')),
  thumb_v     integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_skins DROP CONSTRAINT IF EXISTS user_skins_source_check;
ALTER TABLE user_skins ADD CONSTRAINT user_skins_source_check CHECK (source IN ('claim', 'grant', 'pack', 'prize', 'wheel', 'buy'));
-- a skin won again from the wheel adds a copy (each extra copy = one shard, kept for a future exchange)
ALTER TABLE user_skins ADD COLUMN copies integer NOT NULL DEFAULT 1 CHECK (copies >= 1);

CREATE TABLE economy_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  updated_by text NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now()
);
