"""Tiny geometry kit for code-drawn logo marks (stdlib only).

Every primitive returns an SVG path `d` string of a filled outline (no strokes, no text), so the
marks stay pure vector and survive svg_audit / one-colour / reversed exports unchanged.
"""

from __future__ import annotations

import math

TAN30 = math.tan(math.radians(30))  # dx per dy for a 60-degree leg
SIN60 = math.sin(math.radians(60))


def f(v: float) -> str:
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def poly(*pts: tuple[float, float]) -> str:
    return "M" + " L".join(f"{f(x)} {f(y)}" for x, y in pts) + " Z"


def rect(x: float, y: float, w: float, h: float) -> str:
    return poly((x, y), (x + w, y), (x + w, y + h), (x, y + h))


def slant(x_top: float, y_top: float, x_bot: float, y_bot: float, t: float) -> str:
    """Diagonal stroke of perpendicular thickness t, cut horizontally at both ends.

    x_top/x_bot are the centre line's x at y_top/y_bot.
    """
    dx, dy = x_bot - x_top, y_bot - y_top
    ang = math.atan2(dy, abs(dx)) if dx else math.pi / 2
    w = t / math.sin(ang)  # horizontal width of the stroke
    return poly(
        (x_top - w / 2, y_top),
        (x_top + w / 2, y_top),
        (x_bot + w / 2, y_bot),
        (x_bot - w / 2, y_bot),
    )


def quarter_band(cx: float, cy: float, r_in: float, r_out: float, quad: str) -> str:
    """Quarter ring; quad in {'tr','br','bl','tl'} = which quarter around (cx, cy)."""
    sx, sy = {"tr": (1, -1), "br": (1, 1), "bl": (-1, 1), "tl": (-1, -1)}[quad]
    # start on the horizontal axis, sweep to the vertical axis
    p0o = (cx + sx * r_out, cy)
    p1o = (cx, cy + sy * r_out)
    p1i = (cx, cy + sy * r_in)
    p0i = (cx + sx * r_in, cy)
    sweep = 1 if sx * sy > 0 else 0
    return (
        f"M{f(p0o[0])} {f(p0o[1])} A{f(r_out)} {f(r_out)} 0 0 {sweep} {f(p1o[0])} {f(p1o[1])} "
        f"L{f(p1i[0])} {f(p1i[1])} A{f(r_in)} {f(r_in)} 0 0 {1 - sweep} {f(p0i[0])} {f(p0i[1])} Z"
    )


def svg(
    width: float, height: float, paths: list[str], title: str, fill: str = "#111111", desc: str = ""
) -> str:
    body = "".join(f'<path d="{d}"/>' for d in paths)
    d = f"<desc>{desc}</desc>" if desc else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(width)} {f(height)}">'
        f'<title>{title}</title>{d}<g fill="{fill}">{body}</g></svg>\n'
    )


def move(paths: list[str], dx: float, dy: float, s: float = 1.0) -> list[str]:
    """Translate/scale path data by rewriting coordinates (keeps the files transform-free)."""
    out = []
    for d in paths:
        out.append(_xform(d, dx, dy, s))
    return out


def _xform(d: str, dx: float, dy: float, s: float) -> str:
    toks = d.replace(",", " ").split()
    res: list[str] = []
    cmd = ""
    idx = 0
    for tok in toks:
        head = tok[0]
        if head.isalpha():
            cmd = head
            idx = 0
            tok = tok[1:]
            res.append(cmd)
            if not tok:
                continue
        v = float(tok)
        if cmd == "A":
            # rx ry rot large sweep x y
            k = idx % 7
            if k in (0, 1):
                v *= s
            elif k == 5:
                v = v * s + dx
            elif k == 6:
                v = v * s + dy
        else:
            v = v * s + (dx if idx % 2 == 0 else dy)
        idx += 1
        if res and res[-1].isalpha() and len(res[-1]) == 1:
            res[-1] = res[-1] + f(v)
        else:
            res.append(f(v))
    return " ".join(res)
