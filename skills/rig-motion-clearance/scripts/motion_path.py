"""Spacing chart and arc check for the points that carry a motion.

Run inside Blender:

    blender -b scene.blend --python motion_path.py -- \
        --track "Armature:wing_tip.L,Armature:head" --frames 1-48 \
        --max-jump 2.5 --max-turn 60 --out motion.csv

A track is `Object` (its origin) or `Armature:Bone` (the bone's tail in world space, the
tip that draws the arc). Per frame it writes position, spacing (distance moved since the
previous frame) and turn (degrees the direction changed). It flags:

- pop: spacing more than --max-jump times the median non-zero spacing of that track,
  a frame where the part teleports instead of easing.
- kink: turn above --max-turn while moving, a broken arc (a natural arc turns gradually).
- holds: runs of frames with spacing under 1% of the median, listed so they can be
  compared with the reference's holds.

Exit 1 when any pop or kink is found.
"""

from __future__ import annotations

import argparse
import csv
import math
import statistics
import sys

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="motion_path")
    p.add_argument("--track", required=True)
    p.add_argument("--frames", default="")
    p.add_argument("--max-jump", type=float, default=2.5)
    p.add_argument("--max-turn", type=float, default=60.0)
    p.add_argument("--out", default="")
    return p.parse_args(argv)


def frame_list(spec: str) -> list[int]:
    scene = bpy.context.scene
    if not spec:
        return list(range(scene.frame_start, scene.frame_end + 1))
    a, _, b = spec.partition("-")
    return list(range(int(a), int(b or a) + 1))


def position(track: str) -> Vector:
    name, _, bone = track.partition(":")
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise SystemExit(f"motion_path: no object {name!r}")
    if not bone:
        return obj.matrix_world.translation.copy()
    pb = obj.pose.bones.get(bone) if obj.pose else None
    if pb is None:
        raise SystemExit(f"motion_path: {name!r} has no pose bone {bone!r}")
    return obj.matrix_world @ pb.tail


def main() -> None:
    args = parse_args()
    tracks = [t.strip() for t in args.track.split(",") if t.strip()]
    frames = frame_list(args.frames)
    scene = bpy.context.scene
    paths: dict[str, list[Vector]] = {t: [] for t in tracks}
    for f in frames:
        scene.frame_set(f)
        for t in tracks:
            paths[t].append(position(t))
    rows: list[dict[str, object]] = []
    problems: list[str] = []
    for t, pts in paths.items():
        steps = [0.0] + [(pts[i] - pts[i - 1]).length for i in range(1, len(pts))]
        moving = [s for s in steps if s > 1e-9]
        median = statistics.median(moving) if moving else 0.0
        hold_from: int | None = None
        for i, f in enumerate(frames):
            turn = 0.0
            if 0 < i < len(pts) - 1:
                d1, d2 = pts[i] - pts[i - 1], pts[i + 1] - pts[i]
                if d1.length > 1e-9 and d2.length > 1e-9:
                    turn = math.degrees(d1.angle(d2))
            flag = ""
            if median and steps[i] > args.max_jump * median:
                flag = "pop"
            elif median and turn > args.max_turn and steps[i] > 0.1 * median:
                flag = "kink"
            if flag:
                problems.append(f"{flag} {t} frame {f}: spacing {steps[i]:.4f}, turn {turn:.0f}")
            still = i > 0 and median > 0 and steps[i] < 0.01 * median
            if still and hold_from is None:
                hold_from = f
            if not still and hold_from is not None:
                print(f"motion_path: hold {t} frames {hold_from}-{frames[i - 1]}")
                hold_from = None
            rows.append(
                {
                    "track": t,
                    "frame": f,
                    "x": round(pts[i].x, 5),
                    "y": round(pts[i].y, 5),
                    "z": round(pts[i].z, 5),
                    "spacing": round(steps[i], 6),
                    "turn_deg": round(turn, 1),
                    "flag": flag,
                }
            )
        if hold_from is not None:
            print(f"motion_path: hold {t} frames {hold_from}-{frames[-1]}")
    if args.out and rows:
        with open(args.out, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
    print(f"motion_path: {len(tracks)} tracks x {len(frames)} frames, {len(problems)} problems")
    for line in problems[:30]:
        print("  " + line)
    sys.exit(1 if problems else 0)


main()
