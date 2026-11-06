"""`finance.pnl` reads the ledgers a KR ↔ CN distributor actually keeps."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from solosquad.workflows.tools import finance_pnl, parse_amount, parse_date


def _csv(tmp_path: Path, rows: list[dict[str, object]], name: str = "ledger.csv") -> str:
    path = tmp_path / name
    pd.DataFrame(rows).to_csv(path, index=False, encoding="utf-8")
    return str(path)


def test_a_chinese_ledger_with_yuan_and_cjk_dates(tmp_path: Path) -> None:
    rows = [
        {"日期": "2026年3月5日", "类型": "收入", "科目": "主营业务收入", "金额": "¥120,000.00"},
        {"日期": "2026年3月9日", "类型": "支出", "科目": "采购成本", "金额": "45000元"},
        {"日期": "2026年4月1日", "类型": "费用", "科目": "物流费", "金额": "￥3\uff0c500"},
        {"日期": "2026年4月2日", "类型": "转账", "科目": "内部", "金额": "100"},
    ]
    out = finance_pnl(_csv(tmp_path, rows), currency="CNY")
    assert out["revenue"] == 120000 and out["expenses"] == 48500
    assert out["net_income"] == 71500
    assert [m["month"] for m in out["by_month"]] == ["2026-03", "2026-04"]
    assert out["period"] == "2026-03-05 ~ 2026-04-01"  # the unreadable row is not counted
    # an unknown type (转账 — a transfer) is not guessed into revenue or cost
    assert out["needs_review"] == [{"row": 5, "reason": "구분을 알 수 없음", "value": "转账"}]


@pytest.mark.parametrize(
    ("money_in", "money_out"), [("입금", "출금"), ("收入", "支出"), ("수입", "지출")]
)
def test_a_cash_book_with_money_in_and_out_columns(
    tmp_path: Path, money_in: str, money_out: str
) -> None:
    rows = [
        {"날짜": "2026-05-01", "계정": "매출", money_in: "1,000,000", money_out: None},
        {"날짜": "2026-05-02", "계정": "임대료", money_in: None, money_out: "300,000"},
        {"날짜": "2026-05-03", "계정": "오류", money_in: "10", money_out: "10"},
        {"날짜": "2026-05-04", "계정": "빈 줄", money_in: None, money_out: None},
    ]
    out = finance_pnl(_csv(tmp_path, rows))
    assert (out["revenue"], out["expenses"], out["net_income"]) == (1000000, 300000, 700000)
    assert [r["reason"] for r in out["needs_review"]] == [
        "수입과 지출이 함께 적힘",
        "금액을 읽을 수 없음",
    ]


def test_a_general_journal_is_refused_not_guessed(tmp_path: Path) -> None:
    rows = [{"日期": "2026-01-01", "科目": "银行存款", "借方": "100", "贷方": None}]
    with pytest.raises(ValueError, match="general journal"):
        finance_pnl(_csv(tmp_path, rows))


def test_amounts_and_dates_in_the_forms_people_type() -> None:
    assert parse_amount("₩1,234원") == 1234
    assert parse_amount("(1,234)") == -1234
    assert (
        parse_amount("\uff11\uff0c\uff12\uff10\uff10.\uff15") == 1200.5
    )  # full-width digits and comma
    assert parse_amount("RMB 88") == 88
    assert parse_amount("—") is None and parse_amount(None) is None and parse_amount("") is None
    assert parse_date("2026年3月5日") == pd.Timestamp("2026-03-05")
    assert parse_date("2026.03.05") == pd.Timestamp("2026-03-05")
    assert parse_date("2026/3/5") == pd.Timestamp("2026-03-05")
    assert parse_date("어제") is None


def test_signed_amounts_without_a_type_column(tmp_path: Path) -> None:
    rows = [
        {"科目": "销售", "金额": "5000"},
        {"科目": "房租", "金额": "(1,500)"},
    ]
    out = finance_pnl(_csv(tmp_path, rows), currency="CNY")
    assert (out["revenue"], out["expenses"]) == (5000, 1500)
