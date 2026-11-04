-- Last successful sign-in and the Google profile picture (shown on «حسابي»).
ALTER TABLE users ADD COLUMN last_login_at timestamptz;
ALTER TABLE users ADD COLUMN picture_url text CHECK (picture_url IS NULL OR picture_url ~ '^https://[a-z0-9.-]+\.googleusercontent\.com/');
