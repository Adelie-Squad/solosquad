"""Did the edit change only the region it was meant to change?

Run with Blender's Python (numpy ships with Blender, nothing to install):

    blender -b --factory-startup --python render_compare.py -- \
        --before renders/r02/QA_front_f0001.png --after renders/r03/QA_front_f0001.png \
        --region wing=0.55,0.35,0.95,0.75 --region head=0.30,0.05,0.70,0.40 \
        --edit wing --tol 0.03 --max-outside 0.002 [--out compare.md]

Both images must come from the same QA camera and resolution. Regions are named boxes
in image fractions, origin top left: name=x0,y0,x1,y1. For every region it prints the
mean absolute difference and the share of pixels that changed by more than --tol (0-1
per channel). "outside" is every pixel in no --edit region: when its changed share is
above --max-outside the edit leaked, and the script exits 1.
"""

from __future__ import annotations

import argparse
import sys

import bpy
import numpy as np


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="render_compare")
    p.add_argument("--before", required=True)
    p.add_argument("--after", required=True)
    p.add_argument("--region", action="append", default=[], help="name=x0,y0,x1,y1")
    p.add_argument("--edit", action="append", default=[], help="region names meant to change")
    p.add_argument("--tol", type=float, default=0.03)
    p.add_argument("--max-outside", type=float, default=0.002)
    p.add_argument("--out", default="")
    return p.parse_args(argv)


def load(path: str) -> np.ndarray:
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1, :, :3]  # Blender stores rows bottom-up


def box(spec: str, h: int, w: int) -> tuple[str, slice, slice]:
    name, _, nums = spec.partition("=")
    x0, y0, x1, y1 = (float(n) for n in nums.split(","))
    return name, slice(round(y0 * h), round(y1 * h)), slice(round(x0 * w), round(x1 * w))


def main() -> None:
    args = parse_args()
    a, b = load(args.before), load(args.after)
    if a.shape != b.shape:
        raise SystemExit(f"render_compare: size differs {a.shape[:2]} vs {b.shape[:2]}")
    h, w = a.shape[:2]
    diff = np.abs(a - b).max(axis=2)
    changed = diff > args.tol
    rows = [("whole", float(diff.mean()), float(changed.mean()))]
    edit_mask = np.zeros((h, w), dtype=bool)
    for spec in args.region:
        name, ys, xs = box(spec, h, w)
        rows.append((name, float(diff[ys, xs].mean()), float(changed[ys, xs].mean())))
        if name in args.edit:
            edit_mask[ys, xs] = True
    unknown = set(args.edit) - {box(s, h, w)[0] for s in args.region}
    if unknown:
        raise SystemExit(f"render_compare: --edit names no --region: {sorted(unknown)}")
    outside = ~edit_mask
    out_share = float(changed[outside].mean()) if outside.any() else 0.0
    rows.append(("outside", float(diff[outside].mean()) if outside.any() else 0.0, out_share))
    lines = ["| region | mean abs diff | changed share | role |", "|---|---|---|---|"]
    for name, mean, share in rows:
        role = "edit" if name in args.edit else ("guard" if name == "outside" else "")
        lines.append(f"| {name} | {mean:.4f} | {share:.4f} | {role} |")
    leaked = out_share > args.max_outside
    lines.append("")
    lines.append(
        f"outside changed share {out_share:.4f} vs limit {args.max_outside}: "
        + ("LEAK, the edit changed areas it should not" if leaked else "ok")
    )
    text = "\n".join(lines)
    print(text)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
    sys.exit(1 if leaked else 0)


main()
