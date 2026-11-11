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


def _rows(file: str) -> list[dict[str, str]]:
    with Path(file).open(encoding="utf-8", newline="") as f:
        return [{k.strip(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f)]


def _won(n: float) -> str:
    return f"₩{n:,.0f}"


def demo_pnl(bank: str, market: str, currency: str = "KRW") -> dict[str, Any]:
    """The bank statement and the market settlement read as one ledger → `finance.pnl` (the
    real deterministic tool; its rows to check are the copy's flagged transactions)."""
    _wait()
    with tempfile.TemporaryDirectory() as tmp:
        merged = Path(tmp) / "ledger.csv"
        head, *rest = Path(bank).read_text(encoding="utf-8").splitlines()
        more = Path(market).read_text(encoding="utf-8").splitlines()[1:]
        merged.write_text("\n".join([head, *rest, *more]) + "\n", encoding="utf-8")
        return finance_pnl(str(merged), currency)


def demo_payables(file: str) -> dict[str, Any]:
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
        "account": "(예시) 기업은행 ***-1234",
        "pay_on": items[0]["due"] if items else "",
        "summary": f"거래처 {len(items)}곳 · 합계 {_won(total)} · 지급 예정 11월 4일",
    }


def demo_supplier_compare(file: str) -> dict[str, Any]:
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
        "product": "보온 텀블러 500ml (겨울 시즌)",
        "retail_price": 19900,
        "suppliers": rows,
        "recommended": best,
        "summary": f"공급처 {len(rows)}곳 원가 비교 — 추천 {best or '-'}",
    }


def demo_purchase_order(file: str, supplier: str) -> dict[str, Any]:
    """A draft in the supplier's language (중국어) — nothing is sent."""
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
    return {
        "supplier": supplier,
        "language": "zh-CN",
        "title_local": "采购订单（草稿）",
        "po_number": "PO-2026-1107 (예시)",
        "currency": "CNY",
        "lines": lines,
        "subtotal": subtotal,
        "total": subtotal,
        "total_text": f"¥{subtotal:,.0f} (약 {_won(krw)})",
        "delivery": "2026-11-28 · 인천항 → 경기 광주 물류센터",
        "terms_local": "到港后30天内付款 · 每个产品单独包装 · 杯身激光刻字「MOA」",
        "summary": f"{supplier} · {len(lines)}개 품목 · ¥{subtotal:,.0f}",
    }


def demo_sns_calendar(week: str, last_week: str) -> dict[str, Any]:
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
        "summary": f"이번 주 {len(entries)}건 · 지난주 최고 반응 '{best['post'] if best else '-'}'",
    }


def demo_sns_posts(file: str) -> dict[str, Any]:
    _wait()
    posts = [
        {"channel": r["채널"], "date": r["날짜"], "language": r["언어"], "caption": r["문구"],
         "hashtags": r["해시태그"].split(), "image_note": r["이미지"]}
        for r in _rows(file)
    ]  # fmt: skip
    langs = sorted({str(p["language"]) for p in posts})
    return {"posts": posts, "summary": f"게시 초안 {len(posts)}건 ({' · '.join(langs)})"}


def demo_ad_plan(budget: float = 300_000) -> dict[str, Any]:
    _wait()
    return {
        "channel": "인스타그램",
        "budget": budget,
        "budget_text": _won(budget),
        "days": 5,
        "start": "2026-11-10",
        "audience": "서울 · 경기 · 25~44세 · 관심사 캠핑 · 홈카페",
        "expected_reach": "40,000 ~ 60,000명",
        "creative": "신상품 텀블러 릴스 · 홈카페 캐러셀",
        "summary": f"인스타그램 5일 · {_won(budget)} · 예상 도달 4만~6만 명",
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
