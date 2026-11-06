"""Declarative screens — `orgs/<org>/screens/<name>.yaml` (PRD v2.1.0 I30 · decision 52).

    format_version: 1
    title: 우리 회사 대시보드       # optional — shown as written; empty = the web's own name
    widgets:
      - widget: stats               # in progress · waiting approvals · done today · month's cost
      - widget: todo                # what I have to do — links into Task
      - widget: office              # the agents at work now
      - widget: artifact-latest     # the newest work product of one kind
        kind: finance.pnl
      - widget: schedule            # the next scheduled runs
      - widget: budget              # the whole cost area (org · per connection)

The first screen is the **dashboard** (2026-11-07 — it replaced home and took in the cost
screen). An org's `screens/home.yaml` is still read for it: `home` is an alias of
`dashboard`, and `dashboard.yaml` wins when both exist. `artifacts` stays declarative for
orgs that link to it; the web's menu now opens work products from Task. Each screen has a
built-in default, so an org without a file still gets a screen. The web renders each widget
from its registry; a widget id or a format version it does not know becomes a visible
placeholder, never a crash (K35).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from solosquad.assets.text import load_yaml
from solosquad.web_api.schemas import Screen, ScreenResponse, WidgetSpec

SUPPORTED_FORMATS = (1,)
"""Format versions this engine renders. A retired version stays here two minors (decision 44)."""

WIDGETS: dict[str, tuple[str, ...]] = {
    "stats": (),
    "todo": (),
    "schedule": (),
    "approvals": (),
    "artifact-latest": ("kind",),
    "artifact-list": (),
    "budget": (),
    "office": (),
    "workflows": (),
    "org-chart": (),
}
"""Widget id → required props. Must match the web's registry (`web/src/screens/registry.tsx`)."""

DEFAULTS: dict[str, Screen] = {
    "dashboard": Screen(
        format_version=1,
        widgets=[
            WidgetSpec(widget="stats"),
            WidgetSpec(widget="todo"),
            WidgetSpec(widget="office"),
            WidgetSpec(widget="artifact-latest", kind="finance.pnl"),  # type: ignore[call-arg]
            WidgetSpec(widget="schedule"),
            WidgetSpec(widget="budget"),
        ],
    ),
    "artifacts": Screen(
        format_version=1,
        widgets=[
            WidgetSpec(widget="artifact-latest", kind="finance.pnl"),  # type: ignore[call-arg]
            WidgetSpec(widget="artifact-list"),
        ],
    ),
}

ALIASES: dict[str, str] = {"home": "dashboard"}
"""Old screen name → the screen it became; a customer's file under the old name still counts."""

_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def screen_path(org_root: Path, name: str) -> Path:
    if not _NAME.match(name):
        raise ValueError(f"not a screen name: {name!r}")
    return org_root / "screens" / f"{name}.yaml"


def parse_screen(text: str) -> Screen:
    data: Any = load_yaml(text)
    if not isinstance(data, dict):
        raise ValueError("a screen file is a mapping (format_version · title · widgets)")
    return Screen.model_validate(data)


def load_screen(org_root: Path | None, name: str) -> ScreenResponse:
    """The org's file when there is one, else the built-in default. Errors are reported in
    the response (the web shows them), never raised — except an unknown screen name.
    An old name (`home`) answers as the screen it became (`dashboard`): its own file first,
    then a file under the old name."""
    screen_path(Path("."), name)  # refuse a name that is not one, before aliasing
    name = ALIASES.get(name, name)
    olds = [old for old, new in ALIASES.items() if new == name]
    candidates = [screen_path(org_root, n) for n in (name, *olds)] if org_root else []
    path = next((p for p in candidates if p.is_file()), None)
    if path is not None:
        try:
            screen = parse_screen(path.read_text(encoding="utf-8"))
        except (ValidationError, ValueError) as e:
            first = str(e).splitlines()
            return ScreenResponse(
                name=name, source="org", screen=None, error=" ".join(first[:3]) or "invalid"
            )
        return ScreenResponse(name=name, source="org", screen=screen)
    if name in DEFAULTS:
        return ScreenResponse(name=name, source="default", screen=DEFAULTS[name])
    raise KeyError(f"no screen {name}")


def screen_issues(screen: Screen) -> list[tuple[str, str, str]]:
    """→ (code, message, severity) for `solosquad validate`."""
    out: list[tuple[str, str, str]] = []
    if screen.format_version not in SUPPORTED_FORMATS:
        out.append(
            (
                "SCREEN_FORMAT_UNSUPPORTED",
                f"format_version {screen.format_version} — this engine reads {SUPPORTED_FORMATS}",
                "error",
            )
        )
        return out
    for i, w in enumerate(screen.widgets):
        required = WIDGETS.get(w.widget)
        if required is None:
            out.append(
                (
                    "SCREEN_WIDGET_UNKNOWN",
                    f"widgets[{i}]: no widget {w.widget!r} (known: {sorted(WIDGETS)})"
                    " — the web shows a placeholder",
                    "warn",
                )
            )
            continue
        props = w.model_extra or {}
        missing = [p for p in required if p not in props]
        if missing:
            out.append(
                ("SCREEN_WIDGET_PROPS", f"widgets[{i}] {w.widget}: missing {missing}", "error")
            )
    return out
