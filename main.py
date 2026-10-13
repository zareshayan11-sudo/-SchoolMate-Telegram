"""Entry point for the independent SchoolMate Telegram bot."""
import logging
import os
import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from config import BOT_TOKEN, DB_PATH, EDITOR_IDS, GROUP_ID, POLL_TIMEOUT, REMINDER_CHECK_SECONDS, TIMEZONE_NAME
from schoolmate.db import Database
from schoolmate.handlers import Handler
from schoolmate.reminders import send_due_reminders
from schoolmate.telegram_api import TelegramAPI, TelegramAPIError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def main():
    if not BOT_TOKEN:
        raise SystemExit("Missing TELEGRAM_BOT_TOKEN environment variable.")
    if GROUP_ID is None:
        raise SystemExit("Missing or invalid SCHOOLMATE_GROUP_ID environment variable.")
    if not EDITOR_IDS:
        logging.warning("SCHOOLMATE_EDITOR_IDS is empty: no one can add entries yet.")

    try:
        timezone = ZoneInfo(TIMEZONE_NAME)
    except ZoneInfoNotFoundError as exc:
        raise SystemExit(f"Unknown SCHOOLMATE_TIMEZONE: {TIMEZONE_NAME}") from exc

    api = TelegramAPI(BOT_TOKEN)
    db = Database(DB_PATH)
    handler = Handler(api, db, GROUP_ID, EDITOR_IDS)
    try:
        api.set_commands()
    except TelegramAPIError as exc:
        logging.warning("Could not set bot commands: %s", exc)

    offset = None
    last_reminder_check = 0.0
    logging.info("SchoolMate started; configured for group %s", GROUP_ID)
    while True:
        try:
            updates = api.get_updates(offset=offset, timeout=POLL_TIMEOUT)
            for update in updates:
                offset = update["update_id"] + 1
                try:
                    handler.handle_update(update)
                except Exception:
                    logging.exception("Failed to handle update %s", update.get("update_id"))
            now = time.monotonic()
            if now - last_reminder_check >= REMINDER_CHECK_SECONDS:
                try:
                    send_due_reminders(api, db, GROUP_ID, timezone)
                except Exception:
                    logging.exception("Reminder check failed")
                last_reminder_check = now
        except KeyboardInterrupt:
            logging.info("SchoolMate stopping")
            break
        except TelegramAPIError as exc:
            logging.warning("Telegram API error: %s; retrying in 5 seconds", exc)
            time.sleep(5)


if __name__ == "__main__":
    main()
