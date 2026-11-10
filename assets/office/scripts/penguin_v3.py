"""Penguin v3 draft: the stitched-leather keychain draft (identity/character/reference/draft_*.webp)
rebuilt as a 3D plush with real thickness and structural joints.

DRAFT ONLY. This does not replace penguin.py / export/penguin.glb. identity_v3_renders.py renders
it for identity/_drafts/penguin-v3/ so the user can judge it.

How it is built
---------------
* **One continuous skin.** Body, both wings, both legs and both feet are one signed-distance field
  (numpy), joined with smooth unions: the wing shoulder and the hip grow out of the body through a
  soft crease, with no gap. The field is meshed with surface nets on a 6 mm grid and every vertex
  is pulled back onto the exact zero surface (Newton steps), so curves stay smooth.
* **Colour regions are fields, not separate pieces.** Each vertex stores a signed distance to its
  colour boundary (`seam_d`: the white front's outline, the white wing underside), the seam's arc
  position as a unit vector (`seam_c`, `seam_sn`, so a closed seam has no wrap seam) and the dash
  count (`seam_n`). The shader thresholds those per pixel, so the white edge, the seam groove and
  the thread dashes are crisp at any resolution while the mesh stays coarse. `feet` marks the
  leg/foot region (black), `rest` keeps the rest position for the leather grain.
* **Appliques** (eyes, cheeks, the two beak pieces) are thin felt pillows projected onto the body
  along the front view (-Y), so they read as perfect circles from the front. 128 segments.
* **Rig**: root -> body -> head, wing.L/R (shoulder pivot inside the body side), leg.L/R -> foot.L/R
  (hip pivot inside the body bottom), socket.head / socket.chest / socket.hand.R. Weights come from
  the same fields (which primitive dominates a vertex) and are smoothed along the surface, so the
  shoulder and hip skin stretches instead of a rigid part floating.

Blender axes: X = the penguin's left, -Y = front, Z = up. 1 unit = 1 m. Origin = the ground
under the feet (the draft stands; v2 is built seated).
"""
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

import lib

# ---------------------------------------------------------------------------
# Proportions (m)
# ---------------------------------------------------------------------------
W = 0.41           # body width (without wings)
HB = 0.705         # body height (bottom of the body -> top of the head); HB / W = 1.72
D = 0.27           # body depth; D / W = 0.66
Z0 = 0.040         # body bottom (the feet are below it)
Z1 = Z0 + HB       # top of the head
P_XSEC = 2.3       # horizontal cross-section superellipse exponent (2 = ellipse)
R_BOTTOM = 0.075   # bottom corner radius (front view)
R_TOP = 0.24       # vertical semi-axis of the round top

EYE_Z = Z0 + 0.72 * HB          # eye centres at 72 % of the body height
EYE_X = 0.22 * W                # eye centres +/- 0.22 W (0.44 W apart)
EYE_R = 0.145 * W               # eye diameter 0.29 W
CHEEK_R = 0.65 * EYE_R          # blush diameter 0.65 x eye
CHEEK_DX, CHEEK_DZ = 0.20 * 2 * EYE_R, -0.58 * 2 * EYE_R   # low-outside of the eye, tucked under it
BEAK_Z = EYE_Z - 0.168 * W      # beak centre (the line between upper and lower beak)

# White front outline, right half, top centre -> bottom, in body widths relative to the eye
# centre (x right, z up). The left half mirrors it. Forehead: a soft V (widow's peak) at the
# centre, a round lobe over each eye. Sides: smooth, no notch. Bottom: wraps under the body.
FRONT_W = [
    (0.000, 0.146), (0.012, 0.150), (0.030, 0.170), (0.055, 0.200), (0.090, 0.236), (0.160, 0.272), (0.225, 0.283),
    (0.290, 0.262), (0.345, 0.212), (0.385, 0.132), (0.405, 0.040), (0.410, -0.060),
    (0.408, -0.200), (0.402, -0.400), (0.396, -0.600), (0.394, -0.800), (0.396, -0.980),
    (0.393, -1.100), (0.386, -1.160),
]
ZC = Z0 + 0.36 * HB              # polar centre for the wrap under the bottom
PHI_UNDER = math.radians(158)   # how far the white wraps under (0 = straight up, 180 = down)

# Beak (front view, metres from the beak centre): upper triangle larger, apex up and a little
# left; lower triangle smaller, set slightly lower and angled - the draft's open-ish beak.
BEAK_UP = [(-0.056, -0.003), (0.057, 0.008), (-0.007, 0.063)]
BEAK_LO = [(-0.045, -0.012), (0.048, -0.003), (-0.012, -0.050)]
BEAK_CORNER = 0.009

# Wings (paddle flippers). Shoulder pivot inside the body side; at rest the paddle hangs down,
# splayed outward and turned so its flat face looks a little forward.
SHOULDER = (0.19, 0.005, Z0 + 0.56 * HB)
WING_SPLAY = math.radians(22)
WING_YAW = math.radians(15)
WING_C, WING_AU, WING_AV, WING_AW = 0.115, 0.150, 0.052, 0.022   # ellipsoid centre + semi-axes
WING_CUT = 0.105                # the white underside starts this far out from the pivot
WING_RIM = 0.005                # ...and this far in from the rim, so the rim stays black
WING_K = 0.035                  # shoulder crease softness

# Legs + feet. Hip pivot inside the body bottom.
HIP = (0.085, -0.015, Z0 + 0.05)
ANKLE = (0.088, -0.030, 0.026)
LEG_R = 0.030
FOOT_C = (0.090, -0.062, 0.0155)
FOOT_R = (0.050, 0.076, 0.0155)
FOOT_YAW = math.radians(12)
LEG_K, FOOT_K = 0.024, 0.012

NECK_Z = Z0 + 0.64 * HB         # body -> head weight blend centre (above the shoulders)
CHEST_Z = Z0 + 0.50 * HB

GRID = 0.006                    # surface-nets cell (m)

COLORS = {
    'body': '#2B2A26', 'white': '#F3F0EA', 'feet': '#151410', 'eye': '#151410',
    'cheek': '#E01FAE', 'beak': '#FBF9F4', 'thread': '#151410',
}


# ---------------------------------------------------------------------------
# Signed-distance fields (numpy, vectorised over (N, 3) points)
# ---------------------------------------------------------------------------

def _smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _smin(a, b, k):
    k = np.maximum(k, 1e-6)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def _side_half_width(z):
    t = (z - Z0) / HB
    return (W / 2) * (0.955 + 0.045 * np.exp(-((t - 0.33) / 0.30) ** 2))


def _profile_polygon(n=240):
    """Front-view half-width r(z) of the body, as a closed symmetric polygon in (rho, z)."""
    zc = Z1 - R_TOP
    zs = np.linspace(Z0, Z1, n)
    r = _side_half_width(zs)
    top = zs > zc
    r[top] = _side_half_width(np.full(top.sum(), zc)) * np.sqrt(np.clip(1 - ((zs[top] - zc) / R_TOP) ** 2, 0, 1))
    zb = Z0 + R_BOTTOM
    bot = zs < zb
    rb = _side_half_width(np.full(bot.sum(), zb)) - R_BOTTOM
    r[bot] = rb + np.sqrt(np.clip(R_BOTTOM ** 2 - (zb - zs[bot]) ** 2, 0, None))
    right = np.stack([r, zs], 1)
    left = right[::-1] * np.array([-1, 1])
    return np.concatenate([right, left])


def _polygon_sdf(poly, px, pz):
    """Signed distance to a closed polygon (negative inside), on arrays px, pz."""
    d = np.full(px.shape, np.inf)
    inside = np.zeros(px.shape, bool)
    n = len(poly)
    for i in range(n):
        ax, az = poly[i]
        bx, bz = poly[(i + 1) % n]
        ex, ez = bx - ax, bz - az
        wx, wz = px - ax, pz - az
        t = np.clip((wx * ex + wz * ez) / max(ex * ex + ez * ez, 1e-12), 0, 1)
        dx, dz = wx - ex * t, wz - ez * t
        d = np.minimum(d, dx * dx + dz * dz)
        cond = ((az <= pz) & (pz < bz)) | ((bz <= pz) & (pz < az))
        xint = ax + (pz - az) * ex / (ez if abs(ez) > 1e-12 else 1e-12)
        inside ^= cond & (px < xint)
    d = np.sqrt(d)
    return np.where(inside, -d, d)


class _Profile:
    """The body profile SDF sampled on a 1 mm (rho, z) grid, bilinear lookup."""
    STEP = 0.001
    R_MAX, Z_MIN, Z_MAX = 0.42, -0.10, 0.90

    def __init__(self):
        poly = _profile_polygon()
        self.rs = np.arange(0, self.R_MAX + self.STEP, self.STEP)
        self.zs = np.arange(self.Z_MIN, self.Z_MAX + self.STEP, self.STEP)
        R, Z = np.meshgrid(self.rs, self.zs, indexing='ij')
        self.grid = _polygon_sdf(poly, R, Z)

    def __call__(self, rho, z):
        fr = np.clip(rho / self.STEP, 0, len(self.rs) - 1.001)
        fz = np.clip((z - self.Z_MIN) / self.STEP, 0, len(self.zs) - 1.001)
        i, j = fr.astype(int), fz.astype(int)
        u, v = fr - i, fz - j
        g = self.grid
        val = (g[i, j] * (1 - u) * (1 - v) + g[i + 1, j] * u * (1 - v) +
               g[i, j + 1] * (1 - u) * v + g[i + 1, j + 1] * u * v)
        # outside the table: add the distance past its edge
        over = np.maximum(rho - self.R_MAX, 0) + np.maximum(self.Z_MIN - z, 0) + np.maximum(z - self.Z_MAX, 0)
        return val + over


_PROFILE = None


def _profile():
    global _PROFILE
    if _PROFILE is None:
        _PROFILE = _Profile()
    return _PROFILE


def f_body(P):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    a, b = W / 2, D / 2
    rn = (np.abs(x / a) ** P_XSEC + np.abs(y / b) ** P_XSEC) ** (1 / P_XSEC)
    return _profile()(rn * a, z)


def _rz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def _ry(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def wing_frame(side):
    """(pivot, axes) of the wing at rest; axes rows = e_u (along, down), e_v (width), e_w (out)."""
    s = 1 if side == 'L' else -1
    R = _rz(-s * WING_YAW) @ _ry(-s * WING_SPLAY)
    e_u = R @ np.array([0.0, 0.0, -1.0])
    e_w = R @ np.array([float(s), 0.0, 0.0])
    e_v = R @ np.array([0.0, 1.0, 0.0])
    piv = np.array([s * SHOULDER[0], SHOULDER[1], SHOULDER[2]])
    return piv, np.stack([e_u, e_v, e_w])


def _wing_local(P, side):
    piv, ax = wing_frame(side)
    return (P - piv) @ ax.T          # columns u, v, w


def _ellipsoid(q, r):
    k0 = np.linalg.norm(q / r, axis=1)
    k1 = np.linalg.norm(q / (r * r), axis=1)
    return k0 * (k0 - 1) / np.maximum(k1, 1e-9)


def f_wing(P, side):
    q = _wing_local(P, side)
    q = q - np.array([WING_C, 0, 0])
    # a little narrower toward the root, fuller toward the tip (a paddle, not an egg)
    taper = 0.86 + 0.14 * _smoothstep(-WING_AU, WING_AU * 0.4, q[:, 0])
    q = q / np.stack([np.ones_like(taper), taper, taper], 1)
    return _ellipsoid(q, np.array([WING_AU, WING_AV, WING_AW])) * 0.95


def _capsule(P, a, b, r):
    a, b = np.asarray(a), np.asarray(b)
    pa, ba = P - a, b - a
    h = np.clip((pa @ ba) / (ba @ ba), 0, 1)
    return np.linalg.norm(pa - np.outer(h, ba), axis=1) - r


def _sx(p, s):
    return (s * p[0], p[1], p[2])


def f_leg(P, side):
    s = 1 if side == 'L' else -1
    return _capsule(P, _sx(HIP, s), _sx(ANKLE, s), LEG_R)


def f_foot(P, side):
    s = 1 if side == 'L' else -1
    c = np.array(_sx(FOOT_C, s))
    q = (P - c) @ _rz(-s * FOOT_YAW)    # into foot-local (toes point -Y, splayed outward)
    return _ellipsoid(q, np.array(FOOT_R))


def fields(P):
    """All primitive fields plus the combined skin field."""
    fb = f_body(P)
    out = {'body': fb}
    f = fb
    for side in 'LR':
        fw = f_wing(P, side)
        u = _wing_local(P, side)[:, 0]
        k = WING_K * (1 - _smoothstep(0.02, 0.09, u))
        f = _smin(f, fw, k)
        out['wing.' + side] = fw
    out['upper'] = f
    for side in 'LR':
        fl = f_leg(P, side)
        ff = f_foot(P, side)
        leg_foot = _smin(fl, ff, FOOT_K)
        f = _smin(f, leg_foot, LEG_K)
        out['leg.' + side] = fl
        out['foot.' + side] = ff
    out['all'] = f
    return out


def f_all(P):
    return fields(P)['all']


def _grad(fn, P, eps=4e-4):
    g = np.zeros_like(P)
    for i in range(3):
        d = np.zeros(3)
        d[i] = eps
        g[:, i] = (fn(P + d) - fn(P - d)) / (2 * eps)
    return g


def _project(fn, P, iters=4, max_step=GRID):
    for _ in range(iters):
        f = fn(P)
        g = _grad(fn, P)
        gg = np.maximum((g * g).sum(1), 1e-9)
        step = (f / gg)[:, None] * g
        n = np.linalg.norm(step, axis=1, keepdims=True)
        step = step * np.minimum(1, max_step / np.maximum(n, 1e-12))
        P = P - step
    return P


# ---------------------------------------------------------------------------
# Surface nets
# ---------------------------------------------------------------------------

def surface_nets(fn, lo, hi, h):
    xs = np.arange(lo[0], hi[0] + h, h)
    ys = np.arange(lo[1], hi[1] + h, h)
    zs = np.arange(lo[2], hi[2] + h, h)
    nx, ny, nz = len(xs), len(ys), len(zs)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
    pts = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
    F = np.concatenate([fn(c) for c in np.array_split(pts, 16)]).reshape(nx, ny, nz)
    inside = F < 0

    csum = np.zeros((nx - 1, ny - 1, nz - 1, 3))
    ccnt = np.zeros((nx - 1, ny - 1, nz - 1))
    origin = np.array([xs[0], ys[0], zs[0]])
    for axis in range(3):
        sl0 = [slice(None)] * 3
        sl1 = [slice(None)] * 3
        sl0[axis] = slice(0, -1)
        sl1[axis] = slice(1, None)
        f0, f1 = F[tuple(sl0)], F[tuple(sl1)]
        cross = (f0 < 0) != (f1 < 0)
        t = np.where(cross, f0 / np.where(cross, f0 - f1, 1), 0)
        idx = np.indices(f0.shape).astype(float)
        pos = np.stack([idx[0], idx[1], idx[2]], -1)
        pos[..., axis] += t
        pos = origin + pos * h
        pos *= cross[..., None]
        # each edge touches the 4 cells around it
        others = [a for a in range(3) if a != axis]
        for da in (0, 1):
            for db in (0, 1):
                src = [slice(None)] * 3
                src[others[0]] = slice(da, da + (F.shape[others[0]] - 1))
                src[others[1]] = slice(db, db + (F.shape[others[1]] - 1))
                csum += pos[tuple(src)]
                ccnt += cross[tuple(src)]
    active = ccnt > 0
    vid = -np.ones(active.shape, int)
    vid[active] = np.arange(active.sum())
    verts = csum[active] / ccnt[active][:, None]

    quads = []
    for axis in range(3):
        sl0 = [slice(None)] * 3
        sl1 = [slice(None)] * 3
        sl0[axis] = slice(0, -1)
        sl1[axis] = slice(1, None)
        cross = inside[tuple(sl0)] != inside[tuple(sl1)]
        others = [a for a in range(3) if a != axis]
        ii = np.argwhere(cross)
        ok = (ii[:, others[0]] >= 1) & (ii[:, others[1]] >= 1)
        ok &= (ii[:, others[0]] < F.shape[others[0]] - 1) & (ii[:, others[1]] < F.shape[others[1]] - 1)
        ii = ii[ok]
        cells = []
        for da, db in ((-1, -1), (0, -1), (0, 0), (-1, 0)):
            c = ii.copy()
            c[:, others[0]] += da
            c[:, others[1]] += db
            cells.append(vid[c[:, 0], c[:, 1], c[:, 2]])
        q = np.stack(cells, 1)
        quads.append(q[(q >= 0).all(1)])
    quads = np.concatenate(quads)
    return verts, quads


def _orient_faces(V, Fq, fn):
    a, b, c = V[Fq[:, 0]], V[Fq[:, 1]], V[Fq[:, 2]]
    n = np.cross(b - a, c - a) + np.cross(c - a, V[Fq[:, 3]] - a)
    g = _grad(fn, V[Fq].mean(1))
    flip = (n * g).sum(1) < 0
    Fq[flip] = Fq[flip][:, ::-1]
    return Fq


def _neighbours(nv, Fq):
    e = np.concatenate([Fq[:, [0, 1]], Fq[:, [1, 2]], Fq[:, [2, 3]], Fq[:, [3, 0]]])
    e = np.concatenate([e, e[:, ::-1]])
    return e


def _relax(V, Fq, fn, iters=2):
    e = _neighbours(len(V), Fq)
    for _ in range(iters):
        acc = np.zeros_like(V)
        cnt = np.zeros(len(V))
        np.add.at(acc, e[:, 0], V[e[:, 1]])
        np.add.at(cnt, e[:, 0], 1)
        avg = acc / np.maximum(cnt, 1)[:, None]
        V = _project(fn, 0.5 * V + 0.5 * avg, iters=3)
    return V


def _smooth_values(vals, e, iters):
    cnt = np.bincount(e[:, 0], minlength=len(vals)).astype(float)
    for _ in range(iters):
        acc = np.zeros_like(vals)
        np.add.at(acc, e[:, 0], vals[e[:, 1]])
        vals = 0.5 * vals + 0.5 * acc / np.maximum(cnt, 1)[..., None] if vals.ndim > 1 else \
            0.5 * vals + 0.5 * acc / np.maximum(cnt, 1)
    return vals


# ---------------------------------------------------------------------------
# Colour regions: the white front and the white wing underside
# ---------------------------------------------------------------------------

def _catmull(pts, n=12):
    pts = np.asarray(pts, float)
    P = np.concatenate([[2 * pts[0] - pts[1]], pts, [2 * pts[-1] - pts[-2]]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1])
    return np.array(out)


def _ray_to_surface(fn, origins, dirs, tmax=0.6, iters=40):
    """Bisection along rays from inside-or-outside origins to the first sign change."""
    n = len(origins)
    ts = np.linspace(0, tmax, 241)
    prev = fn(origins)
    lo = np.zeros(n)
    hi = np.full(n, np.nan)
    for t0, t1 in zip(ts[:-1], ts[1:]):
        cur = fn(origins + dirs * t1)
        hit = np.isnan(hi) & ((prev < 0) != (cur < 0))
        lo[hit], hi[hit] = t0, t1
        prev = cur
    f_lo = fn(origins + dirs * lo[:, None])
    for _ in range(iters):
        mid = 0.5 * (lo + hi)
        fm = fn(origins + dirs * mid[:, None])
        same = (fm < 0) == (f_lo < 0)
        lo = np.where(same, mid, lo)
        f_lo = np.where(same, fm, f_lo)
        hi = np.where(same, hi, mid)
    return origins + dirs * (0.5 * (lo + hi))[:, None]


def _front_view_points(xz):
    """Project front-view (x, z) points onto the body along +Y (from the camera)."""
    xz = np.asarray(xz, float)
    o = np.stack([xz[:, 0], np.full(len(xz), -0.5), xz[:, 1]], 1)
    d = np.tile([0.0, 1.0, 0.0], (len(xz), 1))
    return _ray_to_surface(f_body, o, d, tmax=0.5)


def _polar_points(x, phi):
    o = np.stack([x, np.zeros_like(x), np.full_like(x, ZC)], 1)
    d = np.stack([np.zeros_like(x), -np.sin(phi), np.cos(phi)], 1)
    return _ray_to_surface(lambda p: -f_body(p), o, d, tmax=0.6)


def _phi(P):
    return np.arctan2(-P[:, 1], P[:, 2] - ZC)


def front_outline():
    """Closed 3D outline of the white front on the body: (points, (x, phi) polygon)."""
    half = _catmull(FRONT_W, 10)
    xz = np.stack([half[:, 0] * W, EYE_Z + half[:, 1] * W], 1)
    right = _front_view_points(xz)
    # continue under the bottom in the polar domain, narrowing, then close across the seat
    x0, p0 = right[-1, 0], _phi(right[-1:])[0]
    n_u = 12
    t = np.arange(1, n_u + 1) / n_u
    xu = x0 * (1 - 0.18 * t * t)
    pu = p0 + (PHI_UNDER - p0) * t
    a = (math.pi / 2) * np.arange(1, 10) / 10
    xb = xu[-1] * np.cos(a)
    pb = PHI_UNDER + math.radians(4) * np.sin(a)
    under = _polar_points(np.concatenate([xu, xb]), np.concatenate([pu, pb]))
    half3 = np.concatenate([right, under])
    left3 = half3[::-1] * np.array([-1, 1, 1])
    loop = np.concatenate([half3, left3[1:-1]])
    loop = _resample_loop(loop, 0.003)
    poly = np.stack([loop[:, 0], _phi(loop)], 1)
    return loop, poly


def _resample_loop(loop, step, smooth=60):
    """Smooth a closed 3D loop on the body (removes the kink where the front-view part meets the
    under-the-bottom part), resample it evenly and pull it back onto the surface."""
    def even(lp):
        seg = np.linalg.norm(np.roll(lp, -1, 0) - lp, axis=1)
        cum = np.concatenate([[0], np.cumsum(seg)])
        t = np.linspace(0, cum[-1], int(cum[-1] / step), endpoint=False)
        closed = np.concatenate([lp, lp[:1]])
        return _project(f_body, np.stack([np.interp(t, cum, closed[:, i]) for i in range(3)], 1), iters=3)
    loop = even(loop)
    # only the lower part (where the side turns under the bottom); the forehead V stays crisp
    wgt = (1 - _smoothstep(Z0 + 0.10, Z0 + 0.20, loop[:, 2]))[:, None]
    for _ in range(smooth):
        avg = 0.5 * loop + 0.25 * (np.roll(loop, 1, 0) + np.roll(loop, -1, 0))
        loop = _project(f_body, loop + wgt * (avg - loop), iters=2)
    return even(loop)


def _polyline_distance(P, L, closed=True, side=False):
    """Distance from points P to a polyline L, and the arc length of the nearest point (and, with
    side=True, which side of the curve each point is on: sign of (normal x tangent) . offset)."""
    A = L
    B = np.roll(L, -1, 0) if closed else L[1:]
    A = A if closed else L[:-1]
    seg = B - A
    seg_len = np.linalg.norm(seg, axis=1)
    cum = np.concatenate([[0], np.cumsum(seg_len)])
    best = np.full(len(P), np.inf)
    s = np.zeros(len(P))
    sd = np.zeros(len(P), bool)
    nrm = _grad(f_body, A)
    for chunk in np.array_split(np.arange(len(P)), max(1, len(P) // 2000)):
        p = P[chunk][:, None, :]
        w = p - A[None]
        t = np.clip((w * seg[None]).sum(2) / np.maximum(seg_len ** 2, 1e-12)[None], 0, 1)
        d = np.linalg.norm(w - t[..., None] * seg[None], axis=2)
        k = d.argmin(1)
        best[chunk] = d[np.arange(len(chunk)), k]
        s[chunk] = cum[k] + t[np.arange(len(chunk)), k] * seg_len[k]
        off = P[chunk] - (A[k] + t[np.arange(len(chunk)), k][:, None] * seg[k])
        sd[chunk] = (np.cross(nrm[k], seg[k]) * off).sum(1) > 0
    if side:
        return best, s, cum[-1], sd
    return best, s, cum[-1]


def _point_in_poly(px, py, poly):
    inside = np.zeros(px.shape, bool)
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % n]
        cond = ((ay <= py) & (py < by)) | ((by <= py) & (py < ay))
        dy = by - ay if abs(by - ay) > 1e-12 else 1e-12
        inside ^= cond & (px < ax + (py - ay) * (bx - ax) / dy)
    return inside


def _wing_rim_table(n=720):
    th = np.linspace(-math.pi, math.pi, n + 1)
    pts = np.stack([WING_C + WING_AU * np.cos(th), WING_AV * np.sin(th)], 1)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    return th, np.concatenate([[0], np.cumsum(seg)])


PERIOD_BODY = 0.0125     # front-seam stitch period (m)
PERIOD_WING = 0.0105
PERIOD_EYE = 0.0085
PERIOD_BEAK = 0.0068


def body_attributes(V):
    """Per-vertex seam + region attributes and bone weights for the skin."""
    fl = fields(V)
    n = len(V)
    seam_d = np.full(n, -0.2)
    seam_phase = np.zeros(n)
    seam_n = np.ones(n)

    # which primitive owns each vertex
    fw = np.minimum(fl['wing.L'], fl['wing.R'])
    flf = np.minimum.reduce([fl['leg.L'], fl['leg.R'], fl['foot.L'], fl['foot.R']])
    body_dom = (fl['body'] <= fw) & (fl['body'] <= flf)

    # white front
    loop, poly = front_outline()
    dist, s, total, side = _polyline_distance(V, loop, side=True)
    inside = _point_in_poly(V[:, 0], _phi(V), poly) & (V[:, 1] < 0.02)
    # near the seam trust the local side of the curve (tangent x normal), not the polygon in
    # (x, phi), so the white edge has no zigzag where the two disagree by a hair
    ref_in = side[np.argmax(np.where(inside, dist, -1))]
    near = dist < 0.03
    inside = np.where(near, side == ref_in, inside)
    front_d = np.where(inside, dist, -dist)
    nb = max(1, round(total / PERIOD_BODY))
    use = body_dom
    seam_d[use] = front_d[use]
    seam_phase[use] = s[use] / total
    seam_n[use] = nb

    # white wing underside: the inner half of the paddle (w < 0), past the shoulder
    th_tab, s_tab = _wing_rim_table()
    for side in 'LR':
        q = _wing_local(V, side)
        mine = (fl['wing.' + side] < fl['body']) & (fl['wing.' + side] <= flf)
        und = np.minimum(-q[:, 2] - WING_RIM, q[:, 0] - WING_CUT)
        th = np.arctan2(q[:, 1] / WING_AV, (q[:, 0] - WING_C) / WING_AU)
        sw = np.interp(th, th_tab, s_tab)
        nw = max(1, round(s_tab[-1] / PERIOD_WING))
        seam_d[mine] = und[mine]
        seam_phase[mine] = sw[mine] / s_tab[-1]
        seam_n[mine] = nw

    feet = fl['upper'] - flf              # > 0 where a leg or foot owns the vertex
    return {
        'seam_d': seam_d,
        'seam_c': np.cos(2 * math.pi * seam_phase),
        'seam_sn': np.sin(2 * math.pi * seam_phase),
        'seam_n': seam_n,
        'feet': feet,
    }, fl


def body_weights(V, fl, edges):
    """Bone weights from the fields: a vertex belongs to the primitive that dominates it,
    blended across the crease and smoothed along the surface."""
    w = {}
    fw = {s: fl['wing.' + s] for s in 'LR'}
    flf = {s: np.minimum(fl['leg.' + s], fl['foot.' + s]) for s in 'LR'}
    rest_upper = fl['body']
    for s in 'LR':
        u = _wing_local(V, s)[:, 0]
        dom = _smoothstep(-0.008, 0.008, rest_upper - fw[s])
        w['wing.' + s] = dom * _smoothstep(-0.02, 0.07, u)
        others = np.minimum(fl['body'], np.minimum(fw['L'], fw['R']))
        legdom = _smoothstep(-0.010, 0.010, others - flf[s])
        footdom = _smoothstep(-0.005, 0.005, fl['leg.' + s] - fl['foot.' + s])
        w['foot.' + s] = legdom * footdom
        w['leg.' + s] = legdom * (1 - footdom)
    keys = list(w)
    M = np.stack([w[k] for k in keys], 1)
    M = _smooth_values(M, edges, 14)
    rest = np.clip(1 - M.sum(1), 0, 1)
    tot = M.sum(1) + rest
    M = M / tot[:, None]
    rest = rest / tot
    head = _smoothstep(NECK_Z - 0.06, NECK_Z + 0.06, V[:, 2]) * rest
    out = {k: M[:, i] for i, k in enumerate(keys)}
    out['head'] = head
    out['body'] = rest - head
    return out


# ---------------------------------------------------------------------------
# Appliques: felt pillows projected onto the body along the front view
# ---------------------------------------------------------------------------

def _circle_ring(cx, cz, r, n):
    a = np.linspace(0, 2 * math.pi, n, endpoint=False) + math.pi / 2
    return np.stack([cx + r * np.cos(a), cz + r * np.sin(a)], 1)


def _inradius(tri):
    tri = np.asarray(tri, float)
    a = np.linalg.norm(tri[1] - tri[2])
    b = np.linalg.norm(tri[2] - tri[0])
    c = np.linalg.norm(tri[0] - tri[1])
    s = (a + b + c) / 2
    return math.sqrt(max(s * (s - a) * (s - b) * (s - c), 1e-12)) / s


def _rounded_tri_ring(tri, d, rc, n_arc=40, n_edge=24):
    """Rounded triangle (corner radius rc) offset inward by d, as a closed point ring."""
    tri = np.asarray(tri, float)
    if np.cross(tri[1] - tri[0], tri[2] - tri[0]) < 0:
        tri = tri[::-1]
    # incentre + inradius
    a = np.linalg.norm(tri[1] - tri[2])
    b = np.linalg.norm(tri[2] - tri[0])
    c = np.linalg.norm(tri[0] - tri[1])
    inc = (a * tri[0] + b * tri[1] + c * tri[2]) / (a + b + c)
    s = (a + b + c) / 2
    rin = math.sqrt(max(s * (s - a) * (s - b) * (s - c), 1e-12)) / s
    rho = max(rc - d, 0.0004)
    shrink = rc + max(d - rc, 0)       # inner (sharp) triangle = outline offset inward by this
    k = max(rin - shrink, rin * 0.02) / rin
    core = inc + (tri - inc) * k
    pts = []
    for i in range(3):
        p_prev, p, p_next = core[i - 1], core[i], core[(i + 1) % 3]
        e_in = p - p_prev
        e_out = p_next - p
        n_in = np.array([e_in[1], -e_in[0]]) / np.linalg.norm(e_in)
        n_out = np.array([e_out[1], -e_out[0]]) / np.linalg.norm(e_out)
        a0, a1 = math.atan2(n_in[1], n_in[0]), math.atan2(n_out[1], n_out[0])
        while a1 < a0:
            a1 += 2 * math.pi
        for t in np.linspace(0, 1, n_arc, endpoint=False):
            ang = a0 + (a1 - a0) * t
            pts.append(p + rho * np.array([math.cos(ang), math.sin(ang)]))
        q0 = p + rho * n_out
        q1 = p_next + rho * n_out
        for t in np.linspace(0, 1, n_edge, endpoint=False):
            pts.append(q0 + (q1 - q0) * t)
    return np.array(pts)


def applique(ring_fn, depths, height, edge_round, inset, period, sink=0.0025, lift=0.0):
    """Build a felt pillow. ring_fn(d) -> (n, 2) front-view ring offset inward by d.
    Returns verts, quads (as index tuples; centre fan uses triangles), per-vertex seam attrs."""
    rings = [ring_fn(d) for d in depths]
    n = len(rings[0])
    centre2 = rings[-1].mean(0)
    flat = np.concatenate(rings + [centre2[None]])
    base = _front_view_points(flat)
    nrm = _grad(f_body, base)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    dd = np.concatenate([np.repeat(depths, n), [depths[-1] + 0.01]])
    prof = np.sqrt(np.clip(1 - (1 - np.clip(dd / edge_round, 0, 1)) ** 2, 0, 1))
    dome = 1 + 0.25 * np.clip((dd - edge_round) / 0.05, 0, 1)
    h = lift + 0.0004 + height * prof * dome
    top = base + nrm * h[:, None]
    skirt = _front_view_points(rings[0])
    sn = _grad(f_body, skirt)
    sn /= np.linalg.norm(sn, axis=1, keepdims=True)
    skirt = skirt - sn * sink
    V = np.concatenate([skirt, top])
    # seam phase along the inset ring
    ref = ring_fn(inset)
    seg = np.linalg.norm(np.roll(ref, -1, 0) - ref, axis=1)
    L = seg.sum()
    phase = np.concatenate([[0], np.cumsum(seg)[:-1]]) / L
    ph = np.concatenate([phase, np.tile(phase, len(depths)), [0]])
    seam_d = np.concatenate([np.full(n, -0.002), dd])
    faces = []
    rows = [np.arange(n)] + [n + np.arange(n) + r * n for r in range(len(depths))]
    for r in range(len(rows) - 1):
        a, b = rows[r], rows[r + 1]
        for i in range(n):
            j = (i + 1) % n
            faces.append((a[i], a[j], b[j], b[i]))
    c = len(V) - 1
    last = rows[-1]
    for i in range(n):
        faces.append((last[i], last[(i + 1) % n], c))
    attrs = {
        'seam_d': seam_d,
        'seam_c': np.cos(2 * math.pi * ph),
        'seam_sn': np.sin(2 * math.pi * ph),
        'seam_n': np.full(len(V), max(1, round(L / period))),
        'feet': np.full(len(V), -1.0),
    }
    # face winding: the top must face out of the body
    a, b, cc = V[faces[-1][0]], V[faces[-1][1]], V[faces[-1][2]]
    if np.dot(np.cross(b - a, cc - a), nrm[-1]) < 0:
        faces = [tuple(reversed(f)) for f in faces]
    return V, faces, attrs


def _disc_depths(r):
    ds = [0.0, 0.0006, 0.0016, 0.003, 0.0048, 0.0070, 0.0095, 0.0125]
    k = 0.016
    while k < r * 0.92:
        ds.append(k)
        k += max(0.006, (r - k) * 0.25)
    return np.array(ds)


def build_appliques():
    """Eyes, cheeks (blush) and the two beak pieces -> list of (material key, V, faces, attrs)."""
    out = []
    for s in (-1, 1):
        ex = s * EYE_X
        cx, cz = ex + s * CHEEK_DX, EYE_Z + CHEEK_DZ
        out.append(('cheek', *applique(lambda d, cx=cx, cz=cz: _circle_ring(cx, cz, CHEEK_R - d, 128),
                                       _disc_depths(CHEEK_R), 0.0028, 0.004, 0.0046, PERIOD_EYE)))
        out.append(('eye', *applique(lambda d, ex=ex: _circle_ring(ex, EYE_Z, EYE_R - d, 128),
                                     _disc_depths(EYE_R), 0.0055, 0.0055, 0.0050, PERIOD_EYE, lift=0.0016)))
    for tri, hgt in ((BEAK_UP, 0.0105), (BEAK_LO, 0.0085)):
        t = np.asarray(tri) + np.array([0.0, BEAK_Z])
        ds = np.array([0.0, 0.0006, 0.0016, 0.003, 0.0048, 0.0070, 0.0095, 0.013, 0.018, 0.024])
        ds = ds[ds < 0.85 * _inradius(t)]
        out.append(('beak', *applique(lambda d, t=t: _rounded_tri_ring(t, d, BEAK_CORNER),
                                      ds, hgt, 0.010, 0.0058, PERIOD_BEAK)))
    return out


# ---------------------------------------------------------------------------
# Materials (Cycles): leather with seam groove + thread dashes driven by the attributes
# ---------------------------------------------------------------------------

def _hex3(h):
    return lib.hex_rgba(h)


class _NT:
    def __init__(self, nt):
        self.nt = nt
        self.x = 0

    def node(self, kind, **props):
        n = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        n.location = (self.x, 0)
        self.x += 40
        return n

    def link(self, a, b):
        self.nt.links.new(a, b)

    def _in(self, sock, val):
        if isinstance(val, (int, float)):
            sock.default_value = val
        else:
            self.link(val, sock)

    def math(self, op, a, b=0.0, c=None):
        n = self.node('ShaderNodeMath', operation=op)
        self._in(n.inputs[0], a)
        self._in(n.inputs[1], b)
        if c is not None:
            self._in(n.inputs[2], c)
        return n.outputs[0]

    def attr(self, name, vector=False):
        n = self.node('ShaderNodeAttribute', attribute_type='GEOMETRY', attribute_name=name)
        return n.outputs['Vector' if vector else 'Fac']

    def mix(self, fac, a, b):
        n = self.node('ShaderNodeMix', data_type='RGBA')
        cols = [s for s in n.inputs if s.type == 'RGBA']
        self._in(n.inputs[0], fac)
        for sock, v in zip(cols, (a, b)):
            if isinstance(v, tuple):
                sock.default_value = v
            else:
                self.link(v, sock)
        return [s for s in n.outputs if s.type == 'RGBA'][0]


def leather_material(name, base_key, inset, region=False, piping=0.0, thread=None,
                     rough=0.46, groove=1.0, spec=0.32):
    """region=True: the body skin (black, with the white front / wing underside where seam_d > 0
    and black feet where feet > 0). Otherwise a flat applique colour."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    T = _NT(nt)
    out = T.node('ShaderNodeOutputMaterial')
    bsdf = T.node('ShaderNodeBsdfPrincipled')
    T.link(bsdf.outputs['BSDF'], out.inputs['Surface'])
    d = T.attr('seam_d')
    c = T.attr('seam_c')
    sn = T.attr('seam_sn')
    n = T.attr('seam_n')
    rest = T.attr('rest', vector=True)

    # dash coordinates: a along the seam (-1..1 over one dash), b across it
    theta = T.math('ARCTAN2', sn, c)
    phase = T.math('FRACT', T.math('MULTIPLY', T.math('ADD', T.math('DIVIDE', theta, 2 * math.pi), 0.5), n))
    duty = 0.62
    a = T.math('DIVIDE', T.math('SUBTRACT', phase, 0.5), duty / 2)
    tw = 0.00125
    b = T.math('DIVIDE', T.math('SUBTRACT', d, inset), tw)
    r2 = T.math('ADD', T.math('MULTIPLY', a, a), T.math('MULTIPLY', b, b))
    stitch = T.math('LESS_THAN', r2, 1.0)
    thread_h = T.math('MULTIPLY', T.math('SQRT', T.math('MAXIMUM', T.math('SUBTRACT', 1.0, r2), 0.0)), 0.0006)
    # the stitch holes pull the leather in a little along the stitch line
    pull = T.math('EXPONENT', T.math('MULTIPLY', T.math('MULTIPLY', b, b), -0.35))
    # seam groove at the colour edge (body) / around the piece edge
    gw = 0.0016
    g = T.math('EXPONENT', T.math('MULTIPLY', T.math('POWER', T.math('DIVIDE', d, gw), 2.0), -1.0))
    g = T.math('MULTIPLY', g, groove)
    noise = T.node('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 340.0
    noise.inputs['Detail'].default_value = 3.0
    noise.inputs['Roughness'].default_value = 0.55
    T.link(rest, noise.inputs['Vector'])
    grain = T.math('MULTIPLY', T.math('SUBTRACT', noise.outputs['Fac'], 0.5), 0.00022)
    height = T.math('ADD', T.math('ADD', T.math('MULTIPLY', g, -0.0014), thread_h),
                    T.math('ADD', grain, T.math('MULTIPLY', pull, -0.00018)))
    bump = T.node('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 1.0
    bump.inputs['Distance'].default_value = 1.0
    T.link(height, bump.inputs['Height'])
    T.link(bump.outputs['Normal'], bsdf.inputs['Normal'])

    if region:
        white = T.math('GREATER_THAN', d, 0.0)
        feet = T.math('GREATER_THAN', T.attr('feet'), 0.0)
        rgb = T.node('ShaderNodeRGB')
        rgb.name = 'body_color'          # identity_v3_renders swaps it for the evening body tone
        rgb.outputs[0].default_value = _hex3(COLORS['body'])
        col = T.mix(feet, rgb.outputs[0], _hex3(COLORS['feet']))
        col = T.mix(T.math('MULTIPLY', white, T.math('SUBTRACT', 1.0, feet)), col, _hex3(COLORS['white']))
        rough_s = T.math('ADD', T.math('MULTIPLY', white, 0.12), rough)
        T.link(rough_s, bsdf.inputs['Roughness'])
    else:
        col = T.mix(0.0, _hex3(COLORS[base_key]), _hex3(COLORS[base_key]))
        if piping > 0:
            pipe = T.math('LESS_THAN', d, piping)
            col = T.mix(pipe, col, _hex3(COLORS['thread']))
        bsdf.inputs['Roughness'].default_value = rough
    # groove shadow + thread colour
    col = T.mix(T.math('MULTIPLY', g, 0.6), col, _hex3('#1E1D19'))
    col = T.mix(stitch, col, _hex3(thread or COLORS['thread']))
    T.link(col, bsdf.inputs['Base Color'])
    bsdf.inputs['Metallic'].default_value = 0.0
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = spec
    return mat


def materials():
    return [
        leather_material('v3.leather', 'body', inset=0.0062, region=True),
        leather_material('v3.eye', 'eye', inset=0.0050, thread='#45423B', rough=0.42),
        leather_material('v3.cheek', 'cheek', inset=0.0046, rough=0.55, groove=0.35, spec=0.4),
        leather_material('v3.beak', 'beak', inset=0.0058, piping=0.0026, rough=0.58, spec=0.4),
    ]


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
LO = (-0.36, -0.20, -0.012)
HI = (0.36, 0.20, Z1 + 0.02)
PIECE_MAT = {'eye': 1, 'cheek': 2, 'beak': 3}


def build(col, name='penguin_v3'):
    V, Fq = surface_nets(f_all, LO, HI, GRID)
    V = _project(f_all, V, iters=5)
    Fq = _orient_faces(V, Fq, f_all)
    V = _relax(V, Fq, f_all, iters=2)
    edges = _neighbours(len(V), Fq)
    attrs, fl = body_attributes(V)
    weights = body_weights(V, fl, edges)
    n_body = len(V)

    verts = [V]
    faces = [list(map(tuple, Fq.tolist()))]
    mat_idx = [np.zeros(len(Fq), int)]
    all_attrs = {k: [v] for k, v in attrs.items()}
    piece_weights = []
    off = n_body
    for key, pv, pf, pa in build_appliques():
        verts.append(pv)
        faces.append([tuple(i + off for i in f) for f in pf])
        mat_idx.append(np.full(len(pf), PIECE_MAT[key]))
        for k in all_attrs:
            all_attrs[k].append(pa[k])
        piece_weights.append(pv)
        off += len(pv)
    Vall = np.concatenate(verts)
    Fall = [f for fs in faces for f in fs]
    me = bpy.data.meshes.new(name)
    me.from_pydata(Vall.tolist(), [], Fall)
    me.update()
    me.polygons.foreach_set('material_index', np.concatenate(mat_idx).astype(np.int32))
    for m in materials():
        me.materials.append(m)
    for k, parts in all_attrs.items():
        a = me.attributes.new(k, 'FLOAT', 'POINT')
        a.data.foreach_set('value', np.concatenate(parts).astype(np.float32))
    r = me.attributes.new('rest', 'FLOAT_VECTOR', 'POINT')
    r.data.foreach_set('vector', Vall.astype(np.float32).ravel())
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)

    # vertex groups: skin from the fields; appliques split body/head by height
    PV = np.concatenate(piece_weights) if piece_weights else np.zeros((0, 3))
    hp = _smoothstep(NECK_Z - 0.06, NECK_Z + 0.06, PV[:, 2])
    groups = dict(weights)
    for k in groups:
        groups[k] = np.concatenate([groups[k], np.zeros(len(PV))])
    groups['head'][n_body:] = hp
    groups['body'][n_body:] = 1 - hp
    for gname, wv in groups.items():
        vg = ob.vertex_groups.new(name=gname)
        idx = np.nonzero(wv > 1e-3)[0]
        for i in idx:
            vg.add([int(i)], float(wv[i]), 'REPLACE')
    ob['tri_count'] = int(sum(len(f) - 2 for f in Fall))
    ob['tri_body'] = int(2 * len(Fq))
    return ob


# ---------------------------------------------------------------------------
# Rig
# ---------------------------------------------------------------------------

def rig(col, mesh, name='penguin_v3_rig'):
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    col.objects.link(ob)
    vl = bpy.context.view_layer
    vl.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones

    def bone(n, head, tail, parent=None, deform=True, roll_to=None):
        b = eb.new(n)
        b.head, b.tail = Vector(head), Vector(tail)
        if roll_to is not None:
            b.align_roll(Vector(roll_to))
        b.parent = eb[parent] if parent else None
        b.use_deform = deform
        return b

    bone('root', (0, 0, 0), (0, 0.12, 0), deform=False)
    bone('body', (0, 0, Z0), (0, 0, NECK_Z), 'root', roll_to=(0, -1, 0))
    bone('head', (0, 0, NECK_Z), (0, 0, Z1), 'body', roll_to=(0, -1, 0))
    front_y = float(_front_view_points([(0.0, CHEST_Z)])[0, 1])
    for side in 'LR':
        s = 1 if side == 'L' else -1
        piv, ax = wing_frame(side)
        tip = piv + ax[0] * (WING_C + WING_AU)
        bone(f'wing.{side}', piv, tip, 'body', roll_to=ax[2])
        bone(f'leg.{side}', _sx(HIP, s), _sx(ANKLE, s), 'body', roll_to=(0, -1, 0))
        toe = np.array(_sx(ANKLE, s)) + _rz(s * FOOT_YAW) @ np.array([0, -0.09, 0])
        bone(f'foot.{side}', _sx(ANKLE, s), toe, f'leg.{side}', roll_to=(0, 0, 1))
    bone('socket.head', (0, 0, Z1), (0, 0, Z1 + 0.08), 'head', deform=False)
    bone('socket.chest', (0, front_y, CHEST_Z), (0, front_y - 0.08, CHEST_Z), 'body', deform=False)
    piv, ax = wing_frame('R')
    tip = piv + ax[0] * (WING_C + WING_AU)
    bone('socket.hand.R', tip, tip + np.array([0, -0.08, 0]), 'wing.R', deform=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    mesh.parent = ob
    mod = mesh.modifiers.new('rig', 'ARMATURE')
    mod.object = ob
    for pb in ob.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return ob


# ---------------------------------------------------------------------------
# Motion tests: hop + wing wave. Poses are armature-space deltas L about each bone's rest pivot;
# the bone's basis is B^-1 L B (B = rest matrix), so parents and children compose naturally.
# ---------------------------------------------------------------------------

def _keys(track, f):
    """Monotone-ish cubic (Catmull-Rom) through (frame, value) keys, clamped at the ends."""
    fs = [k[0] for k in track]
    vs = [k[1] for k in track]
    if f <= fs[0]:
        return vs[0]
    if f >= fs[-1]:
        return vs[-1]
    i = max(j for j in range(len(fs) - 1) if fs[j] <= f)
    t = (f - fs[i]) / (fs[i + 1] - fs[i])
    p1, p2 = vs[i], vs[i + 1]
    p0 = vs[i - 1] if i > 0 else p1
    p3 = vs[i + 2] if i + 2 < len(vs) else p2
    # flatter tangents (0.5 x Catmull-Rom) so holds don't overshoot
    m1, m2 = 0.25 * (p2 - p0), 0.25 * (p3 - p1)
    t2, t3 = t * t, t * t * t
    return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2


HOP_LEN = 36
HOP = {
    'lift':  [(0, 0), (11, 0), (13, 0.035), (16, 0.12), (19, 0.165), (22, 0.13), (25, 0.04), (26, 0.0), (36, 0)],
    'sz':    [(0, 1), (6, 0.86), (9, 0.88), (12, 1.10), (16, 1.05), (20, 1.0), (24, 1.04), (26, 1.02), (28, 0.84), (31, 1.04), (34, 0.99), (36, 1)],
    'contact': [(0, 1), (11, 1), (13, 0), (24, 0), (26, 1), (36, 1)],
    'ext_air': [(0, 0), (12, 0.040), (15, 0.012), (19, -0.012), (22, -0.004), (25, 0.030), (36, 0)],
    'pitch': [(0, 0), (11, 0), (13, 22), (16, 32), (19, 26), (23, 6), (25, -6), (26, 0), (36, 0)],
    'splay': [(0, 0), (12, -6), (19, 10), (25, 4), (36, 0)],       # feet turn in a little in the air
    'wing':  [(0, 0), (6, -8), (12, 30), (19, 42), (24, 26), (27, -6), (31, 6), (36, 0)],
    'head':  [(0, 0), (6, 5), (13, -7), (19, -4), (27, 7), (32, -2), (36, 0)],
}

WAVE_LEN = 48
WAVE_RAISE = [(0, 0), (4, 20), (11, 128), (36, 128), (44, 10), (48, 0)]
WAVE_SWING = 17      # degrees, side to side while raised
WAVE_TWIST = -78     # degrees about the wing's own axis at full raise (shows the white underside)


def _bone_rest(rig_ob):
    return {b.name: b.matrix_local.copy() for b in rig_ob.data.bones}


def _about(pivot, R):
    pv = Vector(pivot)
    return Matrix.Translation(pv) @ R @ Matrix.Translation(-pv)


def _set(rig_ob, rest, name, L):
    B = rest[name]
    pb = rig_ob.pose.bones[name]
    pb.matrix_basis = B.inverted() @ L @ B


def reset_pose(rig_ob):
    for pb in rig_ob.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)


def _wing_raise(side, raise_deg, twist_deg):
    s = 1 if side == 'L' else -1
    piv, ax = wing_frame(side)
    R_twist = Matrix.Rotation(math.radians(twist_deg) * s, 4, Vector(ax[0]))
    R_raise = Matrix.Rotation(math.radians(-s * raise_deg), 4, 'Y')
    return _about(piv, R_raise @ R_twist)


def pose_hop(rig_ob, f, rest=None):
    rest = rest or _bone_rest(rig_ob)
    reset_pose(rig_ob)
    g = {k: _keys(v, f) for k, v in HOP.items()}
    lift, sz = g['lift'], g['sz']
    sxy = 1 / math.sqrt(sz)
    _set(rig_ob, rest, 'root', Matrix.Translation((0, 0, lift)))
    S = Matrix.Diagonal((sxy, sxy, sz, 1))
    _set(rig_ob, rest, 'body', _about((0, 0, Z0), S))
    _set(rig_ob, rest, 'head', _about((0, 0, NECK_Z), Matrix.Rotation(math.radians(g['head']), 4, 'X')))
    # legs: planted -> extend so the feet stay on the ground while the body squashes and lifts
    planted = (lift + Z0) / sz - Z0
    c = min(max(g['contact'], 0), 1)
    ext = c * planted + (1 - c) * g['ext_air']
    for side in 'LR':
        s = 1 if side == 'L' else -1
        _set(rig_ob, rest, f'leg.{side}', Matrix.Translation((0, 0, -ext)))
        ank = _sx(ANKLE, s)
        R = Matrix.Rotation(math.radians(g['pitch']), 4, 'X') @ Matrix.Rotation(math.radians(s * g['splay']), 4, 'Z')
        _set(rig_ob, rest, f'foot.{side}', _about(ank, R))
        piv, _ = wing_frame(side)
        _set(rig_ob, rest, f'wing.{side}', _about(piv, Matrix.Rotation(math.radians(-s * g['wing']), 4, 'Y')))


def pose_wave(rig_ob, f, rest=None):
    rest = rest or _bone_rest(rig_ob)
    reset_pose(rig_ob)
    raise_deg = _keys(WAVE_RAISE, f)
    k = raise_deg / 128.0
    hold = 1.0 if 11 <= f <= 36 else 0.0
    swing = WAVE_SWING * math.sin(2 * math.pi * 2 * (f - 11) / 25) * hold
    _set(rig_ob, rest, 'wing.L', _wing_raise('L', raise_deg + swing, WAVE_TWIST * k))
    _set(rig_ob, rest, 'wing.R', _wing_raise('R', 6 * k, 0))
    _set(rig_ob, rest, 'body', _about((0, 0, Z0), Matrix.Rotation(math.radians(-3.5 * k), 4, 'Y')))
    tilt = Matrix.Rotation(math.radians(6 * k), 4, 'Y') @ Matrix.Rotation(math.radians(3 * k), 4, 'X')
    _set(rig_ob, rest, 'head', _about((0, 0, NECK_Z), tilt))


CLIPS = {'hop': (HOP_LEN, pose_hop), 'wave': (WAVE_LEN, pose_wave)}


def build_actions(rig_ob):
    """Bake the two motion tests to actions (one key per frame) so the rig can be inspected."""
    rest = _bone_rest(rig_ob)
    rig_ob.animation_data_create()
    acts = {}
    for name, (length, fn) in CLIPS.items():
        act = bpy.data.actions.new('v3.' + name)
        act.use_fake_user = True
        rig_ob.animation_data.action = act
        for f in range(length + 1):
            fn(rig_ob, f, rest)
            for pb in rig_ob.pose.bones:
                if pb.name.startswith('socket.'):
                    continue
                for path in ('location', 'rotation_quaternion', 'scale'):
                    pb.keyframe_insert(path, frame=f)
        acts[name] = act
    rig_ob.animation_data.action = None
    reset_pose(rig_ob)
    return acts
