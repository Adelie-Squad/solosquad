"""Draw the agenxy draft marks (stdlib only).

    python3 identity/_drafts/agenxy-logo/scripts/draw.py sketch   # -> sketch/  (quick variants)
    python3 identity/_drafts/agenxy-logo/scripts/draw.py          # -> svg/     (kept options)
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import letters as L
from geom import move, svg
from pen import Pen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "svg"
INK = "#1E1C17"  # DESIGN.md --ink
ACCENT = "#2867D0"  # DESIGN.md --accent
NOTE = "agenxy logo draft (exploration, not final). Hand-built letters, no font."
S = L.S


# ---------------------------------------------------------------- special letters


def x_angle(w: float) -> float:
    return math.degrees(math.atan2(L.X, w))


def xy_handoff(t: float, r: float = 14.0, wx: float = 100.0, wy: float = 96.0,
               bridge: float = 30.0) -> list[tuple]:
    """x and y joined: x's rising stroke turns over at the x-height and comes down as y's arm —
    one line handing the work from one letter (agent) to the next."""
    a = x_angle(wx)
    jx = wy / 2
    arm = math.degrees(math.atan2(L.X, jx))  # arm slope from the horizontal
    l1 = (L.X - r * (1 - math.cos(math.radians(a)))) / math.sin(math.radians(a))
    p = Pen(0, 0, a).line(l1)
    p.arc(r, -a).line(bridge).arc(r, -arm)  # over the top: a short level bridge between the letters
    l2 = p.y / math.sin(math.radians(arm))
    p.line(l2)
    jxx, jy = p.x, p.y
    span = l1 * math.cos(math.radians(a))
    back = Pen(0, L.X, -a).line(math.hypot(span, L.X))  # x's other stroke
    long_a = math.degrees(math.atan2(-L.X, -(wy - jx)))
    long = Pen(jxx + (wy - jx), L.X, long_a).line(math.hypot(wy - jx, L.X) * 1.5)
    _ = jy
    return [S(p), S(back), S(long)]


def x_woven(t: float, w: float = 100.0, clear: float = 1.0) -> list[tuple]:
    """x whose falling stroke passes UNDER the rising one: a clean break either side."""
    a = x_angle(w)
    d = math.hypot(w, L.X)
    g = (t / 2) / math.sin(math.radians(2 * a)) + t * clear
    ua = math.radians(-a)
    c = (w / 2, L.X / 2)
    s2 = (c[0] + math.cos(ua) * g, c[1] + math.sin(ua) * g)
    return [
        S(Pen(0, 0, a).line(d)),
        S(Pen(0, L.X, -a).line(d / 2 - g)),
        S(Pen(s2[0], s2[1], -a).line(d / 2 - g)),
    ]


def x_open(t: float, w: float = 100.0, gap_k: float = 1.25) -> list[tuple]:
    """x as four strokes from the corners that stop short of the centre — the centre is left open."""
    a = x_angle(w)
    d = math.hypot(w, L.X) / 2
    g = t * gap_k
    c = (w / 2, L.X / 2)
    out = []
    for sx, sy in ((0, 0), (w, 0), (0, L.X), (w, L.X)):
        h = math.degrees(math.atan2(c[1] - sy, c[0] - sx))
        out.append(S(Pen(sx, sy, h).line(d - g)))
    _ = a
    return out


# ---------------------------------------------------------------- words


def round_word(t: float, x_special: list[tuple] | None = None, ligature: bool = False, gap: float = 24):
    gl = [L.r_a(), L.r_g(), L.r_e(), L.r_n()]
    if ligature:
        gl.append(xy_handoff(t))
    else:
        gl += [x_special or L.r_x(), L.r_y()]
    return L.word(gl, t, gap)


def square_word(t: float, gap: float = 22):
    return L.word([L.q_a(), L.q_g(), L.q_e(), L.q_n(), L.q_x_arcs(), L.q_y()], t, gap)


def norm(wm, pad: float = 16):
    paths, w, top, bot = wm
    return move(paths, pad, pad - top), w + 2 * pad, bot - top + 2 * pad


def symbol(shapes: list[tuple], t: float, inner: float = 168) -> list[str]:
    x0, y0, x1, y1 = L.shapes_bbox(shapes, t)
    paths = L.shapes_to_paths(shapes, t)
    w, h = x1 - x0, y1 - y0
    s = inner / max(w, h)
    top = L.F - y1
    return move(paths, (256 - w * s) / 2 - x0 * s, (256 - h * s) / 2 - top * s, s)


def write(name: str, paths: list[str], w: float, h: float, title: str, folder: Path = OUT) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{name}.svg").write_text(svg(w, h, paths, title, INK, NOTE), encoding="utf-8")


def sketch() -> None:
    sk = ROOT / "sketch"
    variants = {
        "s01-round-thin-plain": round_word(8),
        "s02-round-thin-handoff-xy": round_word(8, ligature=True),
        "s03-round-thin-woven-x": round_word(8, x_woven(8)),
        "s04-round-regular-open-x": round_word(15, x_open(15)),
        "s05-round-regular-woven-x": round_word(15, x_woven(15)),
        "s06-square-thin-arcs-x": square_word(8),
        "s07-square-regular-arcs-x": square_word(15),
        "s08-round-hairline": round_word(5),
        "s09-round-bold-open-x": round_word(22, x_open(22)),
    }
    for k, wm in variants.items():
        write(k, *norm(wm), k, sk)
    write("s10-symbol-woven", symbol(x_woven(20), 20), 256, 256, "s10", sk)
    write("s11-symbol-open", symbol(x_open(20), 20), 256, 256, "s11", sk)
    write("s12-symbol-arcs", symbol(L.q_x_arcs(), 20), 256, 256, "s12", sk)
    write("s13-symbol-handoff", symbol(xy_handoff(20), 20), 256, 256, "s13", sk)
    print("wrote sketches to", sk)


# ---------------------------------------------------------------- kept options

N_BEFORE_X = 7  # paths of a, g, e, n in a round word (ring + stem, ring + tail, arc + bar, arch)
N_BEFORE_X_SQ = 7  # a(2) g(2) e(2) n(1) in the square word

OPTIONS = {
    # key: (name, word builder, symbol builder or None, accent path indices in the word)
    "a": ("열린 x · 얇게", lambda t=8: round_word(t, x_open(t, gap_k=1.6)), lambda: (x_open(22), 22),
          range(N_BEFORE_X, N_BEFORE_X + 4)),
    "b": ("맞닿은 x · 얇은 사각", lambda t=8: square_word(t), lambda: (L.q_x_arcs(), 22),
          range(N_BEFORE_X_SQ, N_BEFORE_X_SQ + 2)),
    "c": ("건네는 xy · 얇게", lambda t=8: round_word(t, ligature=True), None, range(N_BEFORE_X, N_BEFORE_X + 1)),
    "d": ("엇갈린 x · 보통", lambda t=15: round_word(t, x_woven(t)), None, range(N_BEFORE_X + 1, N_BEFORE_X + 3)),
}


def lockup(sym: list[str], wm: tuple[list[str], float, float], t: float) -> tuple[list[str], float, float]:
    paths, w, h = wm
    pad = 16.0
    s = 112.0 / (L.X + t)  # x-height band ~ 0.44 of the symbol
    x = 256 - 30 + 34
    y = 128 - (L.X + t) * s / 2 - pad * s
    return sym + move(paths, x, y, s), x + w * s + 24, 256


def two_tone(paths: list[str], accent: set[int], w: float, h: float, ink: str = INK) -> str:
    body = "".join(f'<path fill="{ACCENT if i in accent else ink}" d="{d}"/>' for i, d in enumerate(paths))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}">'
            f"<title>agenxy accent</title>{body}</svg>\n")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    col = OUT / "colour"
    col.mkdir(exist_ok=True)
    for key, (name, wfn, sfn, acc) in OPTIONS.items():
        wm = norm(wfn())
        t = 8.0 if key != "d" else 15.0
        if key != "d":  # thin options: a heavier cut for sizes under ~24 px (header, favicon text)
            write(f"{key}-wordmark-small", *norm(wfn(t * 1.5)), f"agenxy {name} small-size wordmark")
        write(f"{key}-wordmark", *wm, f"agenxy {name} wordmark")
        (col / f"{key}-wordmark-accent.svg").write_text(two_tone(wm[0], set(acc), wm[1], wm[2]), encoding="utf-8")
        if sfn:
            shapes, st = sfn()
            sym = symbol(shapes, st)
            write(f"{key}-symbol", sym, 256, 256, f"agenxy {name} symbol")
            write(f"{key}-symbol-small", symbol(shapes, st * 1.35, 176), 256, 256, f"agenxy {name} small cut")
            write(f"{key}-horizontal", *lockup(sym, wm, t), f"agenxy {name} lockup")
            (col / f"{key}-symbol-accent.svg").write_text(
                two_tone(sym, set(range(len(sym))), 256, 256), encoding="utf-8")
    print("wrote options to", OUT)


if __name__ == "__main__":
    sketch() if sys.argv[1:] == ["sketch"] else main()
