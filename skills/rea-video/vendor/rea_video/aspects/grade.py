"""Colour grade: saturation, contrast, black / white level, warm-cool split; then a named look.

Measured on the whole frame (a grade is applied to the whole picture, not the subject):
  sat          mean saturation of pixels that are not near-black (0-1)
  contrast     standard deviation of L* / 100
  black/white  2nd / 98th percentile of L* (0-100): a lifted black is the "film / faded" look
  shadow_b / highlight_b   Lab b* of the near-neutral pixels in the darkest / brightest 20%: blue shadows + warm
                           highlights = teal-orange (coloured objects are left out so they cannot fake it)
  mean_l, bright_share, dark_share   exposure of the whole frame (high-key / low-key, used by lighting)
  bright_sat, hue_bins     saturation of the bright pixels and how many distinct hues they spread over
                           (several saturated hues in the light = RGB / neon practicals, used by lighting)
Platform transcodes flatten saturation a little and crush blacks; lifted blacks survive them."""
from __future__ import annotations

import cv2
import numpy as np

from ..i18n import T, join, semi

from .base import PHOTOGRAPHIC, Aspect, Field, ShotCtx, field_table, register, weighted_median

MEASURES = ("sat", "contrast", "black", "white", "shadow_b", "highlight_b", "mean_b", "mean_l", "bright_share", "dark_share",
            "bright_sat", "hue_bins")


def _tint(b: np.ndarray, mask: np.ndarray) -> float:
    return float(b[mask].mean()) if mask.sum() > 0.02 * mask.size else 0.0


def frame_grade(bgr: np.ndarray) -> dict:
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    L = lab[..., 0] * (100.0 / 255.0)
    b = lab[..., 2] - 128.0
    v, s, h = hsv[..., 2], hsv[..., 1].astype(np.float32) / 255.0, hsv[..., 0]
    lit = v > 40
    lo, hi = np.percentile(L, 20), np.percentile(L, 80)
    # a grade tints the near-neutral pixels; coloured objects (a blue cup in the shadows) would fake a teal-orange split
    # (Lab chroma, not HSV saturation: HSV calls any slightly tinted dark pixel "saturated")
    neutral = np.hypot(lab[..., 1] - 128.0, b) < 20
    out = {"sat": float(s[lit].mean()) if lit.any() else 0.0, "contrast": float(L.std() / 100.0),
           "black": float(np.percentile(L, 2)), "white": float(np.percentile(L, 98)),
           "shadow_b": _tint(b, (L <= lo) & (L > 3) & neutral), "highlight_b": _tint(b, (L >= hi) & neutral), "mean_b": float(b.mean()),
           "mean_l": float(L.mean()), "bright_share": float((L > 80).mean()), "dark_share": float((L < 11).mean()),
           "bright_sat": float(s[v > 150].mean()) if (v > 150).any() else 0.0, "hue_bins": 0}
    vivid = (v > 120) & (s > 0.5)
    if vivid.sum() > 0.01 * vivid.size:
        hist = np.bincount((h[vivid] // 15).ravel(), minlength=12).astype(np.float32)
        out["hue_bins"] = int((hist / hist.sum() > 0.12).sum())
    return out


def measure_frames(frames: list) -> dict:
    per = [frame_grade(f) for f in frames if f is not None]
    if not per:
        return {}
    return {k: round(float(np.median([m[k] for m in per])), 3) for k in MEASURES}


def words(m: dict) -> dict:
    if not m:
        return {}
    sat, con, black = m["sat"], m["contrast"], m["black"]
    sat_w = (T("接近黑白", "near monochrome") if sat < 0.06 else T("低饱和", "low saturation") if sat < 0.2
             else T("高饱和", "high saturation") if sat > 0.45 else T("饱和度正常", "normal saturation"))
    con_w = T("低对比", "low contrast") if con < 0.16 else T("高对比", "high contrast") if con > 0.28 else T("对比正常", "normal contrast")
    lifted = black > 12
    split = m["shadow_b"] < -5 and m["highlight_b"] > 8  # strict: dark blue / green objects tint shadows a little too
    warm = m["mean_b"] > 12
    tone = T("偏暖", "warm") if warm else T("偏冷", "cool") if m["mean_b"] < 2 else T("中性", "neutral")
    if sat < 0.06:
        look = T("黑白", "black and white")
    elif split:
        look = T("青橙电影感（暗部偏青、亮部偏暖）", "teal-orange cinematic (teal shadows, warm highlights)")
    elif lifted and m["mean_l"] > 55 and sat < 0.3:
        look = T("日系清新（明亮、低饱和、黑位抬高）", "airy Japanese-style (bright, low saturation, lifted blacks)")
    elif lifted and warm:
        look = T("复古胶片（黑位抬高、偏暖）", "vintage film (lifted blacks, warm)")
    elif m["mean_l"] < 35 and sat < 0.3:
        look = T("暗调低饱和（电影感）", "dark and desaturated (cinematic)")
    elif sat > 0.45 and con > 0.2:
        look = T("高饱和鲜艳", "vivid, high saturation")
    else:
        look = T("自然（接近原色）", "natural (close to the original colours)")
    return {"look": look, "saturation": sat_w, "contrast": con_w,
            "black": T("黑位抬高（发灰的暗部）", "lifted blacks (greyish shadows)") if lifted else T("黑位正常", "normal blacks"), "tone": tone}


class Grade(Aspect):
    def __init__(self):
        super().__init__(key="grade", title="调色", title_en="Grade", shot_fields=[
            Field("color_grade", "调色风格", "调色风格：自然 / 青橙电影感 / 日系清新 / 复古胶片 / 黑白 / 高饱和 / 暗调…，写依据（暗部颜色、黑位、饱和度）",
                  prefer="measured", en="colour grade"),
        ], video_fields=[
            Field("grade_overall", "整体调色", "整片调色风格，是否用了 LUT / 滤镜（剪映滤镜、胶片模拟），不同段落是否不同", prefer="seen", en="overall grade"),
        ])

    def measure(self, ctx: ShotCtx) -> dict:
        return measure_frames(ctx.frames)

    def interpret(self, shot: dict) -> dict:
        m = ((shot.get("aspects") or {}).get(self.key) or {}).get("measured") or {}
        return words(m)

    def summarize(self, shots: list[dict], b: dict) -> dict:
        main = [r for r in shots if r["base"]["label"] in PHOTOGRAPHIC
                and ((r.get("aspects") or {}).get(self.key) or {}).get("measured")]
        if not main:
            return {}
        ms = [(r["aspects"][self.key]["measured"], r["duration"]) for r in main]
        med = {k: weighted_median([(m.get(k), w) for m, w in ms]) for k in MEASURES}
        w = words(med)
        lines = [T("调色：{l}", "Grade: {l}", l=w["look"]) + semi() + join((w["saturation"], w["contrast"], w["black"], T("整体{t}", "overall {t}", t=w["tone"])))]
        return {"result": {"look": w["look"].split("（")[0].split(" (")[0]}, "measured": {k: round(v, 3) for k, v in med.items() if v is not None},
                "words": w, "lines": lines, "fields": field_table(self, main, b, {"color_grade": w["look"]})}


register(Grade())
