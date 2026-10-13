"""Configuration loaded from environment variables."""
import os

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
GROUP_ID_RAW = os.environ.get("SCHOOLMATE_GROUP_ID", "").strip()
EDITOR_IDS_RAW = os.environ.get("SCHOOLMATE_EDITOR_IDS", "").strip()
DB_PATH = os.environ.get("SCHOOLMATE_DB_PATH", "data/schoolmate.sqlite3")
POLL_TIMEOUT = int(os.environ.get("SCHOOLMATE_POLL_TIMEOUT", "25"))
REMINDER_CHECK_SECONDS = int(os.environ.get("SCHOOLMATE_REMINDER_CHECK_SECONDS", "30"))
TIMEZONE_NAME = os.environ.get("SCHOOLMATE_TIMEZONE", "Asia/Tehran").strip()

try:
    GROUP_ID = int(GROUP_ID_RAW) if GROUP_ID_RAW else None
except ValueError:
    GROUP_ID = None

EDITOR_IDS = set()
for value in EDITOR_IDS_RAW.split(","):
    value = value.strip()
    if value:
        try:
            EDITOR_IDS.add(int(value))
        except ValueError:
            pass
