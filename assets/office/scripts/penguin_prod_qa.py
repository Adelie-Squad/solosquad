"""The production penguin's motion gate (skills/rig-motion-clearance HARD GATE) over every clip.

    B=/Applications/Blender.app/Contents/MacOS/Blender
    $B -b -P assets/office/scripts/penguin_prod_qa.py -- --skills <dir with clearance_check.py, motion_path.py> \\
        --out assets/office/qa

Builds penguin_prod's mesh, joint fillets and rig (no bake), plays every clip one after another on
one timeline (a key every frame, the fillet's shape-key weights too) and saves <out>/clips.blend:

* the seated state clips sit on the office chair of `desk.set` (office-kit, placed so its seat
  point is the origin, contract §3); during the standing clips the desk is moved 5 m away and a
  card plane stands where the landing's content is (the eraser depth: 1 m in front, glTF +Z);
* vertex groups for the checkers: wing_tip_L / wing_tip_R (the paddle > 7 cm from its hinge — the
  root and the fillet are the joint, not a pair), head, body, face (eyes · cheeks · beak), feet.

Then runs, per clip: clearance_check (wing tips vs head · body · face · feet · the other tip ·
both fillets · the desk set · the card plane; min 8 mm, 2 subframes) and motion_path (wing tips +
head top: no pop, no kink), and checks the hinge angles stay within the limits. Writes
<out>/gate.md; exits 1 on any failure.
"""
import math
import os
import subprocess
import sys

import bmesh
import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
import lib  # noqa: E402
import penguin_prod as pp  # noqa: E402

pv3 = pp.pv3
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d


SKILLS = arg('--skills')
OUT = os.path.abspath(arg('--out', 'assets/office/qa'))
MIN_CLEARANCE = float(arg('--min-clearance', '0.008'))


def groups(mesh):
    me = mesh.data
    n = len(me.vertices)
    W = {g.name: np.zeros(n) for g in mesh.vertex_groups}
    for v in me.vertices:
        for g in v.groups:
            W[mesh.vertex_groups[g.group].name][v.index] = g.weight
    V = np.array([v.co[:] for v in me.vertices])
    mat = np.array([p.material_index for p in me.polygons])
    face_keys = {pp.MAT_KEYS.index(k) for k in ('penguin.eye', 'penguin.cheek', 'penguin.beak', 'penguin.stitch')}
    is_face = np.zeros(n, bool)
    for p in me.polygons:
        if p.material_index in face_keys:
            is_face[list(p.vertices)] = True
    out = {}
    for side in 'LR':
        piv, _ = pv3.wing_frame(side)
        out['wing_tip_' + side] = (W['wing.' + side] > 0.99) & (np.linalg.norm(V - piv, axis=1) > 0.07)
    wing = (W['wing.L'] > 0.5) | (W['wing.R'] > 0.5)
    feet = sum(W[k] for k in ('leg.L', 'leg.R', 'foot.L', 'foot.R')) > 0.5
    out['feet'] = feet & ~is_face
    out['head'] = (W['head'] > 0.5) & ~wing & ~feet & ~is_face
    out['body'] = (W['body'] > 0.5) & ~wing & ~feet & ~is_face
    out['face'] = is_face
    for name, sel in out.items():
        vg = mesh.vertex_groups.new(name=name)
        vg.add([int(i) for i in np.nonzero(sel)[0]], 1.0, 'REPLACE')
    _ = mat


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = lib.collection('penguin')
    mesh, joints, rig, _ = pp.build_all(col, bake=False, clips=False)
    for ob in list(bpy.data.objects):
        if ob.name.startswith('prop.'):
            bpy.data.objects.remove(ob, do_unlink=True)
    groups(mesh)
    # the fillets: only their body half is a pair for the wing tips - the wing half is sewn onto the
    # wing and moves with it (a seam, not a pair - skills/rig-motion-clearance §1)
    for j in joints:
        m = j['welt_m']
        n = len(j.data.vertices) // m
        vg = j.vertex_groups.new(name='body_half')
        vg.add([i * m + r for i in range(n) for r in range((m + 1) // 2)], 1.0, 'REPLACE')
    kcol = lib.collection('kit')
    desk = kit.desk_set(kcol)
    desk.name = 'desk.set'
    # the card plane: the landing's content, 1 m in front (Blender -Y), 3 x 3 m
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.5)
    card = lib.mesh_object('card', bm, kcol, lib.material('clay.wall'))
    card.rotation_euler = (math.radians(90), 0, 0)
    card.location = (0, -1.0, 0.4)
    # one timeline: every clip after the other, a key every frame
    rest = pv3._bone_rest(rig)
    sc = bpy.context.scene
    sc.render.fps = pp.FPS
    rig.animation_data_create()
    act = bpy.data.actions.new('qa')
    rig.animation_data.action = act
    ranges = []
    f0 = 0
    for name, (L, fn, seated) in pp.CLIPS.items():
        for f in range(L + 1):
            fn(rig, rest, f % L if f == L else f)
            frame = f0 + f
            for pb in rig.pose.bones:
                if not pb.name.startswith('socket.'):
                    for path in ('location', 'rotation_quaternion', 'scale'):
                        pb.keyframe_insert(path, frame=frame)
            for j in joints:
                for kb in j.data.shape_keys.key_blocks[1:]:
                    kb.keyframe_insert('value', frame=frame)
            desk.location = (0, -0.27, -0.42) if seated else (5.0, -0.27, -0.42)
            desk.keyframe_insert('location', frame=frame)
            card.location = (5.0, -1.0, 0.4) if seated else (0, -1.0, 0.4)
            card.keyframe_insert('location', frame=frame)
        ranges.append((name, f0, f0 + L))
        f0 += L + 2
    sc.frame_start, sc.frame_end = 0, f0
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'clips.blend')
    bpy.ops.wm.save_as_mainfile(filepath=path)
    angles = pp.motion_report(rig)
    return path, ranges, angles


def run(args):
    p = subprocess.run(args, capture_output=True, text=True)
    if p.returncode not in (0, 1):
        raise SystemExit(f'qa: crashed\n{p.stdout[-3000:]}\n{p.stderr[-3000:]}')
    return p


def main():
    path, ranges, angles = build()
    B = bpy.app.binary_path
    moving = 'penguin:wing_tip_L,penguin:wing_tip_R'
    against = ('penguin:head,penguin:body,penguin:face,penguin:feet,penguin:wing_tip_L,penguin:wing_tip_R,'
               'penguin.joint.L:body_half,penguin.joint.R:body_half,desk.set,card')
    lines = ['# Production penguin — motion gate', '',
             f"clearance_check: wing tips vs head · body · face · feet · other tip · the fillets' body halves · desk.set "
             f'(seated clips) · card plane (standing clips); min {MIN_CLEARANCE} m, 2 subframes.',
             'motion_path: wing.L / wing.R tips + head top; pop > 2.5x median spacing, kink > 60 deg.',
             f'hinge limits: raise -{pp.LOWER_MAX}..{pp.RAISE_MAX} deg, twist +-{pp.TWIST_MAX} deg.', '',
             'body · feet · head vs the chair and desk (seated clips): no crossing (contact allowed).', '',
             '| clip | frames | wing min clearance (mm) | at | nearest | body vs chair/desk (mm) | motion_path | raise (deg) | twist (deg) | result |',
             '|---|---|---|---|---|---|---|---|---|---|']
    fails = []
    for name, a, b in ranges:
        csv = os.path.join(OUT, f'clearance_{name}.csv')
        p = run([B, '-b', path, '--python', os.path.join(SKILLS, 'clearance_check.py'), '--',
                 '--moving', moving, '--against', against, '--frames', f'{a}-{b}',
                 '--min-clearance', str(MIN_CLEARANCE), '--subframes', '2', '--out', csv])
        worst = next((ln for ln in p.stdout.splitlines() if 'worst' in ln), '')
        ok_c = p.returncode == 0
        try:
            w = worst.split('worst ')[1]
            dist = float(w.split()[0]) * 1000
            at = w.split(' at frame ')[1].split()[0]
            nearest = w.split(' vs ')[1].split(' near')[0]
            frm = f'{float(at) - a:.1f}'
        except (IndexError, ValueError):
            dist, frm, nearest = float('nan'), '?', worst[:60]
        os.remove(csv) if os.path.exists(csv) else None
        m = run([B, '-b', path, '--python', os.path.join(SKILLS, 'motion_path.py'), '--',
                 '--track', 'penguin_rig:wing.L,penguin_rig:wing.R,penguin_rig:head', '--frames', f'{a}-{b}'])
        summary = next((ln for ln in m.stdout.splitlines() if 'problems' in ln), '').replace('motion_path: ', '')
        ok_m = m.returncode == 0
        seated = pp.CLIPS[name][2]
        # the seated body and feet on the chair: they rest on the seat (contact), never cross into the
        # chair or the desk (clearance 0 = touching is allowed, crossing is not)
        if seated:
            c = run([B, '-b', path, '--python', os.path.join(SKILLS, 'clearance_check.py'), '--',
                     '--moving', 'penguin:body,penguin:feet,penguin:head', '--against', 'desk.set',
                     '--frames', f'{a}-{b}', '--min-clearance', '0', '--subframes', '2'])
            chair = next((ln for ln in c.stdout.splitlines() if 'worst' in ln), '')
            ok_c = ok_c and c.returncode == 0
            try:
                chair_mm = f'{float(chair.split("worst ")[1].split()[0]) * 1000:.1f}'
            except (IndexError, ValueError):
                chair_mm = chair[:40]
        else:
            chair_mm = '—'
        r = angles[name]
        ok_a = r['raise'][0] >= -pp.LOWER_MAX - 1e-3 and r['raise'][1] <= pp.RAISE_MAX + 1e-3 and \
            abs(r['twist'][0]) <= pp.TWIST_MAX + 1e-3 and abs(r['twist'][1]) <= pp.TWIST_MAX + 1e-3
        ok = ok_c and ok_m and ok_a
        if not ok:
            fails.append(name)
        lines.append(f'| {name} | {b - a + 1} | {dist:.1f} | f{frm} | {nearest} | {chair_mm} | {summary} | '
                     f'{r["raise"][0]:.0f}..{r["raise"][1]:.0f} | {r["twist"][0]:.0f}..{r["twist"][1]:.0f} | '
                     f'{"PASS" if ok else "FAIL"} |')
        print(lines[-1], flush=True)
    lines += ['', 'RESULT: ' + ('PASS' if not fails else 'FAIL: ' + ', '.join(fails))]
    open(os.path.join(OUT, 'gate.md'), 'w').write('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    if '--keep' not in argv:
        os.remove(path)
    sys.exit(1 if fails else 0)


main()
