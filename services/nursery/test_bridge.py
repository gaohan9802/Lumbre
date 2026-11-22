from __future__ import annotations

import base64
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest


os.environ["NURSERY_BRIDGE_TOKEN"] = "bridge-fixture-secret-0000000000000000"
SPEC = importlib.util.spec_from_file_location("nursery_bridge", Path(__file__).with_name("bridge.py"))
bridge = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(bridge)


class BridgeTests(unittest.TestCase):
    def test_chat_archive_excludes_adult_turns(self):
        with tempfile.TemporaryDirectory() as root:
            chat = Path(root) / "chat"
            sessions = chat / "sessions"
            sessions.mkdir(parents=True)
            session_id = "session-one"
            encoded = base64.urlsafe_b64encode(session_id.encode()).decode().rstrip("=")
            (chat / "manifest.json").write_text(json.dumps({"sessions": [{"id": session_id}]}), encoding="utf-8")
            messages = [
                {"id": "u1", "role": "user", "content": "今天我们一起去公园里看花，还带了一块很好吃的小蛋糕。"},
                {"id": "a1", "role": "assistant", "content": "好呀，回来以后把看见的颜色都讲给我听。"},
                {"id": "u2", "role": "user", "content": "这是一段明确包含做爱和高潮等成人词汇的私密聊天，不应该交给孩子。"},
                {"id": "a2", "role": "assistant", "content": "这一段也应该跟着整轮一起被关在卧室门后。"},
            ]
            generation = "fixture-generation"
            chunks = chat / "session-chunks" / encoded / generation
            chunks.mkdir(parents=True)
            (chunks / "000000.json").write_text(json.dumps(messages, ensure_ascii=False), encoding="utf-8")
            (sessions / f"{encoded}.json").write_text(json.dumps({"_messageStore": {
                "version": 1, "generation": generation, "chunkCount": 1, "messageCount": len(messages),
            }}), encoding="utf-8")
            bridge.CHAT_DIR = chat
            bridge.ARCHIVE_DB = Path(root) / "archive.sqlite"
            included, filtered = bridge.sync_chat_archive()
            self.assertEqual((included, filtered), (1, 1))
            with sqlite3.connect(bridge.ARCHIVE_DB) as conn:
                rows = conn.execute("SELECT text FROM windows").fetchall()
            self.assertIn("公园", rows[0][0])
            self.assertNotIn("做爱", rows[0][0])

    def test_toolface_rejects_operational_commands(self):
        self.assertIn("没有这个指令", bridge.nursery_command("papa", "--tick"))

    def test_bridge_token_requires_exact_bearer(self):
        self.assertTrue(bridge._authorized(f"Bearer {bridge.TOKEN}"))
        self.assertFalse(bridge._authorized("Bearer wrong"))


if __name__ == "__main__":
    unittest.main()
