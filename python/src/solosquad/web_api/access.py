"""Office access policy (decision 41 · PRD v2.1.0 I22 · I24).

Default = internet + login. An office can narrow it with `allowed_networks` (CIDR list —
a private range for an intranet office, a fixed office IP, a VPN range). The engine
listens on 127.0.0.1 behind a reverse proxy on the same VM (W1), so:

- a request whose TCP peer is loopback **and** that carries `X-Forwarded-For` came
  through the proxy — the client is the last address the proxy appended;
- a loopback request without that header is local (the CLI, a browser on the VM) and
  is not subject to `allowed_networks`;
- anything else talked to the engine directly, and its peer address is the client.

Nobody but the local proxy can make the engine believe a forwarded address.
"""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass

from solosquad.layout import AccessPolicy

LOOPBACK = {"127.0.0.1", "::1", "localhost"}


@dataclass(frozen=True)
class Origin:
    address: str
    local: bool
    """True for a loopback peer that did not come through the proxy."""


def origin(peer: str | None, forwarded_for: str | None) -> Origin:
    peer = peer or ""
    if peer in LOOPBACK:
        if forwarded_for:
            hops = [h.strip() for h in forwarded_for.split(",") if h.strip()]
            return Origin(hops[-1] if hops else peer, False)
        return Origin(peer, True)
    return Origin(peer, False)


def parse_networks(items: list[str]) -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    """Raises ValueError on a malformed entry — callers validate before saving."""
    return [ipaddress.ip_network(item.strip(), strict=False) for item in items if item.strip()]


def allowed(policy: AccessPolicy, where: Origin) -> bool:
    if where.local or not policy.allowed_networks:
        return True
    try:
        addr = ipaddress.ip_address(where.address)
    except ValueError:
        return False
    return any(addr in net for net in parse_networks(policy.allowed_networks))
