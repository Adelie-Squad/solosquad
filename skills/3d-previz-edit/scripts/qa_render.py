"""Render the same fixed QA cameras every round, at previz or final quality.

Run inside Blender (headless is fine):

    blender -b model.blend --python qa_render.py -- \
        --target Penguin --out renders/r03 --quality previz [--frames 1,12,24] [--turntable 24]

First run: creates QA_front · QA_side · QA_back · QA_3q · QA_top framed on the target's
world bounding box, stores them in a `QA_cameras` collection and saves the .blend, so
every later round renders from identical cameras. Existing QA cameras are never moved;
pass --reframe only when the user agrees the baseline changes.

previz = Workbench (solid, flat light, no shadows), 50% resolution: seconds per view,
good for shape, silhouette and pose decisions. final = the scene's own engine and
settings at 100%. Output names: <out>/<camera>_f<frame>.png (+ turntable_####.png).
"""

from __future__ import annotations

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

VIEWS = {
    "QA_front": (0.0, -1.0, 0.15),
    "QA_side": (1.0, 0.0, 0.15),
    "QA_back": (0.0, 1.0, 0.15),
    "QA_3q": (0.7, -0.7, 0.35),
    "QA_top": (0.0, -0.05, 1.0),
}
LENS_MM = 85.0
FIT_MARGIN = 1.15
COLLECTION = "QA_cameras"


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="qa_render")
    p.add_argument("--target", required=True, help="object (its children count too)")
    p.add_argument("--out", required=True)
    p.add_argument("--quality", choices=["previz", "final"], default="previz")
    p.add_argument("--frames", default="", help="comma list; empty = current frame")
    p.add_argument("--turntable", type=int, default=0, help="N frames of 360 orbit; 0 = off")
    p.add_argument("--resolution", type=int, default=1024, help="square, before quality %")
    p.add_argument("--reframe", action="store_true", help="move existing QA cameras")
    return p.parse_args(argv)


def bounds(target: bpy.types.Object) -> tuple[Vector, float]:
    objs = [target, *target.children_recursive]
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    if not pts:
        raise SystemExit(f"qa_render: {target.name!r} has no mesh to frame")
    lo = Vector(min(p[i] for p in pts) for i in range(3))
    hi = Vector(max(p[i] for p in pts) for i in range(3))
    return (lo + hi) / 2, (hi - lo).length / 2


def ensure_cameras(target: bpy.types.Object, reframe: bool) -> list[bpy.types.Object]:
    scene = bpy.context.scene
    coll = bpy.data.collections.get(COLLECTION)
    if coll is None:
        coll = bpy.data.collections.new(COLLECTION)
        scene.collection.children.link(coll)
    center, radius = bounds(target)
    sensor = 36.0
    fov = 2 * math.atan(sensor / (2 * LENS_MM))
    dist = radius * FIT_MARGIN / math.sin(fov / 2)
    cams = []
    for name, d in VIEWS.items():
        cam = bpy.data.objects.get(name)
        fresh = cam is None
        if fresh:
            cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
            coll.objects.link(cam)
        if fresh or reframe:
            cam.data.lens = LENS_MM
            cam.data.sensor_width = sensor
            cam.location = center + Vector(d).normalized() * dist
            cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        cams.append(cam)
    return cams


def configure(quality: str, resolution: int) -> None:
    scene = bpy.context.scene
    r = scene.render
    r.resolution_x = r.resolution_y = resolution
    r.image_settings.file_format = "PNG"
    if quality == "previz":
        r.resolution_percentage = 50
        try:
            r.engine = "BLENDER_WORKBENCH"
        except TypeError as e:
            raise SystemExit(f"qa_render: no Workbench engine ({e})") from e
        shading = scene.display.shading
        shading.light = "STUDIO"
        shading.color_type = "MATERIAL"
        shading.show_shadows = False
    else:
        r.resolution_percentage = 100


def render_to(path: str) -> None:
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main() -> None:
    args = parse_args()
    scene = bpy.context.scene
    target = bpy.data.objects.get(args.target)
    if target is None:
        raise SystemExit(f"qa_render: no object named {args.target!r}")
    had_cams = bpy.data.collections.get(COLLECTION) is not None
    cams = ensure_cameras(target, args.reframe)
    if (not had_cams or args.reframe) and bpy.data.filepath:
        bpy.ops.wm.save_mainfile()
    configure(args.quality, args.resolution)
    os.makedirs(args.out, exist_ok=True)
    frames = [int(f) for f in args.frames.split(",") if f.strip()] or [scene.frame_current]
    for frame in frames:
        scene.frame_set(frame)
        for cam in cams:
            scene.camera = cam
            render_to(os.path.join(args.out, f"{cam.name}_f{frame:04d}.png"))
    if args.turntable > 0:
        center, _ = bounds(target)
        pivot = bpy.data.objects.new("QA_turntable_pivot", None)
        scene.collection.objects.link(pivot)
        pivot.location = center
        bpy.context.view_layer.update()
        orbit = bpy.data.objects["QA_3q"].copy()
        scene.collection.objects.link(orbit)
        orbit.parent = pivot
        orbit.matrix_parent_inverse = pivot.matrix_world.inverted()
        scene.camera = orbit
        for i in range(args.turntable):
            pivot.rotation_euler = (0.0, 0.0, 2 * math.pi * i / args.turntable)
            bpy.context.view_layer.update()
            render_to(os.path.join(args.out, f"turntable_{i:04d}.png"))
        bpy.data.objects.remove(orbit)
        bpy.data.objects.remove(pivot)
    print(f"qa_render: {len(frames) * len(cams)} views + {args.turntable} turntable -> {args.out}")


main()
