"""Framing: shot size, where the subject sits, camera angle.

Shot size is measured from the face height when there is a face (reliable), else estimated from the in-focus
subject's area (rough: a hand on a desk and a product close-up can both fill the frame); camera angle comes from
the image readers."""
from __future__ import annotations

import numpy as np

from ..i18n import LangDict, T, join, semi

from .base import FILMED, PHOTOGRAPHIC, Aspect, Field, ShotCtx, field_table, register, seen, weighted_mode

SIZES = LangDict({"ecu": "大特写", "cu": "特写", "mcu": "近景", "ms": "中景", "fs": "全景", "ls": "远景"},
                 en={"ecu": "extreme close-up", "cu": "close-up", "mcu": "medium close-up", "ms": "medium shot", "fs": "full shot",
                     "ls": "wide shot"})
# face height / frame height
FACE_SIZES = [(0.40, "ecu"), (0.25, "cu"), (0.14, "mcu"), (0.08, "ms"), (0.04, "fs"), (0.0, "ls")]
# in-focus subject area / frame area
AREA_SIZES = [(0.45, "cu"), (0.22, "mcu"), (0.08, "ms"), (0.0, "fs")]


def size_from(table, v: float | None) -> str | None:
    if v is None:
        return None
    return SIZES[next(name for th, name in table if v >= th)]


def shot_size(face_h: float | None) -> str | None:
    return size_from(FACE_SIZES, face_h)


class Framing(Aspect):
    def __init__(self):
        super().__init__(key="framing", title="取景", title_en="Framing", shot_fields=[
            Field("shot_size", "景别", "特写|近景|中景|全景|远景（按画面主体，人物按头肩/半身/全身）", en="shot size"),
            Field("camera_angle", "机位角度", "平视|略俯拍|俯拍|顶拍（正上方俯拍桌面）|略仰拍|仰拍", prefer="seen", en="camera angle"),
            Field("composition", "构图", "主体位置与留白（居中/三分线/对称/框中框），竖屏还是横屏", prefer="seen", en="composition"),
        ])

    def measure(self, ctx: ShotCtx) -> dict:
        subs = [s for s in ctx.subjects if s]
        if not subs:
            return {}
        kinds = [s["kind"] for s in subs]
        kind = max(dict.fromkeys(kinds), key=kinds.count)
        use = [s for s in subs if s["kind"] == kind]
        hs = [s["box"][3] for s in use]
        cx = float(np.median([s["box"][0] + s["box"][2] / 2 for s in use]))
        cy = float(np.median([s["box"][1] + s["box"][3] / 2 for s in use]))
        area = float(np.median([s["area"] for s in use]))
        out = {"subject": kind, "subject_share": round(len(use) / max(1, len(ctx.subjects)), 3),
               "center_x": round(cx, 3), "center_y": round(cy, 3), "area": round(area, 3)}
        if kind == "face":
            fh = float(np.median(hs))
            out.update(face_h=round(fh, 3), face_h_spread=round(float(np.std(hs)), 3), shot_size=shot_size(fh),
                       headroom=round(float(np.median([s["box"][1] for s in use])), 3))
        elif kind == "focus":
            out["shot_size"] = size_from(AREA_SIZES, area)
            out["shot_size_rough"] = True
        out["position"] = T("居中", "centred") if abs(cx - 0.5) < 0.12 else (T("偏左", "left of centre") if cx < 0.5 else T("偏右", "right of centre"))
        return out

    def interpret(self, shot: dict) -> dict:
        m = ((shot.get("aspects") or {}).get(self.key) or {}).get("measured") or {}
        s = seen(shot, self.key, "shot_size")
        size = m.get("shot_size") if m.get("subject") == "face" else (s.get("agent") or s.get("vlm") or m.get("shot_size"))
        ang = seen(shot, self.key, "camera_angle")
        from .vocab import show

        return {"shot_size": show(size), "camera_angle": show(ang.get("agent") or ang.get("vlm")), "position": m.get("position"),
                "subject": m.get("subject")}

    def summarize(self, shots: list[dict], b: dict) -> dict:
        main = [r for r in shots if r["base"]["label"] in FILMED] or [r for r in shots if r["base"]["label"] in PHOTOGRAPHIC]
        if not main:
            return {}
        tot = sum(r["duration"] for r in main)
        res = {r["index"]: (r.get("aspects") or {}).get(self.key, {}).get("result") or {} for r in main}
        size, sizes = weighted_mode([(res[r["index"]].get("shot_size"), r["duration"]) for r in main])
        angle, angles = weighted_mode([(res[r["index"]].get("camera_angle"), r["duration"]) for r in main])
        subj, subjects = weighted_mode([(res[r["index"]].get("subject"), r["duration"]) for r in main])
        lines = [T("取景：景别 ", "Framing: shot size ") + (join(f"{k} {v:.0%}" for k, v in list(sizes.items())[:3] if v >= 0.01) or T("未测出", "not measured"))
                 + (semi() + T("机位角度 {a}", "camera angle {a}", a=angle) if angle else "")
                 + {"face": semi() + T("主体是人脸（按脸高算景别）", "subject is a face (shot size from face height)"),
                    "focus": semi() + T("主体是画面清晰区域（没有人脸，景别为估算）", "subject is the in-focus region (no face; shot size is an estimate)"),
                    "frame": semi() + T("没找到明确主体", "no clear subject found")}.get(subj, "")]
        return {"result": {"shot_size": size, "camera_angle": angle, "subject": subj},
                "shot_sizes": sizes, "angles": angles, "subjects": subjects, "seconds": round(tot, 2), "lines": lines,
                "fields": field_table(self, main, b, {"shot_size": size})}


register(Framing())
