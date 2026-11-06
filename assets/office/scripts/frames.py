"""Style frames (DESIGN.md `## 사무실 장면` 제작 절차 1): one room, four penguins,
orthographic 30° / 45°, light and evening. Renders to assets/office/frames/.

Run in Blender:  blender -b -P assets/office/scripts/frames.py -- --out assets/office/frames
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
import lib  # noqa: E402
import penguin  # noqa: E402
import props  # noqa: E402

BACKDROP = {'light': '#EEE9DF', 'evening': '#15161B'}
EVENING_SKY = 0.9    # ambient #3A4566 strength
EVENING_RIM = 2.5    # moon rim sun strength

# Room = 3 x 3 tiles. Blender axes: walls on -X (left) and +Y (back), open to -Y.
COLS, ROWS = 2, 2

# (agent, team, desk module, (x, y), state)
SEATS = [
    ('chief', 'core', 'desk.chief', (0.25, -0.75), 'thinking'),
    ('product-manager', 'product', 'desk.set', (-1.12, 0.62), 'typing'),
    ('frontend-engineer', 'engineering', 'desk.set', (0.0, 0.62), 'waiting'),
    ('marketer', 'brand', 'desk.set', (1.12, 0.62), 'done'),
]

# Evening frame: who is working late (lamp on) and who rests (lamp off, dozing)
EVENING_STATES = {'chief': 'typing', 'product-manager': 'thinking',
                  'frontend-engineer': 'waiting', 'marketer': 'idle_doze'}


def reset():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    lib.purge_orphans()


def instance(src, name, col, loc=(0, 0, 0), rot_z=0.0, data_copy=False):
    ob = src.copy()
    if data_copy:
        ob.data = src.data.copy()
    ob.name = name
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    col.objects.link(ob)
    for ch in src.children:
        c = ch.copy()
        c.parent = ob
        col.objects.link(c)
    return ob


def team_material(base, team):
    name = f'{base}#{team}'
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials[base].copy()
        m.name = name
        lib.set_color(name, lib.TEAM_COLORS[team])
    return m


def build_scene():
    reset()
    kitcol = lib.collection('kit')
    mods = kit.build_all(kitcol)
    pgcol = lib.collection('penguin_src')
    pg = penguin.build(pgcol)
    prop_src = props.build_all(pgcol, pg)
    rig = penguin.rig(pgcol, pg)

    room = lib.collection('room')
    T = kit.TILE
    x0 = -(COLS - 1) * T / 2
    y0 = -(ROWS - 1) * T / 2
    for i in range(COLS):
        for j in range(ROWS):
            x, y = x0 + i * T, y0 + j * T
            instance(mods['room.floor_tile'], f'floor_{i}_{j}', room, (x, y, 0))
            if i == 0:
                instance(mods['room.wall_left'], f'wallL_{j}', room, (x, y, 0))
            if j == ROWS - 1:
                instance(mods['room.wall_back'], f'wallB_{i}', room, (x, y, 0))
    instance(mods['room.corner'], 'corner', room, (x0, y0 + (ROWS - 1) * T, 0))

    # shared props along the walls
    lx, by = x0 - T / 2, y0 + (ROWS - 1) * T + T / 2   # inner faces of left/back walls
    instance(mods['prop.whiteboard'], 'whiteboard', room, (-0.55, by - 0.03, 0))
    instance(mods['prop.shelf'], 'shelf', room, (1.05, by - 0.21, 0))
    instance(mods['prop.coffee_bar'], 'coffee', room, (lx + 0.27, 0.95, 0), math.radians(-90))
    instance(mods['prop.sofa'], 'sofa', room, (lx + 0.42, -0.95, 0), math.radians(-90))
    instance(mods['prop.plant'], 'plant_a', room, (lx + 0.28, by - 0.28, 0))
    instance(mods['prop.plant'], 'plant_b', room, (1.7, -1.7, 0))

    agents = lib.collection('agents')
    seats = []
    for agent, team, desk, (x, y), state in SEATS:
        d = instance(mods[desk], f'{desk}:{agent}', agents, (x, y, 0), data_copy=True)
        # paint the sticker in the team colour (what the web does at runtime)
        for k, slot in enumerate(d.material_slots):
            if slot.material and slot.material.name == 'team_sticker':
                d.data.materials[k] = team_material('team_sticker', team)
        w = 1.30 if desk == 'desk.chief' else 0.96
        lamp = instance(mods['lamp.desk'], f'lamp:{agent}', agents, (x - w / 2 + 0.12, y - 0.02, kit.DESK_TOP),
                        data_copy=True)
        r = make_agent(pg, rig, prop_src, agent, team, agents, (x, y + 0.27, 0.42))
        seats.append(dict(agent=agent, team=team, state=state, desk=d, lamp=lamp, rig=r))
    for c in (kitcol, pgcol):
        c.hide_render = True
        c.hide_viewport = True
    return seats


def make_agent(mesh_src, rig_src, prop_src, agent, team, col, loc):
    """One agent = rig copy + mesh copy + its role props on the socket bones."""
    r = rig_src.copy()
    r.name = f'rig:{agent}'
    r.location = loc
    col.objects.link(r)
    m = mesh_src.copy()
    m.name = f'penguin:{agent}'
    col.objects.link(m)
    m.parent = r
    m.matrix_parent_inverse = Matrix.Identity(4)
    m.matrix_basis = Matrix.Identity(4)
    m.modifiers['rig'].object = r
    bpy.context.view_layer.update()
    for name in props.AGENT_PROPS.get(agent, ['prop.scarf']):
        src = prop_src[name]
        q = src.copy()
        q.data = src.data.copy()
        q.name = f'{name}:{agent}'
        col.objects.link(q)
        for k, slot in enumerate(q.material_slots):
            if slot.material and slot.material.name == 'team_accent':
                q.data.materials[k] = team_material('team_accent', team)
        q.matrix_world = r.matrix_world @ src.matrix_world
        props.attach(q, r)
    return r


def pose_all(seats, states=None):
    for st in seats:
        penguin.apply_pose(st['rig'], (states or {}).get(st['agent'], st['state']))
    bpy.context.view_layer.update()


# ---------------------------------------------------------------------------
# Camera, world, lights
# ---------------------------------------------------------------------------

def camera():
    cam = bpy.data.objects.get('cam') or bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    if cam.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 7.0
    elev, azim = math.radians(30), math.radians(45)
    target = Vector((0.0, 0.05, 0.85))
    dirv = Vector((math.sin(azim) * math.cos(elev), -math.cos(azim) * math.cos(elev), math.sin(elev)))
    cam.location = target + dirv * 30
    cam.rotation_euler = (math.radians(90) - elev, 0, azim)
    cam.data.clip_end = 100
    bpy.context.scene.camera = cam
    return cam


def world(theme):
    w = bpy.data.worlds.get('office') or bpy.data.worlds.new('office')
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    lp = nt.nodes.new('ShaderNodeLightPath')
    sky = nt.nodes.new('ShaderNodeBackground')
    bd = nt.nodes.new('ShaderNodeBackground')
    mix = nt.nodes.new('ShaderNodeMixShader')
    if theme == 'light':
        sky.inputs['Color'].default_value = lib.hex_rgba('#FFFFFF')
        sky.inputs['Strength'].default_value = 0.72
    else:
        sky.inputs['Color'].default_value = lib.hex_rgba('#3A4566')
        sky.inputs['Strength'].default_value = EVENING_SKY
    bd.inputs['Color'].default_value = lib.hex_rgba(BACKDROP[theme])
    bd.inputs['Strength'].default_value = 1.0
    nt.links.new(lp.outputs['Is Camera Ray'], mix.inputs['Fac'])
    nt.links.new(sky.outputs['Background'], mix.inputs[1])
    nt.links.new(bd.outputs['Background'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])


def sun(theme):
    s = bpy.data.objects.get('sun')
    if s is None:
        s = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
        bpy.context.scene.collection.objects.link(s)
    if theme == 'light':
        # warm key light from the front-left, above
        s.data.angle = math.radians(14)
        s.data.color = lib.hex_rgba('#FFF6E8')[:3]
        s.data.energy = 1.5
        s.rotation_euler = (math.radians(42), 0, math.radians(-28))
    else:
        # cool moon rim from behind and above (back-left): outlines heads, shoulders and
        # props without lighting the faces, so an agent whose lamp is off stays in the dark
        s.data.angle = math.radians(8)
        s.data.color = lib.hex_rgba('#9FB2E8')[:3]
        s.data.energy = EVENING_RIM
        s.rotation_euler = (math.radians(-35), 0, math.radians(40))
    s.hide_render = False


def lamps(seats, theme):
    for st in seats:
        name = f'lamplight:{st["agent"]}'
        L = bpy.data.objects.get(name)
        on = theme == 'evening' and EVENING_STATES.get(st['agent']) not in ('idle', 'idle_doze')
        if L is None:
            L = bpy.data.objects.new(name, bpy.data.lights.new(name, 'POINT'))
            bpy.context.scene.collection.objects.link(L)
        anchor = next(c for c in st['lamp'].children if c.name.startswith('lamp.desk.light'))
        L.location = anchor.matrix_world.translation
        L.data.color = lib.hex_rgba('#FFC56B')[:3]
        L.data.energy = 18.0
        L.data.shadow_soft_size = 0.06
        L.hide_render = not on
        # screen glow toward the penguin's face
        sname = f'screenlight:{st["agent"]}'
        S = bpy.data.objects.get(sname)
        if S is None:
            S = bpy.data.objects.new(sname, bpy.data.lights.new(sname, 'AREA'))
            bpy.context.scene.collection.objects.link(S)
        S.data.shape = 'RECTANGLE'
        S.data.size, S.data.size_y = 0.26, 0.16
        S.data.color = lib.hex_rgba('#8FB8FF')[:3]
        S.data.energy = 14.0
        d = st['desk']
        S.location = d.matrix_world @ Vector((0, -0.24, kit.DESK_TOP + 0.11))
        S.rotation_euler = (math.radians(-90 - 14), 0, 0)   # face +Y (the agent)
        S.hide_render = not on


def _swap(ob, base, off):
    """Point this object's `base` slot at the per-agent 'off' copy (or back)."""
    name = f'{base}#off'
    m_off = bpy.data.materials.get(name)
    if m_off is None:
        m_off = bpy.data.materials[base].copy()
        m_off.name = name
    lib.set_emission(name, '#000000', 0.0)
    lib.principled(m_off).inputs['Base Color'].default_value = lib.principled(bpy.data.materials[base]).inputs['Base Color'].default_value[:]
    for k, slot in enumerate(ob.material_slots):
        if slot.material and slot.material.name in (base, name):
            ob.data.materials[k] = m_off if off else bpy.data.materials[base]


def materials_for(theme, seats):
    pal = lib.PALETTE if theme == 'light' else {**lib.PALETTE, **lib.EVENING}
    for k in ('clay.wall', 'clay.floor', 'clay.furniture', 'clay.wood', 'clay.plant', 'penguin.body'):
        lib.set_color(k, pal[k])
    if theme == 'light':
        lib.set_color('clay.screen', lib.PALETTE['clay.screen'])
        lib.set_emission('clay.screen', '#2C74E0', 0.0)
        lib.set_emission('clay.lamp_bulb', '#FFC56B', 0.0)
        lib.set_color('clay.lamp_bulb', lib.PALETTE['clay.lamp_bulb'])
    else:
        lib.set_color('clay.screen', '#1B2A4A')
        lib.set_emission('clay.screen', lib.EVENING['clay.screen'], 2.2)
        lib.set_color('clay.lamp_bulb', lib.EVENING['clay.lamp_bulb'])
        lib.set_emission('clay.lamp_bulb', lib.EVENING['clay.lamp_bulb'], 12.0)
    for st in seats:
        off = theme == 'evening' and EVENING_STATES.get(st['agent']) in ('idle', 'idle_doze')
        _swap(st['desk'], 'clay.screen', off)
        _swap(st['lamp'], 'clay.lamp_bulb', off)
        if off:
            lib.set_color('clay.screen#off', '#1B2A4A')


def render_settings(path, samples=192):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = 'GPU'
    except Exception:
        pass
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1200
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = path


def render(theme, out_dir, seats, samples=192):
    pose_all(seats, EVENING_STATES if theme == 'evening' else None)
    world(theme)
    sun(theme)
    lamps(seats, theme)
    materials_for(theme, seats)
    render_settings(os.path.join(out_dir, f'style-{theme}.png'), samples)
    bpy.ops.render.render(write_still=True)


def main(argv):
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'frames')
    if '--out' in argv:
        out = argv[argv.index('--out') + 1]
    seats = build_scene()
    camera()
    for theme in ('light', 'evening'):
        render(theme, out, seats)
        print(theme, measure(theme, out))




# Palette measurement: project known surface points through the camera and average the
# rendered pixels around them (DESIGN.md: 스타일 프레임 확정 때 실측해 고친다).
PROBES = {
    'clay.wall (left)': (-1.93, -0.3, 1.6),
    'clay.wall (back)': (0.3, 1.93, 1.9),
    'clay.floor': (1.5, -1.0, 0.0),
    'clay.furniture (desk top)': (-0.1, -1.15, 0.721),
    'clay.wood (coffee bar top)': (-1.75, 0.75, 0.921),
    'clay.plant': (1.66, -1.76, 1.07),
}


def measure(theme, out_dir):
    from bpy_extras.object_utils import world_to_camera_view
    sc = bpy.context.scene
    cam = sc.camera
    img = bpy.data.images.load(os.path.join(out_dir, f'style-{theme}.png'), check_existing=False)
    w, h = img.size
    px = img.pixels[:]
    res = {'clay.backdrop': None}
    pts = dict(PROBES)
    for key, p in pts.items():
        v = world_to_camera_view(sc, cam, Vector(p))
        x, y = int(v.x * w), int(v.y * h)
        acc = [0.0, 0.0, 0.0]
        n = 0
        for dx in range(-3, 4):
            for dy in range(-3, 4):
                i = ((y + dy) * w + (x + dx)) * 4
                for c in range(3):
                    acc[c] += px[i + c]
                n += 1
        res[key] = '#%02X%02X%02X' % tuple(round(a / n * 255) for a in acc)
    i = ((h - 10) * w + 10) * 4
    res['clay.backdrop'] = '#%02X%02X%02X' % tuple(round(px[i + c] * 255) for c in range(3))
    bpy.data.images.remove(img)
    return res


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv)
