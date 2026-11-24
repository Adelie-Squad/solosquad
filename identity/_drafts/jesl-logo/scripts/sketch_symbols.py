"""Round-1 sketches of the symbol ideas (quick, many variants) — see README 'Sketch'."""

from __future__ import annotations

import sys
from pathlib import Path

from geom import TAN30, poly, quarter_band, rect, slant, svg

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "sketch")
OUT.mkdir(parents=True, exist_ok=True)


def a1_backroad(col: float, band: float, g: float, r: float) -> list[str]:
    """Square barrier split by one J-shaped channel: block top-left, J (column + band) around it."""
    x0, x1 = 24.0, 232.0
    bx = x1 - col - g  # block right edge
    by = x1 - band - g  # block bottom edge
    cx, cy = bx - r, by - r  # shared arc centre
    block = (
        f"M{x0} {x0} L{bx} {x0} L{bx} {cy} A{r} {r} 0 0 1 {cx} {by} L{x0} {by} Z"
    )
    R = r + g
    j = (
        f"M{bx + g} {x0} L{x1} {x0} L{x1} {x1} L{x0} {x1} L{x0} {by + g} L{cx} {by + g} "
        f"A{R} {R} 0 0 0 {bx + g} {cy} Z"
    )
    return [block, j]


def a2_wedge(t: float, line_t: float, gap: float, line_y: float) -> list[str]:
    """Asymmetric ㅅ (人) — a blade through a limit line; its branch starts at the line."""
    top, bot = 24.0, 232.0
    # left leg centre: x(y) = xa - (y - top) * TAN30 ; right leg from the line centre
    width_span = (bot - top) * TAN30  # left leg dx
    yb = line_y
    # centre the bbox: left extreme = xa - span - w/2, right extreme = xm + (bot-yb)*TAN30 + w/2
    w = t / 0.8660254
    xa = 0.0
    xm_rel = -(yb - top) * TAN30
    right_rel = xm_rel + (bot - yb) * TAN30
    left_rel = -width_span
    xa = 128 - (left_rel + right_rel) / 2
    xm = xa + xm_rel
    left = slant(xa, top, xa - width_span, bot, t)
    right = slant(xm, yb, xm + (bot - yb) * TAN30, bot, t)
    ly0, ly1 = yb - line_t / 2, yb + line_t / 2
    x_at = xa - (yb - top) * TAN30  # left leg centre at line height
    stub_l = rect(24, ly0, (x_at - w / 2 - gap) - 24, line_t)
    xr = x_at + w / 2 + gap
    stub_r = rect(xr, ly0, 232 - xr, line_t)
    return [left, right, stub_l, stub_r]


def a3_rieul(t: float, exit_: bool) -> list[str]:
    """Square ㄹ path (mirror = S). Optional: bottom stroke runs out of the frame (the road out)."""
    x0, x1, y0, y1 = 40.0, 216.0, 32.0, 224.0
    gap = (y1 - y0 - 3 * t) / 2
    ym = y0 + t + gap
    yb = ym + t + gap
    p = [
        rect(x0, y0, x1 - x0, t),
        rect(x1 - t, y0, t, ym + t - y0),
        rect(x0, ym, x1 - x0, t),
        rect(x0, ym, t, yb + t - ym),
        rect(x0, yb, (248 if exit_ else x1) - x0, t),
    ]
    return p


def a4_gate(t: float) -> list[str]:
    """Two offset walls; the opening between them is a diagonal passage (gate seen in plan)."""
    return [
        poly((24, 24), (152, 24), (104, 128), (24, 128)),
        poly((232, 232), (104, 232), (152, 128), (232, 128)),
    ]


variants = {
    "a1-1": a1_backroad(64, 64, 24, 48),
    "a1-2": a1_backroad(72, 56, 24, 40),
    "a1-3": a1_backroad(80, 80, 28, 36),
    "a2-1": a2_wedge(36, 32, 16, 120),
    "a2-2": a2_wedge(40, 28, 14, 104),
    "a2-3": a2_wedge(34, 34, 18, 136),
    "a3-1": a3_rieul(40, False),
    "a3-2": a3_rieul(40, True),
    "a4-1": a4_gate(40),
}
for name, paths in variants.items():
    (OUT / f"{name}.svg").write_text(svg(256, 256, paths, f"sketch {name}"), encoding="utf-8")
print("wrote", len(variants), "sketches to", OUT)
_ = quarter_band  # used by later rounds
