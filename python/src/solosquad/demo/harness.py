"""The `scripted` harness of the demo (PRD §3.6.4 ②) — every agent answers from a script; no
model, no process, no network. It widens the fixed-output idea of `harness/fake.py`.

Two kinds of activation reach it:

- a **scenario step** — the workflow's agent prompt carries `#demo:<key>`; the reply is that
  key's text (`STEP_REPLIES`), streamed over `step_seconds` so the office shows the agent at
  work for those seconds;
- a **request to 임원 (Chief)** — the visitor's newest message is matched to an intent by
  keywords (`INTENTS`, in ko · en · zh-CN). A business intent names its scenario: the web API
  starts that workflow (`run_for_prompt` in app.py) and Chief says so, then hands the turn to
  the agent who owns it (a `transfer_to_<agent>` call, as a real Chief would), who answers
  its part. Nothing matched → `FALLBACK` (the PRD's fixed answer).

Every line is in the copy's language — the visitor's screen language, kept in the org when it
was seeded (`i18n.py`); `DemoHarness.speaking` gives each copy its own voice.

Every activation costs 0 and is recorded in the ledger as harness `scripted`.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass, field

from solosquad.demo.i18n import LOCALES, L, Lang, known, pick
from solosquad.harness.base import AuthStatus, BaseHarness, Capabilities, SpawnRequest
from solosquad.harness.events import End, LlmStreamEvent, Start, TextDelta, ToolUse, Usage

NAME = "scripted"
STEP_TAG = re.compile(r"#demo:([a-z0-9_.\-]+)")
AGENT = re.compile(r"You are ([a-z0-9\-]+) in ")
USER_BLOCK = re.compile(r"^\[user\] ", re.MULTILINE)
JOB_FOR = re.compile(r"\[workflow job for ([a-z0-9\-]+)\]")
HANDING: dict[str, dict[Lang, str]] = {
    "finance": L(
        "재무 관리 단계를 담당에게 넘길게요.",
        "I'm handing this Monthly finance step to its agent.",
        "把「财务管理」这一步交给对应的代理。",
    ),
    "sourcing": L(
        "상품 소싱 단계를 담당에게 넘길게요.",
        "I'm handing this Product sourcing step to its agent.",
        "把「商品采购」这一步交给对应的代理。",
    ),
    "sns": L(
        "SNS 마케팅 단계를 담당에게 넘길게요.",
        "I'm handing this Social media marketing step to its agent.",
        "把「社媒营销」这一步交给对应的代理。",
    ),
}
HANGUL = re.compile(r"[가-힣]")
HAN = re.compile(r"[一-鿿]")

STEP_DONE = L("작업을 마쳤어요.", "Done.", "已完成。")
"""A step key the script does not know."""

STEP_REPLIES: dict[str, dict[Lang, str]] = {
    "finance.read": L(
        "10월 은행 거래 내역 17건과 마켓 정산 8건을 읽었어요. 자사몰 PG 정산 1건은 금액이 "
        "아직 비어 있어요.",
        "I read 17 bank transactions and 8 market settlements for October. One card settlement "
        "from our online store has no amount yet.",
        "已读取10月银行流水17笔和平台结算8笔。自营商城有1笔支付结算的金额还是空的。",
    ),
    "finance.classify": L(
        "거래를 매출 · 상품 매입 · 물류 · 관세 · 수수료 · 인건비로 나눴어요. 해외 송금 수수료 "
        "1건이 평소의 40배라 '확인 필요'로 표시해 둘게요.",
        "I sorted the transactions into sales · purchases · logistics · duties · fees · payroll. "
        "One overseas transfer fee is 40 times the usual, so I'm marking it 'Needs review'.",
        "已把交易分为销售 · 商品采购 · 物流 · 关税 · 手续费 · 人工。有1笔境外汇款手续费是平时的"
        "40倍，标为「需确认」。",
    ),
    "finance.compare": L(
        "지난달과 비교하면 매출은 9% 늘었고, 상품 매입이 텀블러 선주문 때문에 크게 늘었어요. "
        "표시한 2건만 확인해 주시면 손익표를 확정할 수 있어요.",
        "Compared with last month, sales are up 9% and purchases rose sharply because of the "
        "tumbler pre-order. Review the 2 marked rows and the P&L can be finalized.",
        "与上月相比，销售增长9%，商品采购因保温杯预订大幅增加。确认标记的2笔后即可定稿损益表。",
    ),
    "finance.paid": L(
        "지급을 처리했어요(데모 — 실제로 보내지 않았어요). 11월 4일 오전 10시에 3건이 "
        "(예시) 기업은행 ***-1234 에서 나가는 것으로 기록했어요.",
        "Payment processed (demo — nothing was actually sent). 3 payments are recorded to leave "
        "(example) IBK ***-1234 at 10 a.m. on November 4.",
        "已处理付款（演示 — 实际未汇出）。已记录3笔款项于11月4日上午10点从（示例）企业银行 "
        "***-1234 付出。",
    ),
    "finance.hold": L(
        "알겠어요, 다시 정리할게요. 이번 주 지급은 멈추고 거래처 3곳에 보낼 '다음 주 화요일 "
        "지급 예정' 안내 초안만 만들어 뒀어요(데모 — 보내지 않아요).",
        "Understood, I'll rework it. This week's payments are on hold; I've only drafted a note "
        "to the 3 vendors saying payment is planned for next Tuesday (demo — not sent).",
        "好的，我重新整理。本周付款暂停，只起草了一份发给3家供应商的「下周二付款」通知"
        "（演示 — 不会发送）。",
    ),
    "sourcing.quotes": L(
        "보온 텀블러(500ml) 공급처 3곳 — 이우 · 닝보 · 광저우 — 의 견적과 최소 주문량을 모았어요.",
        "I collected quotes and minimum order quantities from 3 insulated tumbler (500ml) "
        "suppliers — Yiwu · Ningbo · Guangzhou.",
        "已收集保温杯（500ml）3家供应商 — 义乌 · 宁波 · 广州 — 的报价和最小起订量。",
    ),
    "sourcing.analyze": L(
        "단가에 개당 배송비와 관세 8%를 더해 원가를 비교했어요. 단가는 닝보가 가장 낮지만 "
        "최소 주문 2,000개와 긴 납기 때문에 총점은 이우가 앞서요.",
        "I compared landed cost: unit price plus shipping per unit and 8% duty. Ningbo has the "
        "lowest unit price, but with a 2,000-unit minimum order and a long lead time, Yiwu "
        "scores higher overall.",
        "已在单价上加上每件运费和8%关税比较到岸成本。宁波单价最低，但起订量2,000件且交期长，"
        "综合得分义乌领先。",
    ),
    "sourcing.margin": L(
        "판매가 19,900원 기준 예상 마진은 이우 약 48% · 닝보 약 50% · 광저우 약 45%예요. "
        "재고 부담까지 보면 이우가 안전해요.",
        "At a retail price of ₩19,900, expected margins are about 48% for Yiwu · 50% for Ningbo "
        "· 45% for Guangzhou. Counting the inventory risk, Yiwu is the safe choice.",
        "按售价19,900韩元计算，预计毛利率义乌约48% · 宁波约50% · 广州约45%。考虑库存压力，"
        "义乌更稳妥。",
    ),
    "sourcing.draft": L(
        "추천 공급처 언어(중국어)로 발주서 초안을 썼어요 — 품목 4개 · 각인 · 개별 포장 조건을 "
        "넣었어요.",
        "I drafted the purchase order in the recommended supplier's language (Chinese) — 4 "
        "items, with engraving and individual packaging terms.",
        "已用推荐供应商的语言（中文）起草采购订单 — 4个品项，写明刻字和单独包装条件。",
    ),
    "sourcing.sent": L(
        "발주를 확정했어요(데모 — 실제로 보내지 않았어요). 인천항 도착 예정은 11월 28일이고, "
        "입고 전날 샘플 확인 목록을 다시 올릴게요.",
        "Order confirmed (demo — nothing was actually sent). It is due at Incheon port on "
        "November 28; I'll post the sample checklist again the day before it arrives.",
        "已确认下单（演示 — 实际未发送）。预计11月28日到达仁川港，入库前一天我会再发一份样品"
        "检查清单。",
    ),
    "sourcing.renegotiate": L(
        "알겠어요, 다시 정리할게요. 발주는 멈추고 단가 3% 인하 또는 납기 5일 단축을 조건으로 "
        "다시 견적을 요청하는 메모를 남겼어요(데모 — 연락하지 않아요).",
        "Understood, I'll rework it. The order is on hold, and I left a note to ask for new "
        "quotes with a 3% lower unit price or a lead time 5 days shorter (demo — no one is "
        "contacted).",
        "好的，我重新整理。下单暂停，已留下备忘：以单价降低3%或交期缩短5天为条件重新询价"
        "（演示 — 不会联系对方）。",
    ),
    "sns.reactions": L(
        "지난주 게시물 3건 중 홈카페 레시피 릴스가 도달 15,400으로 가장 좋았어요. 저장이 많아 "
        "레시피형 콘텐츠를 늘리는 게 좋겠어요.",
        "Of last week's 3 posts, the home café recipe reel did best with a reach of 15,400. It "
        "was saved a lot, so more recipe-style content is a good idea.",
        "上周3条帖子中，居家咖啡食谱短视频触达15,400，效果最好。收藏很多，建议多做食谱类内容。",
    ),
    "sns.plan": L(
        "이번 주는 신상품 텀블러 공개를 중심으로 인스타그램 · 블로그 · 샤오홍슈에 5건을 "
        "올리는 일정을 짰어요.",
        "This week centres on launching the new tumbler: 5 posts across Instagram · the blog · "
        "Xiaohongshu.",
        "本周以新品保温杯发布为中心，在 Instagram · 博客 · 小红书安排了5条内容。",
    ),
    "sns.drafts": L(
        "게시 문구와 이미지 초안을 한국어 · 중국어로 썼어요. 브랜드 톤(따뜻하고 짧게)에 맞췄고 "
        "이미지마다 필요한 컷을 적어 뒀어요.",
        "I wrote the captions and image drafts in English · Chinese, in the brand's tone (warm "
        "and short), and noted the shots each image needs.",
        "已写好 Instagram · 小红书的中文文案和图片草稿，符合品牌语气（温暖简短），并注明每张图"
        "需要的镜头。",
    ),
    "sns.launched": L(
        "승인된 게시물과 광고를 예약했어요(데모 — 실제로 게시하거나 결제하지 않았어요). 광고 "
        "3일 차에 반응을 정리해서 보고할게요.",
        "The approved posts and ads are scheduled (demo — nothing was actually posted or paid). "
        "I'll report the reactions on day 3 of the ads.",
        "已排期获批的帖子和广告（演示 — 实际未发布也未付款）。广告第3天我会整理反馈并汇报。",
    ),
    "sns.organic": L(
        "알겠어요, 다시 정리할게요. 광고 없이 게시물만 예약하는 것으로 바꾸고, 해시태그와 "
        "게시 시간을 조정해 자연 도달을 늘려볼게요(데모 — 게시하지 않아요).",
        "Understood, I'll rework it. Only the posts are scheduled now, without ads; I'll adjust "
        "the hashtags and posting times to grow organic reach (demo — nothing is posted).",
        "好的，我重新整理。改为不投广告、只排期帖子，并调整话题标签和发布时间来提升自然触达"
        "（演示 — 不会发布）。",
    ),
}

FALLBACK: dict[Lang, str] = L(
    "데모에서는 예시 요청만 실행해요. 아래 추천 요청을 눌러 보세요.",
    "The demo runs the example requests only. Try one of the suggested requests below.",
    "演示中只运行示例请求。请点击下方的推荐请求试试。",
)

SUGGESTIONS_BY_LOCALE: dict[Lang, tuple[str, ...]] = {
    "ko": (
        "10월 손익 정리해줘",
        "이번 달 거래처 대금 지급안 만들어줘",
        "보온 텀블러 공급처 비교해줘",
        "중국어 발주서 초안 써줘",
        "이번 주 SNS 콘텐츠 짜줘",
        "중국어 게시물도 같이 만들어줘",
    ),
    "en": (
        "Sum up October's P&L",
        "Draft this month's vendor payments",
        "Compare insulated tumbler suppliers",
        "Write a purchase order draft in Chinese",
        "Plan this week's social media content",
        "Make Chinese posts too",
    ),
    "zh-CN": (
        "整理10月损益",
        "制定本月供应商付款方案",
        "比较保温杯供应商",
        "写中文采购订单草稿",
        "安排本周社媒内容",
        "也做中文帖子",
    ),
}
"""The suggested requests (2 per scenario, the same order in every language) — the web shows
the visitor's language; each runs its script."""

SUGGESTIONS: tuple[str, ...] = SUGGESTIONS_BY_LOCALE["ko"]


def suggestions(lang: str | None) -> tuple[str, ...]:
    return SUGGESTIONS_BY_LOCALE[known(lang)]


@dataclass(frozen=True)
class Intent:
    key: str
    words: tuple[str, ...]
    chief: dict[Lang, str]
    scenario: str | None = None
    """The workflow this request runs."""
    handoff: str | None = None
    answer: dict[Lang, str] = field(default_factory=dict)


INTENTS: tuple[Intent, ...] = (
    Intent(
        "finance",
        (
            "손익",
            "매출",
            "이익",
            "재무",
            "결산",
            "지급",
            "대금",
            "부가세",
            "정산",
            "p&l",
            "profit",
            "revenue",
            "payment",
            "finance",
            "利润",
            "收入",
            "付款",
            "财务",
            "损益",
        ),
        L(
            "재무 관리를 시작했어요 — 재무 담당이 은행 내역과 마켓 정산부터 읽을게요.",
            "Started Monthly finance — Finance reads the bank statement and the market settlement "
            "first.",
            "已开始「财务管理」— 财务先读取银行流水和平台结算。",
        ),
        "finance-monthly",
        "finance",
        L(
            "10월 손익표는 몇 초 뒤 과제에 올라와요. 표시한 거래 2건만 확인해 주시면 돼요 — "
            "손익표 확인은 팀 승인, 거래처 대금 지급은 대표 승인이에요.",
            "The October P&L lands in Tasks in a few seconds. Check the two flagged rows — the "
            "P&L review is a team approval, paying the vendors is the owner's.",
            "10月损益表几秒后出现在任务中。请确认两条标记的交易 — 损益表确认为团队审批，"
            "支付货款需代表审批。",
        ),
    ),
    Intent(
        "sourcing",
        (
            "소싱",
            "공급",
            "발주",
            "견적",
            "텀블러",
            "구매",
            "원가",
            "supplier",
            "sourcing",
            "order",
            "quote",
            "供应",
            "采购",
            "报价",
            "订单",
        ),
        L(
            "상품 소싱을 시작했어요 — 리서처가 공급처 견적부터 모을게요.",
            "Started Product sourcing — the Researcher collects the supplier quotes first.",
            "已开始「商品采购」— 研究员先收集供应商报价。",
        ),
        "product-sourcing",
        "researcher",
        L(
            "공급처 3곳의 원가 비교표(단가 + 배송비 + 관세)와 중국어 발주서 초안이 차례로 "
            "올라와요. 발주 확정은 대표 승인이에요.",
            "A landed-cost comparison of three suppliers and a Chinese purchase order draft "
            "follow. Confirming the order is the owner's approval.",
            "接下来会出现三家供应商的到岸成本对比和中文采购订单草稿。确认下单需代表审批。",
        ),
    ),
    Intent(
        "sns",
        (
            "sns",
            "인스타",
            "마케팅",
            "광고",
            "게시",
            "블로그",
            "콘텐츠",
            "홍보",
            "샤오홍슈",
            "instagram",
            "marketing",
            "post",
            "营销",
            "广告",
            "小红书",
            "内容",
            "social",
            "content",
            "社媒",
            "帖子",
        ),
        L(
            "SNS 마케팅을 시작했어요 — 데이터 분석가가 지난주 반응부터 정리할게요.",
            "Started Social media marketing — the Data Analyst sums up last week's reactions "
            "first.",
            "已开始「社媒营销」— 数据分析师先整理上周的反馈。",
        ),
        "sns-marketing",
        "marketer",
        L(
            "이번 주 콘텐츠 일정과 한국어 · 중국어 게시 초안이 올라와요. 게시는 브랜드 팀 승인, "
            "광고비 결제는 대표 승인이에요.",
            "This week's content plan and English · Chinese drafts follow. Publishing is the "
            "brand team's approval, paying for ads is the owner's.",
            "本周内容计划和 Instagram · 小红书的中文草稿随后出现。发布由品牌团队审批，广告费需代表"
            "审批。",
        ),
    ),
    Intent(
        "approvals",
        ("승인", "누가", "허락", "approve", "approval", "审批"),
        L(
            "승인은 두 단계예요. 손익표 확인 · 게시물 게시 같은 검토는 그 일을 낸 팀의 팀원이 "
            "하는 '팀 승인'이고, 지급 · 발주 · 광고비처럼 돈이 나가는 일은 대표만 하는 '대표 "
            "승인'이에요. 과제에서 기다리는 카드를 승인하거나 거절해 보세요.",
            "Two tiers: reviews such as the P&L check or publishing are a team approval; anything "
            "that spends money — paying, ordering, ads — is the owner's. Try a card in Tasks.",
            "审批分两级：损益表确认、发布等由团队审批；付款、下单、广告费等花钱的事需代表审批。"
            "去任务里试试审批或拒绝。",
        ),
    ),
    Intent(
        "hello",
        ("안녕", "반가", "누구", "소개", "hello", "hi", "who", "你好", "介绍"),
        L(
            "안녕하세요, 모아 리빙(예시)의 임원 에이전트예요. 재무 · 소싱 · SNS 일을 팀에 나눠 "
            "맡기고 결과를 보고드려요. 아래 추천 요청을 눌러 보세요.",
            "Hello — I'm Chief, the executive agent of Moa Living (an example). I hand finance, "
            "sourcing and social media work to the teams and report back. Try a suggested "
            "request below.",
            "您好，我是 Moa Living（示例）的高管代理。我把财务、采购和社媒工作分给各团队"
            "并汇报结果。请试试下方的推荐请求。",
        ),
    ),
)


def language_of(text: str) -> Lang:
    if HANGUL.search(text):
        return "ko"
    if HAN.search(text):
        return "zh-CN"
    return "en" if text.strip() else "ko"


def match_intent(text: str) -> Intent | None:
    low = text.lower()
    for intent in INTENTS:
        if any(w in low for w in intent.words):
            return intent
    return None


def suggestion_number(text: str) -> int | None:
    """1-based index of a suggested request typed (or clicked) exactly, else None."""
    clean = " ".join(text.split())
    for lang in LOCALES:
        for i, s in enumerate(SUGGESTIONS_BY_LOCALE[lang], start=1):
            if clean == s:
                return i
    return None


def last_user_text(prompt: str) -> str:
    """The visitor's newest message in a rendered transcript (`[user] …` blocks)."""
    starts = [m.end() for m in USER_BLOCK.finditer(prompt)]
    if not starts:
        return ""
    tail = prompt[starts[-1] :]
    return re.split(r"\n\n\[[^\]]+\] |\n\n---\n", tail, maxsplit=1)[0].strip()


def handed_over(prompt: str) -> bool:
    """Chief already passed this turn on (a transfer after the newest user message)."""
    starts = [m.end() for m in USER_BLOCK.finditer(prompt)]
    after = prompt[starts[-1] :] if starts else prompt
    return "(called transfer_to_" in after


@dataclass(frozen=True)
class Reply:
    text: str
    handoff: tuple[str, str] | None = None
    intent: str = "step"


def script(prompt: str, locale: str | None = None) -> Reply:
    """What an activation answers — the whole script, pure (tests call it directly).

    `locale` is the copy's language (the visitor's screen language): every line follows it.
    Without one (a bare call), a step answers in Korean and a chat in the language typed."""
    tag = STEP_TAG.search(prompt)
    m = AGENT.search(prompt)
    agent = m.group(1) if m else "chief"
    if tag is not None:
        # a workflow job reaches the company through Chief, who hands it to the agent the
        # step names — so the office shows that agent at work, as in a real company
        owner = JOB_FOR.search(prompt)
        area = tag.group(1).split(".")[0]
        if agent == "chief" and owner and owner.group(1) != "chief" and not handed_over(prompt):
            return Reply(pick(HANDING.get(area, STEP_DONE), locale),
                         (owner.group(1), tag.group(0)), "handoff")  # fmt: skip
        text = pick(STEP_REPLIES.get(tag.group(1), STEP_DONE), locale)
        return Reply(text, intent=f"step:{tag.group(1)}")
    said = last_user_text(prompt)
    lang = known(locale) if locale else language_of(said)
    intent = match_intent(said)
    if agent != "chief":
        if intent is not None and intent.answer:
            return Reply(pick(intent.answer, lang), intent=intent.key)
        return Reply(FALLBACK[lang], intent="fallback")
    if intent is None:
        return Reply(FALLBACK[lang], intent="fallback")
    if intent.handoff and not handed_over(prompt):
        return Reply(pick(intent.chief, lang), (intent.handoff, said or intent.key), intent.key)
    return Reply(pick(intent.chief, lang), intent=intent.key)


def _chunks(text: str, n: int) -> Sequence[str]:
    words = re.split(r"(\s+)", text)
    if n <= 1 or len(words) <= 1:
        return [text]
    size = max(1, len(words) // n)
    return ["".join(words[i : i + size]) for i in range(0, len(words), size)]


class DemoHarness(BaseHarness):
    """No model, no process, no network — see the module docstring."""

    name = NAME
    capabilities = Capabilities(
        max_context_tokens=200_000, supports_mcp=True, supports_tools=False, guard="none"
    )

    def __init__(self, *, step_seconds: float = 4.0, chat_seconds: float = 1.5) -> None:
        self.step_seconds = step_seconds
        self.chat_seconds = chat_seconds
        self.calls = 0

    def speaking(self, locale: Callable[[], str | None]) -> _Voice:
        """This harness for one copy: the same pace and count, the lines in `locale()` (read
        per activation — a reset may have seeded the copy in another language)."""
        return _Voice(self, locale)

    async def spawn(
        self, request: SpawnRequest, locale: str | None = None
    ) -> AsyncIterator[LlmStreamEvent]:
        self.calls += 1
        reply = script(request.prompt, locale)
        total = self.step_seconds if reply.intent.startswith("step") else self.chat_seconds
        parts = _chunks(reply.text, 8)
        yield Start(model="scripted")
        for part in parts:
            if total:
                await asyncio.sleep(total / len(parts))
            yield TextDelta(part)
        if reply.handoff is not None:
            target, task = reply.handoff
            yield ToolUse(f"demo-{self.calls}", f"transfer_to_{target}", {"task": task})
        yield End("end_turn", Usage(0, 0), 0.0)

    async def auth_status(self) -> AuthStatus:
        return AuthStatus(True, {"scripted": True})


class _Voice(BaseHarness):
    """`DemoHarness.speaking` — one copy's language over the shared scripted harness."""

    name = NAME
    capabilities = DemoHarness.capabilities

    def __init__(self, base: DemoHarness, locale: Callable[[], str | None]) -> None:
        self.base = base
        self.locale = locale

    async def spawn(self, request: SpawnRequest) -> AsyncIterator[LlmStreamEvent]:
        async for event in self.base.spawn(request, self.locale()):
            yield event

    async def auth_status(self) -> AuthStatus:
        return await self.base.auth_status()
