"""The single resolve entry point (§B4 · decision 40).

Same name → first hit wins, in this order:

    1. workspace override   orgs/<org>/workspaces/<ws>/overrides/{agents,skills}/<name>/SKILL.md
    2. org team             orgs/<org>/team/{agents,skills}/<name>/SKILL.md
    3. package template     <bundle>/agents/{main,specialists}/<name>/SKILL.md
                            <bundle>/skills/<name>/SKILL.md

Owner and org knowledge are not overrides — every agent reads them as background.
An override of a template must say which template it came from (`derived_from:
<name>@<version>`) so an update can show the customer what changed underneath them.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from solosquad.assets.composition import KNOWN_TEAMS, Composition, read_composition
from solosquad.assets.skill import SkillParseError, SkillSpec, parse_skill_md
from solosquad.context.execution import ExecutionContext

Layer = Literal["workspace", "org", "package"]
Kind = Literal["agents", "skills"]


@dataclass(frozen=True)
class Resolved:
    name: str
    kind: Kind
    layer: Layer
    path: Path
    spec: SkillSpec

    @property
    def derived_from(self) -> str | None:
        value = self.spec.extra.get("derived_from")
        return value if isinstance(value, str) else None


class Resolver:
    def __init__(self, ctx: ExecutionContext) -> None:
        self.ctx = ctx

    def _roots(self, kind: Kind) -> list[tuple[Layer, Path]]:
        ws = self.ctx.workspace_root / "overrides" / kind
        org = self.ctx.org_root / "team" / kind
        if kind == "agents":
            pkg = [
                self.ctx.bundle_root / "agents" / "main",
                self.ctx.bundle_root / "agents" / "specialists",
            ]
        else:
            pkg = [self.ctx.bundle_root / "skills"]
        return [("workspace", ws), ("org", org), *(("package", p) for p in pkg)]

    def find(self, kind: Kind, name: str) -> Resolved | None:
        for layer, root in self._roots(kind):
            path = root / name / "SKILL.md"
            if path.is_file():
                spec = parse_skill_md(path.read_text(encoding="utf-8"), str(path))
                return Resolved(name, kind, layer, path, spec)
        return None

    def agent(self, name: str) -> Resolved:
        found = self.find("agents", name)
        if found is None:
            raise KeyError(f"no agent {name!r} in workspace, org team or package")
        return found

    def available(self, kind: Kind) -> dict[str, Resolved]:
        names: list[str] = []
        for _, root in self._roots(kind):
            if root.is_dir():
                names += [p.name for p in sorted(root.iterdir()) if (p / "SKILL.md").is_file()]
        out: dict[str, Resolved] = {}
        for name in dict.fromkeys(names):
            try:
                found = self.find(kind, name)
            except SkillParseError:
                continue
            if found is not None:
                out[name] = found
        return out

    def team(self, name: str) -> Composition | None:
        for root in (self.ctx.org_root / "team", self.ctx.bundle_root):
            found = read_composition(root / "teams" / name / "composition.yaml")
            if found is not None:
                return found
        return None

    def teams(self) -> dict[str, Composition]:
        return {t: c for t in KNOWN_TEAMS if (c := self.team(t)) is not None}

    def team_of(self, agent: str) -> str | None:
        for name, comp in self.teams().items():
            if agent == comp.main or agent in comp.members:
                return name
        return None

    def team_knowledge(self, team: str) -> str:
        for root in (self.ctx.org_root / "team", self.ctx.bundle_root):
            path = root / "teams" / team / "KNOWLEDGE.md"
            if path.is_file():
                return path.read_text(encoding="utf-8")
        return ""

    def owner_knowledge(self) -> str:
        return _read_dir(self.ctx.solution.owner_dir)

    def org_knowledge(self) -> str:
        return _read_dir(self.ctx.org_root / "knowledge")

    def unattributed_overrides(self) -> list[Resolved]:
        """Overrides that shadow a package template without `derived_from` — FDE should fix."""
        out = []
        kinds: tuple[Kind, ...] = ("agents", "skills")
        for kind in kinds:
            for r in self.available(kind).values():
                if r.layer != "package" and r.derived_from is None:
                    pkg = [p for layer, p in self._roots(r.kind) if layer == "package"]
                    if any((p / r.name / "SKILL.md").is_file() for p in pkg):
                        out.append(r)
        return out


def _read_dir(directory: Path) -> str:
    if not directory.is_dir():
        return ""
    parts = []
    for path in sorted(directory.glob("*.md")):
        text = path.read_text(encoding="utf-8").strip()
        if text:
            parts.append(text)
    return "\n\n".join(parts)
