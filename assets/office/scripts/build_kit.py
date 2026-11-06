"""Build office-kit.blend from an empty scene (contract §1 — the source of truth).

    blender -b -P assets/office/scripts/build_kit.py -- --save assets/office/src/office-kit.blend
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
import lib  # noqa: E402


def main(argv):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = lib.collection('office-kit')
    mods = kit.build_all(col)
    # spread modules out on a line so the file is readable when opened; export.py resets
    # each root to the origin.
    x = 0.0
    for ob in mods.values():
        ob.location.x = x
        x += max(ob.dimensions.x, 0.6) + 0.5
    if '--save' in argv:
        path = os.path.abspath(argv[argv.index('--save') + 1])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=path)
        print('saved', path)


if __name__ == '__main__':
    main(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
