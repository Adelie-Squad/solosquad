"""Checkpoint serialization: JSON with tags for engine types; pickle only as a last resort.

Checkpoints live on the customer's own server (decision 37), written and read by the same
engine — the pickle fallback trades portability for not refusing user-defined state.
"""

from __future__ import annotations

import base64
import json
import pickle
from typing import Any

from solosquad.graph.types import Command, Interrupt, Send
from solosquad.messages import Message

TAG = "__ss__"


def _encode(obj: Any) -> Any:
    if obj is None or isinstance(obj, bool | int | float | str):
        return obj
    if isinstance(obj, list):
        return [_encode(x) for x in obj]
    if isinstance(obj, dict) and all(isinstance(k, str) for k in obj):
        return {k: _encode(v) for k, v in obj.items()}
    if isinstance(obj, tuple):
        return {TAG: "tuple", "items": [_encode(x) for x in obj]}
    if isinstance(obj, Message):
        return {TAG: "message", "data": obj.to_dict()}
    if isinstance(obj, Send):
        return {TAG: "send", "node": obj.node, "arg": _encode(obj.arg)}
    if isinstance(obj, Interrupt):
        return {TAG: "interrupt", "value": _encode(obj.value), "id": obj.id}
    if isinstance(obj, Command):
        return {
            TAG: "command",
            "graph": obj.graph,
            "update": _encode(obj.update),
            "resume": _encode(obj.resume),
            "goto": _encode(obj.goto_list()),
        }
    return {TAG: "pickle", "b64": base64.b64encode(pickle.dumps(obj)).decode()}


def _decode(obj: Any) -> Any:
    if isinstance(obj, list):
        return [_decode(x) for x in obj]
    if isinstance(obj, dict):
        tag = obj.get(TAG)
        if tag is None:
            return {k: _decode(v) for k, v in obj.items()}
        if tag == "tuple":
            return tuple(_decode(x) for x in obj["items"])
        if tag == "message":
            return Message.from_dict(obj["data"])
        if tag == "send":
            return Send(obj["node"], _decode(obj["arg"]))
        if tag == "interrupt":
            return Interrupt(_decode(obj["value"]), obj["id"])
        if tag == "command":
            return Command(
                graph=obj["graph"],
                update=_decode(obj["update"]),
                resume=_decode(obj["resume"]),
                goto=_decode(obj["goto"]),
            )
        if tag == "pickle":
            return pickle.loads(base64.b64decode(obj["b64"]))  # own checkpoints only
        raise ValueError(f"unknown serde tag {tag!r}")
    return obj


def dumps(obj: Any) -> str:
    return json.dumps(_encode(obj), ensure_ascii=False)


def loads(text: str) -> Any:
    return _decode(json.loads(text))
