#!/usr/bin/env python3
"""
cli/run_routine.py
수동 루틴 실행 CLI

실행 예시:
  python cli/run_routine.py                    # 인터랙티브 선택
  python cli/run_routine.py signal-scan        # 특정 루틴 직접 실행
  python cli/run_routine.py --all              # 전체 루틴 순차 실행
  python cli/run_routine.py -p my-product      # 특정 제품만
"""

import os
import sys
import json
import subprocess
import argparse
from pathlib import Path
from datetime import datetime

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Prompt
    from rich.table import Table
    from rich import box
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "rich", "-q"])
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Prompt
    from rich.table import Table
    from rich import box

console = Console()

REPOS_BASE = Path(os.getenv("REPOS_BASE_PATH", Path.home() / "repos"))
PRODUCTS_FILE = Path(__file__).parent.parent / "core" / "products.json"
ROUTINES_DIR = Path(__file__).parent.parent / "routines"

ROUTINES = [
    {"id": "morning-brief", "name": "Morning Brief", "emoji": "📋"},
    {"id": "signal-scan", "name": "Signal Scan", "emoji": "🔍"},
    {"id": "experiment-check", "name": "Experiment Check", "emoji": "🧪"},
    {"id": "daily-log", "name": "Daily Log", "emoji": "📝"},
    {"id": "weekly-review", "name": "Weekly Review", "emoji": "📊"},
]


def load_products() -> list[dict]:
    if PRODUCTS_FILE.exists():
        return json.loads(PRODUCTS_FILE.read_text())
    return []


def run_claude_sync(prompt: str, cwd: Path) -> str:
    """Claude Code --print 동기 실행"""
    try:
        result = subprocess.run(
            ["claude", "--print"],
            input=prompt,
            capture_output=True,
            text=True,
            cwd=str(cwd),
            timeout=180,
        )
        return result.stdout.strip() if result.stdout else "응답 없음"
    except subprocess.TimeoutExpired:
        return "⏱️ 타임아웃 (3분 초과)"
    except FileNotFoundError:
        return "⚠️ Claude Code가 설치되지 않았습니다. claude 명령을 확인하세요."
    except Exception as e:
        return f"⚠️ 오류: {e}"


def save_routine_log(
    product_dir: Path, routine_id: str, routine_name: str, result: str
):
    """루틴 결과를 파일에 저장"""
    log_dir = product_dir / "memory" / "routine-logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / (
        f"{routine_id}-{datetime.now().strftime('%Y%m%d-%H%M')}.md"
    )
    log_file.write_text(f"# {routine_name}\n\n{result}")
    return log_file


def run_routine_for_product(routine: dict, product: dict):
    """단일 제품에 대해 루틴 실행"""
    product_dir = REPOS_BASE / product["slug"]
    prompt_file = ROUTINES_DIR / f"{routine['id']}.md"

    if not prompt_file.exists():
        console.print(
            f"  [red]프롬프트 없음: {prompt_file}[/red]"
        )
        return

    prompt = prompt_file.read_text()

    console.print(
        f"  [dim]Claude Code 실행 중... (최대 3분)[/dim]"
    )
    result = run_claude_sync(prompt, product_dir)

    # 파일 저장
    log_file = save_routine_log(
        product_dir, routine["id"], routine["name"], result
    )

    # 결과 출력
    console.print(
        Panel(
            result[:2000] + ("..." if len(result) > 2000 else ""),
            title=f"{routine['emoji']} {routine['name']}",
            subtitle=f"저장: {log_file}",
        )
    )


def select_routine() -> dict:
    """루틴 선택"""
    console.print("\n[bold]루틴 선택:[/bold]")
    for i, r in enumerate(ROUTINES, 1):
        console.print(f"  {i}. {r['emoji']} {r['name']}")

    choice = Prompt.ask(
        "선택", choices=[str(i) for i in range(1, len(ROUTINES) + 1)]
    )
    return ROUTINES[int(choice) - 1]


def select_product(products: list[dict]) -> dict:
    """제품 선택"""
    if len(products) == 1:
        return products[0]

    console.print("\n[bold]제품 선택:[/bold]")
    for i, p in enumerate(products, 1):
        console.print(f"  {i}. {p['name']}")

    choice = Prompt.ask(
        "선택", choices=[str(i) for i in range(1, len(products) + 1)]
    )
    return products[int(choice) - 1]


def main():
    parser = argparse.ArgumentParser(description="수동 루틴 실행")
    parser.add_argument(
        "routine",
        nargs="?",
        help="루틴 ID (morning-brief, signal-scan, experiment-check, daily-log, weekly-review)",
    )
    parser.add_argument(
        "-p", "--product", help="특정 제품 slug만 실행"
    )
    parser.add_argument(
        "--all", action="store_true", help="전체 루틴 순차 실행"
    )
    args = parser.parse_args()

    products = load_products()
    if not products:
        console.print(
            "[red]등록된 제품 없음. setup.py를 먼저 실행하세요.[/red]"
        )
        return

    # 제품 필터
    if args.product:
        products = [
            p for p in products if p["slug"] == args.product
        ]
        if not products:
            console.print(
                f"[red]'{args.product}' 제품을 찾을 수 없습니다.[/red]"
            )
            return

    # 루틴 결정
    if args.all:
        routines_to_run = ROUTINES
    elif args.routine:
        routine = next(
            (r for r in ROUTINES if r["id"] == args.routine), None
        )
        if not routine:
            console.print(
                f"[red]'{args.routine}' 루틴을 찾을 수 없습니다.[/red]"
            )
            console.print(
                f"가능한 루틴: {', '.join(r['id'] for r in ROUTINES)}"
            )
            return
        routines_to_run = [routine]
    else:
        # 인터랙티브 모드
        routines_to_run = [select_routine()]
        if len(products) > 1:
            products = [select_product(products)]

    # 실행
    for routine in routines_to_run:
        for product in products:
            console.print(
                f"\n[bold]{routine['emoji']} {routine['name']}"
                f" → {product['name']}[/bold]"
            )
            run_routine_for_product(routine, product)


if __name__ == "__main__":
    main()
