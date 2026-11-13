"""Motion events of a rendered (code / motion-graphics) shot: what changes where, when, how, in what colour.

A remake of a code-drawn video needs every element's entrance time, place, direction and easing, which a few key
frames do not give. Here the shot is decoded small, every cell that changes is stamped with the frame it starts and
stops changing, and cells are grouped first by start time (staggered entrances become separate events) and then by
place. Cells that keep changing through most of the shot (drifting gradients, particle flows, glow breathing) form
one "continuous layer" instead of events."""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .i18n import T
from .util import write_image
from .media import VideoInfo, iter_frames

W = 180           # analysis width
CELL = 4          # px per cell at that width
DIFF = 12         # per-channel change that counts (8-bit)
MAX_FPS = 15.0
CONT = 0.7        # a cell active in more than this share of the shot belongs to the continuous layer
GAP_S = 0.12      # start times further apart than this split an event
MIN_AREA = 0.002  # events smaller than this share of the frame are dropped
MAX_EVENTS = 20


def _hex(bgr) -> str:
    b, g, r = (int(x) for x in bgr)
    return f"#{r:02x}{g:02x}{b:02x}"


def _frames(path: str | Path, info: VideoInfo, start: float, dur: float) -> tuple[np.ndarray, float]:
    fps = min(info.fps or 30.0, MAX_FPS)
    fr = list(iter_frames(path, info, W, start=start, duration=dur, fps=fps))
    return (np.stack(fr) if fr else np.zeros((0, 1, W, 3), np.uint8)), fps


def _easing(act: np.ndarray) -> str:
    """Shape of an event's activity over its life: where the change happens."""
    if len(act) < 4 or act.sum() <= 0:
        return "instant"
    c = np.cumsum(act) / act.sum()
    half = c[len(c) // 2 - (1 if len(c) % 2 == 0 else 0)]
    if half > 0.68:
        return "ease_out"
    if half < 0.32:
        return "ease_in"
    cv = float(act.std() / (act.mean() + 1e-6))
    return "linear" if cv < 0.45 else "ease_in_out"


def _direction(on: np.ndarray, ys: np.ndarray, xs: np.ndarray) -> str | None:
    """Start time sweeping across the region: a wipe / grow / draw-on along that direction."""
    if len(on) < 12 or on.std() < 1e-6:
        return None
    best, axis = 0.0, None
    for coord, pos, neg in ((xs, "right", "left"), (ys, "down", "up")):
        if coord.std() < 1e-6:
            continue
        r = float(np.corrcoef(coord, on)[0, 1])
        if abs(r) > abs(best):
            best, axis = r, (pos if r > 0 else neg)
    return axis if abs(best) > 0.6 else None


def motion_events(path: str | Path, info: VideoInfo, start: float, dur: float, text_items: list[dict] | None = None) -> dict:
    fr, fps = _frames(path, info, start, dur)
    n = len(fr)
    if n < 3:
        return {"fps": fps, "events": [], "layer": None, "sequences": []}
    h, w = fr.shape[1:3]
    gh, gw = h // CELL, w // CELL
    f = fr[:, : gh * CELL, : gw * CELL].astype(np.int16)
    d = np.abs(np.diff(f, axis=0)).max(axis=3) > DIFF                          # (n-1, H, W) changed pixels
    act = d.reshape(n - 1, gh, CELL, gw, CELL).mean(axis=(2, 4)) > 0.12        # (n-1, gh, gw) active cells
    count = act.sum(axis=0)
    ever = count > 0
    cont = count > CONT * (n - 1)
    # slow drifts (gradients, blurred blobs, glow) change by 1-3 levels between neighbouring frames: compare 1 s apart
    lag = max(1, int(round(1.0 * fps)))
    if n > lag + 2:
        slow = (np.abs(f[lag:] - f[:-lag]).max(axis=3) > 8).reshape(n - lag, gh, CELL, gw, CELL).mean(axis=(2, 4)) > 0.3
        cont |= slow.mean(axis=0) > 0.6
    out: dict = {"fps": round(fps, 2), "events": [], "layer": None, "sequences": []}
    if cont.mean() > 0.01:
        ys, xs = np.nonzero(cont)
        out["layer"] = {"share": round(float(cont.mean()), 3),
                        "box": [round(xs.min() / gw, 3), round(ys.min() / gh, 3), round((xs.max() + 1 - xs.min()) / gw, 3),
                                round((ys.max() + 1 - ys.min()) / gh, 3)]}
    # over a moving ground (drifting gradient, particle field) "unchanged" pieces are just patches of that ground
    out["static"] = _static_elements(fr, ever | cont, text_items or []) if cont.mean() < 0.4 else []
    if not ever.any():
        return out
    onset = np.where(ever, act.argmax(axis=0), -1)
    last = np.where(ever, n - 2 - act[::-1].argmax(axis=0), -1)
    trans = ever & ~cont
    texts = text_items or []
    # elements: what is on screen at the end that was not at the start, at rest (staggered entrances that sweep
    # through each other's place, like springing icons or lines sliding up, are apart once they settle)
    settled = np.abs(f[-1] - f[0]).max(axis=2) > DIFF
    settled = settled.reshape(gh, CELL, gw, CELL).mean(axis=(1, 3)) > 0.12
    settled &= trans
    # where an element finally comes to rest, its own entrance is the last burst of change there (something else may
    # have swept through the spot earlier)
    arrive = last.copy()
    for t in range(n - 2, -1, -1):
        hit = act[t] & (arrive - t <= 3) & (t < arrive)
        arrive[hit] = t
    k, lab = cv2.connectedComponents(cv2.dilate(settled.astype(np.uint8), np.ones((1, 3), np.uint8)), connectivity=8)
    covered = np.zeros_like(trans)
    for j in range(1, k):
        region = (lab == j) & settled
        if region.sum() / (gh * gw) < MIN_AREA:
            continue
        covered |= cv2.dilate(region.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
        for cm in _split_by_start(region, arrive, fps):
            if cm.sum() / (gh * gw) >= MIN_AREA:
                out["events"].append(_event(cm, fr, act, arrive, last, start, fps, gh, gw, texts))
    # the rest: things that come and go within the shot, or move without staying; split where start times jump
    rest = trans & ~covered
    k, lab = cv2.connectedComponents(cv2.dilate(rest.astype(np.uint8), np.ones((1, 3), np.uint8)), connectivity=8)
    for j in range(1, k):
        for cm in _split_by_start(((lab == j) & rest), onset, fps):
            if cm.sum() / (gh * gw) >= MIN_AREA:
                out["events"].append(_event(cm, fr, act, onset, last, start, fps, gh, gw, texts))
    # whole-picture changes (camera moves, particle fields) and specks of jitter are not elements
    long_ = 0.8 * dur  # changing through (almost) the whole shot: twinkling star fields, flicker -> part of the layer
    out["events"] = [e for e in out["events"] if not (e["kind"] == "change" and (e["box"][2] * e["box"][3] > 0.5 or e["area"] < 0.01
                                                                                  or e["t1"] - e["t0"] > long_))]
    out["events"] = _chain(out["events"])
    out["events"] = sorted(sorted(out["events"], key=lambda e: -e.pop("_rank"))[:MAX_EVENTS], key=lambda e: (e["t0"], e["box"][1]))
    out["sequences"] = _sequences(out["events"])
    return out


def _static_elements(fr: np.ndarray, moving_cells: np.ndarray, texts: list[dict], most: int = 8) -> list[dict]:
    """Shapes that are on screen for the whole shot and never move (axis lines, fixed cards, frames, logos): the
    motion timeline never mentions them, and a remake built from it alone would leave them out."""
    last = fr[-1].astype(np.int16)
    h, w = last.shape[:2]
    border = np.concatenate([last[0], last[-1], last[:, 0], last[:, -1]])
    bg = np.median(border, axis=0)
    fg = np.abs(last - bg).max(axis=2) > 2 * DIFF
    fg &= (np.abs(fr[0].astype(np.int16) - last).max(axis=2) <= DIFF)          # same at the start: never changed
    gh, gw = moving_cells.shape
    moving_px = cv2.resize(moving_cells.astype(np.uint8), (gw * CELL, gh * CELL), interpolation=cv2.INTER_NEAREST).astype(bool)
    fg[: gh * CELL, : gw * CELL] &= ~cv2.dilate(moving_px.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    k, lab, stats, _ = cv2.connectedComponentsWithStats(cv2.dilate(fg.astype(np.uint8), np.ones((3, 3), np.uint8)), connectivity=8)
    items = []
    for j in range(1, k):
        x, y, bw, bh, area = stats[j]
        if area < 30 or bw * bh > 0.6 * w * h:
            continue
        m = (lab == j) & fg
        box = [round(x / w, 3), round(y / h, 3), round(bw / w, 3), round(bh / h, 3)]
        shape = "hline" if bw > 8 * bh else "vline" if bh > 8 * bw else "block"
        px = fr[-1][m].astype(np.int16)
        far = np.abs(px - bg).max(axis=1)
        core = px[far >= np.percentile(far, 60)]  # glyph / line cores, not their anti-aliased edges
        ev = {"box": box, "shape": shape, "colour": _hex(np.median(core, axis=0)), "_a": int(area)}
        words = _words(box, texts)
        if words:
            ev["text"] = words
        items.append(ev)
    items = sorted(items, key=lambda e: -e.pop("_a"))[:most]
    return sorted(items, key=lambda e: (e["box"][1], e["box"][0]))


def _split_by_start(region: np.ndarray, start_map: np.ndarray, fps: float) -> list[np.ndarray]:
    """Parts of one place that start changing at clearly different times (a stroke drawn after another)."""
    ts = np.sort(np.unique(start_map[region]))
    if not len(ts):
        return []
    cuts = [ts[0]] + [t for p_, t in zip(ts, ts[1:]) if t - p_ > max(2, GAP_S * 2 * fps)]
    return [region & (start_map >= c0) & (start_map < c1) for c0, c1 in zip(cuts, cuts[1:] + [ts[-1] + 1])]


def _event(cm, fr, act, onset, last, start, fps, gh, gw, texts) -> dict:
    n = len(fr)
    area = float(cm.sum()) / (gh * gw)
    ys, xs = np.nonzero(cm)
    on, end = onset[cm], last[cm]
    t0, t1 = int(on.min()), int(np.percentile(end, 90))
    prof = act[t0:t1 + 1][:, cm].sum(axis=1).astype(float)
    # what the region looks like before the event starts and after it ends
    y0, y1, x0, x1 = ys.min() * CELL, (ys.max() + 1) * CELL, xs.min() * CELL, (xs.max() + 1) * CELL
    before, after = fr[max(0, t0)][y0:y1, x0:x1], fr[min(n - 1, t1 + 2)][y0:y1, x0:x1]
    diff = np.abs(after.astype(np.int16) - before.astype(np.int16)).max(axis=2) > DIFF
    sb, sa = float(before.std()), float(after.std())
    if diff.mean() < 0.05:
        kind = "change"            # comes back to how it was (pulse, pass-through)
    elif sb < 0.5 * sa and sa > 6:
        kind = "appear"
    elif sa < 0.5 * sb and sb > 6:
        kind = "disappear"
    else:
        kind = "change"
    colour_src = after if kind != "disappear" else before
    px = colour_src[diff] if diff.any() else colour_src.reshape(-1, 3)
    # how it enters: only a moving tip changes per frame -> drawn / grown / typed along a direction; the whole element
    # changes and its centre travels -> slides in; centre fixed while its extent grows -> scales in
    sl = [a & cm for a in act[t0:t1 + 1]]
    sl = [a for a in sl if a.any()]
    tip = float(np.median([a.sum() for a in sl])) / max(1, cm.sum()) if sl else 1.0
    slide = scale = None
    sweep = _direction(on.astype(float), ys.astype(float), xs.astype(float)) if tip < 0.35 else None
    if sl and not sweep and len(sl) >= 3:
        cy = [float(np.nonzero(a)[0].mean()) / gh for a in sl]
        cx = [float(np.nonzero(a)[1].mean()) / gw for a in sl]
        dy, dx = cy[-1] - cy[0], cx[-1] - cx[0]
        if max(abs(dy), abs(dx)) > 0.02:
            slide = ("down" if dy > 0 else "up") if abs(dy) > abs(dx) else ("right" if dx > 0 else "left")
        else:
            w0 = np.ptp(np.nonzero(sl[0])[1]) + 1
            w1 = np.ptp(np.nonzero(cm)[1]) + 1
            if w0 < 0.6 * w1:
                scale = True
    box = [round(x0 / (gw * CELL), 3), round(y0 / (gh * CELL), 3), round((x1 - x0) / (gw * CELL), 3), round((y1 - y0) / (gh * CELL), 3)]
    # change index j is between frames j and j+1: the change shows from frame j+1
    ev = {"t0": round(start + (t0 + 1) / fps, 2), "t1": round(start + max(t1 + 1, t0 + 2) / fps, 2), "box": box, "area": round(area, 3),
          "kind": kind, "easing": _easing(prof), "sweep": sweep, "slide": slide, "scale": scale, "colour": _hex(np.median(px, axis=0)) if len(px) else None, "_rank": area * (t1 - t0 + 1)}
    words = _words(box, texts)
    if words:
        ev["text"] = words
    return ev


def _words(box, texts) -> list[str]:
    words = []
    for it in texts:
        bx, by, bw, bh = it["bbox"]
        if (box[0] - 0.02 <= bx + bw / 2 <= box[0] + box[2] + 0.02 and box[1] - 0.02 <= by + bh / 2 <= box[1] + box[3] + 0.02
                and it.get("conf", 0) >= 0.8 and len(it["text"].strip()) > 1 and it["text"] not in words):
            words.append(it["text"])
    return words[:3]


def _union(a: list[float], b: list[float]) -> list[float]:
    x0, y0 = min(a[0], b[0]), min(a[1], b[1])
    x1, y1 = max(a[0] + a[2], b[0] + b[2]), max(a[1] + a[3], b[1] + b[3])
    return [round(x0, 3), round(y0, 3), round(x1 - x0, 3), round(y1 - y0, 3)]


def _touch(a: list[float], b: list[float], tol: float = 0.03) -> bool:
    return not (a[0] + a[2] + tol < b[0] or b[0] + b[2] + tol < a[0] or a[1] + a[3] + tol < b[1] or b[1] + b[3] + tol < a[1])


def _chain(evs: list[dict]) -> list[dict]:
    """One element drawn piece by piece (a growing bar, a stroke, typed text) arrives as touching pieces, each starting
    as the previous one ends: join them into one event that unfolds along its direction."""
    evs = sorted(evs, key=lambda e: e["t0"])
    out: list[dict] = []
    for e in evs:
        for o in out:
            if o["kind"] == e["kind"] and -0.1 <= e["t0"] - o["_last_t1"] <= 0.2 and _touch(o["_last_box"], e["box"], 0.01):
                (cx0, cy0), (cx1, cy1) = o["_first_c"], (e["box"][0] + e["box"][2] / 2, e["box"][1] + e["box"][3] / 2)
                o["sweep"] = (("right" if cx1 > cx0 else "left") if abs(cx1 - cx0) >= abs(cy1 - cy0)
                              else ("down" if cy1 > cy0 else "up"))
                o["box"], o["t1"], o["_last_t1"], o["_last_box"] = _union(o["box"], e["box"]), max(o["t1"], e["t1"]), e["t1"], e["box"]
                o["area"] = round(o["area"] + e["area"], 3)
                o["_rank"] += e["_rank"]
                o["_pieces"] += 1
                o["slide"] = None
                o["text"] = list(dict.fromkeys(o.get("text", []) + e.get("text", [])))[:3] or o.get("text")
                if not o["text"]:
                    o.pop("text")
                break
        else:
            out.append({**e, "_last_t1": e["t1"], "_last_box": e["box"], "_first_c": (e["box"][0] + e["box"][2] / 2, e["box"][1] + e["box"][3] / 2), "_pieces": 1})
    for o in out:
        if o.pop("_pieces") >= 3:
            o["easing"] = "linear" if o["easing"] == "instant" else o["easing"]
        for key in ("_last_t1", "_last_box", "_first_c"):
            o.pop(key)
    return out


def _sequences(evs: list[dict]) -> list[dict]:
    """Same-sized elements entering the same way at a steady interval (list items, icons, bars, lines of text)."""
    seqs = []
    used: set[int] = set()
    for i, e in enumerate(evs):
        if i in used:
            continue
        grp = [i]
        for j in range(i + 1, len(evs)):
            f = evs[j]
            if j in used or f["kind"] != e["kind"]:
                continue
            same = (abs(f["box"][2] - e["box"][2]) < 0.4 * max(e["box"][2], f["box"][2])
                    and abs(f["box"][3] - e["box"][3]) < 0.4 * max(e["box"][3], f["box"][3])
                    and abs((f["t1"] - f["t0"]) - (e["t1"] - e["t0"])) < 0.5 * max(0.2, e["t1"] - e["t0"]))
            if same:
                grp.append(j)
        if len(grp) < 3:
            continue
        t = [evs[k]["t0"] for k in grp]
        gaps = np.diff(t)
        if gaps.min() <= 0 or gaps.std() > 0.4 * gaps.mean():
            continue
        used.update(grp)
        seqs.append({"n": len(grp), "events": grp, "t0": t[0], "interval": round(float(gaps.mean()), 2),
                     "each": round(float(np.median([evs[k]["t1"] - evs[k]["t0"] for k in grp])), 2)})
    return seqs


KIND_WORDS = {"appear": ("出现", "appears"), "disappear": ("消失", "disappears"), "change": ("变化", "changes")}
EASE_WORDS = {"ease_out": ("先快后慢", "ease-out"), "ease_in": ("先慢后快", "ease-in"), "linear": ("匀速", "linear"),
              "ease_in_out": ("缓入缓出", "ease-in-out"), "instant": ("瞬间", "instant")}
DIR_WORDS = {"right": ("向右", "rightward"), "left": ("向左", "leftward"), "down": ("向下", "downward"), "up": ("向上", "upward")}


def _where(box: list[float]) -> str:
    cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
    v = T("上", "top") if cy < 0.33 else T("下", "bottom") if cy > 0.67 else T("中", "middle")
    hz = T("左", " left") if cx < 0.33 else T("右", " right") if cx > 0.67 else ""
    return v + hz


def event_line(ev: dict) -> str:
    """One readable line: time, place (box in % of the frame), what happens, how, colour, text."""
    b = ev["box"]
    what = T(*KIND_WORDS[ev["kind"]])
    how = []
    if ev.get("sweep"):
        how.append(T("{d}展开（描线/生长/擦除）", "unfolds {d} (draw-on / grow / wipe)", d=T(*DIR_WORDS[ev["sweep"]])))
    elif ev.get("slide"):
        how.append(T("{d}移入", "slides {d}", d=T(*DIR_WORDS[ev["slide"]])) if ev["kind"] == "appear"
                   else T("{d}移动", "moves {d}", d=T(*DIR_WORDS[ev["slide"]])))
    elif ev.get("scale"):
        how.append(T("由小放大", "scales up"))
    how.append(T(*EASE_WORDS[ev["easing"]]))
    bits = [f"{ev['t0']:.2f}–{ev['t1']:.2f}s",
            T("{w}（x {x:.0%}–{x2:.0%}，y {y:.0%}–{y2:.0%}）", "{w} (x {x:.0%}–{x2:.0%}, y {y:.0%}–{y2:.0%})",
              w=_where(b), x=b[0], x2=b[0] + b[2], y=b[1], y2=b[1] + b[3]),
            what + T("，", ", ") + T("，", ", ").join(how)]
    if ev.get("colour"):
        bits.append(ev["colour"])
    if ev.get("text"):
        bits.append(T("文字「{t}」", "text “{t}”", t=" / ".join(ev["text"])))
    if ev.get("crop"):
        bits.append(f"[{T('截图', 'crop')}]({ev['crop']})")
    return " · ".join(bits)


SHAPE_WORDS = {"hline": ("横线", "horizontal line"), "vline": ("竖线", "vertical line"), "block": ("图形/文字块", "shape / text block")}


def static_line(el: dict) -> str:
    b = el["box"]
    bits = [T(*SHAPE_WORDS[el["shape"]]), T("x {x:.0%}–{x2:.0%}，y {y:.0%}–{y2:.0%}", "x {x:.0%}–{x2:.0%}, y {y:.0%}–{y2:.0%}",
                                            x=b[0], x2=b[0] + b[2], y=b[1], y2=b[1] + b[3]), el["colour"]]
    if el.get("text"):
        bits.append(T("文字「{t}」", "text “{t}”", t=" / ".join(el["text"])))
    if el.get("crop"):
        bits.append(f"[{T('截图', 'crop')}]({el['crop']})")
    return " · ".join(bits)


def layer_line(layer: dict) -> str:
    b = layer["box"]
    crops = " ".join(f"[{T('截图', 'crop')} L{k}]({c})" for k, c in enumerate(layer.get("crops") or [], 1))
    return (crops + " · " if crops else "") + T("持续运动层：{s:.0%} 的画面整镜都在动（x {x:.0%}–{x2:.0%}，y {y:.0%}–{y2:.0%}），如漂移的渐变、粒子流、辉光呼吸",
             "Continuous layer: {s:.0%} of the frame moves through the whole shot (x {x:.0%}–{x2:.0%}, y {y:.0%}–{y2:.0%}), "
             "e.g. drifting gradients, particle flow, breathing glow",
             s=layer["share"], x=b[0], x2=b[0] + b[2], y=b[1], y2=b[1] + b[3])


def palette(bgr: np.ndarray, k: int = 8, min_share: float = 0.01) -> dict:
    """Background colour (most common along the border) and the main colours with their share, as hex."""
    small = cv2.resize(bgr, (96, max(1, int(96 * bgr.shape[0] / bgr.shape[1]))), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    k = min(k, len(np.unique(lab, axis=0)))
    if k < 1:
        return {"background": None, "colours": []}
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    cv2.setRNGSeed(0)  # k-means++ seeding draws from OpenCV's per-thread RNG: fix it so reruns give the same colours
    _, lbl, centers = cv2.kmeans(lab, k, None, crit, 2, cv2.KMEANS_PP_CENTERS)
    lbl = lbl.ravel()
    share = np.bincount(lbl, minlength=k) / len(lbl)
    hexes = [_hex(cv2.cvtColor(np.uint8([[c]]), cv2.COLOR_LAB2BGR)[0, 0]) for c in centers]
    grid = lbl.reshape(small.shape[:2])
    border = np.concatenate([grid[0], grid[-1], grid[:, 0], grid[:, -1]])
    bg = int(np.bincount(border, minlength=k).argmax())
    order = [int(i) for i in np.argsort(-share) if share[i] >= min_share]
    return {"background": hexes[bg], "colours": [{"hex": hexes[i], "share": round(float(share[i]), 2)} for i in order]}


def strip_frames(path: str | Path, info: VideoInfo, start: float, dur: float, every: float = 0.5, most: int = 12,
                 width: int = 270) -> tuple[list[np.ndarray], list[float]]:
    """Frames every `every` seconds (at most `most`, spread evenly) for a time-labelled key-frame strip."""
    step = max(every, dur / most)
    frames = list(iter_frames(path, info, width, start=start, duration=dur, fps=1.0 / step))
    times = [start + i * step for i in range(len(frames))]
    return frames[:most], times[:most]


def element_crops(path: str | Path, info: VideoInfo, start: float, end: float, motion: dict, out_dir: Path, sid: str,
                  width: int, most: int = 16) -> str | None:
    """Cut every measured element out of the full-size picture once it has settled (a disappearing one just before it
    goes, a static one at the end of the shot): shots/<sid>_el_NN.jpg, linked from its timeline line, plus a numbered
    contact sheet shots/<sid>_elements.jpg. One decode of the shot at 10 fps. Returns the sheet's file name."""
    step = 0.1
    want: dict[int, list[tuple[str, dict]]] = {}
    items = ([("el", k + 1, e) for k, e in enumerate(motion.get("events", [])[:most])]
             + [("st", k + 1, e) for k, e in enumerate(motion.get("static", [])[:most // 2])])
    if motion.get("layer") and motion["layer"]["share"] >= 0.03:
        # the continuously moving layer is often the subject itself (particle figure, drifting gradient): mid-shot and end
        items += [("ly", 1, {**motion["layer"], "_t": (start + end) / 2}), ("ly", 2, {**motion["layer"], "_t": end - 0.05})]
    last_i = max(0, int((end - start) / step) - 1)
    for tag, k, e in items:
        if tag == "ly":
            t = e["_t"]
        elif tag == "st":
            t = end - 0.05
        elif e["kind"] == "disappear":
            t = e["t0"] - 0.05
        else:
            t = min(end - 0.05, e["t1"] + 0.1)
        i = min(last_i, max(0, int(round((t - start) / step))))
        want.setdefault(i, []).append((tag, k, e))
    if not want:
        return None
    out_dir.mkdir(parents=True, exist_ok=True)
    cells = []
    for i, fr in enumerate(iter_frames(path, info, width, start=start, duration=end - start, fps=1 / step)):
        if i > max(want):
            break
        for tag, k, e in want.get(i, []):
            h, w = fr.shape[:2]
            x, y, bw, bh = e["box"]
            pad = 0.015
            x0, y0 = max(0, int((x - pad) * w)), max(0, int((y - pad) * h))
            x1, y1 = min(w, int((x + bw + pad) * w)), min(h, int((y + bh + pad) * h))
            if x1 - x0 < 4 or y1 - y0 < 4:
                continue
            name = f"{sid}_{tag}_{k:02d}.jpg"
            crop = fr[y0:y1, x0:x1]
            write_image(out_dir / name, crop, [cv2.IMWRITE_JPEG_QUALITY, 94])
            if tag == "ly":
                motion["layer"].setdefault("crops", []).append(f"shots/{name}")
            else:
                e["crop"] = f"shots/{name}"
            cells.append((({"ly": 0, "el": 1, "st": 2}[tag], k), {"ly": "L", "el": "", "st": "S"}[tag] + str(k), crop))
    if not cells:
        return None
    cells = [(label, im) for _, label, im in sorted(cells, key=lambda c: c[0])]
    # numbered contact sheet: element numbers match the timeline (S = static element)
    ch = 150
    tiles = []
    for label, im in cells:
        sc = ch / im.shape[0]
        tw = int(min(360, max(40, im.shape[1] * sc)))
        tile = np.full((ch + 22, tw, 3), 24, np.uint8)
        tile[22:] = cv2.resize(im, (tw, ch))
        cv2.putText(tile, label, (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(tile)
    rows, row, row_w = [], [], 0
    for t in tiles:
        if row and row_w + t.shape[1] > 1200:
            rows.append(row)
            row, row_w = [], 0
        row.append(t)
        row_w += t.shape[1] + 4
    rows.append(row)
    W_ = max(sum(t.shape[1] + 4 for t in r) for r in rows)
    sheet = np.full((len(rows) * (ch + 26), W_, 3), 24, np.uint8)
    for ri, r in enumerate(rows):
        x = 0
        for t in r:
            sheet[ri * (ch + 26): ri * (ch + 26) + ch + 22, x:x + t.shape[1]] = t
            x += t.shape[1] + 4
    name = f"{sid}_elements.jpg"
    write_image(out_dir / name, sheet, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return f"shots/{name}"
