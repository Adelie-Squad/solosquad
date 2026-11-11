"""What this engine server is and where it runs — detected, not typed (user 2026-11-11).

The web's 서버 tab shows these facts read-only; the region rule of decision 45 reads the
country from here. Detection is best-effort, cheap and offline: environment variables and a
few local files only — never a network call (no cloud metadata endpoint), so a laptop
without a network answers the same way it always does.

Order, per fact (the first that answers wins):

1. **The builder's override** in `core/server.yaml` — `type` (local · intranet · cloud),
   `cloud`, `region`, `server_country`. A value the builder set is never second-guessed.
2. **Environment hints** the platform itself sets — AWS (`AWS_EXECUTION_ENV`,
   `ECS_CONTAINER_METADATA_URI[_V4]`, `AWS_LAMBDA_FUNCTION_NAME`), Google Cloud (`K_SERVICE`,
   `GAE_SERVICE`, `FUNCTION_TARGET`, `CLOUD_RUN_JOB`), Azure (`WEBSITE_INSTANCE_ID`,
   `CONTAINER_APP_NAME`), Fly (`FLY_REGION`). A bare `AWS_REGION` on a laptop is *not* a cloud
   hint — developers set it for the AWS CLI — it only names the region once AWS is known.
3. **Known files** — the machine's DMI vendor strings (`/sys/class/dmi/id/sys_vendor`,
   `product_name`, `bios_vendor`, `board_asset_tag`) and `/sys/hypervisor/uuid` (EC2's
   starts with `ec2`).
4. **Nothing found → local** (로컬). The country of a local server is unknown unless the
   builder sets `server_country`.

The country is derived from the region (`ap-northeast-2` → KR, `asia-northeast3` → KR …)
when there is one and no override.
"""

from __future__ import annotations

import os
import platform
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

from solosquad import __version__

Where = Literal["local", "intranet", "cloud"]
Source = Literal["override", "detected", "default"]

_ENV_CLOUD: tuple[tuple[str, str], ...] = (
    ("AWS_EXECUTION_ENV", "aws"),
    ("ECS_CONTAINER_METADATA_URI_V4", "aws"),
    ("ECS_CONTAINER_METADATA_URI", "aws"),
    ("AWS_LAMBDA_FUNCTION_NAME", "aws"),
    ("K_SERVICE", "gcp"),
    ("CLOUD_RUN_JOB", "gcp"),
    ("GAE_SERVICE", "gcp"),
    ("FUNCTION_TARGET", "gcp"),
    ("WEBSITE_INSTANCE_ID", "azure"),
    ("CONTAINER_APP_NAME", "azure"),
    ("FLY_REGION", "fly"),
)
_ENV_REGION: dict[str, tuple[str, ...]] = {
    "aws": ("AWS_REGION", "AWS_DEFAULT_REGION"),
    "gcp": ("GOOGLE_CLOUD_REGION", "CLOUD_RUN_REGION", "FUNCTION_REGION"),
    "azure": ("REGION_NAME", "WEBSITE_REGION"),
    "fly": ("FLY_REGION",),
}
_DMI = ("sys_vendor", "product_name", "bios_vendor", "board_asset_tag", "chassis_asset_tag")
_DMI_CLOUD: tuple[tuple[str, str], ...] = (
    ("amazon ec2", "aws"),
    ("amazon", "aws"),
    ("google", "gcp"),
    ("naver", "ncp"),
    ("alibaba", "alibaba"),
    ("tencent", "tencent"),
    ("openstack", "openstack"),
    ("7783-7084-3265-9085-8269-3286-77", "azure"),  # Azure's chassis asset tag
)

# region → ISO country. Exact names first, then prefixes (longest wins).
_REGION_COUNTRY: dict[str, str] = {
    # AWS
    "ap-northeast-1": "JP",
    "ap-northeast-2": "KR",
    "ap-northeast-3": "JP",
    "ap-southeast-1": "SG",
    "ap-southeast-2": "AU",
    "ap-southeast-3": "ID",
    "ap-south-1": "IN",
    "ap-east-1": "HK",
    "ca-central-1": "CA",
    "sa-east-1": "BR",
    "eu-central-1": "DE",
    "eu-west-1": "IE",
    "eu-west-2": "GB",
    "eu-west-3": "FR",
    "eu-north-1": "SE",
    "eu-south-1": "IT",
    "me-south-1": "BH",
    "af-south-1": "ZA",
    # Google Cloud
    "asia-northeast1": "JP",
    "asia-northeast2": "JP",
    "asia-northeast3": "KR",
    "asia-east1": "TW",
    "asia-east2": "HK",
    "asia-southeast1": "SG",
    "asia-south1": "IN",
    "australia-southeast1": "AU",
    "europe-west1": "BE",
    "europe-west2": "GB",
    "europe-west3": "DE",
    "europe-west4": "NL",
    # Azure
    "koreacentral": "KR",
    "koreasouth": "KR",
    "japaneast": "JP",
    "japanwest": "JP",
    "eastasia": "HK",
    "southeastasia": "SG",
    "chinaeast": "CN",
    "chinanorth": "CN",
    # Fly
    "icn": "KR",
    "nrt": "JP",
    "hkg": "HK",
    "sin": "SG",
    # NAVER Cloud
    "kr": "KR",
    "kr-1": "KR",
    "kr-2": "KR",
}
_REGION_PREFIX: dict[str, str] = {
    "us-": "US",
    "cn-": "CN",
    "us": "US",
    "northamerica-northeast": "CA",
    "china": "CN",
}


def region_country(region: str | None) -> str | None:
    if not region:
        return None
    r = region.strip().lower()
    if r in _REGION_COUNTRY:
        return _REGION_COUNTRY[r]
    for prefix in sorted(_REGION_PREFIX, key=len, reverse=True):
        if r.startswith(prefix):
            return _REGION_PREFIX[prefix]
    return None


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return ""


def _cloud_from_files(root: Path) -> str | None:
    dmi = root / "sys" / "class" / "dmi" / "id"
    seen = " ".join(_read(dmi / name).lower() for name in _DMI)
    for needle, cloud in _DMI_CLOUD:
        if needle in seen:
            return cloud
    if _read(root / "sys" / "hypervisor" / "uuid").lower().startswith("ec2"):
        return "aws"
    return None


@dataclass(frozen=True)
class ServerFacts:
    where: Where
    cloud: str | None
    region: str | None
    country: str | None
    os: str
    version: str
    sources: dict[str, Source] = field(default_factory=dict)
    """Per fact: `override` (core/server.yaml) · `detected` · `default`."""

    def public(self) -> dict[str, Any]:
        return asdict(self)


def detect(
    server: Mapping[str, Any],
    *,
    env: Mapping[str, str] | None = None,
    root: Path = Path("/"),
) -> ServerFacts:
    """`server` = what `core/server.yaml` says (only keys the builder wrote count as an
    override). `env` and `root` are for tests; by default the real process and machine."""
    env = os.environ if env is None else env
    sources: dict[str, Source] = {}

    cloud = str(server["cloud"]).lower() if server.get("cloud") else None
    if cloud:
        sources["cloud"] = "override"
    else:
        cloud = next((c for var, c in _ENV_CLOUD if env.get(var)), None) or _cloud_from_files(root)
        sources["cloud"] = "detected" if cloud else "default"

    where: Where
    explicit_type = str(server.get("type") or "")
    if explicit_type in ("local", "intranet", "cloud"):
        where = explicit_type  # type: ignore[assignment]
        sources["where"] = "override"
    elif cloud:
        where, sources["where"] = "cloud", "detected"
    else:
        where, sources["where"] = "local", "default"

    region = str(server["region"]) if server.get("region") else None
    if region:
        sources["region"] = "override"
    elif cloud and where == "cloud":
        region = next((env[v] for v in _ENV_REGION.get(cloud, ()) if env.get(v)), None)
        sources["region"] = "detected" if region else "default"
    else:
        sources["region"] = "default"

    country = str(server["server_country"]).upper() if server.get("server_country") else None
    if country:
        sources["country"] = "override"
    else:
        country = region_country(region) if where == "cloud" else None
        sources["country"] = "detected" if country else "default"

    if where != "cloud":
        cloud = cloud if sources["cloud"] == "override" else None
        region = region if sources["region"] == "override" else None

    os_name = f"{platform.system() or 'unknown'} {platform.release()}".strip()
    return ServerFacts(where, cloud, region, country, os_name, __version__, sources)


__all__ = ["ServerFacts", "detect", "region_country"]
