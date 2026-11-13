"""The retired customer profile (`core/profile.yaml`, decision 50) — read once, then removed.

User 2026-11-11: "회사 프로필은 '서버'로 바꾸고 서버만 남기고 언어, 법인, 개인정보는 제거."
The profile's parts went to where they belong:

- `server.country` → `core/server.yaml` `server_country` (already since rev7, I41);
  `server.cloud` · `server.region` → `core/server.yaml` `cloud` · `region` (the builder's
  overrides of the detected facts, `server_facts`); `server.access` (how the agency reaches
  the cloud — a builder note, never shown to customers) → `core/server.yaml` `agency_access`.
- `entities` (the account-holding legal entities) → the legal entities in `core.db`
  (`solosquad.entities`, 2026-11-14 — several are kept now) if none was entered yet: the
  one the connections named first, else the profile's first, becomes the 대표 법인, every
  other distinct name a further entity. A connection's `entity` becomes its `entity_id`
  (보유 법인) — the entity's name and country leave the connection files.
- `languages` and `privacy` are dropped: all three UI languages are always on, and the
  privacy regimes / reviewer were never read by the engine.

`lift_customer_profile` runs at the first start (`open_accounts`); old keys anywhere are
ignored on read, so a half-migrated folder still starts.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from solosquad.assets.text import load_yaml
from solosquad.company_info import Company, from_entity
from solosquad.layout import Solution


def profile_path(solution_root: Path) -> Path:
    return solution_root / "core" / "profile.yaml"


def _raw(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    data = load_yaml(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def _dump(path: Path, doc: dict[str, Any]) -> None:
    path.write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True), encoding="utf-8")


def connection_files(sol: Solution) -> list[Path]:
    return [sol.connections_path, *(o.root / "connections.yaml" for o in sol.orgs())]


def legacy_entities(sol: Solution) -> list[dict[str, Any]]:
    """Every retired entity, in the order the migration prefers them: the ones connections
    named (core first, then each org), then the profile's list."""
    found: list[dict[str, Any]] = []
    for path in connection_files(sol):
        for conn in _raw(path).get("connections") or []:
            if isinstance(conn, dict) and isinstance(conn.get("entity"), dict):
                found.append(conn["entity"])
    for ent in _raw(profile_path(sol.root)).get("entities") or []:
        if isinstance(ent, dict):
            found.append(ent)
    return found


def legacy_fields(company: Company) -> dict[str, Any]:
    """A retired entity as the columns of a new core.db entity (no registration number)."""
    foreign = bool(company.country) and company.country != "KR"
    return {
        "kind": "foreign" if foreign else company.kind, "name": company.name,
        "registration_no": "", "registration_kind": None, "representative": "",
        "country": company.country, "address": "", "controlled_by": company.controlled_by,
    }  # fmt: skip


def _lift_entity(conn: dict[str, Any], ids: dict[str, int]) -> dict[str, Any]:
    """A connection without its retired `entity`, holding the core.db entity it named."""
    out = {k: v for k, v in conn.items() if k != "entity"}
    named = conn.get("entity")
    name = str(named.get("name") or "").strip() if isinstance(named, dict) else ""
    if name in ids and "entity_id" not in out:
        out["entity_id"] = ids[name]
    return out


def lift_customer_profile(sol: Solution, store: Any) -> dict[str, Any]:
    """Move the profile and the connections' entities out (see the module doc). `store` =
    the `AccountStore` of `core.db`. → what was moved, for the audit."""
    done: dict[str, Any] = {}
    ids: dict[str, int] = {}
    """legacy entity name → the core.db entity it became (2026-11-14: every one is kept)."""
    if not store.has_company():
        for i, ent in enumerate(legacy_entities(sol)):
            company = from_entity(ent)
            if company.name in ids:
                continue
            if i == 0:
                store.set_company(company)  # the first becomes the 대표 법인
                primary = store.primary_entity()
                ids[company.name] = primary.id
                done["company"] = company.name
            else:
                ids[company.name] = store.add_entity(legacy_fields(company)).id
                done.setdefault("entities", []).append(company.name)
    profile = profile_path(sol.root)
    raw = _raw(profile)
    found = raw.get("server")
    server: dict[str, Any] = found if isinstance(found, dict) else {}
    lifted = {
        key: str(server[old])
        for old, key in (("cloud", "cloud"), ("region", "region"), ("access", "agency_access"))
        if server.get(old)
    }
    if lifted:
        srv = _raw(sol.server_config_path)
        changes = {k: v for k, v in lifted.items() if not srv.get(k)}
        if changes:
            _dump(sol.server_config_path, {**srv, **changes})
            done["server"] = sorted(changes)
    for path in connection_files(sol):
        doc = _raw(path)
        conns = doc.get("connections") or []
        if any(isinstance(c, dict) and "entity" in c for c in conns):
            doc["connections"] = [_lift_entity(c, ids) if isinstance(c, dict) else c for c in conns]
            _dump(path, doc)
            done.setdefault("connections", []).append(str(path.relative_to(sol.root)))
    if profile.is_file():
        country = server.get("country")
        srv = _raw(sol.server_config_path)
        if country and not srv.get("server_country"):
            _dump(sol.server_config_path, {**srv, "server_country": str(country).upper()})
        profile.unlink()
        done["profile"] = "removed"
    return done
