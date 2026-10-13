# SchoolMate Telegram Bot (MVP scaffold)

Independent project. This repository does not depend on SMART ROOM or Atria.

## Features in this starter
- Python standard library only (Telegram Bot API via `urllib`, SQLite via `sqlite3`)
- Group-only command handling, scoped to one configured Telegram chat ID
- `/start`, `/help`, `/tasks`, `/exams`, `/week`, `/addtask`, `/addexam`, `/cancel`
- Step-by-step text forms for tasks and exams
- SQLite persistence
- Basic scheduled reminders for upcoming entries
- Configurable allowed editor user IDs

## Important status
This is an initial scaffold, not a production-ready bot. Test it in a private test group before adding it to the class group. Reminders are best-effort, use the configured timezone, and require the process to remain running. For free hosting, verify persistent disk and always-on runtime before choosing a provider.

## Setup
1. Create a bot with Telegram's official `@BotFather` and copy its token.
2. Create a new, separate GitHub repository for this project. Do not place these files in SMART ROOM or Atria.
3. Set environment variables on your hosting service (or locally in Termux):
   - `TELEGRAM_BOT_TOKEN` — bot token (keep private)
   - `SCHOOLMATE_GROUP_ID` — numeric ID of the one group the bot should serve
   - `SCHOOLMATE_EDITOR_IDS` — comma-separated Telegram user IDs allowed to add entries
   - `SCHOOLMATE_TIMEZONE` — timezone for date checks and reminders (default: `Asia/Tehran`; set `Asia/Baku` if that matches the class)
4. Run: `python main.py`

No token should be committed to GitHub or sent in chat. If a token leaks, revoke it with BotFather and create a new one.

## Date format
Date input accepts Gregorian `YYYY-MM-DD` and Persian/Jalali `YYYY/MM/DD`; Jalali input is converted to Gregorian for storage. Verify conversion against trusted calendar dates before relying on it for exams.

## Suggested next steps
- Add and test Persian/Jalali date conversion
- Add edit/delete flows with confirmation
- Add daily summary and configurable reminder times
- Add backup/export and error logging
- Choose hosting only after verifying free-tier uptime and persistent storage
