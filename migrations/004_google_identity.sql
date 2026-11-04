-- Sign in with Google: the account is tied to Google's stable subject ID (never to the e-mail alone).
ALTER TABLE users ADD COLUMN google_sub text UNIQUE CHECK (google_sub IS NULL OR char_length(google_sub) BETWEEN 1 AND 255);
ALTER TABLE users ADD COLUMN google_linked_at timestamptz;
-- Readable summary of each account's access (UTC timestamps; the site shows them in Saudi time).
CREATE VIEW account_access AS
SELECT u.id AS user_id, u.public_id, u.google_sub IS NOT NULL AS google_linked, u.created_at AS account_created_at,
       t.activated_at AS trial_started_at, t.ends_at AS trial_expires_at, (t.user_id IS NOT NULL) AS trial_used,
       s.plan AS subscription_plan,
       CASE WHEN s.id IS NULL THEN 'none' WHEN s.ends_at > now() THEN 'active' ELSE 'expired' END AS subscription_status,
       s.ends_at AS subscription_expires_at
FROM users u
LEFT JOIN trial_activations t ON t.user_id = u.id
LEFT JOIN LATERAL (SELECT id, plan, ends_at FROM subscriptions WHERE user_id = u.id AND status = 'active' ORDER BY ends_at DESC LIMIT 1) s ON true;
