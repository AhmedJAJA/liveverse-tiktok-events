-- «عجلة السكنات»: every spin is stored with the exact odds it used, before any animation is shown.
-- (user_id, idem_key) is unique: a retried request (lost connection, double click, second tab) returns the
-- stored result instead of spinning or charging again.
CREATE TABLE wheel_spins (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idem_key   text NOT NULL CHECK (idem_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  count      integer NOT NULL CHECK (count IN (1, 10)),
  cost       integer NOT NULL CHECK (cost > 0),
  bucket     text NOT NULL DEFAULT 'earned' CHECK (bucket IN ('earned', 'purchased')),
  odds       jsonb NOT NULL,            -- snapshot: basis points per rarity + the skins in the pool
  odds_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idem_key)
);
CREATE INDEX wheel_spins_user ON wheel_spins (user_id, id DESC);
CREATE INDEX wheel_spins_time ON wheel_spins (created_at DESC);

CREATE TABLE wheel_rewards (
  spin_id    bigint NOT NULL REFERENCES wheel_spins(id) ON DELETE CASCADE,
  idx        integer NOT NULL CHECK (idx BETWEEN 0 AND 9),
  skin_id    text NOT NULL,
  rarity     text NOT NULL,
  duplicate  boolean NOT NULL,
  PRIMARY KEY (spin_id, idx)
);
CREATE INDEX wheel_rewards_rarity ON wheel_rewards (rarity);
