"""Round 3 — ㅈ + ㅅ as ONE rounded line (Meta-like qualities: monoline, round ends, soft loops).

Only the qualities of that logo are borrowed (one unbroken round stroke, even weight, smooth turns,
a crossing). Not its infinity / Möbius form.

    python3 identity/_drafts/jesl-logo/scripts/draw_round3.py sketch   # -> sketch-3/
    python3 identity/_drafts/jesl-logo/scripts/draw_round3.py          # -> svg/r3-*.svg
"""

from __future__ import annotations

import math
import sys

import draw as D
from geom import move, svg
from pen import Pen, bbox, outline

NOTE = "JESL logo draft round 3 (exploration, not final). One rounded line from ㅈ + ㅅ, code-drawn."
T = 36.0  # stroke in design units (symbols are designed ~200 tall -> 18 %)


def fit(strokes: list[list[tuple]], t: float, box: float = 256, inner: float = 208,
        bias_up: float = 4.0) -> list[str]:
    """Outline strokes and fit them centred in a box (optical centre a little above)."""
    x0, y0, x1, y1 = bbox(strokes, t)
    paths = [outline(s, t, y1) for s in strokes]  # y' = y1 - y  (top = 0)
    w, h = x1 - x0, y1 - y0
    s = inner / max(w, h)
    return move(paths, (box - w * s) / 2 - x0 * s, (box - h * s) / 2 - bias_up, s)


# ---------------------------------------------------------------- symbol sketches


def loop_j(leg: float = 100, a: float = 84, r: float = 26, ang: float = 60) -> list[list[tuple]]:
    """고리 ㅈ — left leg up, a loop over the top whose upper edge is ㅈ's bar, cross, right leg down.
    The crossing is the apex of 人 (= ㅅ): without the loop it is ㅅ, with it ㅈ."""
    turn = 180 - ang  # from heading `ang` to heading 180 (the bar, leftwards)
    b = 2 * (a * math.cos(math.radians(ang)) + r * math.sin(math.radians(turn)) - r * 0)
    # bar length so the figure is symmetric: centre of bar above the crossing
    qx = a * math.cos(math.radians(ang))
    cx = qx + r * math.cos(math.radians(ang + 90))
    bar = 2 * cx
    p = Pen(-leg * math.cos(math.radians(ang)), 0, ang)
    p.line(leg + a).arc(r, turn).line(max(bar, 0.1)).arc(r, turn).line(a + leg)
    _ = b
    return [p.segs]


def loop_round(leg: float = 96, r: float = 40, ang: float = 60) -> list[list[tuple]]:
    """The loop as a full round head (240 deg) instead of a bar."""
    a = math.sqrt(3) * r if ang == 60 else r / math.tan(math.radians((180 - ang) / 2 - 0))
    p = Pen(-leg * math.cos(math.radians(ang)), 0, ang)
    p.line(leg + a).arc(r, 360 - 2 * ang).line(a + leg)
    return [p.segs]


def loop_j_s(leg: float = 100, a: float = 84, r: float = 26, ang: float = 60, vr: float = 34,
             rise: float = 150) -> list[list[tuple]]:
    """고리 ㅈ + ㅅ — after ㅈ's right leg, a round valley and a second peak (ㅅ), one line."""
    turn = 180 - ang
    qx = a * math.cos(math.radians(ang))
    bar = 2 * (qx + r * math.cos(math.radians(ang + 90)))
    p = Pen(-leg * math.cos(math.radians(ang)), 0, ang)
    p.line(leg + a).arc(r, turn).line(max(bar, 0.1)).arc(r, turn).line(a + leg - 30)
    p.arc(vr, 2 * ang)  # valley: from heading -60 (300) to +60
    p.line(rise).arc(vr, -2 * ang).line(rise)  # ㅅ apex (right turn), down
    return [p.segs]


def seven_wave(ang: float = 60, r: float = 30) -> list[list[tuple]]:
    """7 + ㅅ — ㅈ written like a 7 (bar then the left leg), a valley, then ㅅ: one zigzag line."""
    p = Pen(0, 200, 0)
    p.line(70).arc(r, -(180 - ang)).line(150).arc(r, 2 * ang).line(150).arc(r, -2 * ang).line(150)
    return [p.segs]


def ridge_back(ang: float = 60, r: float = 30) -> list[list[tuple]]:
    """ㅅ whose right leg turns back underneath (ㅡ): the road that turns behind — 슬's ㅅ + ㅡ."""
    p = Pen(0, 0, ang)
    p.line(170).arc(r, -2 * ang).line(150).arc(40, -(180 - ang)).line(150)
    return [p.segs]


def loop_tilt(leg_l: float = 120, leg_r: float = 80, a: float = 90, r: float = 28) -> list[list[tuple]]:
    """An asymmetric loop ㅈ: longer left leg, the loop leaning right — the line in motion."""
    p = Pen(0, 0, 62)
    p.line(leg_l + a).arc(r, 118).line(60).arc(r, 122).line(a + leg_r)
    return [p.segs]


def _peak_rise(ra: float, ang: float) -> float:
    """How far a round apex (right turn of 2*ang) rises above the end of the climbing leg."""
    return ra * (1 - math.cos(math.radians(ang)))


def turn_back(l1: float = 150, ang: float = 60, ra: float = 26, rf: float = 30, r2: float = 46,
              gap_k: float = 1.55, bar_to: float | None = None) -> list[list[tuple]]:
    """돌아 오르는 ㅈ — ㅅ (up, round apex, down), then the line turns back up at the right and
    runs over the top as ㅈ's bar. One line, no crossing: ㅅ + the road that turns behind = ㅈ."""
    p = Pen(0, 0, ang)
    p.line(l1)
    y_peak = p.y + _peak_rise(ra, ang)
    p.arc(ra, -2 * ang).line(l1)
    p.arc(rf, 150)  # heading 300 -> 90: turn up at the right foot
    bar_y = y_peak + T * gap_k
    u = bar_y - r2 - p.y
    p.line(max(u, 1)).arc(r2, 90)  # heading 180: the bar, leftwards
    end_x = bar_to if bar_to is not None else 0.0
    p.line(max(p.x - end_x, 1))
    return [p.segs]


def bar_ridges(l1: float = 120, ang: float = 60, ra: float = 24, rv: float = 26, rc: float = 40,
               rf: float = 22, gap_k: float = 1.5, peaks: int = 2, k: float = 30) -> list[list[tuple]]:
    """ㅈㅅ 능선 — ㅈ's bar runs left, curls down the left side, and the line climbs round peaks
    (ㅈ's 人, then ㅅ). One line; the bar is the road taken back first."""
    s, c = math.sin(math.radians(ang)), math.cos(math.radians(ang))
    gap = T * gap_k
    drop = l1 * s + _peak_rise(ra, ang) + gap - rc - 0.5 * rf
    bar_len = 1.866 * rf - rc + l1 * c + k
    p = Pen(0, 0, 180)
    p.line(bar_len).arc(rc, 90).line(max(drop, 1)).arc(rf, 90 + ang)
    for i in range(peaks):
        p.line(l1).arc(ra, -2 * ang).line(l1)
        if i < peaks - 1:
            p.arc(rv, 2 * ang)
    return [p.segs]


def twist_back(l1: float = 150, ang: float = 60, ra: float = 30, rl: float = 34, r2: float = 40,
               gap_k: float = 1.5, bar_to: float = 10) -> list[list[tuple]]:
    """꼬아 오르는 ㅈ — ㅅ, then at the right foot the line loops under itself (clockwise), rises
    through its own leg (the one crossing) and runs back over the top as the bar."""
    p = Pen(0, 0, ang)
    p.line(l1)
    y_peak = p.y + _peak_rise(ra, ang)
    p.arc(ra, -2 * ang).line(l1)
    p.arc(rl, -(360 - 2 * ang - 90 + 60))  # 300 -> 90 turning right (210 deg): under and up
    bar_y = y_peak + T * gap_k
    u = bar_y - r2 - p.y
    p.line(max(u, 1)).arc(r2, 90)
    p.line(max(p.x - bar_to, 1))
    return [p.segs]


SKETCH = {
    "s1-loop-bar": lambda: (loop_j(), T),
    "s2-loop-round": lambda: (loop_round(), T),
    "s3-loop-plus-s": lambda: (loop_j_s(), T),
    "s4-seven-wave": lambda: (seven_wave(), T),
    "s5-ridge-back": lambda: (ridge_back(), T),
    "s6-loop-tilt": lambda: (loop_tilt(), T),
    "s7-loop-bar-wide": lambda: (loop_j(leg=90, a=96, r=30, ang=56), T),
    "s8-loop-bar-bold": lambda: (loop_j(), T * 1.25),
    "i3-turn-back": lambda: (turn_back(), T),
    "i3b-turn-back-short-bar": lambda: (turn_back(bar_to=40), T),
    "i3c-turn-back-steep": lambda: (turn_back(l1=170, ang=66, r2=40), T),
    "i4-bar-ridges": lambda: (bar_ridges(), T),
    "i4b-bar-ridge-one": lambda: (bar_ridges(peaks=1), T),
    "i3d-turn-back-round": lambda: (turn_back(ra=48, bar_to=30, r2=52), T * 1.1),
    "i4c-bar-ridges-long": lambda: (bar_ridges(k=95, ra=34, rv=34), T * 1.15),
    "i5-twist-back": lambda: (twist_back(), T),
    "i5b-twist-back-round": lambda: (twist_back(ra=46, rl=40, r2=48, bar_to=20), T * 1.1),
}


def sketch() -> None:
    out = D.ROOT / "sketch-3"
    out.mkdir(exist_ok=True)
    for k, fn in SKETCH.items():
        strokes, t = fn()
        (out / f"{k}.svg").write_text(svg(256, 256, fit(strokes, t), k), encoding="utf-8")
    print("wrote", len(SKETCH), "sketches to", out)


# ---------------------------------------------------------------- rounded wordmark (same pen)

TW = 26.0  # wordmark stroke
F = 200.0  # flip line: y' = F - y, so every glyph shares one baseline
R_TURN = 20.0  # hairpin radius (2 * R_TURN = bar spacing in ㄹ / E)


def _seg(x: float, y: float, h: float, d: float) -> list[tuple]:
    return Pen(x, y, h).line(d).segs


def g_je() -> list[list[tuple]]:
    """제 — ㅈ (bar + 人 from the bar's centre) + ㅔ (stub + two stems), round ends."""
    top, foot = 150.0, 16.0
    hat = _hat(0, foot, top - 14, 60, 16)
    x0, _, x1, _ = bbox([hat], 0)
    s = [_seg(x0 + 4, top, 0, x1 - x0 - 8), hat]  # bar over one round-apexed 人
    v1 = x1 + 58
    s += [_seg(v1 - 22, 84, 0, 22), _seg(v1, 178, 270, 192), _seg(v1 + 44, 178, 270, 192)]
    return s


def _hat(x: float, foot: float, apex: float, ang: float, ra: float) -> list[tuple]:
    """人 as ONE path: up, a small round apex, down (no overlapping caps at the top)."""
    rise = apex - foot - ra * (1 - math.cos(math.radians(ang)))
    leg = rise / math.sin(math.radians(ang))
    return Pen(x, foot, ang).line(leg).arc(ra, -2 * ang).line(leg).segs


def g_seul() -> list[list[tuple]]:
    """슬 — ㅅ, ㅡ, and ㄹ as one soft meander (hairpin turns)."""
    w = 150.0
    hx0, _, hx1, _ = bbox([_hat(0, 126, 178, 50, 14)], 0)
    s = [_hat(w / 2 - (hx0 + hx1) / 2, 126, 178, 50, 14)]  # ㅅ, centred
    s.append(_seg(0, 98, 0, w))  # ㅡ
    r = R_TURN
    p = Pen(10, 70, 0)
    p.line(w - 20 - r).arc(r, -90).arc(r, -90).line(w - 20 - 2 * r).arc(r, 90).arc(r, 90)
    p.line(w - 20 - r)
    s.append(p.segs)
    return s


def g_J() -> list[list[tuple]]:
    p = Pen(70, 160, 270)
    p.line(110).arc(35, -180).line(12)
    return [p.segs]


def g_E() -> list[list[tuple]]:
    r = 24.0
    p = Pen(96, 160, 180)
    p.line(96 - r).arc(r, 90).line(160 - 2 * r).arc(r, 90).line(96 - r)
    return [p.segs, _seg(0, 80, 0, 80)]


def g_S(h: float = 160.0) -> list[list[tuple]]:
    r = h / 4
    p = Pen(r + 26, h, 180)
    p.line(26).arc(r, 180).line(26).arc(r, -180).line(26)
    return [p.segs]


def g_L() -> list[list[tuple]]:
    r = 24.0
    p = Pen(0, 160, 270)
    p.line(160 - r).arc(r, 90).line(76 - r)
    return [p.segs]


def g_e() -> list[list[tuple]]:
    r = 54.0
    bar = _seg(0, r, 0, 2 * r)
    p = Pen(2 * r, r, 90)
    p.arc(r, 305)
    return [bar, p.segs]


def g_u() -> list[list[tuple]]:
    r = 46.0
    p = Pen(0, 108, 270)
    p.line(108 - r).arc(r, 180).line(108 - r)
    return [p.segs, _seg(2 * r, 108, 270, 108)]


def g_l() -> list[list[tuple]]:
    return [_seg(0, 172, 270, 172)]


def word3(glyphs: list[list[list[tuple]]], gap: float) -> tuple[list[str], float, float, float]:
    """Outline glyphs side by side on one baseline. Returns (paths, width, top, bottom) in y-down."""
    out: list[str] = []
    x = 0.0
    tops, bots = [], []
    for g in glyphs:
        x0, y0, x1, y1 = bbox(g, TW)
        paths = [outline(s, TW, F) for s in g]
        out += move(paths, x - x0, 0)
        tops.append(F - y1)
        bots.append(F - y0)
        x += (x1 - x0) + gap
    return out, x - gap, min(tops), max(bots)


def wm_ko() -> tuple[list[str], float, float, float]:
    return word3([g_je(), g_seul()], 40)


def wm_en(text: str = "JESL") -> tuple[list[str], float, float, float]:
    table = {"J": g_J, "E": g_E, "S": g_S, "L": g_L, "e": g_e, "s": lambda: g_S(108), "u": g_u, "l": g_l}
    return word3([table[c]() for c in text], 30)


def norm_word(wm: tuple[list[str], float, float, float], pad: float = 18) -> tuple[list[str], float, float]:
    paths, w, top, bot = wm
    return move(paths, pad, pad - top), w + 2 * pad, bot - top + 2 * pad


# ---------------------------------------------------------------- final symbols + lockups

OPTIONS = {
    # key: (builder, stroke factor, split index for the two-tone colour: where the "road back" starts)
    "r3-a": (lambda: turn_back(ra=48, bar_to=30, r2=52), 1.1, 4),
    "r3-b": (lambda: twist_back(ra=46, rl=44, r2=48, bar_to=20), 1.1, 4),
    "r3-c": (lambda: bar_ridges(k=150, ra=34, rv=34), 1.15, 4),
}


def split_strokes(strokes: list[list[tuple]], at: int) -> list[list[tuple]]:
    s = strokes[0]
    return [s[:at], s[at:]]


def sym_paths(key: str, small: bool = False) -> list[str]:
    fn, fac, _ = OPTIONS[key]
    return fit(fn(), T * fac * (1.3 if small else 1.0))


def lockup_h(sym: list[str], wm: tuple[list[str], float, float]) -> tuple[list[str], float, float]:
    paths, w, h = wm
    wm_h = 116.0
    s = wm_h / h
    gap = 40.0
    x = 256 - 24 + gap
    return sym + move(paths, x, (256 - wm_h) / 2, s), x + w * s + 24, 256


def lockup_v(sym: list[str], ko: tuple[list[str], float, float],
             en: tuple[list[str], float, float]) -> tuple[list[str], float, float]:
    s1, s2 = 104.0 / ko[2], 46.0 / en[2]
    width = max(256.0, ko[1] * s1 + 40, en[1] * s2 + 40)
    p = move(sym, (width - 256) / 2, 0)
    y = 256 - 16
    p += move(ko[0], (width - ko[1] * s1) / 2, y, s1)
    y += 104 + 10
    p += move(en[0], (width - en[1] * s2) / 2, y, s2)
    return p, width, y + 46 + 20


def main() -> None:
    from colour import two_tone

    col = D.OUT / "colour"
    col.mkdir(parents=True, exist_ok=True)
    ko = norm_word(wm_ko())
    en = norm_word(wm_en("JESL"))
    jeseul = norm_word(wm_en("Jeseul"))
    D.write("r3-wordmark-ko", *ko, "제슬 rounded wordmark", NOTE)
    D.write("r3-wordmark-en", *en, "JESL rounded wordmark", NOTE)
    D.write("r3-wordmark-jeseul", *jeseul, "Jeseul rounded wordmark", NOTE)
    for key, (fn, fac, at) in OPTIONS.items():
        sym = sym_paths(key)
        D.write(f"{key}-symbol", sym, 256, 256, f"JESL {key} symbol", NOTE)
        D.write(f"{key}-symbol-small", sym_paths(key, True), 256, 256, f"JESL {key} small-size cut", NOTE)
        D.write(f"{key}-horizontal-ko", *lockup_h(sym, ko), f"제슬 {key} lockup", NOTE)
        D.write(f"{key}-horizontal-en", *lockup_h(sym, en), f"JESL {key} lockup", NOTE)
        D.write(f"{key}-stacked", *lockup_v(sym, ko, en), f"제슬 {key} stacked", NOTE)
        two = fit(split_strokes(fn(), at), T * fac)
        for name, ink, acc in (("k1", "#E2492F", "#E2492F"), ("k2", "#16181B", "#E2492F")):
            (col / f"{key}-{name}.svg").write_text(two_tone(two, {1}, ink, acc, 256, 256), encoding="utf-8")
    print("wrote round-3 SVGs to", D.OUT)


if __name__ == "__main__":
    sketch() if sys.argv[1:] == ["sketch"] else main()
