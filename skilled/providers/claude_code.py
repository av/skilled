from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from skilled.models import SkillCall
from skilled.providers.base import Provider

HISTORY_PATH = Path.home() / ".claude" / "history.jsonl"

BUILTINS = {
    "clear", "model", "usage", "resume", "new", "quit", "exit", "login",
    "logout", "help", "config", "compact", "doctor", "cost", "effort",
    "memory", "status", "skills", "permissions", "mcp", "terminal-setup",
    "remote-env", "remote-control",
}

SKILL_PATTERN = re.compile(r'^/([a-zA-Z][a-zA-Z0-9_-]*)$')


class ClaudeCodeProvider(Provider):
    @property
    def name(self) -> str:
        return "Claude Code"

    def available(self) -> bool:
        return HISTORY_PATH.exists()

    def collect(self) -> list[SkillCall]:
        if not self.available():
            return []

        calls: list[SkillCall] = []
        with HISTORY_PATH.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                display = entry.get("display", "")
                match = SKILL_PATTERN.match(display)
                if not match:
                    continue

                skill = match.group(1)
                if skill in BUILTINS:
                    continue

                ts = entry.get("timestamp", 0)
                dt = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
                project = entry.get("project", "")
                session_id = entry.get("sessionId", "")

                calls.append(SkillCall(
                    skill=skill,
                    timestamp=dt,
                    project=project,
                    session_id=session_id,
                    source=self.name,
                ))

        return calls
