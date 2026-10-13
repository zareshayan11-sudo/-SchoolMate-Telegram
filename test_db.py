import os
import tempfile
import unittest
from datetime import date, timedelta

from schoolmate.db import Database


class DatabaseTests(unittest.TestCase):
    def test_add_and_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Database(os.path.join(tmp, "test.sqlite3"))
            due = (date.today() + timedelta(days=2)).isoformat()
            entry_id = db.add_entry("task", "Physics", "Read chapter 2", due, 123)
            rows = db.list_entries(kind="task")
            self.assertEqual(rows[0]["id"], entry_id)
            self.assertEqual(rows[0]["subject"], "Physics")


if __name__ == "__main__":
    unittest.main()
