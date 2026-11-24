"""Custom-drawn letters for the JESL drafts: Hangul 제 슬 and Latin J E S L U (monoline, code geometry).

No font is used — every letter is built from rectangles, slanted strokes and quarter rings, so the
wordmarks are pure paths and owe nothing to a font licence. Pretendard/SUIT were only looked at for
proportions (references/fonts-korean.md).

Coordinates: each glyph is drawn in its own box, top y = 0, height H; returns (paths, width).
"""

from __future__ import annotations

from geom import f, poly, rect, slant

H = 220.0  # vowel / cap height
T = 24.0  # stroke (verticals and path strokes)
TH = 21.0  # horizontal bars in Hangul (optically thinner)
K = 0.45  # dx per dy of the ㅅ legs (about 66 degrees)
R = 30.0  # centre-line radius of path turns


def path_stroke(pts: list[tuple[float, float]], t: float, r: float) -> list[str]:
    """Orthogonal polyline of width t as ONE closed outline (no seams), rounded turns of
    centre-line radius r (0 = sharp corners)."""
    h = t / 2
    dirs = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:], strict=False):
        dirs.append((_sgn(x1 - x0), _sgn(y1 - y0)))

    def nrm(d: tuple[int, int]) -> tuple[int, int]:
        return (d[1], -d[0])  # left of travel (screen coordinates, y down)

    def side(s: int) -> list[str]:
        cmds: list[str] = []
        order = range(1, len(pts) - 1)
        for i in order:
            p, d1, d2 = pts[i], dirs[i - 1], dirs[i]
            n1, n2 = nrm(d1), nrm(d2)
            if r > 0:
                t1 = (p[0] - d1[0] * r + s * h * n1[0], p[1] - d1[1] * r + s * h * n1[1])
                t2 = (p[0] + d2[0] * r + s * h * n2[0], p[1] + d2[1] * r + s * h * n2[1])
                cross = d1[0] * d2[1] - d1[1] * d2[0]
                rad = r + s * h * (1 if cross > 0 else -1)
                cmds.append(("L", t1, None))
                cmds.append(("A", t2, (rad, 1 if cross > 0 else 0)))
            else:
                q = (p[0] + s * h * (n1[0] + n2[0]), p[1] + s * h * (n1[1] + n2[1]))
                cmds.append(("L", q, None))
        return cmds

    def fmt(pt):
        return f"{f(pt[0])} {f(pt[1])}"

    n0, nl = nrm(dirs[0]), nrm(dirs[-1])
    a0 = (pts[0][0] + h * n0[0], pts[0][1] + h * n0[1])
    out = "M" + fmt(a0)
    for kind, pt, arc in side(1):
        out += f" L{fmt(pt)}" if kind == "L" else f" A{f(arc[0])} {f(arc[0])} 0 0 {arc[1]} {fmt(pt)}"
    out += " L" + fmt((pts[-1][0] + h * nl[0], pts[-1][1] + h * nl[1]))
    out += " L" + fmt((pts[-1][0] - h * nl[0], pts[-1][1] - h * nl[1]))
    right = side(-1)
    # walk the right side backwards: arcs reverse their sweep, endpoints swap
    seq = []
    for i in range(len(right) - 1, -1, -1):
        seq.append(right[i])
    k = 0
    while k < len(seq):
        kind, pt, arc = seq[k]
        if kind == "A":
            start_pt = seq[k + 1][1]  # the L before this arc (tangent point t1)
            out += f" L{fmt(pt)} A{f(arc[0])} {f(arc[0])} 0 0 {1 - arc[1]} {fmt(start_pt)}"
            k += 2
        else:
            out += f" L{fmt(pt)}"
            k += 1
    out += " L" + fmt((pts[0][0] - h * n0[0], pts[0][1] - h * n0[1])) + " Z"
    return [out]


def _sgn(v: float) -> int:
    return (v > 0) - (v < 0)


# ---------------------------------------------------------------- Hangul


def siot(xc: float, y0: float, y1: float, t: float = T) -> list[str]:
    """Symmetric ㅅ with apex at (xc, y0)."""
    dx = (y1 - y0) * K
    return [slant(xc, y0, xc - dx, y1, t), slant(xc, y0, xc + dx, y1, t)]


def je() -> tuple[list[str], float]:
    """제 = ㅈ + ㅔ."""
    p: list[str] = []
    bar_y, leg_y1 = 36.0, 188.0
    legs_dy = leg_y1 - (bar_y + TH)
    half = legs_dy * K + T / 2 / 0.912  # leg reach incl. half stroke
    w_j = 2 * half
    p.append(rect(0, bar_y, w_j, TH))
    p += siot(half, bar_y + TH - 2, leg_y1)  # 2 units into the bar: no seam
    stub0 = w_j + 8
    v1 = stub0 + 26
    p.append(rect(stub0, 100, v1 - stub0, TH))
    p.append(rect(v1, 0, T, H))
    v2 = v1 + T + 26
    p.append(rect(v2, 0, T, H))
    return p, v2 + T


def rieul(x0: float, x1: float, y0: float, y1: float, r: float = R) -> list[str]:
    """ㄹ as one road: right, down, left, down, right (rounded turns)."""
    t = TH
    a, c = y0 + t / 2, y1 - t / 2
    m = (a + c) / 2
    pts = [(x0, a), (x1 - T / 2, a), (x1 - T / 2, m), (x0 + T / 2, m), (x0 + T / 2, c), (x1, c)]
    return path_stroke(pts, t, min(r, (c - a) / 4))


def seul(twist: bool = False) -> tuple[list[str], float]:
    """슬 = ㅅ + ㅡ + ㄹ. twist: ㅅ's right leg runs on through a cut in ㅡ and becomes the ㄹ road."""
    w = 196.0
    p: list[str] = []
    s_y1 = 72.0
    eu_y = 86.0
    r_y0 = 128.0
    xc = w / 2
    if not twist:
        p += siot(xc, 0, s_y1)
        p.append(rect(0, eu_y, w, TH))
        p += rieul(10, w - 10, r_y0, H)
        return p, w
    # the right leg keeps its slope down to the top of ㄹ; ㅡ is cut around it
    dx = s_y1 * K
    p.append(slant(xc, 0, xc - dx, s_y1, T))
    land_y = r_y0 + 3  # into the ㄹ's top bar: no seam
    land_x = w - 10 - T / 2 - R - 8  # on the straight part, just before the turn
    xa = land_x - land_y * K
    p = [slant(xa, 0, xa - dx, s_y1, T), slant(xa, 0, land_x, land_y, T)]
    gap = 9.0
    leg_w = T / 0.912
    x_cut = xa + (eu_y + TH / 2) * K
    p.append(rect(0, eu_y, x_cut - leg_w / 2 - gap, TH))
    xr = x_cut + leg_w / 2 + gap
    p.append(rect(xr, eu_y, w - xr, TH))
    p += rieul(10, w - 10, r_y0, H)
    return p, w


# ---------------------------------------------------------------- Latin (monoline caps)


def lat_j() -> tuple[list[str], float]:
    """J = the mirror of L: down, then the road turns back (left)."""
    w = 100.0
    pts = [(w - T / 2, 0), (w - T / 2, H - T / 2), (0, H - T / 2)]
    return path_stroke(pts, T, R * 1.6), w


def lat_e() -> tuple[list[str], float]:
    w = 112.0
    return [
        rect(0, 0, T, H),
        rect(0, 0, w, T),
        rect(0, (H - T) / 2, w - 10, T),
        rect(0, H - T, w, T),
    ], w


def lat_s(r: float = R) -> tuple[list[str], float]:
    """S as the mirror of the ㄹ road: left, down, right, down, left."""
    w = 116.0
    a, c = T / 2, H - T / 2
    m = (a + c) / 2
    pts = [(w, a), (T / 2, a), (T / 2, m), (w - T / 2, m), (w - T / 2, c), (0, c)]
    return path_stroke(pts, T, r), w


def lat_l() -> tuple[list[str], float]:
    """L: down, then the road turns forward (right) — J's mirror image."""
    w = 100.0
    pts = [(T / 2, 0), (T / 2, H - T / 2), (w, H - T / 2)]
    return path_stroke(pts, T, R * 1.6), w


def lat_u() -> tuple[list[str], float]:
    w = 116.0
    pts = [(T / 2, 0), (T / 2, H - T / 2), (w - T / 2, H - T / 2), (w - T / 2, 0)]
    return path_stroke(pts, T, R * 1.4), w


LATIN = {"J": lat_j, "E": lat_e, "S": lat_s, "L": lat_l, "U": lat_u}

_ = poly
