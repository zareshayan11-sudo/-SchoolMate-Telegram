"""Minimal Telegram Bot API client using only Python's standard library."""
import json
import urllib.error
import urllib.parse
import urllib.request


class TelegramAPIError(RuntimeError):
    pass


class TelegramAPI:
    def __init__(self, token: str):
        self.base_url = f"https://api.telegram.org/bot{token}/"

    def call(self, method: str, params=None, timeout=35):
        params = params or {}
        body = urllib.parse.urlencode({
            key: json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list, tuple)) else value
            for key, value in params.items() if value is not None
        }).encode("utf-8")
        request = urllib.request.Request(self.base_url + method, data=body)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise TelegramAPIError(str(exc)) from exc
        if not payload.get("ok"):
            raise TelegramAPIError(payload.get("description", "Telegram API request failed"))
        return payload.get("result")

    def get_updates(self, offset=None, timeout=25):
        return self.call("getUpdates", {"offset": offset, "timeout": timeout, "allowed_updates": ["message"]}, timeout=timeout + 10)

    def send_message(self, chat_id, text, reply_markup=None):
        return self.call("sendMessage", {
            "chat_id": chat_id,
            "text": text,
            "reply_markup": reply_markup,
            "disable_web_page_preview": True,
        })

    def set_commands(self):
        commands = [
            {"command": "start", "description": "Start SchoolMate"},
            {"command": "help", "description": "Show help"},
            {"command": "tasks", "description": "Show upcoming homework"},
            {"command": "exams", "description": "Show upcoming exams"},
            {"command": "week", "description": "Show this week's entries"},
            {"command": "addtask", "description": "Add homework (editors only)"},
            {"command": "addexam", "description": "Add an exam (editors only)"},
            {"command": "cancel", "description": "Cancel current form"},
        ]
        return self.call("setMyCommands", {"commands": commands})
