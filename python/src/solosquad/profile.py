"""Customer profile — what differs per customer, filled in at setup (decision 50).

Region, the legal entities that hold model accounts, the cloud and how the agency reaches
it, languages and who reviews personal-data rules are not product decisions: they are
facts about one customer. They live in the customer's repository (`core/profile.yaml`,
no secrets, no personal data) and the engine follows whatever combination they describe,
refusing only what the provider-eligibility rules forbid (decision 45).

    schema_version: 1
    server: {cloud: aws, region: ap-northeast-2, access: "FDE IAM role"}
    entities:
      - {id: moa-kr, name: Moa Korea Co., country: KR}
      - {id: moa-qd, name: Moa Qingdao 3PL, country: CN}
    languages: {enabled: [ko, en, zh-CN]}
    privacy: {regimes: [PIPA, PIPL], reviewer: 고객 법무팀}

The server's country is one value in one place since decision 57 ⑷: `server_country` in
`core/server.yaml` (I41). `server.country` here is a view of it — read from the server
settings, written back to them — so the profile and the region rule can never disagree.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from solosquad.assets.text import load_yaml
from solosquad.layout import Solution
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
    """The languages the customer uses. The old `default` (a customer default language)
    was retired on 2026-11-11 — each person picks their own screen language, ko until
    they do. An old file's `default:` is ignored and dropped at the next save."""

    enabled: list[str] = Field(default_factory=lambda: list(LANGUAGES))

    @field_validator("enabled")
    @classmethod
    def _known(cls, v: list[str]) -> list[str]:
        if any(lang not in LANGUAGES for lang in v):
            raise ValueError(f"languages must be among {LANGUAGES}")
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
    """The profile with `server.country` taken from the server settings (I41)."""
    path = profile_path(solution_root)
    raw = load_yaml(path.read_text(encoding="utf-8")) if path.is_file() else {}
    profile = CustomerProfile.model_validate(raw or {})
    if (solution_root / "core").is_dir():
        country = Solution(solution_root).server_config(strict=False).server_country
        profile = profile.model_copy(
            update={"server": profile.server.model_copy(update={"country": country})}
        )
    return profile


def save_profile(solution_root: Path, profile: CustomerProfile) -> None:
    """`server.country` goes to `core/server.yaml`; everything else to the profile file."""
    doc = profile.model_dump(mode="json", exclude_none=True)
    doc.get("server", {}).pop("country", None)
    profile_path(solution_root).write_text(
        yaml.safe_dump(doc, sort_keys=False, allow_unicode=True), encoding="utf-8"
    )
    sol = Solution(solution_root)
    if sol.server_config(strict=False).server_country != profile.server.country:
        apply_server_country(solution_root, profile.server.country)


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


def update_profile(base: CustomerProfile, change: dict[str, Any]) -> CustomerProfile:
    """The web's edit (`PUT /api/profile`): each section given replaces or merges into the
    old one and every rule of the model applies (known languages, upper-case countries,
    unique entity ids). Unknown sections are refused — the profile holds facts only."""
    allowed = {"server", "entities", "languages", "privacy"}
    unknown = sorted(set(change) - allowed)
    if unknown:
        raise ValueError(f"unknown profile sections {unknown} (editable: {sorted(allowed)})")
    data = base.model_dump()
    if isinstance(change.get("server"), dict):
        data["server"] = {**data["server"], **change["server"]}
    if "entities" in change:
        ents = change["entities"] or []
        if not isinstance(ents, list):
            raise ValueError("entities must be a list")
        clean = []
        for e in ents:
            ent = ProfileEntity.model_validate(e)
            clean.append(
                ent.model_copy(
                    update={
                        "id": ent.id.strip(),
                        "country": ent.country.strip().upper(),
                        "controlled_by": (ent.controlled_by or "").strip().upper() or None,
                    }
                ).model_dump()
            )
        ids = [e["id"] for e in clean]
        if len(ids) != len(set(ids)) or not all(ids):
            raise ValueError("every entity needs a unique, non-empty id")
        data["entities"] = clean
    if isinstance(change.get("languages"), dict):
        data["languages"] = {**data["languages"], **change["languages"]}
        if any(lang not in LANGUAGES for lang in data["languages"].get("enabled") or []):
            raise ValueError(f"languages must be among {LANGUAGES}")
    if isinstance(change.get("privacy"), dict):
        data["privacy"] = {**data["privacy"], **change["privacy"]}
    return CustomerProfile.model_validate(data)


def apply_server_country(solution_root: Path, country: str | None) -> None:
    """The server's country — the region rule's input for every workspace (decision 45) —
    is written once, to `core/server.yaml` (I41); nothing is copied per workspace."""
    Solution(solution_root).update_server_country(country)
