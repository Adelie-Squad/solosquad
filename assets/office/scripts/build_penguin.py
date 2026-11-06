"""Build penguin.blend from an empty scene: mesh `penguin` + armature `penguin_rig` +
the role props on their socket bones (contract §5).

    blender -b -P assets/office/scripts/build_penguin.py -- --save assets/office/src/penguin.blend
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
import penguin  # noqa: E402
import props  # noqa: E402


def main(argv):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = lib.collection('penguin')
    mesh = penguin.build(col)
    prop_obs = props.build_all(col, mesh)
    rig = penguin.rig(col, mesh)
    for ob in prop_obs.values():
        props.attach(ob, rig)
    if '--save' in argv:
        path = os.path.abspath(argv[argv.index('--save') + 1])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=path)
        print('saved', path)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
