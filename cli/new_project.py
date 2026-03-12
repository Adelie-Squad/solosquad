#!/usr/bin/env python3
"""
cli/new_project.py
새 프로젝트 생성 CLI

실행: python cli/new_project.py
"""

import os
import sys
import json
import subprocess
from pathlib import Path
from datetime import datetime

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Prompt, Confirm
    from rich.columns import Columns
    from rich.text import Text
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "rich", "-q"])
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Prompt, Confirm

console = Console()

REPOS_BASE = Path(os.getenv("REPOS_BASE_PATH", Path.home() / "repos"))
PRODUCTS_FILE = Path(__file__).parent.parent / "core" / "products.json"
CORE_DIR = Path(__file__).parent.parent / "core"
SKILLS_DIR = CORE_DIR / "skills"

# 에이전트 목록 (선택 가능)
ALL_AGENTS = {
    "strategy": [
        ("pmf-planner", "PMF 탐색, 가설 수립"),
        ("feature-planner", "기능 추가/개선 기획"),
        ("data-analyst", "데이터 분석, 인사이트"),
        ("business-strategist", "사업/전략 기획"),
        ("idea-refiner", "아이디어 구체화"),
        ("scope-estimator", "개발 범위/일정"),
    ],
    "growth": [
        ("gtm-strategist", "Go-To-Market 전략"),
        ("content-writer", "콘텐츠 카피라이팅"),
        ("brand-marketer", "브랜딩 전략"),
        ("paid-marketer", "광고 최적화"),
    ],
    "experience": [
        ("user-researcher", "유저 리서치"),
        ("desk-researcher", "시장/경쟁 리서치"),
        ("ux-designer", "UX 설계"),
        ("ui-designer", "UI 디자인"),
    ],
    "engineering": [
        ("fde", "빠른 프로토타입"),
        ("architect", "시스템 아키텍처"),
        ("backend-developer", "서버 개발"),
        ("frontend-developer", "프론트엔드 개발"),
        ("data-engineer", "데이터 파이프라인"),
    ],
}

# 프로젝트 타입별 기본 에이전트
PROJECT_TYPE_AGENTS = {
    "A": {
        "name": "PMF 탐색 (0→1)",
        "agents": [
            "pmf-planner",
            "data-analyst",
            "user-researcher",
            "gtm-strategist",
            "fde",
        ],
    },
    "B": {
        "name": "기능 확장",
        "agents": [
            "feature-planner",
            "data-analyst",
            "ux-designer",
            "backend-developer",
        ],
    },
    "C": {
        "name": "리브랜딩",
        "agents": [
            "desk-researcher",
            "brand-marketer",
            "content-writer",
            "ui-designer",
        ],
    },
    "D": {
        "name": "빠른 프로토타입",
        "agents": ["idea-refiner", "fde", "gtm-strategist"],
    },
    "E": {
        "name": "커스텀",
        "agents": [],
    },
}


def load_products() -> list[dict]:
    if PRODUCTS_FILE.exists():
        return json.loads(PRODUCTS_FILE.read_text())
    return []


def slugify(name: str) -> str:
    return name.lower().replace(" ", "-").replace("/", "-")


# ──────────────────────────────────────────────
# 인터랙티브 UX
# ──────────────────────────────────────────────


def select_product() -> dict:
    """제품 선택"""
    products = load_products()

    if not products:
        console.print(
            "[red]등록된 제품이 없습니다. setup.py를 먼저 실행하세요.[/red]"
        )
        sys.exit(1)

    console.print("\n[bold]어느 제품/조직의 프로젝트인가요?[/bold]")
    for i, p in enumerate(products, 1):
        org_hint = (
            f" [dim]({p['github_org']})[/dim]" if p.get("github_org") else ""
        )
        console.print(f"  {i}. {p['name']}{org_hint}")

    choice = Prompt.ask(
        "선택", choices=[str(i) for i in range(1, len(products) + 1)]
    )
    return products[int(choice) - 1]


def select_project_type() -> tuple[str, list[str]]:
    """프로젝트 타입 선택"""
    console.print("\n[bold]프로젝트 타입을 선택하세요:[/bold]")
    for key, info in PROJECT_TYPE_AGENTS.items():
        agents_hint = (
            f" [dim]({', '.join(info['agents'][:3])}"
            f"{'...' if len(info['agents']) > 3 else ''})[/dim]"
        )
        console.print(f"  {key}. {info['name']}{agents_hint}")

    ptype = Prompt.ask("선택", choices=list(PROJECT_TYPE_AGENTS.keys()))

    if ptype == "E":
        agents = select_agents_custom()
    else:
        agents = PROJECT_TYPE_AGENTS[ptype]["agents"]
        # 기본 선택 확인 + 수정 옵션
        console.print(f"\n기본 에이전트: [cyan]{', '.join(agents)}[/cyan]")
        if Confirm.ask("에이전트를 수정할까요?"):
            agents = select_agents_custom(preselected=agents)

    return ptype, agents


def select_agents_custom(preselected: list[str] = None) -> list[str]:
    """에이전트 수동 선택"""
    preselected = preselected or []
    selected = set(preselected)

    console.print(
        "\n[bold]에이전트 선택[/bold] (번호 입력 → 토글, 엔터 → 완료)\n"
    )

    all_agents_flat = []
    for team, agents in ALL_AGENTS.items():
        for slug, desc in agents:
            all_agents_flat.append((slug, desc, team))

    while True:
        # 목록 출력
        for i, (slug, desc, team) in enumerate(all_agents_flat, 1):
            mark = "[green]v[/green]" if slug in selected else "  "
            console.print(
                f"  {mark} {i:2}. [cyan]{slug:<22}[/cyan]"
                f" {desc} [dim]({team})[/dim]"
            )

        raw = Prompt.ask("\n번호 입력 (엔터 = 완료)")
        if not raw.strip():
            break

        try:
            idx = int(raw.strip()) - 1
            if 0 <= idx < len(all_agents_flat):
                slug = all_agents_flat[idx][0]
                if slug in selected:
                    selected.discard(slug)
                else:
                    selected.add(slug)
        except ValueError:
            pass

        console.clear()
        console.print(
            "\n[bold]에이전트 선택[/bold] (번호 입력 → 토글, 엔터 → 완료)\n"
        )

    return list(selected)


# ──────────────────────────────────────────────
# 프로젝트 생성
# ──────────────────────────────────────────────


def create_project(
    product: dict,
    project_name: str,
    project_desc: str,
    agents: list[str],
    goal: str,
):
    slug = slugify(project_name)
    product_dir = REPOS_BASE / product["slug"]
    project_dir = product_dir / "projects" / slug

    # 디렉토리 생성
    (project_dir / "memory").mkdir(parents=True, exist_ok=True)
    (project_dir / "stage-1-research").mkdir(exist_ok=True)
    (project_dir / "stage-2-planning").mkdir(exist_ok=True)
    (project_dir / "stage-3-execution").mkdir(exist_ok=True)

    # brief.md
    (project_dir / "brief.md").write_text(
        f"""# {project_name}

## 목적
{project_desc}

## 완료 기준
{goal}

## 제품
{product['name']}

## 생성일
{datetime.now().strftime('%Y-%m-%d')}

## 현재 단계
stage-1-research
"""
    )

    # team.yaml
    import yaml

    team_config = {
        "active_agents": agents,
        "locked_agents": [],
        "project": project_name,
        "product": product["name"],
    }
    (project_dir / "team.yaml").write_text(
        yaml.dump(team_config, allow_unicode=True, default_flow_style=False)
    )

    # memory JSONL 초기화
    schemas = {
        "experiments.jsonl": '{"_schema":"experiment","fields":["id","hypothesis_id","method","result","signal_strength","date"]}\n',
        "decisions.jsonl": '{"_schema":"decision","fields":["date","decision","alternatives","reasoning","emotion_weight"]}\n',
        "handoffs.jsonl": '{"_schema":"handoff","fields":["date","from_stage","to_stage","summary","context"]}\n',
    }
    for fname, schema in schemas.items():
        (project_dir / "memory" / fname).write_text(schema)

    # CLAUDE.md 자동 생성
    _generate_project_claude_md(
        project_dir, product, project_name, agents, goal
    )

    # program.md (autoresearch 스타일 에이전트 지침)
    _generate_program_md(
        project_dir, product, project_name, agents, project_desc
    )

    return project_dir


def _generate_project_claude_md(
    project_dir: Path,
    product: dict,
    project_name: str,
    agents: list[str],
    goal: str,
):
    other_products = [
        p["name"] for p in load_products() if p["name"] != product["name"]
    ]

    # core/ 경로를 동적으로 결정
    core_path = Path(__file__).parent.parent.resolve() / "core"

    content = f"""# CLAUDE.md -- {project_name}
# 자동 생성: {datetime.now().strftime('%Y-%m-%d')} | {product['name']}

## Layer 0: Universal (읽기 전용)
@{core_path}/OWNER.md
@{core_path}/PRINCIPLES.md
@{core_path}/VOICE.md

## Layer 1: Product
@../../product/brief.md
@../../product/weekly-state.md

## Layer 2: Project
@./brief.md
@./team.yaml
@./memory/decisions.jsonl

## Active Agents
{', '.join(agents)}

## 이 프로젝트의 완료 기준
{goal}

## 컨텍스트 격리
다음 제품/프로젝트는 이 세션에 존재하지 않는다:
{', '.join(other_products) if other_products else '없음'}

## 보고 규칙
작업 완료 시 Discord #{product['slug']}-{project_name.lower().replace(' ', '-')} 채널에 보고
"""
    (project_dir / "CLAUDE.md").write_text(content)


def _generate_program_md(
    project_dir: Path,
    product: dict,
    project_name: str,
    agents: list[str],
    description: str,
):
    # 에이전트별 스킬 내용 포함
    agent_sections = []
    for agent_slug in agents:
        skill_file = SKILLS_DIR / f"{agent_slug}.md"
        if skill_file.exists():
            agent_sections.append(
                f"### {agent_slug}\n{skill_file.read_text()[:500]}..."
            )

    content = f"""# program.md -- {project_name}
> 이 파일을 읽고 작업을 시작하라. (autoresearch 방식)

## 프로젝트 목적
{description}

## 제품 컨텍스트
@../../product/brief.md 를 읽어라.

## 작업 루프

### Step 1: 현황 파악
- @./memory/decisions.jsonl 읽기 (최근 5개)
- @../../memory/hypotheses.jsonl 에서 status=TESTING 확인

### Step 2: 다음 행동 결정
- 이 프로젝트의 완료 기준에서 가장 멀리 있는 것 1개 선택
- 48시간 내 완료 가능한 작업으로 분해

### Step 3: 실행 후 기록
- 결과를 @./memory/decisions.jsonl 에 append
- 실험이면 @../../memory/experiments.jsonl 에 append

### Step 4: 다음 에이전트 인계 필요 시
- @./memory/handoffs.jsonl 에 handoff 기록
- stage 폴더에 _handoff.md 작성

## 활성 에이전트
{chr(10).join(f'- {a}' for a in agents)}

## 이번에 절대 하지 말 것
- 스코프 확장 (완료 기준 외 작업)
- 검증 없는 개발 제안
- 다른 제품({product['name']} 외) 언급
"""
    (project_dir / "program.md").write_text(content)


def create_github_repo(
    product: dict, project_name: str, desc: str
) -> str | None:
    """GitHub 레포 생성 (PyGithub 사용)"""
    github_token = os.getenv("GITHUB_TOKEN", "")
    if not github_token:
        return None

    try:
        from github import Github

        g = Github(github_token)

        org_name = product.get("github_org")
        slug = slugify(project_name)

        if org_name:
            org = g.get_organization(org_name)
            repo = org.create_repo(slug, description=desc, private=False)
        else:
            user = g.get_user()
            repo = user.create_repo(slug, description=desc, private=False)

        return repo.html_url
    except Exception as e:
        console.print(f"[yellow]GitHub 레포 생성 실패: {e}[/yellow]")
        return None


# ──────────────────────────────────────────────
# 메인
# ──────────────────────────────────────────────


def main():
    console.print(
        Panel.fit(
            "[bold cyan]새 프로젝트 생성[/bold cyan]",
            title="새 프로젝트",
        )
    )

    # 1. 제품 선택
    product = select_product()
    console.print(f"\n[green]v[/green] 제품: [bold]{product['name']}[/bold]")

    # 2. 프로젝트 정보
    console.print()
    project_name = Prompt.ask(
        "프로젝트 이름 (예: PMF-검증, 랜딩페이지-카피)"
    )
    project_desc = Prompt.ask("목적을 한 줄로")
    goal = Prompt.ask(
        "완료 기준 (예: 이메일 10건 수집, 포트폴리오 배포)"
    )

    # 3. 에이전트 선택
    _, agents = select_project_type()

    # 4. 확인
    console.print(
        Panel(
            f"[bold]제품:[/bold] {product['name']}\n"
            f"[bold]이름:[/bold] {project_name}\n"
            f"[bold]목적:[/bold] {project_desc}\n"
            f"[bold]완료 기준:[/bold] {goal}\n"
            f"[bold]에이전트:[/bold] {', '.join(agents)}",
            title="확인",
        )
    )

    if not Confirm.ask("이대로 생성할까요?"):
        console.print("취소됨")
        return

    # 5. 생성
    project_dir = create_project(
        product, project_name, project_desc, agents, goal
    )

    # 6. GitHub 레포 생성 (선택)
    github_url = None
    if os.getenv("GITHUB_TOKEN"):
        if Confirm.ask("GitHub 레포를 생성할까요?"):
            github_url = create_github_repo(
                product, project_name, project_desc
            )

    # 7. 완료 메시지
    console.print(
        Panel.fit(
            f"[bold green]프로젝트 생성 완료![/bold green]\n\n"
            f"[bold]경로:[/bold] {project_dir}\n"
            + (f"[bold]GitHub:[/bold] {github_url}\n" if github_url else "")
            + f"\n[bold]시작하려면:[/bold]\n"
            f"[cyan]cd {project_dir}[/cyan]\n"
            f"[cyan]claude[/cyan]",
            title="완료",
        )
    )


if __name__ == "__main__":
    main()
