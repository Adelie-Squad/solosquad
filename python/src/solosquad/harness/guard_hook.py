"""Claude Code PreToolUse hook that enforces the guard policy (§D4) before a tool runs.

A CLI harness executes tools itself, so a guard must sit inside it. This hook reads the
policy (`SOLOSQUAD_GUARD_POLICY`) and the approvals already granted for this thread
(`SOLOSQUAD_GUARD_GRANTS`), then answers allow · deny. An action that needs a human is
denied with `SOLOSQUAD_APPROVAL_REQUIRED:<signature>` — the agent node turns that into a
graph interrupt, and a granted signature lets the exact same call through next time.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

from solosquad.harness.guard import GuardPolicy, Verdict

MARKER = "SOLOSQUAD_APPROVAL_REQUIRED"


def signature(tool: str, tool_input: dict[str, Any]) -> str:
    raw = json.dumps([tool, tool_input], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def decide(
    policy: GuardPolicy, grants: set[str], tool: str, tool_input: dict[str, Any]
) -> dict[str, Any] | None:
    verdict = policy.verdict(tool, tool_input)
    if verdict is Verdict.ALLOW:
        return None
    reason = policy.explain(tool, tool_input) or verdict.value
    if verdict is Verdict.INTERRUPT:
        sig = signature(tool, tool_input)
        if sig in grants:
            return None
        reason = f"{MARKER}:{sig}:{reason}"
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def _load(env: str) -> Any:
    path = os.environ.get(env)
    return (
        json.loads(Path(path).read_text(encoding="utf-8"))
        if path and Path(path).is_file()
        else None
    )


def main() -> None:
    event = json.load(sys.stdin)
    rules = _load("SOLOSQUAD_GUARD_POLICY") or {"rules": [], "include_defaults": True}
    policy = GuardPolicy.from_dicts(
        list(rules.get("rules") or []), bool(rules.get("include_defaults", True))
    )
    grants = set(_load("SOLOSQUAD_GUARD_GRANTS") or [])
    out = decide(policy, grants, str(event.get("tool_name")), event.get("tool_input") or {})
    if out is not None:
        sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    main()
