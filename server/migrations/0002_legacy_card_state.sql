-- Retain revocation tombstones and unresolved legacy claims instead of deleting them.
ALTER TABLE cards ADD COLUMN revoked_at INTEGER;
ALTER TABLE cards ADD COLUMN legacy_pending INTEGER NOT NULL DEFAULT 0 CHECK (legacy_pending IN (0, 1));
ALTER TABLE cards ADD COLUMN legacy_applied_plan TEXT;
ALTER TABLE cards ADD COLUMN legacy_applied_expires_at INTEGER;

CREATE TABLE legacy_import_progress (
  kind TEXT PRIMARY KEY CHECK (kind IN ('users', 'cards')),
  cursor TEXT NOT NULL DEFAULT '',
  complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
  scanned INTEGER NOT NULL DEFAULT 0
);
