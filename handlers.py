"""Command and form handling for the classroom bot."""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from config import TIMEZONE_NAME
from .calendar_utils import parse_date

HELP = (
    "📚 SchoolMate — Classroom Planner\n\n"
    "/tasks — upcoming homework\n"
    "/exams — upcoming exams\n"
    "/week — this week's tasks and exams\n"
    "/addtask — add homework (authorized editors)\n"
    "/addexam — add an exam (authorized editors)\n"
    "/cancel — cancel an active form\n\n"
    "Dates: Gregorian YYYY-MM-DD or Persian/Jalali YYYY/MM/DD."
)


class Handler:
    def __init__(self, api, db, group_id, editor_ids):
        self.api = api
        self.db = db
        self.group_id = group_id
        self.editor_ids = editor_ids
        self.forms = {}

    def reply(self, chat_id, text):
        self.api.send_message(chat_id, text)

    def handle_update(self, update):
        message = update.get("message") or {}
        chat = message.get("chat") or {}
        chat_id = chat.get("id")
        if chat_id != self.group_id:
            return
        text = (message.get("text") or "").strip()
        user = message.get("from") or {}
        user_id = user.get("id")
        if not text or not user_id:
            return
        command = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""

        if command == "/cancel":
            self.forms.pop(user_id, None)
            self.reply(chat_id, "Form cancelled.")
            return
        if user_id in self.forms and not command:
            self._continue_form(chat_id, user_id, text)
            return
        if command in ("/start", "/help"):
            self.reply(chat_id, HELP)
        elif command == "/tasks":
            self._list(chat_id, "task")
        elif command == "/exams":
            self._list(chat_id, "exam")
        elif command == "/week":
            today = datetime.now(ZoneInfo(TIMEZONE_NAME)).date()
            rows = self.db.list_entries(start_date=today.isoformat(), end_date=(today + timedelta(days=6)).isoformat())
            self._render(chat_id, rows, "📅 This week's plan")
        elif command in ("/addtask", "/addexam"):
            if user_id not in self.editor_ids:
                self.reply(chat_id, "Only designated class editors can add or change shared entries.")
                return
            kind = "task" if command == "/addtask" else "exam"
            self.forms[user_id] = {"kind": kind, "step": "subject"}
            self.reply(chat_id, f"Let's add a {kind}.\n1/3 — Send the subject (e.g. Physics). Use /cancel to stop.")
        elif command:
            self.reply(chat_id, "I don't recognize that command. Use /help.")

    def _continue_form(self, chat_id, user_id, text):
        form = self.forms[user_id]
        if form["step"] == "subject":
            if len(text) > 80:
                self.reply(chat_id, "Please keep the subject under 80 characters.")
                return
            form["subject"] = text
            form["step"] = "details"
            self.reply(chat_id, "2/3 — Send the task/exam details.")
        elif form["step"] == "details":
            if len(text) > 500:
                self.reply(chat_id, "Please keep the details under 500 characters.")
                return
            form["details"] = text
            form["step"] = "date"
            self.reply(chat_id, "3/3 — Send the date as Gregorian YYYY-MM-DD or Persian/Jalali YYYY/MM/DD (e.g. 2026-10-20 or 1405/07/29).")
        elif form["step"] == "date":
            try:
                due = parse_date(text)
                if due < datetime.now(ZoneInfo(TIMEZONE_NAME)).date():
                    self.reply(chat_id, "That date is in the past. Please send a future date as YYYY-MM-DD.")
                    return
            except ValueError:
                self.reply(chat_id, "Date not recognized. Use YYYY-MM-DD (Gregorian) or YYYY/MM/DD (Persian/Jalali).")
                return
            entry_id = self.db.add_entry(form["kind"], form["subject"], form["details"], due.isoformat(), user_id)
            kind_label = "Homework" if form["kind"] == "task" else "Exam"
            self.forms.pop(user_id, None)
            self.reply(chat_id, f"✅ {kind_label} #{entry_id} saved for {due.isoformat()}.")

    def _list(self, chat_id, kind):
        rows = self.db.list_entries(kind=kind)
        title = "📚 Upcoming homework" if kind == "task" else "📝 Upcoming exams"
        self._render(chat_id, rows, title)

    def _render(self, chat_id, rows, title):
        if not rows:
            self.reply(chat_id, title + "\n\nNothing scheduled yet.")
            return
        lines = [title, ""]
        for row in rows:
            icon = "📚" if row["kind"] == "task" else "📝"
            lines.append(f"{icon} #{row['id']} · {row['due_date']} · {row['subject']}")
            if row["details"]:
                lines.append(f"   {row['details']}")
        self.reply(chat_id, "\n".join(lines))
