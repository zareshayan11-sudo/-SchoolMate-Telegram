
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('task', 'exam')),
  subject TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS form_sessions (
  user_id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('task', 'exam')),
  step TEXT NOT NULL,
  subject TEXT,
  details TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entries_due
ON entries (due_date, kind, done);
