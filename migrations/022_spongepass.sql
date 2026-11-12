-- «SpongePass»: a season pass of 50 tiers. Tiers come from the season's XP, counted by the server from the same
-- weekly statistics as the account's level (games joined, wins, minutes played, minutes streamed, rounds hosted) —
-- never from the browser. Each tier has a free reward and a premium one (bought once per season with Sponge Coins,
-- or granted by the owner). The reward table is in src/spongepass.mjs.

CREATE TABLE pass_seasons (
  id            text PRIMARY KEY CHECK (id ~ '^s[0-9]{1,3}$'),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL CHECK (ends_at > starts_at),
  tiers         integer NOT NULL CHECK (tiers BETWEEN 1 AND 200),
  xp_per_tier   integer NOT NULL CHECK (xp_per_tier > 0),
  premium_price integer NOT NULL CHECK (premium_price >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- who holds the premium track of a season (bought or granted); one row per account and season
CREATE TABLE pass_members (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id  text NOT NULL REFERENCES pass_seasons(id) ON DELETE CASCADE,
  source     text NOT NULL CHECK (source IN ('buy', 'grant')),
  price      integer NOT NULL DEFAULT 0 CHECK (price >= 0),
  granted_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, season_id)
);

-- every reward taken: the primary key makes a claim happen once, however often it is requested
CREATE TABLE pass_claims (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id  text NOT NULL REFERENCES pass_seasons(id) ON DELETE CASCADE,
  tier       integer NOT NULL CHECK (tier >= 1),
  track      text NOT NULL CHECK (track IN ('free', 'premium')),
  kind       text NOT NULL CHECK (kind IN ('frame', 'coins', 'spins', 'badge')),
  value      text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, season_id, tier, track)
);
CREATE INDEX pass_claims_badges ON pass_claims (user_id) WHERE kind = 'badge';

-- the first season: 60 days from the start of this week. The weekly statistics start on Sunday 00:00 Asia/Riyadh,
-- so the season starts there too and counts whole weeks.
INSERT INTO pass_seasons (id, name, starts_at, ends_at, tiers, xp_per_tier, premium_price)
SELECT 's1', 'SpongePass — الموسم 1', w, w + interval '60 days', 50, 250, 2000
FROM (SELECT ((date_trunc('week', (now() AT TIME ZONE 'Asia/Riyadh') + interval '1 day') - interval '1 day') AT TIME ZONE 'Asia/Riyadh') AS w) s;

-- frames won in the pass, and the SpongePass frame effects (drawn by CSS, no image)
ALTER TABLE user_frames DROP CONSTRAINT IF EXISTS user_frames_source_check;
ALTER TABLE user_frames ADD CONSTRAINT user_frames_source_check CHECK (source IN ('claim', 'grant', 'pass'));
ALTER TABLE frames DROP CONSTRAINT IF EXISTS frames_effect_check;
ALTER TABLE frames ADD CONSTRAINT frames_effect_check CHECK (effect IN ('none', 'cyan', 'gold', 'saudi', 'flame', 'ice', 'crown', 'royal',
  'tide', 'bubble', 'coral', 'abyss', 'sunken', 'pearl', 'kraken', 'neon_sponge', 'sponge_king'));

-- coins moved by the pass
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_kind_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_kind_check
  CHECK (kind IN ('daily', 'referral', 'purchase', 'spin', 'skin_buy', 'admin', 'pass_buy', 'pass_reward'));

-- free spins of «عجلة السكنات» won in the pass: a spin paid with one of them costs no coins
ALTER TABLE wallets ADD COLUMN free_spins integer NOT NULL DEFAULT 0 CHECK (free_spins >= 0);
ALTER TABLE wheel_spins DROP CONSTRAINT IF EXISTS wheel_spins_cost_check;
ALTER TABLE wheel_spins ADD CONSTRAINT wheel_spins_cost_check CHECK (cost >= 0);
ALTER TABLE wheel_spins DROP CONSTRAINT IF EXISTS wheel_spins_bucket_check;
ALTER TABLE wheel_spins ADD CONSTRAINT wheel_spins_bucket_check CHECK (bucket IN ('earned', 'purchased', 'free'));
