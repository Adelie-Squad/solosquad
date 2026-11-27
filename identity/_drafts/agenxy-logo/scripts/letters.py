"""Hand-built monoline lowercase for "agenxy" (no font). Two families:

- round: geometric circles (a g e are rings, n an arch) — options A1 · A2 · B1
- square: wide squircle bowls (a g e n y built on rounded rectangles) — option A3

Coordinates are maths-style: baseline y = 0, x-height X = 100, descender to about -52.
A glyph is a list of shapes: ("stroke", segs) from pen.Pen, ("ring", cx, cy, r),
("rrect", x, y, w, h, r) — all outlined at stroke width t with `shapes_to_paths`.
"""

from __future__ import annotations

import math

from geom import move
from pen import Pen, bbox, outline

X = 100.0
F = 160.0  # flip line: y' = F - y (room above x-height for caps of the strokes)


def _f(v: float) -> str:
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def ring_path(cx: float, cy: float, r: float, t: float) -> str:
    """Circle stroke as outer (clockwise) + inner (anticlockwise) — a real hole, no knockout."""
    ro, ri = r + t / 2, r - t / 2
    y = F - cy
    return (
        f"M{_f(cx + ro)} {_f(y)} A{_f(ro)} {_f(ro)} 0 1 1 {_f(cx - ro)} {_f(y)} "
        f"A{_f(ro)} {_f(ro)} 0 1 1 {_f(cx + ro)} {_f(y)} Z "
        f"M{_f(cx + ri)} {_f(y)} A{_f(ri)} {_f(ri)} 0 1 0 {_f(cx - ri)} {_f(y)} "
        f"A{_f(ri)} {_f(ri)} 0 1 0 {_f(cx + ri)} {_f(y)} Z"
    )


def rrect_ring(x: float, y: float, w: float, h: float, r: float, t: float) -> str:
    """Rounded-rectangle stroke (centre line x, y, w, h, r) as outer + reversed inner."""
    h2 = t / 2
    outer = _rr_path(x - h2, y - h2, w + t, h + t, r + h2, True)
    inner = _rr_path(x + h2, y + h2, w - t, h - t, max(r - h2, 0.01), False)
    return outer + " " + inner


def _rr_path(x: float, y: float, w: float, h: float, r: float, cw: bool) -> str:
    """Rounded rect, y-down output; cw = clockwise on screen."""
    r = max(0.01, min(r, w / 2, h / 2))
    top, bot = F - (y + h), F - y
    left, right = x, x + w
    if cw:
        return (
            f"M{_f(left + r)} {_f(top)} L{_f(right - r)} {_f(top)} A{_f(r)} {_f(r)} 0 0 1 {_f(right)} {_f(top + r)} "
            f"L{_f(right)} {_f(bot - r)} A{_f(r)} {_f(r)} 0 0 1 {_f(right - r)} {_f(bot)} "
            f"L{_f(left + r)} {_f(bot)} A{_f(r)} {_f(r)} 0 0 1 {_f(left)} {_f(bot - r)} "
            f"L{_f(left)} {_f(top + r)} A{_f(r)} {_f(r)} 0 0 1 {_f(left + r)} {_f(top)} Z"
        )
    return (
        f"M{_f(left + r)} {_f(top)} A{_f(r)} {_f(r)} 0 0 0 {_f(left)} {_f(top + r)} "
        f"L{_f(left)} {_f(bot - r)} A{_f(r)} {_f(r)} 0 0 0 {_f(left + r)} {_f(bot)} "
        f"L{_f(right - r)} {_f(bot)} A{_f(r)} {_f(r)} 0 0 0 {_f(right)} {_f(bot - r)} "
        f"L{_f(right)} {_f(top + r)} A{_f(r)} {_f(r)} 0 0 0 {_f(right - r)} {_f(top)} Z"
    )


def shapes_to_paths(shapes: list[tuple], t: float) -> list[str]:
    out = []
    for s in shapes:
        if s[0] == "stroke":
            out.append(outline(s[1], t, F))
        elif s[0] == "ring":
            out.append(ring_path(s[1], s[2], s[3], t))
        elif s[0] == "rrect":
            out.append(rrect_ring(*s[1:], t))
    return out


def shapes_bbox(shapes: list[tuple], t: float) -> tuple[float, float, float, float]:
    xs0, ys0, xs1, ys1 = [], [], [], []
    for s in shapes:
        if s[0] == "stroke":
            b = bbox([s[1]], t)
        elif s[0] == "ring":
            _, cx, cy, r = s
            b = (cx - r - t / 2, cy - r - t / 2, cx + r + t / 2, cy + r + t / 2)
        else:
            _, x, y, w, h, _r = s
            b = (x - t / 2, y - t / 2, x + w + t / 2, y + h + t / 2)
        xs0.append(b[0]); ys0.append(b[1]); xs1.append(b[2]); ys1.append(b[3])  # noqa: E702
    return min(xs0), min(ys0), max(xs1), max(ys1)


def S(p: Pen) -> tuple:
    return ("stroke", p.segs)


# ---------------------------------------------------------------- round family

R = X / 2


def r_a() -> list[tuple]:
    return [("ring", R, R, R), S(Pen(X, X, 270).line(X))]


def r_g() -> list[tuple]:
    return [("ring", R, R, R), S(Pen(X, X, 270).line(X + 6).arc(44, -180))]


def r_e() -> list[tuple]:
    return [S(Pen(X, R, 90).arc(R, 318)), S(Pen(0, R, 0).line(X))]


def r_n() -> list[tuple]:
    return [S(Pen(0, 0, 90).line(X - R).arc(R, -180).line(X - R))]


def r_x(w: float = 100.0) -> list[tuple]:
    d = math.hypot(w, X)
    a = math.degrees(math.atan2(X, w))
    return [S(Pen(0, 0, a).line(d)), S(Pen(0, X, -a).line(d))]


def r_y(w: float = 96.0) -> list[tuple]:
    jx = w / 2
    long_a = math.degrees(math.atan2(-X, -(w - jx)))  # from top-right through the junction
    L = math.hypot(w - jx, X) * 1.5
    arm_a = math.degrees(math.atan2(-X, jx))
    return [S(Pen(w, X, long_a).line(L)), S(Pen(0, X, arm_a).line(math.hypot(jx, X)))]


# ---------------------------------------------------------------- square family (wide squircles)

W = 124.0  # bowl width
RC = 34.0  # corner radius (centre line)


def q_a() -> list[tuple]:
    p = Pen(W, X, 180).line(W - RC).arc(RC, 90).line(X - 2 * RC).arc(RC, 90).line(W - RC)
    return [S(p), S(Pen(W, X, 270).line(X))]


def q_g() -> list[tuple]:
    p = Pen(W, X, 180).line(W - RC).arc(RC, 90).line(X - 2 * RC).arc(RC, 90).line(W - RC)
    tail = Pen(W, X, 270).line(X + 52 - RC).arc(RC, -90).line(W - RC - 12)
    return [S(p), S(tail)]


def q_e() -> list[tuple]:
    p = Pen(W, X / 2, 90).line(X / 2 - RC).arc(RC, 90).line(W - 2 * RC).arc(RC, 90)
    p.line(X - 2 * RC).arc(RC, 90).line(W - RC - 22)
    return [S(p), S(Pen(0, X / 2, 0).line(W))]


def q_n() -> list[tuple]:
    return [S(Pen(0, 0, 90).line(X - RC).arc(RC, -90).line(W - 2 * RC).arc(RC, -90).line(X - RC))]


def q_y() -> list[tuple]:
    u = Pen(0, X, 270).line(X - RC).arc(RC, 90).line(W - RC)
    tail = Pen(W, X, 270).line(X + 52 - RC).arc(RC, -90).line(W - RC - 12)
    return [S(u), S(tail)]


def q_x_arcs(w: float = 104.0) -> list[tuple]:
    """x as two arcs back to back — ")(" — touching at the centre: a hand-off point."""
    r = (X**2 / 4 + (w / 2) ** 2) / w  # circle through the corners, tangent at the centre
    ang = math.degrees(math.asin((X / 2) / r))
    left = Pen(0, X, 270 + ang).arc(r, -2 * ang)
    right = Pen(w, X, 270 - ang).arc(r, 2 * ang)
    return [S(left), S(right)]


# ---------------------------------------------------------------- composing


def word(glyphs: list[list[tuple]], t: float, gap: float) -> tuple[list[str], float, float, float]:
    """Paths (y-down, shared baseline), width, top, bottom."""
    out: list[str] = []
    x = 0.0
    tops, bots = [], []
    for g in glyphs:
        x0, y0, x1, y1 = shapes_bbox(g, t)
        out += move(shapes_to_paths(g, t), x - x0, 0)
        tops.append(F - y1)
        bots.append(F - y0)
        x += (x1 - x0) + gap
    return out, x - gap, min(tops), max(bots)
