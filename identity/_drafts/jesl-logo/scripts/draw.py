"""Draw every JESL draft mark as SVG (symbols, wordmarks, lockups). stdlib only.

    python3 identity/_drafts/jesl-logo/scripts/draw.py            # -> identity/_drafts/jesl-logo/svg/

Options (see README): A1 뒷길 J · A2 쐐기 ㅈ · C1 제슬 길 · C2 JESL 거울 S.
Family B = the lockups of the A symbols (horizontal, stacked) built here too.
"""

from __future__ import annotations

from pathlib import Path

import glyphs as G
from geom import TAN30, move, rect, slant, svg

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "svg"
INK = "#111111"


# ---------------------------------------------------------------- symbols (256 x 256)


def sym_a1() -> list[str]:
    """뒷길 J — a square barrier split by one J-shaped channel (block + J that wraps it)."""
    x0, x1, col, band, g, r = 24.0, 232.0, 80.0, 80.0, 28.0, 36.0
    bx, by = x1 - col - g, x1 - band - g
    cx, cy = bx - r, by - r
    big = r + g
    block = f"M{x0} {x0} L{bx} {x0} L{bx} {cy} A{r} {r} 0 0 1 {cx} {by} L{x0} {by} Z"
    j = (
        f"M{bx + g} {x0} L{x1} {x0} L{x1} {x1} L{x0} {x1} L{x0} {by + g} L{cx} {by + g} "
        f"A{big} {big} 0 0 0 {bx + g} {cy} Z"
    )
    return [block, j]


def sym_a2() -> list[str]:
    """쐐기 ㅈ — ㅈ whose own ㅅ (a blade, 人) cuts through its top bar; the branch starts below it."""
    top, bot, t, line_t, gap, line_y = 24.0, 232.0, 40.0, 30.0, 14.0, 84.0
    w = t / 0.8660254
    span = (bot - top) * TAN30
    # the branch leaves the blade a little under the bar, like a written ㅅ
    yb = line_y + 52
    xm_rel = -(yb - top) * TAN30
    xa = 128 + (line_y - top) * TAN30  # the blade crosses the bar at the centre
    xm = xa + xm_rel
    blade = slant(xa, top, xa - span, bot, t)
    branch = slant(xm, yb, xm + (bot - yb) * TAN30, bot, t)
    x_at = xa - (line_y - top) * TAN30
    ly0 = line_y - line_t / 2
    left = rect(24, ly0, (x_at - w / 2 - gap) - 24, line_t)
    xr = x_at + w / 2 + gap
    right = rect(xr, ly0, 232 - xr, line_t)
    return [blade, branch, left, right]


# ---------------------------------------------------------------- words


def word(parts: list[tuple[list[str], float]], gap: float) -> tuple[list[str], float]:
    out: list[str] = []
    x = 0.0
    for paths, w in parts:
        out += move(paths, x, 0)
        x += w + gap
    return out, x - gap


def ko(twist: bool = False) -> tuple[list[str], float]:
    return word([G.je(), G.seul(twist)], 34)


def en(text: str = "JESL") -> tuple[list[str], float]:
    return word([G.LATIN[c]() for c in text], 30)


def place(paths: list[str], w: float, h: float, x: float, y: float, height: float):
    s = height / h
    return move(paths, x, y, s), w * s


# ---------------------------------------------------------------- lockups


def horizontal(sym: list[str], wm: tuple[list[str], float]) -> tuple[list[str], float, float]:
    wm_h = 124.0  # letter height next to a 256 symbol (~0.48)
    gap = 64.0
    p = list(sym)
    words, ww = place(wm[0], wm[1], G.H, 256 + gap - 24, (256 - wm_h) / 2, wm_h)
    return p + words, 256 + gap - 24 + ww + 24, 256


def stacked(
    sym: list[str], wm: tuple[list[str], float], sub: tuple[list[str], float] | None
) -> tuple[list[str], float, float]:
    wm_h, sub_h, gap = 118.0, 48.0, 40.0
    s1 = wm_h / G.H
    width = max(256.0, wm[1] * s1 + 48)
    p = move(sym, (width - 256) / 2, 0)
    y = 256 - 24 + gap
    words, ww = place(wm[0], wm[1], G.H, (width - wm[1] * s1) / 2, y, wm_h)
    p += words
    y += wm_h
    if sub:
        s2 = sub_h / G.H
        sw, _ = place(sub[0], sub[1], G.H, (width - sub[1] * s2) / 2, y + 26, sub_h)
        p += sw
        y += 26 + sub_h
    return p, width, y + 24


def wordmark_file(wm: tuple[list[str], float], pad: float = 18) -> tuple[list[str], float, float]:
    return move(wm[0], pad, pad), wm[1] + 2 * pad, G.H + 2 * pad


def square_of(paths: list[str], w: float, h: float, inner: float = 200) -> list[str]:
    s = inner / max(w, h)
    return move(paths, (256 - w * s) / 2, (256 - h * s) / 2, s)


def write(name: str, paths: list[str], w: float, h: float, title: str, desc: str) -> None:
    (OUT / f"{name}.svg").write_text(svg(w, h, paths, title, INK, desc), encoding="utf-8")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    note = "JESL logo draft (exploration, not final). Code-drawn, no font."
    base_ko, base_en = ko(False), en("JESL")

    for key, sym, title in (("a1", sym_a1(), "뒷길 J"), ("a2", sym_a2(), "쐐기 ㅈ")):
        write(f"{key}-symbol", sym, 256, 256, f"JESL {title} symbol", note)
        write(f"{key}-horizontal-ko", *horizontal(sym, base_ko), f"제슬 {title} lockup", note)
        write(f"{key}-horizontal-en", *horizontal(sym, base_en), f"JESL {title} lockup", note)
        write(f"{key}-stacked", *stacked(sym, base_ko, base_en), f"제슬 {title} stacked", note)

    write("wordmark-ko", *wordmark_file(base_ko), "제슬 wordmark (base)", note)
    write("wordmark-en", *wordmark_file(base_en), "JESL wordmark (base)", note)
    write("wordmark-en-jeseul", *wordmark_file(en("JESEUL")), "JESEUL wordmark", note)

    # C1 — the road through the line, carried by the Korean wordmark
    c1 = ko(True)
    write("c1-wordmark", *wordmark_file(c1), "제슬 길 wordmark", note)
    seul_p, seul_w = G.seul(True)
    write("c1-symbol", square_of(seul_p, seul_w, G.H, 196), 256, 256, "슬 small-size cut", note)
    write("c1-stacked", *stacked_words(c1, base_en), "제슬 길 bilingual", note)

    # C2 — Latin-led: the S is the ㄹ road seen from behind
    c2 = en("JESL")
    write("c2-wordmark", *wordmark_file(c2), "JESL mirror-S wordmark", note)
    s_p, s_w = G.lat_s()
    write("c2-symbol", square_of(s_p, s_w, G.H, 188), 256, 256, "S/ㄹ small-size cut", note)
    write("c2-stacked", *stacked_words(c2, ko(False), sub_scale=0.5), "JESL 거울 S bilingual", note)
    print("wrote", len(list(OUT.glob("*.svg"))), "SVGs to", OUT)


def stacked_words(
    top: tuple[list[str], float], sub: tuple[list[str], float], sub_scale: float = 0.42
) -> tuple[list[str], float, float]:
    pad, gap = 18.0, 34.0
    width = max(top[1], sub[1] * sub_scale) + 2 * pad
    p = move(top[0], (width - top[1]) / 2, pad)
    sw = sub[1] * sub_scale
    p += move(sub[0], (width - sw) / 2, pad + G.H + gap, sub_scale)
    return p, width, pad + G.H + gap + G.H * sub_scale + pad


if __name__ == "__main__":
    main()
