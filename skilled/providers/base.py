from __future__ import annotations

from abc import ABC, abstractmethod

from skilled.models import SkillCall


class Provider(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    def collect(self) -> list[SkillCall]: ...
