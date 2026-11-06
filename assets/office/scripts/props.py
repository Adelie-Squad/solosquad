"""Role props (contract §5): one mesh per part, named `prop.<agent-id>.<part>`, with a
custom property `socket` = head | chest | hand.R. Built in penguin space at the rest pose
(seated origin, facing -Y), so a prop sits right on an unrigged penguin; the export parents
each one to its socket bone keeping that transform.

Penguin right = -X (it faces -Y). Colours: `team_accent` is painted by the web per team;
everything else uses fixed `prop.*` materials.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import penguin as P
from lib import box, cylinder, ellipsoid, join, material, mesh_object, set_auto_smooth

ACC = 'team_accent'

# Socket anchors in penguin space (rest pose)
HEAD_TOP = Vector((0, 0, P.H - 0.005))
HAND_R = Vector((-P.WING_TIP.x, P.WING_TIP.y - 0.05, P.WING_TIP.z + 0.03))  # just in front of the right wing tip


def M(name):
    return material(name)


def _xf(ob, m):
    ob.matrix_world = m @ ob.matrix_world
    return ob


def _bake(ob):
    ob.data.transform(ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    return ob


def torus(name, R, r, col, mat, seg=40, ring=10, arc=math.tau):
    bm = bmesh.new()
    closed = abs(arc - math.tau) < 1e-6
    n = seg if closed else seg + 1
    rows = []
    for i in range(n):
        a = arc * i / seg
        c = Vector((math.cos(a) * R, math.sin(a) * R, 0))
        out = Vector((math.cos(a), math.sin(a), 0))
        row = []
        for j in range(ring):
            b = math.tau * j / ring
            row.append(bm.verts.new(c + out * (math.cos(b) * r) + Vector((0, 0, math.sin(b) * r))))
        rows.append(row)
    for i in range(n if closed else n - 1):
        a, b = rows[i], rows[(i + 1) % n]
        for j in range(ring):
            k = (j + 1) % ring
            bm.faces.new((a[j], b[j], b[k], a[k]))
    if not closed:
        for row in (rows[0], rows[-1]):
            bm.faces.new(row if row is rows[-1] else list(reversed(row)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm, col, mat)


class Body:
    """Raycasts against the penguin rest mesh to place props on its surface."""

    def __init__(self, ob):
        dg = bpy.context.evaluated_depsgraph_get()
        self.bvh = BVHTree.FromObject(ob.evaluated_get(dg), dg)

    def front(self, x, z):
        hit = self.bvh.ray_cast(Vector((x, -1, z)), Vector((0, 1, 0)))
        return hit[0], hit[1]

    def top(self, x=0.0, y=0.0):
        hit = self.bvh.ray_cast(Vector((x, y, 2)), Vector((0, 0, -1)))
        return hit[0]

    def ring(self, z, n=48):
        pts = []
        for i in range(n):
            a = math.tau * i / n
            d = Vector((math.cos(a), math.sin(a), 0))
            hit = self.bvh.ray_cast(Vector((0, 0, z)), d)   # inside-out: skip wings/face
            pts.append(hit[0])
        return pts


def _facing(nrm):
    """Rotation whose -Y points along the surface normal (prop faces out)."""
    y = -nrm.normalized()
    x = y.cross(Vector((0, 0, 1))).normalized()
    z = x.cross(y).normalized()
    return Matrix((x, y, z)).transposed().to_4x4()


def _finish(ob, name, socket):
    ob = _bake(ob)
    ob.name = name
    ob.data.name = name
    ob['socket'] = socket
    set_auto_smooth(ob)
    return ob


# ---------------------------------------------------------------------------
# Head props
# ---------------------------------------------------------------------------

def crown(col, body):
    top = body.top()
    parts = [cylinder('band', 0.075, 0.035, (0, 0, 0.0175), col, M('prop.gold'), 20, 0.004)]
    for i in range(5):
        a = math.tau * i / 5 + math.pi / 2
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.022, radius2=0.002, depth=0.05)
        sp = mesh_object('spike', bm, col, M('prop.gold'))
        sp.matrix_world = Matrix.Translation((math.cos(a) * 0.062, math.sin(a) * 0.062, 0.055))
        parts.append(sp)
        parts.append(ellipsoid('ball', (0.009,) * 3, (math.cos(a) * 0.062, math.sin(a) * 0.062, 0.082),
                               col, M('prop.gold'), 8, 4))
    ob = join(parts, 'crown')
    ob.matrix_world = Matrix.Translation(top - Vector((0, 0, 0.012))) @ Matrix.Rotation(math.radians(-8), 4, 'Y') @ ob.matrix_world
    return _finish(ob, 'prop.chief.crown', 'head')


def beret(col, body):
    top = body.top(0.02, 0.0)
    parts = [ellipsoid('beret', (0.17, 0.15, 0.045), (0, 0, 0), col, M(ACC), 24, 10),
             cylinder('stem', 0.008, 0.03, (0, 0, 0.05), col, M(ACC), 10, 0.0)]
    ob = join(parts, 'beret')
    ob.matrix_world = Matrix.Translation(top + Vector((0.02, 0, 0.005))) @ Matrix.Rotation(math.radians(-16), 4, 'Y') @ ob.matrix_world
    return _finish(ob, 'prop.product-designer.beret', 'head')


def _half_shell(col, rx, ry, rz, z0, mat, name, seg=20, rings=6):
    """Upper half-ellipsoid shell (cap) with its rim at z0."""
    bm = bmesh.new()
    rows = []
    for j in range(rings):
        phi = (math.pi / 2) * j / rings
        rows.append([bm.verts.new((math.cos(math.tau * i / seg) * math.cos(phi) * rx,
                                   math.sin(math.tau * i / seg) * math.cos(phi) * ry,
                                   z0 + math.sin(phi) * rz)) for i in range(seg)])
    pole = bm.verts.new((0, 0, z0 + rz))
    for j in range(rings - 1):
        a, b = rows[j], rows[j + 1]
        for i in range(seg):
            k = (i + 1) % seg
            bm.faces.new((a[i], a[k], b[k], b[i]))
    for i in range(seg):
        bm.faces.new((rows[-1][i], rows[-1][(i + 1) % seg], pole))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_object(name, bm, col, mat)
    mod = ob.modifiers.new('solid', 'SOLIDIFY')
    mod.thickness = 0.012
    mod.offset = 1.0
    from lib import apply_modifiers
    apply_modifiers(ob)
    return ob


def _head_size(body, z):
    pts = body.ring(z, 16)
    return max(abs(p.x) for p in pts), max(abs(p.y) for p in pts)


def beanie(col, body):
    z = P.H - 0.085
    rx, ry = _head_size(body, z)
    top = body.top().z
    cap = _half_shell(col, rx * 0.97, ry * 0.97 + 0.01, top - z + 0.085, z, M(ACC), 'beanie_cap')
    rim = _ellipse_tube(col, rx * 0.97 + 0.006, ry * 0.97 + 0.016, z + 0.01, 0.024, M(ACC), 'beanie_rim', seg=20)
    pom = ellipsoid('pom', (0.038,) * 3, (0, 0, top + 0.1), col, M('prop.paper'), 10, 6)
    ob = join([cap, rim, pom], 'beanie')
    return _finish(ob, 'prop.frontend-engineer.beanie', 'head')


def hardhat(col, body):
    z = P.H - 0.075
    rx, ry = _head_size(body, z)
    top = body.top().z
    cap = _half_shell(col, rx * 0.98, ry * 0.98 + 0.012, top - z + 0.07, z, M('prop.helmet'), 'hat')
    brim = _ellipse_tube(col, rx * 0.98 + 0.035, ry * 0.98 + 0.045, z + 0.005, 0.014, M('prop.helmet'), 'brim', flat=0.45, seg=20)
    ridge = box('ridge', (0.03, 2 * ry * 0.75, 0.02), (0, 0, top + 0.072), col, M('prop.helmet'), 0.009, 2)
    ob = join([cap, brim, ridge], 'hardhat')
    return _finish(ob, 'prop.infra.hardhat', 'head')


def _ellipse_tube(col, rx, ry, z, r, mat, name, flat=1.0, seg=24):
    pts = [Vector((math.cos(math.tau * i / seg) * rx, math.sin(math.tau * i / seg) * ry, z)) for i in range(seg)]
    return _ring_tube(col, pts, r, mat, name, flat=flat, ring=6)


def _ring_tube(col, pts, r, mat, name, grow=0.0, flat=1.0, ring=10):
    """Closed tube through points (pushed outward by `grow` from the centre)."""
    c = sum(pts, Vector()) / len(pts)
    bm = bmesh.new()
    rows = []
    n = len(pts)
    for i, p in enumerate(pts):
        out = (p - c); out.z = 0; out.normalize()
        q = p + out * grow
        row = []
        for j in range(ring):
            b = math.tau * j / ring
            row.append(bm.verts.new(q + out * (math.cos(b) * r) + Vector((0, 0, math.sin(b) * r * flat))))
        rows.append(row)
    for i in range(n):
        a, b2 = rows[i], rows[(i + 1) % n]
        for j in range(ring):
            k = (j + 1) % ring
            bm.faces.new((a[j], b2[j], b2[k], a[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm, col, mat)


def headset(col, body):
    z_ear = 0.43
    ring = body.ring(z_ear, 4)                     # +X, +Y, -X, -Y hits
    right, left = ring[2], ring[0]
    parts = []
    # band over the head: half torus in the XZ plane
    span = (left.x - right.x) / 2 + 0.03
    band = torus('band', span, 0.011, col, M('prop.black'), 18, 6, arc=math.pi)
    band.matrix_world = Matrix.Translation((0, 0.0, z_ear + 0.02)) @ Matrix.Rotation(math.radians(90), 4, 'X')
    # stretch vertically to clear the head top
    band.matrix_world = band.matrix_world @ Matrix.Diagonal((1, 1.0, 1, 1))
    _bake(band)
    scale_z = (P.H + 0.03 - (z_ear + 0.02)) / span
    band.data.transform(Matrix.Translation((0, 0, z_ear + 0.02)) @ Matrix.Diagonal((1, 1, scale_z, 1)) @ Matrix.Translation((0, 0, -(z_ear + 0.02))))
    parts.append(band)
    for p, sx in ((right, -1), (left, 1)):
        cup = cylinder('cup', 0.045, 0.035, (0, 0, 0), col, M(ACC), 14, 0.006)
        cup.matrix_world = Matrix.Translation(p + Vector((sx * 0.012, 0, 0))) @ Matrix.Rotation(math.radians(90), 4, 'Y')
        parts.append(cup)
    # mic boom from the right cup toward the beak
    mic = cylinder('boom', 0.006, 0.16, (0, 0, 0), col, M('prop.black'), 8, 0.0)
    mic.matrix_world = (Matrix.Translation(right + Vector((0.035, -0.07, -0.06))) @
                        Matrix.Rotation(math.radians(70), 4, 'X') @ Matrix.Rotation(math.radians(-35), 4, 'Y'))
    parts.append(mic)
    tip_x = right.x + 0.035 + 0.08 * math.sin(math.radians(35))
    parts.append(ellipsoid('mic', (0.015,) * 3, (tip_x + 0.03, right.y - 0.15, right.z - 0.09), col, M('prop.black'), 12, 8))
    ob = join(parts, 'headset')
    return _finish(ob, 'prop.backend-engineer.headset', 'head')


def glasses(col, body, name, frame_mat):
    parts = []
    for (x, y) in P._EYE:
        px, pz = P.icon_to_xz(x, y)
        hit, nrm = body.front(px, pz)
        t = torus('rim', 0.036, 0.0045, col, frame_mat, 20, 5)
        t.matrix_world = Matrix.Translation(hit + nrm * 0.028) @ _facing(nrm) @ Matrix.Rotation(math.radians(90), 4, 'X')
        parts.append(t)
    lx, lz = P.icon_to_xz(*P._EYE[0])
    rx, _ = P.icon_to_xz(*P._EYE[1])
    hit, nrm = body.front(0, lz)
    parts.append(box('bridge', (abs(rx - lx) - 0.07, 0.008, 0.008), hit + nrm * 0.03 + Vector((0, 0, 0.006)), col, frame_mat, 0.003, 1))
    # temples back to the sides of the head
    for sx in (-1, 1):
        ring = body.ring(lz, 4)
        side = ring[0] if sx > 0 else ring[2]
        front_pt = Vector((sx * (abs(lx) + 0.036), side.y - 0.02, lz))
        tip = side + Vector((sx * 0.01, 0.04, 0))
        d = tip - front_pt
        temple = cylinder('temple', 0.004, d.length, (0, 0, 0), col, frame_mat, 6, 0.0)
        z = d.normalized(); x = z.cross(Vector((0, 0, 1))).normalized(); y = z.cross(x)
        temple.matrix_world = Matrix.Translation((front_pt + tip) / 2) @ Matrix((x, y, z)).transposed().to_4x4()
        parts.append(temple)
    ob = join(parts, 'glasses')
    return _finish(ob, name, 'head')


# ---------------------------------------------------------------------------
# Chest props
# ---------------------------------------------------------------------------

def _chest(body, z, out=0.0):
    hit, nrm = body.front(0, z)
    return Matrix.Translation(hit + nrm * out) @ _facing(nrm)


def bowtie(col, body):
    parts = []
    for sx in (-1, 1):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.032, radius2=0.012, depth=0.05)
        w = mesh_object('wing', bm, col, M(ACC))
        w.matrix_world = Matrix.Translation((sx * 0.028, 0, 0)) @ Matrix.Rotation(math.radians(sx * 90), 4, 'Y') @ Matrix.Diagonal((1, 0.55, 1, 1))
        parts.append(w)
    parts.append(ellipsoid('knot', (0.016, 0.012, 0.016), (0, -0.004, 0), col, M(ACC), 12, 8))
    ob = join(parts, 'bowtie')
    _bake(ob)
    ob.matrix_world = _chest(body, 0.155, 0.018)
    return _finish(ob, 'prop.chief.bowtie', 'chest')


def tie(col, body):
    bm = bmesh.new()
    # kite shape in XZ, extruded thin
    pts = [(0, 0.0), (0.024, -0.02), (0.034, -0.15), (0, -0.19), (-0.034, -0.15), (-0.024, -0.02)]
    vs = [bm.verts.new((x, 0, z)) for x, z in pts]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, vec=(0, 0.01, 0), verts=[v for v in ext['geom'] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.003, segments=2, affect='EDGES', clamp_overlap=True)
    t = mesh_object('tie', bm, col, M(ACC))
    knot = box('knot', (0.04, 0.016, 0.03), (0, 0.004, 0.012), col, M(ACC), 0.008, 2)
    ob = join([t, knot], 'tie')
    _bake(ob)
    hit, nrm = body.front(0, 0.21)
    ob.matrix_world = Matrix.Translation(hit + nrm * 0.008) @ _facing(nrm) @ Matrix.Rotation(math.radians(-6), 4, 'X')
    return _finish(ob, 'prop.business-strategy.tie', 'chest')


def shield(col, body):
    bm = bmesh.new()
    pts = [(-0.04, 0.035), (0.04, 0.035), (0.04, -0.005), (0.024, -0.035), (0, -0.05), (-0.024, -0.035), (-0.04, -0.005)]
    vs = [bm.verts.new((x, 0, z)) for x, z in pts]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, vec=(0, 0.012, 0), verts=[v for v in ext['geom'] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.004, segments=2, affect='EDGES', clamp_overlap=True)
    ob = mesh_object('shield', bm, col, M(ACC))
    x, z = P.icon_to_xz(29, 31)
    hit, nrm = body.front(-x, z)   # on the penguin's right chest
    ob.matrix_world = Matrix.Translation(hit + nrm * 0.002) @ _facing(nrm)
    return _finish(ob, 'prop.infra.shield', 'chest')


def scarf(col, body):
    z = P.icon_to_xz(20, 34.5)[1]
    ring = body.ring(z, 28)
    band = _ring_tube(col, ring, 0.026, M(ACC), 'scarf', grow=0.012, flat=1.1, ring=6)
    hit, nrm = body.front(-0.09, z - 0.05)
    tail = box('tail', (0.06, 0.02, 0.13), (0, 0, 0), col, M(ACC), 0.009, 2)
    tail.matrix_world = Matrix.Translation(hit + nrm * 0.03) @ _facing(nrm) @ Matrix.Rotation(math.radians(-12), 4, 'Y')
    ob = join([band, tail], 'scarf')
    return _finish(ob, 'prop.scarf', 'chest')


# ---------------------------------------------------------------------------
# Hand props — built around a grip point, then placed at HAND_R
# ---------------------------------------------------------------------------

def _in_hand(ob, tilt=(0, 0, 0), offset=(0, 0, 0)):
    _bake(ob)
    rx, ry, rz = (math.radians(a) for a in tilt)
    ob.matrix_world = (Matrix.Translation(HAND_R + Vector(offset)) @ Matrix.Rotation(rz, 4, 'Z') @
                       Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X'))
    return ob


def clipboard(col, body):
    parts = [box('board', (0.13, 0.012, 0.17), (0, 0, 0.06), col, M('prop.wood_board') if False else M('clay.wood'), 0.006, 2),
             box('paper', (0.11, 0.004, 0.13), (0, -0.007, 0.05), col, M('prop.paper'), 0.002, 1),
             box('clip', (0.05, 0.016, 0.022), (0, -0.004, 0.14), col, M(ACC), 0.006, 2)]
    for i in range(3):
        parts.append(box('line', (0.07, 0.003, 0.008), (-0.006, -0.0095, 0.09 - i * 0.03), col, M('prop.metal'), 0.002, 1))
    ob = join(parts, 'clipboard')
    _in_hand(ob, (8, 0, -14), (0.0, -0.03, 0.0))
    return _finish(ob, 'prop.product-manager.clipboard', 'hand.R')


def chart(col, body):
    parts = [box('panel', (0.15, 0.012, 0.13), (0, 0, 0.06), col, M('prop.paper'), 0.008, 2)]
    for i, h in enumerate((0.04, 0.08, 0.06)):
        parts.append(box('bar', (0.026, 0.01, h), (-0.04 + i * 0.04, -0.008, 0.02 + h / 2), col, M(ACC), 0.004, 1))
    ob = join(parts, 'chart')
    _in_hand(ob, (6, 0, -14), (0.0, -0.03, 0.0))
    return _finish(ob, 'prop.data-analyst.chart', 'hand.R')


def cube(col, body):
    ob = box('cube', (0.085,) * 3, (0, 0, 0.05), col, M(ACC), 0.012, 3)
    _in_hand(ob, (20, 0, 30), (0.0, -0.04, 0.02))
    return _finish(ob, 'prop.data-engineer.cube', 'hand.R')


def magnifier(col, body):
    lens = cylinder('lens', 0.045, 0.008, (0, 0, 0), col, M('prop.lens'), 20, 0.0)
    lens.matrix_world = Matrix.Translation((0, 0, 0.12)) @ Matrix.Rotation(math.radians(90), 4, 'X')
    rim = torus('rim', 0.048, 0.008, col, M('prop.black'), 20, 6)
    rim.matrix_world = Matrix.Translation((0, 0, 0.12)) @ Matrix.Rotation(math.radians(90), 4, 'X')
    handle = cylinder('handle', 0.011, 0.08, (0, 0, 0.035), col, M('prop.black'), 12, 0.004)
    ob = join([lens, rim, handle], 'magnifier')
    _in_hand(ob, (0, 0, -20), (0.0, -0.04, 0.0))
    return _finish(ob, 'prop.quality-assurance.magnifier', 'hand.R')


def card(col, body):
    parts = [box('card', (0.11, 0.006, 0.065), (0, 0, 0.04), col, M('prop.paper'), 0.006, 2),
             box('l1', (0.06, 0.002, 0.008), (-0.01, -0.004, 0.05), col, M(ACC), 0.002, 1),
             box('l2', (0.04, 0.002, 0.008), (-0.02, -0.004, 0.032), col, M(ACC), 0.002, 1)]
    ob = join(parts, 'card')
    _in_hand(ob, (0, 0, -16), (0.0, -0.035, 0.0))
    return _finish(ob, 'prop.sales.card', 'hand.R')


def calculator(col, body):
    parts = [box('calc', (0.09, 0.018, 0.12), (0, 0, 0.05), col, M('prop.metal'), 0.01, 2),
             box('screen', (0.07, 0.004, 0.025), (0, -0.01, 0.09), col, M('prop.paper'), 0.003, 1)]
    for i in range(3):
        for j in range(3):
            parts.append(box('key', (0.016, 0.006, 0.014), (-0.024 + i * 0.024, -0.01, 0.06 - j * 0.022), col,
                             M('prop.paper'), 0.003, 1))
    ob = join(parts, 'calculator')
    _in_hand(ob, (8, 0, -14), (0.0, -0.03, 0.0))
    return _finish(ob, 'prop.finance.calculator', 'hand.R')


def megaphone(col, body):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.02, radius2=0.06, depth=0.15)
    horn = mesh_object('horn', bm, col, M(ACC))
    horn.matrix_world = Matrix.Translation((0, 0, 0.09))
    bell = torus('bell', 0.06, 0.008, col, M('prop.paper'), 20, 6)
    bell.matrix_world = Matrix.Translation((0, 0, 0.165))
    grip = box('grip', (0.025, 0.03, 0.06), (0, 0.02, 0.03), col, M('prop.paper'), 0.01, 2)
    ob = join([horn, bell, grip], 'megaphone')
    _bake(ob)
    # point forward and up
    ob.data.transform(Matrix.Rotation(math.radians(-70), 4, 'X'))
    _in_hand(ob, (0, 0, -25), (0.0, -0.02, 0.03))
    return _finish(ob, 'prop.marketer.megaphone', 'hand.R')


def brush(col, body):
    handle = cylinder('handle', 0.008, 0.16, (0, 0, 0.06), col, M('clay.wood'), 10, 0.003)
    ferrule = cylinder('ferrule', 0.011, 0.03, (0, 0, 0.15), col, M('prop.metal'), 12, 0.003)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.013, radius2=0.002, depth=0.045)
    tip = mesh_object('tip', bm, col, M(ACC))
    tip.matrix_world = Matrix.Translation((0, 0, 0.185))
    ob = join([handle, ferrule, tip], 'brush')
    _in_hand(ob, (-25, 20, 0), (0.0, -0.04, 0.0))
    return _finish(ob, 'prop.creative.brush', 'hand.R')


# ---------------------------------------------------------------------------

BUILDERS = {
    'prop.chief.crown': crown,
    'prop.chief.bowtie': bowtie,
    'prop.product-manager.clipboard': clipboard,
    'prop.product-designer.beret': beret,
    'prop.researcher.glasses': lambda c, b: glasses(c, b, 'prop.researcher.glasses', M('prop.black')),
    'prop.data-analyst.chart': chart,
    'prop.frontend-engineer.beanie': beanie,
    'prop.backend-engineer.headset': headset,
    'prop.data-engineer.cube': cube,
    'prop.infra.hardhat': hardhat,
    'prop.infra.shield': shield,
    'prop.quality-assurance.magnifier': magnifier,
    'prop.business-strategy.tie': tie,
    'prop.sales.card': card,
    'prop.finance.glasses': lambda c, b: glasses(c, b, 'prop.finance.glasses', M('prop.gold')),
    'prop.finance.calculator': calculator,
    'prop.marketer.megaphone': megaphone,
    'prop.creative.brush': brush,
    'prop.scarf': scarf,
}

AGENT_PROPS = {
    'chief': ['prop.chief.crown', 'prop.chief.bowtie'],
    'product-manager': ['prop.product-manager.clipboard'],
    'product-designer': ['prop.product-designer.beret'],
    'researcher': ['prop.researcher.glasses'],
    'data-analyst': ['prop.data-analyst.chart'],
    'frontend-engineer': ['prop.frontend-engineer.beanie'],
    'backend-engineer': ['prop.backend-engineer.headset'],
    'data-engineer': ['prop.data-engineer.cube'],
    'infra': ['prop.infra.hardhat', 'prop.infra.shield'],
    'quality-assurance': ['prop.quality-assurance.magnifier'],
    'business-strategy': ['prop.business-strategy.tie'],
    'sales': ['prop.sales.card'],
    'finance': ['prop.finance.glasses', 'prop.finance.calculator'],
    'marketer': ['prop.marketer.megaphone'],
    'creative': ['prop.creative.brush'],
}


AGENT_TEAM = {
    'chief': 'core',
    'product-manager': 'product', 'product-designer': 'product', 'researcher': 'product',
    'data-analyst': 'product',
    'frontend-engineer': 'engineering', 'backend-engineer': 'engineering',
    'data-engineer': 'engineering', 'infra': 'engineering', 'quality-assurance': 'engineering',
    'business-strategy': 'business', 'sales': 'business', 'finance': 'business',
    'marketer': 'brand', 'creative': 'brand',
}


SOCKET_BONE = {'head': 'socket.head', 'chest': 'socket.chest', 'hand.R': 'socket.hand.R'}


def attach(prop_ob, rig_ob):
    """Parent a prop to its socket bone, keeping its rest-pose world transform."""
    mw = prop_ob.matrix_world.copy()
    prop_ob.parent = rig_ob
    prop_ob.parent_type = 'BONE'
    prop_ob.parent_bone = SOCKET_BONE[prop_ob['socket']]
    bpy.context.view_layer.update()
    prop_ob.matrix_world = mw


def build_all(col, penguin_ob):
    body = Body(penguin_ob)
    out = {}
    for name, fn in BUILDERS.items():
        ob = fn(col, body)
        out[name] = ob
    return out
