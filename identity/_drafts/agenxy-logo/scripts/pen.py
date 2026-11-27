"""A turtle pen for round, monoline marks (round 3): lines + circular arcs, expanded to a filled outline.

The centre line is built from straight segments and circular arcs joined tangent to each other
(G1: no corners; curvature changes where an arc meets a line — G2 smoothing is a kit-stage job).
`outline()` returns ONE closed path per stroke: left edge forward, round cap, right edge back,
round cap. Offsets of arcs are exact arcs, so the files stay small (no sampled points).
A stroke may cross itself: with the default nonzero fill the overlap stays filled and the inside
of a loop stays open.

Coordinates are maths-style (y up) inside the pen; `outline(..., flip=H)` writes SVG (y down).
The flip keeps the picture's orientation, so a visually clockwise turn is SVG sweep-flag 1.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field


def _f(v: float) -> str:
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _dir(deg: float) -> tuple[float, float]:
    r = math.radians(deg)
    return math.cos(r), math.sin(r)


@dataclass
class Pen:
    x: float
    y: float
    heading: float  # degrees, 0 = +x, counter-clockwise
    segs: list[tuple] = field(default_factory=list)

    def line(self, d: float) -> Pen:
        dx, dy = _dir(self.heading)
        p0 = (self.x, self.y)
        self.x += dx * d
        self.y += dy * d
        self.segs.append(("L", p0, (self.x, self.y), self.heading))
        return self

    def arc(self, r: float, a: float) -> Pen:
        """Turn by a degrees (+ left / - right) along a circle of radius r (split into <= 90 deg)."""
        n = max(1, math.ceil(abs(a) / 90 - 1e-9))
        for _ in range(n):
            self._arc(r, a / n)
        return self

    def _arc(self, r: float, a: float) -> None:
        s = 1 if a > 0 else -1
        nx, ny = _dir(self.heading + 90 * s)
        c = (self.x + nx * r, self.y + ny * r)
        h0, h1 = self.heading, self.heading + a
        self.heading = h1
        px, py = _dir(h1 - 90 * s)
        p0 = (self.x, self.y)
        self.x, self.y = c[0] + px * r, c[1] + py * r
        self.segs.append(("A", p0, (self.x, self.y), h0, h1, r, s))

    def to(self, x: float, y: float) -> Pen:
        """Straight line to (x, y) — only valid if it is along the current heading."""
        d = math.hypot(x - self.x, y - self.y)
        return self.line(d)


def _off(p: tuple[float, float], heading: float, h: float) -> tuple[float, float]:
    nx, ny = _dir(heading + 90)
    return p[0] + nx * h, p[1] + ny * h


def outline(segs: list[tuple], t: float, flip: float) -> str:
    """Filled outline of a stroke of width t with round caps; y flipped against `flip`."""
    h = t / 2

    def P(p: tuple[float, float]) -> str:
        return f"{_f(p[0])} {_f(flip - p[1])}"

    first, last = segs[0], segs[-1]
    h_start = first[3]
    h_end = last[3] if last[0] == "L" else last[4]
    start, end = first[1], last[2]
    out = ["M" + P(_off(start, h_start, h))]
    # left edge, forward
    for s in segs:
        if s[0] == "L":
            out.append("L" + P(_off(s[2], s[3], h)))
        else:
            _, p0, p1, h0, h1, r, sg = s
            rr = r - h if sg > 0 else r + h
            if rr <= 0.01:
                out.append("L" + P(_off(p1, h1, h)))
            else:
                out.append(f"A{_f(rr)} {_f(rr)} 0 0 {0 if sg > 0 else 1} " + P(_off(p1, h1, h)))
    # end cap (around the front, clockwise in maths coords)
    ex, ey = _dir(h_end)
    front = (end[0] + ex * h, end[1] + ey * h)
    out.append(f"A{_f(h)} {_f(h)} 0 0 1 " + P(front))
    out.append(f"A{_f(h)} {_f(h)} 0 0 1 " + P(_off(end, h_end, -h)))
    # right edge, backward
    for s in reversed(segs):
        if s[0] == "L":
            out.append("L" + P(_off(s[1], s[3], -h)))
        else:
            _, p0, p1, h0, h1, r, sg = s
            rr = r + h if sg > 0 else r - h
            if rr <= 0.01:
                out.append("L" + P(_off(p0, h0, -h)))
            else:
                out.append(f"A{_f(rr)} {_f(rr)} 0 0 {1 if sg > 0 else 0} " + P(_off(p0, h0, -h)))
    # start cap (around the back)
    bx, by = _dir(h_start)
    back = (start[0] - bx * h, start[1] - by * h)
    out.append(f"A{_f(h)} {_f(h)} 0 0 1 " + P(back))
    out.append(f"A{_f(h)} {_f(h)} 0 0 1 " + P(_off(start, h_start, h)))
    return " ".join(out) + " Z"


def bbox(segs_list: list[list[tuple]], t: float) -> tuple[float, float, float, float]:
    """Approximate bounds (maths coords) of strokes, sampling arcs."""
    xs: list[float] = []
    ys: list[float] = []
    h = t / 2
    for segs in segs_list:
        for s in segs:
            pts = [s[1], s[2]]
            if s[0] == "A":
                _, p0, p1, h0, h1, r, sg = s
                nx, ny = _dir(h0 + 90 * sg)
                c = (p0[0] + nx * r, p0[1] + ny * r)
                for k in range(1, 12):
                    hh = h0 + (h1 - h0) * k / 12
                    px, py = _dir(hh - 90 * sg)
                    pts.append((c[0] + px * r, c[1] + py * r))
            for p in pts:
                xs += [p[0] - h, p[0] + h]
                ys += [p[1] - h, p[1] + h]
    return min(xs), min(ys), max(xs), max(ys)
