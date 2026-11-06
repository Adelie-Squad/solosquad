"""Deterministic workflow tools — code, not an LLM, wherever a number has to be right.

`finance.pnl` turns a transaction ledger (xlsx or csv) into a profit-and-loss table
(W14 · H6). Columns are recognised in Korean, Chinese or English; a row the tool cannot
read is not guessed — it goes to `needs_review` with the reason, and the artifact is marked
for the owner to check.

    날짜 · 일자 · 日期 · date                 → date
    구분 · 유형 · 类型 · 收支 · type           → 매출/수입/收入/income
                                                or 비용/지출/支出/费用/expense
    계정 · 항목 · 科目 · 会计科目 · account
    금액 · 金额 · 发生额 · amount              one signed amount, or
    수입/지출 · 입금/출금 · 收入/支出          a cash book: money in and money out in two columns

A general journal with only 차변/대변 · 借方/贷方 is refused: which side is revenue depends
on the account, and this tool does not guess.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pandas as pd

Tool = Callable[..., dict[str, Any]]

COLUMN_ALIASES = {
    "date": ("날짜", "일자", "거래일", "日期", "交易日期", "记账日期", "date"),
    "type": ("구분", "유형", "수입지출", "类型", "收支", "收支类型", "type"),
    "account": (
        "계정", "계정과목", "항목", "科目", "会计科目", "项目", "account", "category",
    ),
    "amount": ("금액", "金额", "发生额", "amount", "value"),
    # a cash book keeps money in and money out in two columns
    "money_in": ("수입", "입금", "收入", "收入金额", "income"),
    "money_out": ("지출", "출금", "支出", "支出金额", "expense"),
}  # fmt: skip
JOURNAL_ONLY = ("차변", "대변", "借方", "贷方", "debit", "credit")
REVENUE = {
    "매출", "수입", "income", "revenue", "sales",
    "收入", "营业收入", "销售收入", "主营业务收入", "其他业务收入", "收",
}  # fmt: skip
EXPENSE = {
    "비용", "지출", "expense", "cost", "costs",
    "支出", "费用", "成本", "营业成本", "主营业务成本", "管理费用", "销售费用", "支",
}  # fmt: skip
_CURRENCY = re.compile(r"[₩￦¥￥$€]|원|元|人民币|RMB|KRW|CNY", re.IGNORECASE)
_CJK_DATE = re.compile(r"^\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?\s*$")


def _read(file: str | Path) -> pd.DataFrame:
    path = Path(file)
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path)
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        return pd.read_excel(path)
    raise ValueError(f"unsupported file type {path.suffix!r} — use .xlsx or .csv")


def _columns(df: pd.DataFrame) -> dict[str, str]:
    found: dict[str, str] = {}
    lowered = {unicodedata.normalize("NFKC", str(c)).strip().lower(): str(c) for c in df.columns}
    for key, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias.lower() in lowered:
                found[key] = lowered[alias.lower()]
                break
    has_amount = "amount" in found or ("money_in" in found and "money_out" in found)
    if "account" in found and has_amount:
        return found
    if any(j.lower() in lowered for j in JOURNAL_ONLY) and not has_amount:
        raise ValueError(
            "this looks like a general journal (차변/대변 · 借方/贷方) — export a ledger with "
            "an amount and a type column, or a cash book with money in / money out columns"
        )
    missing = [k for k in ("account",) if k not in found] + ([] if has_amount else ["amount"])
    raise ValueError(
        f"ledger needs columns {missing} (e.g. 계정 · 금액 / 科目 · 金额); found {list(df.columns)}"
    )


def parse_amount(raw: Any) -> float | None:
    """`1,234` · `₩1,234원` · `￥1,234.50元` · `(1,234)` (negative) · full-width digits/commas."""
    if raw is None or (not isinstance(raw, str) and pd.isna(raw)):
        return None
    if isinstance(raw, int | float):
        return float(raw)
    text = unicodedata.normalize("NFKC", str(raw)).strip()
    text = _CURRENCY.sub("", text).replace(",", "").replace(" ", "")
    negative = text.startswith("(") and text.endswith(")")
    text = text.strip("()")
    if not text:
        return None
    value = pd.to_numeric(text, errors="coerce")
    if pd.isna(value):
        return None
    return -float(value) if negative else float(value)


def parse_date(raw: Any) -> pd.Timestamp | None:
    """ISO · `2026.03.05` · `2026/3/5` · `2026年3月5日` · Excel dates."""
    if raw is None or (not isinstance(raw, str) and pd.isna(raw)):
        return None
    if isinstance(raw, pd.Timestamp):
        return raw
    text = unicodedata.normalize("NFKC", str(raw)).strip()
    m = _CJK_DATE.match(text)
    if m:
        text = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    when = pd.to_datetime(text.replace(".", "-"), errors="coerce")
    return None if pd.isna(when) else when


def _kind(label: str) -> str | None:
    label = unicodedata.normalize("NFKC", label).strip().lower()
    return "revenue" if label in REVENUE else "expense" if label in EXPENSE else None


def finance_pnl(file: str, currency: str = "KRW", period: str | None = None) -> dict[str, Any]:
    df = _read(file)
    cols = _columns(df)
    cash_book = "amount" not in cols
    review: list[dict[str, Any]] = []
    revenue: dict[str, float] = {}
    expenses: dict[str, float] = {}
    months: dict[str, dict[str, float]] = {}
    dates: list[pd.Timestamp] = []
    # line = the spreadsheet row a person sees: +1 for the header, +1 for one-based
    for line, (_, row) in enumerate(df.iterrows(), start=2):
        account = str(row[cols["account"]]).strip() if pd.notna(row[cols["account"]]) else ""
        kind: str | None
        if cash_book:
            got_in = parse_amount(row[cols["money_in"]])
            got_out = parse_amount(row[cols["money_out"]])
            both = f"{row[cols['money_in']]} / {row[cols['money_out']]}"
            if (got_in or 0) and (got_out or 0):
                review.append({"row": line, "reason": "수입과 지출이 함께 적힘", "value": both})
                continue
            if not (got_in or got_out):
                review.append({"row": line, "reason": "금액을 읽을 수 없음", "value": both})
                continue
            kind, amount = ("revenue", got_in) if got_in else ("expense", got_out)
        else:
            raw = row[cols["amount"]]
            amount = parse_amount(raw)
            if amount is None:
                review.append({"row": line, "reason": "금액을 읽을 수 없음", "value": str(raw)})
                continue
            if "type" in cols and pd.notna(row[cols["type"]]):
                label = str(row[cols["type"]]).strip()
                kind = _kind(label)
                if kind is None:
                    review.append({"row": line, "reason": "구분을 알 수 없음", "value": label})
                    continue
            else:
                kind = "revenue" if amount >= 0 else "expense"
        if not account:
            review.append({"row": line, "reason": "계정이 비어 있음", "value": str(amount)})
            continue
        value = abs(float(amount or 0))
        bucket = revenue if kind == "revenue" else expenses
        bucket[account] = bucket.get(account, 0.0) + value
        if "date" in cols and pd.notna(row[cols["date"]]):
            when = parse_date(row[cols["date"]])
            if when is None:
                review.append(
                    {"row": line, "reason": "날짜를 읽을 수 없음", "value": str(row[cols["date"]])}
                )
            else:
                dates.append(when)
                month = when.strftime("%Y-%m")
                m = months.setdefault(month, {"revenue": 0.0, "expenses": 0.0})
                m["revenue" if kind == "revenue" else "expenses"] += value
    total_rev = round(sum(revenue.values()), 2)
    total_exp = round(sum(expenses.values()), 2)
    net = round(total_rev - total_exp, 2)
    if period is None and dates:
        period = f"{min(dates).strftime('%Y-%m-%d')} ~ {max(dates).strftime('%Y-%m-%d')}"
    by_account = [
        {"account": a, "type": "revenue", "amount": round(v, 2)} for a, v in sorted(revenue.items())
    ] + [
        {"account": a, "type": "expense", "amount": round(v, 2)}
        for a, v in sorted(expenses.items(), key=lambda kv: -kv[1])
    ]
    by_month = [
        {"month": k, "revenue": round(v["revenue"], 2), "expenses": round(v["expenses"], 2),
         "net": round(v["revenue"] - v["expenses"], 2)}
        for k, v in sorted(months.items())
    ]  # fmt: skip
    summary = (
        f"기간 {period or '미상'} · 매출 {total_rev:,.0f} · 비용 {total_exp:,.0f} · "
        f"순이익 {net:,.0f} {currency}" + (f" · 확인 필요 {len(review)}행" if review else "")
    )
    return {
        "period": period,
        "currency": currency,
        "revenue": total_rev,
        "expenses": total_exp,
        "net_income": net,
        "by_account": by_account,
        "by_month": by_month,
        "needs_review": review,
        "rows": len(df),
        "summary": summary,
    }


TOOLS: dict[str, Tool] = {"finance.pnl": finance_pnl}
