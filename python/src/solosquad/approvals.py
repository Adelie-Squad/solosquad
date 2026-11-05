"""Who may approve what — two tiers, owner-adjustable (decision 51).

- **owner** tier: only the owner (대표). Recommended for purchases, payments, transfers,
  deletions, account · permission · access-policy changes and adding a connection.
- **team** tier: staff who belong to the team that raised the request, and the owner.

Every approval card carries a `category` (what kind of action) and a `team` (whose agent
or workflow asked). The tier comes from `orgs/<org>/approvals.yaml`, edited by the owner in
the web; anything not listed falls back to the recommended table, and the web marks every
category where the owner chose differently from the recommendation.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any

import yaml

from solosquad.assets.text import load_yaml


class Tier(StrEnum):
    OWNER = "owner"
    TEAM = "team"


RECOMMENDED: dict[str, Tier] = {
    "purchase": Tier.OWNER,
    "payment": Tier.OWNER,
    "transfer": Tier.OWNER,
    "delete": Tier.OWNER,
    "account_change": Tier.OWNER,
    "permission_change": Tier.OWNER,
    "access_change": Tier.OWNER,
    "connection_add": Tier.OWNER,
    "review": Tier.TEAM,
    "publish": Tier.TEAM,
    "other": Tier.TEAM,
}
"""The decision-51 recommendation. Unknown categories are treated like `other`."""

LABELS = {
    "purchase": "구매",
    "payment": "결제",
    "transfer": "송금",
    "delete": "삭제",
    "account_change": "계정 변경",
    "permission_change": "권한 변경",
    "access_change": "접속 정책 변경",
    "connection_add": "연결 추가",
    "review": "검토 · 확인",
    "publish": "게시 · 발송",
    "other": "기타",
}


@dataclass(frozen=True)
class ApprovalPolicy:
    overrides: dict[str, Tier]

    def tier(self, category: str | None) -> Tier:
        cat = category or "other"
        if cat in self.overrides:
            return self.overrides[cat]
        return RECOMMENDED.get(cat, RECOMMENDED["other"])

    def table(self) -> list[dict[str, Any]]:
        cats = list(dict.fromkeys([*RECOMMENDED, *self.overrides]))
        return [
            {
                "category": c,
                "label": LABELS.get(c, c),
                "tier": self.tier(c).value,
                "recommended": RECOMMENDED.get(c, RECOMMENDED["other"]).value,
                "deviates": self.tier(c) is not RECOMMENDED.get(c, RECOMMENDED["other"]),
            }
            for c in cats
        ]


def load_policy(path: Path) -> ApprovalPolicy:
    if not path.is_file():
        return ApprovalPolicy({})
    data = load_yaml(path.read_text(encoding="utf-8")) or {}
    tiers = data.get("tiers") if isinstance(data, dict) else None
    if not isinstance(tiers, dict):
        return ApprovalPolicy({})
    return ApprovalPolicy({str(k): Tier(str(v)) for k, v in tiers.items()})


def save_policy(path: Path, policy: ApprovalPolicy) -> None:
    doc = {"schema_version": 1, "tiers": {k: v.value for k, v in policy.overrides.items()}}
    path.write_text(yaml.safe_dump(doc, sort_keys=True, allow_unicode=True), encoding="utf-8")


def can_approve(
    policy: ApprovalPolicy, card: dict[str, Any], *, is_owner: bool, teams: list[str]
) -> bool:
    if is_owner:
        return True
    if policy.tier(card.get("category")) is not Tier.TEAM:
        return False
    team = card.get("team")
    return isinstance(team, str) and team in teams
