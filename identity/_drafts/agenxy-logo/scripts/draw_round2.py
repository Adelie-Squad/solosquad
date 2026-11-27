"""agenxy round 2 — develop A (wordmark + an AGENTS-gathering symbol) and D (the symbol lives in the
wordmark; the standalone symbol is just that point).

Meaning: agents gathered -> agency, + AX (AI transformation) -> agen·x·y. The x is the AX.

    python3 identity/_drafts/agenxy-logo/scripts/draw_round2.py sketch   # -> sketch-2/
    python3 identity/_drafts/agenxy-logo/scripts/draw_round2.py          # -> svg/r2-*.svg
"""

from __future__ import annotations

import math
import sys

import draw as D
import letters as L
from pen import Pen

S = L.S
C = (50.0, 50.0)  # symbol design box 0..100


def _pol(r: float, deg: float, c: tuple[float, float] = C) -> tuple[float, float]:
    a = math.radians(deg)
    return c[0] + r * math.cos(a), c[1] + r * math.sin(a)


def _seg_between(p: tuple[float, float], q: tuple[float, float]) -> tuple:
    h = math.degrees(math.atan2(q[1] - p[1], q[0] - p[0]))
    return S(Pen(p[0], p[1], h).line(math.hypot(q[0] - p[0], q[1] - p[1])))


# ---------------------------------------------------------------- A: agents gathering (symbols)


def agents_x(heads_out: bool = True, body: tuple[float, float] = (15, 29), head_r: float = 8.5,
             head_at: float = 52) -> list[tuple]:
    """Four agents (a head + a short body) on the diagonals, all turned to one centre: they form
    an x — the AX — and the centre between them is the shared work."""
    out: list[tuple] = []
    for a in (45, 135, 225, 315):
        r0, r1 = body
        if heads_out:
            out.append(_seg_between(_pol(r0, a), _pol(r1, a)))
            out.append(("dot", *_pol(head_at, a), head_r))
        else:
            out.append(_seg_between(_pol(head_at - 8, a), _pol(head_at + 16, a)))
            out.append(("dot", *_pol(r0 + 2, a), head_r))
    return out


def agents_table(head_r: float = 9.0, sh_r: float = 30.0, sweep: float = 56, core: bool = True) -> list[tuple]:
    """Top view: four agents (head + shoulders) around one shared point. The four gaps between
    them sit on the diagonals, so the open space reads as an x."""
    out: list[tuple] = []
    for a in (90, 0, 270, 180):
        start = a + sweep / 2
        p0 = _pol(sh_r, start)
        out.append(S(Pen(p0[0], p0[1], start - 90).arc(sh_r, -sweep)))  # shoulders curve round the centre
        out.append(("dot", *_pol(sh_r + 15, a), head_r))
    if core:
        out.append(("dot", C[0], C[1], 7.0))
    return out


def agents_pinwheel(head_r: float = 8.0) -> list[tuple]:
    """Four agents turning into one centre (pinwheel): a team moving as one, an x in motion."""
    out: list[tuple] = []
    for a in (45, 135, 225, 315):
        p0 = _pol(44, a)
        h = a + 180 - 28
        pen = Pen(p0[0], p0[1], h).line(16).arc(20, 50)
        out.append(S(pen))
        out.append(("dot", *_pol(52, a - 12), head_r))
    return out


# ---------------------------------------------------------------- D: the point inside the wordmark


def x_agent(t: float, w: float = 100.0, head_k: float = 1.15) -> list[tuple]:
    """x as an agent: the rising stroke stops short and a head sits above it — a figure mid-stride.
    The one letter of agenxy that is a person: the agent doing the AX."""
    a = math.degrees(math.atan2(L.X, w))
    d = math.hypot(w, L.X)
    short = d * 0.74
    end = (math.cos(math.radians(a)) * short, math.sin(math.radians(a)) * short)
    head = (end[0] + math.cos(math.radians(a)) * t * 2.4, end[1] + math.sin(math.radians(a)) * t * 2.4)
    return [S(Pen(0, L.X, -a).line(d)), S(Pen(0, 0, a).line(short)), ("dot", head[0], head[1], t * head_k)]


def x_core(t: float, w: float = 100.0, gap_k: float = 1.3, core_k: float = 1.15) -> list[tuple]:
    """x whose four strokes stop short of one solid core: agents (strokes) -> the AX at the centre."""
    out = D.x_open(t, w, gap_k=gap_k + core_k)
    out.append(("dot", w / 2, L.X / 2, t * core_k))
    return out


# ---------------------------------------------------------------- extra: penguin (the brand character)

CHEEK = "#E01FAE"  # DESIGN.md --cheek: character-only colour (using it here needs a rule exception)


def penguin_a(t: float, face_k: float = 1.0) -> list[tuple]:
    """agenxy's 'a' as a penguin face: the bowl gets two round eyes and a diamond beak."""
    r = L.R
    e = min(max(t * 0.85, 4.5), 7.5) * face_k  # the face stays the same size at heavy weights
    return [
        ("ring", r, r, r),
        S(Pen(L.X, L.X, 270).line(L.X)),
        ("dot", r - 15, r + 10, e),
        ("dot", r + 15, r + 10, e),
        ("diamond", r, r - 8, e * 0.95, e * 1.15),
    ]


def x_beak(t: float, w: float = 100.0) -> list[tuple]:
    """x whose four strokes meet at the penguin's diamond beak — the AX point is the beak."""
    out = D.x_open(t, w, gap_k=2.4)
    out.append(("diamond", w / 2, L.X / 2, t * 1.35, t * 1.6))
    return out


def penguin_mark(cheeks: bool = False) -> list[str]:
    """Penguin body (rounded top) with the white face as a real hole, two eyes, a diamond beak.
    Drawn in a 0..100 box (y down), scaled to 256. Outer clockwise, hole anticlockwise."""
    body = ("M14 40 A36 36 0 0 1 86 40 L86 80 A14 14 0 0 1 72 94 L28 94 A14 14 0 0 1 14 80 Z "
            "M27 50 L27 76 A9 9 0 0 0 36 85 L64 85 A9 9 0 0 0 73 76 L73 50 A23 23 0 0 0 27 50 Z")
    beak = "M50 56.5 L55.5 62 L50 67.5 L44.5 62 Z"  # 45-degree diamond (logo simplification)
    paths = [body]
    paths += [f"M{x + 5.2} 50 A5.2 5.2 0 1 1 {x - 5.2} 50 A5.2 5.2 0 1 1 {x + 5.2} 50 Z" for x in (40, 60)]
    paths.append(beak)
    if cheeks:
        paths += [f"M{x + 4} 61 A4 4 0 1 1 {x - 4} 61 A4 4 0 1 1 {x + 4} 61 Z" for x in (34, 66)]
    return D.move(paths, 128 - 50 * 2.0, 128 - 49 * 2.0, 2.0)


P_POINTS = {
    "p1": ("펭귄 a", lambda t: penguin_a(t)),
    "p3": ("부리 x", lambda t: x_beak(t)),
}


D_POINTS = {
    "d1": ("엇갈린 x", lambda t: D.x_woven(t)),
    "d2": ("걷는 x", lambda t: x_agent(t)),
    "d3": ("핵이 있는 x", lambda t: x_core(t)),
}
A_SYMBOLS = {
    "a1": ("모이는 넷 (머리 바깥)", lambda: agents_x(True)),
    "a2": ("머리를 맞댄 넷", lambda: agents_x(False)),
    "a3": ("한 점을 둘러싼 넷", lambda: agents_table()),
}
TD = 15.0  # D wordmark stroke (regular)
TA = 8.0  # A wordmark stroke (thin)
TS = 13.0  # symbol stroke (in the 0..100 design box)


def d_word(key: str, t: float = TD):
    _, fn = D_POINTS[key]
    return D.round_word(t, fn(t))


def sketch() -> None:
    sk = D.ROOT / "sketch-2"
    for k, (name, fn) in {**A_SYMBOLS, "a4": ("돌아 모이는 넷 (탈락: 卍 꼴)", agents_pinwheel)}.items():
        D.write(f"{k}-symbol", D.symbol(fn(), TS), 256, 256, name, sk)
    for k, (name, fn) in D_POINTS.items():
        D.write(f"{k}-wordmark", *D.norm(d_word(k)), name, sk)
        D.write(f"{k}-point", D.symbol(fn(TD * 1.5), TD * 1.5, 176), 256, 256, name, sk)
    print("wrote sketches to", sk)


def main() -> None:
    col = D.OUT / "colour"
    col.mkdir(parents=True, exist_ok=True)
    for k, (name, fn) in D_POINTS.items():
        wm = D.norm(d_word(k))
        D.write(f"r2-{k}-wordmark", *wm, f"agenxy {name} wordmark")
        D.write(f"r2-{k}-wordmark-small", *D.norm(d_word(k, TD * 1.3)), f"agenxy {name} small-size wordmark")
        pt = D.symbol(fn(TD * 1.5), TD * 1.5, 176)
        D.write(f"r2-{k}-point", pt, 256, 256, f"agenxy {name} — the point used alone")
        n = len(fn(TD))
        acc = set(range(D.N_BEFORE_X, D.N_BEFORE_X + n))
        (col / f"r2-{k}-wordmark-accent.svg").write_text(D.two_tone(wm[0], acc, wm[1], wm[2]), encoding="utf-8")
        (col / f"r2-{k}-point-accent.svg").write_text(D.two_tone(pt, set(range(len(pt))), 256, 256), encoding="utf-8")
    base = D.norm(D.round_word(TA))
    base_small = D.norm(D.round_word(TA * 1.5))
    D.write("r2-a-wordmark", *base, "agenxy thin wordmark (A family)")
    D.write("r2-a-wordmark-small", *base_small, "agenxy thin wordmark small-size cut")
    for k, (name, fn) in A_SYMBOLS.items():
        sym = D.symbol(fn(), TS)
        D.write(f"r2-{k}-symbol", sym, 256, 256, f"agenxy {name} symbol")
        D.write(f"r2-{k}-symbol-small", D.symbol(fn(), TS * 1.3, 184), 256, 256, f"agenxy {name} small cut")
        D.write(f"r2-{k}-horizontal", *D.lockup(sym, base, TA), f"agenxy {name} lockup")
        heads = {i for i, s in enumerate(fn()) if s[0] == "dot"}
        (col / f"r2-{k}-symbol-accent.svg").write_text(D.two_tone(sym, heads, 256, 256), encoding="utf-8")
    penguins(col)
    print("wrote round-2 SVGs to", D.OUT)


def p_word(key: str, t: float):
    if key == "p1":
        return L.word([penguin_a(t), L.r_g(), L.r_e(), L.r_n(), L.r_x(), L.r_y()], t, 24)
    return D.round_word(t, x_beak(t))


def penguins(col) -> None:
    """Extra set: the brand penguin. P1 penguin 'a' (thin), P2 penguin mark + thin wordmark, P3 beak x."""
    for key, t, acc_idx in (("p1", TA, {2, 3, 4}), ("p3", TD, None)):
        name, fn = P_POINTS[key]
        wm = D.norm(p_word(key, t))
        D.write(f"r2-{key}-wordmark", *wm, f"agenxy {name} wordmark")
        D.write(f"r2-{key}-wordmark-small", *D.norm(p_word(key, t * (1.5 if t == TA else 1.3))),
                f"agenxy {name} small-size wordmark")
        pt = D.symbol(fn(TD * 1.5), TD * 1.5, 176)
        D.write(f"r2-{key}-point", pt, 256, 256, f"agenxy {name} — the point used alone")
        if acc_idx is None:
            n = len(fn(t))
            acc_idx = {D.N_BEFORE_X + n - 1}  # the beak
        (col / f"r2-{key}-wordmark-accent.svg").write_text(D.two_tone(wm[0], acc_idx, wm[1], wm[2]), encoding="utf-8")
    sym = penguin_mark()
    D.write("r2-p2-symbol", sym, 256, 256, "agenxy penguin mark")
    D.write("r2-p2-symbol-small", sym, 256, 256, "agenxy penguin mark (same drawing works small)")
    base = D.norm(D.round_word(TA))
    D.write("r2-p2-horizontal", *D.lockup(sym, base, TA), "agenxy penguin mark lockup")
    cheeks = penguin_mark(True)
    body = "".join(f'<path fill="{D.INK if i < 4 else CHEEK}" d="{d}"/>' for i, d in enumerate(cheeks))
    (col / "r2-p2-symbol-cheek.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><title>penguin mark, cheek colour'
        f" (needs a DESIGN.md exception)</title>{body}</svg>\n", encoding="utf-8")


if __name__ == "__main__":
    sketch() if sys.argv[1:] == ["sketch"] else main()
