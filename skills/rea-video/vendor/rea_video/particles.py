"""Particle / point-cloud pictures on a dark ground, measured for a code remake.

`rea-video frames out/ref` splits each particle shot into scenes (the dots regroup into a new shape without a cut),
saves full-resolution frames per scene, measures what a renderer needs (ground, halo, dot colours, dot size and count,
where the dots sit) and samples the lit dots of each scene's middle frame as target points, so a remake can place its
particles on the original shapes instead of guessing them from a description.

`rea-video compare ref.mp4 remake.mp4` scores a remake against the original frame by frame (where the dots are and how
dense, with the halo and colours left out) and puts the worst moments side by side, so the remake can be fixed where it
is furthest off rather than where it looks off at a glance.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .features import SPARK, halo_blur
from .i18n import T
from .media import extract_frame, iter_frames, video_info
from .util import read_json, write_json

WORK_W = 480  # measuring width; the remake reads positions as 0-1 of the frame, so this only sets precision
GRID = (16, 9)  # density map cells (x, y)
SCENE_WIN = 1.5  # seconds compared on each side of a candidate scene change
SCENE_MIN = 1.5  # shortest scene kept
SCENE_JUMP = 0.25  # density-map change (half L1, 0-1) that starts a new scene


def _hex(bgr) -> str:
    b, g, r = (int(round(float(v))) for v in bgr)
    return f"#{r:02x}{g:02x}{b:02x}"


def spark_mask(bgr: np.ndarray, text_boxes: list | None = None) -> np.ndarray:
    """Pixels that stand out above the soft halo: the dots and thin lines themselves. text_boxes (0-1 x, y, w, h) are
    blanked, so subtitles and labels do not count as particles."""
    gf = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    m = (gf - halo_blur(gf)) > SPARK
    h, w = m.shape
    for x, y, bw, bh in text_boxes or []:
        pad = 0.01
        x0, y0 = int(max(0, x - pad) * w), int(max(0, y - pad) * h)
        x1, y1 = int(min(1, x + bw + pad) * w + 1), int(min(1, y + bh + pad) * h + 1)
        m[y0:y1, x0:x1] = False
    return m


def density(mask: np.ndarray) -> np.ndarray:
    d = cv2.resize(mask.astype(np.float32), GRID, interpolation=cv2.INTER_AREA)
    s = float(d.sum())
    return d / s if s > 0 else d


def _colours(pixels: np.ndarray, k: int = 3) -> list[dict]:
    """Main colours of a set of BGR pixels, as hex with their share."""
    if len(pixels) < 10:
        return []
    px = pixels.astype(np.float32)
    if len(px) > 6000:
        px = px[np.random.default_rng(0).choice(len(px), 6000, replace=False)]
    k = min(k, len(np.unique(px, axis=0)))
    cv2.setRNGSeed(0)
    _, lbl, centers = cv2.kmeans(px, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0), 2,
                                 cv2.KMEANS_PP_CENTERS)
    share = np.bincount(lbl.ravel(), minlength=k) / len(lbl)
    return [{"hex": _hex(centers[i]), "share": round(float(share[i]), 2)} for i in np.argsort(-share) if share[i] >= 0.05]


def measure(bgr: np.ndarray, text_boxes: list | None = None) -> dict:
    """What a particle renderer needs from one frame: ground, halo (colour, centre, radius), dot colours, dot size,
    rough dot count, where the dots sit and how much of the frame they cover. Positions are 0-1 of the frame."""
    h, w = bgr.shape[:2]
    gf = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    halo = halo_blur(gf)
    border = np.concatenate([bgr[0], bgr[-1], bgr[:, 0], bgr[:, -1]])
    ground = np.median(border, axis=0)
    out: dict = {"ground": _hex(ground)}
    lift = np.clip(halo - float(np.median(cv2.cvtColor(border[None], cv2.COLOR_BGR2GRAY))), 0, None)
    if lift.max() > 6:
        on = lift > lift.max() * 0.5
        ys, xs = np.nonzero(on)
        wts = lift[on]
        cx, cy = float((xs * wts).sum() / wts.sum()) / w, float((ys * wts).sum() / wts.sum()) / h
        blur = cv2.GaussianBlur(bgr, (0, 0), max(h, w) / 40.0)
        peak = np.unravel_index(int(np.argmax(lift)), lift.shape)
        out["halo"] = {"colour": _hex(blur[peak]), "centre": [round(cx, 3), round(cy, 3)],
                       "radius": round(float(np.sqrt(on.sum() / np.pi)) / w, 3), "lift": round(float(lift.max()), 1)}
    m = spark_mask(bgr, text_boxes)
    n = int(m.sum())
    out["cover"] = round(n / float(h * w), 4)
    if n < 10:
        return out
    out["colours"] = _colours(bgr[m])
    ys, xs = np.nonzero(m)
    out["box"] = [round(float(np.percentile(xs, 2)) / w, 3), round(float(np.percentile(ys, 2)) / h, 3),
                  round(float(np.percentile(xs, 98)) / w, 3), round(float(np.percentile(ys, 98)) / h, 3)]
    out["centre"] = [round(float(xs.mean()) / w, 3), round(float(ys.mean()) / h, 3)]
    n_cc, _, stats, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
    areas = stats[1:, cv2.CC_STAT_AREA]
    if len(areas):
        out["dots"] = int(n_cc - 1)
        out["dot_px"] = round(float(np.median(areas)) * (1.0 / w) ** 2 * 1e6, 1)  # median dot area, per million of frame
        out["lines"] = round(float((areas > 40).sum()) / len(areas), 2)  # share of blobs long enough to be lines / clumps
    out["density"] = [[round(float(v), 3) for v in row] for row in density(m)]
    return out


def sample_points(bgr: np.ndarray, n: int = 4000, text_boxes: list | None = None) -> list[list[float]]:
    """Up to n lit dots of the frame as [x, y, r, g, b, a] (x, y 0-1; colour 0-255; a = how far the pixel stands out
    above the halo, 0-1), picked with probability by brightness: targets a particle system can be laid onto."""
    gf = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    lift = gf - halo_blur(gf)
    m = spark_mask(bgr, text_boxes)
    ys, xs = np.nonzero(m)
    if not len(xs):
        return []
    wts = lift[ys, xs]
    pick = np.random.default_rng(0).choice(len(xs), size=min(n, len(xs)), replace=False, p=wts / wts.sum())
    h, w = gf.shape
    a = np.clip(wts[pick] / 255.0 * 2, 0, 1)
    return [[round(float(xs[i] + 0.5) / w, 4), round(float(ys[i] + 0.5) / h, 4), *[int(v) for v in bgr[ys[i], xs[i]][::-1]],
             round(float(al), 2)] for i, al in zip(pick, a)]


def _text_boxes(out: Path, b: dict) -> list[tuple[float, float, list]]:
    """Where text sits and when: the packaging timeline when it is written, plus every OCR read stored on the shots
    (decompose measures particles before the timeline file exists)."""
    boxes = [(float(it["t"]) - 0.6, float(it["t"]) + 0.6, it["bbox"]) for s in b.get("shots", [])
             for it in (s.get("text") or {}).get("items", []) if it.get("bbox") and it.get("t") is not None]
    tl = out / "packaging" / "timeline.json"
    if tl.exists():
        boxes += [(float(x["t0"]), float(x["t1"]), x["bbox"]) for x in read_json(tl).get("text", []) if x.get("bbox")]
    return boxes


def _boxes_at(boxes, t: float, until: float | None = None) -> list:
    """Text boxes on screen at t (or at any time in t..until): OCR misses a label on some frames, so a scene blanks
    every box seen during it."""
    z = t if until is None else until
    return [b for t0, t1, b in boxes if t0 - 0.3 <= z and t <= t1 + 0.3]


def split_scenes(descs: np.ndarray, times: np.ndarray, start: float, end: float) -> list[tuple[float, float]]:
    """Scene changes inside one shot: where the density map before and after differ by more than they vary inside
    each side. descs: one density map (flattened) per sampled time."""
    if len(times) < 2:
        return [(start, end)]
    step = float(np.median(np.diff(times)))
    win = max(1, int(round(SCENE_WIN / step)))
    score = np.zeros(len(times))
    for i in range(win, len(times) - win + 1):
        a, b = descs[i - win:i], descs[i:i + win]
        spread = 0.5 * (0.5 * np.abs(a - a.mean(0)).sum(1).mean() + 0.5 * np.abs(b - b.mean(0)).sum(1).mean())
        score[i] = 0.5 * np.abs(a.mean(0) - b.mean(0)).sum() - spread
    cuts: list[float] = []
    near = max(1, int(round(SCENE_MIN / step)))
    for i in np.argsort(-score):
        if score[i] < SCENE_JUMP:
            break
        t = float(times[i])
        if t - start < SCENE_MIN or end - t < SCENE_MIN or any(abs(t - c) < SCENE_MIN for c in cuts):
            continue
        lo, hi = max(0, i - near), min(len(score), i + near + 1)
        if score[i] >= score[lo:hi].max():
            cuts.append(t)
    edges = [start, *sorted(cuts), end]
    return list(zip(edges[:-1], edges[1:]))


def _is_particles(shot: dict) -> bool:
    facts = (shot.get("deterministic") or {}).get("facts") or {}
    return facts.get("fine_dark", 0.0) > 0.5


def _clear(fdir: Path) -> None:
    """Drop what an earlier run wrote, so a rerun with fewer scenes leaves no stale scene files behind."""
    for p in [*fdir.glob("scene_*.jpg"), *(fdir / "points").glob("scene_*.json"), fdir / "scenes.json"]:
        p.unlink(missing_ok=True)
    for d in (fdir / "points", fdir):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()


def scene_frames(out: Path, every: float = 0.25, n_points: int = 4000, all_shots: bool = False, breakdown: dict | None = None) -> dict:
    """Scenes, full-resolution frames, measurements and target points for the particle shots of a breakdown.
    Frames are measured as they are decoded (memory does not grow with shot length)."""
    out = Path(out)
    b = breakdown if breakdown is not None else read_json(out / "breakdown.json")
    video = (b.get("source") or {}).get("path")
    if not video or not Path(video).exists():
        raise FileNotFoundError(T("找不到原视频 {p}（breakdown.json 的 source.path）", "source video not found: {p} (source.path in breakdown.json)", p=video))
    fdir = out / "frames"
    _clear(fdir)
    shots = [s for s in b.get("shots", []) if all_shots or _is_particles(s)]
    if not shots:
        return {"video": video, "every": every, "scenes": []}
    info = video_info(video)
    boxes = _text_boxes(out, b)
    (fdir / "points").mkdir(parents=True, exist_ok=True)
    full_w = min(1080, info.display_size[0] or 1080)
    scenes: list[dict] = []
    for s in shots:
        st, en = float(s["start"]), float(s["end"])
        descs, times, track = [], [], []
        for i, f in enumerate(iter_frames(video, info, WORK_W, start=st, duration=en - st, fps=1.0 / every)):
            t = st + i * every
            m = spark_mask(f, _boxes_at(boxes, t))
            descs.append(density(m).ravel())
            times.append(t)
            ys, xs = np.nonzero(m)
            if len(xs) >= 10:  # how the dots move: centre, horizontal spread and cover over time
                track.append([round(t, 2), round(float(xs.mean()) / f.shape[1], 3), round(float(ys.mean()) / f.shape[0], 3),
                              round(float(xs.std()) / f.shape[1], 3), round(float(m.mean()), 4)])
        if not times:
            continue
        for a, z in split_scenes(np.array(descs), np.array(times), st, en):
            sid = f"scene_{len(scenes) + 1:02d}"
            mid = (a + z) / 2
            rec = {"id": sid, "shot": s.get("index"), "start": round(a, 2), "end": round(z, 2), "frames": {}}
            for tag, t in (("start", a + min(0.15, (z - a) / 4)), ("mid", mid), ("end", max(a, z - min(0.15, (z - a) / 4)))):
                p = fdir / f"{sid}_{tag}.jpg"
                extract_frame(video, t, p, full_w)
                rec["frames"][tag] = f"frames/{p.name}"
            img = cv2.imread(str(fdir / f"{sid}_mid.jpg"))
            if img is not None:
                img = cv2.resize(img, (WORK_W, max(1, round(img.shape[0] * WORK_W / img.shape[1]))), interpolation=cv2.INTER_AREA)
                in_scene = _boxes_at(boxes, a, z)
                rec["measure"] = measure(img, in_scene)
                write_json(fdir / "points" / f"{sid}.json", {"time": round(mid, 2), "format": "x y r g b a",
                                                             "points": sample_points(img, n_points, in_scene)})
                rec["points"] = f"frames/points/{sid}.json"
            rec["track"] = [r for r in track if a <= r[0] < z]
            scenes.append(rec)
    res = {"video": video, "every": every, "track_format": "t cx cy spread cover", "scenes": scenes}
    write_json(fdir / "scenes.json", res)
    return res


def _prep(bgr: np.ndarray, invert: bool) -> np.ndarray:
    return 255 - bgr if invert else bgr


def _is_light(path: str, info, n: int = 20) -> bool:
    """Light ground or dark ground, from a few small frames spread over the video."""
    fps = max(n / max(info.duration, 0.1), 0.01)
    lum = [float(f.mean()) for f in iter_frames(path, info, 64, fps=fps)][:n]
    return bool(lum) and float(np.median(lum)) >= 90


def _score(fa: np.ndarray, fb: np.ndarray, k: np.ndarray) -> dict:
    ma, mb = spark_mask(fa), spark_mask(fb)
    da, db = density(ma), density(mb)
    place = 1.0 - 0.5 * float(np.abs(da - db).sum()) if ma.any() and mb.any() else float(ma.any() == mb.any())
    ua, ub = cv2.dilate(ma.astype(np.uint8), k) > 0, cv2.dilate(mb.astype(np.uint8), k) > 0
    hit_a = float((ma & ub).sum()) / max(1, int(ma.sum()))
    hit_b = float((mb & ua).sum()) / max(1, int(mb.sum()))
    shape = 2 * hit_a * hit_b / (hit_a + hit_b) if hit_a + hit_b else (1.0 if not ma.any() and not mb.any() else 0.0)
    ca, cb = float(ma.mean()), float(mb.mean())
    amount = min(ca, cb) / max(ca, cb) if max(ca, cb) > 0 else 1.0
    return {"place": round(place, 3), "shape": round(shape, 3), "amount": round(amount, 3),
            "score": round(0.4 * place + 0.4 * shape + 0.2 * amount, 3)}


def compare(ref: str, remake: str, every: float = 0.5, invert: str = "auto", out: Path | None = None,
            scenes: Path | None = None, worst: int = 8) -> dict:
    """Frame-by-frame score of a remake against the original: where the dots are (density-map overlap) and the dot
    masks themselves (overlap with a few pixels of slack). invert: 'auto' flips a light-ground remake of a dark-ground
    original before measuring; 'yes' / 'no' force it. Both videos are decoded side by side and only the worst frames
    are kept, so memory does not grow with length."""
    import heapq

    ri, mi = video_info(ref), video_info(remake)
    dur = min(ri.duration, mi.duration)
    flip = (_is_light(ref, ri) != _is_light(remake, mi)) if invert == "auto" else invert == "yes"
    k = np.ones((5, 5), np.uint8)
    rows: list[dict] = []
    keep: list = []  # min-heap on -score: the `worst` lowest-scoring frames with their pictures
    pairs = zip(iter_frames(ref, ri, WORK_W, start=0, duration=dur, fps=1.0 / every),
                iter_frames(remake, mi, WORK_W, start=0, duration=dur, fps=1.0 / every))
    for i, (fa, fb_raw) in enumerate(pairs):
        fb = cv2.resize(fb_raw, (fa.shape[1], fa.shape[0]))
        r = {"t": round(i * every, 2), **_score(fa, _prep(fb, flip), k)}
        rows.append(r)
        if out:
            item = (-r["score"], i, fa, fb)
            if len(keep) < worst:
                heapq.heappush(keep, item)
            elif item[0] > keep[0][0]:
                heapq.heapreplace(keep, item)
    if not rows:
        raise ValueError(T("没有可比较的帧", "no frames to compare"))
    res: dict = {"ref": ref, "remake": remake, "inverted": bool(flip), "every": every,
                 "score": round(float(np.mean([r["score"] for r in rows])), 3),
                 "place": round(float(np.mean([r["place"] for r in rows])), 3),
                 "shape": round(float(np.mean([r["shape"] for r in rows])), 3), "frames": rows}
    if scenes and Path(scenes).exists():
        per = []
        for sc in read_json(scenes).get("scenes", []):
            rs = [r for r in rows if sc["start"] <= r["t"] < sc["end"]]
            if rs:
                per.append({"id": sc["id"], "start": sc["start"], "end": sc["end"],
                            "score": round(float(np.mean([r["score"] for r in rs])), 3),
                            "shape": round(float(np.mean([r["shape"] for r in rs])), 3)})
        res["scenes"] = sorted(per, key=lambda x: x["score"])
    low = sorted(rows, key=lambda r: r["score"])[:worst]
    res["worst"] = [r["t"] for r in sorted(low, key=lambda r: r["t"])]
    if out:
        out.mkdir(parents=True, exist_ok=True)
        cells = []
        for _, i, fa, fb in sorted(keep, key=lambda x: x[1]):
            r = rows[i]
            row = np.hstack([fa, np.full((fa.shape[0], 6, 3), 128, np.uint8), fb])
            cv2.putText(row, f"{r['t']:.1f}s score {r['score']:.2f} (place {r['place']:.2f} shape {r['shape']:.2f})", (8, 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1, cv2.LINE_AA)
            cells.append(row)
        if cells:
            cv2.imwrite(str(out / "compare_worst.jpg"), np.vstack(cells), [cv2.IMWRITE_JPEG_QUALITY, 88])
            res["sheet"] = str(out / "compare_worst.jpg")
        write_json(out / "compare.json", res)
    return res


def lit_palette(frames: list[np.ndarray]) -> list[str]:
    """Dot colours of a particle shot (lit dots only, the black ground and halo left out), most common first."""
    px = [f[spark_mask(f)] for f in frames if f is not None]
    px = [p for p in px if len(p)]
    if not px:
        return []
    return [c["hex"] for c in _colours(np.concatenate(px), k=4)]
