"""Two colour directions, shown separately from the monochrome options (round 1 is judged in black).

    python3 identity/_drafts/jesl-logo/scripts/colour.py     # -> identity/_drafts/jesl-logo/svg/colour/

D1 먹 · 주홍 — ink with one vermilion element: the part that carries the idea (the J road, the blade).
D2 심록 — one deep green, on paper or reversed. Avoids the category's default blue/purple gradients.
"""

from __future__ import annotations

import draw as D
from geom import f

OUT = D.OUT / "colour"
DIRECTIONS = {
    "d1": {"name": "먹 · 주홍", "ink": "#16181B", "accent": "#E2492F", "paper": "#F6F3EE"},
    "d2": {"name": "심록", "ink": "#123F3A", "accent": "#123F3A", "paper": "#EEF1EC"},
}


def two_tone(paths: list[str], accent_idx: set[int], ink: str, accent: str, w: float, h: float) -> str:
    body = "".join(
        f'<path fill="{accent if i in accent_idx else ink}" d="{d}"/>' for i, d in enumerate(paths)
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(w)} {f(h)}">'
        f"<title>JESL colour direction</title>{body}</svg>\n"
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    a1, a2 = D.sym_a1(), D.sym_a2()
    c1, c1w = D.ko(True)
    # in C1 the leg that runs through ㅡ into ㄹ is the second path of 슬 (after 제's 6 paths)
    je_n = len(D.G.je()[0])
    for key, c in DIRECTIONS.items():
        (OUT / f"a1-{key}.svg").write_text(
            two_tone(a1, {1}, c["ink"], c["accent"], 256, 256), encoding="utf-8"
        )
        (OUT / f"a2-{key}.svg").write_text(
            two_tone(a2, {0}, c["ink"], c["accent"], 256, 256), encoding="utf-8"
        )
        paths = D.move(c1, 18, 18)
        (OUT / f"c1-{key}.svg").write_text(
            two_tone(paths, {je_n + 1}, c["ink"], c["accent"], c1w + 36, D.G.H + 36),
            encoding="utf-8",
        )
    print("wrote colour directions to", OUT)


if __name__ == "__main__":
    main()
