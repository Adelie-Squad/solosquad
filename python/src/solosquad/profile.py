"""The retired customer profile (`core/profile.yaml`, decision 50) — read once, then removed.

User 2026-11-11: "회사 프로필은 '서버'로 바꾸고 서버만 남기고 언어, 법인, 개인정보는 제거."
The profile's parts went to where they belong:

- `server.country` → `core/server.yaml` `server_country` (already since rev7, I41);
  `server.cloud` · `server.region` → `core/server.yaml` `cloud` · `region` (the builder's
  overrides of the detected facts, `server_facts`); `server.access` (how the agency reaches
  the cloud — a builder note, never shown to customers) → `core/server.yaml` `agency_access`.
- `entities` (the account-holding legal entities) → the one **회사** in `core.db`
  (`solosquad.company_info`): the entity the connections named, else the profile's first one,
  becomes the company (법인) if no company was entered yet. The per-connection `entity`
  is removed from the connection files — every connection is held by the company.
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
from solosquad.company_info import from_entity
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


def lift_customer_profile(sol: Solution, store: Any) -> dict[str, Any]:
    """Move the profile and the connections' entities out (see the module doc). `store` =
    the `AccountStore` of `core.db`. → what was moved, for the audit."""
    done: dict[str, Any] = {}
    if not store.has_company():
        entities = legacy_entities(sol)
        if entities:
            company = from_entity(entities[0])
            store.set_company(company)
            done["company"] = company.name
            names = {str(e.get("name") or "") for e in entities}
            if len(names) > 1:
                done["entities_dropped"] = sorted(names - {company.name})
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
            doc["connections"] = [
                {k: v for k, v in c.items() if k != "entity"} if isinstance(c, dict) else c
                for c in conns
            ]
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
