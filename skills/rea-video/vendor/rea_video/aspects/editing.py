"""Editing: pace, camera positions, how filmed shots are joined, how much is inserted material.

  camera positions  filmed shots clustered by the colour layout of their background (subject masked out)
  jump cut          two consecutive filmed shots from the same position at the same scale (pauses / fluffs cut out)
  punch-in          same position, subject >= 1.2x bigger or smaller (a crop to change rhythm)
  cuts in pauses    share of cuts between filmed shots that land in a gap of the voice track (cutting on breaths)
  insert share      time not covered by filmed shots: screenshots, recordings, cards, stock, AI shots"""
from __future__ import annotations

import cv2
import numpy as np

from ..i18n import T, semi

from .base import FILMED, Aspect, Field, ShotCtx, field_table, register

SAME_POSITION = 18.0  # mean |diff| of 0..255 BGR cells of the 6x10 background layout


def bg_signature(bgr: np.ndarray, subj: dict | None) -> list[float]:
    small = cv2.resize(bgr, (6, 10), interpolation=cv2.INTER_AREA).astype(np.float32)
    keep = np.ones((10, 6), bool)
    if subj and subj["kind"] != "frame":
        bx, by, bw, bh = subj["box"]
        grow = 0.5 if subj["kind"] == "face" else 0.1
        x0, y0 = max(0, int((bx - grow * bw) * 6)), max(0, int((by - 0.3 * bh) * 10))
        x1 = min(6, int(np.ceil((bx + (1 + grow) * bw) * 6)))
        y1 = 10 if subj["kind"] == "face" else min(10, int(np.ceil((by + 1.1 * bh) * 10)))
        keep[y0:y1, x0:x1] = False
    small[~keep] = -1
    return [round(float(v), 1) for v in small.ravel()]


def _dist(a: list[float], b: list[float]) -> float:
    pairs = [(x, y) for x, y in zip(a or [], b or []) if x >= 0 and y >= 0]
    return float(np.mean([abs(x - y) for x, y in pairs])) if len(pairs) >= 8 else 1e9


def _scale(r: dict) -> float | None:
    m = ((r.get("aspects") or {}).get("framing") or {}).get("measured") or {}
    return m.get("face_h") or (m.get("area") ** 0.5 if m.get("area") else None)


def _in_gap(t: float, segs: list, tol: float = 0.25) -> bool:
    for a, b in segs:
        if a + tol < t < b - tol:
            return False
    return True


class Editing(Aspect):
    def __init__(self):
        super().__init__(key="editing", title="剪辑", title_en="Editing", video_fields=[
            Field("editing", "剪辑手法", "剪气口/跳切、推近放大、多机位切换、插入截图/素材的节奏、转场、卡点", prefer="seen", en="editing style"),
        ])

    def measure(self, ctx: ShotCtx) -> dict:
        if not ctx.frames:
            return {}
        i = len(ctx.frames) // 2
        return {"bg_signature": bg_signature(ctx.frames[i], ctx.subjects[i] if i < len(ctx.subjects) else None)}

    def summarize(self, shots: list[dict], b: dict) -> dict:
        total = sum(r["duration"] for r in shots) or 1.0
        filmed = [r for r in shots if r["base"]["label"] in FILMED]
        f_dur = sum(r["duration"] for r in filmed)
        out = {"cuts_per_min": round(max(0, len(shots) - 1) / (total / 60), 1), "avg_shot_s": round(total / max(1, len(shots)), 2),
               "filmed_share": round(f_dur / total, 3), "insert_share": round(1 - f_dur / total, 3)}
        if not filmed:
            out["lines"] = [T("剪辑：每分钟 {c} 刀，平均镜头 {a}s；没有实拍镜头", "Editing: {c} cuts per minute, {a}s average shot; no live-action shots",
                              c=out["cuts_per_min"], a=out["avg_shot_s"])]
            out["result"] = {}
            return out
        centers: list[list[float]] = []
        pos = {}
        for r in filmed:
            sig = ((r.get("aspects") or {}).get(self.key) or {}).get("measured", {}).get("bg_signature") or []
            d = [(_dist(sig, c), i) for i, c in enumerate(centers)]
            best = min(d) if d else (1e9, -1)
            if best[0] > SAME_POSITION:
                centers.append(sig)
                pos[r["index"]] = len(centers) - 1
            else:
                pos[r["index"]] = best[1]
        share: dict[int, float] = {}
        for r in filmed:
            share[pos[r["index"]]] = share.get(pos[r["index"]], 0.0) + r["duration"]
        n_pos = sum(1 for v in share.values() if v / f_dur >= 0.08)
        jump = punch = in_gap = joins = 0
        voice = ((b.get("audio") or {}).get("voice") or {}).get("segments") or []
        for prev, cur in zip(shots, shots[1:]):
            if prev["base"]["label"] not in FILMED or cur["base"]["label"] not in FILMED:
                continue
            joins += 1
            if voice and _in_gap(cur["start"], voice):
                in_gap += 1
            if pos.get(prev["index"]) != pos.get(cur["index"]):
                continue
            s0, s1 = _scale(prev), _scale(cur)
            if s0 and s1 and max(s0, s1) / min(s0, s1) >= 1.2:
                punch += 1
            else:
                jump += 1
        out.update(positions=n_pos, position_shares=sorted((round(v / f_dur, 3) for v in share.values()), reverse=True)[:5],
                   avg_filmed_shot_s=round(f_dur / len(filmed), 2), jump_cuts=jump, punch_ins=punch,
                   filmed_joins=joins, cuts_in_pauses=round(in_gap / joins, 3) if joins and voice else None,
                   beat_synced=bool((b.get("audio") or {}).get("beat_synced_edit")))
        line = T("剪辑：每分钟 {c} 刀，实拍镜头平均 {a}s；机位/场景 {n} 个；同机位跳切 {j} 处、推近切 {p} 处；插入画面（截图/录屏/卡片/素材）占 {i:.0%}",
                 "Editing: {c} cuts per minute, {a}s average live-action shot; {n} camera set-up(s) / location(s); {j} jump cut(s) and {p} punch-in(s) "
                 "within the same set-up; inserts (screenshots / screen recordings / cards / stock) take {i:.0%}",
                 c=out["cuts_per_min"], a=out["avg_filmed_shot_s"], n=n_pos, j=jump, p=punch, i=out["insert_share"])
        if out["cuts_in_pauses"] is not None and joins >= 3:
            line += (semi() + T("{r:.0%} 的切点落在说话停顿处", "{r:.0%} of cuts land in pauses of the speech", r=out["cuts_in_pauses"])
                     + (T("（剪气口）", " (cutting on breaths)") if out["cuts_in_pauses"] >= 0.6 else ""))
        if out["beat_synced"]:
            line += semi() + T("切镜卡在音乐节拍上", "cuts land on the music beat")
        out["lines"] = [line]
        out["result"] = {"positions": n_pos, "jump_cuts": jump > 0}
        out["fields"] = field_table(self, filmed, b, {})
        return out


register(Editing())
