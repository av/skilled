from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class SkillCall:
    skill: str
    timestamp: datetime
    project: str
    session_id: str
    source: str
