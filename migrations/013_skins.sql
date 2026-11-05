-- «السكنات»: the 3D character each account shows, and the skins it owns beyond the default ones.
-- Every account — existing and new — starts with the default skin equipped (owned by everyone, no row needed).
-- The catalog itself lives in src/skins.mjs, so new skins and packs need no schema change.
ALTER TABLE users ADD COLUMN skin text NOT NULL DEFAULT 'knight' CHECK (skin ~ '^[a-z0-9_]{2,32}$');

CREATE TABLE user_skins (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skin_id     text NOT NULL CHECK (skin_id ~ '^[a-z0-9_]{2,32}$'),
  source      text NOT NULL CHECK (source IN ('claim', 'grant', 'pack', 'prize')),
  granted_by  text,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, skin_id)
);
