"""State channels inferred from the state schema — LastValue or a reducer (`Annotated[T, op]`)."""

from __future__ import annotations

import typing
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, get_args, get_origin, get_type_hints

from solosquad.graph.types import InvalidUpdateError

_MISSING: Any = object()


@dataclass
class ChannelSpec:
    key: str
    reducer: Callable[[Any, Any], Any] | None
    default_factory: Callable[[], Any] | None

    def initial(self) -> Any:
        if self.reducer is not None and self.default_factory is not None:
            try:
                return self.default_factory()
            except Exception:
                return _MISSING
        return _MISSING

    def apply(self, current: Any, writes: list[Any]) -> Any:
        if not writes:
            return current
        if self.reducer is None:
            if len(writes) > 1:
                raise InvalidUpdateError(
                    f"At key '{self.key}': Can receive only one value per step. "
                    "Use an Annotated key to handle multiple values."
                )
            return writes[0]
        value = current
        for w in writes:
            value = w if value is _MISSING else self.reducer(value, w)
        return value


def channels_from_schema(schema: Any) -> dict[str, ChannelSpec]:
    hints = get_type_hints(schema, include_extras=True)
    out: dict[str, ChannelSpec] = {}
    for key, hint in hints.items():
        reducer: Callable[[Any, Any], Any] | None = None
        base = hint
        if get_origin(hint) is typing.Annotated:
            base, *meta = get_args(hint)
            for m in meta:
                if callable(m):
                    reducer = m
                    break
        origin = get_origin(base) or base
        factory = origin if isinstance(origin, type) else None
        out[key] = ChannelSpec(key, reducer, factory)
    return out
