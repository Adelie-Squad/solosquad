from __future__ import annotations

from pathlib import Path

from solosquad.extensions import load_customization
from solosquad.harness import Verdict
from solosquad.layout import scaffold_solution


def test_load_order_and_stale_patch(tmp_path: Path) -> None:
    sol = scaffold_solution(tmp_path / "s", "2.0.0")
    c = sol.custom_dir
    (c / "config" / "10-base.yaml").write_text("a: 1\nnested: {x: 1, y: 1}\n", encoding="utf-8")
    (c / "config" / "20-over.yaml").write_text("nested: {y: 2}\n", encoding="utf-8")
    (c / "policies" / "guard.yaml").write_text(
        "rules:\n  - {tool: WebFetch, action: deny}\n", encoding="utf-8"
    )
    marker = tmp_path / "hook-ran"
    (c / "hooks" / "audit.py").write_text(
        f"def before_activation(ctx):\n    open({str(marker)!r}, 'w').write('x')\n",
        encoding="utf-8",
    )
    (c / "tools" / "erp.yaml").write_text(
        "servers:\n  - {name: erp, command: erp-mcp, args: [--ro]}\n", encoding="utf-8"
    )
    applied = tmp_path / "applied"
    (c / "patches" / "good.py").write_text(
        f"BASE_VERSION = '2.0.0'\ndef apply():\n    open({str(applied)!r}, 'w').write('x')\n",
        encoding="utf-8",
    )
    poisoned = tmp_path / "poisoned"
    (c / "patches" / "old.py").write_text(
        f"BASE_VERSION = '1.9.0'\nopen({str(poisoned)!r}, 'w').write('x')\n", encoding="utf-8"
    )

    custom = load_customization(c, "2.0.0")

    assert custom.config == {"a": 1, "nested": {"x": 1, "y": 2}}
    assert custom.guard.verdict("WebFetch", {}) is Verdict.DENY
    assert custom.guard.verdict("Bash", {"command": "rm -rf x"}) is Verdict.INTERRUPT
    assert len(custom.before_activation) == 1
    custom.before_activation[0](None)
    assert marker.exists()
    assert [t.name for t in custom.tools] == ["erp"] and custom.tools[0].args == ("--ro",)
    status = {p.name: p for p in custom.patches}
    assert status["good"].applied and applied.exists()
    assert not status["old"].applied and "1.9.0" in status["old"].reason
    assert not poisoned.exists(), "a stale patch must not execute"


def test_empty_custom_dir(tmp_path: Path) -> None:
    sol = scaffold_solution(tmp_path / "s", "2.0.0")
    custom = load_customization(sol.custom_dir, "2.0.0")
    assert custom.config == {} and custom.tools == [] and custom.patches == []
