"""The SoloSquad penguin in clay (contract §5, DESIGN.md `## 에이전트 캐릭터`).

Same character as the 2D icon (web/src/characters/PenguinIcon.tsx, geometry in
web/src/characters/penguinShape.ts): a flat plush-keychain body, taller than wide; one white
felt front that runs from the forehead down the belly and wraps under the bottom; round eyes,
round magenta cheeks (smaller than the eyes); a white diamond beak; black stitches along the
front's edge and the beak's edge; black feet. No ink outline.

Built seated: origin = where the penguin's bottom rests (the chair seat), facing -Y.
"""
import bisect
import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from lib import ellipsoid, join, mesh_object

# Body proportions (m). Seated height 0.70 (contract §2).
H = 0.70     # height
W = 0.44     # widest width (without wings)
D = 0.30     # depth (flat plush)

# ---------------------------------------------------------------------------
# Front view in icon units (viewBox 40, y down) — the same numbers as
# web/src/characters/penguinShape.ts. Keep the two in step.
# ---------------------------------------------------------------------------
# White front, right half, top -> bottom (cubic segments). The left half mirrors it.
# Forehead: one round arch (the white comes up into the forehead). Beside the eyes: a smooth
# convex curve, no notch. Belly: a gentle concave waist. Below the last point the 3D front
# wraps under the bottom; the 2D drawing closes along the body's bottom edge.
FRONT = [
    ((20.0, 11.0), (24.8, 11.0), (28.2, 14.6), (28.9, 19.4)),
    ((28.9, 19.4), (29.5, 23.4), (28.9, 26.8), (28.0, 29.6)),
    ((28.0, 29.6), (27.2, 32.2), (27.6, 36.5), (29.4, 41.5)),
]
EYES = ((16.2, 18.4), (23.8, 18.4))
EYE_R = 1.9
CHEEKS = ((14.2, 22.4), (25.8, 22.4))
CHEEK_R = 1.5
BEAK = (20.0, 21.9)          # centre = the line between the upper and lower beak
BEAK_HALF_W = 2.6
BEAK_UP = 2.6                # upper beak: triangle pointing up
BEAK_DOWN = 3.0              # lower beak: triangle pointing down

# icon -> body-front XZ (m)
_S = 0.017                   # metres per icon unit
EYE_Z = 0.49                 # z of the eye centres


def icon_to_xz(x, y):
    return ((x - 20.0) * _S, EYE_Z - (y - EYES[0][1]) * _S)


def _bez(p0, p1, p2, p3, t):
    u = 1 - t
    return tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d
                 for a, b, c, d in zip(p0, p1, p2, p3))


def front_half(n_per_seg=10):
    """Right half of the white front's edge, top -> bottom, in icon units."""
    pts = []
    for k, seg in enumerate(FRONT):
        last = k == len(FRONT) - 1
        for i in range(n_per_seg + (1 if last else 0)):
            pts.append(_bez(*seg, i / n_per_seg))
    return pts


# ---------------------------------------------------------------------------
# Body
# ---------------------------------------------------------------------------

def _profile(t):
    """Body half-width factor at normalised height t (0 bottom .. 1 top): a tall pear —
    widest a little below the middle, narrowing into a round head."""
    base = math.sin(math.pi * min(max(t, 0.0), 1.0)) ** 0.40
    belly = 1.0 + 0.08 * math.exp(-((t - 0.30) / 0.24) ** 2)
    head = 1.0 - 0.10 * _smooth(0.45, 0.85, t)
    return base * belly * head


def body_mesh():
    """UV-sphere remapped to the plush pear: flat front/back, round edges."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=26, radius=1.0)
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
        # flatten the bottom so it sits: a soft max with the seat plane (no crease, so the
        # white front can wrap under it without the body poking through)
        f, soft = 0.04, 0.035
        nz = 0.5 * (t + f + math.sqrt((t - f) ** 2 + soft * soft))
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


# The white front wraps from the face round the bottom, so it is laid out in a polar
# domain (x, phi): a ray from (x, 0, ZC) inside the body, phi = 0 straight up, 90° straight
# ahead (-Y), 180° straight down.
ZC = 0.26
PHI_UNDER = math.radians(194)    # how far under the bottom the white reaches (to the seat)
PHI_STITCH = math.radians(150)   # the stitch stops where the front turns under the bottom


def _polar(bvh, x, phi):
    d = Vector((0, -math.sin(phi), math.cos(phi)))
    hit = bvh.ray_cast(Vector((x, 0, ZC)), d)
    return hit[0], hit[1]


def _phi_of(p):
    return math.atan2(-p.y, p.z - ZC)


def front_outline(body_bvh, n_under=10):
    """Closed outline of the white front in (x, phi): right side down, under the bottom,
    left side up. Returns a list of (x, phi)."""
    right = []
    for (ix, iy) in front_half():
        x, z = icon_to_xz(ix, iy)
        hit, _ = _project_front(body_bvh, x, z)
        right.append((x, _phi_of(hit)))
    # continue the sides under the bottom, narrowing a little, then close across the seat
    x0, p0 = right[-1]
    for i in range(1, n_under + 1):
        t = i / n_under
        right.append((x0 * (1 - 0.30 * t * t), p0 + (PHI_UNDER - p0) * t))
    xe = right[-1][0]
    bottom = []
    for i in range(1, 7):
        a = (math.pi / 2) * i / 7
        bottom.append((xe * math.cos(a), PHI_UNDER + math.radians(6) * math.sin(a)))
    half = right + bottom
    left = [(-x, p) for (x, p) in reversed(half)]
    # the centre-line points (x == 0) appear once
    return half + left[1:-1]


def front_patch(col, body, mat, thickness=0.010, rings=9):
    """White felt front: outline -> concentric rings -> projected onto the body."""
    bvh = _bvh(body)
    outline = front_outline(bvh)
    cx = 0.0
    cphi = math.radians(110)
    bm = bmesh.new()
    ring_verts = []
    for r in range(rings):
        f = 1 - r / rings
        row = []
        for (x, p) in outline:
            hit, nrm = _polar(bvh, cx + (x - cx) * f, cphi + (p - cphi) * f)
            puff = thickness * (0.55 + 0.45 * (1 - f) ** 0.5)
            row.append(bm.verts.new(hit + nrm * puff))
        ring_verts.append(row)
    centre_hit, cn = _polar(bvh, cx, cphi)
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
    _face_out(ob, Vector((0, 0, ZC)))
    return ob, outline


def _face_out(ob, centre):
    """Flip the mesh if its normals point into the body."""
    me = ob.data
    if sum(p.normal.dot(p.center - centre) for p in me.polygons) < 0:
        bm2 = bmesh.new()
        bm2.from_mesh(me)
        bmesh.ops.reverse_faces(bm2, faces=bm2.faces)
        bm2.to_mesh(me)
        bm2.free()


def _dashes(col, pts, mat, closed, dash=0.012, gap=0.008, r=0.0034, name='stitch'):
    """Dashed stitch along a polyline of (point, normal) on a surface: small flat capsules,
    half sunk into the felt (reads as thread pulled into a seam)."""
    if len(pts) < 2:
        return []
    segs = len(pts) if closed else len(pts) - 1
    lengths, total = [], 0.0
    for i in range(segs):
        lengths.append(total)
        total += (pts[(i + 1) % len(pts)][0] - pts[i][0]).length

    def at(s):
        i = min(max(bisect.bisect_right(lengths, s) - 1, 0), segs - 1)
        a, na = pts[i]
        b, nb = pts[(i + 1) % len(pts)]
        seg = (b - a).length or 1e-6
        t = min(max((s - lengths[i]) / seg, 0.0), 1.0)
        return a.lerp(b, t), na.lerp(nb, t).normalized()

    period = dash + gap
    count = max(int((total + (0 if closed else gap)) // period), 1)
    # spread the slack so a closed stitch has no odd dash where it meets itself
    period = (total + (0 if closed else gap)) / count
    dash = period * dash / (dash + gap)
    parts = []
    for k in range(count):
        s = k * period
        p0, n0 = at(s)
        p1, n1 = at(min(s + dash, total))
        mid = (p0 + p1) / 2
        nrm = (n0 + n1).normalized()
        d = p1 - p0
        ln = d.length
        if ln < 1e-5:
            continue
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=5, v_segments=3, radius=1.0)
        bmesh.ops.scale(bm, vec=(ln / 2 + r * 0.3, r, r * 0.6), verts=bm.verts)
        x_ax = d.normalized()
        z_ax = nrm
        y_ax = z_ax.cross(x_ax).normalized()
        x_ax = y_ax.cross(z_ax).normalized()
        rot = Matrix((x_ax, y_ax, z_ax)).transposed().to_4x4()
        bmesh.ops.transform(bm, matrix=Matrix.Translation(mid - nrm * (r * 0.15)) @ rot, verts=bm.verts)
        parts.append(mesh_object(name, bm, col, mat))
    return parts


def front_stitch(col, body, face, outline, mat, inset=0.015):
    """Stitch just inside the front's edge, on the visible part (stops where it turns under)."""
    bbvh, fbvh = _bvh(body), _bvh(face)
    n = len(outline)
    keep = [i for i, (_, p) in enumerate(outline) if p <= PHI_STITCH]
    # start just after the hidden run under the bottom: left side up, over the forehead, right side down
    hidden = [i for i in range(n) if i not in set(keep)]
    start = (max(hidden) + 1) % n if hidden else 0
    order = [(start + k) % n for k in range(n)]
    order = [i for i in order if outline[i][1] <= PHI_STITCH]
    pts3 = [_polar(bbvh, *outline[i]) for i in order]
    centre = Vector((0, 0, ZC))
    out = []
    for k, (p, nrm) in enumerate(pts3):
        a = pts3[max(k - 1, 0)][0]
        b = pts3[min(k + 1, len(pts3) - 1)][0]
        tan = (b - a).normalized()
        inward = nrm.cross(tan).normalized()
        # inward = toward the middle of the front
        probe, _ = _polar(bbvh, 0.0, math.radians(110))
        if inward.dot(probe - p) < 0:
            inward = -inward
        q = p + inward * inset
        hit, hn = fbvh.find_nearest(q)[:2]
        if hn.dot(hit - centre) < 0:
            hn = -hn
        out.append((hit, hn))
    return _dashes(col, out, mat, closed=False)


def _frame_at(fbvh, x, z):
    """Surface point + an orthonormal frame (right, up, normal) on the face at icon-mapped x, z."""
    hit, nrm = _project_front(fbvh, x, z)
    right = Vector((1, 0, 0))
    right = (right - nrm * right.dot(nrm)).normalized()
    up = nrm.cross(right).normalized()
    if up.z < 0:
        up = -up
    return hit, right, up, nrm


def disc(col, name, r, depth, x, z, mat, fbvh, lift):
    """A round felt disc (eye, cheek): circular in the face's tangent plane."""
    hit, right, up, nrm = _frame_at(fbvh, x, z)
    ob = ellipsoid(name, (r, depth, r), (0, 0, 0), col, mat, 16, 6)
    # local X = right, local Y = into the face (-normal), local Z = up
    rot = Matrix((right, -nrm, up)).transposed().to_4x4()
    ob.matrix_world = Matrix.Translation(hit + nrm * lift) @ rot
    return ob


def _rhombus(u_half, v_up, v_down, n=48, p=1.18):
    """Diamond outline in a tangent plane (u right, v up), soft corners (superellipse p ~ 1)."""
    pts = []
    for i in range(n):
        a = math.tau * i / n
        c, s = math.cos(a), math.sin(a)
        u = u_half * math.copysign(abs(c) ** (2 / p), c)
        v = (v_up if s >= 0 else v_down) * math.copysign(abs(s) ** (2 / p), s)
        pts.append((u, v))
    return pts


def beak(col, face, mat, stitch_mat):
    """White diamond beak: upper triangle up, lower triangle down, a crease between them, and a
    black stitch round the outer edge. Returns [beak, *stitch dashes]."""
    fbvh = _bvh(face)
    bx, bz = icon_to_xz(*BEAK)
    hit, right, up, nrm = _frame_at(fbvh, bx, bz)
    a, vu, vd = BEAK_HALF_W * _S, BEAK_UP * _S, BEAK_DOWN * _S
    outline = _rhombus(a, vu, vd)
    rings = 5
    puff = 0.016

    def base(u, v):
        o = hit + right * u + up * v + nrm * 0.05
        h = fbvh.ray_cast(o, -nrm)
        return (h[0], h[1]) if h[0] is not None else (hit + right * u + up * v, nrm)

    def height(u, v, f):
        lobe = 1.0 if v >= 0 else 0.82                     # the upper beak stands a little prouder
        crease = 1 - 0.45 * math.exp(-(v / (0.10 * vu)) ** 2) * (1 - f ** 4)
        return 0.0015 + puff * lobe * crease * (1 - f * f) ** 0.6

    bm = bmesh.new()
    ring_verts = []
    for r in range(rings):
        f = 1 - r / rings
        row = []
        for (u, v) in outline:
            p, pn = base(u * f, v * f)
            row.append(bm.verts.new(p + pn * height(u * f, v * f, f)))
        ring_verts.append(row)
    p, pn = base(0, 0)
    centre = bm.verts.new(p + pn * height(0, 0, 0))
    n = len(outline)
    for r in range(rings - 1):
        a_, b_ = ring_verts[r], ring_verts[r + 1]
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a_[i], a_[j], b_[j], b_[i]))
    for i in range(n):
        bm.faces.new((ring_verts[-1][i], ring_verts[-1][(i + 1) % n], centre))
    skirt = []
    for (u, v) in outline:
        p, pn = base(u, v)
        skirt.append(bm.verts.new(p - pn * 0.003))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((skirt[i], skirt[j], ring_verts[0][j], ring_verts[0][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_object('beak', bm, col, mat)
    _face_out(ob, hit - nrm * 0.05)
    # stitch: just inside the beak's outer edge, on the beak's surface
    bbvh = _bvh(ob)
    pts = []
    for (u, v) in _rhombus(a * 0.80, vu * 0.80, vd * 0.80, n=64):
        o = hit + right * u + up * v + nrm * 0.05
        h = bbvh.ray_cast(o, -nrm)
        if h[0] is not None:
            hn = h[1] if h[1].dot(nrm) > 0 else -h[1]
            pts.append((h[0], hn))
    dashes = _dashes(col, pts, stitch_mat, closed=True, dash=0.0062, gap=0.0042, r=0.0022, name='beak_stitch')
    return [ob] + dashes


def _smooth(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


# Rig layout (contract §5). Blender coords; the penguin's right is -X.
SHOULDER = Vector((W / 2 - 0.030, 0.0, H * 0.60))
WING_TIP = Vector((W / 2 - 0.015, -0.01, H * 0.19))
NECK_Z = H * 0.44          # body / head blend centre


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
        bone(f'foot.{side}', (sx * FOOT_X, -D / 2 + 0.01, 0.022), (sx * FOOT_X, -D / 2 - 0.06, 0.022), 'root')
    bone('socket.head', (0, 0, H), (0, 0, H + 0.08), 'head', deform=False)
    bone('socket.chest', (0, -D / 2, CHEST_Z), (0, -D / 2 - 0.08, CHEST_Z), 'body', deform=False)
    tip_r = Vector((-WING_TIP.x, WING_TIP.y, WING_TIP.z))
    bone('socket.hand.R', tip_r, tip_r + Vector((0, -0.08, 0)), 'wing.R', deform=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    vl.objects.active = prev_active
    mesh.parent = ob
    mod = mesh.modifiers.new('rig', 'ARMATURE')
    mod.object = ob
    return ob


FOOT_X = 0.080
CHEST_Z = H * 0.33


def build(col, name='penguin'):
    from lib import apply_modifiers, material
    mats = {k: material(k) for k in ('penguin.body', 'penguin.face', 'penguin.cheek',
                                     'penguin.eye', 'penguin.beak', 'penguin.feet',
                                     'penguin.stitch')}
    body = mesh_object('body', body_mesh(), col, mats['penguin.body'])
    face, outline = front_patch(col, body, mats['penguin.face'])
    parts = [body, face]
    parts += front_stitch(col, body, face, outline, mats['penguin.stitch'])
    fbvh = _bvh(face)
    for (x, y) in EYES:
        px, pz = icon_to_xz(x, y)
        parts.append(disc(col, 'eye', EYE_R * _S, 0.008, px, pz, mats['penguin.eye'], fbvh, 0.001))
    for (x, y) in CHEEKS:
        px, pz = icon_to_xz(x, y)
        parts.append(disc(col, 'cheek', CHEEK_R * _S, 0.004, px, pz, mats['penguin.cheek'], fbvh, 0.0))
    parts += beak(col, face, mats['penguin.beak'], mats['penguin.stitch'])
    # wings: flat paddles hugging the sides
    for sx in (-1, 1):
        w = ellipsoid('wing', (0.034, 0.085, 0.155), (0, 0, 0), col, mats['penguin.body'], 16, 10)
        w.matrix_world = (Matrix.Translation((sx * (W / 2 - 0.022), 0.0, H * 0.39)) @
                          Matrix.Rotation(math.radians(-sx * 8), 4, 'Y'))
        parts.append(w)
    # feet: little black paddles poking out from under the white belly
    for sx in (-1, 1):
        f = ellipsoid('foot', (0.052, 0.068, 0.022), (sx * FOOT_X, -D / 2 + 0.030, 0.022), col,
                      mats['penguin.feet'], 14, 7)
        parts.append(f)
    bpy.context.view_layer.update()          # matrix_world of parts placed by .location
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
    for pb in rig_ob.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    for key, val in POSES.get(state, {}).items():
        if key.endswith('@loc'):
            rig_ob.pose.bones[key[:-4]].location = val
        else:
            rig_ob.pose.bones[key].rotation_euler = tuple(math.radians(a) for a in val)
