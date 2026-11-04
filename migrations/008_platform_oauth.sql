-- Streaming accounts are linked only by signing in with the platform (TikTok Login Kit / Kick OAuth 2.1).
-- A typed username, or a code posted in a chat, is no longer accepted as proof of ownership.
ALTER TABLE linked_accounts DROP CONSTRAINT IF EXISTS linked_accounts_verify_method_check;
ALTER TABLE linked_accounts ADD CONSTRAINT linked_accounts_verify_method_check CHECK (verify_method IS NULL OR verify_method IN ('live-chat-code', 'oauth'));
-- links proven the old way stop counting; their owners sign in with the platform once
UPDATE linked_accounts SET verified = false WHERE verify_method IS DISTINCT FROM 'oauth';
ALTER TABLE linked_accounts ADD COLUMN display_name text;
ALTER TABLE linked_accounts ADD COLUMN avatar_url text CHECK (avatar_url IS NULL OR avatar_url ~ '^https://');
ALTER TABLE linked_accounts ADD COLUMN scopes text;
-- AES-256-GCM sealed by the server (TOKEN_ENC_KEY); never sent to a browser
ALTER TABLE linked_accounts ADD COLUMN access_token_enc text;
ALTER TABLE linked_accounts ADD COLUMN refresh_token_enc text;
ALTER TABLE linked_accounts ADD COLUMN token_expires_at timestamptz;
ALTER TABLE linked_accounts ADD COLUMN refresh_expires_at timestamptz;
ALTER TABLE linked_accounts ADD COLUMN needs_reauth boolean NOT NULL DEFAULT false;
ALTER TABLE linked_accounts DROP CONSTRAINT IF EXISTS linked_accounts_platform_user_id_check;
ALTER TABLE linked_accounts ADD CONSTRAINT linked_accounts_platform_user_id_check CHECK (platform_user_id IS NULL OR platform_user_id ~ '^[A-Za-z0-9_.:-]{1,80}$');
-- one SPONGE LIVE account per platform account (by the platform's own id)
CREATE UNIQUE INDEX linked_accounts_one_platform_owner ON linked_accounts (platform, platform_user_id) WHERE verified;
