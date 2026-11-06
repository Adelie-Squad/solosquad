"""The SoloSquad penguin in clay (contract §5, DESIGN.md `## 에이전트 캐릭터`).

Same character as the 2D icon (web/src/characters/PenguinIcon.tsx): a flat, plump
plush-keychain silhouette, a heart-shaped white face (felt patch), magenta cheeks and a
stitch running just inside the face edge — a shallow groove, no ink outline.

Built seated: origin = where the penguin's bottom rests (the chair seat), facing -Y.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from lib import ellipsoid, join, material, mesh_object

# Body proportions (m). Seated height ~0.55 (contract §2).
H = 0.60     # height
W = 0.50     # widest width
D = 0.29     # depth (flat plush)

# 2D icon face heart path (viewBox 40), as absolute cubic segments.
_HEART = [
    ((20, 35.5), (13.4, 35.5), (9, 31.9), (9, 26.3)),
    ((9, 26.3), (9, 22.9), (10.6, 20.3), (12.9, 18.7)),
    ((12.9, 18.7), (12.3, 17.8), (12.0, 16.8), (12.0, 15.7)),
    ((12.0, 15.7), (12.0, 12.8), (14.2, 10.7), (17.0, 10.7)),
    ((17.0, 10.7), (18.2, 10.7), (19.2, 11.1), (20.0, 11.7)),
    ((20.0, 11.7), (20.8, 11.1), (21.8, 10.7), (23.0, 10.7)),
    ((23.0, 10.7), (25.8, 10.7), (28.0, 12.8), (28.0, 15.7)),
    ((28.0, 15.7), (28.0, 16.8), (27.7, 17.8), (27.1, 18.7)),
    ((27.1, 18.7), (29.4, 20.3), (31.0, 22.9), (31.0, 26.3)),
    ((31.0, 26.3), (31.0, 31.9), (26.6, 35.5), (20.0, 35.5)),
]

# Icon feature anchors (viewBox units)
_EYE = ((16.4, 18.6), (23.6, 18.6))
_CHEEK = ((13.6, 22.6), (26.4, 22.6))
_BEAK = (20.0, 22.1)


def _bez(p0, p1, p2, p3, t):
    u = 1 - t
    return tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d
                 for a, b, c, d in zip(p0, p1, p2, p3))


def heart_outline(n_per_seg=12):
    pts = []
    for seg in _HEART:
        for i in range(n_per_seg):
            pts.append(_bez(*seg, i / n_per_seg))
    return pts


# Map icon coords (x 9..31 face width, y down) into body-front XZ (m).
FACE_W = 0.35                 # heart width on the body
FACE_TOP = H * 0.93           # z of the heart's top lobes
_S = FACE_W / 22.0            # metres per icon unit


def icon_to_xz(x, y):
    return ((x - 20.0) * _S, FACE_TOP - (y - 10.7) * _S)


def _profile(t):
    """Body half-width factor at normalised height t (0 bottom .. 1 top): a plump pear."""
    # widest a little below the middle, rounded top, slightly tucked bottom
    import math as m
    base = m.sin(m.pi * min(max(t, 0.0), 1.0)) ** 0.42
    belly = 1.0 + 0.10 * m.exp(-((t - 0.32) / 0.22) ** 2)
    return base * belly


def body_mesh():
    """UV-sphere remapped to the plush pear: flat front/back, round edges."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=28, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        t = (z + 1) / 2                      # 0..1 bottom..top
        r = math.sqrt(max(1 - z * z, 0))     # sphere ring radius
        k = _profile(t) / max(r, 1e-4) if r > 1e-4 else 0
        # squarish cross-section for a stuffed-toy feel
        ang = math.atan2(y, x)
        c, s = math.cos(ang), math.sin(ang)
        p = 2.6
        sq = (abs(c) ** p + abs(s) ** p) ** (-1 / p)
        rr = r * k * (1 + 0.18 * (sq - 1))
        nz = t
        # flatten the bottom so it sits
        if t < 0.08:
            nz = 0.08 - (0.08 - t) * 0.35
        v.co = Vector((c * rr * W / 2, s * rr * D / 2, nz * H))
    return bm


def _bvh(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    return BVHTree.FromObject(ob.evaluated_get(dg), dg)


def _project_front(bvh, x, z, offset=0.0):
    hit = bvh.ray_cast(Vector((x, -1.0, z)), Vector((0, 1, 0)))
    if hit[0] is None:
        return None, None
    return hit[0] + hit[1] * offset, hit[1]


def face_patch(col, body, mat, thickness=0.010):
    """Heart felt patch: outline -> concentric rings -> projected onto the body front."""
    bvh = _bvh(body)
    outline = [icon_to_xz(*p) for p in heart_outline(14)]
    cx, cz = icon_to_xz(20.0, 24.0)
    bm = bmesh.new()
    rings = 9
    ring_verts = []
    for r in range(rings):
        f = 1 - r / rings
        f = f ** 0.9
        row = []
        for (x, z) in outline:
            px, pz = cx + (x - cx) * f, cz + (z - cz) * f
            hit, nrm = _project_front(bvh, px, pz)
            # lift slightly more toward the centre (felt puff)
            puff = thickness * (0.55 + 0.45 * (1 - f) ** 0.5)
            row.append(bm.verts.new(hit + nrm * puff))
        ring_verts.append(row)
    centre_hit, cn = _project_front(bvh, cx, cz)
    centre = bm.verts.new(centre_hit + cn * thickness)
    n = len(outline)
    for r in range(rings - 1):
        a, b = ring_verts[r], ring_verts[r + 1]
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    last = ring_verts[-1]
    for i in range(n):
        bm.faces.new((last[i], last[(i + 1) % n], centre))
    # edge skirt: tuck the outer ring into the body so there is no gap
    skirt = []
    for v in ring_verts[0]:
        hit, nrm = bvh.find_nearest(v.co)[:2]
        skirt.append(bm.verts.new(hit - nrm * 0.004))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((skirt[i], skirt[j], ring_verts[0][j], ring_verts[0][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_object('face', bm, col, mat)
    # make normals face outward (-Y)
    me = ob.data
    if sum(p.normal.y for p in me.polygons) > 0:
        bm2 = bmesh.new(); bm2.from_mesh(me)
        bmesh.ops.reverse_faces(bm2, faces=bm2.faces)
        bm2.to_mesh(me); bm2.free()
    return ob


def stitch(col, face, mat, inset=0.86, dash=0.010, gap=0.008, r=0.0035):
    """Dashed stitch just inside the face edge, sunk into the felt (reads as a groove)."""
    bvh = _bvh(face)
    cx, cz = icon_to_xz(20.0, 24.0)
    outline = [icon_to_xz(*p) for p in heart_outline(40)]
    pts = []
    for x, z in outline:
        px, pz = cx + (x - cx) * inset, cz + (z - cz) * inset
        hit, nrm = _project_front(bvh, px, pz)
        if hit is not None:
            pts.append((hit, nrm))
    # walk the polyline placing dashes
    parts = []
    acc, on, seg_start = 0.0, True, 0
    pos = []
    total = 0.0
    for i in range(len(pts)):
        a, b = pts[i][0], pts[(i + 1) % len(pts)][0]
        pos.append((total, i))
        total += (b - a).length
    period = dash + gap
    k = 0
    import bisect
    lengths = [p[0] for p in pos]

    def at(s):
        i = max(bisect.bisect_right(lengths, s) - 1, 0)
        a, na = pts[i]
        b, nb = pts[(i + 1) % len(pts)]
        seg = (b - a).length or 1e-6
        t = (s - lengths[i]) / seg
        return a.lerp(b, t), na.lerp(nb, t).normalized()

    s = 0.0
    while s + dash < total:
        p0, n0 = at(s)
        p1, n1 = at(s + dash)
        mid = (p0 + p1) / 2
        nrm = (n0 + n1).normalized()
        d = (p1 - p0)
        ln = d.length
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=4, radius=1.0)
        bmesh.ops.scale(bm, vec=(ln / 2 + r * 0.3, r, r * 0.6), verts=bm.verts)
        x_ax = d.normalized()
        z_ax = nrm
        y_ax = z_ax.cross(x_ax).normalized()
        x_ax = y_ax.cross(z_ax).normalized()
        rot = Matrix((x_ax, y_ax, z_ax)).transposed().to_4x4()
        bmesh.ops.transform(bm, matrix=Matrix.Translation(mid - nrm * (r * 0.15)) @ rot, verts=bm.verts)
        parts.append(mesh_object('stitch', bm, col, mat))
        s += period
    return join(parts, 'stitch') if parts else None


def _feature(col, name, radii, x, z, mat, bvh, lift, tilt_to_normal=True):
    hit, nrm = _project_front(bvh, x, z)
    ob = ellipsoid(name, radii, (0, 0, 0), col, mat, 20, 10)
    # orient local Y along -normal so the flat side hugs the surface
    y_ax = -nrm
    z_ax = Vector((0, 0, 1))
    x_ax = y_ax.cross(z_ax).normalized()
    z_ax = x_ax.cross(y_ax).normalized()
    rot = Matrix((x_ax, y_ax, z_ax)).transposed().to_4x4()
    ob.matrix_world = Matrix.Translation(hit + nrm * lift) @ rot
    return ob


# Rig layout (contract §5). Blender coords; the penguin's right is -X.
SHOULDER = Vector((W / 2 - 0.035, 0.0, H * 0.62))
WING_TIP = Vector((W / 2 - 0.02, -0.01, H * 0.18))
NECK_Z = H * 0.42          # body / head blend centre


def _smooth(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def _skin(p):
    """Vertex groups by part: wings and feet rigid, everything else blends body -> head."""
    kind = p.name.split('.')[0]
    vg = {}

    def g(n):
        if n not in vg:
            vg[n] = p.vertex_groups.new(name=n)
        return vg[n]
    for v in p.data.vertices:
        co = v.co
        if kind == 'wing':
            g('wing.L' if co.x > 0 else 'wing.R').add([v.index], 1.0, 'REPLACE')
        elif kind == 'foot':
            g('foot.L' if co.x > 0 else 'foot.R').add([v.index], 1.0, 'REPLACE')
        else:
            h = _smooth(NECK_Z - 0.08, NECK_Z + 0.08, co.z)
            if h > 0:
                g('head').add([v.index], h, 'REPLACE')
            if h < 1:
                g('body').add([v.index], 1 - h, 'REPLACE')


def rig(col, mesh, name='penguin_rig'):
    """Armature: root · body · head · wing.L/R · foot.L/R + socket.head/chest/hand.R."""
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    col.objects.link(ob)
    vl = bpy.context.view_layer
    prev_active = vl.objects.active
    vl.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones

    def bone(n, head, tail, parent=None, deform=True):
        b = eb.new(n)
        b.head, b.tail = Vector(head), Vector(tail)
        b.parent = eb[parent] if parent else None
        b.use_deform = deform
        return b
    bone('root', (0, 0, 0), (0, 0.12, 0), deform=False)
    bone('body', (0, 0, 0.02), (0, 0, NECK_Z), 'root')
    bone('head', (0, 0, NECK_Z), (0, 0, H), 'body')
    for sx, side in ((1, 'L'), (-1, 'R')):
        sh = Vector((sx * SHOULDER.x, SHOULDER.y, SHOULDER.z))
        tip = Vector((sx * WING_TIP.x, WING_TIP.y, WING_TIP.z))
        bone(f'wing.{side}', sh, tip, 'body')
        bone(f'foot.{side}', (sx * 0.085, -D / 2 + 0.01, 0.022), (sx * 0.085, -D / 2 - 0.06, 0.022), 'root')
    bone('socket.head', (0, 0, H), (0, 0, H + 0.08), 'head', deform=False)
    bone('socket.chest', (0, -D / 2, 0.2), (0, -D / 2 - 0.08, 0.2), 'body', deform=False)
    tip_r = Vector((-WING_TIP.x, WING_TIP.y, WING_TIP.z))
    bone('socket.hand.R', tip_r, tip_r + Vector((0, -0.08, 0)), 'wing.R', deform=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    vl.objects.active = prev_active
    mesh.parent = ob
    mod = mesh.modifiers.new('rig', 'ARMATURE')
    mod.object = ob
    return ob


def build(col, name='penguin'):
    mats = {k: material(k) for k in ('penguin.body', 'penguin.face', 'penguin.cheek',
                                     'penguin.eye', 'penguin.beak', 'penguin.feet',
                                     'penguin.stitch')}
    body = mesh_object('body', body_mesh(), col, mats['penguin.body'])
    face = face_patch(col, body, mats['penguin.face'])
    parts = [body, face]
    st = stitch(col, face, mats['penguin.stitch'])
    if st:
        parts.append(st)
    fbvh = _bvh(face)
    for (x, y) in _EYE:
        px, pz = icon_to_xz(x, y)
        parts.append(_feature(col, 'eye', (0.020, 0.008, 0.027), px, pz, mats['penguin.eye'], fbvh, 0.001))
    for (x, y) in _CHEEK:
        px, pz = icon_to_xz(x, y)
        parts.append(_feature(col, 'cheek', (0.027, 0.004, 0.017), px, pz, mats['penguin.cheek'], fbvh, 0.0))
    # beak: a soft rounded triangle pointing down
    px, pz = icon_to_xz(*_BEAK)
    hit, nrm = _project_front(fbvh, px, pz)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=3, radius1=0.028, radius2=0.0, depth=0.03)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)
    beak = mesh_object('beak', bm, col, mats['penguin.beak'])
    sub = beak.modifiers.new('sub', 'SUBSURF'); sub.levels = 2; sub.render_levels = 2
    beak.matrix_world = (Matrix.Translation(hit + nrm * 0.006) @
                         Matrix.Rotation(math.radians(90), 4, 'X') @
                         Matrix.Rotation(math.radians(180), 4, 'Z') @
                         Matrix.Diagonal((1.0, 0.75, 0.55, 1)))
    beak.rotation_euler.z += 0  # keep
    parts.append(beak)
    # wings: flat paddles hugging the sides
    for sx in (-1, 1):
        w = ellipsoid('wing', (0.035, 0.085, 0.14), (0, 0, 0), col, mats['penguin.body'], 24, 12)
        w.matrix_world = (Matrix.Translation((sx * (W / 2 - 0.03), 0.0, H * 0.40)) @
                          Matrix.Rotation(math.radians(-sx * 9), 4, 'Y'))
        parts.append(w)
    # feet: little orange paddles poking out front
    for sx in (-1, 1):
        f = ellipsoid('foot', (0.05, 0.065, 0.022), (sx * 0.085, -D / 2 + 0.035, 0.022), col,
                      mats['penguin.feet'], 20, 10)
        parts.append(f)
    from lib import apply_modifiers
    for p in parts:
        if p.modifiers:
            apply_modifiers(p)
        p.data.transform(p.matrix_world)
        p.matrix_world = Matrix.Identity(4)
        _skin(p)
    ob = join(parts, name)
    ob.data.transform(ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    ob.data.shade_smooth()
    return ob


# ---------------------------------------------------------------------------
# Key poses per state (degrees, bone-local XYZ euler; body/head X- = lean forward,
# wing X- = swing forward, wing outward = L Z- / R Z+). Locations are bone-local
# (Y = up for body). The animation clips in anim.py move around these.
# ---------------------------------------------------------------------------
POSES = {
    'idle': {},
    'idle_doze': {'head': (-20, 0, 4), 'body': (-4, 0, 3)},
    'thinking': {'head': (14, 10, 0), 'body': (0, 0, 5), 'wing.R': (-62, 0, -12)},
    'typing': {'body': (-9, 0, 0), 'head': (-6, 0, 0), 'wing.L': (-72, 0, 8), 'wing.R': (-72, 0, -8)},
    'waiting': {'wing.R': (0, 0, 150), 'head': (6, 0, -6), 'body': (0, 0, -4)},
    'done': {'wing.L': (0, 0, -140), 'wing.R': (0, 0, 140), 'head': (10, 0, 0),
             'body@loc': (0, 0.05, 0)},
    'error': {'head': (-26, 0, 0), 'body': (-8, 0, 0), 'wing.L': (0, 0, 6), 'wing.R': (0, 0, -6)},
}


def apply_pose(rig_ob, state):
    import math as m
    for pb in rig_ob.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
    for key, val in POSES.get(state, {}).items():
        if key.endswith('@loc'):
            rig_ob.pose.bones[key[:-4]].location = val
        else:
            rig_ob.pose.bones[key].rotation_euler = tuple(m.radians(a) for a in val)

