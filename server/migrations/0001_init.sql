-- YTenSUB private account, entitlement, card and auth-code database (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'pro_plus')),
  expires_at INTEGER,
  filter_sensitive INTEGER CHECK (filter_sensitive IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  code TEXT PRIMARY KEY,
  plan TEXT NOT NULL CHECK (plan IN ('pro', 'pro_plus')),
  days INTEGER NOT NULL CHECK (days > 0 AND days <= 3650),
  used_by TEXT,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS card_redemptions (
  code TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('pro', 'pro_plus')),
  days INTEGER NOT NULL CHECK (days > 0),
  applied_at INTEGER NOT NULL,
  tx_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_codes (
  email TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1)),
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_expires_at ON users (expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_cards_used_at ON cards (used_at DESC);
