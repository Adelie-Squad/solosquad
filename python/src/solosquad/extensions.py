"""Engine customization from `core/custom/` (decision 40).

Load order is fixed — each step may rely on the ones before it:

    1. config/*.yaml      deep-merged in file-name order        → EngineCustomization.config
    2. policies/guard.yaml · policies/routing.yaml               → guard · routing
    3. hooks/*.py         `before_activation(ctx)` / `after_activation(ctx, result)`
    4. tools/*.yaml       extra MCP servers handed to every agent
    5. patches/*.py       `BASE_VERSION = "<engine version>"` + `apply()`; applied only when
                          BASE_VERSION matches the running engine, otherwise reported as
                          stale so the FDE can re-fit it before the customer updates

Extension points survive engine updates untouched; patches are the last resort.
"""

from __future__ import annotations

import ast
import importlib.util
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType
from typing import Any

from solosquad.assets.text import load_yaml
from solosquad.harness.base import McpServer
from solosquad.harness.guard import GuardPolicy

Hook = Callable[..., Any]


@dataclass(frozen=True)
class PatchStatus:
    name: str
    base_version: str | None
    applied: bool
    reason: str = ""


@dataclass
class EngineCustomization:
    config: dict[str, Any] = field(default_factory=dict)
    guard: GuardPolicy = field(default_factory=GuardPolicy)
    routing: dict[str, Any] = field(default_factory=dict)
    before_activation: list[Hook] = field(default_factory=list)
    after_activation: list[Hook] = field(default_factory=list)
    tools: list[McpServer] = field(default_factory=list)
    patches: list[PatchStatus] = field(default_factory=list)


def _deep_merge(base: dict[str, Any], top: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in top.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _yaml_dict(path: Path) -> dict[str, Any]:
    data = load_yaml(path.read_text(encoding="utf-8")) if path.is_file() else None
    return data if isinstance(data, dict) else {}


def _import(path: Path, prefix: str) -> ModuleType:
    name = f"solosquad_custom_{prefix}_{path.stem}_{abs(hash(path)) & 0xFFFFFF:x}"
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _base_version(path: Path) -> str | None:
    """Read `BASE_VERSION` without executing the file — a stale patch must not run at all."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "BASE_VERSION" for t in node.targets)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        ):
            return node.value.value
    return None


def load_customization(custom_dir: Path, engine_version: str) -> EngineCustomization:
    c = EngineCustomization()
    for path in sorted((custom_dir / "config").glob("*.yaml")):
        c.config = _deep_merge(c.config, _yaml_dict(path))

    guard = _yaml_dict(custom_dir / "policies" / "guard.yaml")
    c.guard = GuardPolicy.from_dicts(
        list(guard.get("rules") or []), bool(guard.get("include_defaults", True))
    )
    c.routing = _yaml_dict(custom_dir / "policies" / "routing.yaml")

    for path in sorted((custom_dir / "hooks").glob("*.py")):
        module = _import(path, "hook")
        if callable(getattr(module, "before_activation", None)):
            c.before_activation.append(module.before_activation)
        if callable(getattr(module, "after_activation", None)):
            c.after_activation.append(module.after_activation)

    for path in sorted((custom_dir / "tools").glob("*.yaml")):
        for spec in _yaml_dict(path).get("servers") or []:
            c.tools.append(
                McpServer(
                    name=str(spec["name"]),
                    command=str(spec["command"]),
                    args=tuple(str(a) for a in spec.get("args") or ()),
                    env={str(k): str(v) for k, v in (spec.get("env") or {}).items()},
                )
            )

    for path in sorted((custom_dir / "patches").glob("*.py")):
        base = _base_version(path)
        if base != engine_version:
            reason = f"written for {base}, engine is {engine_version}"
            c.patches.append(PatchStatus(path.stem, base, False, reason))
            continue
        module = _import(path, "patch")
        apply = getattr(module, "apply", None)
        if callable(apply):
            apply()
        c.patches.append(PatchStatus(path.stem, base, True))
    return c
