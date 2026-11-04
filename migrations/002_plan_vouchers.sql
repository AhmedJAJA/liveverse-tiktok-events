-- Subscription vouchers: a single-use code that gives the account that redeems it one plan period
-- («شفيق العادي» 7 days or «أمير الهامور» one month). Stored only as SHA-256 hashes ("v1:" + hex) —
-- the codes are 80-bit random, so the plain code cannot be recovered from the hash.
ALTER TABLE promo_codes DROP CONSTRAINT promo_codes_kind_check;
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_kind_check CHECK (kind IN ('access', 'trial', 'plan'));
ALTER TABLE promo_codes DROP CONSTRAINT promo_codes_check1;
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_owner_check CHECK (kind IN ('access', 'plan') OR user_id IS NOT NULL);
ALTER TABLE promo_codes ADD COLUMN plan text CHECK (plan IN ('weekly', 'monthly'));
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_plan_kind_check CHECK ((kind = 'plan') = (plan IS NOT NULL));
CREATE INDEX promo_codes_plan_idx ON promo_codes (kind, plan) WHERE kind = 'plan';

ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_source_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_source_check CHECK (source IN ('trial', 'payment', 'admin', 'voucher'));
ALTER TABLE subscriptions ADD COLUMN voucher_id text REFERENCES promo_codes(id);
-- a voucher can create at most one subscription
CREATE UNIQUE INDEX subscriptions_voucher_once ON subscriptions (voucher_id) WHERE voucher_id IS NOT NULL;
