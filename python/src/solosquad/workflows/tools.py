"""Deterministic workflow tools — code, not an LLM, wherever a number has to be right.

`finance.pnl` turns a transaction ledger (xlsx or csv) into a profit-and-loss table
(W14 · H6). Columns are recognised in Korean or English; a row the tool cannot read is
not guessed — it goes to `needs_review` with the reason, and the artifact is marked for
the owner to check.

    날짜 · 일자 · date            → date
    구분 · 유형 · type            → 매출/수입/income/revenue  or  비용/지출/expense/cost
    계정 · 항목 · 계정과목 · account · category
    금액 · amount
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pandas as pd

Tool = Callable[..., dict[str, Any]]

COLUMN_ALIASES = {
    "date": ("날짜", "일자", "거래일", "date"),
    "type": ("구분", "유형", "수입지출", "type"),
    "account": ("계정", "계정과목", "항목", "account", "category"),
    "amount": ("금액", "amount", "value"),
}
REVENUE = {"매출", "수입", "income", "revenue", "sales"}
EXPENSE = {"비용", "지출", "expense", "cost", "costs"}


def _read(file: str | Path) -> pd.DataFrame:
    path = Path(file)
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path)
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        return pd.read_excel(path)
    raise ValueError(f"unsupported file type {path.suffix!r} — use .xlsx or .csv")


def _columns(df: pd.DataFrame) -> dict[str, str]:
    found: dict[str, str] = {}
    lowered = {str(c).strip().lower(): str(c) for c in df.columns}
    for key, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias.lower() in lowered:
                found[key] = lowered[alias.lower()]
                break
    missing = [k for k in ("account", "amount") if k not in found]
    if missing:
        raise ValueError(
            f"ledger needs columns {missing} (e.g. 계정 · 금액); found {list(df.columns)}"
        )
    return found


def finance_pnl(file: str, currency: str = "KRW", period: str | None = None) -> dict[str, Any]:
    df = _read(file)
    cols = _columns(df)
    review: list[dict[str, Any]] = []
    revenue: dict[str, float] = {}
    expenses: dict[str, float] = {}
    months: dict[str, dict[str, float]] = {}
    dates: list[pd.Timestamp] = []
    # line = the spreadsheet row a person sees: +1 for the header, +1 for one-based
    for line, (_, row) in enumerate(df.iterrows(), start=2):
        raw = row[cols["amount"]]
        amount = (
            pd.to_numeric(str(raw).replace(",", ""), errors="coerce") if pd.notna(raw) else None
        )
        account = str(row[cols["account"]]).strip() if pd.notna(row[cols["account"]]) else ""
        if amount is None or pd.isna(amount):
            review.append({"row": line, "reason": "금액을 읽을 수 없음", "value": str(raw)})
            continue
        if not account:
            review.append({"row": line, "reason": "계정이 비어 있음", "value": str(raw)})
            continue
        kind: str | None = None
        if "type" in cols and pd.notna(row[cols["type"]]):
            label = str(row[cols["type"]]).strip().lower()
            kind = "revenue" if label in REVENUE else "expense" if label in EXPENSE else None
            if kind is None:
                review.append({"row": line, "reason": "구분을 알 수 없음", "value": label})
                continue
            value = abs(float(amount))
        else:
            kind = "revenue" if float(amount) >= 0 else "expense"
            value = abs(float(amount))
        bucket = revenue if kind == "revenue" else expenses
        bucket[account] = bucket.get(account, 0.0) + value
        if "date" in cols and pd.notna(row[cols["date"]]):
            when = pd.to_datetime(row[cols["date"]], errors="coerce")
            if pd.isna(when):
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
