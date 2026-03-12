#!/usr/bin/env python3
"""
cli/status.py
전체 프로젝트 현황 대시보드
실행: python cli/status.py
"""

import os
import json
from pathlib import Path
from datetime import datetime

try:
    from rich.console import Console
    from rich.table import Table
    from rich.panel import Panel
    from rich import box
except ImportError:
    import subprocess
    import sys

    subprocess.run([sys.executable, "-m", "pip", "install", "rich", "-q"])
    from rich.console import Console
    from rich.table import Table
    from rich.panel import Panel
    from rich import box

console = Console()

REPOS_BASE = Path(os.getenv("REPOS_BASE_PATH", Path.home() / "repos"))
PRODUCTS_FILE = Path(__file__).parent.parent / "core" / "products.json"


def load_products() -> list[dict]:
    if PRODUCTS_FILE.exists():
        return json.loads(PRODUCTS_FILE.read_text())
    return []


def read_last_jsonl(path: Path, n: int = 3) -> list[dict]:
    if not path.exists():
        return []
    lines = [
        line
        for line in path.read_text().splitlines()
        if line.strip() and not line.startswith('{"_schema')
    ]
    items = []
    for line in lines[-n:]:
        try:
            items.append(json.loads(line))
        except Exception:
            pass
    return items


def get_project_status(project_dir: Path) -> str:
    brief = project_dir / "brief.md"
    if not brief.exists():
        return "? 설정 없음"
    mtime = datetime.fromtimestamp(brief.stat().st_mtime)
    days_ago = (datetime.now() - mtime).days
    if days_ago == 0:
        return "[green]오늘 활동[/green]"
    elif days_ago <= 3:
        return f"[yellow]{days_ago}일 전[/yellow]"
    else:
        return f"[dim]{days_ago}일 전[/dim]"


def main():
    console.print(
        Panel.fit(
            f"[bold cyan]제품 현황[/bold cyan]\n"
            f"[dim]{datetime.now().strftime('%Y-%m-%d %H:%M')}[/dim]",
            title="현황 대시보드",
        )
    )

    products = load_products()
    if not products:
        console.print(
            "[red]등록된 제품 없음. setup.py를 실행하세요.[/red]"
        )
        return

    for product in products:
        slug = product["slug"]
        product_dir = REPOS_BASE / slug

        # 제품 헤더
        console.print(
            f"\n[bold white]{product['name']}[/bold white]"
            f" [dim]({slug})[/dim]"
        )

        # 프로젝트 목록
        projects_dir = product_dir / "projects"
        if not projects_dir.exists() or not list(projects_dir.iterdir()):
            console.print("  [dim]프로젝트 없음[/dim]")
            continue

        table = Table(
            box=box.SIMPLE, show_header=True, header_style="dim"
        )
        table.add_column("프로젝트", style="cyan", min_width=24)
        table.add_column("상태", min_width=14)
        table.add_column("최근 결정", min_width=32)

        for proj_dir in sorted(projects_dir.iterdir()):
            if not proj_dir.is_dir():
                continue
            status = get_project_status(proj_dir)
            decisions = read_last_jsonl(
                proj_dir / "memory" / "decisions.jsonl", 1
            )
            last_decision = (
                decisions[-1].get("decision", "-")[:40]
                if decisions
                else "-"
            )
            table.add_row(proj_dir.name, status, last_decision)

        console.print(table)

        # 제품 메모리 요약
        hyp_file = product_dir / "memory" / "hypotheses.jsonl"
        hypotheses = read_last_jsonl(hyp_file, 5)
        testing = [
            h for h in hypotheses if h.get("status") == "TESTING"
        ]
        if testing:
            console.print(
                f"  [yellow]검증 중인 가설: {len(testing)}개[/yellow]"
            )

    # 시스템 상태
    console.print("\n[dim]─────────────────────────────[/dim]")
    console.print("[bold]시스템[/bold]")
    console.print(
        "  새 프로젝트:  [cyan]python cli/new_project.py[/cyan]"
    )
    console.print(
        "  로그 확인:    [cyan]docker compose logs -f[/cyan]"
    )
    console.print(
        "  재시작:       [cyan]docker compose restart[/cyan]"
    )


if __name__ == "__main__":
    main()
