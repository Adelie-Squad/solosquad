"""Bake one round of the penguin v3 draft into a QA .blend for the skills' checkers
(skills/3d-previz-edit qa_render.py / render_compare.py, skills/rig-motion-clearance
clearance_check.py / motion_path.py):

    B=/Applications/Blender.app/Contents/MacOS/Blender
    $B -b -P assets/office/scripts/identity_v3_qa_blend.py -- --scripts <dir with penguin_v3.py> \\
        --out rounds/r09.blend [--cameras-from rounds/r07.blend]

Timeline (one baked action on the rig, a key every frame; prints the ranges as CLIPS ...):
  0 rest · hop · wave · walk · seated (alone) · raise-max · seated-desk
seated-desk sits the penguin at desk-local (0, +0.27, 0.42) of the office-kit desk.set, which is
placed at x = +5 m so the standing clips never meet it.

Mesh object `penguin_v3`, vertex groups for the checkers (weight 1):
  wing_tip_L / wing_tip_R  the paddle more than 7 cm out from the shoulder pivot (the root and
                           hinge are the seam, not a pair)
  head / body              skin owned by the head / body bone (> 0.5), not wing, not feet
  face                     the eyes, cheeks and beak pieces
  feet                     legs + feet
--cameras-from appends the QA_cameras collection of a baseline .blend, so every round renders
from the identical cameras (qa_render.py never moves existing ones).
Welt meshes (round 11, `penguin_v3_welt.L/R`): their shape-key values are keyed every frame too.

Edit-region boxes for render_compare, from a saved QA .blend:

    $B -b rounds/r11.blend -P assets/office/scripts/identity_v3_qa_blend.py -- \
        --regions renders/r11/regions.json --frames 0,77,168

writes, per QA camera and frame, image-fraction boxes (top-left origin) of `wing` (the wings,
their welts and the skin within 9 cm of each shoulder pivot) and `face` (eyes, cheeks, beak).
"""
import math
import os
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
a = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d  # noqa: E731


def regions(out, frames):
    import json
    from bpy_extras.object_utils import world_to_camera_view
    sc = bpy.context.scene
    mesh = bpy.data.objects['penguin_v3']
    rig = bpy.data.objects['penguin_v3_rig']

    def gw(name):
        vg = mesh.vertex_groups[name]
        return np.array([max([g.weight for g in v.groups if g.group == vg.index] or [0])
                         for v in mesh.data.vertices])
    wing = (gw('wing.L') > 0.01) | (gw('wing.R') > 0.01)
    R = np.array([v.co[:] for v in mesh.data.vertices])
    near = np.zeros(len(R), bool)
    for s_ in 'LR':
        near |= np.linalg.norm(R - np.array(rig.data.bones['wing.' + s_].head_local), axis=1) < 0.09
    face = gw('face') > 0.5
    welts = [o for o in bpy.data.objects if 'welt_side' in o]
    res = {}
    for f in frames:
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        pts = {}
        ev = mesh.evaluated_get(dg)
        me = ev.to_mesh()
        P = [ev.matrix_world @ v.co for v in me.vertices]
        pts['wing'] = [P[i] for i in np.nonzero(wing | near)[0][::2]]
        pts['face'] = [P[i] for i in np.nonzero(face)[0][::2]]
        ev.to_mesh_clear()
        for w in welts:
            ew = w.evaluated_get(dg)
            mw = ew.to_mesh()
            pts['wing'] += [ew.matrix_world @ v.co for v in mw.vertices][::4]
            ew.to_mesh_clear()
        for cam in [o for o in bpy.data.objects if o.name.startswith('QA_') and o.type == 'CAMERA']:
            for key, ps in pts.items():
                vs = [world_to_camera_view(sc, cam, p_) for p_ in ps]
                xs = [v.x for v in vs if v.z > 0]
                ys = [1 - v.y for v in vs if v.z > 0]
                if xs:
                    res.setdefault(f'{cam.name}_f{f:04d}', {})[key] = [min(xs), min(ys), max(xs), max(ys)]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    json.dump(res, open(out, 'w'), indent=1)
    print('wrote', out)


if '--regions' in argv:
    regions(a('--regions'), [int(x) for x in a('--frames', '0,77,168').split(',')])
    sys.exit(0)
SD = os.path.abspath(a('--scripts', os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.abspath(a('--out', 'qa.blend'))
CAMS = a('--cameras-from')
sys.path.insert(0, SD)
import lib  # noqa: E402
import penguin_v3 as pv3  # noqa: E402

DESK_X = 5.0

bpy.ops.wm.read_factory_settings(use_empty=True)
col = lib.collection('penguin_v3')
mesh = pv3.build(col)
rig = pv3.rig(col, mesh)
mesh.name = 'penguin_v3'
rig.name = 'penguin_v3_rig'

# --- vertex groups ------------------------------------------------------------------------
V = np.array([v.co[:] for v in mesh.data.vertices])
n = len(V)


def gw(name):
    w = np.zeros(n)
    vg = mesh.vertex_groups.get(name)
    if vg is None:
        return w
    for v in mesh.data.vertices:
        for g in v.groups:
            if g.group == vg.index:
                w[v.index] = g.weight
    return w


mi = np.empty(len(mesh.data.polygons), int)
mesh.data.polygons.foreach_get('material_index', mi)
face = np.zeros(n, bool)
for p in mesh.data.polygons:
    if p.material_index > 0:
        face[list(p.vertices)] = True
feet = np.maximum.reduce([gw(k) for k in ('leg.L', 'leg.R', 'foot.L', 'foot.R')]) > 0.5
wing = {s: gw('wing.' + s) for s in 'LR'}
anywing = (wing['L'] > 0.5) | (wing['R'] > 0.5)
groups = {
    'wing_tip_L': (wing['L'] > 0.99) & (pv3._wing_local(V, 'L')[:, 0] > 0.07) & ~face,
    'wing_tip_R': (wing['R'] > 0.99) & (pv3._wing_local(V, 'R')[:, 0] > 0.07) & ~face,
    'head': (gw('head') > 0.5) & ~anywing & ~face & ~feet,
    'body': (gw('body') > 0.5) & ~anywing & ~face & ~feet,
    'face': face,
    'feet': feet & ~face,
}
for name, m in groups.items():
    vg = mesh.vertex_groups.new(name=name)
    vg.add([int(i) for i in np.nonzero(m)[0]], 1.0, 'REPLACE')

# --- desk set -----------------------------------------------------------------------------
import kit  # noqa: E402
kcol = lib.collection('kit')
before = set(bpy.data.objects)
root = kit.desk_set(kcol)
for o in bpy.data.objects:
    if o not in before and o.parent is None:
        o.location.x += DESK_X
props = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
for i, o in enumerate(props):
    o.name = f'prop_{i:02d}_{o.name}'

# --- timeline -----------------------------------------------------------------------------
rest = pv3._bone_rest(rig)
mx = getattr(pv3, 'WING_RAISE_MAX', 128)
tw = -getattr(pv3, 'WING_TWIST_MAX', 78)


def raise_max(r, f, rs):
    pv3.reset_pose(r)
    pv3._set(r, rs, 'wing.L', pv3._wing_raise('L', mx, tw))
    pv3._set(r, rs, 'wing.R', pv3._wing_raise('R', mx, tw))


clips = [('rest', 1, lambda r, f, rs: pv3.reset_pose(r))]
clips += [(k, length, fn) for k, (length, fn) in pv3.CLIPS.items()]
clips += [('seated', 1, lambda r, f, rs: pv3.pose_seated(r, 0, rs, (0.0, 0.0, 0.0))),
          ('raise-max', 1, raise_max),
          ('seated-desk', 1, lambda r, f, rs: pv3.pose_seated(r, 0, rs, (DESK_X, 0.27, pv3.SEAT_Z)))]
rig.animation_data_create()
act = bpy.data.actions.new('qa_timeline')
rig.animation_data.action = act
for pb in rig.pose.bones:
    pb.rotation_mode = 'QUATERNION'
start = 0
ranges = []
welts = [o for o in bpy.data.objects if 'welt_side' in o and o.data.shape_keys]
for name, length, fn in clips:
    for f in range(length):
        fn(rig, f, rest)
        for pb in rig.pose.bones:
            if pb.name.startswith('socket.'):
                continue
            for path in ('location', 'rotation_quaternion', 'scale'):
                pb.keyframe_insert(path, frame=start + f)
        for w in welts:                       # the welt's hinge-driven shape keys
            for kb in w.data.shape_keys.key_blocks[1:]:
                kb.keyframe_insert('value', frame=start + f)
    ranges.append((name, start, start + length - 1))
    start += length + 10          # 10 frame gap between clips (never checked)
sc = bpy.context.scene
sc.frame_start, sc.frame_end = 0, start
for fc in getattr(act, 'fcurves', []):
    for kp in fc.keyframe_points:
        kp.interpolation = 'LINEAR'
sc['qa_clips'] = ';'.join(f'{nm}={a_}-{b_}' for nm, a_, b_ in ranges)
pv3.reset_pose(rig)
sc.frame_set(0)

# --- light + render settings (the draft's light theme; Workbench previz can't show the
# black / white leather boundary, so colour checks use qa_render --quality final) -----------
import frames  # noqa: E402
frames.render_settings('/tmp/qa.png', int(a('--samples', '32')))
frames.world('light')
frames.sun('light')
sc.render.film_transparent = False

# --- baseline QA cameras ------------------------------------------------------------------
if CAMS:
    with bpy.data.libraries.load(CAMS, link=False) as (src, dst):
        dst.collections = [c for c in src.collections if c == 'QA_cameras']
    for c in dst.collections:
        sc.collection.children.link(c)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('CLIPS', sc['qa_clips'])
print('PROPS', ','.join(o.name for o in props))
print('saved', OUT)
