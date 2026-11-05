-- «عملات الإسفنجة» (Sponge Coins): one wallet per SPG account, every movement recorded once.
-- Two buckets: `earned` (daily reward, invitations, admin gifts) and `purchased` (bought with money).
-- Balances can never go negative (CHECK) and every transaction is unique per (user, kind, ref, bucket),
-- so a repeated request, a second tab or a retried webhook can never pay twice.
CREATE TABLE wallets (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  earned         bigint NOT NULL DEFAULT 0 CHECK (earned >= 0),
  purchased      bigint NOT NULL DEFAULT 0 CHECK (purchased >= 0),
  total_earned   bigint NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
  total_bought   bigint NOT NULL DEFAULT 0 CHECK (total_bought >= 0),
  total_spent    bigint NOT NULL DEFAULT 0 CHECK (total_spent >= 0),
  next_daily_at  timestamptz,                 -- server time; NULL = the first daily reward is available
  daily_count    integer NOT NULL DEFAULT 0 CHECK (daily_count >= 0),
  shards         integer NOT NULL DEFAULT 0 CHECK (shards >= 0),   -- duplicate skins, kept for a future exchange
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallet_transactions (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount        integer NOT NULL CHECK (amount <> 0),           -- + credit, − debit
  bucket        text NOT NULL CHECK (bucket IN ('earned', 'purchased')),
  kind          text NOT NULL CHECK (kind IN ('daily', 'referral', 'purchase', 'spin', 'skin_buy', 'admin')),
  ref           text NOT NULL CHECK (length(ref) BETWEEN 1 AND 120), -- idempotency key of the operation
  balance_after bigint NOT NULL,
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, ref, bucket)
);
CREATE INDEX wallet_tx_user ON wallet_transactions (user_id, created_at DESC);

-- daily reward n of each account exists once
CREATE TABLE daily_rewards (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  n          integer NOT NULL CHECK (n >= 1),
  amount     integer NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, n)
);

-- invitations: who invited an account (set once, at sign-up) and the reward decision
ALTER TABLE users ADD COLUMN referred_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN signup_ip_hash text;
ALTER TABLE users ADD COLUMN signup_device text;
-- browsers seen on each account (a random first-party cookie id, hashed) — one of the signals used to spot
-- someone inviting themselves; never shown, never shared
CREATE TABLE account_devices (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device      text NOT NULL,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device)
);
CREATE INDEX account_devices_device ON account_devices (device);

CREATE TABLE referrals (
  referee_id  uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,   -- an account is counted once, ever
  referrer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'granted', 'held', 'rejected', 'capped')),
  reason      text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  CHECK (referee_id <> referrer_id)
);
CREATE INDEX referrals_referrer ON referrals (referrer_id, status);

-- the owner's economy actions (balance changes always carry a reason)
CREATE TABLE economy_admin_logs (
  id         bigserial PRIMARY KEY,
  actor      text NOT NULL,
  action     text NOT NULL,
  target     uuid REFERENCES users(id) ON DELETE SET NULL,
  reason     text NOT NULL DEFAULT '',
  details    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX economy_admin_logs_time ON economy_admin_logs (created_at DESC);
