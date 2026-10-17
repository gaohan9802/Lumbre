from __future__ import annotations

import base64
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from renderer import render

MAX_BODY = 64 * 1024
MAX_OUTPUT = 8 * 1024 * 1024
SECRET = os.environ.get("PENCIL_WORKER_SECRET", "")
PORT = int(os.environ.get("PORT", "8790"))
RENDER_LOCK = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    server_version = "LumbrePencil/1"

    def _json(self, status: int, value: dict) -> None:
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path != "/healthz":
            return self._json(404, {"error": "not_found"})
        self._json(200, {"status": "ok", "busy": RENDER_LOCK.locked()})

    def do_POST(self) -> None:
        if self.path != "/render":
            return self._json(404, {"error": "not_found"})
        if len(SECRET) < 32 or self.headers.get("Authorization") != f"Bearer {SECRET}":
            return self._json(401, {"error": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._json(400, {"error": "invalid_length"})
        if length < 2 or length > MAX_BODY:
            return self._json(413, {"error": "request_too_large"})
        if not RENDER_LOCK.acquire(blocking=False):
            return self._json(429, {"error": "busy"})
        try:
            payload = json.loads(self.rfile.read(length))
            image = render(payload)
            if len(image) > MAX_OUTPUT:
                return self._json(500, {"error": "output_too_large"})
            self._json(200, {
                "mime": "image/png",
                "width": 880,
                "height": 1100,
                "image_base64": base64.b64encode(image).decode("ascii"),
            })
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self._json(400, {"error": str(error)[:240]})
        except Exception:
            self._json(500, {"error": "render_failed"})
        finally:
            RENDER_LOCK.release()

    def log_message(self, format: str, *args) -> None:
        print(f"pencil-worker {self.address_string()} {format % args}", flush=True)


if __name__ == "__main__":
    if len(SECRET) < 32:
        raise SystemExit("PENCIL_WORKER_SECRET must contain at least 32 characters")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

