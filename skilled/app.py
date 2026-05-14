from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.widgets import DataTable, Footer, Header, Label, Static

from skilled.models import SkillCall
from skilled.providers.base import Provider


def project_short(path: str) -> str:
    parts = path.rstrip("/").split("/")
    return parts[-1] if parts else path


class StatsPanel(Static):
    pass


class SkilledApp(App):
    CSS = """
    Screen {
        layout: vertical;
    }
    #stats {
        height: 3;
        dock: top;
        padding: 0 1;
    }
    #stats Label {
        width: 1fr;
        text-align: center;
        text-style: bold;
    }
    #main {
        height: 1fr;
    }
    #skills-table {
        width: 2fr;
    }
    #sidebar {
        width: 1fr;
        padding: 0 1;
    }
    #sidebar DataTable {
        height: 1fr;
    }
    .section-title {
        text-style: bold;
        padding: 0 0 0 0;
        color: $accent;
    }
    """

    TITLE = "skilled"
    BINDINGS = [
        Binding("q", "quit", "Quit"),
        Binding("r", "refresh", "Refresh"),
    ]

    def __init__(self, providers: list[Provider]) -> None:
        super().__init__()
        self.providers = providers
        self.calls: list[SkillCall] = []

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal(id="stats"):
            yield Label("", id="stat-total")
            yield Label("", id="stat-skills")
            yield Label("", id="stat-projects")
            yield Label("", id="stat-sources")
        with Horizontal(id="main"):
            yield DataTable(id="skills-table")
            with Vertical(id="sidebar"):
                yield Label("By project", classes="section-title")
                yield DataTable(id="projects-table")
                yield Label("By source", classes="section-title")
                yield DataTable(id="sources-table")
        yield Footer()

    def on_mount(self) -> None:
        self._load_data()

    def action_refresh(self) -> None:
        self._load_data()

    def _load_data(self) -> None:
        self.calls = []
        for provider in self.providers:
            if provider.available():
                self.calls.extend(provider.collect())

        self.calls.sort(key=lambda c: c.timestamp, reverse=True)
        self._update_stats()
        self._update_skills_table()
        self._update_projects_table()
        self._update_sources_table()

    def _update_stats(self) -> None:
        skills = {c.skill for c in self.calls}
        projects = {c.project for c in self.calls}
        sources = {c.source for c in self.calls}

        self.query_one("#stat-total", Label).update(f"Total calls: {len(self.calls)}")
        self.query_one("#stat-skills", Label).update(f"Skills: {len(skills)}")
        self.query_one("#stat-projects", Label).update(f"Projects: {len(projects)}")
        self.query_one("#stat-sources", Label).update(f"Sources: {len(sources)}")

    def _update_skills_table(self) -> None:
        table = self.query_one("#skills-table", DataTable)
        table.clear(columns=True)
        table.add_columns("Skill", "Calls", "Projects", "Sessions", "Last used")

        counts: Counter[str] = Counter()
        skill_projects: dict[str, set[str]] = {}
        skill_sessions: dict[str, set[str]] = {}
        skill_last: dict[str, datetime] = {}

        for c in self.calls:
            counts[c.skill] += 1
            skill_projects.setdefault(c.skill, set()).add(c.project)
            skill_sessions.setdefault(c.skill, set()).add(c.session_id)
            if c.skill not in skill_last or c.timestamp > skill_last[c.skill]:
                skill_last[c.skill] = c.timestamp

        now = datetime.now(tz=timezone.utc)
        for skill, count in counts.most_common():
            last = skill_last[skill]
            delta = now - last
            if delta.days > 0:
                ago = f"{delta.days}d ago"
            elif delta.seconds >= 3600:
                ago = f"{delta.seconds // 3600}h ago"
            else:
                ago = f"{delta.seconds // 60}m ago"

            table.add_row(
                skill,
                str(count),
                str(len(skill_projects[skill])),
                str(len(skill_sessions[skill])),
                ago,
            )

    def _update_projects_table(self) -> None:
        table = self.query_one("#projects-table", DataTable)
        table.clear(columns=True)
        table.add_columns("Project", "Calls")

        counts: Counter[str] = Counter()
        for c in self.calls:
            counts[project_short(c.project)] += 1

        for project, count in counts.most_common():
            table.add_row(project, str(count))

    def _update_sources_table(self) -> None:
        table = self.query_one("#sources-table", DataTable)
        table.clear(columns=True)
        table.add_columns("Source", "Calls")

        counts: Counter[str] = Counter()
        for c in self.calls:
            counts[c.source] += 1

        for source, count in counts.most_common():
            table.add_row(source, str(count))
