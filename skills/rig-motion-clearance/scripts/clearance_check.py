"""Per-frame clearance between moving parts and everything they must not touch.

Run inside Blender (headless is fine):

    blender -b scene.blend --python clearance_check.py -- \
        --moving "Penguin:wing_L,Penguin:wing_R" \
        --against "Penguin:head,Penguin:beak,EyeL,EyeR,Body" \
        --frames 1-48 --min-clearance 0.01 [--subframes 4] --out clearance.csv

A part is `Object` or `Object:VertexGroup` (faces whose vertices all weigh > 0.5 in the
group), so one skinned mesh can be split into wing / head / body regions. Positions come
from the evaluated depsgraph, so armature skinning, shape keys and constraints count.

Clearance is signed: > 0 is the gap in scene units, <= 0 means the surfaces cross or a
vertex sits inside the other part (closed meshes). The script exits 1 when any frame is
under --min-clearance or any surfaces cross, so a render step can refuse to start. Parts
that are meant to touch (a wing root sewn onto the body) are not a pair: list the regions
that must stay apart (wing tip vs head), not the seam.
"""

from __future__ import annotations

import argparse
import csv
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="clearance_check")
    p.add_argument("--moving", required=True, help="comma list of Object or Object:Group")
    p.add_argument("--against", default="", help="comma list; empty = every other mesh")
    p.add_argument("--frames", default="", help="a-b or a-b:step; empty = scene range")
    p.add_argument("--min-clearance", type=float, default=0.0)
    p.add_argument("--subframes", type=int, default=1, help="samples per frame, for fast moves")
    p.add_argument("--out", default="", help="CSV path for every frame x pair")
    return p.parse_args(argv)


def split_parts(spec: str) -> list[tuple[str, str | None]]:
    parts: list[tuple[str, str | None]] = []
    for item in (s.strip() for s in spec.split(",")):
        if not item:
            continue
        name, _, group = item.partition(":")
        parts.append((name, group or None))
    return parts


def frame_list(spec: str) -> list[int]:
    scene = bpy.context.scene
    if not spec:
        return list(range(scene.frame_start, scene.frame_end + 1))
    span, _, step = spec.partition(":")
    a, _, b = span.partition("-")
    return list(range(int(a), int(b or a) + 1, int(step or 1)))


def label(part: tuple[str, str | None]) -> str:
    return f"{part[0]}:{part[1]}" if part[1] else part[0]


def world_geometry(
    part: tuple[str, str | None], depsgraph: bpy.types.Depsgraph
) -> tuple[list[Vector], list[tuple[int, ...]]]:
    obj = bpy.data.objects.get(part[0])
    if obj is None or obj.type != "MESH":
        raise SystemExit(f"clearance_check: no mesh object named {part[0]!r}")
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    try:
        mw = ev.matrix_world
        verts = [mw @ v.co for v in mesh.vertices]
        keep: set[int] | None = None
        if part[1]:
            vg = obj.vertex_groups.get(part[1])
            if vg is None:
                raise SystemExit(f"clearance_check: {part[0]!r} has no group {part[1]!r}")
            keep = {
                v.index
                for v in mesh.vertices
                for g in v.groups
                if g.group == vg.index and g.weight > 0.5
            }
        polys = [
            tuple(p.vertices)
            for p in mesh.polygons
            if keep is None or all(i in keep for i in p.vertices)
        ]
        if not polys:
            raise SystemExit(f"clearance_check: {label(part)} has no faces")
        used = sorted({i for poly in polys for i in poly})
        remap = {old: new for new, old in enumerate(used)}
        return [verts[i] for i in used], [tuple(remap[i] for i in poly) for poly in polys]
    finally:
        ev.to_mesh_clear()


def signed_gap(verts: list[Vector], tree: BVHTree) -> tuple[float, Vector | None]:
    """Smallest vertex-to-surface distance; negative when the vertex is behind the face."""
    best, where = float("inf"), None
    for v in verts:
        loc, normal, _, dist = tree.find_nearest(v)
        if loc is None:
            continue
        d = -dist if normal is not None and (v - loc).dot(normal) < 0 else dist
        if d < best:
            best, where = d, v
    return best, where


def main() -> None:
    args = parse_args()
    moving = split_parts(args.moving)
    against = split_parts(args.against)
    if not against:
        names = {m[0] for m in moving}
        against = [
            (o.name, None)
            for o in bpy.context.scene.objects
            if o.type == "MESH" and o.visible_get() and o.name not in names
        ]
    scene = bpy.context.scene
    rows: list[dict[str, object]] = []
    worst: dict[str, object] | None = None
    samples = max(1, args.subframes)
    frames = frame_list(args.frames)
    times = [(f, k / samples) for f in frames for k in range(samples if f != frames[-1] else 1)]
    for whole, sub in times:
        scene.frame_set(whole, subframe=sub)
        frame = round(whole + sub, 3)
        depsgraph = bpy.context.evaluated_depsgraph_get()
        geo = {label(p): world_geometry(p, depsgraph) for p in moving + against}
        trees = {k: BVHTree.FromPolygons(v, f) for k, (v, f) in geo.items()}
        for m in moving:
            mk = label(m)
            for a in against:
                ak = label(a)
                if ak == mk:
                    continue
                crossing = bool(trees[mk].overlap(trees[ak]))
                g1, p1 = signed_gap(geo[mk][0], trees[ak])
                g2, p2 = signed_gap(geo[ak][0], trees[mk])
                gap, at = (g1, p1) if g1 <= g2 else (g2, p2)
                if crossing:
                    gap = min(gap, 0.0)
                row: dict[str, object] = {
                    "frame": frame,
                    "moving": mk,
                    "against": ak,
                    "clearance": round(gap, 6),
                    "crossing": crossing,
                    "at": tuple(round(c, 4) for c in at) if at is not None else "",
                }
                rows.append(row)
                if worst is None or gap < float(worst["clearance"]):  # type: ignore[arg-type]
                    worst = row
    if args.out:
        with open(args.out, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0]) if rows else ["frame"])
            w.writeheader()
            w.writerows(rows)
    fails = [
        r
        for r in rows
        if r["crossing"] or float(r["clearance"]) < args.min_clearance  # type: ignore[arg-type]
    ]
    print(
        f"clearance_check: {len(rows)} frame x pair checks,"
        f" {len(fails)} crossing or under {args.min_clearance}"
    )
    if worst is not None:
        print(
            f"clearance_check: worst {worst['clearance']} at frame {worst['frame']}"
            f" {worst['moving']} vs {worst['against']} near {worst['at']}"
        )
    for r in fails[:20]:
        print(f"  FAIL frame {r['frame']}: {r['moving']} vs {r['against']} = {r['clearance']}")
    sys.exit(1 if fails else 0)


main()
