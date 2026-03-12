#!/usr/bin/env python3
"""
Solo Founder Agents 설치 마법사
실행: python setup.py
"""

import os
import sys
import json
import subprocess
import shutil
from pathlib import Path

# rich가 없으면 설치
try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Prompt, Confirm
    from rich.table import Table
    from rich import print as rprint
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "rich", "-q"])
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Prompt, Confirm
    from rich.table import Table
    from rich import print as rprint

console = Console()

# ──────────────────────────────────────────────
# 유틸리티
# ──────────────────────────────────────────────


def check_command(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def run(cmd: str, cwd=None, capture=True):
    result = subprocess.run(
        cmd, shell=True, cwd=cwd, capture_output=capture, text=True
    )
    return result.returncode == 0, result.stdout.strip()


def load_env() -> dict:
    env = {}
    env_file = Path(".env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def save_env(updates: dict):
    env_file = Path(".env")
    env = load_env()
    env.update(updates)
    lines = []
    if env_file.exists():
        # 기존 줄 유지하며 값 업데이트
        for line in env_file.read_text().splitlines():
            stripped = line.strip()
            if (
                stripped
                and not stripped.startswith("#")
                and "=" in stripped
            ):
                k = stripped.split("=", 1)[0].strip()
                if k in updates:
                    lines.append(f"{k}={updates[k]}")
                    updates.pop(k, None)
                else:
                    lines.append(line)
            else:
                lines.append(line)
    # 새 키 추가
    for k, v in updates.items():
        lines.append(f"{k}={v}")
    env_file.write_text("\n".join(lines) + "\n")


# ──────────────────────────────────────────────
# 단계별 설치
# ──────────────────────────────────────────────


def step_welcome():
    console.print(
        Panel.fit(
            "[bold cyan]Solo Founder Agents[/bold cyan] 설치 마법사\n\n"
            "당신의 제품에 맞는 24/7 AI 비서 시스템을 구축합니다.\n"
            "소요 시간: 약 5~10분",
            title="시작",
        )
    )


def step_check_deps():
    console.print("\n[bold]-- 1단계: 환경 확인 --[/bold]")

    checks = {
        "Docker": check_command("docker"),
        "Python 3.10+": sys.version_info >= (3, 10),
        "git": check_command("git"),
    }

    table = Table(show_header=False, box=None)
    all_ok = True
    for name, ok in checks.items():
        status = "[green]v[/green]" if ok else "[red]x[/red]"
        table.add_row(status, name)
        if not ok:
            all_ok = False
    console.print(table)

    if not checks["Docker"]:
        console.print("\n[red]Docker가 필요합니다.[/red]")
        console.print("설치: https://docs.docker.com/desktop/")
        sys.exit(1)

    return True


def step_configure():
    console.print("\n[bold]-- 2단계: 기본 설정 --[/bold]")

    # .env 없으면 복사
    if not Path(".env").exists():
        shutil.copy(".env.example", ".env")
        console.print("[dim].env 파일 생성됨[/dim]")

    env = load_env()
    updates = {}

    # 오너 정보
    if not env.get("OWNER_NAME"):
        name = Prompt.ask("이름")
        updates["OWNER_NAME"] = name

    if not env.get("OWNER_ROLE"):
        role = Prompt.ask("직군/역할 (예: 개발자, 디자이너, PM 등)")
        updates["OWNER_ROLE"] = role

    # Discord 토큰
    current_token = env.get("DISCORD_TOKEN", "")
    if not current_token or current_token == "your-discord-bot-token-here":
        console.print(
            "\n[yellow]Discord Bot Token이 필요합니다.[/yellow]"
        )
        console.print(
            "1. https://discord.com/developers/applications 접속"
        )
        console.print("2. New Application → Bot → Reset Token")
        console.print("3. 아래에 붙여넣기\n")
        token = Prompt.ask("Discord Bot Token", password=True)
        updates["DISCORD_TOKEN"] = token

    # GitHub 토큰 (선택)
    current_gh = env.get("GITHUB_TOKEN", "")
    if not current_gh or current_gh == "your-github-token-here":
        want_gh = Confirm.ask(
            "\nGitHub 레포 자동 생성 기능을 사용할까요? (선택사항)"
        )
        if want_gh:
            console.print(
                "GitHub Settings → Developer settings"
                " → PAT → Fine-grained"
            )
            gh_token = Prompt.ask("GitHub Token", password=True)
            updates["GITHUB_TOKEN"] = gh_token
        else:
            updates["GITHUB_TOKEN"] = ""

    # repos 경로
    default_path = str(Path.home() / "repos")
    repos_path = Prompt.ask("프로젝트 저장 경로", default=default_path)
    Path(repos_path).mkdir(parents=True, exist_ok=True)
    updates["REPOS_BASE_PATH"] = repos_path

    if updates:
        save_env(updates)
        console.print("[green]v .env 저장됨[/green]")

    # OWNER.md에 실제 오너 정보 반영
    env = load_env()
    owner_md = Path("core/OWNER.md")
    if owner_md.exists():
        owner_name = env.get("OWNER_NAME", "")
        owner_role = env.get("OWNER_ROLE", "")
        if owner_name:
            content = owner_md.read_text()
            content = content.replace(
                "- 이름: (setup.py에서 자동 설정)",
                f"- 이름: {owner_name}",
            )
            content = content.replace(
                "- 역할: (setup.py에서 자동 설정)",
                f"- 역할: {owner_role}",
            )
            owner_md.write_text(content)

    return True


def step_setup_products():
    console.print("\n[bold]-- 3단계: 제품/조직 등록 --[/bold]")
    console.print("관리할 제품이나 조직을 등록합니다.\n")

    products = []

    while True:
        name = Prompt.ask(
            "제품/조직 이름\n"
            "엔터만 치면 완료"
        )
        if not name:
            if not products:
                console.print(
                    "[yellow]최소 1개는 등록해야 합니다.[/yellow]"
                )
                continue
            break

        org = Prompt.ask(
            f"  {name}의 GitHub 조직명 (없으면 엔터)", default=""
        )

        discord_server = Confirm.ask(
            f"  {name} 전용 Discord 서버를 자동 생성할까요?"
        )

        products.append(
            {
                "name": name,
                "slug": name.lower().replace(" ", "-"),
                "github_org": org,
                "discord_server": discord_server,
            }
        )

        console.print(f"[green]  v {name} 등록됨[/green]\n")

        more = Confirm.ask("제품을 더 추가할까요?")
        if not more:
            break

    # products.json 저장
    products_file = Path("core/products.json")
    products_file.parent.mkdir(exist_ok=True)
    products_file.write_text(
        json.dumps(products, ensure_ascii=False, indent=2)
    )

    # 각 제품 디렉토리 + CLAUDE.md 생성
    env = load_env()
    repos_path = Path(env.get("REPOS_BASE_PATH", "./repos"))

    for product in products:
        _create_product_structure(product, repos_path, env)

    save_env({"PRODUCTS": ",".join(p["slug"] for p in products)})
    return products


def _create_product_structure(
    product: dict, repos_path: Path, env: dict
):
    """제품 디렉토리 구조 생성"""
    slug = product["slug"]
    product_dir = repos_path / slug

    dirs = [
        product_dir / "product",
        product_dir / "memory",
        product_dir / "projects",
        product_dir / "discord",
    ]
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)

    # product/brief.md
    brief_file = product_dir / "product" / "brief.md"
    if not brief_file.exists():
        brief_file.write_text(
            f"""# {product['name']} -- 제품 브리프

## 한 줄 포지셔닝
(작성 필요)

## 현재 단계
PMF 탐색 중

## 타깃 고객
(작성 필요)

## 가장 위험한 가설 (현재)
(작성 필요)

## 검증 방법
(작성 필요)
"""
        )

    # product/weekly-state.md
    weekly_file = product_dir / "product" / "weekly-state.md"
    if not weekly_file.exists():
        weekly_file.write_text(
            f"""# {product['name']} -- 이번 주 포커스

## 이번 주 목표
(매주 업데이트)

## Riskiest Assumption
(이번 주 검증할 가장 위험한 가설)

## 막혀 있는 것
(병목)
"""
        )

    # memory JSONL 스키마 초기화
    schemas = {
        "hypotheses.jsonl": '{"_schema":"hypothesis","fields":["id","statement","risk","method","status","date"]}\n',
        "experiments.jsonl": '{"_schema":"experiment","fields":["id","hypothesis_id","method","result","signal_strength","date","next_action"]}\n',
        "decisions.jsonl": '{"_schema":"decision","fields":["date","decision","alternatives","reasoning","emotion_weight"]}\n',
        "signals.jsonl": '{"_schema":"signal","fields":["date","source","type","content","relevance","action"]}\n',
    }
    for fname, schema in schemas.items():
        f = product_dir / "memory" / fname
        if not f.exists():
            f.write_text(schema)

    # CLAUDE.md 자동 생성
    _generate_product_claude_md(product, product_dir, env)

    # discord/config.yaml
    discord_config = product_dir / "discord" / "config.yaml"
    if not discord_config.exists():
        discord_config.write_text(
            f"""# {product['name']} Discord 설정
# setup.py 실행 후 자동으로 채워집니다
product_name: {product['name']}
product_slug: {slug}
guild_id: null
channels:
  daily_brief: null
  experiments: null
  weekly_review: null
  signals: null
  owner_command: null
  errors: null
"""
        )

    console.print(
        f"[green]  v {product['name']} 디렉토리 구조 생성:"
        f" {product_dir}[/green]"
    )


def _generate_product_claude_md(
    product: dict, product_dir: Path, env: dict
):
    """제품 레벨 CLAUDE.md 자동 생성"""
    owner_name = env.get("OWNER_NAME", "오너")

    # core/ 경로를 setup 시점에 결정
    agents_dir = Path(__file__).parent.resolve()
    core_path = agents_dir / "core"

    content = f"""# CLAUDE.md -- {product['name']}
# 자동 생성됨. 직접 수정 가능.

## 나는 누구인가
{product['name']}의 전담 AI 팀이다.
{product['name']} 외의 프로젝트는 이 세션에서 존재하지 않는다.

## 오너 컨텍스트
@{core_path}/OWNER.md
@{core_path}/PRINCIPLES.md
@{core_path}/VOICE.md

## 제품 컨텍스트
@./product/brief.md
@./product/weekly-state.md

## 메모리 (최근 항목만 로드)
@./memory/signals.jsonl

## 작업 원칙
1. 검증 우선 -- 코딩 전에 행동 데이터 먼저
2. 단일 포커스 -- 이번 주 Riskiest Assumption 하나에만 집중
3. 보고 -- 작업 완료 시 Discord로 자동 보고

## 절대 하지 말 것
- 다른 제품({product['name']} 외) 언급 (컨텍스트 오염 금지)
- 검증 전 개발 제안
- 막연한 다수 타겟팅 제안
"""

    claude_md = product_dir / "CLAUDE.md"
    claude_md.write_text(content)


def step_build_docker():
    console.print("\n[bold]-- 4단계: Docker 빌드 --[/bold]")
    console.print("처음 한 번만 실행됩니다. (약 2~3분)\n")

    ok, _ = run("docker compose build", capture=False)
    if not ok:
        console.print(
            "[red]Docker 빌드 실패."
            " docker-compose.yml을 확인하세요.[/red]"
        )
        sys.exit(1)

    console.print("[green]v Docker 빌드 완료[/green]")
    return True


def step_invite_bot():
    console.print("\n[bold]-- 5단계: Discord Bot 초대 --[/bold]")

    console.print(
        "\n[yellow]Discord 봇을 서버에 초대해야 합니다.[/yellow]"
    )
    console.print(
        "\n1. https://discord.com/developers/applications 접속"
    )
    console.print("2. 방금 만든 앱 선택 → 'General Information'")
    console.print("3. Application ID 복사\n")

    app_id = Prompt.ask("Application ID 입력")

    scopes = "bot+applications.commands"
    permissions = "8"  # Administrator (채널 생성 권한 필요)
    invite_url = (
        f"https://discord.com/api/oauth2/authorize"
        f"?client_id={app_id}"
        f"&permissions={permissions}"
        f"&scope={scopes}"
    )

    console.print(f"\n[cyan]봇 초대 링크:[/cyan]")
    console.print(f"[link={invite_url}]{invite_url}[/link]")
    console.print(
        "\n위 링크로 관리할 모든 Discord 서버에 봇을 초대하세요."
    )

    Confirm.ask("모든 서버에 봇을 초대했나요?")

    save_env({"DISCORD_APP_ID": app_id})
    return True


def step_start():
    console.print("\n[bold]-- 6단계: 시스템 시작 --[/bold]\n")

    ok, _ = run("docker compose up -d", capture=False)
    if not ok:
        console.print("[red]시작 실패[/red]")
        sys.exit(1)

    console.print("[green]v 시스템 시작됨[/green]")


def step_finish(products):
    console.print(
        Panel.fit(
            "[bold green]설치 완료![/bold green]\n\n"
            "[bold]이제 할 수 있는 것:[/bold]\n\n"
            "- Discord에서 봇에게 메시지 → 에이전트가 응답\n"
            "- 새 프로젝트 생성: [cyan]python cli/new_project.py[/cyan]\n"
            "- 전체 현황: [cyan]python cli/status.py[/cyan]\n"
            "- 시스템 재시작: [cyan]docker compose restart[/cyan]\n"
            "- 로그 확인: [cyan]docker compose logs -f[/cyan]\n\n"
            "[bold]등록된 제품:[/bold]\n"
            + "\n".join(f"  - {p['name']}" for p in products)
            + "\n\n[yellow]참고: Claude Code Max 플랜이 필요합니다.[/yellow]\n"
            "[dim]Docker 내부 인증: docker compose exec bot claude login[/dim]",
            title="완료",
        )
    )


# ──────────────────────────────────────────────
# 메인
# ──────────────────────────────────────────────


def main():
    step_welcome()
    step_check_deps()
    step_configure()
    products = step_setup_products()
    step_build_docker()
    step_invite_bot()
    step_start()
    step_finish(products)


if __name__ == "__main__":
    main()
