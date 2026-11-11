"""Renders for the brand identity record (identity/character, identity/motion).

Builds the penguin from penguin.py + props.py + anim.py exactly as export.py does, then renders
a design sheet of it: a turnaround, face close-ups, the bare penguin, all 15 role props, and every
state clip (frames for an animated preview + a key-pose contact sheet). Nothing here changes the
shipped assets; it only looks at them.

    blender -b -P assets/office/scripts/identity_renders.py -- --out identity/_build [--samples 64]
        [--only turnaround,face,bare,props,motion] [--res 800]
    python3 assets/office/scripts/identity_pack.py identity/_build identity

Writes raw PNGs (transparent background, a soft contact shadow from a shadow catcher) into
  <out>/character/turnaround/  <out>/character/renders/  <out>/motion/clips/<clip>/
Motion frames go to <out>/motion/clips/<clip>/<view>/NNN.png. identity_pack.py turns the stills
into WebP and the frames into animated WebP; the raw PNGs (identity/_build/) are gitignored.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anim  # noqa: E402
import frames  # noqa: E402
import lib  # noqa: E402
import penguin  # noqa: E402
import props  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d


OUT = os.path.abspath(arg('--out', 'identity'))
SAMPLES = int(arg('--samples', '64'))
RES = int(arg('--res', '800'))
ONLY = set(arg('--only', 'turnaround,face,bare,props,motion').split(','))

TARGET_Z = 0.36          # middle of the seated penguin (0 .. 0.70, plus a head prop)
# (file name, azimuth, elevation) — azimuth 0 = the front (camera on -Y), + = round to the
# penguin's left (+X; the penguin's right is -X)
TURNAROUND = [
    ('front', 0, 0),
    ('three-quarter-left', 45, 15),
    ('side-left', 90, 0),
    ('back', 180, 0),
    ('three-quarter-right', -45, 15),
    ('top', 0, 90),
]
CLIP_VIEWS = [('front', 0, 0), ('three-quarter', 35, 20)]
KEY_POSES = 6            # frames per clip on the contact sheet
FRAME_STEP = 2           # 30 fps clip -> 15 fps preview


# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = lib.collection('penguin')
    mesh = penguin.build(col)
    prop_obs = props.build_all(col, mesh)
    rig = penguin.rig(col, mesh)
    for ob in prop_obs.values():
        props.attach(ob, rig)
    # a shadow catcher: the penguin sits on something, the backdrop stays transparent
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
    frames.render_settings('/tmp/identity.png', SAMPLES)
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.resolution_x = sc.render.resolution_y = RES
    return mesh, rig, prop_obs, cam


def show_props(prop_obs, agent=None):
    keep = set(props.AGENT_PROPS.get(agent, ['prop.scarf'])) if agent else set()
    for name, ob in prop_obs.items():
        ob.hide_render = name not in keep
    team = props.AGENT_TEAM.get(agent, 'product') if agent else 'product'
    lib.set_color('team_accent', lib.TEAM_COLORS[team])


def theme(name):
    """light = the office light frame's sky + sun; evening = the office evening (sky, moon rim)
    plus a cool fill from the front standing in for the laptop screen (an agent at work)."""
    frames.world(name)
    frames.sun(name)
    pal = lib.PALETTE if name == 'light' else {**lib.PALETTE, **lib.EVENING}
    lib.set_color('penguin.body', pal['penguin.body'])
    sc = bpy.context.scene
    fill = bpy.data.objects.get('fill')
    if fill is None:
        fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'AREA'))
        sc.collection.objects.link(fill)
    fill.data.color = lib.hex_rgba('#8FB8FF')[:3]
    fill.data.energy = 30
    fill.data.size = 0.4
    fill.location = (0, -0.7, 0.55)
    fill.rotation_euler = (math.radians(90), 0, 0)
    fill.hide_render = name != 'evening'


def aim(cam, azim, elev, scale, target_z=TARGET_Z):
    a, e = math.radians(azim), math.radians(elev)
    target = Vector((0, 0, target_z))
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    cam.location = target + d * 5
    cam.rotation_euler = (math.radians(90) - e, 0, a)
    cam.data.ortho_scale = scale


def shoot(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('wrote', path)


def sheet(paths, cols, out, gap=8):
    """Lay PNGs (same size) out in a grid on a transparent canvas, with numpy (no PIL in Blender)."""
    imgs = []
    for p in paths:
        im = bpy.data.images.load(p)
        w, h = im.size
        px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
        imgs.append(px)
        bpy.data.images.remove(im)
    h, w = imgs[0].shape[:2]
    rows = math.ceil(len(imgs) / cols)
    W, H = cols * w + (cols - 1) * gap, rows * h + (rows - 1) * gap
    canvas = np.zeros((H, W, 4), dtype=np.float32)
    for i, px in enumerate(imgs):
        r, c = divmod(i, cols)
        y0 = H - (r + 1) * h - r * gap          # Blender images are bottom-up
        x0 = c * (w + gap)
        canvas[y0:y0 + h, x0:x0 + w] = px
    img = bpy.data.images.new('sheet', W, H, alpha=True)
    img.pixels = canvas.ravel()
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    print('wrote', out)


# ---------------------------------------------------------------------------
# Sets
# ---------------------------------------------------------------------------

def turnaround(cam, rig, prop_obs):
    show_props(prop_obs)
    penguin.apply_pose(rig, 'idle')
    d = os.path.join(OUT, 'character', 'turnaround')
    for th in ('light', 'evening'):
        theme(th)
        for name, azim, elev in TURNAROUND:
            aim(cam, azim, elev, 0.95)
            shoot(os.path.join(d, f'{name}-{th}.png'))


def face(cam, rig, prop_obs):
    show_props(prop_obs)
    penguin.apply_pose(rig, 'idle')
    d = os.path.join(OUT, 'character', 'renders')
    for th in ('light', 'evening'):
        theme(th)
        aim(cam, 0, 0, 0.36, target_z=penguin.EYE_Z - 0.04)
        shoot(os.path.join(d, f'face-front-{th}.png'))
    theme('light')
    aim(cam, 30, 10, 0.40, target_z=penguin.EYE_Z - 0.04)
    shoot(os.path.join(d, 'face-three-quarter-light.png'))


def bare(cam, rig, prop_obs):
    show_props(prop_obs)
    penguin.apply_pose(rig, 'idle')
    d = os.path.join(OUT, 'character', 'renders')
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = min(1200, RES * 3 // 2)
    for th in ('light', 'evening'):
        theme(th)
        aim(cam, 30, 20, 0.95)
        shoot(os.path.join(d, f'bare-{th}.png'))
    sc.render.resolution_x = sc.render.resolution_y = RES


def props_grid(cam, rig, prop_obs):
    penguin.apply_pose(rig, 'idle')
    theme('light')
    d = os.path.join(OUT, 'character', 'renders', 'props')
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = 400
    aim(cam, 30, 15, 1.05, target_z=0.40)
    for agent in list(props.AGENT_PROPS) + ['custom-role']:
        show_props(prop_obs, agent)
        shoot(os.path.join(d, f'{agent}.png'))
    sc.render.resolution_x = sc.render.resolution_y = RES
    show_props(prop_obs)


def set_clip(rig, act):
    ad = rig.animation_data
    ad.action = act
    if getattr(ad, 'action_slot', None) is None and getattr(act, 'slots', None):
        ad.action_slot = act.slots[0]


def motion(cam, rig, prop_obs):
    acts = anim.build_actions(rig)
    show_props(prop_obs)
    theme('light')
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = 360
    samples = sc.cycles.samples
    sc.cycles.samples = min(samples, 32)
    for state, (length, _) in anim.CLIPS.items():
        set_clip(rig, acts[state])
        d = os.path.join(OUT, 'motion', 'clips', state)
        for view, azim, elev in CLIP_VIEWS:
            aim(cam, azim, elev, 1.10, target_z=0.40)
            for f in range(0, length, FRAME_STEP):
                sc.frame_set(f)
                shoot(os.path.join(d, view, f'{f:03d}.png'))
        # key poses: evenly through the loop, three-quarter view
        aim(cam, *CLIP_VIEWS[1][1:], 1.10, target_z=0.40)
        keys = []
        for k in range(KEY_POSES):
            f = round(k * length / KEY_POSES)
            sc.frame_set(f)
            p = os.path.join(d, 'keys', f'{f:03d}.png')
            shoot(p)
            keys.append(p)
        sheet(keys, KEY_POSES, os.path.join(d, f'{state}-keys.png'))
    sc.cycles.samples = samples
    rig.animation_data.action = None
    sc.frame_set(0)


def main():
    mesh, rig, prop_obs, cam = build()
    if 'turnaround' in ONLY:
        turnaround(cam, rig, prop_obs)
    if 'face' in ONLY:
        face(cam, rig, prop_obs)
    if 'bare' in ONLY:
        bare(cam, rig, prop_obs)
    if 'props' in ONLY:
        props_grid(cam, rig, prop_obs)
    if 'motion' in ONLY:
        motion(cam, rig, prop_obs)


main()
