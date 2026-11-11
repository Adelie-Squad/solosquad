"""The demo's scripted scenarios — three workflows on a timeline (PRD §3.5.2 ④ · §3.6.4 ②),
stopping where a person must say yes (decision 51 tiers).

    재무 관리 (finance-monthly · team business)
      read · classify (finance) → pnl [손익표] → compare (data-analyst)
      → ◆ 10월 손익표 확인 (review · 팀 승인) → payables [지급안]
      → ◆ 거래처 대금 지급 (payment · 대표 승인)
           ├ 승인 → paid (finance) [지급 처리 결과]
           └ 거절 → hold (finance) "다시 정리할게요" [지급 보류 메모]
    상품 소싱 (product-sourcing · team business)
      quotes (researcher) → compare [원가 비교표 — 단가 + 배송비 + 관세] → analyze
      (data-analyst) → margin (finance) → ◆ 공급처 비교표 확인 (review · 팀 승인)
      → draft (sales) → po [중국어 발주서 초안] → ◆ 발주 확정 (purchase · 대표 승인)
           ├ 승인 → sent [발주 처리 결과]      └ 거절 → renegotiate [재협상 메모]
    SNS 마케팅 (sns-marketing · team brand)
      reactions (data-analyst) → calendar [한 주 일정 + 지난주 반응] → plan (marketer)
      → write (creative) → posts [한국어 · 중국어 초안] → ◆ 게시물 게시 (publish · 팀 승인)
      → ads [광고 집행안] → ◆ 광고비 결제 (payment · 대표 승인)
           ├ 승인 → launched [게시 · 광고 예약 결과]  └ 거절 → organic [광고 없이 게시]

An agent step takes `step_seconds` (the scripted harness streams over it, so the office shows
the agent at work); a tool step takes half. With the default 4 s the first approval of each
scenario comes after ≤ 15 s (PRD: ≤ 60 s). The tools only read the copy's sample files
(`files/`) and return data — nothing is paid, ordered, posted or sent.
"""

from __future__ import annotations

import csv
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from solosquad.demo.i18n import L, Lang, pick
from solosquad.workflows.engine import WorkflowEngine
from solosquad.workflows.tools import TOOLS, finance_pnl

SCENARIOS = ("finance-monthly", "product-sourcing", "sns-marketing")
"""The scenario workflows, in the order they start."""


class Pace:
    """Seconds per tool step — one server is one demo instance, so this is process-wide."""

    tool_seconds: float = 2.0


def set_pace(step_seconds: float) -> None:
    Pace.tool_seconds = max(0.0, step_seconds / 2)


def _wait() -> None:
    if Pace.tool_seconds:
        time.sleep(Pace.tool_seconds)


HEADERS: dict[str, str] = {
    # the sample files of an English or Chinese copy (template/locales/) → the Korean columns
    # the tools read — so a builder can keep either
    "Vendor": "거래처", "Tax invoice": "세금계산서", "Description": "내역", "Due": "지급일",
    "Amount": "금액", "收款单位": "거래처", "税务发票": "세금계산서", "明细": "내역",
    "付款日": "지급일", "金额": "금액",
    "Supplier": "공급처", "Region": "지역", "Unit price (CNY)": "단가(위안)", "FX rate": "환율",
    "Shipping per unit": "배송비(개당)", "Duty rate": "관세율", "MOQ": "최소주문",
    "Lead days": "납기일", "Defect rate": "불량률", "Note": "비고",
    "供应商": "공급처", "地区": "지역", "单价(元)": "단가(위안)", "汇率": "환율",
    "每件运费": "배송비(개당)", "关税率": "관세율", "最小起订量": "최소주문", "交期(天)": "납기일",
    "不良率": "불량률", "备注": "비고",
    "SKU": "품번", "Item": "품명", "Chinese name": "중문 품명", "Qty": "수량",
    "货号": "품번", "品名": "품명", "中文品名": "중문 품명", "数量": "수량",
    "Date": "날짜", "Channel": "채널", "Language": "언어", "Theme": "주제", "Format": "형식",
    "Agent": "담당", "日期": "날짜", "渠道": "채널", "语言": "언어", "主题": "주제",
    "形式": "형식", "代理": "담당",
    "Post": "게시물", "Reach": "도달", "Likes": "좋아요", "Comments": "댓글", "Saves": "저장",
    "帖子": "게시물", "触达": "도달", "点赞": "좋아요", "评论": "댓글", "收藏": "저장",
    "Caption": "문구", "Hashtags": "해시태그", "Image": "이미지",
    "文案": "문구", "话题标签": "해시태그", "图片": "이미지",
}  # fmt: skip
"""The column names of an English or Chinese copy's sample files (`template/locales/`) → the
Korean ones the tools read."""


def _rows(file: str) -> list[dict[str, str]]:
    with Path(file).open(encoding="utf-8", newline="") as f:
        return [
            {HEADERS.get(k.strip(), k.strip()): (v or "").strip() for k, v in r.items()}
            for r in csv.DictReader(f)
        ]


def _won(n: float) -> str:
    return f"₩{n:,.0f}"


REVIEW_REASONS: dict[str, dict[Lang, str]] = {
    r["ko"]: r
    for r in (
        L("수입과 지출이 함께 적힘", "Money in and money out on one row", "收入和支出写在同一行"),
        L("금액을 읽을 수 없음", "The amount can't be read", "无法读取金额"),
        L("구분을 알 수 없음", "Unknown type", "类型不明"),
        L("계정이 비어 있음", "The account is empty", "科目为空"),
        L("날짜를 읽을 수 없음", "The date can't be read", "无法读取日期"),
    )
}
"""`finance.pnl`'s rows to check, in the copy's language."""

TEXT: dict[str, dict[Lang, str]] = {
    "pnl.summary": L(
        "기간 {period} · 매출 {revenue} · 비용 {expenses} · 순이익 {net} {currency}",
        "Period {period} · sales {revenue} · expenses {expenses} · net income {net} {currency}",
        "期间 {period} · 销售 {revenue} · 费用 {expenses} · 净利润 {net} {currency}",
    ),
    "pnl.review": L(" · 확인 필요 {n}행", " · {n} rows need review", " · {n}行需确认"),
    "pnl.unknown": L("미상", "unknown", "未知"),
    "payables.account": L(
        "(예시) 기업은행 ***-1234", "(example) IBK ***-1234", "（示例）企业银行 ***-1234"
    ),
    "payables.summary": L(
        "거래처 {n}곳 · 합계 {total} · 지급 예정 11월 4일",
        "{n} vendors · total {total} · to be paid on November 4",
        "供应商{n}家 · 合计 {total} · 预计11月4日付款",
    ),
    "compare.product": L(
        "보온 텀블러 500ml (겨울 시즌)",
        "Insulated tumbler 500ml (winter season)",
        "保温杯 500ml（冬季）",
    ),
    "compare.summary": L(
        "공급처 {n}곳 원가 비교 — 추천 {best}",
        "Landed cost of {n} suppliers — recommended: {best}",
        "{n}家供应商成本对比 — 推荐 {best}",
    ),
    "po.number": L("PO-2026-1107 (예시)", "PO-2026-1107 (example)", "PO-2026-1107（示例）"),
    "po.total": L("¥{cny} (약 {krw})", "¥{cny} (about {krw})", "¥{cny}（约 {krw}）"),
    "po.delivery": L(
        "2026-11-28 · 인천항 → 경기 광주 물류센터",
        "2026-11-28 · Incheon port → the Gwangju (Gyeonggi) warehouse",
        "2026-11-28 · 仁川港 → 京畿道广州物流中心",
    ),
    "po.summary": L(
        "{supplier} · {n}개 품목 · ¥{cny}",
        "{supplier} · {n} items · ¥{cny}",
        "{supplier} · {n}个品项 · ¥{cny}",
    ),
    "calendar.summary": L(
        "이번 주 {n}건 · 지난주 최고 반응 '{best}'",
        "{n} posts this week · last week's best: '{best}'",
        "本周{n}条 · 上周反馈最好：「{best}」",
    ),
    "posts.summary": L(
        "게시 초안 {n}건 ({langs})", "{n} post drafts ({langs})", "帖子草稿{n}条（{langs}）"
    ),
    "ads.channel": L("인스타그램", "Instagram", "Instagram"),
    "ads.audience": L(
        "서울 · 경기 · 25~44세 · 관심사 캠핑 · 홈카페",
        "Seoul · Gyeonggi · ages 25–44 · interests: camping · home café",
        "首尔 · 京畿 · 25~44岁 · 兴趣：露营 · 居家咖啡",
    ),
    "ads.reach": L("40,000 ~ 60,000명", "40,000–60,000 people", "40,000 ~ 60,000人"),
    "ads.creative": L(
        "신상품 텀블러 릴스 · 홈카페 캐러셀",
        "New tumbler reel · home café carousel",
        "新品保温杯短视频 · 居家咖啡轮播图",
    ),
    "ads.summary": L(
        "인스타그램 5일 · {budget} · 예상 도달 4만~6만 명",
        "Instagram for 5 days · {budget} · expected reach 40,000–60,000",
        "Instagram 5天 · {budget} · 预计触达4万~6万人",
    ),
}
"""Every line a tool writes into a work product, by language (`lang` — the copy's, given in
the workflow's `with:`; the Korean template gives none)."""


def _t(key: str, lang: str, **values: Any) -> str:
    return pick(TEXT[key], lang).format(**values)


def demo_pnl(bank: str, market: str, currency: str = "KRW", lang: str = "ko") -> dict[str, Any]:
    """The bank statement and the market settlement read as one ledger → `finance.pnl` (the
    real deterministic tool; its rows to check are the copy's flagged transactions)."""
    _wait()
    with tempfile.TemporaryDirectory() as tmp:
        merged = Path(tmp) / "ledger.csv"
        head, *rest = Path(bank).read_text(encoding="utf-8").splitlines()
        more = Path(market).read_text(encoding="utf-8").splitlines()[1:]
        merged.write_text("\n".join([head, *rest, *more]) + "\n", encoding="utf-8")
        out = finance_pnl(str(merged), currency)
    review = out["needs_review"]
    for row in review:
        row["reason"] = pick(REVIEW_REASONS.get(row["reason"], {"ko": row["reason"]}), lang)
    out["summary"] = _t(
        "pnl.summary", lang, period=out["period"] or _t("pnl.unknown", lang),
        revenue=f"{out['revenue']:,.0f}", expenses=f"{out['expenses']:,.0f}",
        net=f"{out['net_income']:,.0f}", currency=currency,
    ) + (_t("pnl.review", lang, n=len(review)) if review else "")  # fmt: skip
    return out


def demo_payables(file: str, lang: str = "ko") -> dict[str, Any]:
    _wait()
    items: list[dict[str, Any]] = [
        {"vendor": r["거래처"], "invoice": r["세금계산서"], "item": r["내역"], "due": r["지급일"],
         "amount": float(r["금액"])}
        for r in _rows(file)
    ]  # fmt: skip
    total = sum(float(i["amount"]) for i in items)
    return {
        "items": items,
        "total": total,
        "total_text": _won(total),
        "account": _t("payables.account", lang),
        "pay_on": items[0]["due"] if items else "",
        "summary": _t("payables.summary", lang, n=len(items), total=_won(total)),
    }


def demo_supplier_compare(file: str, lang: str = "ko") -> dict[str, Any]:
    """Landed cost per unit = unit price (CNY → KRW) + shipping + duty."""
    _wait()
    rows: list[dict[str, Any]] = []
    for r in _rows(file):
        cny, rate = float(r["단가(위안)"]), float(r["환율"])
        ship, duty = float(r["배송비(개당)"]), float(r["관세율"])
        base = cny * rate
        landed = round(base + ship + base * duty / 100)
        lead, defect = int(r["납기일"]), float(r["불량률"])
        # lower is better on every axis — the sourcing team's rule of thumb, shown as is
        score = round(100 - (landed - 9000) / 60 - lead * 1.2 - defect * 8, 1)
        rows.append(
            {"supplier": r["공급처"], "region": r["지역"], "unit_price_cny": cny,
             "shipping": ship, "duty_rate": duty, "landed_krw": landed,
             "moq": int(r["최소주문"]), "lead_days": lead, "defect_rate": defect,
             "note": r["비고"], "score": score, "recommended": False}
        )  # fmt: skip
    rows.sort(key=lambda x: -float(x["score"]))
    if rows:
        rows[0]["recommended"] = True
    best = rows[0]["supplier"] if rows else None
    return {
        "product": _t("compare.product", lang),
        "retail_price": 19900,
        "suppliers": rows,
        "recommended": best,
        "summary": _t("compare.summary", lang, n=len(rows), best=best or "-"),
    }


def demo_purchase_order(file: str, supplier: str, lang: str = "ko") -> dict[str, Any]:
    """A draft in the supplier's language (중국어) — nothing is sent. The order itself stays
    Chinese in every copy; the lines around it follow the copy's language."""
    _wait()
    lines: list[dict[str, Any]] = []
    for r in _rows(file):
        qty, price = int(r["수량"]), float(r["단가(위안)"])
        lines.append(
            {"sku": r["품번"], "name": r["품명"], "name_local": r["중문 품명"], "qty": qty,
             "unit_price": price, "amount": qty * price}
        )  # fmt: skip
    subtotal = sum(float(x["amount"]) for x in lines)
    krw = round(subtotal * 190)
    cny = f"{subtotal:,.0f}"
    return {
        "supplier": supplier,
        "language": "zh-CN",
        "title_local": "采购订单（草稿）",
        "po_number": _t("po.number", lang),
        "currency": "CNY",
        "lines": lines,
        "subtotal": subtotal,
        "total": subtotal,
        "total_text": _t("po.total", lang, cny=cny, krw=_won(krw)),
        "delivery": _t("po.delivery", lang),
        "terms_local": "到港后30天内付款 · 每个产品单独包装 · 杯身激光刻字「MOA」",
        "summary": _t("po.summary", lang, supplier=supplier, n=len(lines), cny=cny),
    }


def demo_sns_calendar(week: str, last_week: str, lang: str = "ko") -> dict[str, Any]:
    _wait()
    entries = [
        {"date": r["날짜"], "channel": r["채널"], "language": r["언어"], "theme": r["주제"],
         "format": r["형식"], "owner": r["담당"]}
        for r in _rows(week)
    ]  # fmt: skip
    reactions: list[dict[str, Any]] = [
        {"post": r["게시물"], "channel": r["채널"], "reach": int(r["도달"]),
         "likes": int(r["좋아요"]), "comments": int(r["댓글"]), "saves": int(r["저장"])}
        for r in _rows(last_week)
    ]  # fmt: skip
    best = max(reactions, key=lambda x: int(x["reach"])) if reactions else None
    return {
        "week": "2026-11-10 ~ 11-16",
        "entries": entries,
        "last_week": reactions,
        "summary": _t("calendar.summary", lang, n=len(entries), best=best["post"] if best else "-"),
    }


def demo_sns_posts(file: str, lang: str = "ko") -> dict[str, Any]:
    _wait()
    posts = [
        {"channel": r["채널"], "date": r["날짜"], "language": r["언어"], "caption": r["문구"],
         "hashtags": r["해시태그"].split(), "image_note": r["이미지"]}
        for r in _rows(file)
    ]  # fmt: skip
    langs = " · ".join(sorted({str(p["language"]) for p in posts}))
    return {"posts": posts, "summary": _t("posts.summary", lang, n=len(posts), langs=langs)}


def demo_ad_plan(budget: float = 300_000, lang: str = "ko") -> dict[str, Any]:
    _wait()
    return {
        "channel": _t("ads.channel", lang),
        "budget": budget,
        "budget_text": _won(budget),
        "days": 5,
        "start": "2026-11-10",
        "audience": _t("ads.audience", lang),
        "expected_reach": _t("ads.reach", lang),
        "creative": _t("ads.creative", lang),
        "summary": _t("ads.summary", lang, budget=_won(budget)),
    }


DEMO_TOOLS: dict[str, Callable[..., dict[str, Any]]] = {
    "demo.pnl": demo_pnl,
    "demo.payables": demo_payables,
    "demo.supplier_compare": demo_supplier_compare,
    "demo.purchase_order": demo_purchase_order,
    "demo.sns_calendar": demo_sns_calendar,
    "demo.sns_posts": demo_sns_posts,
    "demo.ad_plan": demo_ad_plan,
}


def register_tools() -> None:
    """Make the scenario tools known to the workflow engine (demo servers only)."""
    TOOLS.update(DEMO_TOOLS)


# ---------------------------------------------------------------------- running scenarios


async def ensure_running(
    engine: WorkflowEngine, names: tuple[str, ...] = SCENARIOS, *, source: str = "demo"
) -> list[str]:
    """Start every scenario (of `names`) that has no run open → the workflows started."""
    started = []
    for name in names:
        if name in engine.defs and not engine.open_runs(name):
            await engine.run_now(name, {}, source=source)
            started.append(name)
    return started


async def restart(engine: WorkflowEngine, *, source: str = "demo:restart") -> list[str]:
    """Stop the open scenario runs and start each one again."""
    for name in SCENARIOS:
        for run in engine.open_runs(name):
            engine.stop_run(run["thread_id"])
    started = []
    for name in SCENARIOS:
        if name in engine.defs:
            await engine.run_now(name, {}, source=source)
            started.append(name)
    return started


async def run_through(
    engine: WorkflowEngine, name: str, answers: dict[str, str] | None = None, timeout: float = 60
) -> tuple[str, list[dict[str, Any]]]:
    """Run one scenario to its end, answering every approval (`answers[step]`, default
    approved) → (thread id, the cards answered). For the seeded past runs and the tests."""
    tid, rid = await engine.run_now(name, {}, source="demo:seed")
    cards: list[dict[str, Any]] = []
    while True:
        run = await engine.manager.wait(rid, timeout)
        if run["status"] != "interrupted":
            return tid, cards
        card = (run.get("interrupts") or [{}])[0].get("value") or {}
        cards.append(card)
        value = (answers or {}).get(str(card.get("step")), "approved")
        rid = await engine.manager.resume(tid, value, source="demo:seed")
