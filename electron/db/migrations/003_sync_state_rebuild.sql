PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS sync_events;
DROP TABLE IF EXISTS sync_state;

CREATE TABLE IF NOT EXISTS sync_state (
  id TEXT PRIMARY KEY,
  online_mode INTEGER NOT NULL DEFAULT 0,
  last_push_at TEXT,
  last_pull_at TEXT,
  last_push_count INTEGER NOT NULL DEFAULT 0,
  last_pull_count INTEGER NOT NULL DEFAULT 0,
  last_conflict_count INTEGER NOT NULL DEFAULT 0,
  last_status TEXT NOT NULL DEFAULT 'offline',
  last_error TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO sync_state (
  id, online_mode, last_push_at, last_pull_at, last_push_count, last_pull_count, last_conflict_count, last_status, last_error, updated_at
) VALUES (
  'default', 0, NULL, NULL, 0, 0, 0, 'offline', NULL, datetime('now')
);

CREATE TABLE IF NOT EXISTS sync_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  pushed_count INTEGER NOT NULL DEFAULT 0,
  pulled_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_events_created_at ON sync_events(created_at DESC);

PRAGMA foreign_keys = ON;

