"""Customer profile — what differs per customer, filled in at setup (decision 50).

Region, the legal entities that hold model accounts, the cloud and how the agency reaches
it, languages and who reviews personal-data rules are not product decisions: they are
facts about one customer. They live in the customer's repository (`core/profile.yaml`,
no secrets, no personal data) and the engine follows whatever combination they describe,
refusing only what the provider-eligibility rules forbid (decision 45).

    schema_version: 1
    server: {country: KR, cloud: aws, region: ap-northeast-2, access: "FDE IAM role"}
    entities:
      - {id: moa-kr, name: Moa Korea Co., country: KR}
      - {id: moa-qd, name: Moa Qingdao 3PL, country: CN}
    languages: {default: ko, enabled: [ko, en, zh-CN]}
    privacy: {regimes: [PIPA, PIPL], reviewer: 고객 법무팀}
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from solosquad.assets.text import load_yaml
from solosquad.routing.eligibility import Entity

LANGUAGES = ("ko", "en", "zh-CN")
"""The UI languages of v2.1.0 (decision 53)."""


class Server(BaseModel):
    model_config = ConfigDict(extra="allow")
    country: str | None = None
    """ISO country of the VM — the region rule of decision 45 reads this."""
    cloud: str | None = None
    region: str | None = None
    access: str | None = None
    """How the agency reaches the customer's cloud (role, account, VPN) — no credentials."""

    @field_validator("country")
    @classmethod
    def _upper(cls, v: str | None) -> str | None:
        return v.upper() if v else v


class ProfileEntity(Entity):
    id: str


class Languages(BaseModel):
    default: str = "ko"
    enabled: list[str] = Field(default_factory=lambda: list(LANGUAGES))

    @field_validator("default")
    @classmethod
    def _known(cls, v: str) -> str:
        if v not in LANGUAGES:
            raise ValueError(f"language must be one of {LANGUAGES}")
        return v


class Privacy(BaseModel):
    regimes: list[str] = Field(default_factory=list)
    reviewer: str | None = None
    """A role (e.g. the customer's legal team), not a person's name."""


class CustomerProfile(BaseModel):
    model_config = ConfigDict(extra="allow")
    schema_version: int = 1
    server: Server = Field(default_factory=Server)
    entities: list[ProfileEntity] = Field(default_factory=list)
    languages: Languages = Field(default_factory=Languages)
    privacy: Privacy = Field(default_factory=Privacy)

    def entity(self, eid: str) -> ProfileEntity:
        for e in self.entities:
            if e.id == eid:
                return e
        raise KeyError(
            f"no entity {eid!r} in the customer profile (have {[e.id for e in self.entities]})"
        )

    def checklist(self) -> list[dict[str, Any]]:
        """Decision 50's setup items — what is still missing before the customer can start."""
        items = [
            ("server_country", "서버 위치(나라)", bool(self.server.country)),
            ("cloud", "클라우드 제공사 · 리전", bool(self.server.cloud and self.server.region)),
            ("cloud_access", "에이전시 접근 방식", bool(self.server.access)),
            ("entities", "모델 계정 보유 법인", bool(self.entities)),
            ("languages", "언어", bool(self.languages.enabled)),
            ("privacy", "개인정보 규정 · 검토 주체", bool(self.privacy.reviewer)),
        ]
        return [{"item": k, "label": label, "done": done} for k, label, done in items]


def profile_path(solution_root: Path) -> Path:
    return solution_root / "core" / "profile.yaml"


def load_profile(solution_root: Path) -> CustomerProfile:
    path = profile_path(solution_root)
    if not path.is_file():
        return CustomerProfile()
    return CustomerProfile.model_validate(load_yaml(path.read_text(encoding="utf-8")) or {})


def save_profile(solution_root: Path, profile: CustomerProfile) -> None:
    doc = profile.model_dump(mode="json", exclude_none=True)
    profile_path(solution_root).write_text(
        yaml.safe_dump(doc, sort_keys=False, allow_unicode=True), encoding="utf-8"
    )


def parse_entity(spec: str) -> ProfileEntity:
    """`id=name:country[:controlled_by]`, e.g. `moa-qd=Moa Qingdao 3PL:CN`."""
    eid, sep, rest = spec.partition("=")
    parts = rest.split(":")
    if not sep or not eid or len(parts) not in (2, 3) or not parts[0] or not parts[1]:
        raise ValueError(f"entity must look like id=name:country[:controlled_by], not {spec!r}")
    return ProfileEntity(
        id=eid.strip(),
        name=parts[0].strip(),
        country=parts[1].strip().upper(),
        controlled_by=parts[2].strip().upper() if len(parts) == 3 and parts[2] else None,
    )
