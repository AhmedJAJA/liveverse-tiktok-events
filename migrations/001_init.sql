-- SPONGE LIVE — accounts, permanent IDs, trials, subscriptions, payments and admin audit.
-- Applied by tools/migrate.mjs (also run automatically when the server starts). Needs PostgreSQL 13+ (gen_random_uuid).


CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id         text NOT NULL UNIQUE CHECK (public_id ~ '^SPG-[A-HJ-NP-Z2-9]{6}$'),
  username          text NOT NULL CHECK (username ~ '^[a-z0-9_.]{3,24}$'),
  display_name      text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 40),
  email             text NOT NULL CHECK (char_length(email) <= 254),
  canonical_email   text NOT NULL,
  password_hash     text NOT NULL,
  avatar            text NOT NULL DEFAULT 'sponge',
  room              text NOT NULL UNIQUE CHECK (room ~ '^a[a-z0-9]{9}$'),
  email_verified_at timestamptz,
  is_admin          boolean NOT NULL DEFAULT false,
  disabled_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_key ON users (lower(username));
CREATE UNIQUE INDEX users_canonical_email_key ON users (canonical_email);
CREATE INDEX users_created_idx ON users (created_at DESC);

-- The permanent ID can never change, whatever the application asks for.
CREATE FUNCTION users_keep_public_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.public_id IS DISTINCT FROM OLD.public_id THEN
    RAISE EXCEPTION 'public_id is permanent' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'id is permanent' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER users_public_id_guard BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_keep_public_id();

CREATE TABLE email_tokens (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify')),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user_idx ON email_tokens (user_id);

-- Login sessions (all kinds: accounts, promo codes, owner). Only a hash of the cookie is stored.
CREATE TABLE sessions (
  key_hash   text PRIMARY KEY,
  kind       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Promo codes: 'access' codes made by the owner, and 'trial' codes bound to one account.
CREATE TABLE promo_codes (
  id           text PRIMARY KEY,
  code_hash    text NOT NULL UNIQUE,
  hint         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('access', 'trial')),
  label        text NOT NULL DEFAULT '',
  level        text NOT NULL DEFAULT 'live' CHECK (level IN ('live', 'demo')),
  max_uses     integer NOT NULL DEFAULT 1 CHECK (max_uses >= 0),
  uses         integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
  expires_at   timestamptz,
  active       boolean NOT NULL DEFAULT true,
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  -- trial codes only: shown again in the owner's own account page; useless to anyone else, since
  -- activation needs that account's session. Owner access codes are stored only as hashes.
  code_plain   text CHECK (code_plain IS NULL OR kind = 'trial'),
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  CHECK (kind = 'access' OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX promo_codes_one_trial_per_user ON promo_codes (user_id) WHERE kind = 'trial';

CREATE TABLE subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan          text NOT NULL CHECK (plan IN ('trial', 'weekly', 'monthly', 'manual')),
  price_halalas integer NOT NULL DEFAULT 0 CHECK (price_halalas >= 0),
  currency      text NOT NULL DEFAULT 'SAR',
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  source        text NOT NULL CHECK (source IN ('trial', 'payment', 'admin')),
  payment_id    uuid,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX subscriptions_user_idx ON subscriptions (user_id, ends_at DESC);

-- One free trial per account, ever.
CREATE TABLE trial_activations (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_id      text REFERENCES promo_codes(id) ON DELETE SET NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  ends_at      timestamptz NOT NULL,
  ip_hash      text
);
CREATE INDEX trial_activations_ip_idx ON trial_activations (ip_hash, activated_at DESC);

-- Payment requests and their verified result. No card data is ever stored here.
CREATE TABLE payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan          text NOT NULL CHECK (plan IN ('weekly', 'monthly')),
  amount_halalas integer NOT NULL CHECK (amount_halalas > 0),
  currency      text NOT NULL DEFAULT 'SAR',
  provider      text NOT NULL,
  provider_ref  text UNIQUE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  checkout_url  text,
  verified_at   timestamptz,
  raw_status    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_user_idx ON payments (user_id, created_at DESC);
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_payment_fk FOREIGN KEY (payment_id) REFERENCES payments(id);
-- A payment can activate at most one subscription.
CREATE UNIQUE INDEX subscriptions_payment_once ON subscriptions (payment_id) WHERE payment_id IS NOT NULL;

-- Streaming accounts a user has connected. A typed name is not proof of ownership: `verified` stays false
-- until a platform-side check exists; `last_connected_at` records successful connections only.
CREATE TABLE linked_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform          text NOT NULL CHECK (platform IN ('tiktok', 'kick')),
  handle            text NOT NULL,
  verified          boolean NOT NULL DEFAULT false,
  last_connected_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform)
);

CREATE TABLE admin_audit_logs (
  id             bigserial PRIMARY KEY,
  actor          text NOT NULL,
  action         text NOT NULL,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  details        jsonb NOT NULL DEFAULT '{}',
  ip_hash        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_logs_created_idx ON admin_audit_logs (created_at DESC);
CREATE INDEX admin_audit_logs_target_idx ON admin_audit_logs (target_user_id, created_at DESC);
