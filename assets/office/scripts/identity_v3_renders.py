"""Renders for the penguin v3 draft (identity/_drafts/penguin-v3/). Draft only: nothing shipped
changes. Builds penguin_v3 (no props) and renders, on a neutral backdrop with one orthographic
framing for every view:

  turnaround/  front, three-quarter-front-left, side-left, three-quarter-back-left, back, top, bottom
               (light) + front-evening
  compare.png  draft_1 (left) | this front (middle) | --right image (right: the previous round)
  samescale.png  draft_1 | this front at the same body height, aligned, guides every 25 %
  seated/      on the office chair (seat 0.42 m, desk 0.72 m): front + iso 3/4 (30 deg / 45 deg),
               alone and with office-kit desk.set
  motion/      hop + wave + walk (front, 3/4) frames (motion/<clip>/NNN.png) and a 2 x 6 key-frame strip <clip>-strip.png
  detail/      close-ups for the before/after: face (front), wing-3q (3/4 front, the wing's inner
               white), wing-up (wing raised to the side), armpit-3q / -under / -up (the joint)
  beforeafter-face.png / beforeafter-wing.png / beforeafter-armpit.png
               --prev <previous round's detail/ dir> | this round
  silhouette.png  front, 3/4, side: the previous round's outline (orange) and this round's (blue)
  poses.png / raised.png  key poses (front + 3/4 rows) / the raised wing (wave peak) front | 3/4
  clearance.txt  min wing-to-body/head distance per clip (fails the run if a wing goes inside)

The previous round's detail/ is rendered by running this script with --only detail next to that
round's penguin_v3.py (copy assets/office/scripts/ to a temp dir and put that round's
penguin_v3.py in it: git show <commit>:assets/office/scripts/penguin_v3.py).

    B=/Applications/Blender.app/Contents/MacOS/Blender
    dwebp identity/character/reference/draft_1.webp -o /tmp/draft_1.png
    dwebp identity/_drafts/penguin-v3/r1/turnaround/front-light.webp -o /tmp/v3r1-front.png
    $B -b -P assets/office/scripts/identity_v3_renders.py -- --out identity/_build/v3 \\
        --draft /tmp/draft_1.png --right /tmp/v3r1-front.png
    python3 assets/office/scripts/identity_v3_pack.py identity/_build/v3 identity/_drafts/penguin-v3/r2

Options: --res 1200 (stills) · --samples 96 · --motion-res 480 · --motion-samples 24 ·
--only turnaround,compare,seated,motion,detail · --prev <previous round's detail/ dir> ·
--prev-turnaround <previous round's turnaround/ dir> (silhouette.png: outlines overlaid)

QA gate (round 11; runs first and stops the render on any violation; off unless --qa-skills):
  --qa-skills DIR     the skills' scripts: qa_render.py, render_compare.py (skills/3d-previz-edit)
                      and clearance_check.py (skills/rig-motion-clearance, the unsigned version)
  --qa-cameras BLEND  a baseline QA .blend whose QA_cameras are copied in (identical cameras every
                      round); without it qa_render frames new ones and nothing is compared
  --qa-prev DIR       the previous round's <out>/qa/ (views/*.png + regions.json) to compare with
  --qa-edit KEYS      the regions this round is allowed to change (wing, face; default wing)
  --qa-min-clearance  metres, default 0.008
  --qa-max-outside    render_compare's leak limit outside the edit regions, default 0.002
  --qa-max-white      white pixels allowed outside the wing's white face per junction box, default 4
  --qa-max-seam-ratio luminance jump across the joint fillet's edges / across its middle (p95,
                      shading only, junction box at 4x), default 1.25
Steps: bake <out>/qa/round.blend (identity_v3_qa_blend.py), qa_render --quality final at 640 px,
frames 0 (rest), 77 (wave peak), 168 (max raise) -> <out>/qa/views/; regions.json; render_compare
each view against --qa-prev with the union of both rounds' edit boxes (+2 %); white check
(identity_v3_qa_blend.py --white-check: welt on / off in the junction boxes); clearance_check
over every clip (hop, wave, walk, seated, seated at the desk, max raise; subframes 2): wing tips
vs head, body, face pieces, feet, the other wing and the desk set. Report: <out>/qa/gate.md.
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
# draft_1's body box in its own pixels (top of the head, bottom of the body, centre line), for the
# same-scale side-by-side; read off draft_1.webp (1280 x 1600)
DRAFT_BOX = tuple(int(v) for v in arg('--draft-box', '445,1341,699').split(','))
RIGHT = arg('--right', arg('--v2'))
ONLY = set(arg('--only', 'clearance,turnaround,compare,seated,motion,poses,detail').split(','))
PREV = arg('--prev')
PREV_TURN = arg('--prev-turnaround')
QA_SKILLS = arg('--qa-skills')
QA_CAMERAS = arg('--qa-cameras')
QA_PREV = arg('--qa-prev')
QA_EDIT = arg('--qa-edit', 'wing').split(',')
QA_MIN_CLEARANCE = float(arg('--qa-min-clearance', '0.008'))
QA_MAX_OUTSIDE = float(arg('--qa-max-outside', '0.002'))
QA_MAX_WHITE = int(arg('--qa-max-white', '4'))
QA_MAX_SEAM_RATIO = float(arg('--qa-max-seam-ratio', '1.25'))

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
    for mn in ('v3.leather', 'v3.leather.joint.L', 'v3.leather.joint.R'):
        m_ = bpy.data.materials.get(mn)
        if m_ is not None:
            m_.node_tree.nodes['body_color'].outputs[0].default_value = lib.hex_rgba(body)


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


def _crop_td(px, cx, by, pw, ph, bx, bpy_, bg):
    """Crop a top-down image so the point (cx, by) lands at (bx, bpy_) in a pw x ph panel."""
    out = np.ones((ph, pw, 4), np.float32)
    out[..., :3] = _hex01(bg)
    h, w = px.shape[:2]
    x0, y0 = int(round(cx - bx)), int(round(by - bpy_))
    sx0, sy0 = max(x0, 0), max(y0, 0)
    sx1, sy1 = min(x0 + pw, w), min(y0 + ph, h)
    if sx1 > sx0 and sy1 > sy0:
        out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = px[sy0:sy1, sx0:sx1]
    return out


def samescale(front):
    """draft_1 and this front at the same scale: both bodies (top of the head to the bottom of the
    body, feet excluded) the same height, bottoms and centre lines aligned, guides every 25 %."""
    if not DRAFT:
        return
    top, bot, cx = DRAFT_BOX
    d = _load(DRAFT)[::-1]                              # top-down
    r = _load(front)[::-1]
    res = r.shape[0]
    body_px = (pv3.Z1 - pv3.Z0) * res / SCALE
    k = body_px / (bot - top)
    dh, dw = d.shape[:2]
    ds = _resize(d[::-1].copy(), int(round(dw * k)), int(round(dh * k)))[::-1]
    r_bot = res / 2 - (pv3.Z0 - TARGET_Z) * res / SCALE
    PW, PH, BX, BY = 760, 1000, 380, 880
    panels = [_crop_td(ds, cx * k, bot * k, PW, PH, BX, BY, BACKDROP['light']),
              _crop_td(r, res / 2, r_bot, PW, PH, BX, BY, BACKDROP['light'])]
    for pnl in panels:
        for f in (0.0, 0.25, 0.5, 0.75, 1.0):
            y = int(round(BY - f * body_px))
            pnl[y - 1:y + 1, :, :3] = pnl[y - 1:y + 1, :, :3] * 0.5 + np.array([0.16, 0.40, 0.82]) * 0.5
        pnl[:, BX, :3] = pnl[:, BX, :3] * 0.5 + np.array([0.16, 0.40, 0.82]) * 0.5
    tiles = [pp[::-1].copy() for pp in panels]
    _save(sheet(tiles, 2, 16, BACKDROP['light']), os.path.join(OUT, 'samescale.png'))


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
    samescale(front)


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


# close-ups: (name, azim, elev, ortho scale, target (x, y, z), pose)
def _detail_views():
    sx, sy, sz = 0.202, 0.005, pv3.Z0 + 0.505 * pv3.HB   # fixed QA framing (the r6-r9 pivot), never moves
    return [
        ('face', 0, 0, 0.50, (0.0, 0.0, pv3.EYE_Z), None),
        ('wing-3q', 45, 0, 0.50, (-0.245, -0.055, 0.29), None),
        ('wing-up', 0, -12, 0.50, (0.27, 0.0, 0.42), 'raise'),
        # armpit close-ups (round 7), framed on the shoulder pivot
        ('armpit-3q', 45, 5, 0.16, (-sx - 0.01, sy - 0.02, sz - 0.05), None),
        ('armpit-under', 0, -25, 0.16, (sx + 0.02, sy, sz - 0.05), None),
        ('armpit-up', 20, -40, 0.18, (sx + 0.03, sy, sz), 'raise'),
        # round 10: the joint at the wave peak, front
        ('armpit-wave', 0, 0, 0.22, (sx + 0.04, sy, sz + 0.02), 'wave'),
    ]


def aim_at(cam, azim, elev, scale, target):
    a, e = math.radians(azim), math.radians(elev)
    t = Vector(target)
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    cam.location = t + d * 5
    cam.rotation_euler = (math.radians(90) - e, 0, a)
    cam.data.ortho_scale = scale


def detail(cam, rig):
    """Close-ups at a fixed world framing (same in every round, so before/after line up). The
    wing-up view raises the left wing 100 deg to the side with the wave's twist (underside shown)."""
    d = os.path.join(OUT, 'detail')
    theme('light')
    rest = pv3._bone_rest(rig)
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = 900
    for name, az, el, scale, target, pose in _detail_views():
        pv3.reset_pose(rig)
        if pose == 'raise':
            pv3._set(rig, rest, 'wing.L', pv3._wing_raise('L', 100, getattr(pv3, 'WAVE_TWIST', 0)))
        elif pose == 'wave':
            pv3.pose_wave(rig, 20, rest)
        bpy.context.view_layer.update()
        bpy.data.objects['floor'].hide_render = el < 0      # from below: no shadow catcher in the way
        aim_at(cam, az, el, scale, target)
        shoot(os.path.join(d, f'{name}.png'), BACKDROP['light'])
    pv3.reset_pose(rig)
    bpy.data.objects['floor'].hide_render = False
    sc.render.resolution_x = sc.render.resolution_y = RES


def beforeafter():
    """earlier round(s) | this round, the same close-ups side by side. --prev takes one detail/ dir
    or several, comma-separated, oldest first (round 9: r7,r8 for the armpit)."""
    if not PREV:
        return
    prevs = PREV.split(',')
    d = os.path.join(OUT, 'detail')
    for out, names in (('face', ['face']), ('wing', ['wing-3q', 'wing-up']),
                       ('armpit', ['armpit-3q', 'armpit-under', 'armpit-up', 'armpit-wave'])):
        cols = prevs if out == 'armpit' else prevs[-1:]
        tiles = []
        for n in names:
            paths = [os.path.join(p_, f'{n}.png') for p_ in cols] + [os.path.join(d, f'{n}.png')]
            if all(os.path.exists(p_) for p_ in paths):
                tiles += [_resize(_load(p_), 720, 720) for p_ in paths]
        if tiles:
            _save(sheet(tiles, len(cols) + 1, 16, BACKDROP['light']), os.path.join(OUT, f'beforeafter-{out}.png'))


def _mask(px, backdrop):
    """Penguin mask of a flattened render: everything not reachable from the image border through
    backdrop-coloured pixels (so the white front, close to the backdrop, still counts as inside)."""
    off = np.abs(px[..., :3] - _hex01(backdrop)).max(2) > 0.03
    bg = np.zeros_like(off)
    bg[0, :] = bg[-1, :] = bg[:, 0] = bg[:, -1] = True
    bg &= ~off
    while True:
        grow = bg.copy()
        grow[1:] |= bg[:-1]
        grow[:-1] |= bg[1:]
        grow[:, 1:] |= bg[:, :-1]
        grow[:, :-1] |= bg[:, 1:]
        grow &= ~off
        if grow.sum() == bg.sum():
            return ~bg
        bg = grow


def _outline(m, r=4):
    e = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            e &= np.roll(np.roll(m, dy, 0), dx, 1)
    return m & ~e


def silhouette():
    """--prev-turnaround (previous round's turnaround/ PNGs) vs this round: the previous outline
    (orange) and this one (blue) over this round's render, faded, same camera."""
    if not PREV_TURN:
        return
    tiles = []
    for view in ('front', 'three-quarter-front-left', 'side-left'):
        a = os.path.join(PREV_TURN, f'{view}-light.png')
        b = os.path.join(OUT, 'turnaround', f'{view}-light.png')
        if not (os.path.exists(a) and os.path.exists(b)):
            continue
        pa, pb = _load(a), _load(b)
        if pa.shape != pb.shape:
            pa = _resize(pa, pb.shape[1], pb.shape[0])
        out = pb.copy()
        out[..., :3] = out[..., :3] * 0.45 + _hex01(BACKDROP['light']) * 0.55
        for px, col in ((pa, (0.93, 0.45, 0.10)), (pb, (0.16, 0.40, 0.82))):
            o = _outline(_mask(px, BACKDROP['light']))
            out[o, :3] = col
        h, w = out.shape[:2]
        cw = int(h * 0.8)
        x0 = (w - cw) // 2
        tiles.append(_resize(out[:, x0:x0 + cw].copy(), 640, 800))
    if tiles:
        _save(sheet(tiles, len(tiles), 16, BACKDROP['light']), os.path.join(OUT, 'silhouette.png'))


def poses(cam, rig):
    """Round 8: the pose library at one framing - raised wing front / 3/4 (raised.png pair) and a
    sheet of key poses (poses.png): rest, wave peak, wave swing, hop up, hop air, walk, seated,
    raise max, front and 3/4 rows."""
    rest = pv3._bone_rest(rig)
    theme('light')
    sc = bpy.context.scene
    d = os.path.join(OUT, 'poses')
    keep = sc.render.resolution_x
    sc.render.resolution_x = sc.render.resolution_y = 700

    def raise_max(r, f, rs):
        pv3.reset_pose(r)
        pv3._set(r, rs, 'wing.L', pv3._wing_raise('L', pv3.WING_RAISE_MAX, 0))
    keys = [('rest', lambda r, f, rs: pv3.reset_pose(r), 0),
            ('wave-peak', pv3.pose_wave, 17),
            ('wave-swing', pv3.pose_wave, 23),
            ('hop-up', pv3.pose_hop, 5),
            ('hop-air', pv3.pose_hop, 14),
            ('walk', pv3.pose_walk, 8),
            ('seated', lambda r, f, rs: pv3.pose_seated(r, 0, rs, (0.0, 0.0, 0.0)), 0),
            ('raise-max', raise_max, 0)]
    rows = {}
    for view, az, el in (('front', 0, 0), ('3q', 35, 8)):
        aim(cam, az, el, M_SCALE, M_TARGET_Z)
        tiles = []
        for name, fn, f in keys:
            fn(rig, f, rest)
            sc.frame_set(f)
            bpy.context.view_layer.update()
            pth = os.path.join(d, f'{name}-{view}.png')
            shoot(pth, BACKDROP['light'])
            tiles.append(_resize(_load(pth), 300, 300))
        rows[view] = tiles
    _save(sheet(rows['front'] + rows['3q'], len(keys), 8, BACKDROP['light']), os.path.join(OUT, 'poses.png'))
    pair = [_resize(_load(os.path.join(d, f'wave-peak-{v}.png')), 700, 700) for v in ('front', '3q')]
    _save(sheet(pair, 2, 16, BACKDROP['light']), os.path.join(OUT, 'raised.png'))
    pv3.reset_pose(rig)
    sc.render.resolution_x = sc.render.resolution_y = keep


MIN_CLEARANCE = 0.008     # round 9: wing to body / head / face pieces / feet / desk props, metres


def clearance(mesh, rig):
    """Round 9: acceptance check over every frame of every clip, seated alone and at the desk,
    and the max raise (identity_v3_metrics.clearance_report): min clearance of the wing paddles to
    the body, head, eyes / cheeks / beak, feet and desk props, plus the wing twist and forward
    travel. Writes clearance.txt; the run fails below MIN_CLEARANCE."""
    import identity_v3_metrics as M
    M.pv3 = pv3
    rows = M.clearance_report(M.Model(mesh, rig), with_props=True)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'clearance.txt'), 'w') as fh:
        fh.write('clip\tmin clearance (mm)\tframe\tnearest\tmax twist (deg)\tmax forward travel (mm)\n')
        for r_ in rows:
            fh.write(f"{r_['clip']}\t{r_['min_mm']:.1f}\t{r_['frame']}\t{r_['nearest']}\t"
                     f"{r_['twist_max_deg']:.1f}\t{r_['forward_max_mm']:.1f}\n")
    bad = [r_ for r_ in rows if r_['min_mm'] < MIN_CLEARANCE * 1000]
    if bad:
        raise SystemExit(f'wing clearance under {MIN_CLEARANCE * 1000:.0f} mm: {bad}')


def qa_gate():
    """The skills' checks as a gate before any rendering: see the module docstring."""
    import json
    import subprocess
    if not QA_SKILLS:
        return
    here = os.path.dirname(os.path.abspath(__file__))
    B = bpy.app.binary_path
    qa = os.path.join(OUT, 'qa')
    views = os.path.join(qa, 'views')
    os.makedirs(views, exist_ok=True)
    blend = os.path.join(qa, 'round.blend')
    lines = ['# QA gate', '']
    fails = []

    def run(args, what):
        p_ = subprocess.run(args, capture_output=True, text=True)
        if p_.returncode not in (0, 1):
            raise SystemExit(f'qa gate: {what} crashed:\n{p_.stdout[-2000:]}\n{p_.stderr[-2000:]}')
        return p_
    bake = [B, '-b', '--factory-startup', '-P', os.path.join(here, 'identity_v3_qa_blend.py'), '--',
            '--scripts', here, '--out', blend]
    if QA_CAMERAS:
        bake += ['--cameras-from', QA_CAMERAS]
    p_ = run(bake, 'bake')
    clips = next((ln.split(' ', 1)[1] for ln in p_.stdout.splitlines() if ln.startswith('CLIPS ')), '')
    run([B, '-b', blend, '--python', os.path.join(QA_SKILLS, 'qa_render.py'), '--', '--target', 'penguin_v3',
         '--out', views, '--quality', 'final', '--resolution', '640', '--frames', '0,77,168'], 'qa_render')
    run([B, '-b', blend, '-P', os.path.join(here, 'identity_v3_qa_blend.py'), '--', '--scripts', here,
         '--regions', os.path.join(qa, 'regions.json'), '--frames', '0,77,168'], 'regions')
    # render_compare against the previous round
    if QA_PREV and QA_CAMERAS:
        cur = json.load(open(os.path.join(qa, 'regions.json')))
        prev = json.load(open(os.path.join(QA_PREV, 'regions.json')))
        lines += [f'## render_compare vs {QA_PREV} (edit: {", ".join(QA_EDIT)}; '
                  f'max outside {QA_MAX_OUTSIDE})', '']
        for view in sorted(cur):
            args = [B, '-b', '--factory-startup', '--python', os.path.join(QA_SKILLS, 'render_compare.py'), '--',
                    '--before', os.path.join(QA_PREV, 'views', view + '.png'),
                    '--after', os.path.join(views, view + '.png'),
                    '--tol', '0.03', '--max-outside', str(QA_MAX_OUTSIDE)]
            for k in QA_EDIT:
                boxes = [rg[view][k] for rg in (cur, prev) if view in rg and k in rg[view]]
                if not boxes:
                    continue
                x0 = max(0.0, min(b_[0] for b_ in boxes) - 0.02)
                y0 = max(0.0, min(b_[1] for b_ in boxes) - 0.02)
                x1 = min(1.0, max(b_[2] for b_ in boxes) + 0.02)
                y1 = min(1.0, max(b_[3] for b_ in boxes) + 0.02)
                args += ['--region', f'{k}={x0:.3f},{y0:.3f},{x1:.3f},{y1:.3f}', '--edit', k]
            p_ = run(args, 'render_compare')
            out_ = next((ln for ln in p_.stdout.splitlines() if ln.startswith('| outside')), '')
            ok = p_.returncode == 0
            lines.append(f'- {view}: {"PASS" if ok else "FAIL"} {out_}')
            if not ok:
                fails.append(f'render_compare {view}')
        lines.append('')
    # round 11b: no white outside the wing's white face in the junction boxes (welt on / off)
    p_ = run([B, '-b', blend, '-P', os.path.join(here, 'identity_v3_qa_blend.py'), '--', '--scripts', here,
              '--white-check', os.path.join(qa, 'white.json'), '--frames', '0,77,168'], 'white check')
    wmax = next((int(ln.split()[1]) for ln in p_.stdout.splitlines() if ln.startswith('WHITE_MAX')), -1)
    ok = 0 <= wmax <= QA_MAX_WHITE
    lines += ['## white outside the wing\'s white face (junction box, welt on vs off, '
              f'max {QA_MAX_WHITE} px)', '', f'- worst view: {wmax} px - {"PASS" if ok else "FAIL"}', '']
    if not ok:
        fails.append('white outside the wing')
    # round 12: no visible seam where the joint fillet meets the body / the wing (shading only)
    p_ = run([B, '-b', blend, '-P', os.path.join(here, 'identity_v3_qa_blend.py'), '--', '--scripts', here,
              '--seam-check', os.path.join(qa, 'seam.json'), '--frames', '0,77,168'], 'seam check')
    sv = next((ln.split()[1:3] for ln in p_.stdout.splitlines() if ln.startswith('SEAM')), None)
    if sv and sv[0] != 'None' and sv[1] != 'None':
        ratio = float(sv[0]) / max(float(sv[1]), 1e-6)
        ok = ratio <= QA_MAX_SEAM_RATIO
        lines += ['## seam at the joint (shading only: luminance jump across the fillet edges vs '
                  f'across its middle, p95; max ratio {QA_MAX_SEAM_RATIO})', '',
                  f'- edges {float(sv[0]):.3f} / middle {float(sv[1]):.3f} = {ratio:.2f} - '
                  f'{"PASS" if ok else "FAIL"}', '']
        if not ok:
            fails.append('seam at the joint')
    # clearance over every clip
    moving = 'penguin_v3:wing_tip_L,penguin_v3:wing_tip_R'
    against = ('penguin_v3:head,penguin_v3:body,penguin_v3:face,penguin_v3:feet,'
               'penguin_v3:wing_tip_L,penguin_v3:wing_tip_R,prop_00_desk.set')
    lines += [f'## clearance_check (min {QA_MIN_CLEARANCE} m, subframes 2)', '']
    for spec in [c for c in clips.split(';') if c and not c.startswith('rest=')]:
        name, fr = spec.split('=')
        a_, b_ = fr.split('-')
        p_ = run([B, '-b', blend, '--python', os.path.join(QA_SKILLS, 'clearance_check.py'), '--',
                  '--moving', moving, '--against', against, '--frames', a_ if a_ == b_ else fr,
                  '--min-clearance', str(QA_MIN_CLEARANCE), '--subframes', '2',
                  '--out', os.path.join(qa, f'clearance_{name}.csv')], 'clearance_check')
        worst = next((ln for ln in p_.stdout.splitlines() if 'worst' in ln), '')
        ok = p_.returncode == 0
        lines.append(f'- {name}: {"PASS" if ok else "FAIL"} {worst}')
        if not ok:
            fails.append(f'clearance {name}')
    lines += ['', 'RESULT: ' + ('PASS' if not fails else 'FAIL: ' + ', '.join(fails))]
    open(os.path.join(qa, 'gate.md'), 'w').write('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    if fails:
        raise SystemExit('qa gate failed: ' + ', '.join(fails))


def main():
    qa_gate()
    mesh, rig, cam = build()
    if 'clearance' in ONLY:
        clearance(mesh, rig)
    if 'turnaround' in ONLY:
        turnaround(cam, rig)
    if 'compare' in ONLY:
        compare(cam, rig)
    if 'seated' in ONLY:
        seated(cam, rig)
    if 'motion' in ONLY:
        motion(cam, rig)
    if 'poses' in ONLY:
        poses(cam, rig)
    if 'detail' in ONLY:
        detail(cam, rig)
        beforeafter()
    if 'turnaround' in ONLY:
        silhouette()


main()
