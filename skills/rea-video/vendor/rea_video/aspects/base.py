"""Aspect framework: one production question ("how was it lit?", "how was it framed?") end to end.

An aspect owns every step for its question, so adding a new one (composition, wardrobe, props, colour grade ...)
means adding one module and registering it, without touching the pipeline, prompts, review, report or eval:

  measure(ctx)          per shot, deterministic, from pixels / features      -> rec["aspects"][key]["measured"]
  shot_fields           questions the VLM and the reviewing agent answer per shot (what pixels cannot settle)
  video_fields          questions about the whole video (whole-video VLM pass, review answers "aspects")
  interpret(shot)       per-shot reading in plain words                       -> rec["aspects"][key]["result"]
  summarize(shots, b)   video-level result: `result` (comparable values for eval), `lines`, `fields`, extras
  check(gt, summary)    eval: {field: accepted value(s)} against summary["result"]

Sources are kept apart and shown side by side: `measured` (tools), `vlm`, `agent`. A field marked
`prefer="seen"` takes the image readers' answer (agent before VLM); `prefer="measured"` keeps the measurement and
lists what the readers said next to it. Nothing is averaged across sources."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from ..i18n import T

# shots whose picture is photographic enough for camera / light analysis. Live action gets a shooting plan; AI, 3D
# and avatar shots get the same measurements as a description of the picture (useful for generation prompts).
PHOTOGRAPHIC = ("live_action", "avatar", "ai_video", "cg_3d", "stop_motion", "film_footage")
FILMED = ("live_action", "avatar", "stop_motion", "film_footage")


@dataclass
class Field:
    key: str
    zh: str                       # label; reads as `en` when the report language is English (see _lang_attr)
    question: str                 # shown to the VLM / reviewer; empty = measured only
    prefer: str = "measured"      # "measured" | "seen"
    en: str = ""


@dataclass
class ShotCtx:
    """Everything an aspect may measure from, for one shot."""
    frames: list                  # sampled BGR frames (analysis width)
    subjects: list                # per sampled frame: subject dict or None (see aspects.subject)
    features: dict                # forensic features of the shot (motion, texture, ...)
    duration: float


@dataclass
class Aspect:
    key: str = ""
    title: str = ""               # reads as `title_en` when the report language is English
    title_en: str = ""
    shot_fields: list[Field] = field(default_factory=list)
    video_fields: list[Field] = field(default_factory=list)

    # ---- per shot ----------------------------------------------------------------------------
    def measure(self, ctx: ShotCtx) -> dict:
        return {}

    def interpret(self, shot: dict) -> dict:
        """Plain-language reading of one shot; default: measured values + what the readers saw."""
        return {}

    # ---- per video ---------------------------------------------------------------------------
    def summarize(self, shots: list[dict], b: dict) -> dict:
        return {}

    def check(self, gt: dict, summary: dict) -> dict[str, bool]:
        res = (summary or {}).get("result") or {}
        out = {}
        for k, want in gt.items():
            acc = want if isinstance(want, list) else [want]
            out[k] = res.get(k) in acc
        return out


def _lang_attr(cls, name: str, en_name: str) -> None:
    """Make `cls.<name>` (set once, in Chinese) read as `cls.<en_name>` when the report language is English."""
    def get(self):
        return T(self.__dict__[name], self.__dict__.get(en_name) or None)

    def set(self, v):
        self.__dict__[name] = v
    setattr(cls, name, property(get, set))


_lang_attr(Field, "zh", "en")
_lang_attr(Aspect, "title", "title_en")

REGISTRY: list[Aspect] = []


def register(a: Aspect) -> Aspect:
    if not any(x.key == a.key for x in REGISTRY):
        REGISTRY.append(a)
    return a


def get(key: str) -> Aspect | None:
    return next((a for a in REGISTRY if a.key == key), None)


# ---------------------------------------------------------------- what the image readers said ----

def _fields_of(answers, aspect: str) -> dict:
    """One aspect's answers. A model sometimes answers a whole aspect with a bare sentence instead of its
    fields; that reads as "no answer" here, since a stored answer is read again on every later run."""
    got = answers.get(aspect) if isinstance(answers, dict) else None
    return got if isinstance(got, dict) else {}


def seen(shot: dict, aspect: str, field_key: str) -> dict[str, str]:
    """{"agent": ..., "vlm": ...} for one field of one shot. Also reads the older flat `cinematography` answers."""
    out = {}
    for src, rk in (("agent", "review"), ("vlm", "vlm")):
        r = shot.get(rk) or {}
        v = _fields_of(r.get("aspects"), aspect).get(field_key) or _fields_of(r, "cinematography").get(field_key)
        if v and str(v).strip().lower() not in ("不适用", "unknown", "无法判断", "n/a", "not applicable"):
            out[src] = str(v).strip()
    return out


def video_seen(b: dict, aspect: str, field_key: str) -> dict[str, str]:
    out = {}
    rv = _fields_of(b.get("review_aspects"), aspect).get(field_key)
    if rv:
        out["agent"] = str(rv)
    wv = _fields_of(_fields_of(b, "whole_video_vlm").get("aspects"), aspect).get(field_key)
    if wv:
        out["vlm"] = str(wv)
    return out


def pick(sources: dict[str, str], measured=None, prefer: str = "measured"):
    """Final value of a field from its sources."""
    if prefer == "seen":
        return sources.get("agent") or sources.get("vlm") or measured
    return measured if measured is not None else (sources.get("agent") or sources.get("vlm"))


def mode_seen(shots: list[dict], aspect: str, field_key: str) -> dict[str, str]:
    """Most common answer per source across shots, weighted by duration."""
    out = {}
    for src in ("agent", "vlm"):
        c: Counter = Counter()
        for r in shots:
            v = seen(r, aspect, field_key).get(src)
            if v:
                c[v] += r["duration"]
        if c:
            out[src] = c.most_common(1)[0][0]
    return out


def field_table(aspect: Aspect, shots: list[dict], b: dict, measured: dict) -> list[dict]:
    """One row per field: measured value, what the VLM / agent said, final value."""
    rows = []
    for f in aspect.shot_fields + aspect.video_fields:
        src = {**mode_seen(shots, aspect.key, f.key), **video_seen(b, aspect.key, f.key)} if f in aspect.shot_fields \
            else video_seen(b, aspect.key, f.key)
        m = measured.get(f.key)
        final = pick(src, m, f.prefer)
        if final is None:
            continue
        rows.append({"key": f.key, "zh": f.zh, "measured": m, "vlm": src.get("vlm"), "agent": src.get("agent"), "final": final})
    return rows


def weighted_median(pairs: list[tuple[float, float]]) -> float | None:
    """(value, weight) pairs -> weighted median."""
    pairs = [(v, w) for v, w in pairs if v is not None]
    if not pairs:
        return None
    pairs.sort()
    cw = np.cumsum([w for _, w in pairs])
    return float(pairs[int(np.searchsorted(cw, cw[-1] / 2))][0])


def weighted_mode(pairs: list[tuple[str, float]]) -> tuple[str | None, dict[str, float]]:
    c: Counter = Counter()
    for v, w in pairs:
        if v:
            c[v] += w
    tot = sum(c.values()) or 1.0
    share = {k: round(v / tot, 3) for k, v in c.most_common()}
    return (c.most_common(1)[0][0] if c else None), share
