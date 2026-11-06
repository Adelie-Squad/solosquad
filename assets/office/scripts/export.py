"""Export office-kit.glb and penguin.glb (contract §3–§8), built fresh from the scripts.

    blender -b -P assets/office/scripts/export.py -- --out assets/office/export

Steps
  kit:     build modules -> per-module materials `<palette key>#<module>` -> UV maps
           `uv_main` (TEXCOORD_0) + `uv_ao` (TEXCOORD_1) -> bake AO per module in Cycles ->
           wire it to glTF occlusion -> GLB (WebP textures)
  penguin: mesh + rig + 19 role props on socket bones + 7 state clips (one NLA track each)
  both:    meshopt compression with @gltf-transform/cli (same version the web pins)

Room pieces (`room.*`) get no AO map: a lone flat slab or wall bakes to plain white, and
the corner shading comes from how the web places them.
"""
import os
import shutil
import subprocess
import sys
import tempfile

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anim  # noqa: E402
import kit  # noqa: E402
import lib  # noqa: E402
import penguin  # noqa: E402
import props  # noqa: E402

GLTF_TRANSFORM = '@gltf-transform/cli@4.5.1'

AO_SIZE = {
    'desk.set': 1024, 'desk.chief': 1024, 'prop.sofa': 1024, 'prop.shelf': 1024,
    'prop.coffee_bar': 512, 'prop.plant': 512, 'prop.whiteboard': 512, 'lamp.desk': 256,
}
AO_DISTANCE = 0.35


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def cycles_setup(samples=96):
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
    sc.world = sc.world or bpy.data.worlds.new('bake')
    sc.world.light_settings.distance = AO_DISTANCE   # Cycles AO bake distance


def gltf_output_group():
    """The node group the glTF exporter reads for occlusion."""
    ng = bpy.data.node_groups.get('glTF Material Output')
    if ng is None:
        ng = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        if hasattr(ng, 'interface'):
            ng.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        else:
            ng.inputs.new('NodeSocketFloat', 'Occlusion')
    return ng


def module_materials(ob, module):
    """Give a module its own material instances named `<key>#<module>`."""
    for i, slot in enumerate(ob.material_slots):
        base = slot.material
        key = base.name.split('#')[0]
        name = f'{key}#{module}'
        m = bpy.data.materials.get(name) or base.copy()
        m.name = name
        lib.principled(m).inputs['Metallic'].default_value = 0.0
        ob.data.materials[i] = m


def add_uvs(ob):
    me = ob.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name='uv_main')
    ao = me.uv_layers.new(name='uv_ao')
    me.uv_layers.active = ao
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    ob.select_set(True)
    vl.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    # uv_main = same layout (the web only needs uv_ao, but uv_ao must be TEXCOORD_1)
    for a, b in zip(me.uv_layers['uv_main'].data, ao.data):
        a.uv = b.uv


def bake_ao(ob, module, size, tmpdir):
    img = bpy.data.images.new(f'{module}_ao', size, size, alpha=False)
    img.generated_color = (1, 1, 1, 1)
    group = gltf_output_group()
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        uv = nt.nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'uv_ao'
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        tex.name = 'AO'
        nt.links.new(uv.outputs['UV'], tex.inputs['Vector'])
        nt.nodes.active = tex
        out = nt.nodes.new('ShaderNodeGroup')
        out.node_tree = group
        out.name = 'glTF Material Output'
        tex['_out'] = out.name
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    ob.select_set(True)
    vl.objects.active = ob
    sc = bpy.context.scene
    sc.render.bake.margin = 8
    bpy.ops.object.bake(type='AO', margin=8)
    path = os.path.join(tmpdir, f'{module}_ao.png')
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    img.pack()
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        tex = nt.nodes['AO']
        out = nt.nodes['glTF Material Output']
        nt.links.new(tex.outputs['Color'], out.inputs['Occlusion'])


def export_kit(out_dir, tmpdir):
    reset()
    cycles_setup()
    col = lib.collection('office-kit')
    mods = kit.build_all(col)
    for name, ob in mods.items():
        module_materials(ob, name)
    for name, ob in mods.items():
        add_uvs(ob)
    # bake each module alone so tiles and modules join without baked neighbours
    for name, ob in mods.items():
        if name.startswith('room.'):
            continue
        for o in mods.values():
            o.hide_render = o is not ob
        bake_ao(ob, name, AO_SIZE.get(name, 512), tmpdir)
    for o in mods.values():
        o.hide_render = False
    path = os.path.join(tmpdir, 'office-kit.glb')
    _gltf(path, animations=False)
    return path


def export_penguin(out_dir, tmpdir):
    reset()
    col = lib.collection('penguin')
    mesh = penguin.build(col)
    prop_obs = props.build_all(col, mesh)
    rig = penguin.rig(col, mesh)
    for ob in prop_obs.values():
        props.attach(ob, rig)
    for m in bpy.data.materials:
        lib.principled(m).inputs['Metallic'].default_value = 0.0
    anim.build_actions(rig)
    path = os.path.join(tmpdir, 'penguin.glb')
    _gltf(path, animations=True)
    return path


def _gltf(path, animations):
    kw = dict(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
              export_extras=True, export_image_format='WEBP', export_texcoords=True,
              export_normals=True, export_materials='EXPORT', export_cameras=False,
              export_lights=False)
    if animations:
        kw.update(export_animations=True, export_animation_mode='NLA_TRACKS',
                  export_skins=True, export_def_bones=False, export_force_sampling=True,
                  export_frame_range=False, export_anim_single_armature=True,
                  export_optimize_animation_size=False, export_reset_pose_bones=True)
    else:
        kw.update(export_animations=False, export_skins=False)
    bpy.ops.export_scene.gltf(**kw)


def meshopt(src, dst):
    npx = shutil.which('npx')
    if not npx:
        raise SystemExit('npx not found: install Node to run meshopt compression')
    subprocess.run([npx, '-y', GLTF_TRANSFORM, 'meshopt', src, dst], check=True)


def main(argv):
    out_dir = os.path.abspath(argv[argv.index('--out') + 1]) if '--out' in argv else \
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'export')
    os.makedirs(out_dir, exist_ok=True)
    tmpdir = tempfile.mkdtemp(prefix='office-export-')
    raw = [export_kit(out_dir, tmpdir), export_penguin(out_dir, tmpdir)]
    for src in raw:
        dst = os.path.join(out_dir, os.path.basename(src))
        if '--no-meshopt' in argv:
            shutil.copy(src, dst)
        else:
            meshopt(src, dst)
        print('exported', dst, os.path.getsize(dst))
    if '--keep-ao' in argv:
        for f in os.listdir(tmpdir):
            if f.endswith('_ao.png'):
                shutil.copy(os.path.join(tmpdir, f), os.path.join(out_dir, f))


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
