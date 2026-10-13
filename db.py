"""SQLite persistence for shared class entries."""
import os
import sqlite3
from datetime import datetime, timezone


class Database:
    def __init__(self, path: str):
        self.path = path
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        self.init_db()

    def connect(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db(self):
        with self.connect() as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL CHECK(kind IN ('task','exam')),
                subject TEXT NOT NULL,
                details TEXT NOT NULL,
                due_date TEXT NOT NULL,
                created_by INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                reminder_sent INTEGER NOT NULL DEFAULT 0,
                done INTEGER NOT NULL DEFAULT 0
            )""")

    def add_entry(self, kind, subject, details, due_date, created_by):
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self.connect() as conn:
            cur = conn.execute(
                "INSERT INTO entries(kind, subject, details, due_date, created_by, created_at) VALUES(?,?,?,?,?,?)",
                (kind, subject.strip(), details.strip(), due_date, created_by, now),
            )
            return cur.lastrowid

    def list_entries(self, kind=None, limit=30, start_date=None, end_date=None):
        query = "SELECT * FROM entries WHERE done=0"
        args = []
        if kind:
            query += " AND kind=?"
            args.append(kind)
        if start_date:
            query += " AND due_date>=?"
            args.append(start_date)
        if end_date:
            query += " AND due_date<=?"
            args.append(end_date)
        query += " ORDER BY due_date, id LIMIT ?"
        args.append(limit)
        with self.connect() as conn:
            return conn.execute(query, args).fetchall()

    def due_for_reminder(self, today):
        with self.connect() as conn:
            return conn.execute(
                "SELECT * FROM entries WHERE done=0 AND reminder_sent=0 AND due_date=? ORDER BY id",
                (today,),
            ).fetchall()

    def mark_reminder_sent(self, entry_id):
        with self.connect() as conn:
            conn.execute("UPDATE entries SET reminder_sent=1 WHERE id=?", (entry_id,))

    def mark_done(self, entry_id):
        with self.connect() as conn:
            cur = conn.execute("UPDATE entries SET done=1 WHERE id=? AND done=0", (entry_id,))
            return cur.rowcount > 0
