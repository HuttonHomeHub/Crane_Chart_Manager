-- Crane Charts' schema as the Python app (1.x) created it. IF NOT EXISTS throughout:
-- on a 1.x database this changes nothing and is only recorded, so the live data opens
-- unchanged and the Python app can still open it if rolled back to.
CREATE TABLE IF NOT EXISTS cranes (
  id           TEXT PRIMARY KEY,
  make         TEXT NOT NULL,
  type         TEXT NOT NULL,
  model        TEXT NOT NULL,
  capacity     TEXT NOT NULL,
  uploaded_at  TEXT NOT NULL,
  updated_at   TEXT,
  primary_file INTEGER
);

CREATE TABLE IF NOT EXISTS files (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  crane_id          TEXT NOT NULL,
  stored_name       TEXT NOT NULL,
  original_filename TEXT,
  label             TEXT,
  uploaded_at       TEXT NOT NULL,
  UNIQUE (crane_id, stored_name)
);

CREATE INDEX IF NOT EXISTS idx_files_crane ON files (crane_id);

-- Append-only audit log: never updated, only inserted. `filename` holds the crane id
-- (or the affected file) for the event.
CREATE TABLE IF NOT EXISTS spec_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type       TEXT NOT NULL,
  filename         TEXT NOT NULL,
  occurred_at      TEXT NOT NULL,
  snapshot_before  TEXT,
  snapshot_after   TEXT
);
