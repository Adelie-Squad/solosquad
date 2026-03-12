"""
src/bot.py
Discord Bot — 오너의 명령을 받아 적절한 에이전트를 라우팅하고 Claude Code로 실행
"""

import os
import json
import asyncio
from pathlib import Path
from datetime import datetime

import discord
from discord.ext import commands
from dotenv import load_dotenv

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN")
REPOS_BASE = Path(os.getenv("REPOS_BASE_PATH", "./repos"))
PRODUCTS_FILE = Path("core/products.json")
AGENTS_DIR = Path("agents")

CHANNEL_NAMES = [
    "daily-brief",
    "experiments",
    "weekly-review",
    "signals",
    "owner-command",
    "errors",
]

# ──────────────────────────────────────────────
# 에이전트 라우팅
# ──────────────────────────────────────────────

# 키워드 → 에이전트 매핑
AGENT_ROUTES = {
    # Strategy
    "pmf": ("strategy", "pmf-planner"),
    "시장 적합": ("strategy", "pmf-planner"),
    "가설": ("strategy", "pmf-planner"),
    "기능 기획": ("strategy", "feature-planner"),
    "기능 추가": ("strategy", "feature-planner"),
    "스펙": ("strategy", "feature-planner"),
    "정책": ("strategy", "policy-architect"),
    "약관": ("strategy", "policy-architect"),
    "데이터 분석": ("strategy", "data-analyst"),
    "지표": ("strategy", "data-analyst"),
    "매출": ("strategy", "data-analyst"),
    "사업 전략": ("strategy", "business-strategist"),
    "수익 모델": ("strategy", "business-strategist"),
    "비즈니스": ("strategy", "business-strategist"),
    "아이디어": ("strategy", "idea-refiner"),
    "브레인스토밍": ("strategy", "idea-refiner"),
    "일정": ("strategy", "scope-estimator"),
    "견적": ("strategy", "scope-estimator"),
    "스코프": ("strategy", "scope-estimator"),
    # Growth
    "마케팅": ("growth", "gtm-strategist"),
    "gtm": ("growth", "gtm-strategist"),
    "런칭": ("growth", "gtm-strategist"),
    "카피": ("growth", "content-writer"),
    "블로그": ("growth", "content-writer"),
    "글쓰기": ("growth", "content-writer"),
    "콘텐츠": ("growth", "content-writer"),
    "브랜드": ("growth", "brand-marketer"),
    "브랜딩": ("growth", "brand-marketer"),
    "네이밍": ("growth", "brand-marketer"),
    "광고": ("growth", "paid-marketer"),
    "퍼포먼스": ("growth", "paid-marketer"),
    "cpa": ("growth", "paid-marketer"),
    # Experience
    "유저 리서치": ("experience", "user-researcher"),
    "인터뷰": ("experience", "user-researcher"),
    "설문": ("experience", "user-researcher"),
    "페르소나": ("experience", "user-researcher"),
    "시장 조사": ("experience", "desk-researcher"),
    "경쟁사": ("experience", "desk-researcher"),
    "벤치마크": ("experience", "desk-researcher"),
    "ux": ("experience", "ux-designer"),
    "와이어프레임": ("experience", "ux-designer"),
    "사용성": ("experience", "ux-designer"),
    "플로우": ("experience", "ux-designer"),
    "ui": ("experience", "ui-designer"),
    "디자인 시스템": ("experience", "ui-designer"),
    "목업": ("experience", "ui-designer"),
    # Engineering
    "프론트": ("engineering", "creative-frontend"),
    "프론트엔드": ("engineering", "creative-frontend"),
    "랜딩": ("engineering", "creative-frontend"),
    "프로토타입": ("engineering", "fde"),
    "mvp": ("engineering", "fde"),
    "빠르게 만들": ("engineering", "fde"),
    "아키텍처": ("engineering", "architect"),
    "설계": ("engineering", "architect"),
    "시스템 구조": ("engineering", "architect"),
    "백엔드": ("engineering", "backend-developer"),
    "서버": ("engineering", "backend-developer"),
    "db": ("engineering", "backend-developer"),
    "api": ("engineering", "api-developer"),
    "엔드포인트": ("engineering", "api-developer"),
    "크롤링": ("engineering", "data-collector"),
    "수집": ("engineering", "data-collector"),
    "스크래핑": ("engineering", "data-collector"),
    "파이프라인": ("engineering", "data-engineer"),
    "etl": ("engineering", "data-engineer"),
    "배포": ("engineering", "cloud-admin"),
    "인프라": ("engineering", "cloud-admin"),
    "도커": ("engineering", "cloud-admin"),
    "ci/cd": ("engineering", "cloud-admin"),
}


def find_agent(user_input: str) -> tuple[str, str] | None:
    """사용자 입력에서 가장 적합한 에이전트를 찾는다"""
    lower = user_input.lower()
    for keyword, (team, agent) in AGENT_ROUTES.items():
        if keyword in lower:
            return team, agent
    return None


def load_agent_skill(team: str, agent: str) -> str:
    """에이전트 SKILL.md 로드"""
    skill_file = AGENTS_DIR / team / agent / "SKILL.md"
    if skill_file.exists():
        return skill_file.read_text()
    return ""


# ──────────────────────────────────────────────
# Bot 초기화
# ──────────────────────────────────────────────

intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True

bot = commands.Bot(command_prefix="!", intents=intents)


def load_products() -> list[dict]:
    if PRODUCTS_FILE.exists():
        return json.loads(PRODUCTS_FILE.read_text())
    return []


def get_product_by_guild(guild_id: int) -> dict | None:
    """guild_id로 제품 찾기"""
    products = load_products()
    for p in products:
        config_file = REPOS_BASE / p["slug"] / "discord" / "config.yaml"
        if config_file.exists():
            import yaml

            config = yaml.safe_load(config_file.read_text())
            if config.get("guild_id") == guild_id:
                return p
    return None


# ──────────────────────────────────────────────
# 이벤트 핸들러
# ──────────────────────────────────────────────


@bot.event
async def on_ready():
    print(f"[Bot] 로그인: {bot.user}")

    # 각 서버에 채널 자동 생성
    for guild in bot.guilds:
        await ensure_channels(guild)

    # 서버 ↔ 제품 매핑 갱신
    await sync_guild_product_mapping()

    print(f"[Bot] 준비 완료. {len(bot.guilds)}개 서버 연결됨")


@bot.event
async def on_guild_join(guild: discord.Guild):
    """봇이 새 서버에 초대될 때 채널 자동 생성"""
    await ensure_channels(guild)
    await sync_guild_product_mapping()


@bot.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return

    # #owner-command 채널에서만 명령 수신
    if message.channel.name != "owner-command":
        return

    product = get_product_by_guild(message.guild.id)
    if not product:
        await message.channel.send(
            "이 서버에 연결된 제품이 없습니다. `setup.py`를 다시 실행하세요."
        )
        return

    await handle_command(message, product)
    await bot.process_commands(message)


# ──────────────────────────────────────────────
# 채널 자동 생성
# ──────────────────────────────────────────────


async def ensure_channels(guild: discord.Guild):
    """필요한 채널이 없으면 자동 생성"""
    existing = {ch.name for ch in guild.channels}

    # 카테고리 생성
    category = discord.utils.get(guild.categories, name="AI 팀 보고")
    if not category:
        category = await guild.create_category("AI 팀 보고")

    created = []
    for ch_name in CHANNEL_NAMES:
        if ch_name not in existing:
            await guild.create_text_channel(ch_name, category=category)
            created.append(ch_name)

    if created:
        print(f"[Bot] {guild.name}: 채널 생성됨 → {', '.join(created)}")


async def sync_guild_product_mapping():
    """서버 이름으로 제품 매핑하고 config.yaml에 guild_id 저장"""
    import yaml

    products = load_products()

    for guild in bot.guilds:
        for product in products:
            # 서버 이름이 제품명을 포함하면 매핑
            if (
                product["name"] in guild.name
                or product["slug"] in guild.name.lower()
            ):
                config_file = (
                    REPOS_BASE / product["slug"] / "discord" / "config.yaml"
                )
                if config_file.exists():
                    config = yaml.safe_load(config_file.read_text())
                    if config.get("guild_id") != guild.id:
                        config["guild_id"] = guild.id
                        # 채널 ID도 저장
                        for ch in guild.channels:
                            if ch.name in CHANNEL_NAMES:
                                key = ch.name.replace("-", "_")
                                config["channels"][key] = ch.id
                        config_file.write_text(
                            yaml.dump(config, allow_unicode=True)
                        )
                        print(
                            f"[Bot] 매핑: {guild.name} ↔ {product['name']}"
                        )


# ──────────────────────────────────────────────
# 명령 처리 + 에이전트 라우팅
# ──────────────────────────────────────────────


async def handle_command(message: discord.Message, product: dict):
    """#owner-command 채널 메시지를 적절한 에이전트로 라우팅"""

    user_input = message.content.strip()
    product_dir = REPOS_BASE / product["slug"]

    # 에이전트 라우팅
    route = find_agent(user_input)
    skill_context = ""
    agent_label = ""

    if route:
        team, agent = route
        skill = load_agent_skill(team, agent)
        if skill:
            skill_context = (
                f"\n\n--- 에이전트 스킬 ---\n{skill}\n--- 스킬 끝 ---\n\n"
            )
            agent_label = f" ({agent})"
            print(f"[Bot] 라우팅: {user_input[:50]}... → {team}/{agent}")

    # 프롬프트 조립
    prompt = f"{skill_context}{user_input}" if skill_context else user_input

    # 타이핑 표시
    async with message.channel.typing():
        result = await run_claude(prompt, product_dir)

    if result:
        # 2000자 초과 시 분할
        chunks = [result[i : i + 1900] for i in range(0, len(result), 1900)]
        for i, chunk in enumerate(chunks):
            prefix = (
                f"**[{product['name']}{agent_label}]**\n" if i == 0 else ""
            )
            await message.reply(f"{prefix}```\n{chunk}\n```")
    else:
        await message.reply("응답을 생성하지 못했습니다.")


async def run_claude(prompt: str, cwd: Path) -> str:
    """Claude Code를 --print 모드로 실행"""
    try:
        proc = await asyncio.create_subprocess_exec(
            "claude",
            "--print",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(cwd),
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=prompt.encode()),
            timeout=120,
        )
        return stdout.decode().strip()
    except asyncio.TimeoutError:
        return "응답 시간 초과 (2분). 더 간단한 요청으로 나눠서 시도하세요."
    except FileNotFoundError:
        return "Claude Code가 설치되지 않았습니다. claude 명령을 확인하세요."
    except Exception as e:
        return f"오류: {str(e)}"


# ──────────────────────────────────────────────
# Discord 보고 유틸 (스케줄러에서 import해서 사용)
# ──────────────────────────────────────────────


async def send_to_channel(
    guild_id: int, channel_name: str, message: str, title: str = None
):
    """특정 서버의 채널에 메시지 전송"""
    guild = bot.get_guild(guild_id)
    if not guild:
        print(f"[Bot] 서버 {guild_id} 를 찾을 수 없음")
        return

    channel = discord.utils.get(guild.channels, name=channel_name)
    if not channel:
        print(f"[Bot] #{channel_name} 채널 없음")
        return

    if title:
        content = f"**{title}**\n{message}"
    else:
        content = message

    # 2000자 제한 처리
    for chunk in [content[i : i + 1900] for i in range(0, len(content), 1900)]:
        await channel.send(chunk)


# ──────────────────────────────────────────────
# 실행
# ──────────────────────────────────────────────

if __name__ == "__main__":
    if not TOKEN:
        print("DISCORD_TOKEN이 설정되지 않았습니다. .env 파일을 확인하세요.")
        exit(1)

    bot.run(TOKEN)
