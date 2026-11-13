"""Armpit / motion acceptance metrics for the penguin v3 draft (round 9). Works on any round's
penguin_v3.py, so rounds can be compared with the same code:

    B=/Applications/Blender.app/Contents/MacOS/Blender
    $B -b -P assets/office/scripts/identity_v3_metrics.py -- --scripts <dir with penguin_v3.py> \\
        --out metrics.json [--props]

Measured on the left wing, with the posed (evaluated) mesh:
  smooth     max / p99 angle between adjacent face normals within 9 cm of the shoulder pivot, and the
             largest deviation of the white wing edge (seam_d = 0 contour) from its own smoothed curve
             (gaussian along the arc, sigma 6 mm) - per pose: rest, wave peak, raise 100 deg
  band       black band between the white and the wing/body crease (zero contour of
             f_body - f_wing on the surface the wing is on), inner face only (w < -8 mm): median / max
  hinge      body-owned skin that takes > 0.5 wing weight: how far from the pivot / how low it goes
  clearance  per clip and frame: posed wing points (> 7 cm out from the pivot) vs the body / head
             field, the eyes / cheeks / beak / feet (nearest point) and, seated at the desk, the
             desk-set props (BVH, signed); min in mm
  motion     per clip: max wing twist about its own axis and max forward travel of the wing tip,
             both in the body bone's frame
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

pv3 = None


def setup(scripts_dir):
    global pv3
    sys.path.insert(0, scripts_dir)
    import penguin_v3 as m  # noqa: E402
    pv3 = m
    return m


# ---------------------------------------------------------------------------

def posed_verts(mesh):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    ev.to_mesh_clear()
    mw = np.array(mesh.matrix_world)
    P = co.reshape(-1, 3)
    return P @ mw[:3, :3].T + mw[:3, 3]


def rest_verts(mesh):
    co = np.empty(len(mesh.data.vertices) * 3)
    mesh.data.vertices.foreach_get('co', co)
    return co.reshape(-1, 3)


def attr(mesh, name):
    a = mesh.data.attributes[name]
    v = np.empty(len(a.data))
    a.data.foreach_get('value', v)
    return v


def group_weights(mesh, name):
    w = np.zeros(len(mesh.data.vertices))
    vg = mesh.vertex_groups.get(name)
    if vg is None:
        return w
    gi = vg.index
    for v in mesh.data.vertices:
        for g in v.groups:
            if g.group == gi:
                w[v.index] = g.weight
    return w


def faces(mesh):
    return [tuple(p.vertices) for p in mesh.data.polygons]


def components(n, F):
    parent = np.arange(n)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for f in F:
        r0 = find(f[0])
        for v in f[1:]:
            r1 = find(v)
            if r1 != r0:
                parent[r1] = r0
    return np.array([find(i) for i in range(n)])


def bone_delta(rig, name):
    pb = rig.pose.bones[name]
    return pb.matrix @ pb.bone.matrix_local.inverted()


def to_np(M):
    return np.array(M)


def apply(M, P):
    M = to_np(M)
    return P @ M[:3, :3].T + M[:3, 3]


# ---------------------------------------------------------------------------

def contour_segments(P, F, f, mask=None):
    """Zero contour of a per-vertex field over polygons: list of (a, b) 3D segments."""
    segs = []
    for poly in F:
        if mask is not None and not all(mask[i] for i in poly):
            continue
        pts = []
        m = len(poly)
        for k in range(m):
            a, b = poly[k], poly[(k + 1) % m]
            if (f[a] > 0) != (f[b] > 0):
                t = f[a] / (f[a] - f[b])
                pts.append(P[a] + (P[b] - P[a]) * t)
        for i in range(0, len(pts) - 1, 2):
            segs.append((pts[i], pts[i + 1]))
    return segs


def chains(segs, tol=1e-6):
    """Join segments into polylines (by shared end points)."""
    if not segs:
        return []
    key = lambda p: tuple(np.round(p / 1e-5).astype(np.int64))  # noqa: E731
    adj = {}
    pt = {}
    for a, b in segs:
        ka, kb = key(a), key(b)
        pt[ka], pt[kb] = a, b
        adj.setdefault(ka, []).append(kb)
        adj.setdefault(kb, []).append(ka)
    seen = set()
    out = []
    for start in adj:
        if start in seen:
            continue
        # walk to one end first
        chain = [start]
        seen.add(start)
        for direction in (0, 1):
            cur = start
            prev = None
            while True:
                nxt = [k for k in adj[cur] if k != prev and k not in seen]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
                seen.add(cur)
                if direction == 0:
                    chain.append(cur)
                else:
                    chain.insert(0, cur)
        out.append(np.array([pt[k] for k in chain]))
    return out


def deviation(chain, sigma=0.006):
    """Max distance (m) of a polyline from its own gaussian-smoothed version (along the arc)."""
    if len(chain) < 6:
        return 0.0
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(chain, axis=0), axis=1))])
    if s[-1] < 0.02:
        return 0.0
    w = np.exp(-((s[:, None] - s[None, :]) / sigma) ** 2)
    sm = (w @ chain) / w.sum(1)[:, None]
    keep = (s > 2 * sigma) & (s < s[-1] - 2 * sigma)       # away from the open ends
    if not keep.any():
        return 0.0
    return float(np.linalg.norm(chain[keep] - sm[keep], axis=1).max())


def dihedral(P, F, sel):
    """Angles (deg) between normals of adjacent polygons whose vertices are all in sel."""
    nrm = {}
    edge_f = {}
    for fi, poly in enumerate(F):
        if not all(sel[i] for i in poly):
            continue
        a, b, c = P[poly[0]], P[poly[1]], P[poly[2]]
        n = np.cross(b - a, c - a)
        if len(poly) == 4:
            n = np.cross(P[poly[2]] - P[poly[0]], P[poly[3]] - P[poly[1]])
        ln = np.linalg.norm(n)
        if ln < 1e-12:
            continue
        nrm[fi] = n / ln
        m = len(poly)
        for k in range(m):
            e = tuple(sorted((poly[k], poly[(k + 1) % m])))
            edge_f.setdefault(e, []).append(fi)
    ang = []
    for e, fs in edge_f.items():
        if len(fs) == 2 and fs[0] in nrm and fs[1] in nrm:
            ang.append(math.degrees(math.acos(float(np.clip(nrm[fs[0]] @ nrm[fs[1]], -1, 1)))))
    return np.array(ang) if ang else np.zeros(1)


# ---------------------------------------------------------------------------

class Model:
    def __init__(self, mesh, rig):
        self.mesh, self.rig = mesh, rig
        self.R = rest_verts(mesh)
        self.F = faces(mesh)
        self.n = len(self.R)
        self.seam = attr(mesh, 'seam_d')
        self.w = {s: group_weights(mesh, 'wing.' + s) for s in 'LR'}
        feet = np.zeros(self.n)
        for g in ('foot.L', 'foot.R', 'leg.L', 'leg.R'):
            feet = np.maximum(feet, group_weights(mesh, g))
        self.feet = feet > 0.5
        mi = np.empty(len(mesh.data.polygons), int)
        mesh.data.polygons.foreach_get('material_index', mi)
        app = np.zeros(self.n, bool)
        for fi in np.nonzero(mi > 0)[0]:
            app[list(self.F[fi])] = True
        self.appl = app
        comp = components(self.n, self.F)
        self.comp = comp
        # a wing piece = a component (not the appliques) rigid on one wing bone
        self.piece = {}
        for s in 'LR':
            m = np.zeros(self.n, bool)
            for c in np.unique(comp[(self.w[s] > 0.999) & ~app]):
                cm = comp == c
                if (self.w[s][cm] > 0.999).all():
                    m |= cm
            self.piece[s] = m
        sizes = np.bincount(comp)
        self.skin = comp == sizes.argmax()
        self.fb = pv3.f_body(self.R)
        self.fw = {s: pv3.f_wing(self.R, s) for s in 'LR'}
        self.piv = {s: pv3.wing_frame(s)[0] for s in 'LR'}
        self.u = {s: pv3._wing_local(self.R, s)[:, 0] for s in 'LR'}
        self.q = {s: pv3._wing_local(self.R, s) for s in 'LR'}
        # posed wing points for the clearance: the paddle, well out of the hinge
        self.wpts = {s: np.nonzero((self.w[s] > 0.99) & (self.u[s] > 0.07) & ~app)[0] for s in 'LR'}

    def wing_surface(self, s):
        """The surface the wing's colour lives on: its piece, or the skin."""
        return self.piece[s] if self.piece[s].any() else self.skin


def pose_fns():
    rest = None

    def rest_pose(rig, f, rs):
        pv3.reset_pose(rig)

    def wave_peak(rig, f, rs):
        pv3.pose_wave(rig, 20, rs)

    def raise100(rig, f, rs):
        pv3.reset_pose(rig)
        tw = 0.0
        pv3._set(rig, rs, 'wing.L', pv3._wing_raise('L', 100, tw))
    return [('rest', rest_pose), ('wave-peak', wave_peak), ('raise-100', raise100)]


def set_pose(model, fn, f=0):
    rs = pv3._bone_rest(model.rig)
    fn(model.rig, f, rs)
    bpy.context.scene.frame_set(f)
    bpy.context.view_layer.update()


def smooth_metrics(model, P, s='L'):
    piv_posed = apply(bone_delta(model.rig, 'wing.' + s), model.piv[s][None])[0]
    near = np.linalg.norm(P - piv_posed, axis=1) < 0.09
    sel = near & ~model.appl
    # only what can be seen: a wing piece's root inside the body is hidden (skin rounds have none)
    D = to_np(bone_delta(model.rig, 'body').inverted())
    hidden = model.piece[s] & (pv3.f_body(P @ D[:3, :3].T + D[:3, 3]) < -0.001)
    sel = sel & ~hidden
    ang = dihedral(P, model.F, sel)
    # white wing edge near the joint, on the wing's surface
    surf = model.wing_surface(s) & sel
    wing_side = (model.w[s] > 0.5) | model.piece[s]
    segs = contour_segments(P, model.F, model.seam, mask=surf & wing_side)
    dev = max([deviation(c) for c in chains(segs)] + [0.0])
    return {'normal_max_deg': float(ang.max()), 'normal_p99_deg': float(np.percentile(ang, 99)),
            'edge_dev_mm': dev * 1000}


def band_metrics(model, P, s='L'):
    """Black band between the white and the wing/body crease on the inner face."""
    rig = model.rig
    Db = to_np(bone_delta(rig, 'body').inverted())
    Dw = to_np(bone_delta(rig, 'wing.' + s).inverted())
    Pb = P @ Db[:3, :3].T + Db[:3, 3]
    Pw = P @ Dw[:3, :3].T + Dw[:3, 3]
    d = pv3.f_body(Pb) - pv3.f_wing(Pw, s)
    surf = model.wing_surface(s) & (np.linalg.norm(model.R - model.piv[s], axis=1) < 0.16)
    crease = chains(contour_segments(P, model.F, d, mask=surf))
    white = chains(contour_segments(P, model.F, model.seam, mask=surf))
    if not crease:
        return {'band_median_mm': None, 'band_max_mm': None, 'n': 0}
    C = np.concatenate(crease)
    # wing-local w of each crease point (rest frame of the wing): inner face only
    Cw = C @ Dw[:3, :3].T + Dw[:3, 3]
    qw = pv3._wing_local(Cw, s)
    inner = qw[:, 2] < -0.008
    C = C[inner]
    if not len(C):
        return {'band_median_mm': None, 'band_max_mm': None, 'n': 0}
    # is the crease point itself in the white? interpolate seam_d at the nearest vertex
    kd = KDTree(int(surf.sum()))
    idx = np.nonzero(surf)[0]
    for k, i in enumerate(idx):
        kd.insert(Vector(P[i]), k)
    kd.balance()
    in_white = np.array([model.seam[idx[kd.find(Vector(c))[1]]] > 0 for c in C])
    if white:
        Wp = np.concatenate(white)
        kw = KDTree(len(Wp))
        for k, p in enumerate(Wp):
            kw.insert(Vector(p), k)
        kw.balance()
        dist = np.array([kw.find(Vector(c))[2] for c in C])
    else:
        dist = np.full(len(C), 1.0)
    width = np.where(in_white, 0.0, dist)
    return {'band_median_mm': float(np.median(width) * 1000), 'band_max_mm': float(width.max() * 1000),
            'n': int(len(C))}


def hinge_metrics(model, s='L'):
    body_owned = model.skin & (model.fb < model.fw[s] - 0.002) & ~model.appl
    out = {}
    for th in (0.05, 0.5):
        m = body_owned & (model.w[s] > th)
        if m.any():
            r = np.linalg.norm(model.R[m] - model.piv[s], axis=1).max()
            zmin = model.R[m, 2].min()
            out[f'w>{th}'] = {'verts': int(m.sum()), 'reach_cm': float(r * 100),
                              'lowest_pct': float((zmin - pv3.Z0) / pv3.HB * 100)}
        else:
            out[f'w>{th}'] = {'verts': 0, 'reach_cm': 0.0, 'lowest_pct': None}
    out['pivot_pct'] = float((model.piv[s][2] - pv3.Z0) / pv3.HB * 100)
    return out


# ---------------------------------------------------------------------------

def _props_bvh(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for ob in objs:
        if ob.type != 'MESH':
            continue
        out.append(BVHTree.FromObject(ob, dg))       # world space (deform + transform)
    return out


def clearance_frame(model, props=()):
    """Min distance (m) of the posed wing paddles to the body/head (field, signed), the appliques
    and feet (nearest point) and props (BVH, signed), plus which one."""
    P = posed_verts(model.mesh)
    rig = model.rig
    best = (float('inf'), '')
    others = model.appl | model.feet
    kd = KDTree(int(others.sum()))
    oi = np.nonzero(others)[0]
    for k, i in enumerate(oi):
        kd.insert(Vector(P[i]), k)
    kd.balance()
    for s in 'LR':
        W = P[model.wpts[s]]
        for name in ('body', 'head'):
            D = to_np(bone_delta(rig, name).inverted())
            v = float(pv3.f_body(W @ D[:3, :3].T + D[:3, 3]).min())
            if v < best[0]:
                best = (v, name)
        hits = [kd.find(Vector(p)) for p in W[::2]]
        k = int(np.argmin([h[2] for h in hits]))
        if hits[k][2] < best[0]:
            best = (hits[k][2], 'feet' if model.feet[oi[hits[k][1]]] else 'face')
        for bvh in props:
            for p in W[::3]:
                hit = bvh.find_nearest(Vector(p))
                if hit[0] is None:
                    continue
                loc, nrm, _, dist = hit
                sgn = 1.0 if (Vector(p) - loc).dot(nrm) >= 0 else -1.0
                if sgn * dist < best[0]:
                    best = (sgn * dist, 'desk')
    return best


def motion_frame(model, s):
    """(twist deg about the wing's own axis, forward travel m of the tip) in the body frame."""
    rig = model.rig
    Db = bone_delta(rig, 'body')
    Dw = bone_delta(rig, 'wing.' + s)
    D = Db.inverted() @ Dw
    piv, ax = pv3.wing_frame(s)
    q = D.to_quaternion()
    axis = Vector(ax[0]).normalized()
    proj = Vector((q.x, q.y, q.z)).dot(axis)
    twist = abs(math.degrees(2 * math.atan2(proj, q.w)))
    twist = min(twist, 360 - twist)
    tip = Vector(piv + ax[0] * (pv3.WING_C + pv3.WING_AU))
    fwd = -((D @ tip) - tip).y               # -Y is the front
    return twist, fwd


_CREATED = []


def clips(model, with_props=True):
    """[(name, length, fn, props)] for every clip, seated alone and at the desk, the max raise."""
    out = [(n, length, fn, ()) for n, (length, fn) in pv3.CLIPS.items()]
    out.append(('seated', 1, lambda r, f, rs: pv3.pose_seated(r, 0, rs, (0.0, 0.0, 0.0)), ()))
    if with_props:
        import kit
        col = bpy.data.collections.get('kit') or bpy.data.collections.new('kit')
        if col.name not in bpy.context.scene.collection.children:
            bpy.context.scene.collection.children.link(col)
        before = set(bpy.data.objects)
        kit.desk_set(col)
        _CREATED[:] = [o for o in bpy.data.objects if o not in before]
        # the penguin sits at desk-local (0, +0.27, 0.42) (contract section 2), the desk at the origin
        props = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
        out.append(('seated-desk', 1, lambda r, f, rs: pv3.pose_seated(r, 0, rs, (0.0, 0.27, pv3.SEAT_Z)),
                    tuple(props)))
    mx = getattr(pv3, 'WING_RAISE_MAX', 128)
    tw = -getattr(pv3, 'WING_TWIST_MAX', 78)

    def raise_max(r, f, rs):
        pv3.reset_pose(r)
        pv3._set(r, rs, 'wing.L', pv3._wing_raise('L', mx, tw))
        pv3._set(r, rs, 'wing.R', pv3._wing_raise('R', mx, tw))
    out.append(('raise-max', 1, raise_max, ()))
    return out


def clearance_report(model, with_props=True, step=1):
    rows = []
    for name, length, fn, props in clips(model, with_props):
        bvhs = None
        worst, at, what = float('inf'), 0, ''
        tw_max, fwd_max = 0.0, -1.0
        for f in range(0, length, step):
            set_pose(model, fn, f)
            if bvhs is None:
                bvhs = _props_bvh(props)
            c, w = clearance_frame(model, bvhs)
            if c < worst:
                worst, at, what = c, f, w
            for s in 'LR':
                t, fw = motion_frame(model, s)
                tw_max, fwd_max = max(tw_max, t), max(fwd_max, fw)
        rows.append({'clip': name, 'min_mm': worst * 1000, 'frame': at, 'nearest': what,
                     'twist_max_deg': tw_max, 'forward_max_mm': fwd_max * 1000})
        print(f'clearance {name}: {worst * 1000:.1f} mm (frame {at}, {what}); twist {tw_max:.1f} deg, '
              f'forward {fwd_max * 1000:.1f} mm')
    pv3.reset_pose(model.rig)
    for o in _CREATED:                       # the desk set was only for the check
        bpy.data.objects.remove(o, do_unlink=True)
    _CREATED.clear()
    return rows


def build_model():
    import lib
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = lib.collection('penguin_v3')
    mesh = pv3.build(col)
    rig = pv3.rig(col, mesh)
    return Model(mesh, rig)


def run(out_path, with_props):
    model = build_model()
    res = {'tris': int(model.mesh['tri_count']), 'poses': {}}
    for name, fn in pose_fns():
        set_pose(model, fn)
        P = posed_verts(model.mesh)
        res['poses'][name] = {**smooth_metrics(model, P), **band_metrics(model, P)}
        print(name, res['poses'][name])
    pv3.reset_pose(model.rig)
    res['hinge'] = hinge_metrics(model)
    print('hinge', res['hinge'])
    res['clearance'] = clearance_report(model, with_props)
    with open(out_path, 'w') as fh:
        json.dump(res, fh, indent=1)
    print('wrote', out_path)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    a = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d  # noqa: E731
    setup(os.path.abspath(a('--scripts', os.path.dirname(os.path.abspath(__file__)))))
    run(a('--out', 'metrics.json'), '--props' in argv)
