-- «نسيت كلمة المرور»: one-time reset links (only a hash is stored; 30 minutes; a link works once).
ALTER TABLE email_tokens DROP CONSTRAINT IF EXISTS email_tokens_purpose_check;
ALTER TABLE email_tokens ADD CONSTRAINT email_tokens_purpose_check CHECK (purpose IN ('verify', 'reset'));
