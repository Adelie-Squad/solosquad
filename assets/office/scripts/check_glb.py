"""Check the exported GLBs against the contract (plain Python, no Blender needed).

    python3 assets/office/scripts/check_glb.py assets/office/export

Reads only the GLB JSON chunk, so it works on meshopt-compressed files. Exits 1 on failure.
"""
import json
import os
import struct
import sys

KIT_ROOTS = {'room.floor_tile', 'room.wall_left', 'room.wall_back', 'room.corner', 'desk.set',
             'desk.chief', 'lamp.desk', 'prop.plant', 'prop.shelf', 'prop.whiteboard',
             'prop.sofa', 'prop.coffee_bar'}
BONES = {'root', 'body', 'head', 'wing.L', 'wing.R', 'foot.L', 'foot.R',
         'socket.head', 'socket.chest', 'socket.hand.R'}
CLIPS = {'idle', 'idle_doze', 'thinking', 'typing', 'waiting', 'done', 'error'}
PROPS = {'prop.chief.crown', 'prop.chief.bowtie', 'prop.product-manager.clipboard',
         'prop.product-designer.beret', 'prop.researcher.glasses', 'prop.data-analyst.chart',
         'prop.frontend-engineer.beanie', 'prop.backend-engineer.headset',
         'prop.data-engineer.cube', 'prop.infra.hardhat', 'prop.infra.shield',
         'prop.quality-assurance.magnifier', 'prop.business-strategy.tie', 'prop.sales.card',
         'prop.finance.glasses', 'prop.finance.calculator', 'prop.marketer.megaphone',
         'prop.creative.brush', 'prop.scarf'}
BUDGET_BYTES = 5 * 1024 * 1024


def load(path):
    b = open(path, 'rb').read()
    n = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20 + n])


def main(d):
    errs = []
    k = load(os.path.join(d, 'office-kit.glb'))
    p = load(os.path.join(d, 'penguin.glb'))
    roots = {k['nodes'][i]['name'] for i in k['scenes'][0]['nodes']}
    if roots != KIT_ROOTS:
        errs.append(f'kit roots differ: missing {KIT_ROOTS - roots}, extra {roots - KIT_ROOTS}')
    lamp = next(n for n in k['nodes'] if n.get('name') == 'lamp.desk')
    if 'lamp.desk.light' not in [k['nodes'][c].get('name') for c in lamp.get('children', [])]:
        errs.append('lamp.desk.light missing')
    for doc, tag in ((k, 'kit'), (p, 'penguin')):
        for m in doc['materials']:
            pbr = m.get('pbrMetallicRoughness', {})
            if pbr.get('metallicFactor', 1) != 0:
                errs.append(f'{tag} material {m["name"]}: metallic != 0')
            if pbr.get('roughnessFactor', 1) < 0.8:
                errs.append(f'{tag} material {m["name"]}: roughness < 0.8')
    for m in k['materials']:
        if '#' not in m['name']:
            errs.append(f'kit material {m["name"]} is not <key>#<module>')
    occ = [m for m in k['materials'] if 'occlusionTexture' in m]
    if any(m['occlusionTexture'].get('texCoord', 0) != 1 for m in occ):
        errs.append('occlusionTexture texCoord != 1')
    no_ao = sorted({m['name'].split('#')[1] for m in k['materials'] if 'occlusionTexture' not in m})
    mimes = {i.get('mimeType') for i in k.get('images', [])}
    if mimes - {'image/webp'}:
        errs.append(f'non-WebP images: {mimes}')
    joints = {p['nodes'][j]['name'] for j in p['skins'][0]['joints']}
    if not BONES <= joints:
        errs.append(f'missing bones {BONES - joints}')
    props = {n['name']: n.get('extras', {}).get('socket') for n in p['nodes'] if n.get('name', '').startswith('prop.')}
    if set(props) != PROPS:
        errs.append(f'props differ: missing {PROPS - set(props)}, extra {set(props) - PROPS}')
    errs += [f'{n}: no socket extra' for n, s in props.items() if s not in ('head', 'chest', 'hand.R')]
    anims = {a['name'] for a in p['animations']}
    if anims != CLIPS:
        errs.append(f'clips differ: missing {CLIPS - anims}, extra {anims - CLIPS}')
    if not any('skin' in n for n in p['nodes']):
        errs.append('penguin mesh node is not skinned')
    size = sum(os.path.getsize(os.path.join(d, f)) for f in ('office-kit.glb', 'penguin.glb'))
    if size > BUDGET_BYTES:
        errs.append(f'total {size} bytes > 5 MB')
    print(f'kit: {len(roots)} modules, {len(k["materials"])} materials, {len(occ)} with AO '
          f'(no AO: {", ".join(no_ao)}), images {sorted(mimes)}')
    print(f'penguin: {len(joints)} joints, {len(props)} props, clips {sorted(anims)}')
    print(f'total {size / 1024:.0f} KB')
    for e in errs:
        print('FAIL', e)
    print('OK' if not errs else f'{len(errs)} problem(s)')
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else 'assets/office/export'))
