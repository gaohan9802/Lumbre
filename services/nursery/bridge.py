#!/usr/bin/env python3
"""Private HTTP bridge for the vendored llm-nursery engine."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


ROOT = Path(__file__).resolve().parent
VENDOR_ROOT = ROOT / "vendor"
sys.path.insert(0, str(VENDOR_ROOT))

from nursery.toolface import nursery as nursery_command  # noqa: E402


HOST = os.getenv("NURSERY_HOST", "0.0.0.0")
PORT = int(os.getenv("NURSERY_PORT", "8800"))
TOKEN = os.getenv("NURSERY_BRIDGE_TOKEN", "")
TICK_SECONDS = max(60, int(os.getenv("NURSERY_TICK_SECONDS", "300")))
CHAT_DIR = Path(os.getenv("LUMBRE_CHAT_DIR", "/lumbre/chat"))
ARCHIVE_DB = Path(os.getenv("NURSERY_ARCHIVE_DB", "/tmp/lumbre-nursery-archive.sqlite"))
MAX_BODY_BYTES = 64 * 1024
MAMA_ACTIONS = frozenset({"hug", "soothe", "touch", "say", "choose", "farewell", "stay", "write", "letters"})

_state_lock = threading.Lock()
_state: dict[str, object] = {"last_tick_at": None, "last_error": None, "archive_windows": 0, "filtered_turns": 0}
_ADULT_CONTENT = re.compile(
    r"性交|做爱|阴茎|阴道|乳房|乳头|精液|高潮|口交|肛交|自慰|色情|性爱|裸聊|"
    r"\bcock\b|\bpussy\b|\bdick\b|\bcum\b|\borgasm\b|\bblowjob\b|\banal\b|\bfuck(?:ing|ed)?\b",
    re.IGNORECASE,
)


def _env() -> dict[str, str]:
    env = dict(os.environ)
    env["NURSERY_ARCHIVE_DB"] = str(ARCHIVE_DB)
    env.pop("DEEPSEEK_API_KEY", None)
    env.pop("DEEPSEEK_BASE", None)
    env.pop("PSYCHE_DS_MODEL", None)
    return env


def _run_driver(*args: str, timeout: int = 30) -> str:
    proc = subprocess.run(
        [sys.executable, "-m", "nursery.driver", *args],
        cwd=VENDOR_ROOT,
        env=_env(),
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "nursery command failed").strip()[:500])
    return proc.stdout.strip()


def _encoded_session_id(session_id: str) -> str:
    return base64.urlsafe_b64encode(session_id.encode()).decode().rstrip("=")


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None


def _session_messages(session_id: str) -> list[dict]:
    encoded = _encoded_session_id(session_id)
    header = _read_json(CHAT_DIR / "sessions" / f"{encoded}.json")
    if not isinstance(header, dict):
        header = _read_json(CHAT_DIR / "sessions" / f"{encoded}.bak")
    if not isinstance(header, dict):
        return []
    store = header.get("_messageStore")
    if not isinstance(store, dict) or store.get("version") != 1:
        return header.get("messages") if isinstance(header.get("messages"), list) else []
    generation = store.get("generation")
    count = store.get("chunkCount")
    if not isinstance(generation, str) or not isinstance(count, int) or count < 0:
        return []
    messages: list[dict] = []
    for index in range(count):
        chunk = _read_json(CHAT_DIR / "session-chunks" / encoded / generation / f"{index:06d}.json")
        if isinstance(chunk, list):
            messages.extend(item for item in chunk if isinstance(item, dict))
    message_count = store.get("messageCount")
    return messages[:message_count] if isinstance(message_count, int) and message_count >= 0 else messages


def _turns(session_id: str, messages: list[dict]) -> list[tuple[str, str]]:
    turns: list[tuple[str, str]] = []
    pending: list[tuple[str, str]] = []

    def flush() -> None:
        if not pending:
            return
        ids = "|".join(item[0] for item in pending)
        text = "\n".join(item[1] for item in pending).strip()
        if len(text) >= 30:
            digest = hashlib.sha256(ids.encode()).hexdigest()[:24]
            turns.append((f"{session_id}:{digest}", text))
        pending.clear()

    for index, message in enumerate(messages):
        role = message.get("role")
        content = message.get("content")
        if role not in {"user", "assistant"} or not isinstance(content, str) or not content.strip():
            continue
        message_id = str(message.get("id") or f"{index}")
        if role == "user":
            flush()
            pending.append((message_id, content.strip()))
        else:
            pending.append((message_id, content.strip()))
            flush()
    flush()
    return turns


def sync_chat_archive() -> tuple[int, int]:
    sessions: list[str] = []
    manifest = _read_json(CHAT_DIR / "manifest.json")
    if isinstance(manifest, dict) and isinstance(manifest.get("sessions"), list):
        sessions = [str(item.get("id")) for item in manifest["sessions"] if isinstance(item, dict) and item.get("id")]
    if not sessions:
        try:
            sessions = [
                base64.urlsafe_b64decode(path.stem + "=" * (-len(path.stem) % 4)).decode()
                for path in (CHAT_DIR / "sessions").glob("*.json")
            ]
        except (OSError, ValueError, UnicodeDecodeError):
            sessions = []

    temp = ARCHIVE_DB.with_suffix(".tmp")
    temp.parent.mkdir(parents=True, exist_ok=True)
    try:
        temp.unlink()
    except FileNotFoundError:
        pass
    conn = sqlite3.connect(temp)
    try:
        conn.execute("CREATE TABLE windows (id TEXT PRIMARY KEY, viewer TEXT NOT NULL, text TEXT NOT NULL)")
        turns = [turn for session_id in sessions for turn in _turns(session_id, _session_messages(session_id))]
        rows = [turn for turn in turns if not _ADULT_CONTENT.search(turn[1])]
        conn.executemany("INSERT INTO windows(id, viewer, text) VALUES (?, 'papa', ?)", rows)
        conn.commit()
    finally:
        conn.close()
    temp.chmod(0o600)
    os.replace(temp, ARCHIVE_DB)
    return len(rows), len(turns) - len(rows)


def tick_once() -> None:
    try:
        windows, filtered = sync_chat_archive()
        _run_driver("--tick", timeout=60)
        with _state_lock:
            _state.update(last_tick_at=time.time(), last_error=None, archive_windows=windows, filtered_turns=filtered)
    except Exception as error:  # tick is optional and must never kill the room
        with _state_lock:
            _state.update(last_tick_at=time.time(), last_error=str(error)[:500])


def tick_loop() -> None:
    while True:
        tick_once()
        time.sleep(TICK_SECONDS)


def _authorized(header: str | None) -> bool:
    if len(TOKEN) < 32 or not header or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[7:], TOKEN)


class Handler(BaseHTTPRequestHandler):
    server_version = "lumbre-nursery/1"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[nursery] {self.address_string()} {fmt % args}", flush=True)

    def _json(self, status: int, value: object) -> None:
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("invalid content length") from error
        if length < 0 or length > MAX_BODY_BYTES:
            raise ValueError("request body is too large")
        raw = self.rfile.read(length)
        value = json.loads(raw or b"{}")
        if not isinstance(value, dict):
            raise ValueError("request body must be an object")
        return value

    def _require_auth(self) -> bool:
        if _authorized(self.headers.get("Authorization")):
            return True
        self._json(401, {"ok": False, "error": "unauthorized"})
        return False

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            with _state_lock:
                state = dict(_state)
            self._json(200, {"ok": True, "psyche_enabled": False, **state})
            return
        if self.path == "/v1/status" and self._require_auth():
            self._json(200, {"ok": True, "result": nursery_command("papa", "status")})
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self._require_auth():
            return
        try:
            body = self._body()
            if self.path == "/v1/command":
                command = body.get("command")
                if not isinstance(command, str):
                    raise ValueError("command is required")
                self._json(200, {"ok": True, "result": nursery_command("papa", command)})
                return
            if self.path == "/v1/mama":
                action = body.get("action")
                if action not in MAMA_ACTIONS:
                    raise ValueError("invalid mama action")
                args = body.get("args", [])
                if not isinstance(args, list) or any(not isinstance(item, str) for item in args) or len(args) > 2:
                    raise ValueError("invalid mama args")
                output = _run_driver("papa", "mama", action, *args)
                self._json(200, json.loads(output))
                return
            if self.path == "/v1/birth":
                name = body.get("name", "")
                if not isinstance(name, str) or len(name.strip()) > 6:
                    raise ValueError("name must contain at most 6 characters")
                args = ["--init-birth", "papa"] + ([name.strip()] if name.strip() else [])
                self._json(200, {"ok": True, "result": _run_driver(*args)})
                return
            self._json(404, {"ok": False, "error": "not found"})
        except (ValueError, json.JSONDecodeError, subprocess.TimeoutExpired) as error:
            self._json(400, {"ok": False, "error": str(error)[:500]})
        except Exception as error:
            self._json(500, {"ok": False, "error": str(error)[:500]})


def main() -> None:
    if len(TOKEN) < 32:
        raise SystemExit("NURSERY_BRIDGE_TOKEN must contain at least 32 characters")
    threading.Thread(target=tick_loop, name="nursery-tick", daemon=True).start()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
