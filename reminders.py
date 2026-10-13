"""Basic once-per-day reminders for entries due today (UTC in this scaffold)."""
from datetime import datetime


def send_due_reminders(api, db, group_id, timezone):
    today = datetime.now(timezone).date().isoformat()
    rows = db.due_for_reminder(today)
    for row in rows:
        label = "Homework" if row["kind"] == "task" else "Exam"
        text = f"⏰ Reminder for today\n{label}: {row['subject']}\n{row['details']}\nDate: {row['due_date']}"
        api.send_message(group_id, text)
        db.mark_reminder_sent(row["id"])
