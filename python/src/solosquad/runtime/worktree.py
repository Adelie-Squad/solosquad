"""One git worktree per thread (§D3 · decision 21) — concurrent tasks never share a checkout."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-") or "task"


def ensure_worktree(repo: Path, data_dir: Path, thread_id: str) -> Path:
    """Create (or reuse) `<data>/worktrees/<repo>-<thread>` on branch `solosquad/<thread>`."""
    target = data_dir / "worktrees" / f"{_safe(repo.name)}-{_safe(thread_id)}"
    if target.is_dir() and (target / ".git").exists():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    branch = f"solosquad/{_safe(thread_id)}"
    exists = (
        subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--verify", "--quiet", branch],
            capture_output=True,
            check=False,
        ).returncode
        == 0
    )
    cmd = ["git", "-C", str(repo), "worktree", "add", str(target)]
    cmd += [branch] if exists else ["-b", branch]
    subprocess.run(cmd, capture_output=True, check=True, text=True)
    return target
