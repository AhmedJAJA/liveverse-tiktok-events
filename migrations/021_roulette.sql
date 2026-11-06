-- سبونج لايف — «الروليت»: every match with the rules published on screen, every turn with its outcome, and the
-- winner. A record of what happened (fixed at the moment it happened); demo matches are marked and never ranked.
CREATE TABLE IF NOT EXISTS roulette_matches (
  id          uuid PRIMARY KEY,
  room        text NOT NULL,
  owner_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  demo        boolean NOT NULL DEFAULT false,
  rules       jsonb NOT NULL,
  players     jsonb NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  reason      text,
  winner      jsonb,
  stats       jsonb
);
CREATE INDEX IF NOT EXISTS roulette_matches_room ON roulette_matches (room, started_at DESC);
CREATE TABLE IF NOT EXISTS roulette_turns (
  match_id   uuid NOT NULL REFERENCES roulette_matches(id) ON DELETE CASCADE,
  turn       integer NOT NULL,
  holder     jsonb,
  target     jsonb,
  outcome    text NOT NULL CHECK (outcome IN ('out', 'empty', 'cancel')),
  reason     text,
  chamber    integer,
  chambers   integer,
  how        text,
  at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, turn)
);
