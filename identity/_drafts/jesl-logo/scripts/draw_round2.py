"""Round 2 — the "but why" mood: one figure walking away from the crowd toward the far ridge.

Mood reference only (a lone figure in an empty white field, unhurried, going the other way; the dry
"but why?" answered by just walking). No penguin, no film still, no meme text in any mark.

    python3 identity/_drafts/jesl-logo/scripts/draw_round2.py sketch   # -> sketch-2/ (many variants)
    python3 identity/_drafts/jesl-logo/scripts/draw_round2.py          # -> svg/r2-*.svg (kept options)
"""

from __future__ import annotations

import sys

import draw as D
import glyphs as G
from colour import DIRECTIONS, two_tone
from geom import move, poly, rect, slant, svg

TAN15 = 0.26794919  # dx per dy for a 15-degree lean from vertical
NOTE = "JESL logo draft round 2 (exploration, not final). Code-drawn, no font, no penguin."


# ---------------------------------------------------------------- symbols (256)


def n1_lean(n: int = 4, t: float = 22.0, gap: float = 13.0, step: float = 28.0,
            crowd_lean: float = 0.0) -> tuple[list[str], set[int]]:
    """이탈 한 획 — a row of identical strokes (the crowd); the last one leans the other way,
    one step ahead and up. Returns (paths, index of the lone stroke)."""
    top, bot = 76.0, 212.0
    w_crowd = n * t + (n - 1) * gap
    lone_dx = (bot - top) * TAN15
    total = w_crowd + gap * 2.2 + t + lone_dx
    x = (256 - total) / 2
    p = []
    for _ in range(n):
        if crowd_lean:
            dx = (bot - top) * crowd_lean
            p.append(slant(x + t / 2 + dx, top, x + t / 2, bot, t))
        else:
            p.append(rect(x, top, t, bot - top))
        x += t + gap
    x += gap * 1.2
    # the lone stroke: same length, leaning forward 15 degrees, one step up the slope
    y1 = bot - step
    y0 = y1 - (bot - top)
    p.append(slant(x + t / 2 + lone_dx, y0, x + t / 2, y1, t))
    return p, {n}


def n2_ridge_why(t: float = 32.0, dot: float = 36.0) -> tuple[list[str], set[int]]:
    """왜 — 능선 물음표: a long slope up to a peak, a short steep slope down that settles into a
    vertical stem, and one square dot under it. A ridge that quietly reads as "?"; the dot walks."""
    pts = [(46.0, 196.0), (136.0, 40.0), (202.0, 106.0), (202.0, 160.0)]  # 60 deg up, 45 deg down
    stem_x = 202.0
    d = rect(stem_x - dot / 2, 232 - dot, dot, dot)
    return [mitre_polyline(pts, t), d], {1}


def n2b_far_ridge(t: float = 22.0) -> tuple[list[str], set[int]]:
    """Alt: a horizon, a far low ridge, and one dot already walking toward it."""
    horizon = rect(24, 176, 208, t)
    ridge = poly((120, 176), (184, 108), (232, 176))
    walker = rect(48, 140, 24, 36)
    return [horizon, ridge, walker], {2}


def _thick_line(a: tuple[float, float], b: tuple[float, float], t: float) -> str:
    import math

    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy)
    ox, oy = -dy / n * t / 2, dx / n * t / 2
    return poly((a[0] + ox, a[1] + oy), (b[0] + ox, b[1] + oy), (b[0] - ox, b[1] - oy), (a[0] - ox, a[1] - oy))


def mitre_polyline(pts: list[tuple[float, float]], t: float) -> str:
    """Open polyline of width t as one polygon with mitred joins and square (butt) ends."""
    import math

    def off(a, b, s):
        dx, dy = b[0] - a[0], b[1] - a[1]
        n = math.hypot(dx, dy)
        ox, oy = -dy / n * t / 2 * s, dx / n * t / 2 * s
        return (a[0] + ox, a[1] + oy), (b[0] + ox, b[1] + oy)

    def meet(l1, l2):
        (x1, y1), (x2, y2) = l1
        (x3, y3), (x4, y4) = l2
        den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        if abs(den) < 1e-9:
            return l1[1]
        a = x1 * y2 - y1 * x2
        b = x3 * y4 - y3 * x4
        return ((a * (x3 - x4) - (x1 - x2) * b) / den, (a * (y3 - y4) - (y1 - y2) * b) / den)

    sides = []
    for s in (1, -1):
        segs = [off(pts[i], pts[i + 1], s) for i in range(len(pts) - 1)]
        line = [segs[0][0]]
        for i in range(len(segs) - 1):
            line.append(meet(segs[i], segs[i + 1]))
        line.append(segs[-1][1])
        sides.append(line)
    return poly(*(sides[0] + sides[1][::-1]))


def _joint(p: tuple[float, float], t: float) -> str:
    """Square-ish cap at a mitre so two thick lines meet without a notch (pointed peak)."""
    x, y = p
    return poly((x - t * 0.62, y + t * 0.35), (x, y - t * 0.62), (x + t * 0.62, y + t * 0.35), (x, y + t * 0.5))


# ---------------------------------------------------------------- wordmarks (height 220 box)


def n3_horizon_ko(ext: float = 330.0, peak_w: float = 110.0, peak_h: float = 58.0):
    """제슬 — 슬's ㅡ keeps going: a long, deadpan horizon that ends at a small far ridge."""
    je, wj = G.je()
    seul, ws = G.seul(False)
    # seul paths: ㅅ (2), ㅡ (1), ㄹ (1). Replace ㅡ with a long line.
    eu_y, th = 86.0, G.TH
    line_end = ws + ext
    sp = seul[:2] + [rect(0, eu_y, line_end, th)] + seul[3:]
    x0 = line_end - peak_w
    # a far ridge, not an arrowhead: shoulder (60 deg up), small dip (45), peak (60 up), 45 down
    import math

    r3 = math.sqrt(3)
    b = eu_y + 2
    h1, dip = peak_h * 0.55, peak_h * 0.15
    a = (x0 - 4, b)
    s = (a[0] + h1 / r3, b - h1)
    d = (s[0] + dip, s[1] + dip)
    rise = peak_h - (h1 - dip)
    pk = (d[0] + rise / r3, d[1] - rise)
    e = (pk[0] + peak_h, b)
    ridge = poly(a, s, d, pk, e)
    gap = 34.0
    paths = je + move(sp + [ridge], wj + gap, 0)
    accent = {len(je) + len(sp)}
    return paths, wj + gap + line_end, accent


def n4_step_out(step: float = 26.0, extra: float = 40.0):
    """JESL — the L has stepped off the baseline: one step up, one pace apart, foot forward."""
    parts = [G.LATIN[c]() for c in "JES"]
    out: list[str] = []
    x = 0.0
    for paths, w in parts:
        out += move(paths, x, 0)
        x += w + 30
    x += extra
    lp, lw = G.lat_l()
    out += move(lp, x, -step)
    return out, x + lw, {len(out) - 1}


# ---------------------------------------------------------------- output


def lone_on_lines(paths: list[str], w: float, h: float, name: str) -> None:
    (D.OUT / f"{name}.svg").write_text(svg(w, h, paths, f"JESL {name}", D.INK, NOTE), encoding="utf-8")


def sketch() -> None:
    out = D.ROOT / "sketch-2"
    out.mkdir(exist_ok=True)
    v = {
        "n1-1": n1_lean()[0],
        "n1-2": n1_lean(n=5, t=22, gap=14)[0],
        "n1-3": n1_lean(crowd_lean=-TAN15)[0],
        "n2-1": n2_ridge_why()[0],
        "n2-3": n2b_far_ridge()[0],
    }
    for k, p in v.items():
        (out / f"{k}.svg").write_text(svg(256, 256, p, k), encoding="utf-8")
    p, w, _ = n3_horizon_ko()
    (out / "n3-1.svg").write_text(svg(w + 36, G.H + 36, move(p, 18, 18), "n3-1"), encoding="utf-8")
    p, w, _ = n4_step_out()
    (out / "n4-1.svg").write_text(svg(w + 36, G.H + 62, move(p, 18, 44), "n4-1"), encoding="utf-8")
    print("wrote sketches to", out)


def main() -> None:
    D.OUT.mkdir(parents=True, exist_ok=True)
    col = D.OUT / "colour"
    col.mkdir(exist_ok=True)
    base_ko, base_en = D.ko(False), D.en("JESL")
    kept = {"r2-n1": n1_lean(), "r2-n2": n2_ridge_why()}
    for key, (sym, acc) in kept.items():
        D.write(f"{key}-symbol", sym, 256, 256, f"JESL {key} symbol", NOTE)
        D.write(f"{key}-horizontal-ko", *D.horizontal(sym, base_ko), f"제슬 {key} lockup", NOTE)
        D.write(f"{key}-horizontal-en", *D.horizontal(sym, base_en), f"JESL {key} lockup", NOTE)
        D.write(f"{key}-stacked", *D.stacked(sym, base_ko, base_en), f"제슬 {key} stacked", NOTE)
        for dk, c in DIRECTIONS.items():
            (col / f"{key}-{dk}.svg").write_text(two_tone(sym, acc, c["ink"], c["accent"], 256, 256),
                                                  encoding="utf-8")

    # N3 — wordmark-led (C): the long horizon
    p, w, acc = n3_horizon_ko()
    wm = (p, w)
    D.write("r2-n3-wordmark", *D.wordmark_file(wm), "제슬 지평선 wordmark", NOTE)
    D.write("r2-n3-stacked", *D.stacked_words(wm, base_en, sub_scale=0.34), "제슬 지평선 bilingual", NOTE)
    # small cut: 슬 on its own line with the far ridge, squeezed
    sp, ws, _ = n3_horizon_ko(ext=150, peak_w=96, peak_h=52)
    je_w = G.je()[1] + 34
    small = move(sp[len(G.je()[0]):], -je_w, 0)
    D.write("r2-n3-symbol", D.square_of(small, ws - je_w, G.H, 220), 256, 256, "슬 지평선 small cut", NOTE)
    for dk, c in DIRECTIONS.items():
        (col / f"r2-n3-{dk}.svg").write_text(
            two_tone(move(p, 18, 18), acc, c["ink"], c["accent"], w + 36, G.H + 36), encoding="utf-8")
    print("wrote round-2 SVGs to", D.OUT)


if __name__ == "__main__":
    sketch() if sys.argv[1:] == ["sketch"] else main()
