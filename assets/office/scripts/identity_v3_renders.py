"""Renders for the penguin v3 draft (identity/_drafts/penguin-v3/). Draft only: nothing shipped
changes. Builds penguin_v3 (no props) and renders, on a neutral backdrop with one orthographic
framing for every view:

  turnaround/  front, three-quarter-front-left, side-left, three-quarter-back-left, back, top, bottom
               (light) + front-evening
  compare.png  draft_1 (left) | this front (middle) | --right image (right: round 1 or v2)
  seated/      on the office chair (seat 0.42 m, desk 0.72 m): front + iso 3/4 (30 deg / 45 deg),
               alone and with office-kit desk.set
  motion/      hop + wave + walk (front, 3/4) frames (motion/<clip>/NNN.png) and a 2 x 6 key-frame strip <clip>-strip.png

    B=/Applications/Blender.app/Contents/MacOS/Blender
    dwebp identity/character/reference/draft_1.webp -o /tmp/draft_1.png
    dwebp identity/_drafts/penguin-v3/r1/turnaround/front-light.webp -o /tmp/v3r1-front.png
    $B -b -P assets/office/scripts/identity_v3_renders.py -- --out identity/_build/v3 \\
        --draft /tmp/draft_1.png --right /tmp/v3r1-front.png
    python3 assets/office/scripts/identity_v3_pack.py identity/_build/v3 identity/_drafts/penguin-v3/r2

Options: --res 1200 (stills) · --samples 96 · --motion-res 480 · --motion-samples 24 ·
--only turnaround,compare,seated,motion
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import frames  # noqa: E402
import lib  # noqa: E402
import penguin_v3 as pv3  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d


OUT = os.path.abspath(arg('--out', 'identity/_build/v3'))
RES = int(arg('--res', '1200'))
SAMPLES = int(arg('--samples', '96'))
MRES = int(arg('--motion-res', '480'))
MSAMPLES = int(arg('--motion-samples', '24'))
DRAFT = arg('--draft')
RIGHT = arg('--right', arg('--v2'))
ONLY = set(arg('--only', 'turnaround,compare,seated,motion').split(','))

SCALE, TARGET_Z = 0.98, 0.40          # one framing for the whole turnaround
M_SCALE, M_TARGET_Z = 1.16, 0.47       # motion framing (room for the hop and the raised wing)
BACKDROP = {'light': '#EEE9DF', 'evening': '#15161B'}
TURNAROUND = [
    ('front', 0, 0),
    ('three-quarter-front-left', 45, 0),
    ('side-left', 90, 0),
    ('three-quarter-back-left', 135, 0),
    ('back', 180, 0),
    ('top', 0, 90),
    ('bottom', 0, -90),
]


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = lib.collection('penguin_v3')
    mesh = pv3.build(col)
    rig = pv3.rig(col, mesh)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=3)
    floor = lib.mesh_object('floor', bm, col, lib.material('clay.floor'))
    floor.is_shadow_catcher = True
    sc = bpy.context.scene
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.clip_end = 50
    frames.render_settings('/tmp/v3.png', SAMPLES)
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.resolution_x = sc.render.resolution_y = RES
    print('tri count', mesh['tri_count'], 'skin', mesh['tri_body'])
    return mesh, rig, cam


def theme(name):
    frames.world(name)
    frames.sun(name)
    sc = bpy.context.scene
    fill = bpy.data.objects.get('fill')
    if fill is None:
        fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'AREA'))
        sc.collection.objects.link(fill)
    if name == 'light':
        # a soft warm fill from the front-right so the black leather keeps its form
        fill.data.color = lib.hex_rgba('#FFF3E2')[:3]
        fill.data.energy = 14
        fill.data.size = 1.2
        fill.location = (0.9, -1.4, 0.9)
    else:
        fill.data.color = lib.hex_rgba('#8FB8FF')[:3]
        fill.data.energy = 9
        fill.data.size = 0.4
        fill.location = (0, -0.8, 0.6)
    fill.rotation_euler = (Vector((0, 0, 0.4)) - fill.location).to_track_quat('-Z', 'Y').to_euler()
    body = lib.EVENING['penguin.body'] if name == 'evening' else lib.PALETTE['penguin.body']
    bpy.data.materials['v3.leather'].node_tree.nodes['body_color'].outputs[0].default_value = lib.hex_rgba(body)


def aim(cam, azim, elev, scale, target_z):
    a, e = math.radians(azim), math.radians(elev)
    target = Vector((0, 0, target_z))
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    cam.location = target + d * 5
    cam.rotation_euler = (math.radians(90) - e, 0, a)
    cam.data.ortho_scale = scale


def _load(path):
    im = bpy.data.images.load(path)
    w, h = im.size
    px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, im.channels)
    bpy.data.images.remove(im)
    if px.shape[2] == 3:
        px = np.concatenate([px, np.ones((h, w, 1), np.float32)], 2)
    return px


def _save(px, path):
    h, w = px.shape[:2]
    img = bpy.data.images.new('out', w, h, alpha=True)
    img.pixels = px.astype(np.float32).ravel()
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    print('wrote', path)


def _hex01(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def flatten(px, backdrop):
    """Alpha-over onto the backdrop colour (PNG pixels are display-referred sRGB)."""
    a = px[..., 3:4]
    rgb = px[..., :3] * a + _hex01(backdrop) * (1 - a)
    out = np.concatenate([rgb, np.ones_like(a)], 2)
    return out


def shoot(path, backdrop):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    raw = path[:-4] + '.raw.png'
    bpy.context.scene.render.filepath = raw
    bpy.ops.render.render(write_still=True)
    _save(flatten(_load(raw), backdrop), path)
    os.remove(raw)


def _resize(px, w, h):
    """Nearest-free resize through a Blender image (bilinear-ish scale)."""
    ih, iw = px.shape[:2]
    img = bpy.data.images.new('rs', iw, ih, alpha=True)
    img.pixels = px.astype(np.float32).ravel()
    img.scale(w, h)
    out = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return out


def sheet(tiles, cols, gap, bg):
    h, w = tiles[0].shape[:2]
    rows = math.ceil(len(tiles) / cols)
    W, H = cols * w + (cols + 1) * gap, rows * h + (rows + 1) * gap
    canvas = np.ones((H, W, 4), np.float32)
    canvas[..., :3] = _hex01(bg)
    for i, px in enumerate(tiles):
        r, c = divmod(i, cols)
        y0 = H - gap - (r + 1) * h - r * gap      # Blender images are bottom-up
        x0 = gap + c * (w + gap)
        canvas[y0:y0 + h, x0:x0 + w] = px
    return canvas


# ---------------------------------------------------------------------------

def turnaround(cam, rig):
    pv3.reset_pose(rig)
    d = os.path.join(OUT, 'turnaround')
    theme('light')
    floor = bpy.data.objects['floor']
    for name, azim, elev in TURNAROUND:
        aim(cam, azim, elev, SCALE, TARGET_Z)
        floor.hide_render = abs(elev) > 60     # top / bottom: no shadow catcher in the way
        shoot(os.path.join(d, f'{name}-light.png'), BACKDROP['light'])
    floor.hide_render = False
    theme('evening')
    aim(cam, 0, 0, SCALE, TARGET_Z)
    shoot(os.path.join(d, 'front-evening.png'), BACKDROP['evening'])
    theme('light')


def compare(cam, rig):
    """draft_1 | v3 front | v2 front, each cropped to the penguin at a 4:5 panel."""
    front = os.path.join(OUT, 'turnaround', 'front-light.png')
    if not os.path.exists(front):
        pv3.reset_pose(rig)
        theme('light')
        aim(cam, 0, 0, SCALE, TARGET_Z)
        shoot(front, BACKDROP['light'])
    PW, PH = 640, 800
    panels = []
    if DRAFT:
        px = _load(DRAFT)
        h, w = px.shape[:2]
        # the penguin (with both wings) in the draft photo: x 23-87 %, y 24-88 % from the top
        x0, x1 = int(0.235 * w), int(0.865 * w)
        y_top, y_bot = int(0.235 * h), int(0.885 * h)
        cw = x1 - x0
        ch = int(cw * PH / PW)
        yc = (y_top + y_bot) // 2
        ya, yb = h - (yc + ch // 2), h - (yc - ch // 2)     # bottom-up rows
        panels.append(_resize(px[max(ya, 0):yb, x0:x1], PW, PH))
    for path, frac in ((front, 1.0), (RIGHT, 1.0)):
        if not path or not os.path.exists(path):
            continue
        px = _load(path)
        if px[..., 3].min() < 1:
            px = flatten(px, BACKDROP['light'])
        h, w = px.shape[:2]
        cw = int(h * PW / PH * frac)
        x0 = (w - cw) // 2
        panels.append(_resize(px[:, x0:x0 + cw], PW, PH))
    _save(sheet(panels, len(panels), 16, BACKDROP['light']), os.path.join(OUT, 'compare.png'))


def seated(cam, rig):
    """Seated on the office chair. Alone (on the floor, seat height 0) and in desk.set (the penguin
    at desk-local (0, +0.27, 0.42), contract §2), front and the office iso view."""
    import kit
    d = os.path.join(OUT, 'seated')
    theme('light')
    rest = pv3._bone_rest(rig)
    col = lib.collection('kit')
    desk = kit.desk_set(col)
    floor = bpy.data.objects['floor']
    floor.hide_render = False
    shots = [
        ('alone', (0.0, 0.0, 0.0), [('front', 0, 0, SCALE, 0.36), ('iso', 45, 30, 1.05, 0.36)]),
        ('desk', (0.0, 0.27, pv3.SEAT_Z), [('front', 0, 30, 1.45, 0.62), ('iso', 45, 30, 1.6, 0.62)]),
    ]
    for name, offset, views in shots:
        desk.hide_render = name != 'desk'
        pv3.pose_seated(rig, 0, rest, offset)
        for view, az, el, scale, tz in views:
            aim(cam, az, el, scale, tz)
            if name == 'desk':
                cam.location = cam.location + Vector((0, 0.27, 0))
            shoot(os.path.join(d, f'seated-{name}-{view}.png'), BACKDROP['light'])
    desk.hide_render = True
    pv3.reset_pose(rig)


def motion(cam, rig):
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = MRES
    keep = sc.cycles.samples
    sc.cycles.samples = MSAMPLES
    theme('light')
    rest = pv3._bone_rest(rig)
    views = {'hop': [('hop', (30, 6))], 'wave': [('wave', (0, 0))],
             'walk': [('walk-front', (0, 0)), ('walk-3q', (35, 8))]}
    for clip, (length, fn) in pv3.CLIPS.items():
        for name, view in views[clip]:
            d = os.path.join(OUT, 'motion', name)
            aim(cam, *view, M_SCALE, M_TARGET_Z)
            paths = []
            for f in range(length):
                fn(rig, f, rest)
                sc.frame_set(f)
                p = os.path.join(d, f'{f:03d}.png')
                shoot(p, BACKDROP['light'])
                paths.append(p)
            picks = [round(i * length / 12) for i in range(12)]
            tiles = [_resize(_load(paths[i]), 260, 260) for i in picks]
            _save(sheet(tiles, 6, 6, BACKDROP['light']), os.path.join(OUT, 'motion', f'{name}-strip.png'))
    pv3.reset_pose(rig)
    sc.cycles.samples = keep
    sc.render.resolution_x = sc.render.resolution_y = RES


def main():
    mesh, rig, cam = build()
    if 'turnaround' in ONLY:
        turnaround(cam, rig)
    if 'compare' in ONLY:
        compare(cam, rig)
    if 'seated' in ONLY:
        seated(cam, rig)
    if 'motion' in ONLY:
        motion(cam, rig)


main()
