"""Transitions between shots: where each one starts and ends, what kind it is, which way it moves.

The cut detector (shots.py) finds boundaries; this module adds the ones it cannot see frame by frame and
describes all of them.

- find_gradual: a transition without a hard cut inside is "steady picture A, a ramp, steady picture B": a
  window whose two ends are different pictures, with the picture holding still before and after and passing
  from one to the other in between. It counts as a boundary when the ramp reads as a fade, dissolve, wipe or
  slide; a push-in, a pan or a focus pull inside one take also goes from one steady picture to another.
- span: for one boundary, the frames over which the picture goes from the old shot to the new one.
- classify: what happens inside the span.
    fade      through a flat black / white frame
    flash     burns up to near white (a flash, a light leak) and the next shot comes out of it
    dissolve  every frame is a blend of the two pictures
    wipe      the new picture replaces the old one region by region (edge, iris, clock, blinds); direction
    slide     the pictures move: push (both), cover (new one slides over), reveal (old one slides away); direction
    whip      a fast pan with motion blur hides the cut; direction
    zoom      a fast push in / pull out hides the cut
    spin      a rotation hides the cut
    blur      the picture goes out of focus and comes back as the next shot
    glitch    a burst of displaced / alternating frames
    shake     a burst of camera shake around the cut
- resolve: joins boundaries that are parts of one transition and drops candidates that are camera work.

Everything works on the small gray thumbs of the frame track. Letterbox bars and other static borders are
cropped away first, so a transition inside a letterboxed picture is measured on the picture, not on the bars."""
from __future__ import annotations

import cv2
import numpy as np

GRID = (6, 8)  # blocks across, down
GRADUAL_SECONDS = (0.2, 0.35, 0.6, 1.0, 1.5)
PLATEAU = 0.3          # the picture just outside a transition differs from its end by at most this share of the change across it
MIN_CHANGED = 0.5      # share of the picture that must be different after a gradual transition
SPAN_PLATEAU = 0.4     # same idea for the span of a known boundary; looser, the boundary is already there
SPAN_SECONDS = (0.1, 0.2, 0.35, 0.6, 1.0, 1.5)  # half-widths tried for the span of a gradual boundary
MIN_EFFECT_S = 0.25    # shortest span read as an editor's effect (wipe, slide, whip ...); shorter ones are cuts
DIRECTIONS = ("left", "right", "up", "down")


def crop_box(thumbs: list[np.ndarray], cuts: int = 0, samples: int = 48) -> tuple[int, int, int, int]:
    """(y0, y1, x0, x1) of the picture without its static borders: letterbox bars, a fixed banner above and below
    a letterboxed film. `cuts`: how many hard cuts the video has. A border that stays the same across several
    shots is a border; in a video of one or two shots a still background is just as static, so there only
    plain bars (one flat colour) are taken off."""
    n = len(thumbs)
    h, w = thumbs[0].shape
    if n < 8:
        return 0, h, 0, w
    idx = np.linspace(0, n - 1, num=min(samples, n)).astype(int)
    stack = np.stack([thumbs[i] for i in idx]).astype(np.int16)
    moving = (stack.max(axis=0) - stack.min(axis=0)) > 16
    rows, cols = moving.mean(axis=1) > 0.08, moving.mean(axis=0) > 0.08
    if cuts < 3:
        mid = thumbs[n // 2].astype(np.float32)
        rows |= mid.std(axis=1) >= 8.0
        cols |= mid.std(axis=0) >= 8.0
    if not rows.any() or not cols.any():
        return 0, h, 0, w
    y0, y1 = int(np.argmax(rows)), int(h - np.argmax(rows[::-1]))
    x0, x1 = int(np.argmax(cols)), int(w - np.argmax(cols[::-1]))
    if (y1 - y0) < 0.15 * h or (x1 - x0) < 0.3 * w or (y1 - y0) < 24 or (x1 - x0) < 24:
        return 0, h, 0, w  # hardly anything left: not a bordered picture
    return y0, y1, x0, x1


def _f(t: np.ndarray) -> np.ndarray:
    return t.astype(np.float32)


def _mad(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.abs(_f(a) - _f(b)).mean())


def block_diff(a: np.ndarray, b: np.ndarray, shift: int = 2) -> np.ndarray:
    """Per-block mean |a - b|, taking the best of a few small shifts so that ordinary motion in the
    shot does not count as a different picture."""
    a, b = _f(a), _f(b)
    h, w = a.shape
    best = None
    for dx, dy in ((0, 0), (shift, 0), (-shift, 0), (0, shift), (0, -shift)):
        bs = np.roll(b, (dy, dx), axis=(0, 1))
        d = cv2.resize(np.abs(a - bs)[shift:h - shift, shift:w - shift], GRID, interpolation=cv2.INTER_AREA)
        best = d if best is None else np.minimum(best, d)
    return best


def motion_explains(a: np.ndarray, b: np.ndarray) -> bool:
    """True when b is (mostly) a warped copy of a (zoom/pan/subject motion), i.e. the change
    between them is movement rather than new content."""
    a8 = np.clip(a, 0, 255).astype(np.uint8)
    b8 = np.clip(b, 0, 255).astype(np.uint8)
    flow = cv2.calcOpticalFlowFarneback(a8, b8, None, 0.5, 3, 9, 3, 5, 1.1, 0)
    h, w = a8.shape
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    warped = cv2.remap(b8, gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    m = 4  # ignore borders
    before = float(np.abs(_f(b8) - _f(a8))[m:-m, m:-m].mean())
    after = float(np.abs(_f(warped) - _f(a8))[m:-m, m:-m].mean())
    return after < 0.45 * before


def same_structure(a: np.ndarray, b: np.ndarray) -> bool:
    """The two frames show the same scene under different light (a lamp switched on, an exposure ramp, a
    colour flash over the picture): block by block the detail still lines up once brightness is taken out."""
    a, b = _f(a), _f(b)
    h, w = a.shape
    by, bx = max(4, h // GRID[1]), max(4, w // GRID[0])
    good = total = 0
    for y in range(0, h - by + 1, by):
        for x in range(0, w - bx + 1, bx):
            p, q = a[y:y + by, x:x + bx], b[y:y + by, x:x + bx]
            sp, sq = float(p.std()), float(q.std())
            if sp < 4 or sq < 4:
                continue  # flat block: nothing to line up
            total += 1
            good += float(((p - p.mean()) * (q - q.mean())).mean() / (sp * sq)) > 0.6
    return total >= 6 and good / total > 0.5


def progress(T: list[np.ndarray], s: int, e: int, lo: int, hi: int) -> np.ndarray:
    """For frames lo..hi: 0 = the picture at frame s, 1 = the picture at frame e."""
    A, B = _f(T[s]), _f(T[e])
    out = np.empty(hi - lo + 1, np.float32)
    for k, m in enumerate(range(lo, hi + 1)):
        M = _f(T[m])
        da, db = float(np.abs(M - A).mean()), float(np.abs(M - B).mean())
        out[k] = da / (da + db + 1e-6)
    return out


def _tight(u: np.ndarray, lo: int) -> tuple[int, int, int]:
    """(last frame still the old picture, first frame fully the new one, frame where the new one takes over)."""
    half = int(np.argmax(u >= 0.5))
    s = half
    while s > 0 and u[s - 1] > 0.12:
        s -= 1
    e = half
    while e < len(u) - 1 and u[e] < 0.88:
        e += 1
    return lo + max(0, s - 1), lo + e, lo + half


def find_gradual(T: list[np.ndarray], fps: float, taken: list[int]) -> list[tuple[int, int, int]]:
    """Transitions with no hard cut inside: (start frame, end frame, boundary frame). `taken`: boundaries
    already found; windows around them are left alone."""
    n = len(T)
    small = [cv2.resize(t, (12, 16), interpolation=cv2.INTER_AREA).astype(np.float32) for t in T]  # block means: small motion averages out
    found: list[tuple[int, int, int]] = []
    for sec in GRADUAL_SECONDS:
        L = max(4, int(round(sec * fps)))
        pad = max(3, L // 2)
        for s in range(pad, n - L - pad, max(1, L // 5)):
            e = s + L
            if any(s - pad <= b <= e + pad for b in taken) or any(a - pad <= s + L // 2 <= z + pad for a, z, _ in found):
                continue
            dab = float(np.abs(small[s] - small[e]).mean())
            if dab < 10:
                continue  # the two ends look alike at a glance
            # steady before and after, relative to how much changes across the window
            if (float(np.abs(small[s - pad] - small[s]).mean()) > PLATEAU * dab
                    or float(np.abs(small[e + pad] - small[e]).mean()) > PLATEAU * dab):
                continue
            bd = block_diff(T[s], T[e])
            if float((bd > max(10.0, 0.5 * float(np.median(bd)))).mean()) < MIN_CHANGED:
                continue  # part of the picture changes: someone walks in, a panel opens
            if same_structure(T[s], T[e]) or motion_explains(_f(T[s]), _f(T[e])):
                continue
            if min(float(T[s].std()), float(T[e].std())) < 12.0:
                continue  # one end is an empty page: things fading in or out on a plain ground, not a change of shot
            u = progress(T, s, e, s - pad, e + pad)
            if float(u[:pad].max()) > 0.3 or float(u[-pad:].min()) < 0.7:
                continue
            a, z, mid = _tight(u, s - pad)
            # still the same story on the tight span: steady just outside it
            ra, rz = max(0, a - max(2, (z - a) // 2)), min(n - 1, z + max(2, (z - a) // 2))
            d2 = _mad(T[a], T[z])
            if _mad(T[ra], T[a]) > PLATEAU * d2 or _mad(T[rz], T[z]) > PLATEAU * d2:
                continue
            found.append((a, z, mid))
    return found


def _detail(t: np.ndarray) -> float:
    gx, gy = _grad(t)
    return gx + gy


def _active_span(T: list[np.ndarray], s: int, e: int, fps: float, lo: int, hi: int) -> tuple[int, int]:
    """Widen (s, e) (last old frame, first new frame; b - 1, b for a hard cut at b) over the frames on either
    side that are not their shot's normal picture: changing much faster than the shot usually does (the travel
    of a whip, a zoom punch, a shake), much softer than it usually is (a defocus into the cut), or flat (the
    black or white a fade passes through, with the ramp on its far side). A cut inside a fight keeps its one
    frame: the shot is that busy everywhere."""
    far, reach = max(2, int(round(0.2 * fps))), int(round(1.5 * fps))

    def change(m: int) -> float:
        return _mad(T[m], T[m - 1])

    def flat(m: int) -> bool:
        return float(T[m].std()) < 8.0

    s0, e0 = s, e
    while s - 1 > lo and s0 - s < reach and flat(s):
        s -= 1
    if flat(s):
        s = s0  # flat as far back as we look: the old shot is a plain card, not something a fade passes through
    while e + 1 < hi and e - e0 < reach and flat(e):
        e += 1
    if flat(e):
        e = e0
    s1, e1 = s, e
    old = list(range(max(lo + 1, s1 + 1 - reach), s1 + 1 - far))
    if len(old) >= 3:
        level = float(np.median([change(m) for m in old]))
        thr = max(2.5 * level, level + 1.0)
        soft = 0.6 * float(np.median([_detail(T[m]) for m in old]))
        while s - 1 > lo and s1 - s < reach and (change(s) > thr or _detail(T[s]) < soft):
            s -= 1
    new = list(range(e1 + far + 1, min(hi, e1 + reach) + 1))
    if len(new) >= 3:
        level = float(np.median([change(m) for m in new]))
        thr = max(2.5 * level, level + 1.0)
        soft = 0.6 * float(np.median([_detail(T[m]) for m in new]))
        while e + 1 < hi and e - e1 < reach and (change(e + 1) > thr or _detail(T[e]) < soft):
            e += 1
    return max(lo, s), min(hi, e)


def span(T: list[np.ndarray], b: int, fps: float, lo: int, hi: int, kind: str = "cut") -> tuple[int, int]:
    """Frames over which the boundary at b turns the old shot into the new one: (last old frame, first new
    frame). A hard cut gives (b - 1, b). lo / hi: the neighbouring boundaries (the span stays between them).
    A cut is measured by how long the picture stays unusually busy around it. A gradual transition by the
    smallest window around b that has the old picture holding before it, the new one holding after it, and
    the whole ramp inside (inside a longer ramp the frames outside a window keep changing, and the ramp runs
    up to the window's edges: too small a window does not qualify)."""
    if kind in ("cut", "jump"):
        return _active_span(T, b - 1, b, fps, lo, hi)
    best = None
    for sec in SPAN_SECONDS:
        w = max(2, int(round(sec * fps)))
        s, e = max(lo, b - w), min(hi, b + w - 1)
        p = max(2, min(w, int(round(0.2 * fps))))
        a, z = max(lo, s - p), min(hi, e + p)
        if s >= e or a == s or z == e:
            break  # no room left to look outside the window
        dab = _mad(T[s], T[e]) + 1e-6
        if (max(_mad(T[i], T[s]) for i in range(a, s)) > SPAN_PLATEAU * dab
                or max(_mad(T[i], T[e]) for i in range(e + 1, z + 1)) > SPAN_PLATEAU * dab):
            continue
        inner = progress(T, s, e, s, e)
        k = int(np.argmax(inner >= 0.5))
        i = k
        while i > 0 and inner[i - 1] > 0.12:
            i -= 1
        j = k
        while j < len(inner) - 1 and inner[j] < 0.88:
            j += 1
        best = (s + max(0, i - 1), s + j)
        if i >= 2 and j <= len(inner) - 3:
            break  # the ramp starts and ends inside the window: this is all of it
    return best or _active_span(T, b - 1, b, fps, lo, hi)


# ------------------------------------------------------------------ what kind ------------------------------------

def _compose(A: np.ndarray, B: np.ndarray, mode: str, direction: str, d: int) -> np.ndarray:
    """The frame a straight-edge transition shows when the edge has travelled d pixels. direction: the way
    the edge (and whatever moves) travels. mode: wipe (nothing moves), push (both pictures move), cover (the
    new picture slides in over the old one), reveal (the old picture slides away off the new one)."""
    if direction in ("up", "down"):
        return _compose(A.T, B.T, mode, "left" if direction == "up" else "right", d).T
    if direction == "right":
        return _compose(A[:, ::-1], B[:, ::-1], mode, "left", d)[:, ::-1]
    w = A.shape[1]
    P = np.empty_like(A)
    if d <= 0:
        return A.copy()
    if d >= w:
        return B.copy()
    P[:, :w - d] = A[:, d:] if mode in ("push", "reveal") else A[:, :w - d]
    P[:, w - d:] = B[:, :d] if mode in ("push", "cover") else B[:, w - d:]
    return P


def _edge_fit(A: np.ndarray, B: np.ndarray, mids: list[np.ndarray]) -> dict | None:
    """Best straight-edge explanation of the in-between frames, or None."""
    dab = float(np.abs(A - B).mean()) + 1e-6
    best = None
    for direction in DIRECTIONS:
        size = A.shape[1] if direction in ("left", "right") else A.shape[0]
        steps = np.unique(np.linspace(0, size, num=min(size + 1, 33)).astype(int))
        for mode in ("wipe", "push", "cover", "reveal"):
            frames = [_compose(A, B, mode, direction, int(d)) for d in steps]
            res, pos = [], []
            for M in mids:
                errs = [float(np.abs(M - P).mean()) for P in frames]
                k = int(np.argmin(errs))
                res.append(errs[k] / dab)
                pos.append(steps[k] / size)
            r = float(np.median(res))
            # nothing moving is the simpler reading: a moving mode has to fit clearly better to be chosen over it
            if best is None or r < best["resid"] * (0.8 if best["mode"] == "wipe" and mode != "wipe" else 1.0):
                best = {"mode": mode, "direction": direction, "resid": r, "pos": pos}
    if best is None or best["resid"] > 0.38:
        return None
    pos = np.array(best["pos"])
    if len(pos) >= 3 and (float(np.corrcoef(pos, np.arange(len(pos)))[0, 1]) < 0.8 or pos[-1] - pos[0] < 0.3):
        return None  # the edge has to travel across the frame
    return best


def _blend_fit(A: np.ndarray, B: np.ndarray, mids: list[np.ndarray]) -> tuple[float, bool]:
    """(median residual of 'frame = A + alpha (B - A)', alpha rises through the span)."""
    D = B - A
    denom = float((D * D).sum()) + 1e-6
    scale = float(np.abs(D).mean()) + 1e-6
    res, alphas = [], []
    for M in mids:
        alpha = float(((M - A) * D).sum() / denom)
        alphas.append(alpha)
        res.append(float(np.abs(M - (A + alpha * D)).mean()) / scale)
    al = np.array(alphas)
    rising = len(al) < 3 or (float(np.corrcoef(al, np.arange(len(al)))[0, 1]) > 0.85 and al[0] < 0.6 and al[-1] > 0.4)
    return float(np.median(res)), bool(rising)


def _region_fit(A: np.ndarray, B: np.ndarray, mids: list[np.ndarray]) -> dict | None:
    """Wipes of any shape: block by block every in-between frame is the old picture or the new one, and the
    new part grows. Direction from the order in which the blocks turn."""
    dab = block_diff(A, B)
    sig = dab > max(10.0, 0.5 * float(np.median(dab)))
    if sig.mean() < 0.4 or len(mids) < 2:
        return None
    pure, new = [], []
    for M in mids:
        da, db = block_diff(M, A), block_diff(M, B)
        pure.append(float((np.minimum(da, db)[sig] < 0.4 * dab[sig]).mean()))
        new.append(db < da)
    share = [float(v[sig].mean()) for v in new]
    # judged where the two pictures share the frame: half-way through a dissolve no block is the old picture
    # or the new one, however clean the first and last frames look
    central = [p for p, u in zip(pure, share) if 0.2 < u < 0.8] or pure
    if min(central) < 0.6 or float(np.percentile(pure, 20)) < 0.7 or share[-1] - share[0] < 0.3:
        return None
    flips = np.diff(np.array(new, np.int8), axis=0)
    if float((flips < 0).any(axis=0)[sig].mean()) > 0.2:
        return None  # blocks turn once and stay
    when = np.array(new, np.float32).argmax(axis=0).astype(np.float32)  # first in-between frame showing the new picture
    when[~np.array(new).any(axis=0)] = len(mids)
    gh, gw = when.shape
    ys, xs = np.mgrid[0:gh, 0:gw].astype(np.float32)
    rad = np.hypot((xs - (gw - 1) / 2) / gw, (ys - (gh - 1) / 2) / gh)

    def corr(v: np.ndarray) -> float:
        a, b = when[sig], v[sig]
        return float(np.corrcoef(a, b)[0, 1]) if a.std() > 0 and b.std() > 0 else 0.0

    cx, cy, cr = corr(xs), corr(ys), corr(rad)
    direction = ""
    if max(abs(cx), abs(cy), abs(cr)) >= 0.55:
        if abs(cr) >= max(abs(cx), abs(cy)):
            direction = "center_out" if cr > 0 else "edges_in"
        elif min(abs(cx), abs(cy)) >= 0.45:
            direction = "diagonal"
        elif abs(cx) > abs(cy):
            direction = "right" if cx > 0 else "left"
        else:
            direction = "down" if cy > 0 else "up"
    return {"direction": direction, "pure": float(np.median(pure))}


def _similarity(a: np.ndarray, b: np.ndarray) -> tuple[float, float, float, float] | None:
    """Camera motion from a to b as (log scale, rotation in degrees, dx, dy as shares of the frame), or None
    when too little can be tracked."""
    pts = cv2.goodFeaturesToTrack(a, 80, 0.01, 4)
    if pts is None or len(pts) < 10:
        return None
    nxt, st, _ = cv2.calcOpticalFlowPyrLK(a, b, pts, None, winSize=(15, 15), maxLevel=2)
    ok = st.ravel() == 1
    if ok.sum() < 10:
        return None
    M, inl = cv2.estimateAffinePartial2D(pts[ok], nxt[ok], ransacReprojThreshold=2.0)
    if M is None or inl is None or float(inl.mean()) < 0.5:
        return None
    h, w = a.shape
    c = np.array([w / 2, h / 2, 1.0])
    moved = M @ c
    return (float(np.log(np.hypot(M[0, 0], M[1, 0]) + 1e-9)), float(np.degrees(np.arctan2(M[1, 0], M[0, 0]))),
            float((moved[0] - c[0]) / w), float((moved[1] - c[1]) / h))


def _grad(t: np.ndarray) -> tuple[float, float]:
    g = _f(t)
    return float(np.abs(np.diff(g, axis=1)).mean()), float(np.abs(np.diff(g, axis=0)).mean())


def _motion(T: list[np.ndarray], s: int, e: int) -> dict:
    """What moves and blurs inside the span: detail left at the blurriest frame (rx across, ry down, 1 = as
    sharp as outside), summed camera motion between consecutive frames (zoom as |log scale|, rot / turn in
    degrees, path and net travel as shares of the frame), and frames that swing back towards the old picture."""
    n = len(T)
    outside = [i for i in list(range(max(0, s - 6), s)) + list(range(e + 1, min(n, e + 7)))] or [s, e]
    gx0, gy0 = (float(np.median(v)) + 1e-6 for v in zip(*[_grad(T[i]) for i in outside]))
    g = [_grad(T[i]) for i in (list(range(s + 1, e)) or [s])]
    f = {"rx": min(v[0] for v in g) / gx0, "ry": min(v[1] for v in g) / gy0, "zoom": 0.0, "rot": 0.0, "turn": 0.0, "path": 0.0,
         "tracked": 0}
    net = np.zeros(2)
    for i in range(max(0, s - 1), min(n - 1, e + 1)):
        m = _similarity(T[i], T[i + 1])
        if m is None:
            continue
        f["tracked"] += 1
        f["zoom"] += abs(m[0])
        f["rot"] += abs(m[1])
        f["turn"] += m[1]
        f["path"] += float(np.hypot(m[2], m[3]))
        net += (m[2], m[3])
    f["net"] = float(np.hypot(*net))
    f["heading"] = ("left" if net[0] < 0 else "right") if abs(net[0]) > abs(net[1]) else ("up" if net[1] < 0 else "down")
    f["back"] = int((np.diff(progress(T, s, e, s, e)) < -0.25).sum())
    # hard switches inside the span: frames that differ from the one before by half of the whole change
    whole = _mad(T[s], T[e]) + 1e-6
    f["jumps"] = int(sum(_mad(T[m], T[m - 1]) > 0.5 * whole for m in range(s + 1, e + 1)))
    # soft on both sides of the switch (out of focus and back), not only running into it
    inside = list(range(s + 1, e)) or [s]
    half = max(1, len(inside) // 2)
    base = gx0 + gy0
    f["soft_both"] = (min(_detail(T[i]) for i in inside[:half]) < 0.6 * base
                      and min(_detail(T[i]) for i in inside[half:] or inside[-1:]) < 0.6 * base)
    return f


def _moving_kind(f: dict) -> dict | None:
    """Effects that hide the cut in camera movement: spin / zoom / whip / shake, and a glitch of several
    displaced frames."""
    calm = f["path"] < 0.3 and f["zoom"] < 0.3 and f["rot"] < 20
    # several hard switches with the picture swinging back to the old shot in between (two cuts in a row never go back)
    if (f["back"] >= 2 or (f["back"] >= 1 and f["jumps"] >= 2)) and calm:
        return {"type": "glitch"}
    if f["rot"] >= 25 and abs(f["turn"]) >= 0.7 * f["rot"]:
        return {"type": "spin"}
    if f["zoom"] >= 0.5:
        return {"type": "zoom"}
    if f["net"] >= 0.3 and f["path"] < 1.5 * f["net"] and min(f["rx"], f["ry"]) < 0.7:
        return {"type": "whip", "direction": f["heading"]}
    if f["path"] >= 0.4 and f["path"] > 3 * f["net"] and f["tracked"] >= 3:
        return {"type": "shake"}
    return None


def classify(T: list[np.ndarray], s: int, e: int, fps: float, found_as: str) -> dict:
    """Kind of the transition over frames s..e (s: last old frame, e: first new frame). found_as: what the
    detector called the boundary (cut / jump / fade / dissolve / wipe / gradual)."""
    A, B = _f(T[s]), _f(T[e])
    inner = list(range(s + 1, e))
    if len(inner) < 2:
        return {"type": found_as if found_as != "gradual" else "cut"}
    pick = [inner[i] for i in np.unique(np.linspace(0, len(inner) - 1, num=min(9, len(inner))).astype(int))]
    mids = [_f(T[i]) for i in pick]
    flat = [M for M in mids if float(M.std()) < 8.0]
    level = float(np.mean([M.mean() for M in flat])) if flat else 128.0
    if flat and (level < 45 or level > 210) and float(A.std()) > 12 and float(B.std()) > 12:
        # a fade dims or bleaches the picture in place: the frames on the way are still the old shot (or already the
        # new one), only darker. A whip through a dark corner or a hand over the lens also passes through flat
        # frames, but the picture is gone before it gets there
        ramp = [M for M in mids if float(M.std()) >= 12.0]
        kept = sum(same_structure(M, A) or same_structure(M, B) for M in ramp)
        if not ramp or kept >= 0.5 * len(ramp) or found_as == "fade":
            return {"type": "fade", "via": "white" if level > 210 else "black"}
    elif found_as == "fade":
        return {"type": "fade", "via": "white" if level > 210 else "black"}
    peak = max(float(M.mean()) for M in mids)
    if e - s >= 0.15 * fps and peak > 170 and peak > max(float(A.mean()), float(B.mean())) + 50:
        return {"type": "flash"}  # burns up to (near) white and the next shot comes out of it: a flash or light-leak transition
    if found_as in ("cut", "jump", "burst") and e - s < MIN_EFFECT_S * fps:
        return {"type": found_as if found_as != "burst" else "cut"}  # too short for an editor's effect around a cut
    edge = _edge_fit(A, B, mids)
    resid, rising = _blend_fit(A, B, mids)

    def edged() -> dict:
        if edge["mode"] == "wipe":
            return {"type": "wipe", "direction": edge["direction"]}
        return {"type": "slide", "mode": edge["mode"], "direction": edge["direction"]}

    region = _region_fit(A, B, mids)
    iris = bool(region) and region["direction"] in ("center_out", "edges_in")
    if iris and not (edge and edge["resid"] < 0.1):
        return {"type": "wipe", "direction": region["direction"]}  # grows from, or closes on, the middle: no straight edge does that
    if edge and edge["resid"] < 0.25 and edge["resid"] < 0.6 * resid:
        return edged()  # a straight edge crossing the frame explains every in-between frame
    f = _motion(T, s, e)
    m = _moving_kind(f)
    if m:
        return m
    if max(f["rx"], f["ry"]) < 0.5 and f["soft_both"]:
        return {"type": "blur"}  # detail gone in both directions, nothing travelling: out of focus and back
    if region:  # every in-between frame is old or new block by block (in a dissolve the middle frames are neither)
        if edge and edge["resid"] < 0.8 * resid and not region["direction"]:
            return edged()
        return {"type": "wipe", **({"direction": region["direction"]} if region["direction"] else {})}
    if resid < 0.25 and rising and (not edge or resid <= edge["resid"]):
        return {"type": "dissolve"}
    if edge and edge["resid"] < 0.8 * resid:
        return edged()
    if f["back"] >= 1 and f["path"] < 0.3 and f["zoom"] < 0.3:
        return {"type": "glitch"}
    if flat or (min(f["rx"], f["ry"]) < 0.35 and f["soft_both"]):
        return {"type": "blur"}  # down to a flat or smeared frame that is neither black nor white
    if found_as in ("cut", "jump", "dissolve", "wipe"):
        return {"type": found_as}
    return {"type": "cut" if found_as == "burst" else "effect"}


TOUCH_GAP_S = 0.4      # two boundaries whose spans run into each other are one transition only when this close
BURST_GAP_S = 0.6      # cuts closer than this with the picture churning all the way between them are one effect
BURST_BUSY = 0.35      # ... churning: every frame in between differs from the one before by this share of the whole change
REPLACING = ("fade", "flash", "dissolve", "wipe", "slide")  # the new picture replaces the old one with no cut needed
SPECIFIC = REPLACING + ("whip", "zoom", "spin", "blur", "glitch", "shake")


def _one_move(T: list[np.ndarray], s: int, e: int) -> bool:
    """The picture gets from frame s to frame e in steps that are each a small warp of the one before: a push-in
    on a page, a pull back, a focus pull. Each step of a wipe or a dissolve brings in picture that was not
    there, which no warp explains."""
    picks = np.unique(np.linspace(s, e, num=min(8, e - s + 1)).astype(int))
    return all(_mad(T[i], T[j]) < 1.5 or motion_explains(_f(T[i]), _f(T[j])) for i, j in zip(picks, picks[1:]))


def _burst_link(T: list[np.ndarray], fps: float, first: int, prev: int, b: int) -> bool:
    """Two hard cuts that may be one effect seen as several jumps (a fast slide, a glitch, a strobe of displaced
    frames): between two real cuts the picture holds still for at least a frame, inside an effect it never does."""
    if not 2 <= b - prev <= BURST_GAP_S * fps:
        return b - prev == 1
    whole = _mad(T[max(0, first - 1)], T[b]) + 1e-6
    return min(_mad(T[m], T[m - 1]) for m in range(prev + 1, b)) > BURST_BUSY * whole


def resolve(T: list[np.ndarray], fps: float, boundaries: dict[int, tuple[str, float]],
            spans: dict[int, tuple[int, int]]) -> dict[int, tuple[dict, float]]:
    """Describe every boundary: {frame: ({"type", "start_frame", "end_frame", ...}, strength)}.
    - Boundaries that are parts of one transition become one (the several jumps of a fast slide or a glitch, the
      two sides of a fade through black, a cut found inside an effect that also shows as a ramp), but only when
      the joined span reads as a known kind of transition; otherwise they stay separate cuts.
    - A boundary that came from find_gradual (keys of `spans`) has no cut to stand on: it is kept only when its
      span reads as a fade, dissolve, wipe or slide. A push-in or a whip inside one take is camera work."""
    n = len(T)
    order = sorted(boundaries)
    items: list[dict] = []
    for i, b in enumerate(order):
        kind, strength = boundaries[b]
        lo = order[i - 1] if i else 0
        hi = order[i + 1] - 1 if i + 1 < len(order) else n - 1
        if kind in ("cut", "jump"):
            # boundaries right next to this one may be more jumps of the same effect, so the span may run past
            # them (and the shot's normal pace is read from beyond them); a boundary further away is another shot
            near = TOUCH_GAP_S * fps
            far_lo = max([o for o in order[:i] if b - o > near], default=0)
            far_hi = min([o for o in order[i + 1:] if o - b > near], default=n) - 1
            s, e = _active_span(T, b - 1, b, fps, far_lo, far_hi)
        else:
            s, e = spans.get(b) or span(T, b, fps, lo, hi, kind)
        items.append({"b": b, "kind": kind, "strength": strength, "s": max(0, s), "e": min(n - 1, e), "gradual": b in spans})
    chains: list[list[dict]] = []
    for it in items:
        if chains:
            c = chains[-1]
            p = c[-1]
            cuts = p["kind"] in ("cut", "jump") and it["kind"] in ("cut", "jump")
            burst = cuts and _burst_link(T, fps, c[0]["b"], p["b"], it["b"])
            touching = (it["s"] <= p["e"] + 1 and (p["e"] - p["s"] > 1 or it["e"] - it["s"] > 1)
                        and it["b"] - p["b"] <= TOUCH_GAP_S * fps)
            flat = (not touching and 0 < it["s"] - p["e"] <= 2.5 * fps
                    and all(float(T[k].std()) < 8.0 for k in range(p["e"], it["s"] + 1)))
            if burst or touching or flat:
                it["link"] = "flat" if flat else ("burst" if burst else "touching")
                c.append(it)
                continue
        chains.append([it])
    out: dict[int, tuple[dict, float]] = {}

    def emit(b: int, d: dict, s: int, e: int, strength: float) -> None:
        d.update(start_frame=min(s, b - 1), end_frame=max(e, b))
        out[b] = (d, strength)

    def takeover(d: dict, s: int, e: int, b: int) -> int:
        """Where the new shot starts: where its picture takes over; after a fade through a flat frame, where it comes up."""
        if e - s <= 2:
            return b
        if d["type"] == "fade":
            flat = [k for k in range(s, e + 1) if float(T[k].std()) < 8.0]
            return min(e, flat[-1] + 1) if flat else b
        return min(max(s + int(np.argmax(progress(T, s, e, s, e) >= 0.5)), s + 1), e)

    for ci, c in enumerate(chains):
        lo = chains[ci - 1][-1]["b"] if ci else 0
        hi = chains[ci + 1][0]["b"] - 1 if ci + 1 < len(chains) else n - 1
        if len(c) > 1:
            s, e = c[0]["s"], max(x["e"] for x in c)
            if any(x.get("link") == "burst" for x in c):
                s, e = _active_span(T, min(s, c[0]["b"] - 1), max(e, c[-1]["b"]), fps, lo, hi)
            s, e = max(s, lo), min(e, hi)  # never across a neighbouring boundary
            through_flat = any(x.get("link") == "flat" for x in c) or any(x["kind"] == "fade" for x in c)
            ramps = any(x["kind"] not in ("cut", "jump") for x in c)  # a gradual detector saw it too
            d = classify(T, s, e, fps, "fade" if through_flat else ("gradual" if ramps else "burst"))
            if d["type"] not in REPLACING + ("glitch",):
                # movement or blur hides one cut. Two hard switches are two cuts with a short shot between them
                # (a few dark, blurred frames of an insert look just like the middle of a blur transition)
                whole = _mad(T[s], T[e]) + 1e-6
                if sum(_mad(T[m], T[m - 1]) > 0.5 * whole for m in range(s + 1, e + 1)) >= 2:
                    d = {"type": "cut"}
            if d["type"] in SPECIFIC:
                b = takeover(d, s, e, c[-1]["b"])
                emit(b, d, s, e, max(x["strength"] for x in c))
                continue
        for k, x in enumerate(c):  # on its own
            lo = c[k - 1]["b"] if k else (chains[ci - 1][-1]["b"] if ci else 0)
            hi = c[k + 1]["b"] - 1 if k + 1 < len(c) else (chains[ci + 1][0]["b"] - 1 if ci + 1 < len(chains) else n - 1)
            d = classify(T, x["s"], x["e"], fps, x["kind"])
            if x["gradual"] and (d["type"] not in REPLACING or (d["type"] in ("wipe", "dissolve") and _one_move(T, x["s"], x["e"]))):
                continue
            # the span may have run past a neighbouring boundary that turned out to be its own cut: report the part
            # on this side of it
            x["s"], x["e"] = min(max(x["s"], lo), x["b"] - 1), max(min(x["e"], hi), x["b"])
            if d["type"] not in SPECIFIC and x["kind"] in ("cut", "jump") and x["e"] - x["s"] > 1:
                x["s"], x["e"] = x["b"] - 1, x["b"]  # a cut in a busy stretch: nothing to say about the frames around it
            emit(x["b"], d, x["s"], x["e"], x["strength"])
    return out
