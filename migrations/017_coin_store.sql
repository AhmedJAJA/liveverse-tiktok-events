-- «متجر العملات»: the price list lives here (the page, the payment request and the API all read it), and every
-- order keeps the price and coins it was created with — later price changes never touch past orders.
CREATE TABLE coin_packages (
  id             text PRIMARY KEY CHECK (id ~ '^[a-z0-9_]{2,32}$'),
  coins          integer NOT NULL CHECK (coins > 0),
  price_halalas  integer NOT NULL CHECK (price_halalas > 0),
  currency       text NOT NULL DEFAULT 'SAR' CHECK (currency = 'SAR'),
  label          text NOT NULL,
  badge          text NOT NULL DEFAULT '',
  blurb          text NOT NULL DEFAULT '',
  featured       boolean NOT NULL DEFAULT false,
  sort           integer NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- the final price list (replaces nothing that was sold: there were no coin sales before)
INSERT INTO coin_packages (id, coins, price_halalas, label, badge, blurb, featured, sort) VALUES
  ('coins_500',   500,   375,  '500 عملة',    'الباقة الصغيرة',  'بداية خفيفة لشراء سكن عادي.', false, 1),
  ('coins_2000',  2000,  999,  '2,000 عملة',  'باقة البداية',    'تكفي سكنًا نادرًا وأكثر.', false, 2),
  ('coins_5000',  5000,  1999, '5,000 عملة',  'الأكثر توازناً',  'سكن ملحمي مع فائض للاحق.', false, 3),
  ('coins_10000', 10000, 3499, '10,000 عملة', 'أفضل قيمة',       'أقل سعر لكل عملة — اقترب من سكن خرافي.', true, 4);

CREATE TABLE purchases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref           text NOT NULL UNIQUE CHECK (ref ~ '^SC-[A-HJ-NP-Z2-9]{8}$'),   -- shown to the buyer (WhatsApp)
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id    text NOT NULL REFERENCES coin_packages(id),
  coins         integer NOT NULL CHECK (coins > 0),
  amount_halalas integer NOT NULL CHECK (amount_halalas > 0),
  currency      text NOT NULL DEFAULT 'SAR',
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'expired')),
  provider      text NOT NULL CHECK (provider IN ('whatsapp', 'moyasar')),
  provider_ref  text UNIQUE,
  raw_status    text NOT NULL DEFAULT '',
  confirmed_by  text,
  note          text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  paid_at       timestamptz
);
CREATE INDEX purchases_user ON purchases (user_id, created_at DESC);
CREATE INDEX purchases_status ON purchases (status, created_at DESC);
