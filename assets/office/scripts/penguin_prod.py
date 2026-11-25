"""The production penguin (contract §5, penguin.glb) from the confirmed v3 design.

The confirmed design is round 12 of `penguin_v3.py` (identity/_drafts/penguin-v3/r12): a signed-
distance plush with a sewn-on rigid wing on a hinge and a 12 mm smooth-union fillet between the
body and the wing, re-shaped per hinge angle. That model is ~120k triangles with procedural
seams; this script turns it into the web asset (≤ 8k triangles) and keeps what reads at web size:

* **Same surfaces, fewer triangles.** The skin and the wing pieces are meshed by the draft's own
  surface nets, decimated (symmetric quadric collapse) and every vertex is pulled back onto the
  exact signed-distance surface, with the exact surface normal as its shading normal. So the
  silhouette is the draft's, not an approximation of it.
* **Colour regions are cut into the mesh.** The draft colours the skin per pixel from fields (the
  white front, the white wing underside, the black feet). Here the mesh is refined along those
  fields' zero lines and cut exactly on them, so each region is its own material (`penguin.body`,
  `penguin.face`, `penguin.feet`) with a clean edge — the web still paints `penguin.body` per
  theme by name.
* **Seam detail is baked.** The seam groove, the thread dashes (front, wing, eyes, cheeks, beak)
  and the beak's centre line are baked from the draft's own shader fields into one 1024 px texture
  (`penguin_detail`: a multiplier on the black skin, absolute colour elsewhere) and a 1024 px
  tangent-space normal map (`penguin_relief`). The beak's black piping is geometry (`penguin.stitch`).
* **The joint fillet survives as morph targets.** `penguin.joint.L/R` is the draft's fillet mesh
  at a lower resolution, with one shape key per (raise, twist) grid point (raise -8..120 step 8,
  twist -15/0/15), skinned to the body bone. The web sets the morph weights from the wing bone
  each frame (web/src/office/joint.ts — the same bilinear rule as `penguin_v3.update_welt`).
  Extras on the joint node carry the grid and the hinge frame. So that the joint reads as ONE
  shape on the web (2026-11-25 — the r8 / r11 / r12 complaints: jagged white, a lip, a ring):
  its edge rows are snapped onto the web skin and the web wing; its normals are the exact surface
  normals in every shape key (patched into the GLB, web/scripts/patch-penguin-joints.mjs), so no
  shading ring where it meets the body; its white is the draft's per-pixel rule — the rows next to
  the wing (attribute `_joint_white`) AND inside the wing's white face in the posed wing's frame,
  tested in the shader from the wing bone (attribute `_joint_side`, extras `joint_pivot` ·
  `joint_eu` · `joint_ev` · `joint_ew` · `joint_rim` · `joint_arc` · `joint_taper` · `joint_corner`:
  penguin_v3.wing_under_piece and round 13's rounded root corners) — so it continues the wing's own white edge in every pose; its loop
  angles are snapped onto that edge. Material `penguin.body#joint` (painted as `penguin.body`).
* **Rig and clips** follow the contract: bones root · body · head · wing.L/R · leg.L/R ·
  foot.L/R + sockets; the wing is a hinge (raise ≤ 112°, lowered ≤ 8°, twist ±15°, Limit Rotation
  is enforced by `_wing_raise`); seated state clips (body bottom on the origin = the chair seat)
  plus standing extras (stand · walk · hop · wave). The rest pose stands on the origin.

Blender axes as in penguin_v3: X = the penguin's left, -Y = front, Z = up.
"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import lib
import penguin_v3 as pv3

# ---------------------------------------------------------------------------
# Budget (contract §8: penguin 8k triangles)
# ---------------------------------------------------------------------------
SKIN_TRIS = 1600          # decimation target for the body skin before the colour cuts
WING_TRIS = 260           # ... per wing piece
REFINE_PASSES = 1         # subdivisions of the triangles that straddle a colour edge
REFINE_BAND = 0.0         # ... a triangle is refined when |field| < this x its longest edge (0 = only where it crosses)
JOINT_N, JOINT_M = 64, 9  # fillet resolution: points round the wing x rows across (draft 160 x 21)
TEX = 1024                # baked texture size (contract: <= 1024 px)
UV_SCALE = 0.94           # the islands live in u < 0.94; the strip beyond holds the plain patches
PATCH_BODY = (0.97, 0.03)   # uv of a plain texel: multiplier 1, flat normal
PATCH_FACE = (0.97, 0.10)   # uv of a plain white texel
Z0 = pv3.Z0

MAT_KEYS = ['penguin.body', 'penguin.face', 'penguin.feet', 'penguin.eye', 'penguin.cheek',
            'penguin.beak', 'penguin.stitch']

# Hinge limits — the web reads the same numbers (web/src/office/contract.ts WING_LIMITS)
RAISE_MAX = pv3.WING_RAISE_MAX     # 112
LOWER_MAX = pv3.WING_LOWER_MAX     # 8
TWIST_MAX = pv3.WING_TWIST_MAX     # 15


# ---------------------------------------------------------------------------
# Fields
# ---------------------------------------------------------------------------
_OUTLINE = None


def _cached_outline():
    global _OUTLINE
    if _OUTLINE is None:
        _OUTLINE = _orig_outline()
    return _OUTLINE


_orig_outline = pv3.front_outline
pv3.front_outline = _cached_outline


def skin_fields(P):
    """(seam_d, feet) at points on the skin: > 0 = inside the white front / the leg-foot region."""
    P = pv3._project(pv3.f_all, np.asarray(P, float), iters=3)
    attrs, _ = pv3.body_attributes(P, None)
    return attrs['seam_d'], attrs['feet']


def skin_class(d, feet):
    """0 body (black), 1 white front, 2 feet."""
    return np.where(feet > 0, 2, np.where(d > 0, 1, 0))


# ---------------------------------------------------------------------------
# Mesh helpers
# ---------------------------------------------------------------------------

def _obj_from(V, F, name, col):
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.asarray(V).tolist(), [], [tuple(int(i) for i in f) for f in F])
    me.update()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def _arrays(ob):
    me = ob.data
    V = np.array([v.co[:] for v in me.vertices])
    F = [tuple(p.vertices) for p in me.polygons]
    return V, F


def decimate(V, F, target, name, col, weight=None):
    """Quadric collapse to ~target triangles; `weight` (per vertex, 0 = keep, 1 = free) protects a region."""
    ob = _obj_from(V, F, name, col)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    n = len(ob.data.polygons)
    mod = ob.modifiers.new('dec', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = min(1.0, target / n)
    mod.use_symmetry = weight is None
    mod.symmetry_axis = 'X'
    if weight is not None:
        vg = ob.vertex_groups.new(name='free')
        for i, w in enumerate(weight):
            vg.add([i], float(w), 'REPLACE')
        mod.vertex_group = 'free'
        mod.vertex_group_factor = 1.0
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me2 = bpy.data.meshes.new_from_object(ev)
    V2 = np.array([v.co[:] for v in me2.vertices])
    F2 = [tuple(p.vertices) for p in me2.polygons]
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me2)
    return V2, F2


def refine_and_cut(V, F, field_fn, project_fn, n_fields):
    """Refine triangles near the zero lines of `field_fn` (returns a tuple of arrays) and cut the
    mesh exactly on them. Returns V, triangles, per-vertex field values."""
    bm = bmesh.new()
    for p in V:
        bm.verts.new(p)
    bm.verts.ensure_lookup_table()
    for f in F:
        try:
            bm.faces.new([bm.verts[i] for i in f])
        except ValueError:
            pass
    bmesh.ops.triangulate(bm, faces=bm.faces[:])

    def values():
        bm.verts.ensure_lookup_table()
        P = np.array([v.co[:] for v in bm.verts])
        return P, np.stack(field_fn(P), 1)

    for _ in range(REFINE_PASSES):
        P, val = values()
        idx = {v: i for i, v in enumerate(bm.verts)}
        edges = set()
        for f in bm.faces:
            ids = [idx[v] for v in f.verts]
            L = max((Vector(bm.verts[a].co) - Vector(bm.verts[b].co)).length
                    for a, b in zip(ids, ids[1:] + ids[:1]))
            for k in range(n_fields):
                vk = val[ids, k]
                if (vk.min() < 0 < vk.max()) or np.abs(vk).min() < REFINE_BAND * L:
                    edges.update(f.edges)
                    break
        if not edges:
            break
        res = bmesh.ops.subdivide_edges(bm, edges=list(edges), cuts=1, use_grid_fill=False,
                                        use_only_quads=False)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        new = [e for e in res['geom_inner'] if isinstance(e, bmesh.types.BMVert)]
        if new:
            Q = project_fn(np.array([v.co[:] for v in new]))
            for v, q in zip(new, Q):
                v.co = q
    # cut on each field's zero line
    for k in range(n_fields):
        P, val = values()
        idx = {v: i for i, v in enumerate(bm.verts)}
        d = val[:, k]
        eps = 1e-7
        cross = [e for e in bm.edges
                 if (d[idx[e.verts[0]]] < -eps and d[idx[e.verts[1]]] > eps) or
                 (d[idx[e.verts[0]]] > eps and d[idx[e.verts[1]]] < -eps)]
        if not cross:
            continue
        A = np.array([e.verts[0].co[:] for e in cross])
        B = np.array([e.verts[1].co[:] for e in cross])
        da = np.array([d[idx[e.verts[0]]] for e in cross])
        lo = np.zeros(len(cross))
        hi = np.ones(len(cross))
        neg_a = da < 0
        for _ in range(14):           # bisection along the edge, on the exact surface
            mid = 0.5 * (lo + hi)
            Pm = project_fn(A + (B - A) * mid[:, None])
            vm = field_fn(Pm)[k]
            same = (vm < 0) == neg_a
            lo = np.where(same, mid, lo)
            hi = np.where(same, hi, mid)
        t = 0.5 * (lo + hi)
        Pt = project_fn(A + (B - A) * t[:, None])
        zero = set()
        for e, tt, pt in zip(cross, t, Pt):
            v0 = e.verts[0]
            _, nv = bmesh.utils.edge_split(e, v0, float(tt))
            nv.co = pt
            zero.add(nv)
        for f in list(bm.faces):
            zs = [v for v in f.verts if v in zero]
            if len(zs) == 2:
                a, b = zs
                if b not in [e.other_vert(a) for e in a.link_edges if e in f.edges]:
                    bmesh.ops.connect_verts(bm, verts=[a, b])
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
    P, val = values()
    idx = {v: i for i, v in enumerate(bm.verts)}
    T = [[idx[v] for v in f.verts] for f in bm.faces]
    bm.free()
    return P, np.array(T), val


def face_class(T, val, classify):
    """Class of each triangle from its vertices' field values (cut vertices are exactly 0)."""
    c = []
    for t in T:
        v = val[t]
        # the vertex furthest from any zero line decides
        k = np.argmax(np.abs(v).min(1))
        c.append(int(classify(*v[k])))
    return np.array(c)


# ---------------------------------------------------------------------------
# Parts
# ---------------------------------------------------------------------------

def hires_skin():
    V, Fq = pv3.surface_nets(pv3.f_all, pv3.LO, pv3.HI, pv3.GRID)
    V = pv3._project(pv3.f_all, V, iters=5)
    Fq = pv3._orient_faces(V, Fq, pv3.f_all)
    V = pv3._relax(V, Fq, pv3.f_all, iters=2)
    return V, Fq


def low_skin(col):
    V, Fq = hires_skin()
    edges = pv3._neighbours(len(V), Fq)
    attrs, fl = pv3.body_attributes(V, Fq)
    weights = pv3.body_weights(V, fl, edges)
    Vd, Fd = decimate(V, Fq, SKIN_TRIS, 'skin_dec', col)
    proj = lambda P: pv3._project(pv3.f_all, P, iters=4)   # noqa: E731
    Vd = proj(Vd)
    P, T, val = refine_and_cut(Vd, Fd, skin_fields, proj, 2)
    cls = face_class(T, val, lambda d, ft: 2 if ft > 0 else (1 if d > 0 else 0))
    # bone weights: barycentric from the high-res skin (the draft's own weights)
    W = transfer_weights(V, Fq, weights, P)
    N = pv3._grad(pv3.f_all, P)
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    return P, T, cls, W, N


def transfer_weights(V, Fq, weights, P):
    tris = np.concatenate([Fq[:, [0, 1, 2]], Fq[:, [0, 2, 3]]])
    bvh = BVHTree.FromPolygons([Vector(v) for v in V], tris.tolist())
    keys = list(weights)
    Wsrc = np.stack([weights[k] for k in keys], 1)
    out = np.zeros((len(P), len(keys)))
    for i, p in enumerate(P):
        loc, _, fi, _ = bvh.find_nearest(Vector(p))
        a, b, c = (V[j] for j in tris[fi])
        bc = _bary(np.array(loc), a, b, c)
        out[i] = bc @ Wsrc[tris[fi]]
    out = np.clip(out, 0, None)
    out /= np.maximum(out.sum(1, keepdims=True), 1e-9)
    return {k: out[:, j] for j, k in enumerate(keys)}


def _bary(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
    d20, d21 = v2 @ v0, v2 @ v1
    den = max(d00 * d11 - d01 * d01, 1e-18)
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    bc = np.clip(np.array([1 - v - w, v, w]), 0, None)
    return bc / max(bc.sum(), 1e-9)


def low_wing(col, side):
    piv, ax = pv3.wing_frame(side)
    fn = lambda P: pv3.f_wing(P, side)   # noqa: E731
    reach = pv3.WING_C + pv3.WING_AU + 0.03
    V, Fq = pv3.surface_nets(fn, tuple(piv - reach), tuple(piv + reach), pv3.PIECE_GRID)
    V = pv3._project(fn, V, iters=5)
    Fq = pv3._orient_faces(V, Fq, fn)
    V = pv3._relax(V, Fq, fn, iters=2)
    # the root, where the fillet lands on the wing, keeps the draft's density: a coarse paddle there
    # sank below the fillet's wing edge and the fillet showed through as a sawtooth (2026-11-25)
    Vd, Fd = decimate(V, Fq, WING_TRIS, 'wing_dec', col)
    proj = lambda P: pv3._project(fn, P, iters=4, max_step=0.004)   # noqa: E731
    Vd = proj(Vd)
    P, T, val = refine_and_cut(Vd, Fd, lambda P_: (pv3.wing_under_piece(P_, side),), proj, 1)
    cls = face_class(T, val, lambda d: 1 if d > 0 else 0)
    N = pv3._grad(fn, P)
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    return P, T, cls, N


def low_appliques():
    """Eyes, cheeks and the beak at web resolution: (key, V, faces, face material keys)."""
    out = []
    eye_d = np.array([0.0, 0.0018, 0.0070, 0.020, 0.040])
    cheek_d = np.array([0.0, 0.0018, 0.0080, 0.024])
    for s in (-1, 1):
        ex = s * pv3.EYE_X
        cx, cz = ex + s * pv3.CHEEK_DX, pv3.EYE_Z + pv3.CHEEK_DZ
        V, F, _ = pv3.applique(lambda d, cx=cx, cz=cz: pv3._circle_ring(cx, cz, pv3.CHEEK_R - d, 28),
                               cheek_d, 0.0028, 0.004, 0.0046, pv3.PERIOD_EYE)
        out.append(('cheek', V, F, ['penguin.cheek'] * len(F)))
        V, F, _ = pv3.applique(lambda d, ex=ex: pv3._circle_ring(ex, pv3.EYE_Z, pv3.EYE_R - d, 28),
                               eye_d, 0.0055, 0.0055, 0.0050, pv3.PERIOD_EYE, lift=0.0016)
        out.append(('eye', V, F, ['penguin.eye'] * len(F)))
    _, rin = pv3._kite_ring(0.0)
    ds = np.array([0.0, 0.0026, 0.0060, 0.5 * rin, 0.97 * rin])
    ring = lambda d: pv3._kite_ring(d, n_arc=3, n_edge=6)[0]   # noqa: E731
    V, F, _ = pv3.applique(ring, ds, 0.006, 0.006, 0.0058, pv3.PERIOD_BEAK,
                           pyramid=(pv3.BEAK_PEAK, rin), split=(pv3.BEAK_Z, pv3.BEAK_STEP))
    n = len(ring(0.0))
    # rows: skirt -> d0 (side wall) and d0 -> 2.6 mm = the black piping (draft: piping 0.0026)
    mk = ['penguin.stitch' if i < 2 * n else 'penguin.beak' for i in range(len(F))]
    out.append(('beak', V, F, mk))
    return out


# ---------------------------------------------------------------------------
# Materials (glTF: matte, metallic 0; the detail texture + relief normal map on all of them)
# ---------------------------------------------------------------------------

def gltf_material(key, color, img_detail=None, img_relief=None):
    m = lib.material(key, color, roughness=0.85)
    bsdf = lib.principled(m)
    nt = m.node_tree
    if img_detail is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img_detail
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if img_relief is not None:
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = img_relief
        tn.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.strength = 1.0
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return m


# ---------------------------------------------------------------------------
# Build the low mesh
# ---------------------------------------------------------------------------

def build_low(col, name='penguin'):
    """The skinned mesh `penguin` (skin + wing pieces + appliques), weights and custom normals."""
    P, T, cls, W, N = low_skin(col)
    parts = [(P, T, np.array(['penguin.body', 'penguin.face', 'penguin.feet'])[cls], N)]
    groups = {k: [v] for k, v in W.items()}
    wing_tris = 0
    for side in 'LR':
        Pw, Tw, cw, Nw = low_wing(col, side)
        parts.append((Pw, Tw, np.array(['penguin.body', 'penguin.face'])[cw], Nw))
        wing_tris += len(Tw)
        for k in groups:
            groups[k].append(np.full(len(Pw), 1.0 if k == 'wing.' + side else 0.0))
    app_tris = 0
    for key, Va, Fa, mk in low_appliques():
        Na = pv3._grad(pv3.f_body, Va)
        Na /= np.linalg.norm(Na, axis=1, keepdims=True)
        parts.append((Va, Fa, np.array(mk), None))
        app_tris += sum(len(f) - 2 for f in Fa)
        hp = pv3._smoothstep(pv3.NECK_Z - 0.06, pv3.NECK_Z + 0.06, Va[:, 2])
        for k in groups:
            groups[k].append(hp if k == 'head' else (1 - hp) if k == 'body' else np.zeros(len(Va)))
    Vall, Fall, Mall, normals = [], [], [], []
    off = 0
    for Pp, Tp, mk, Np in parts:
        Vall.append(Pp)
        Fall += [tuple(int(i) + off for i in f) for f in Tp]
        Mall += list(mk)
        normals.append(Np)
        off += len(Pp)
    V = np.concatenate(Vall)
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], Fall)
    me.update()
    for k in MAT_KEYS:
        me.materials.append(bpy.data.materials[k])
    me.polygons.foreach_set('material_index', np.array([MAT_KEYS.index(m) for m in Mall], np.int32))
    me.shade_smooth()
    # custom normals: the exact surface normal (skin / wings); appliques keep their own smooth ones
    loop_n = []
    vn_exact = np.full((len(V), 3), np.nan)
    o = 0
    for (Pp, _, _, Np) in parts:
        if Np is not None:
            vn_exact[o:o + len(Pp)] = Np
        o += len(Pp)
    auto = np.array([v.normal[:] for v in me.vertices])
    vn = np.where(np.isnan(vn_exact), auto, vn_exact)
    for lp in me.loops:
        loop_n.append(vn[lp.vertex_index])
    me.normals_split_custom_set(loop_n)
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    for gname, arrs in groups.items():
        w = np.concatenate(arrs)
        vg = ob.vertex_groups.new(name=gname)
        for i in np.nonzero(w > 1e-3)[0]:
            vg.add([int(i)], float(w[i]), 'REPLACE')
    ob['tri_skin'] = int(len(T))
    ob['tri_wings'] = int(wing_tris)
    ob['tri_appliques'] = int(app_tris)
    return ob


_ORIG_ROOT_LOOP = pv3.wing_root_loop
JOINT_CUT = 0.0           # where the fillet's white rows start: -1 body edge, 0 midline, 1 wing edge
JOINT_MATERIAL = 'penguin.body#joint'
JOINT_NORMALS = {}        # joint object name -> {'pos': basis positions, 'keys': {key name: normals}}
JOINT_ROOT_U = 0.03       # where along the wing (from the hinge) the fillet meets it


def _exact_normals(ob, side):
    """The fillet's exact surface normal at every vertex of every shape key: the gradient of the
    smooth union smin(body, posed wing, WELT_K) it lies on (its edge rows get the body's / the
    wing's own normal). Blender's exporter would give face-averaged normals from 9 rows across - a
    visible ring where the fillet meets the body, whose normals are exact too. Patched into the GLB
    by web/scripts/patch-penguin-joints.mjs."""
    out = {}
    kk = pv3.WELT_K
    for kb in ob.data.shape_keys.key_blocks:
        rd, tw = (0, 0) if kb.name == 'Basis' else (int(x) for x in kb.name.split('.')[1:3])
        Mi = np.linalg.inv(np.array(pv3._wing_raise(side, rd, tw)))
        fw = lambda X: pv3.f_wing(X @ Mi[:3, :3].T + Mi[:3, 3], side)   # noqa: E731
        F = lambda X: pv3._smin(pv3.f_body(X), fw(X), kk)   # noqa: E731
        P = np.array([v.co[:] for v in kb.data])
        g = pv3._grad(F, P, eps=2e-4)
        g /= np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
        out[kb.name] = g
    return {'pos': np.array([v.co[:] for v in ob.data.shape_keys.key_blocks['Basis'].data]), 'keys': out}


def _white_arc(side, u=JOINT_ROOT_U, n=720):
    """The two angles round the wing's cross-section (wing-local (v, w) plane, as wing_root_loop
    samples it) where its white inner face starts and ends: -w - WING_RIM = 0."""
    piv, ax = pv3.wing_frame(side)
    phi = np.linspace(0, 2 * math.pi, n, endpoint=False)
    dirs = np.stack([np.zeros(n), np.cos(phi), np.sin(phi)], 1)
    base = np.stack([np.full(n, u), np.zeros(n), np.zeros(n)], 1)
    rr = pv3._bisect(lambda r: pv3.f_wing(piv + (base + dirs * r[:, None]) @ ax, side), np.zeros(n), np.full(n, 0.15))
    inside = -(rr * np.sin(phi)) - pv3.WING_RIM > 0
    out = []
    for i in range(n):
        if inside[i] != inside[i - 1]:
            out.append(phi[i])
    return out


def _wing_root_loop_at(phi):
    """penguin_v3.wing_root_loop with the loop angles given (same body as the draft's)."""
    def loop(side, raise_deg, twist_deg, n=None):
        n = len(phi)
        piv, ax = pv3.wing_frame(side)
        M = np.array(pv3._wing_raise(side, raise_deg, twist_deg))
        R, t = M[:3, :3], M[:3, 3]
        dirs = np.stack([np.zeros(n), np.cos(phi), np.sin(phi)], 1)

        def surf(u):
            base = np.stack([u, np.zeros(n), np.zeros(n)], 1)
            rr = pv3._bisect(lambda r: pv3.f_wing(piv + (base + dirs * r[:, None]) @ ax, side),
                             np.zeros(n), np.full(n, 0.15))
            return piv + (base + dirs * rr[:, None]) @ ax

        def fb_at(u):
            return pv3.f_body(surf(u) @ R.T + t)
        us = np.linspace(-0.05, 0.24, 59)
        vals = np.stack([fb_at(np.full(n, u)) for u in us], 1)
        exits = (vals > 0).any(1)
        pv3.WELT_STATS['buried'] = int((~exits).sum())
        k = np.clip(np.argmax(vals > 0, axis=1), 1, len(us) - 1)
        u_star = pv3._bisect(lambda u: fb_at(u), us[k - 1].copy(), us[k].copy(), it=24)
        Jr = surf(u_star)
        J = Jr @ R.T + t
        nb = pv3._grad(pv3.f_body, J)
        nb /= np.linalg.norm(nb, axis=1, keepdims=True)
        nw = pv3._grad(lambda X: pv3.f_wing(X, side), Jr) @ R.T
        nw /= np.linalg.norm(nw, axis=1, keepdims=True)
        J[~exits] = (surf(np.full(n, -0.02)) @ R.T + t)[~exits]
        nb[~exits] = nw[~exits]
        pv3.WELT_STATS['exits'] = exits
        return J, nb, nw, phi
    return loop


def _white_edges_at_crease(side, dense=720):
    """The loop angles where the wing's white face starts / ends along the line the wing enters the
    body (rest pose) - where the fillet's white must end to continue the wing's own white edge."""
    phi = np.linspace(0, 2 * math.pi, dense, endpoint=False)
    J, _, _, _ = _wing_root_loop_at(phi)(side, 0, 0)
    exits = pv3.WELT_STATS['exits']
    d = pv3.wing_under_piece(J, side)
    d[~exits] = -1.0
    out = []
    for i in range(1, dense):
        a, b = d[i - 1], d[i]
        if (a > 0) != (b > 0):
            t = a / (a - b)
            out.append(phi[i - 1] + t * (phi[i] - phi[i - 1]))
    return out or _white_arc(side)


def _joint_phis(side, n=None):
    """n loop angles, uniform except the ones nearest the white face's edges snapped onto them, so
    the fillet's columns meet the wing's white edge exactly."""
    n = n or JOINT_N
    phi = np.linspace(0, 2 * math.pi, n, endpoint=False)
    for p in _white_edges_at_crease(side):
        d = np.abs(((phi - p) + math.pi) % (2 * math.pi) - math.pi)
        phi[np.argmin(d)] = p
    return np.sort(phi)


def _part_bvh(mesh_ob, side=None):
    """BVH of the web mesh's skin (side None) or of one wing piece, at rest."""
    me = mesh_ob.data
    gi = {g.name: g.index for g in mesh_ob.vertex_groups}
    wing = np.zeros((len(me.vertices), 2))
    for v in me.vertices:
        for g in v.groups:
            if g.group == gi.get('wing.L'):
                wing[v.index, 0] = g.weight
            elif g.group == gi.get('wing.R'):
                wing[v.index, 1] = g.weight
    col = None if side is None else (0 if side == 'L' else 1)
    skin_keys = {MAT_KEYS.index(k) for k in ('penguin.body', 'penguin.face', 'penguin.feet')}
    polys = []
    for p in me.polygons:
        vs = list(p.vertices)
        if col is None:
            if p.material_index in skin_keys and wing[vs].max() < 0.99:
                polys.append(vs)
        elif wing[vs, col].min() > 0.99:
            polys.append(vs)
    return BVHTree.FromPolygons([v.co.copy() for v in me.vertices], polys)


def _snap_edges(ob, side, n, m, mesh_ob):
    """Put the fillet's two edge rows exactly on the web meshes it leaves: row 0 on the low-poly
    skin, the last row on the low-poly wing (in the wing's own frame, every shape key). The draft's
    fillet ends on the exact surfaces; the web meshes are chords of them, so the edge either
    floated (a dark ring) or the near-tangent fillet showed through the coarse wing (a sawtooth
    white edge, 2026-11-25)."""
    skin = _part_bvh(mesh_ob)
    wing = _part_bvh(mesh_ob, side)
    for kb in ob.data.shape_keys.key_blocks:
        rd, tw = (0, 0) if kb.name == 'Basis' else (int(x) for x in kb.name.split('.')[1:3])
        M = np.array(pv3._wing_raise(side, rd, tw))
        Mi = np.linalg.inv(M)
        P = np.array([v.co[:] for v in kb.data]).reshape(n, m, 3)
        for i in range(n):
            hit = skin.find_nearest(Vector(P[i, 0]))
            if hit[0] is not None:
                P[i, 0] = hit[0][:]
            r = Mi[:3, :3] @ P[i, m - 1] + Mi[:3, 3]
            hit = wing.find_nearest(Vector(r))
            if hit[0] is not None:
                P[i, m - 1] = M[:3, :3] @ np.array(hit[0][:]) + M[:3, 3]
        kb.data.foreach_set('co', P.reshape(-1).astype(np.float32))
    ob.data.vertices.foreach_set('co', np.array([v.co[:] for v in ob.data.shape_keys.key_blocks['Basis'].data],
                                                np.float32).reshape(-1))


def build_joints(col, mesh_ob):
    """`penguin.joint.L/R`: the draft's fillet at web resolution, shape keys over raise x twist."""
    keep = (pv3.WELT_N, pv3.WELT_M)
    pv3.WELT_N, pv3.WELT_M = JOINT_N, JOINT_M
    out = []
    try:
        for side in 'LR':
            phis = _joint_phis(side)
            pv3.wing_root_loop = _wing_root_loop_at(phis)
            ob = pv3.build_welt(col, side, bpy.data.materials['penguin.body'], f'penguin.joint.{side}')
            ob['welt_of'] = mesh_ob.name
            me = ob.data
            me.materials.append(bpy.data.materials['penguin.face'])
            m = ob['welt_m']
            n = len(me.vertices) // m
            _snap_edges(ob, side, n, m, mesh_ob)
            # outward winding by a vote over every loop point that comes out of the body (the build
            # script checks one point only; at this resolution it can be a buried one -> the web,
            # which culls back faces, drew the far side of the fillet)
            J0, nb0, nw0, _ = pv3.wing_root_loop(side, 0, 0)
            exits = pv3.WELT_STATS['exits']
            fn = np.array([p.normal[:] for p in me.polygons]).reshape(n, m - 1, 3).mean(1)
            vote = ((fn * (nb0 + nw0)).sum(1))[exits]
            if (vote < 0).sum() > (vote > 0).sum():
                me.flip_normals()
                me.update()
            # the white of the fillet = the draft's own rule, per pixel (penguin_v3 round 12): the rows
            # next to the wing AND inside the wing's white face. A per-vertex field `_joint_white`
            # (> 0 = white) = min(row term, the wing's white field at that loop angle); the web
            # thresholds its interpolation per pixel (office/joint.ts). The loop angles are snapped
            # onto the white face's edges, so the fillet's white ends exactly where the wing's does,
            # and where the fillet lies tangent over the wing the two are the same colour - no
            # sawtooth (per-face colours did that, 2026-11-25).
            # the wing's white field where each column lands on the wing (the fillet's wing edge, rest
            # pose - the cross-section turns with the wing, so it holds in every pose) ...
            Jc, _, _, _ = pv3.wing_root_loop(side, 0, 0)          # the crease line, rest (the loop's angles)
            wterm = pv3.wing_under_piece(Jc, side)
            wterm[np.abs(wterm) < 2e-4] = 0.0                     # the snapped columns sit on the edge
            wterm[~pv3.WELT_STATS['exits']] = -1.0
            # ... and the rows: a signed distance (m, along each profile, rest pose) from the cut where
            # the draft's white rows start (penguin_v3 round 13: WELT_WHITE_ROWS of WELT_M_R13 rows,
            # the same place along the profile at this resolution), so the shader can round the
            # white's corners where that cut meets the rim (smin, WELT_CORNER)
            P_ = np.array([v.co[:] for v in me.vertices]).reshape(n, m, 3)
            cum = np.concatenate([np.zeros((n, 1)), np.cumsum(np.linalg.norm(np.diff(P_, axis=1), axis=2), axis=1)], 1)
            # the cut sits at the fillet's midline (the crease bisector): at web resolution the fillet's
            # wing half lies near-tangent over the coarse wing, so a cut further out left black fillet
            # rows interleaving with the wing's white (a sawtooth); from the midline the fillet's white
            # covers that overlap and its rounded corners are the white's end
            cut = (m - 1) / 2 + JOINT_CUT * (m - 1) / 2
            i0 = min(int(np.floor(cut)), m - 2)
            s_cut = cum[:, i0] + (cut - i0) * (cum[:, i0 + 1] - cum[:, i0])
            field = cum - s_cut[:, None]
            # columns buried in the body (no profile) take their nearest live neighbour's rows, so the
            # field runs on smoothly round the loop (a -0.02 there stepped the white's end per column)
            live = np.nonzero(cum[:, -1] > 1e-6)[0]
            for i in np.nonzero(cum[:, -1] <= 1e-6)[0]:
                k = live[np.argmin(np.minimum(np.abs(live - i), n - np.abs(live - i)))]
                field[i] = field[k]
            sd = me.attributes.get('_joint_side') or me.attributes.new('_joint_side', 'FLOAT', 'POINT')
            sd.data.foreach_set('value', np.full(n * m, 1.0 if side == 'L' else -1.0, np.float32))
            _ = wterm
            at = me.attributes.get('_joint_white') or me.attributes.new('_joint_white', 'FLOAT', 'POINT')
            at.data.foreach_set('value', field.ravel().astype(np.float32))
            me.polygons.foreach_set('material_index', np.zeros(len(me.polygons), np.int32))
            # uv: plain patches (no seam detail on the fillet)
            uv = me.uv_layers.new(name='UVMap')
            for p in me.polygons:
                patch = PATCH_FACE if p.material_index == 1 else PATCH_BODY
                for li in p.loop_indices:
                    uv.data[li].uv = patch
            JOINT_NORMALS[ob.name] = _exact_normals(ob, side)
            ob['joint_side'] = side
            ob['joint_raise'] = list(pv3.WELT_RAISE)
            ob['joint_twist'] = list(pv3.WELT_TWIST)
            _, ax = pv3.wing_frame(side)
            e0 = ax[0]
            ob['joint_e0'] = [float(e0[0]), float(e0[2]), float(-e0[1])]   # glTF axes
            piv_, ax2 = pv3.wing_frame(side)
            ob['joint_pivot'] = [float(piv_[0]), float(piv_[2]), float(-piv_[1])]
            ob['joint_ew'] = [float(ax2[2][0]), float(ax2[2][2]), float(-ax2[2][1])]
            ob['joint_rim'] = float(pv3.WING_RIM)
            # the rest of the wing's white rule (penguin_v3.wing_under_piece, round 13): the root arc
            # (centre u, semi-axes) and the rounding radius where it meets the rim
            ob['joint_eu'] = [float(ax2[0][0]), float(ax2[0][2]), float(-ax2[0][1])]
            ob['joint_ev'] = [float(ax2[1][0]), float(ax2[1][2]), float(-ax2[1][1])]
            ob['joint_arc'] = [float(pv3.PIECE_CUT + pv3.ARM_AU), float(pv3.ARM_AU), float(pv3.ARM_AV),
                               float(pv3.WING_ROUND)]
            # round 13: the rim inset widens towards the root (penguin_v3.wing_rim), and the fillet's
            # white rounds its corners where its row cut meets the rim (WELT_CORNER)
            ob['joint_taper'] = [float(pv3.ROOT_TAPER), float(pv3.ROOT_U0), float(pv3.ROOT_U1)]
            ob['joint_corner'] = float(pv3.WELT_CORNER)
            out.append(ob)
    finally:
        pv3.WELT_N, pv3.WELT_M = keep
        pv3.wing_root_loop = _ORIG_ROOT_LOOP
    return out


def tri_count(obs):
    n = 0
    for ob in obs:
        n += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return n


# ---------------------------------------------------------------------------
# Bake: the draft's seam fields -> penguin_detail (colour) + penguin_relief (normal map)
# ---------------------------------------------------------------------------
BAKE_KINDS = {
    # material in penguin_v3 -> (kind, inset, groove, thread colour)
    'v3.leather': ('skin', -0.0058, 1.0, '#151410'),
    'v3.eye': ('eye', 0.0050, 1.0, '#45423B'),
    'v3.cheek': ('cheek', 0.0046, 0.35, '#A8127F'),
    'v3.beak': ('beak', 0.0058, 1.0, '#151410'),
}
BASE = {'eye': lib.PALETTE['penguin.eye'], 'cheek': lib.PALETTE['penguin.cheek'],
        'beak': lib.PALETTE['penguin.beak']}
THREAD_ON_BLACK = 0.62     # the black skin's thread, as a multiplier of the body colour
GROOVE_ON_BLACK = 0.80     # ... and the seam groove's shadow on the black side


def _rgb(h):
    return lib.hex_rgba(h)


def bake_material(name, kind, inset, groove, thread, mode):
    """mode 'color': emission = the texel of penguin_detail; mode 'normal': the draft's relief."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    T = pv3._NT(nt)
    out = T.node('ShaderNodeOutputMaterial')
    d = T.attr('seam_d')
    theta = T.math('ARCTAN2', T.attr('seam_sn'), T.attr('seam_c'))
    phase = T.math('FRACT', T.math('MULTIPLY', T.math('ADD', T.math('DIVIDE', theta, 2 * math.pi), 0.5),
                                   T.attr('seam_n')))
    a = T.math('DIVIDE', T.math('SUBTRACT', phase, 0.5), 0.31)
    b = T.math('DIVIDE', T.math('SUBTRACT', d, inset), 0.00125)
    r2 = T.math('ADD', T.math('MULTIPLY', a, a), T.math('MULTIPLY', b, b))
    stitch = T.math('MULTIPLY', T.math('LESS_THAN', r2, 1.0), T.math('GREATER_THAN', T.attr('stitch_on'), 0.5))
    if kind == 'skin':
        stitch = T.math('MULTIPLY', stitch, T.math('LESS_THAN', T.attr('feet'), 0.0))
    g = T.math('MULTIPLY', T.math('EXPONENT', T.math('MULTIPLY', T.math('POWER', T.math('DIVIDE', d, 0.0016), 2.0),
                                                     -1.0)), groove)
    if mode == 'normal':
        thread_h = T.math('MULTIPLY', T.math('MULTIPLY', T.math('SQRT', T.math('MAXIMUM', T.math('SUBTRACT', 1.0, r2),
                                                                                0.0)), 0.0006), stitch)
        pull = T.math('EXPONENT', T.math('MULTIPLY', T.math('MULTIPLY', b, b), -0.35))
        height = T.math('ADD', T.math('ADD', T.math('MULTIPLY', g, -0.0014), thread_h),
                        T.math('MULTIPLY', pull, -0.00018))
        bump = T.node('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 1.0
        bump.inputs['Distance'].default_value = 1.0
        T.link(height, bump.inputs['Height'])
        bsdf = T.node('ShaderNodeBsdfDiffuse')
        T.link(bump.outputs['Normal'], bsdf.inputs['Normal'])
        T.link(bsdf.outputs['BSDF'], out.inputs['Surface'])
        return mat
    if kind == 'skin':
        white = T.math('MULTIPLY', T.math('GREATER_THAN', d, 0.0), T.math('LESS_THAN', T.attr('feet'), 0.0))
        col = T.mix(white, (1.0, 1.0, 1.0, 1.0), _rgb(lib.PALETTE['penguin.face']))
        dark = T.mix(white, (GROOVE_ON_BLACK,) * 3 + (1.0,), _rgb('#1E1D19'))
        col = T.mix(T.math('MULTIPLY', g, 0.6), col, dark)
        thr = T.mix(white, (THREAD_ON_BLACK,) * 3 + (1.0,), _rgb(thread))
        col = T.mix(stitch, col, thr)
    else:
        col = T.mix(0.0, _rgb(BASE[kind]), _rgb(BASE[kind]))
        if kind == 'beak':
            col = T.mix(T.math('LESS_THAN', d, 0.0026), col, _rgb(lib.PALETTE['penguin.stitch']))
            line = T.math('LESS_THAN', T.math('ABSOLUTE', T.attr('line_d')), 0.0008)
            col = T.mix(line, col, _rgb(lib.PALETTE['penguin.stitch']))
        col = T.mix(T.math('MULTIPLY', g, 0.6), col, _rgb('#1E1D19'))
        col = T.mix(stitch, col, _rgb(thread))
    em = T.node('ShaderNodeEmission')
    T.link(col, em.inputs['Color'])
    T.link(em.outputs['Emission'], out.inputs['Surface'])
    return mat


def uv_unwrap(ob):
    me = ob.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name='UVMap')
    vl = bpy.context.view_layer
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    vl.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.006, scale_to_bounds=True)
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    for lp in me.uv_layers[0].data:
        lp.uv = (lp.uv[0] * UV_SCALE, lp.uv[1])


def _cycles(samples):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for dv in prefs.devices:
            dv.use = True
        sc.cycles.device = 'GPU'
    except Exception:
        pass
    sc.cycles.samples = samples


def _split(ob, keep, name):
    """A copy of mesh object `ob` with only the faces where keep(face, vertex-groups) is true."""
    me = ob.data.copy()
    cp = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(cp)
    cp.matrix_world = ob.matrix_world
    for g in ob.vertex_groups:
        cp.vertex_groups.new(name=g.name)
    wing_idx = {ob.vertex_groups[n].index for n in ('wing.L', 'wing.R') if n in ob.vertex_groups}
    is_wing = np.array([any(g.group in wing_idx and g.weight > 0.99 for g in v.groups) for v in me.vertices])
    bm = bmesh.new()
    bm.from_mesh(me)
    drop = [f for f in bm.faces if not keep(all(is_wing[v.index] for v in f.verts))]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.to_mesh(me)
    bm.free()
    return cp


def _raster_mask(ob):
    """Texels covered by `ob`'s UV triangles (TEX x TEX, rows = v from the bottom like Blender)."""
    mask = np.zeros((TEX, TEX), bool)
    uv = ob.data.uv_layers[0].data
    for p in ob.data.polygons:
        pts = np.array([uv[li].uv[:] for li in p.loop_indices]) * TEX
        for k in range(1, len(pts) - 1):
            tri = pts[[0, k, k + 1]]
            x0, y0 = np.floor(tri.min(0)).astype(int)
            x1, y1 = np.ceil(tri.max(0)).astype(int)
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, TEX - 1), min(y1, TEX - 1)
            if x1 < x0 or y1 < y0:
                continue
            X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            a_, b_, c_ = tri
            d = (b_[1] - c_[1]) * (a_[0] - c_[0]) + (c_[0] - b_[0]) * (a_[1] - c_[1])
            if abs(d) < 1e-12:
                continue
            l1 = ((b_[1] - c_[1]) * (X - c_[0]) + (c_[0] - b_[0]) * (Y - c_[1])) / d
            l2 = ((c_[1] - a_[1]) * (X - c_[0]) + (a_[0] - c_[0]) * (Y - c_[1])) / d
            inside = (l1 >= -0.02) & (l2 >= -0.02) & (1 - l1 - l2 >= -0.02)
            mask[y0:y1 + 1, x0:x1 + 1] |= inside
    return mask


def _dilate(m, n):
    out = m.copy()
    for _ in range(n):
        g = out.copy()
        g[1:] |= out[:-1]
        g[:-1] |= out[1:]
        g[:, 1:] |= out[:, :-1]
        g[:, :-1] |= out[:, 1:]
        out = g
    return out


def bake_textures(low, out_dir=None):
    """Bake the draft's seam detail onto `low` (UV'd). Returns (detail image, relief image).
    The skin (+ eyes, cheeks, beak) and the wing pieces are baked apart, each from its own high-res
    part: where a wing pierces the body, a ray from the skin would otherwise land on the wing (a
    light ring round the shoulder) and a ray from the wing on the skin (a white line at the root)."""
    hcol = lib.collection('penguin_hi')
    hi = pv3.build(hcol, name='penguin_v3_bake')
    for o in list(hcol.objects):
        if o is not hi:
            bpy.data.objects.remove(o, do_unlink=True)
    orig = [s.material for s in hi.material_slots]
    parts = [(_split(low, lambda w: not w, 'bake.low.skin'), _split(hi, lambda w: not w, 'bake.hi.skin')),
             (_split(low, lambda w: w, 'bake.low.wings'), _split(hi, lambda w: w, 'bake.hi.wings'))]
    wing_mask = _raster_mask(parts[1][0])
    skin_mask = _raster_mask(parts[0][0])
    wing_zone = _dilate(wing_mask, 10) & ~skin_mask
    imgs = {}
    for mode, colorspace in (('color', 'sRGB'), ('normal', 'Non-Color')):
        for i, m in enumerate(orig):
            kind, inset, groove, thread = BAKE_KINDS[m.name]
            bm_ = bake_material(f'bake.{m.name}.{mode}', kind, inset, groove, thread, mode)
            for _, h in parts:
                h.material_slots[i].material = bm_
        layers = []
        for lo, h in parts:
            img = bpy.data.images.new(f'bake.{lo.name}.{mode}', TEX, TEX, alpha=False)
            img.colorspace_settings.name = colorspace
            img.generated_color = (1, 1, 1, 1) if mode == 'color' else (0.5, 0.5, 1, 1)
            nodes = []
            for s in lo.material_slots:
                nt = s.material.node_tree
                n = nt.nodes.new('ShaderNodeTexImage')
                n.image = img
                nt.nodes.active = n
                nodes.append((nt, n))
            _cycles(4 if mode == 'color' else 8)
            sc = bpy.context.scene
            sc.render.bake.use_selected_to_active = True
            sc.render.bake.cage_extrusion = 0.004
            sc.render.bake.max_ray_distance = 0.012
            sc.render.bake.margin = 48
            for o in bpy.context.scene.objects:
                o.select_set(False)
            h.select_set(True)
            lo.select_set(True)
            bpy.context.view_layer.objects.active = lo
            if mode == 'color':
                bpy.ops.object.bake(type='EMIT')
            else:
                sc.render.bake.normal_space = 'TANGENT'
                bpy.ops.object.bake(type='NORMAL')
            for nt, n in nodes:
                nt.nodes.remove(n)
            layers.append(np.array(img.pixels[:]).reshape(TEX, TEX, 4))
            bpy.data.images.remove(img)
        px = np.where(wing_zone[..., None], layers[1], layers[0])
        out = bpy.data.images.new('penguin_detail' if mode == 'color' else 'penguin_relief', TEX, TEX, alpha=False)
        out.colorspace_settings.name = colorspace
        out.pixels[:] = px.ravel()
        _patches(out, mode)
        if out_dir:
            out.filepath_raw = os.path.join(out_dir, out.name + '.png')
            out.file_format = 'PNG'
            out.save()
        out.pack()
        imgs[mode] = out
    for o in [hi] + [x for pr in parts for x in pr]:
        me = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.meshes.remove(me)
    return imgs['color'], imgs['normal']


def _patches(img, mode):
    """The plain texels the joint fillet samples (u beyond UV_SCALE)."""
    px = np.array(img.pixels[:]).reshape(TEX, TEX, 4)
    u0 = int(UV_SCALE * TEX) + 4
    if mode == 'color':
        px[:, u0:, :3] = 1.0
        h = int(PATCH_FACE[1] * TEX)
        px[h - 24:h + 24, u0:, :3] = np.array(_rgb(lib.PALETTE['penguin.face'])[:3])
    else:
        px[:, u0:, :3] = (0.5, 0.5, 1.0)
    img.pixels[:] = px.ravel()
    img.update()


def wire_textures(detail, relief):
    """Every penguin material samples the detail and relief maps (the body's colour multiplies it)."""
    for k in MAT_KEYS:
        m = bpy.data.materials[k]
        nt = m.node_tree
        bsdf = lib.principled(m)
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = detail
        if k in ('penguin.body', 'penguin.feet'):
            # glTF: baseColorFactor x texture; the web repaints the body factor per theme
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            cols = [s for s in mix.inputs if s.type == 'RGBA']
            cols[1].default_value = bsdf.inputs['Base Color'].default_value[:]
            nt.links.new(tex.outputs['Color'], cols[0])
            nt.links.new([s for s in mix.outputs if s.type == 'RGBA'][0], bsdf.inputs['Base Color'])
        else:
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = relief
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])


# ---------------------------------------------------------------------------
# Pose composer + clips (contract §6). 30 fps, seamless loops (frame 0 = last frame).
# Every channel is a sum of whole-cycle sines, so a loop closes; moving points trace ellipses
# (two channels a quarter cycle apart) rather than back-and-forth lines, so no path reverses
# on itself (motion_path: no pops, no kinks).
# ---------------------------------------------------------------------------
FPS = 30
_R = lambda deg, axis: Matrix.Rotation(math.radians(deg), 4, axis)   # noqa: E731


def _leg_theta():
    hip, foot = np.array(pv3.HIP), np.array(pv3.FOOT_C)
    v = foot - hip
    L = math.hypot(v[1], v[2])
    want = Z0 - hip[2]
    return math.degrees(math.acos(min(1.0, -want / L)) - math.atan2(-v[1], -v[2]))


LEG_SEATED = _leg_theta()
SEAT_GAP = 0.005        # the seated body rests 5 mm above the chair seat (a soft contact, never overlapping it)


def _soft(x, eps=1.0):
    """max(x, 0), smoothed over +-eps (so a lift that follows it has no kink)."""
    return 0.5 * (math.sqrt(x * x + eps * eps) + x)


def pose(rig, rest, seated=False, lift=0.0, body=(0, 0, 0), breath=0.0, head=(0, 0, 0),
         wings=((4, 0), (4, 0)), shift=(0.0, 0.0), legs=None):
    """body / head = (pitch +forward, roll +towards the penguin's left, yaw) degrees; wings =
    ((raise, twist) L, (raise, twist) R) through the hinge (`_wing_raise` clamps to the limits);
    breath = body height factor - 1 (volume kept); legs = per side (leg L matrix, foot L matrix)."""
    pv3.reset_pose(rig)
    base = -Z0 if seated else 0.0
    p, r, y = body
    if seated:
        # sitting ON the seat, never in it: the body pivots about the middle of its bottom, so a
        # pitch or roll lowers an edge of the bottom - lift it by that much plus a hair (clearance
        # check: body / feet vs the chair, no crossing)
        lift += SEAT_GAP + 0.10 * math.sin(math.radians(_soft(p))) + \
            0.12 * math.sin(math.radians(_soft(-p))) + 0.16 * math.sin(math.radians(_soft(r) + _soft(-r)))
    pv3._set(rig, rest, 'root', Matrix.Translation((shift[0], shift[1], base + lift)))
    sz = 1.0 + breath
    sxy = 1 / math.sqrt(sz)
    S = Matrix.Diagonal((sxy, sxy, sz, 1))
    R = _R(y, 'Z') @ _R(r, 'Y') @ _R(p, 'X')
    pv3._set(rig, rest, 'body', pv3._about((0, 0, Z0), R @ S))
    hp, hr, hy = head
    pv3._set(rig, rest, 'head', pv3._about((0, 0, pv3.NECK_Z), _R(hy, 'Z') @ _R(hr, 'Y') @ _R(hp, 'X')))
    for i, side in enumerate('LR'):
        s = 1 if side == 'L' else -1
        if legs is not None:
            leg, foot = legs[side]
        elif seated:
            th = LEG_SEATED
            # the soles rest on the seat in front of the belly (penguin_v3.pose_seated), 7 mm up
            # so the rounded sole never dips into the cushion
            # (and the legs undo the body's pitch, so leaning forward does not push the soles down)
            leg = Matrix.Translation((0, 0, 0.007)) @ pv3._about(pv3._sx(pv3.HIP, s), _R(-th - p, 'X'))
            foot = pv3._about(pv3._sx(pv3.ANKLE, s), _R(th, 'X'))
        else:
            leg = foot = Matrix.Identity(4)
        pv3._set(rig, rest, f'leg.{side}', leg)
        pv3._set(rig, rest, f'foot.{side}', foot)
        rd, tw = wings[i]
        pv3._set(rig, rest, f'wing.{side}', pv3._wing_raise(side, rd, tw))


def _sin(f, L, cycles=1, phase=0.0):
    return math.sin(2 * math.pi * cycles * f / L + phase)


def _cos(f, L, cycles=1, phase=0.0):
    return math.cos(2 * math.pi * cycles * f / L + phase)


Q = math.pi / 2


# -- seated: the office state clips (body bottom on the origin = the chair seat) ---------------

def c_idle(rig, rest, f, L=60):
    pose(rig, rest, True, body=(-2.5 + 0.8 * _sin(f, L), 0.8 * _cos(f, L), 0), breath=0.012 * _sin(f, L),
         head=(1.5 * _sin(f, L, 1, 0.5), 1.5 * _cos(f, L, 1, 0.5), 0),
         wings=((5 + 2 * _sin(f, L, 1, 0.8), 0), (5 + 2 * _sin(f, L, 1, 0.8), 0)))


def c_idle_doze(rig, rest, f, L=60):
    pose(rig, rest, True, body=(1.0 + 1.2 * _sin(f, L), 0.8 * _cos(f, L), 0), breath=0.014 * _sin(f, L),
         head=(10 + 4 * _sin(f, L, 1, 0.4), 2.5 * _cos(f, L, 1, 0.4), 0),
         wings=((2 + 1.5 * _sin(f, L, 1, 0.8), 0), (2 + 1.5 * _sin(f, L, 1, 0.8), 0)))


def c_thinking(rig, rest, f, L=60):
    pose(rig, rest, True, body=(-2.5 + 1.0 * _cos(f, L), 3.0 * _sin(f, L), 0),
         head=(-6 + 2 * _cos(f, L), 5 + 3 * _sin(f, L), 10 * _sin(f, L, 1, Q)),
         wings=((8 + 2 * _sin(f, L), 0), (34 + 6 * _sin(f, L, 1, Q), 6 + 4 * _cos(f, L, 1, Q))))


def c_typing(rig, rest, f, L=60):
    # both wings patter a half cycle apart, 2 taps a second each; the body yaws a quarter cycle
    # behind them, so each tip runs round a small loop instead of back and forth on one line
    k = 4
    pose(rig, rest, True, body=(6, 0, 2.2 * _cos(f, L, k)),
         head=(5 + 1.0 * _sin(f, L, k), 1.0 * _cos(f, L, k), 0),
         wings=((26 + 7 * _sin(f, L, k), 4), (26 - 7 * _sin(f, L, k), 4)))


def c_waiting(rig, rest, f, L=60):
    # the right wing up, waving slowly; the body turns its waving side a little to the viewer
    pose(rig, rest, True, body=(-1.5, -2.0 + 1.6 * _sin(f, L, 2), -6 + 3.0 * _cos(f, L, 2)),
         head=(-3 + 2.5 * _cos(f, L, 2), -3, 4),
         wings=((6, 0), (92 + 12 * _sin(f, L, 2), -8)))


def c_done(rig, rest, f, L=30):
    # a hop off the seat with both wings up, back down on the seat; the body pitches forward on
    # the way up and back on the way down, so every point traces a loop over the hop
    h = math.sin(math.pi * f / L) ** 2
    pose(rig, rest, True, lift=0.05 * h, body=(0.5 + 3.5 * _sin(f, L), 0, 0),
         head=(-4 * h + 2.0 * _sin(f, L), 1.5 * _sin(f, L), 0),
         wings=((5 + 45 * h, 0), (5 + 45 * h, 0)))


def c_error(rig, rest, f, L=60):
    pose(rig, rest, True, body=(6 + 0.8 * _sin(f, L), 1.0 * _cos(f, L), 0), breath=-0.02 + 0.006 * _sin(f, L),
         head=(16 + 2 * _sin(f, L, 1, 0.5), 2 * _cos(f, L, 1, 0.5), 0),
         wings=((1 + 1.5 * _sin(f, L, 1, 0.8), 0), (1 + 1.5 * _sin(f, L, 1, 0.8), 0)))


# -- standing extras (the landing, and anywhere the penguin is on its feet) --------------------

def c_stand(rig, rest, f, L=60):
    pose(rig, rest, False, body=(0.6 * _sin(f, L), 0.8 * _cos(f, L), 0), breath=0.012 * _sin(f, L),
         head=(1.5 * _sin(f, L, 1, 0.5), 1.5 * _cos(f, L, 1, 0.5), 0),
         wings=((4 + 2 * _sin(f, L, 1, 0.8), 0), (4 + 2 * _sin(f, L, 1, 0.8), 0)))


WALK_L = 32


def c_walk(rig, rest, f, L=WALK_L):
    """Waddle in place (penguin_v3.pose_walk's gait, smoothed): the body rocks over the standing
    foot, the other foot lifts and swings forward, wings out for balance."""
    ph = 2 * math.pi * f / L
    sn, cs = math.sin(ph), math.cos(ph)
    roll = 7.0 * sn
    legs = {}
    for side in 'LR':
        s = 1 if side == 'L' else -1
        swing = max(0.0, -s * sn)
        y = -s * 0.022 * cs
        lift = 0.026 * swing ** 2
        hip = pv3._sx(pv3.HIP, s)
        legs[side] = (Matrix.Translation((0, y, lift)) @ pv3._about(hip, _R(-roll, 'Y')),
                      pv3._about(pv3._sx(pv3.ANKLE, s), _R(-14 * swing ** 2, 'X')))
    pose(rig, rest, False, lift=0.008 * (0.5 - 0.5 * math.cos(2 * ph)),
         body=(1.5 * math.sin(2 * ph), roll, 3.5 * cs), head=(0.8 * math.cos(2 * ph), -0.45 * roll, -1.5 * cs),
         wings=((10 + 6 * sn + 3 * cs, 0), (10 - 6 * sn + 3 * cs, 0)), legs=legs)


HOP_L = 36


def c_hop(rig, rest, f, L=HOP_L):
    """A hop in place: squash on the ground, stretch and lift, wings up, feet tucked; the body
    pitches forward rising and back falling, so the head and the wing tips run round loops. One
    smooth cycle (sin^2), so the spacing has no pops (penguin_v3's hop held still, then jumped)."""
    h = math.sin(math.pi * f / L) ** 2
    legs = {}
    for side in 'LR':
        s = 1 if side == 'L' else -1
        legs[side] = (Matrix.Translation((0, 0, 0.02 * h)), pv3._about(pv3._sx(pv3.ANKLE, s), _R(20 * h, 'X')))
    pose(rig, rest, False, lift=0.13 * h, body=(5 * _sin(f, L), 0, 0), breath=-0.05 + 0.09 * h,
         head=(-6 * h + 3 * _sin(f, L), 1.5 * _sin(f, L), 0),
         wings=((6 + 36 * h, 0), (6 + 36 * h, 0)), legs=legs)


WAVE_L = 48


def c_wave(rig, rest, f, L=WAVE_L):
    """The left wing up and waving, the whole body turned 14 deg to the viewer instead of
    twisting the wing (penguin_v3 round 8). The raise eases in and out over the clip (no pop) and
    the swing turns round on a loop: the body yaws a quarter cycle out of phase with the swing, so
    the tip never runs back on its own line (no kink at the turnaround)."""
    t = f / L
    env = 0.5 - 0.5 * math.cos(2 * math.pi * t)
    hold = env * env
    swing = 12 * hold * math.cos(2 * math.pi * 2 * t)
    yaw = -14 * env + 5 * hold * math.sin(2 * math.pi * 2 * t)
    pose(rig, rest, False, body=(0, -3.5 * env, yaw), head=(3 * env, 6 * env, 0),
         wings=((96 * env + swing, -12 * env), (6 + 4 * math.sin(2 * math.pi * t + 0.6), 0)))


CLIPS = {
    # name: (frames, fn, seated)
    'idle': (60, c_idle, True),
    'idle_doze': (60, c_idle_doze, True),
    'thinking': (60, c_thinking, True),
    'typing': (60, c_typing, True),
    'waiting': (60, c_waiting, True),
    'done': (30, c_done, True),
    'error': (60, c_error, True),
    'stand': (60, c_stand, False),
    'walk': (WALK_L, c_walk, False),
    'hop': (HOP_L, c_hop, False),
    'wave': (WAVE_L, c_wave, False),
}
STATE_CLIPS = ('idle', 'idle_doze', 'thinking', 'typing', 'waiting', 'done', 'error')
EXTRA_CLIPS = ('stand', 'walk', 'hop', 'wave')


def wing_angles(rig, side):
    """(raise, twist) of a wing bone now, by penguin_v3.update_welt's decomposition."""
    s = 1 if side == 'L' else -1
    pb = rig.pose.bones['wing.' + side]
    B = pb.bone.matrix_local
    Lm = (B @ pb.matrix_basis @ B.inverted()).to_3x3()
    _, ax = pv3.wing_frame(side)
    e0 = Vector(ax[0])
    e1 = Lm @ e0
    rd = math.degrees(math.atan2(s * e1.x, -e1.z) - math.atan2(s * e0.x, -e0.z))
    Rr = Matrix.Rotation(math.radians(-s * rd), 3, 'Y')
    q = (Rr.inverted() @ Lm).to_quaternion()
    tw = math.degrees(2 * math.atan2(Vector((q.x, q.y, q.z)).dot(e0), q.w)) * s
    return rd, tw


def bake_clips(rig, names=None, nla=True):
    """One action per clip (a key every frame); parked on muted NLA tracks for the exporter."""
    rest = pv3._bone_rest(rig)
    bpy.context.scene.render.fps = FPS
    rig.animation_data_create()
    out = {}
    for name in (names or CLIPS):
        L, fn, _ = CLIPS[name]
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        for f in range(L + 1):
            fn(rig, rest, f % L if f == L else f)
            for pb in rig.pose.bones:
                if pb.name.startswith('socket.'):
                    continue
                for path in ('location', 'rotation_quaternion', 'scale'):
                    pb.keyframe_insert(path, frame=f)
        act.frame_range = (0, L)
        act.use_frame_range = True
        act.use_cyclic = True
        if nla:
            track = rig.animation_data.nla_tracks.new()
            track.name = name
            track.strips.new(name, 0, act)
            track.mute = True
        out[name] = act
    rig.animation_data.action = None
    pv3.reset_pose(rig)
    return out


def motion_report(rig, names=None, max_jump=2.5, max_turn=60.0):
    """motion_path.py's rule (pop / kink per track) on the wing tips and the head top, per clip,
    plus the hinge angles' range (must stay within the limits)."""
    rest = pv3._bone_rest(rig)
    rows = {}
    for name in (names or CLIPS):
        L, fn, _ = CLIPS[name]
        paths = {t: [] for t in ('wing.L', 'wing.R', 'head')}
        ang = []
        for f in range(L + 1):
            fn(rig, rest, f % L if f == L else f)
            bpy.context.view_layer.update()
            for t in paths:
                paths[t].append(np.array((rig.matrix_world @ rig.pose.bones[t].tail)[:]))
            ang.append(wing_angles(rig, 'L') + wing_angles(rig, 'R'))
        probs = []
        for t, pts in paths.items():
            pts = np.array(pts)
            steps = np.r_[0, np.linalg.norm(np.diff(pts, axis=0), axis=1)]
            mv = steps[steps > 1e-9]
            med = float(np.median(mv)) if len(mv) else 0.0
            for i in range(len(pts)):
                turn = 0.0
                if 0 < i < len(pts) - 1:
                    d1, d2 = pts[i] - pts[i - 1], pts[i + 1] - pts[i]
                    if np.linalg.norm(d1) > 1e-9 and np.linalg.norm(d2) > 1e-9:
                        cang = d1 @ d2 / np.linalg.norm(d1) / np.linalg.norm(d2)
                        turn = math.degrees(math.acos(max(-1, min(1, cang))))
                if med and steps[i] > max_jump * med:
                    probs.append(f'pop {t} f{i} {steps[i] / med:.2f}x')
                elif med and turn > max_turn and steps[i] > 0.1 * med:
                    probs.append(f'kink {t} f{i} {turn:.0f}deg')
        a = np.array(ang)
        rows[name] = {'problems': probs, 'raise': (float(a[:, [0, 2]].min()), float(a[:, [0, 2]].max())),
                      'twist': (float(a[:, [1, 3]].min()), float(a[:, [1, 3]].max()))}
    pv3.reset_pose(rig)
    return rows


# ---------------------------------------------------------------------------
# Role props on the v3 body (props.py was written for the v2 body; a small shim gives it the v3
# numbers: the same icon units mapped onto the v3 face)
# ---------------------------------------------------------------------------

def _icon_x(u, sx):
    """Icon x (from the centre line) -> metres: the eyes land on the v3 eyes; past them the body
    narrows faster than the wide-eyed v3 face (the infra shield at icon 29 stays on the chest)."""
    a = abs(u)
    m = a * sx if a <= 3.8 else 3.8 * sx + (a - 3.8) * 0.0126
    return math.copysign(m, u)


def build_props(col, mesh, rig):
    import types
    import props
    ez = pv3.EYE_Z - Z0                       # props are built with the body bottom on the origin
    sx = pv3.EYE_X / 3.8                      # icon eyes at 20 +/- 3.8
    sz = (pv3.EYE_Z - pv3.BEAK_Z) / 3.5       # icon beak centre 3.5 below the eyes
    piv, ax = pv3.wing_frame('L')
    tip = piv + ax[0] * (pv3.WING_C + pv3.WING_AU)
    sh = types.SimpleNamespace(
        H=pv3.HB, _S=sx, EYE_R=pv3.EYE_R / sx, EYE_Z=ez, EYES=((16.2, 18.4), (23.8, 18.4)),
        WING_TIP=Vector((tip[0], tip[1], tip[2] - Z0)),
        icon_to_xz=lambda x, y: (_icon_x(x - 20.0, sx), ez - (y - 18.4) * sz))
    props.P = sh
    props.HEAD_TOP = Vector((0, 0, sh.H - 0.005))
    props.RIM_R = sh.EYE_R * sh._S + 0.008
    props.HAND_R = Vector((-sh.WING_TIP.x, sh.WING_TIP.y - 0.05, sh.WING_TIP.z + 0.03))
    mesh.location.z = -Z0
    bpy.context.view_layer.update()
    obs = props.build_all(col, mesh)
    mesh.location.z = 0.0
    for ob in obs.values():
        ob.matrix_world = Matrix.Translation((0, 0, Z0)) @ ob.matrix_world
    bpy.context.view_layer.update()
    for ob in obs.values():
        props.attach(ob, rig)
    return obs


# ---------------------------------------------------------------------------
# Everything, and the GLB
# ---------------------------------------------------------------------------

def build_all(col, bake=True, texture_dir=None, clips=True):
    for k in MAT_KEYS:
        gltf_material(k, lib.PALETTE[k])
    mesh = build_low(col)
    joints = build_joints(col, mesh)
    uv_unwrap(mesh)
    if bake:
        detail, relief = bake_textures(mesh, texture_dir)
        wire_textures(detail, relief)
    # the fillets' own instance of the body material (`penguin.body#joint` — the web paints it as
    # `penguin.body` by its palette key and gives it a depth offset, office/joint.ts)
    jm = bpy.data.materials['penguin.body'].copy()
    jm.name = JOINT_MATERIAL
    for j in joints:
        j.material_slots[0].material = jm
    rig = pv3.rig(col, mesh, name='penguin_rig')
    prop_obs = build_props(col, mesh, rig)
    for m in bpy.data.materials:
        try:
            lib.principled(m).inputs['Metallic'].default_value = 0.0
        except StopIteration:
            pass
    if clips:
        bake_clips(rig)
    mesh['tri_total'] = tri_count([mesh] + joints)
    return mesh, joints, rig, prop_obs


def write_joint_normals(path):
    import json
    to_gl = lambda a: np.stack([a[:, 0], a[:, 2], -a[:, 1]], 1)   # noqa: E731
    data = {}
    for name, d in JOINT_NORMALS.items():
        data[name] = {'pos': np.round(to_gl(d['pos']), 6).tolist(),
                      'keys': {k: np.round(to_gl(v), 5).tolist() for k, v in d['keys'].items()}}
    with open(path, 'w') as fh:
        json.dump(data, fh)


def export_glb(path):
    """The GLB, then the joint fillets' exact normals patched in (node, @gltf-transform)."""
    import subprocess
    _export_glb(path)
    if JOINT_NORMALS:
        js = path + '.joint-normals.json'
        write_joint_normals(js)
        web = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'web')
        subprocess.run(['node', os.path.join('scripts', 'patch-penguin-joints.mjs'), os.path.abspath(path), js],
                       cwd=web, check=True)
        os.remove(js)


def _export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=True, export_apply=False,
        export_extras=True, export_image_format='WEBP', export_texcoords=True, export_normals=True,
        export_materials='EXPORT', export_cameras=False, export_lights=False,
        export_tangents=True,
        export_attributes=True,     # `_joint_white`: the fillet's per-pixel white (office/joint.ts)       # the relief map was baked in MikkTSpace: ship the same tangents
        export_morph=True, export_morph_normal=True, export_morph_animation=False,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True,
        export_def_bones=False, export_force_sampling=True, export_frame_range=False,
        export_anim_single_armature=True, export_optimize_animation_size=False,
        export_reset_pose_bones=True)
