-- Dwell on D1: accounts, and each account's records and reading log.

-- An account is an email address, used only to deliver sign-in tokens.
CREATE TABLE users (
  id      INTEGER PRIMARY KEY,
  email   TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL
);

-- Sign-in tokens, by SHA-256 hash. An account may have several (one per
-- device or recovery); each lasts until signed out. used = 0: never used yet.
CREATE TABLE tokens (
  hash    TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  used    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX tokens_user ON tokens (user_id);

-- Pins, groups, notes, stars and small state, last write wins per record by
-- the client's `updated` time; deletions are tombstones. seq orders changes
-- for pulling (one sequence across all accounts).
CREATE TABLE records (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,
  id      TEXT NOT NULL,
  data    TEXT,
  updated INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  seq     INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX records_seq ON records (user_id, seq);

-- The reading log: append-only, deduplicated by entry id within an account.
-- k = 1 for reading at the ribbon.
CREATE TABLE log (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id      TEXT NOT NULL,
  t       INTEGER NOT NULL,
  d       INTEGER NOT NULL,
  s       INTEGER NOT NULL,
  e       INTEGER NOT NULL,
  k       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, id)
);
CREATE INDEX log_seq ON log (user_id, seq);

-- Rate limits for sign-in email: a count per key within a window.
CREATE TABLE throttle (
  key   TEXT PRIMARY KEY,
  n     INTEGER NOT NULL,
  start INTEGER NOT NULL
);
