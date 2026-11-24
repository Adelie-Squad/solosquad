"""The 2D penguin's front view from the v3 model (penguin_v3.py, the confirmed round 12), in icon
units (viewBox 40, y down): web/src/characters/penguinShape.ts is generated from this.

    blender -b --factory-startup -P assets/office/scripts/penguin_2d.py -- --out web/src/characters/penguinShape.gen.json

Scale: the whole penguin, head top (y 5) to the soles (y 49), = 0.735 m, so 1 unit = 1/59.86 m.
Front-view shapes: the body silhouette (the profile the draft revolves), the white front (the brow
lobes with their V, the temple, the side curve, closed across the bottom), the flippers (the wing
paddle at rest, projected), the eyes, cheeks, beak and feet.
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import penguin_v3 as pv3  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[argv.index('--out') + 1] if '--out' in argv else None

TOP_Y, FOOT_Y = 5.0, 49.0
S = (FOOT_Y - TOP_Y) / pv3.Z1            # units per metre


def to_icon(x, z):
    return 20.0 + x * S, TOP_Y + (pv3.Z1 - z) * S


def path(pts, close=True):
    p = [f'{"M" if i == 0 else "L"}{x:.2f} {y:.2f}' for i, (x, y) in enumerate(pts)]
    return ''.join(p) + ('Z' if close else '')


def body():
    poly = pv3._profile_polygon(160)                 # (r, z), right half up then left half down
    return [to_icon(r, z) for r, z in poly[::2]]


def front():
    cx, cz = pv3.LOBE_C
    a0 = math.acos(-cx / pv3.LOBE_R)
    ang = np.linspace(a0, pv3.TEMPLE_A, 24)
    lobe = np.stack([cx + pv3.LOBE_R * np.cos(ang), cz + pv3.LOBE_R * np.sin(ang)], 1)
    lobe[0, 0] = 0.0
    side = pv3._front_side(60)
    half = np.concatenate([lobe, side]) * pv3.W
    half[:, 1] += pv3.EYE_Z
    # close across the bottom: from the side's end, round under the belly to the middle, just
    # above the body's bottom (the 3D front wraps under it)
    xe, ze = half[-1]
    zb = pv3.Z0 + 0.012
    t = np.linspace(0, 1, 14)[1:]
    bx = xe * (1 - t) ** 1.6
    bz = ze + (zb - ze) * np.sin(t * math.pi / 2)
    right = np.concatenate([half, np.stack([bx, bz], 1)])
    left = right[::-1][1:] * np.array([-1, 1])
    pts = np.concatenate([right, left])
    return [to_icon(x, z) for x, z in pts], right


def inset(curve, d):
    """Offset a polyline (icon units) to its left by d (into the white for the right half going down)."""
    c = np.array(curve)
    out = []
    for i in range(len(c)):
        a, b = c[max(i - 1, 0)], c[min(i + 1, len(c) - 1)]
        t = (b - a) / max(np.linalg.norm(b - a), 1e-9)
        n = np.array([-t[1], t[0]])
        out.append(c[i] + n * d)
    return out


def flipper(side):
    piv, ax = pv3.wing_frame(side)
    u = np.linspace(-1, 1, 41)
    th = np.linspace(0, 2 * math.pi, 48, endpoint=False)
    U, T = np.meshgrid(u, th)
    q = np.stack([pv3.WING_C + pv3.WING_AU * U.ravel(), np.zeros(U.size), np.zeros(U.size)], 1)
    taper = pv3.WING_ROOT + (pv3.WING_TIP - pv3.WING_ROOT) * (U.ravel() + 1) / 2
    r = np.sqrt(np.clip(1 - U.ravel() ** 2, 0, 1))
    q[:, 1] = pv3.WING_AV * taper * r * np.cos(T.ravel())
    q[:, 2] = pv3.WING_AW * r * np.sin(T.ravel())
    P = piv + q @ ax
    xy = np.array([to_icon(x, z) for x, _, z in P])
    # convex hull (monotone chain)
    pts = sorted(map(tuple, np.round(xy, 3)))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def main():
    f_pts, right = front()
    side_icon = [to_icon(x, z) for x, z in right]
    # the stitch: 1.0 unit inside the white edge, up one side over the brows and down the other,
    # stopping where the front turns under
    n_side = len(right) - 13
    seam_r = inset(side_icon[:n_side], 1.0)
    seam = [(2 * 20 - x, y) for x, y in seam_r[::-1]] + seam_r
    seam = [p for p in seam if abs(p[0] - 20) > 0.6 or p[1] > 14.6]   # leave the V tip clear
    ex, ez = to_icon(pv3.EYE_X, pv3.EYE_Z)
    cx, cz = to_icon(pv3.EYE_X + pv3.CHEEK_DX, pv3.EYE_Z + pv3.CHEEK_DZ)
    bx, bz = to_icon(0, pv3.BEAK_Z)
    # the white front's width at the eye line
    xs = [x for (x, y) in side_icon[:n_side]]
    ys = [y for (x, y) in side_icon[:n_side]]
    face_half = float(np.interp(ez, ys, xs)) - 20 if ys[0] < ys[-1] else None
    fx, _ = to_icon(pv3.FOOT_C[0], 0)
    out = {
        'scale_units_per_m': S,
        'BODY': path(body()),
        'FLIPPERS': ' '.join(path(flipper(s)) for s in 'LR'),
        'FRONT': path(f_pts),
        'FRONT_STITCH': path(seam, close=False),
        'EYES': [{'cx': round(20 - (ex - 20), 2), 'cy': round(ez, 2), 'r': round(pv3.EYE_R * S, 2)},
                 {'cx': round(ex, 2), 'cy': round(ez, 2), 'r': round(pv3.EYE_R * S, 2)}],
        'CHEEKS': [{'cx': round(20 - (cx - 20), 2), 'cy': round(cz, 2), 'r': round(pv3.CHEEK_R * S, 2)},
                   {'cx': round(cx, 2), 'cy': round(cz, 2), 'r': round(pv3.CHEEK_R * S, 2)}],
        'BEAK': {'cx': 20, 'cy': round(bz, 2), 'halfWidth': round(pv3.BEAK_HW * S, 2),
                 'up': round(pv3.BEAK_UP_H * S, 2), 'down': round(pv3.BEAK_DN_H * S, 2)},
        'FEET': [{'cx': round(20 - (fx - 20), 2), 'cy': 48.1, 'rx': round(pv3.FOOT_R[0] * S * 1.1, 2), 'ry': 1.5},
                 {'cx': round(fx, 2), 'cy': 48.1, 'rx': round(pv3.FOOT_R[0] * S * 1.1, 2), 'ry': 1.5}],
        'FACE_WIDTH_AT_EYES': round(2 * face_half, 2) if face_half else None,
    }
    js = json.dumps(out, indent=1, ensure_ascii=False)
    if OUT:
        open(OUT, 'w').write(js + '\n')
    print(js)


main()
