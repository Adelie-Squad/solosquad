"""Provider eligibility — who may use a provider, and from where (decisions 43 P2 · 45).

A connection records the **legal entity that holds the account** (name · country of
incorporation · country of the controlling company's headquarters). Before a connection
is added and again before it is routed to, these rules decide — deterministically, no
LLM call (decision 35). This applies recorded provider policy; it is not legal advice,
and SoloSquad never masks or changes where a request comes from (§3.3, decision 43).

The rule data holds only what the decisions state, with the sources they cite:

- Anthropic does not serve entities controlled by companies headquartered in unsupported
  regions, wherever they operate (policy update 2025-09) — China among them.
  https://www.anthropic.com/news/updating-restrictions-of-sales-to-unsupported-regions
- OpenAI does not serve China, Hong Kong or Macau.
  https://platform.openai.com/docs/supported-countries
- A server in Hong Kong or mainland China cannot reach either (decision 45).

Region codes are ISO 3166-1 alpha-2. Keep this table short and sourced; a change to a
provider's policy is a change here with its link (K22).
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, Field


class Entity(BaseModel):
    name: str
    country: str = Field(description="ISO country of incorporation, e.g. KR, CN")
    controlled_by: str | None = Field(
        default=None, description="ISO country of the controlling company's headquarters"
    )

    @property
    def control_country(self) -> str:
        return (self.controlled_by or self.country).upper()


@dataclass(frozen=True)
class ProviderRule:
    provider: str
    blocked_regions: frozenset[str]
    """Neither the controlling company's HQ nor the server may sit in these."""
    source: str


RULES: dict[str, ProviderRule] = {
    "anthropic": ProviderRule(
        "anthropic",
        frozenset({"CN", "HK", "MO"}),
        "https://www.anthropic.com/news/updating-restrictions-of-sales-to-unsupported-regions",
    ),
    "openai": ProviderRule(
        "openai",
        frozenset({"CN", "HK", "MO"}),
        "https://platform.openai.com/docs/supported-countries",
    ),
}

# Harnesses and model prefixes that mean a provider, whatever the connection calls itself
# (an OpenRouter key reaching `anthropic/claude-…` is still Anthropic's model).
HARNESS_PROVIDER = {"claude-code": "anthropic", "codex": "openai"}
MODEL_PREFIX = {"anthropic/": "anthropic", "claude": "anthropic", "openai/": "openai"}


def providers_reached(provider: str, harness: str, models: list[str]) -> set[str]:
    found = {provider.lower()} & RULES.keys()
    if harness in HARNESS_PROVIDER:
        found.add(HARNESS_PROVIDER[harness])
    for model in models:
        for prefix, prov in MODEL_PREFIX.items():
            if model.lower().startswith(prefix):
                found.add(prov)
    return found


@dataclass(frozen=True)
class Verdict:
    ok: bool
    reason: str = ""
    source: str = ""
    provider: str = ""
    """The provider that refuses — with `country`, what the web puts in its own words."""
    country: str = ""
    by: str = ""
    """`entity` (the holder is controlled from `country`) or `server` (the server is there)."""


def judge(
    provider: str,
    harness: str,
    models: list[str],
    entity: Entity | None,
    server_country: str | None,
) -> Verdict:
    """Unknown entity or server location → allowed (recorded as unknown, `validate` warns)."""
    for prov in sorted(providers_reached(provider, harness, models)):
        rule = RULES[prov]
        if entity is not None and entity.control_country in rule.blocked_regions:
            return Verdict(
                False,
                f"{prov} does not serve entities controlled from {entity.control_country}"
                f" ({entity.name})",
                rule.source,
                prov,
                str(entity.control_country),
                "entity",
            )
        if server_country and server_country.upper() in rule.blocked_regions:
            return Verdict(
                False, f"{prov} is not reachable from a server in {server_country.upper()}",
                rule.source, prov, server_country.upper(), "server",
            )  # fmt: skip
    return Verdict(True)
