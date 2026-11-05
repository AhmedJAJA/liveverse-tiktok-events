-- «المجتمع»: friend requests between real accounts, blocking and reports.
-- A pair of accounts has at most one row: (user_a, user_b) is ordered so that user_a < user_b.
CREATE TABLE friendships (
  user_a       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b),
  CHECK (requested_by = user_a OR requested_by = user_b)
);
CREATE INDEX friendships_b ON friendships (user_b, status);

CREATE TABLE user_blocks (
  blocker    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker, blocked),
  CHECK (blocker <> blocked)
);
CREATE INDEX user_blocks_blocked ON user_blocks (blocked);

CREATE TABLE user_reports (
  id          serial PRIMARY KEY,
  reporter    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      text NOT NULL CHECK (reason IN ('spam', 'abuse', 'impersonation', 'inappropriate', 'other')),
  note        text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (reporter <> target)
);
CREATE INDEX user_reports_open ON user_reports (status, created_at DESC);
CREATE INDEX user_reports_pair ON user_reports (reporter, target, created_at DESC);
