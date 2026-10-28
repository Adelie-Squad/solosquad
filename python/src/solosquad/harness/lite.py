"""`lite` — our own tool-less loop over an OpenAI-compatible chat endpoint (decision 24).

Only for short jobs without tools: classification, summarisation, routing judgements.
Anything that needs tools runs through a CLI harness instead.
"""

from __future__ import annotations

import asyncio
import json
import urllib.request
from collections.abc import AsyncIterator
from typing import Any

from solosquad.harness.base import AuthStatus, BaseHarness, Capabilities, SpawnRequest
from solosquad.harness.events import End, Error, LlmStreamEvent, Start, TextDelta, Usage


class LiteHarness(BaseHarness):
    name = "lite"
    capabilities = Capabilities(max_context_tokens=32_000, supports_mcp=False, supports_tools=False)

    def __init__(
        self, base_url: str, api_key: str | None, default_model: str | None = None
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.default_model = default_model

    def _post(self, payload: dict[str, Any], timeout: float | None) -> dict[str, Any]:
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                **({"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}),
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout or 120) as resp:
            body: dict[str, Any] = json.loads(resp.read())
            return body

    async def spawn(self, request: SpawnRequest) -> AsyncIterator[LlmStreamEvent]:
        model = request.model or self.default_model
        messages = []
        if request.system_prompt:
            messages.append({"role": "system", "content": request.system_prompt})
        messages.append({"role": "user", "content": request.prompt})
        payload: dict[str, Any] = {"model": model, "messages": messages, "usage": {"include": True}}
        yield Start(model=model)
        try:
            body = await asyncio.to_thread(self._post, payload, request.timeout_s)
        except Exception as e:  # HTTP and network errors alike — the router decides
            status = getattr(e, "code", None)
            yield Error(f"lite request failed: {e}", retryable=status in (None, 429, 500, 502, 503))
            yield End(stop_reason="error")
            return
        choice = (body.get("choices") or [{}])[0]
        text = (choice.get("message") or {}).get("content") or ""
        if text:
            yield TextDelta(text)
        u = body.get("usage") or {}
        cost = u.get("cost")
        yield End(
            stop_reason=choice.get("finish_reason"),
            usage=Usage(
                input_tokens=int(u.get("prompt_tokens") or 0),
                output_tokens=int(u.get("completion_tokens") or 0),
            ),
            cost_usd=float(cost) if isinstance(cost, int | float) else None,
            result_text=text,
        )

    async def auth_status(self) -> AuthStatus:
        return AuthStatus(
            bool(self.api_key) or "localhost" in self.base_url, {"base_url": self.base_url}
        )
