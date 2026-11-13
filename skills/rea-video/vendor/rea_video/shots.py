"""Shot boundary detection: hard cuts, fades through black/white, dissolves, wipes.

Works on tiny thumbnails of every frame (cheap) and combines a colour-histogram
distance with a pixel difference so lighting flicker and fast motion do not fire
spurious cuts. Thresholds are adaptive to the local activity level."""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .media import VideoInfo, frame_times, iter_frames
from .transitions import block_diff as _block_diff, crop_box, find_gradual, motion_explains as _motion_explains, resolve, same_structure

THUMB_W = 96
# jump cuts (same camera, subject jumps): share of the frame that changes, how far above the frames on both
# sides, frames on each side that must stay quiet, and how little the picture may drift back (see _returns)
JUMP_MIN_CHANGED, JUMP_RATIO, JUMP_QUIET, JUMP_MIN_RETURN = 0.17, 2.5, 2, 0.7
SHORT_SHOT_S = 0.12  # shortest shot kept between two clean hard cuts (4 frames at 30 fps)


@dataclass
class FrameTrack:
    fps: float
    hist_dist: np.ndarray       # bhattacharyya distance to previous frame (0..1)
    pix_diff: np.ndarray        # mean |diff| of gray thumbs, 0..1
    changed: np.ndarray         # fraction of thumb pixels that changed noticeably
    luma: np.ndarray            # mean luma 0..255
    thumbs: list[np.ndarray] = field(repr=False, default_factory=list)  # small gray thumbs, uint8 (for dissolve check)
    hists: list[np.ndarray] = field(repr=False, default_factory=list)
    times: np.ndarray | None = field(repr=False, default=None)  # per-frame pts (s) for variable frame rate; None = i / fps

    @property
    def n(self) -> int:
        return len(self.luma)


@dataclass
class Shot:
    index: int
    start_frame: int
    end_frame: int  # exclusive
    fps: float
    transition_in: str = "cut"
    boundary_score: float = 0.0
    beats: list[int] = field(default_factory=list)  # frame indices of MG/slide beat changes inside the shot
    flash_s: float = 0.0  # "flash" transitions: how long the white / grey flash takes to decay
    times: np.ndarray | None = field(repr=False, default=None)  # FrameTrack.times
    # how this shot is entered: {"type", "start_frame", "end_frame", "direction"?, "via"?, "mode"?} (transitions.py)
    transition: dict = field(default_factory=dict)

    def t(self, frame: int) -> float:
        """Time of a frame index. Variable-frame-rate video uses the real pts; past the last frame,
        one median frame interval after it."""
        if self.times is None:
            return frame / self.fps
        if frame < len(self.times):
            return float(self.times[frame])
        step = float(np.median(np.diff(self.times))) if len(self.times) > 1 else 1 / self.fps
        return float(self.times[-1]) + step * (frame - len(self.times) + 1)

    @property
    def start(self) -> float:
        return self.t(self.start_frame)

    @property
    def end(self) -> float:
        return self.t(self.end_frame)

    @property
    def duration(self) -> float:
        return self.end - self.start

    def transition_dict(self) -> dict:
        """The transition into this shot with times, or {} for a plain cut."""
        tr = self.transition
        if not tr or self.transition_in in ("start", "cut", "jump"):
            return {}
        a, z = self.t(tr["start_frame"] + 1), self.t(tr["end_frame"])
        if self.flash_s:  # a cut that opens bright and settles
            a, z = self.start, self.start + self.flash_s
        return {"type": self.transition_in, "start": round(a, 3), "end": round(max(a, z), 3), "duration": round(max(0.0, z - a), 3),
                **{k: tr[k] for k in ("direction", "via", "mode") if tr.get(k)}}

    def to_dict(self) -> dict:
        tr = self.transition_dict()
        return {"index": self.index, "start": round(self.start, 3), "end": round(self.end, 3),
                "duration": round(self.duration, 3), "start_frame": self.start_frame, "end_frame": self.end_frame,
                "transition_in": self.transition_in, "boundary_score": round(self.boundary_score, 3),
                "beats": [round(self.t(b), 3) for b in self.beats]} | ({"flash_s": round(self.flash_s, 2)} if self.flash_s else {}) \
            | ({"transition": tr} if tr else {})


def _hist(bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h = cv2.calcHist([hsv], [0, 1, 2], None, [16, 4, 4], [0, 180, 0, 256, 0, 256])
    cv2.normalize(h, h, alpha=1.0, norm_type=cv2.NORM_L1)
    return h.flatten().astype(np.float32)


def build_track(path: str, info: VideoInfo) -> FrameTrack:
    hist_d, pix_d, chg, luma, thumbs, hists = [], [], [], [], [], []
    prev_h = prev_g = None
    for bgr in iter_frames(path, info, THUMB_W):
        g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
        h = _hist(bgr)
        if prev_h is None:
            hist_d.append(0.0)
            pix_d.append(0.0)
            chg.append(0.0)
        else:
            d = np.abs(g - prev_g)
            hist_d.append(float(cv2.compareHist(prev_h, h, cv2.HISTCMP_BHATTACHARYYA)))
            pix_d.append(float(d.mean() / 255.0))
            thr = max(6.0, 0.35 * float(min(g.std(), prev_g.std())))
            chg.append(float((d > thr).mean()))
        luma.append(float(g.mean()))
        thumbs.append(g.astype(np.uint8))  # lossless (gray of uint8 frames); 4x less memory on long videos
        hists.append(h)
        prev_h, prev_g = h, g
    fps = info.fps if info.fps > 0 else 30.0
    return FrameTrack(fps=fps, hist_dist=np.array(hist_d), pix_diff=np.array(pix_d), changed=np.array(chg), luma=np.array(luma),
                      thumbs=thumbs, hists=hists, times=frame_times(path, len(luma), fps))


def _local_median(x: np.ndarray, radius: int) -> np.ndarray:
    out = np.empty_like(x)
    n = len(x)
    for i in range(n):
        lo, hi = max(0, i - radius), min(n, i + radius + 1)
        window = np.concatenate([x[lo:i], x[i + 1:hi]]) if hi - lo > 1 else x[lo:hi]
        out[i] = np.median(window) if len(window) else 0.0
    return out


def detect_shots(track: FrameTrack, min_shot_s: float = 0.35, cut_threshold: float = 0.30,
                 dissolve: bool = True) -> list[Shot]:
    n = track.n
    if n == 0:
        return []
    fps = track.fps
    score = 0.6 * track.hist_dist + 0.4 * np.clip(track.pix_diff * 4.0, 0, 1)
    score[0] = 0.0
    radius = max(4, int(round(fps * 0.5)))
    base = _local_median(score, radius)
    boundaries: dict[int, tuple[str, float]] = {}

    # 1) hard cuts: a spike well above local activity that changes most of the frame
    #    (a title popping in over a static layout changes only a region -> not a cut)
    chg = track.changed
    chg_base = _local_median(chg, radius)
    for i in range(1, n):
        s = score[i]
        strong = s > cut_threshold and s > base[i] * 2.5 + 0.06 and chg[i] > 0.25
        relative = chg[i] > 0.45 and chg[i] > chg_base[i] * 3 + 0.2 and s > base[i] * 4 + 0.03
        # a one-frame swap between two still layouts (slides / MG cards on the same ground): less of the frame
        # changes, but the colour distribution jumps and the picture before it is digitally frozen (pixel-identical
        # frames; a filmed screen whose content changes keeps sensor noise, 0.002-0.03, and is not a cut)
        still_swap = (s > cut_threshold and track.hist_dist[i] > 0.25 and chg[i] > 0.18 and chg_base[i] < 0.01
                      and s > base[i] * 5 + 0.1 and i >= 3 and float(track.pix_diff[i - 3:i].max()) < 1e-3)
        jump = _jump_cut(track, i)
        if strong or relative or still_swap or jump:
            # a muzzle flash / strobe, or the frame where a one- or two-frame flash or glitch ends: the picture
            # is back to what it was, so nothing was cut
            if _brief_flash(track, i) or _back_to_before(track.thumbs, i):
                continue
            # a jump cut keeps the camera setup: same colours, less than half the frame changes. Shots joined by
            # jump cuts are pieces of one take (one VLM look, one generation in the remake plan)
            same_take = jump and track.hist_dist[i] < 0.4 and chg[i] < 0.5
            boundaries[i] = ("jump" if same_take else "cut", float(max(s, chg[i])))

    # 2) fades through black / white: luma dips to an extreme and comes back
    lo_l = min(10.0, float(np.percentile(track.luma, 50)) * 0.35)
    dark = (track.luma < lo_l) | (track.luma > 248)
    i = 0
    while i < n:
        if dark[i]:
            j = i
            while j < n and dark[j]:
                j += 1
            # a fade passes through an (almost) uniform frame; a white page with a title on it is a shot, not a fade
            flat = min(float(track.thumbs[k].std()) for k in range(i, j)) < 4.0
            if 0 < i and j < n and (j - i) <= fps * 2.5 and flat:
                # boundary at the last extreme frame (next shot starts after fade-in begins)
                mid = j
                if not any(abs(mid - b) < radius for b in boundaries):
                    boundaries[mid] = ("fade", 0.5)
            i = j
        else:
            i += 1

    # 3) dissolves / cross-fades: frame i is a linear blend of frames i-k and i+k.
    #    (camera or subject motion also changes the picture over 2k frames, but the middle
    #    frame of a move is not a blend of its endpoints, so the blend residual separates them)
    y0, y1, x0, x1 = crop_box(track.thumbs, cuts=sum(1 for k, _ in boundaries.values() if k == "cut"))
    T = track.thumbs if (y0, x0, y1, x1) == (0, 0) + track.thumbs[0].shape else [t[y0:y1, x0:x1] for t in track.thumbs]
    if dissolve and n > 2 * fps:
        for k in sorted({max(2, int(round(fps * 0.12))), max(3, int(round(fps * 0.2))), max(5, int(round(fps * 0.45)))}):
            cand = []
            for i in range(k, n - k):
                A, B, M = (T[j].astype(np.float32) for j in (i - k, i + k, i))
                D = B - A
                thr = max(6.0, 0.35 * float(min(A.std(), B.std())))
                far = float((np.abs(D) > thr).mean())
                if far < 0.15 or float(score[i - k + 1:i + k + 1].max()) >= cut_threshold:
                    continue
                denom = float((D * D).sum())
                if denom <= 0:
                    continue
                alpha = float(((M - A) * D).sum() / denom)
                if not 0.2 <= alpha <= 0.8:
                    continue
                resid = float(np.abs(M - (A + alpha * D)).mean() / (np.abs(D).mean() + 1e-6))
                # a cross-fade is a burst of change; an animated gradient / colour morph is a blend of its
                # neighbours at every frame, at a steady rate, so require more change than in the windows around it
                if resid < 0.20 and not _steady_morph(T, i, k) and not _motion_explains(A, B) and not same_structure(A, B):
                    cand.append((i, resid, far))
            cand.sort(key=lambda t: t[1])
            for i, resid, far in cand:
                if all(abs(i - bnd) > 2 * k for bnd in boundaries):
                    boundaries[i] = ("dissolve", round(1 - resid, 3))

    # 4) wipes and other editor transitions (wipe / radial / clock / pixelate ...): the new shot replaces the old one
    #    region by region, so every in-between frame is old picture in some places and new picture in the others
    if dissolve and n > 2 * fps:
        for i, strength in _wipes(track, T, score, cut_threshold, boundaries):
            boundaries[i] = ("wipe", strength)

    # 5) any other transition without a hard cut inside (slides, shaped wipes, long or partial blends): a steady
    #    picture, a ramp, another steady picture. Then every boundary gets its span, kind and direction, and
    #    boundaries that are parts of one transition are joined
    spans: dict[int, tuple[int, int]] = {}
    if dissolve and n > 2 * fps:
        for a, z, mid in find_gradual(T, fps, sorted(boundaries)):
            if float(score[a + 1:z + 1].max()) < cut_threshold or z - a > 2:
                boundaries[mid] = ("gradual", 0.5)
                spans[mid] = (a, z)
    described = resolve(T, fps, boundaries, spans) if dissolve else {b: ({"type": k, "start_frame": b - 1, "end_frame": b}, v)
                                                                      for b, (k, v) in boundaries.items()}
    boundaries = {b: (d["type"], strength) for b, (d, strength) in described.items()}

    beat_marks = [b for b, _ in _mg_beats(track, boundaries, fps)]

    # assemble shots, enforce minimum length. Boundaries closer than that are one transition (a flash, a
    # blended frame, a whip) or a flash next to a cut: keep the strongest, not just the first, so a flash a few
    # frames before a cut does not swallow it. A very short shot survives when both of its cuts are clean
    # hard cuts (a 4-frame insert in a fast edit, a cover frame before the first shot).
    min_len = max(1, int(round(min_shot_s * fps)))
    short_len = max(1, int(round(SHORT_SHOT_S * fps)))
    kept: list[int] = []
    for b in sorted(boundaries):
        prev = kept[-1] if kept else 0
        gap = b - prev
        if gap >= min_len or (gap >= short_len and _clean_cut(boundaries, b) and (not kept or _clean_cut(boundaries, prev))
                              and float(track.changed[prev + 1:b].max(initial=0.0)) < 0.3):  # a held insert, not transition frames
            kept.append(b)
        elif kept and boundaries[b][1] > boundaries[prev][1] and b - (kept[-2] if len(kept) > 1 else 0) >= short_len:
            kept[-1] = b
    if kept and n - kept[-1] < min_len:
        kept.pop()  # a short tail joins the last shot
    shots: list[Shot] = []
    start, trans, bscore = 0, "start", 0.0
    for b in kept + [n]:
        shots.append(Shot(index=len(shots) + 1, start_frame=start, end_frame=b, fps=fps, transition_in=trans, boundary_score=bscore,
                          times=track.times))
        shots[-1].transition = described[start][0] if start in described else {}
        if b < n:
            trans, bscore = boundaries[b]
        start = b
    for shot in shots:
        shot.beats = [b for b in beat_marks if shot.start_frame + min_len <= b <= shot.end_frame - min_len]
        if shot.transition_in in ("cut", "flash"):
            shot.flash_s = _flash(track.luma, shot.start_frame, shot.end_frame, fps)
            if shot.flash_s:
                shot.transition_in = "flash"
    return shots


def _clean_cut(boundaries: dict[int, tuple[str, float]], b: int) -> bool:
    kind, strength = boundaries[b]
    return kind in ("cut", "jump") and strength >= 0.35


def _brief_flash(track: FrameTrack, i: int) -> bool:
    """A muzzle flash / strobe / light flicker: the frame is brighter than just before, the brightness is
    mostly gone two frames later, and the picture comes back. A flash transition into a new shot decays
    more slowly and reveals a different picture, so it stays a cut."""
    pre = float(track.luma[max(0, i - 3):i].min())
    rise = float(track.luma[i]) - pre
    if rise <= 5.0 or i + 2 >= track.n:
        return False
    return float(track.luma[i + 2]) - pre < 0.5 * rise and _returns(track.thumbs, i) < 0.6


def _back_to_before(thumbs: list[np.ndarray], i: int) -> bool:
    """Frame i looks like the picture two or three frames earlier again: the end of a flash or glitch
    of one or two frames, not a cut."""
    if i < 3:
        return False
    cur = thumbs[i].astype(np.float32)
    first = float(np.abs(cur - thumbs[i - 1].astype(np.float32)).mean()) + 1e-6
    return min(float(np.abs(cur - thumbs[j].astype(np.float32)).mean()) for j in (i - 3, i - 2)) < 0.3 * first


def _returns(thumbs: list[np.ndarray], i: int, span: int = 4) -> float:
    """How far the picture stays away after frame i, relative to the jump into frame i: ~1 for a cut
    (the new shot never looks like the old one), well below 1 when a flash or strobe fades back. The
    reference is any of the three frames before i, so the second frame of a two-frame flash also counts."""
    n = len(thumbs)
    if i < 1 or i + 1 >= n:
        return 1.0
    cur = thumbs[i].astype(np.float32)
    first = float(np.abs(cur - thumbs[i - 1].astype(np.float32)).mean()) + 1e-6
    best = float("inf")
    for j in range(max(0, i - 3), i):
        a = thumbs[j].astype(np.float32)
        jump = float(np.abs(cur - a).mean()) + 1e-6
        if jump < 0.2 * first:
            continue  # frame j already looks like frame i: not a reference for "before"
        later = min(float(np.abs(thumbs[k].astype(np.float32) - a).mean()) for k in range(i + 1, min(n, i + 1 + span)))
        best = min(best, later / jump)
    return best if best != float("inf") else 1.0


def _jump_cut(track: FrameTrack, i: int) -> bool:
    """Same camera, same background, the subject's position jumps: a talking-head jump cut or a punch-in.
    Too little of the frame changes for the cut rules above, but the change happens in one frame while the
    frames on both sides are steady, and nothing similar happens just before or after (frame-skipped
    'staccato' motion jumps every second frame)."""
    n = track.n
    if i < 4 or i + 4 > n:
        return False
    c, d = track.changed, track.pix_diff
    if c[i] < JUMP_MIN_CHANGED:
        return False
    side_c = max(float(np.median(c[max(0, i - 6):i])), float(np.median(c[i + 1:i + 7])))
    side_d = max(float(np.median(d[max(0, i - 6):i])), float(np.median(d[i + 1:i + 7])))
    if c[i] < JUMP_RATIO * (side_c + 0.02) or d[i] < 2.0 * (side_d + 0.004):
        return False
    near = np.concatenate([c[i - JUMP_QUIET:i], c[i + 1:i + 1 + JUMP_QUIET]])
    if float(near.max()) > 0.5 * float(c[i]):
        return False
    return _returns(track.thumbs, i) >= JUMP_MIN_RETURN


def _flash(luma: np.ndarray, start: int, end: int, fps: float) -> float:
    """A cut that opens on a bright flash decaying into the new shot (a common motion-graphics transition):
    seconds until the brightness settles, or 0."""
    if start < 1 or end - start < 3:
        return 0.0
    before = float(np.median(luma[max(0, start - 3):start]))
    settle = float(np.median(luma[start + 1:end][-max(1, min(end - start - 1, int(fps))):]))  # level later in the shot
    jump = float(luma[start]) - max(before, settle)
    if jump < 40:
        return 0.0
    k = start
    while k + 1 < end and luma[k + 1] - settle > 0.2 * jump:
        k += 1
    if k == start or k - start > fps * 1.5:  # one bright frame is just a bright shot; a long ramp is a fade
        return 0.0
    return (k + 1 - start) / fps


def _mg_beats(track: FrameTrack, boundaries: dict[int, tuple[str, float]], fps: float) -> list[tuple[int, tuple[str, float]]]:
    """Find 'holds' (runs of frozen frames >= 0.4 s). Consecutive holds whose frames differ
    over a large area are different beats of a rendered (MG/slide) video."""
    n = track.n
    frozen = track.changed < 0.004
    min_run = max(3, int(round(0.4 * fps)))
    runs: list[tuple[int, int]] = []
    i = 0
    while i < n:
        if frozen[i]:
            j = i
            while j < n and frozen[j]:
                j += 1
            if j - i >= min_run:
                runs.append((i, j))
            i = j
        else:
            i += 1
    out: list[tuple[int, tuple[str, float]]] = []
    for (a0, a1), (b0, b1) in zip(runs, runs[1:]):
        if any(a1 - 1 <= k <= b0 + 1 for k in boundaries):
            continue  # already separated by a detected cut/fade
        ta, tb = (track.thumbs[j].astype(np.float32) for j in ((a0 + a1) // 2, (b0 + b1) // 2))
        thr = max(6.0, 0.35 * float(min(ta.std(), tb.std())))
        frac = float((np.abs(ta - tb) > thr).mean())
        if frac > 0.12:
            # boundary at the start of the transition (end of hold A)
            out.append((a1, ("mg_transition", frac)))
    return out


WIPE_GRID = (6, 8)  # blocks across, down (thumbs are portrait or landscape; the grid only needs to be coarse)
WIPE_SECONDS = (0.3, 0.6, 1.0, 1.6)


WIPE_MIN_TEXTURE = 4.0


def _texture(g: np.ndarray) -> float:
    """Mean absolute Laplacian of a gray thumb: photographic frames have detail everywhere, gradients do not."""
    return float(np.abs(cv2.Laplacian(g.astype(np.float32), cv2.CV_32F)).mean())


def _wipes(track: FrameTrack, thumbs: list[np.ndarray], score: np.ndarray, cut_threshold: float,
           boundaries: dict[int, tuple[str, float]]) -> list[tuple[int, float]]:
    """Gradual transitions where the new shot takes over the frame region by region. For a window [s, e]
    whose two ends are different pictures, each block of the frames inside matches one end or the other
    or sits between them (camera / subject motion inside one shot gives blocks that match neither), and the share of blocks
    already showing the new picture grows from ~0 to ~1 across the window."""
    n, fps = track.n, track.fps
    tiny = [cv2.resize(t, WIPE_GRID, interpolation=cv2.INTER_AREA).astype(np.float32) for t in thumbs]
    taken = sorted(boundaries)
    found: list[tuple[int, float]] = []
    for sec in WIPE_SECONDS:
        L = max(6, int(round(sec * fps)))
        for s in range(0, n - L, max(1, L // 6)):
            e = s + L
            if any(s - L // 2 <= b <= e + L // 2 for b in taken) or any(abs(s + L // 2 - i) <= L for i, _ in found):
                continue
            if float(np.abs(tiny[s] - tiny[e]).mean()) < 14 or float(score[s + 1:e + 1].max()) >= cut_threshold:
                continue  # the two ends look alike at a glance, or a hard cut sits inside (handled above)
            dab = _block_diff(thumbs[s], thumbs[e])
            sig = dab > max(12.0, 0.5 * float(np.median(dab)))
            if sig.mean() < 0.75:
                continue  # most of the frame must change: someone walking into the foreground changes only part of it
            if min(_texture(thumbs[s]), _texture(thumbs[e])) < WIPE_MIN_TEXTURE:
                continue  # smooth gradients / flat cards: an animated sweep looks the same, leave those to the MG rules
            us, fits, new = [], [], []
            for q in (0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875):
                m = thumbs[s + int(round(q * L))]
                da, db = _block_diff(m, thumbs[s])[sig], _block_diff(m, thumbs[e])[sig]
                # a block is the old picture, the new one, or (on the moving edge / in a blend) part of each
                fits.append(float(((np.minimum(da, db) < 0.4 * dab[sig]) | (da + db < 1.2 * dab[sig])).mean()))
                new.append(db < da)
                us.append(float(new[-1].mean()))
            # every in-between frame is old-or-new block by block, the new part grows, and it is not the same
            # mixture throughout (a static split screen / picture-in-picture is that, not a transition)
            if min(fits[1:-1]) < 0.75 or not (us[1] < us[3] < us[5]) or us[1] > 0.45 or us[5] < 0.55 or us[5] - us[1] < 0.35:
                continue
            # a block turns into the new picture once and stays (a moving head flips blocks back and forth)
            flips = np.diff(np.array(new, np.int8), axis=0)
            if float((flips < 0).any(axis=0).mean()) > 0.15:
                continue
            # the two ends differ much more than the picture changes in as long a stretch just before / after
            # (one shot with large motion changes as much outside the window as across it)
            prev_b = max([b for b in taken if b <= s] + [0])
            next_b = min([b for b in taken if b >= e] + [n - 1])
            around = [float(_block_diff(thumbs[a], thumbs[b])[sig].mean()) * L / (b - a)
                      for a, b in ((max(prev_b, s - L), s), (e, min(next_b, e + L))) if b - a >= max(3, L // 3)]
            if around and float(dab[sig].mean()) < 2.0 * max(around):
                continue
            if _motion_explains(thumbs[s].astype(np.float32), thumbs[e].astype(np.float32)):
                continue
            # boundary: the frame where most of the picture has become the new shot
            mid = s + L // 2
            for j in range(s + 1, e):
                db_, da_ = _block_diff(thumbs[j], thumbs[e])[sig], _block_diff(thumbs[j], thumbs[s])[sig]
                if float((db_ < da_).mean()) >= 0.5:
                    mid = j
                    break
            found.append((mid, round(min(fits), 3)))
    return found


def _steady_morph(thumbs: list[np.ndarray], i: int, k: int) -> bool:
    """True when the picture changes as fast just before and just after the window [i-k, i+k] as inside it."""
    n = len(thumbs)

    def rate(a: int, b: int) -> float | None:
        a, b = max(0, a), min(n - 1, b)
        if b - a < k:
            return None
        return float(np.abs(thumbs[b].astype(np.float32) - thumbs[a].astype(np.float32)).mean()) * (2 * k) / (b - a)

    mid = rate(i - k, i + k)
    around = [r for r in (rate(i - 3 * k, i - k), rate(i + k, i + 3 * k)) if r is not None]
    return bool(mid and around and mid < 1.3 * max(around))
