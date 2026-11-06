"""Office kit modules (contract §3). Each module is built at the origin and returned as
one root object named exactly as the contract says; meshes are joined per module.

Module origin = centre of the floor face it stands on. For wall pieces the origin is the
centre of the 2 x 2 m floor tile they border, so the web places a wall at the same
position as its tile (wall_left sits on the tile's -X edge, wall_back on its far edge).
"""
import math

import bmesh
from mathutils import Matrix, Vector

from lib import box, cylinder, ellipsoid, empty, join, material, mesh_object, set_auto_smooth

TILE = 2.0
WALL_H = 2.4
WALL_T = 0.12
FLOOR_T = 0.10
DESK_TOP = 0.72


def M(name):
    return material(name)


# ---------------------------------------------------------------------------
# Room pieces
# ---------------------------------------------------------------------------

def _top_edges(a, b):
    """Round only edges along the top face (walls meet their neighbours flush)."""
    return a.z > 0 and b.z > 0 and abs(a.z - b.z) < 1e-6


def floor_tile(col):
    # flat slab, no rounding: tiles butt together into one continuous floor
    return box('room.floor_tile', (TILE, TILE, FLOOR_T), (0, 0, -FLOOR_T / 2), col,
               M('clay.floor'), radius=0.0)


def wall_left(col):
    return box('room.wall_left', (WALL_T, TILE, WALL_H + FLOOR_T),
               (-TILE / 2 - WALL_T / 2, 0, (WALL_H - FLOOR_T) / 2), col, M('clay.wall'),
               radius=0.012, segments=3, edge_filter=_top_edges)


def wall_back(col):
    return box('room.wall_back', (TILE, WALL_T, WALL_H + FLOOR_T),
               (0, TILE / 2 + WALL_T / 2, (WALL_H - FLOOR_T) / 2), col, M('clay.wall'),
               radius=0.012, segments=3, edge_filter=_top_edges)


def corner(col):
    return box('room.corner', (WALL_T, WALL_T, WALL_H + FLOOR_T),
               (-TILE / 2 - WALL_T / 2, TILE / 2 + WALL_T / 2, (WALL_H - FLOOR_T) / 2), col,
               M('clay.wall'), radius=0.012, segments=3, edge_filter=_top_edges)


# ---------------------------------------------------------------------------
# Desk set: desk + chair + laptop. Seated agent faces -Y (glTF +Z): the desk is in
# front of them (towards -Y), the chair behind (+Y). The laptop's lid back — with the
# team sticker — faces the camera.
# ---------------------------------------------------------------------------

def _desk(col, w, d, y):
    parts = []
    top_t = 0.035
    parts.append(box('top', (w, d, top_t), (0, y, DESK_TOP - top_t / 2), col,
                     M('clay.furniture'), radius=0.012))
    parts.append(box('top_wood', (w - 0.02, d - 0.02, 0.02), (0, y, DESK_TOP - top_t - 0.01),
                     col, M('clay.wood'), radius=0.008, segments=2))
    leg_h = DESK_TOP - top_t - 0.02
    for sx in (-1, 1):
        parts.append(box('leg', (0.045, d - 0.08, leg_h),
                         (sx * (w / 2 - 0.07), y, leg_h / 2), col, M('clay.furniture'),
                         radius=0.018))
    return parts


def _chair(col, y, seat_z=0.42):
    parts = []
    parts.append(box('seat', (0.46, 0.44, 0.07), (0, y, seat_z - 0.035), col,
                     M('clay.furniture'), radius=0.03))
    parts.append(box('back', (0.44, 0.07, 0.40), (0, y + 0.22, seat_z + 0.24), col,
                     M('clay.furniture'), radius=0.03))
    parts.append(box('back_post', (0.05, 0.04, 0.2), (0, y + 0.23, seat_z + 0.02), col,
                     M('clay.wood'), radius=0.015))
    parts.append(cylinder('stem', 0.028, seat_z - 0.1, (0, y, (seat_z - 0.1) / 2 + 0.04), col,
                          M('clay.wood'), segments=16, bevel=0.005))
    parts.append(cylinder('base', 0.23, 0.04, (0, y, 0.02), col, M('clay.furniture'),
                          segments=32, bevel=0.015))
    return parts


def _laptop(col, y, w=0.28, d=0.19):
    """Laptop with hinge on the -Y (camera) edge, screen facing the agent at +Y."""
    parts = []
    base_t = 0.016
    parts.append(box('lap_base', (w, d, base_t), (0, y, DESK_TOP + base_t / 2), col,
                     M('clay.furniture'), radius=0.006, segments=2))
    lid_h, lid_t = 0.16, 0.012
    tilt = math.radians(-20)  # lean back, away from the agent
    hinge = Vector((0, y - d / 2 + 0.006, DESK_TOP + base_t))
    rot = Matrix.Rotation(tilt, 4, 'X')

    lid = box('lap_lid', (w, lid_t, lid_h), (0, 0, 0), col, M('clay.furniture'),
              radius=0.006, segments=2)
    screen = box('lap_screen', (w - 0.03, 0.004, lid_h - 0.03), (0, 0, 0), col,
                 M('clay.screen'), radius=0.004, segments=1)
    sticker = cylinder('lap_sticker', 0.05, 0.004, (0, 0, 0), col, M('team_sticker'),
                       segments=24, bevel=0.0015)
    sticker.rotation_euler = (math.radians(90), 0, 0)
    for ob, local in ((lid, Vector((0, 0, lid_h / 2))),
                      (screen, Vector((0, lid_t / 2 + 0.001, lid_h / 2))),
                      (sticker, Vector((0, -lid_t / 2 - 0.0015, lid_h * 0.55)))):
        m = Matrix.Translation(hinge) @ rot @ Matrix.Translation(local)
        if ob is sticker:
            m = m @ Matrix.Rotation(math.radians(90), 4, 'X')
            ob.rotation_euler = (0, 0, 0)
        ob.matrix_world = m
        parts.append(ob)
    return parts


def desk_set(col, name='desk.set', w=0.96, d=0.56):
    desk_y = -0.20
    parts = _desk(col, w, d, desk_y)
    parts += _chair(col, 0.30)
    parts += _laptop(col, desk_y - 0.06)
    ob = join(parts, name)
    _apply_transforms(ob)
    set_auto_smooth(ob)
    return ob


def desk_chief(col):
    return desk_set(col, 'desk.chief', w=1.30, d=0.66)


def lamp_desk(col):
    """Desk lamp: base, post, an arm reaching toward +X (over the desk) and a cone shade
    opening down. Stands on the desk's back-left corner."""
    from lib import apply_modifiers
    parts = [cylinder('lamp_base', 0.065, 0.022, (0, 0, 0.011), col, M('clay.furniture'),
                      segments=24, bevel=0.008)]
    post_top = Vector((0, 0.02, 0.30))
    head = Vector((0.15, -0.02, 0.33))

    def rod(a, b, r=0.012):
        d = b - a
        ob = cylinder('rod', r, d.length, (0, 0, 0), col, M('clay.wood'), segments=12, bevel=0.0)
        z = d.normalized()
        x = z.cross(Vector((0, 1, 0)) if abs(z.y) < 0.9 else Vector((1, 0, 0))).normalized()
        y = z.cross(x)
        ob.matrix_world = Matrix.Translation((a + b) / 2) @ Matrix((x, y, z)).transposed().to_4x4()
        return ob
    parts.append(rod(Vector((0, 0.02, 0.02)), post_top))
    parts.append(rod(post_top, head))
    parts.append(ellipsoid('joint', (0.02,) * 3, post_top, col, M('clay.wood'), 12, 6))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=0.08, radius2=0.028, depth=0.095)
    shade = mesh_object('lamp_shade', bm, col, M('clay.furniture'))
    mod = shade.modifiers.new('solid', 'SOLIDIFY')
    mod.thickness = 0.008
    shade.matrix_world = Matrix.Translation(head + Vector((0, 0, -0.035)))
    apply_modifiers(shade)
    parts.append(shade)
    parts.append(ellipsoid('cap', (0.03, 0.03, 0.018), head + Vector((0, 0, 0.012)), col,
                           M('clay.furniture'), 16, 8))
    parts.append(ellipsoid('lamp_bulb', (0.032,) * 3, head + Vector((0, 0, -0.06)), col,
                           M('clay.lamp_bulb'), 16, 8))
    ob = join(parts, 'lamp.desk')
    _apply_transforms(ob)
    set_auto_smooth(ob)
    empty('lamp.desk.light', col, tuple(head + Vector((0, 0, -0.1))), parent=ob)
    return ob


# ---------------------------------------------------------------------------
# Shared props
# ---------------------------------------------------------------------------

def _leaf_cluster(col, centre, count, spread, size, seed):
    import random
    rnd = random.Random(seed)
    parts = []
    for i in range(count):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(0, spread)
        h = rnd.uniform(-spread * 0.6, spread * 0.9)
        s = size * rnd.uniform(0.75, 1.2)
        p = Vector(centre) + Vector((math.cos(a) * r, math.sin(a) * r, h))
        parts.append(ellipsoid('leaf', (s, s, s * 0.85), p, col, M('clay.plant'), 16, 10))
    return parts


def plant(col):
    parts = [cylinder('pot', 0.17, 0.36, (0, 0, 0.18), col, M('clay.furniture'), 32, 0.02),
             cylinder('soil', 0.15, 0.02, (0, 0, 0.35), col, M('clay.wood'), 24, 0.0),
             cylinder('trunk', 0.018, 0.5, (0, 0, 0.6), col, M('clay.wood'), 10, 0.0)]
    parts += _leaf_cluster(col, (0, 0, 0.95), 9, 0.17, 0.13, 3)
    ob = join(parts, 'prop.plant')
    set_auto_smooth(ob)
    return ob


def shelf(col):
    w, d, h = 1.5, 0.38, 0.82
    parts = [box('shelf_body', (w, d, h), (0, 0, h / 2), col, M('clay.furniture'), 0.02)]
    # two open cubbies cut visually by wood inner panels
    for i, x in enumerate((-0.37, 0.37)):
        parts.append(box('cubby', (w / 2 - 0.08, 0.02, h - 0.12), (x, -d / 2 + 0.005, h / 2), col,
                         M('clay.wood'), 0.008, 2))
    # objects on top: books (neutral), small box
    for i, (x, bw, bh) in enumerate(((-0.55, 0.05, 0.24), (-0.49, 0.045, 0.21), (-0.44, 0.05, 0.25))):
        parts.append(box('book', (bw, 0.2, bh), (x, 0, h + bh / 2), col,
                         M('clay.wood' if i == 1 else 'clay.furniture'), 0.008, 2))
    parts.append(box('tray', (0.3, 0.2, 0.06), (0.35, 0, h + 0.03), col, M('clay.wood'), 0.015))
    parts += _leaf_cluster(col, (0.0, 0.0, h + 0.14), 4, 0.06, 0.07, 7)
    parts.append(cylinder('mini_pot', 0.07, 0.11, (0.0, 0, h + 0.055), col, M('clay.furniture'), 20, 0.008))
    ob = join(parts, 'prop.shelf')
    set_auto_smooth(ob)
    return ob


def whiteboard(col):
    w, h = 1.3, 0.85
    parts = [box('board_frame', (w, 0.04, h), (0, 0, 1.45), col, M('clay.wood'), 0.012),
             box('board', (w - 0.06, 0.02, h - 0.06), (0, -0.015, 1.45), col, M('clay.furniture'), 0.006, 2),
             box('tray', (w * 0.6, 0.07, 0.025), (0, -0.04, 1.45 - h / 2 - 0.01), col, M('clay.wood'), 0.008, 2)]
    # a few soft strokes (neutral, no saturated colour)
    for i, (x, z, ln) in enumerate(((-0.35, 1.68, 0.5), (-0.4, 1.56, 0.36), (-0.38, 1.44, 0.44), (0.3, 1.36, 0.3))):
        parts.append(box('stroke', (ln, 0.006, 0.018), (x + ln / 2 - 0.1, -0.028, z), col,
                         M('prop.metal'), 0.006, 1))
    parts.append(box('sticky', (0.13, 0.008, 0.13), (0.38, -0.028, 1.6), col, M('clay.wood'), 0.004, 1))
    ob = join(parts, 'prop.whiteboard')
    set_auto_smooth(ob)
    return ob


def sofa(col):
    w = 1.6
    parts = [box('sofa_base', (w, 0.78, 0.26), (0, 0, 0.21), col, M('clay.furniture'), 0.08, 4),
             box('sofa_back', (w, 0.22, 0.42), (0, 0.29, 0.5), col, M('clay.furniture'), 0.1, 4)]
    for sx in (-1, 1):
        parts.append(box('arm', (0.2, 0.78, 0.38), (sx * (w / 2 - 0.1), 0, 0.37), col,
                         M('clay.furniture'), 0.09, 4))
    for x in (-0.33, 0.33):
        parts.append(box('cushion', (0.62, 0.56, 0.12), (x, -0.06, 0.39), col, M('clay.furniture'), 0.05, 4))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(cylinder('foot', 0.025, 0.08, (sx * (w / 2 - 0.12), sy * 0.3, 0.04), col,
                                  M('clay.wood'), 12, 0.006))
    ob = join(parts, 'prop.sofa')
    set_auto_smooth(ob)
    return ob


def coffee_bar(col):
    w, d, h = 1.2, 0.5, 0.92
    parts = [box('counter', (w, d, h - 0.04), (0, 0, (h - 0.04) / 2), col, M('clay.furniture'), 0.02),
             box('counter_top', (w + 0.04, d + 0.03, 0.04), (0, 0, h - 0.02), col, M('clay.wood'), 0.012),
             box('machine', (0.28, 0.3, 0.36), (-0.25, 0.04, h + 0.18), col, M('prop.metal'), 0.04, 3),
             box('machine_lip', (0.2, 0.12, 0.03), (-0.25, -0.1, h + 0.1), col, M('prop.metal'), 0.01, 2)]
    for i, x in enumerate((0.12, 0.24, 0.36)):
        parts.append(cylinder('cup', 0.035, 0.08, (x, -0.05, h + 0.04), col,
                              M('clay.furniture' if i != 1 else 'clay.wood'), 16, 0.006))
    ob = join(parts, 'prop.coffee_bar')
    set_auto_smooth(ob)
    return ob


def _apply_transforms(ob):
    ob.data.transform(ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)


BUILDERS = {
    'room.floor_tile': floor_tile,
    'room.wall_left': wall_left,
    'room.wall_back': wall_back,
    'room.corner': corner,
    'desk.set': desk_set,
    'desk.chief': desk_chief,
    'lamp.desk': lamp_desk,
    'prop.plant': plant,
    'prop.shelf': shelf,
    'prop.whiteboard': whiteboard,
    'prop.sofa': sofa,
    'prop.coffee_bar': coffee_bar,
}


def build_all(col):
    out = {}
    for name, fn in BUILDERS.items():
        ob = fn(col)
        if ob.matrix_world != Matrix.Identity(4):
            _apply_transforms(ob)
        out[name] = ob
    return out
