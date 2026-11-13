"""Packaging layer (剪辑包装): what an editor puts on top of the picture, on one timeline.

1. Text cues: OCR over the whole video (about 2 frames/s), lines grouped into blocks (multi-line subtitles),
   blocks tracked over time into cues with start / end. A dense grey pass (about 10 frames/s) then refines
   each cue's start / end and reads its entrance / exit animation (cut-in, pop / scale, fade, slide,
   typewriter reveal). Each cue gets a style read from its pixels (fill / stroke / box colours, gradient,
   two-colour keyword highlight, size, tilt) and a kind:
     subtitle  a lane of changing lines at a fixed place
     huazi     花字: decorative text (large, coloured, tilted, thick stroke, multi-colour, pop-in)
     title     long-lived text at the top
     label     other overlay text (chapter cards, captions, tags; "follows" when it moves with an object)
     scene     words printed on things in the picture (moves with the picture, no stroke / box)
2. Stickers: regions that appear and disappear mid-shot as a block, or survive a cut while the rest of the
   frame changes. Inside: animated (GIF / 表情包, looping or not), static (sticker / picture) or a
   picture-in-picture video.
3. Sound effects lined up with what happens on screen (text pops, sticker entrances, cuts), and extra
   SFX candidates found at those moments (a transient right on a visual event is much more likely an
   added sound effect than one in the middle of speech).

Everything here is deterministic and best effort: styles and animations are measured, not read, so a VLM
or the agent's look at the frames still settles fine typography (font family) and odd cases."""
from __future__ import annotations

from .i18n import LangDict, T, join

import re
from difflib import SequenceMatcher
from pathlib import Path

import cv2
import numpy as np

from .media import VideoInfo, extract_frame, iter_frames
from .overlay import get_ocr
from .util import LOG, read_image, write_image

OCR_FPS = 2.0
OCR_MAX = 240            # OCR calls per video (~0.2 s each)
DENSE_FPS = 10.0
DENSE_MAX = 1800         # dense grey frames per video
DENSE_W = 360
SMALL_W = 160            # sticker search resolution
CELL = 8                 # sticker search cell size (px at SMALL_W)
MIN_CONF = 0.6

KIND_ZH = LangDict({"subtitle": "字幕", "huazi": "花字", "title": "标题", "label": "文字标注", "counter": "数字计数", "scene": "画面里的字"},
                   en={"subtitle": "subtitle", "huazi": "styled text", "title": "title", "label": "text label", "counter": "counter",
                       "scene": "text in the scene"})
ANIM_ZH = LangDict({"cut": "直接出现", "pop": "缩放弹出", "fade": "淡入", "slide": "滑入", "reveal": "逐字出现",
                    "cut_out": "直接消失", "pop_out": "缩小消失", "fade_out": "淡出", "slide_out": "滑出"},
                   en={"cut": "hard in", "pop": "scale pop", "fade": "fade in", "slide": "slide in", "reveal": "type-on",
                       "cut_out": "hard out", "pop_out": "shrink out", "fade_out": "fade out", "slide_out": "slide out"})
STICKER_ZH = LangDict({"animated_sticker": "动态贴纸/GIF", "static_sticker": "静态贴纸/图片", "pip": "画中画小窗"},
                      en={"animated_sticker": "animated sticker / GIF", "static_sticker": "static sticker / image", "pip": "picture-in-picture"})
COLOR_ZH = LangDict({"black": "黑", "white": "白", "grey": "灰", "red": "红", "brown": "棕", "orange": "橙", "yellow": "黄", "green": "绿",
                     "cyan": "青", "blue": "蓝", "purple": "紫", "pink": "粉"},
                    en={"black": "black", "white": "white", "grey": "grey", "red": "red", "brown": "brown", "orange": "orange", "yellow": "yellow",
                        "green": "green", "cyan": "cyan", "blue": "blue", "purple": "purple", "pink": "pink"})
BAND_ZH = LangDict({"top": "顶部", "middle": "中部", "bottom": "底部"}, en={"top": "top", "middle": "middle", "bottom": "bottom"})
EVENT_ZH = LangDict({"subtitle_in": "字幕出现", "huazi_in": "花字出现", "title_in": "标题出现", "label_in": "文字标注出现",
                     "sticker_in": "贴纸出现", "sticker_out": "贴纸消失", "cut": "切镜"},
                    en={"subtitle_in": "subtitle in", "huazi_in": "styled text in", "title_in": "title in", "label_in": "text label in",
                        "sticker_in": "sticker in", "sticker_out": "sticker out", "cut": "cut"})


# ----------------------------------------------------------------------------- colour helpers

def color_name(bgr) -> str:
    return COLOR_ZH[_color_code(bgr)]


def _color_code(bgr) -> str:
    b, g, r = (int(v) for v in bgr)
    hsv = cv2.cvtColor(np.uint8([[[b, g, r]]]), cv2.COLOR_BGR2HSV)[0, 0]
    h, s, v = int(hsv[0]) * 2, int(hsv[1]), int(hsv[2])
    if v < 55:
        return "black"
    if s < 40:
        return "white" if v > 200 else "grey"
    if s < 90 and v < 150:
        return "grey"
    if h < 12 or h >= 340:
        return "red" if v > 110 else "brown"
    if h < 40:
        return "orange" if v > 150 else "brown"
    if h < 68:
        return "yellow"
    if h < 165:
        return "green"
    if h < 195:
        return "cyan"
    if h < 255:
        return "blue"
    if h < 295:
        return "purple"
    return "pink"


def _hex(bgr) -> str:
    b, g, r = (int(round(float(v))) for v in bgr)
    return f"#{r:02x}{g:02x}{b:02x}"


def text_style(frame: np.ndarray, box: tuple[int, int, int, int], rendered: bool = False) -> dict | None:
    """Colours and decoration of one OCR'd text line. box = (x0, y0, x1, y1) in frame pixels.
    Glyph fill = colour blobs inside the box that do not reach the ring around it (letters are closed shapes;
    the background between them connects to the outside). Stroke = the colour that surrounds those blobs, when
    it differs from the background. Works on busy backgrounds where the fill colour also occurs in the scene.
    rendered=True: the text sits on a code-rendered / recorded picture (plain or gradient grounds), where the ground
    showing through closed glyph counters is read as the fill or a highlight and anti-aliasing as an outline; those
    readings are corrected. Not used on footage / AI pictures, where white subtitles with dark outlines over bright
    scenes would be mistaken for dark text."""
    H, W = frame.shape[:2]
    x0, y0, x1, y1 = box
    lh = max(4, y1 - y0)
    pad = max(3, int(0.35 * lh))
    X0, Y0, X1, Y1 = max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)
    crop = frame[Y0:Y1, X0:X1]
    if crop.size == 0 or crop.shape[0] < 6 or crop.shape[1] < 6:
        return None
    ch, cw = crop.shape[:2]
    inner = np.zeros((ch, cw), bool)
    inner[max(0, y0 - Y0):y1 - Y0, max(0, x0 - X0):x1 - X0] = True
    ring = ~inner
    if ring.sum() < 20 or inner.sum() < 30:
        return None
    lab3 = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab = lab3.reshape(-1, 3)
    # cluster mostly on the text box itself so the glyph colours are not outvoted by a light background
    rng = np.random.default_rng(0)
    inner_px, ring_px = lab[inner.ravel()], lab[ring.ravel()]
    pts = np.concatenate([inner_px[rng.choice(len(inner_px), min(len(inner_px), 4000), replace=False)],
                          ring_px[rng.choice(len(ring_px), min(len(ring_px), 1000), replace=False)]])
    k = 6
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    cv2.setRNGSeed(0)  # k-means++ seeding draws from OpenCV's per-thread RNG: fix it so reruns give the same colours
    _, _, centers = cv2.kmeans(pts, k, None, crit, 2, cv2.KMEANS_PP_CENTERS)
    lbl = np.argmin(((lab[:, None, :] - centers[None]) ** 2).sum(-1), axis=1).reshape(ch, cw)
    # enclosed pixels per colour: connected blobs that stay inside the box
    enclosed = np.zeros(k)
    enc_mask = np.zeros((ch, cw), np.int32) - 1
    for c in range(k):
        m = (lbl == c).astype(np.uint8)
        n, cc, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=4)
        touch = np.unique(cc[ring & (m > 0)])
        for j in range(1, n):
            if j in touch or stats[j, cv2.CC_STAT_AREA] < 3:
                continue
            enclosed[c] += stats[j, cv2.CC_STAT_AREA]
            enc_mask[cc == j] = c
    if enclosed.sum() < 0.02 * inner.sum():
        return None
    fill = int(np.argmax(enclosed))
    # thin glyphs with a thick outline: the outline can cover more pixels than the fill. The fill is the colour
    # that the other one wraps around.
    def spread(c: int) -> float:
        """Share of the line's columns where this colour has solid strokes (a keyword covers a stretch, the fill
        the whole line; an anti-aliased rim has no solid strokes)."""
        m = (enc_mask == c).astype(np.uint8)
        solid = cv2.distanceTransform(m, cv2.DIST_L2, 3) >= 1.5
        cols = solid[:, max(0, x0 - X0):x1 - X0].any(axis=0)
        return float(cols.mean()) if cols.size else 0.0

    # background = the ring's main colours where they connect to the outside; the fill sits deeper inside the
    # glyphs than its outline does
    ring_share0 = np.bincount(lbl[ring], minlength=k) / max(1, ring.sum())
    bg_mask = (enc_mask == -1) & np.isin(lbl, [c for c in range(k) if ring_share0[c] >= 0.2])

    def bg_contact(c: int) -> float:
        """Share of the colour's rim (2 px out, past anti-aliasing) lying on the background: an outline borders
        it, the fill inside an outline does not."""
        m = (enc_mask == c).astype(np.uint8)
        rim = cv2.dilate(m, np.ones((5, 5), np.uint8)).astype(bool) & ~cv2.dilate(m, np.ones((3, 3), np.uint8)).astype(bool)
        return float(bg_mask[rim].mean()) if rim.sum() else 1.0

    top = [int(c) for c in np.argsort(-enclosed)[:4] if enclosed[c] >= 0.08 * enclosed.max()]
    sp = {c: spread(c) for c in top}
    wide = [c for c in top if sp[c] >= 0.5 * max(sp.values())] or top
    fill = min(wide, key=lambda c: (round(bg_contact(c), 1), -sp[c])) if bg_mask.any() else max(wide, key=lambda c: sp[c])
    bgr_of = lambda c: cv2.cvtColor(np.uint8([[centers[c]]]), cv2.COLOR_LAB2BGR)[0, 0]  # noqa: E731
    out: dict = {"fill": _hex(bgr_of(fill)), "fill_name": color_name(bgr_of(fill))}
    fm = (enc_mask == fill)
    # what surrounds the fill blobs, 2 px out (skips the anti-aliased rim)
    d1 = cv2.dilate(fm.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    d2 = cv2.dilate(fm.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    halo = d2 & ~d1 & (enc_mask != fill)
    neigh = np.bincount(lbl[halo], minlength=k) / max(1, halo.sum())
    ring_share = np.bincount(lbl[ring], minlength=k) / max(1, ring.sum())

    def contrast(a: int, b: int) -> float:
        return abs(float(centers[a][0] - centers[b][0])) + 0.5 * float(np.linalg.norm(centers[a][1:] - centers[b][1:]))

    cands = [c for c in range(k) if c != fill and contrast(c, fill) > 30]
    s_c = max(cands, key=lambda c: neigh[c]) if cands else None
    # a stroke is a colour hugging the glyphs that is not just "the background": it is much rarer in the ring
    # than right around the glyphs
    if s_c is not None and neigh[s_c] >= 0.4 and neigh[s_c] > 2.0 * ring_share[s_c]:
        sm = (lbl == s_c) & cv2.dilate(fm.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool) & ~fm
        perim = max(1.0, float((d1 & ~fm).sum()))
        ratio = float(sm.sum()) / perim / lh
        bg_c = int(np.argmax(ring_share))
        if rendered and ring_share[bg_c] >= 0.6 and contrast(fill, bg_c) < 12 and contrast(s_c, bg_c) > 60:
            # the "fill" is the background showing through closed glyph counters (口, 日, 回) and the "outline" is
            # the text itself: dark text on a plain light ground (or the reverse)
            fill = s_c
            fm = enc_mask == fill if (enc_mask == s_c).any() else (lbl == s_c)
            out.update(fill=_hex(bgr_of(fill)), fill_name=color_name(bgr_of(fill)))
            s_c = None
        elif rendered and ratio < 0.01:  # a one-pixel tint around the glyphs is anti-aliasing against the ground
            s_c = None
        else:
            out.update(stroke=_hex(bgr_of(s_c)), stroke_name=color_name(bgr_of(s_c)), stroke_ratio=round(ratio, 3))
    else:
        s_c = None
    # a second enclosed colour far from the fill, with solid strokes of its own (not an anti-aliased rim):
    # keyword highlight / two-colour title
    core = lambda m: float((cv2.distanceTransform(m.astype(np.uint8), cv2.DIST_L2, 3) >= 1.5).sum())  # noqa: E731
    fill_core = core(fm) / max(1.0, float(fm.sum()))
    for c in np.argsort(-enclosed):
        c = int(c)
        if c in (fill, s_c) or enclosed[c] < 0.12 * enclosed[fill]:
            continue
        cm = enc_mask == c
        if core(cm) / max(1.0, float(cm.sum())) < 0.5 * fill_core:
            continue
        # the ground seen through closed glyph counters (口, 日, o) is a ring colour, not a second text colour
        if rendered and any(ring_share[x] >= 0.2 and contrast(c, x) < 15 for x in range(k)):
            continue
        # a colour between the fill and the stroke / background in lightness with the same hue is an edge blend
        others_l = [float(centers[x][0]) for x in range(k) if x != fill and (x == s_c or ring_share[x] > 0.2)]
        between = any(min(float(centers[fill][0]), o_) <= float(centers[c][0]) <= max(float(centers[fill][0]), o_) for o_ in others_l)
        if float(np.linalg.norm(centers[c][1:] - centers[fill][1:])) > 25 or (not between and abs(float(centers[c][0] - centers[fill][0])) > 60):
            out.update(multicolor=True, highlight=_hex(bgr_of(c)), highlight_name=color_name(bgr_of(c)))
            break
    # gradient: lightness / hue of the fill pixels drift along y or x
    fy, fx = np.nonzero(fm)
    if len(fy) > 40:
        fl = lab3[fy, fx]
        for coord in (fy, fx):
            if coord.std() > 1:
                for chn in (0, 2):
                    if fl[:, chn].std() < 3:
                        continue
                    r = float(np.corrcoef(coord, fl[:, chn])[0, 1])
                    span = abs(float(np.polyfit(coord, fl[:, chn], 1)[0])) * float(np.ptp(coord))
                    if abs(r) > 0.55 and span > 28:
                        out["gradient"] = True
    # box (底框 / pill): the strips just left and right of the text (inside a pill's side margins) are one
    # uniform colour that differs from what lies further out
    def strip(xa: int, xb: int, ya: int, yb: int):
        xa, xb, ya, yb = max(0, xa), min(W, xb), max(0, ya), min(H, yb)
        if xb - xa < 2 or yb - ya < 2:
            return None
        return cv2.cvtColor(frame[ya:yb, xa:xb], cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)

    ya, yb = y0 + int(0.25 * lh), y1 - int(0.25 * lh)
    near = [strip(x0 - int(0.28 * lh), x0 - int(0.06 * lh), ya, yb), strip(x1 + int(0.06 * lh), x1 + int(0.28 * lh), ya, yb)]
    far = [strip(x0 - int(1.7 * lh), x0 - int(1.2 * lh), ya, yb), strip(x1 + int(1.2 * lh), x1 + int(1.7 * lh), ya, yb),
           strip(x0, x1, y0 - int(1.3 * lh), y0 - int(0.9 * lh)), strip(x0, x1, y1 + int(0.9 * lh), y1 + int(1.3 * lh))]
    # (a tight pill can end right at the last glyph on one side: one uniform side is enough)
    def uniform_(px: np.ndarray) -> bool:  # most pixels one colour (anti-aliased glyph edges may poke in)
        return float((np.linalg.norm(px - np.median(px, axis=0), axis=1) < 10).mean()) >= 0.7

    near = [n_ for n_ in near if n_ is not None and len(n_) >= 6 and uniform_(n_)]
    near = [n_[np.linalg.norm(n_ - np.median(n_, axis=0), axis=1) < 10] for n_ in near]
    far = [f_ for f_ in far if f_ is not None and len(f_) >= 6]
    if near and far:
        meds = [np.median(n_, axis=0) for n_ in near]
        uniform = len(meds) == 1 or float(np.linalg.norm(meds[0] - meds[1])) < 12
        box_lab = np.mean(meds, axis=0)
        if uniform and min(float(np.linalg.norm(np.median(f_, axis=0) - box_lab)) for f_ in far) > (18 if len(meds) == 2 else 25):
            bcol = cv2.cvtColor(np.uint8([[box_lab]]), cv2.COLOR_LAB2BGR)[0, 0]
            if float(np.linalg.norm(box_lab - centers[fill])) > 25:
                out.update(box=True, box_color=_hex(bcol), box_name=color_name(bcol))
                for key in ("stroke", "highlight"):  # the box seen through glyph holes / around the glyphs is not a text colour
                    if out.get(key):
                        kc = cv2.cvtColor(np.uint8([[[int(out[key][5:7], 16), int(out[key][3:5], 16), int(out[key][1:3], 16)]]]),
                                          cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)
                        if float(np.linalg.norm(kc - box_lab)) < 22:
                            for kk in [x for x in list(out) if x.startswith(key) or (key == "highlight" and x == "multicolor")]:
                                out.pop(kk)
    # weight: glyph stroke thickness relative to the line height
    dt = cv2.distanceTransform(fm.astype(np.uint8), cv2.DIST_L2, 3)
    if (dt > 0).sum() > 20:
        out["weight"] = round(2 * float(np.percentile(dt[dt > 0], 90)) / lh, 3)
    return out


# ----------------------------------------------------------------------------- OCR pass

def _norm(s: str) -> str:
    return re.sub(r"[\s，。、,.!！?？:：;；·•'\"“”‘’/\-—_~（）()\[\]【】]", "", s).lower()


def _similar(a: str, b: str) -> float:
    a, b = _norm(a), _norm(b)
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b, autojunk=False).ratio()


def _band(cy: float) -> str:
    return "top" if cy < 0.22 else ("bottom" if cy > 0.70 else "middle")


def ocr_pass(path: str | Path, info: VideoInfo, max_calls: int = OCR_MAX) -> tuple[list[dict], float]:
    """OCR the whole video at a fixed rate. Returns (items, step_seconds). Frames that did not change since the
    last OCR'd frame reuse its result."""
    ocr = get_ocr()
    if ocr is None or info.duration <= 0:
        return [], 0.0
    fps = min(OCR_FPS, max(0.5, max_calls / info.duration))
    portrait = (info.height > info.width) != (info.rotation in (90, 270))
    width = 720 if portrait else 1280
    items: list[dict] = []
    prev_small, prev = None, []
    for i, f in enumerate(iter_frames(path, info, width, fps=fps)):
        t = round(i / fps, 3)
        H, W = f.shape[:2]
        small = cv2.resize(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), (192, max(16, int(192 * H / W) // 8 * 8)), interpolation=cv2.INTER_AREA)
        # reuse the last result only if no 8x8 block changed (a new subtitle line is a small local change)
        if prev_small is not None and small.shape == prev_small.shape and float(
                cv2.absdiff(small, prev_small).reshape(small.shape[0] // 8, 8, small.shape[1] // 8, 8).mean(axis=(1, 3)).max()) < 2.0:
            items += [dict(it, t=t) for it in prev]
            continue
        prev_small = small
        try:
            res, _ = ocr(f)
        except Exception as exc:  # pragma: no cover
            LOG.debug("ocr failed at %.2f: %s", t, exc)
            res = None
        cur = []
        for box, text, conf in res or []:
            if float(conf) < MIN_CONF or not re.search(r"[\w一-鿿]", text):
                continue
            pts = np.array(box, dtype=np.float32)
            x0, y0 = pts.min(axis=0)
            x1, y1 = pts.max(axis=0)
            ang = float(np.degrees(np.arctan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0])))
            bx = (int(x0), int(y0), int(x1), int(y1))
            cur.append({"t": t, "text": text, "conf": round(float(conf), 3),
                        "bbox": [round(x0 / W, 4), round(y0 / H, 4), round((x1 - x0) / W, 4), round((y1 - y0) / H, 4)],
                        "angle": round(ang, 1), "style": text_style(f, bx)})
        prev = cur
        items += cur
    return items, 1.0 / fps


def _blocks(items: list[dict]) -> list[dict]:
    """Lines OCR'd at the same moment that stack into one block (a two-line subtitle)."""
    lines = sorted(items, key=lambda d: d["bbox"][1])
    blocks: list[dict] = []
    for it in lines:
        x, y, w, h = it["bbox"]
        cx = x + w / 2
        hit = None
        for b in blocks:
            last = b["lines"][-1]
            lx, ly, lw, lh = last["bbox"]
            gap = y - (ly + lh)
            same_look = not (it.get("style") and last.get("style")) or it["style"].get("fill_name") == last["style"].get("fill_name")
            if (-0.3 * lh < gap < 0.8 * max(h, lh) and abs(cx - (lx + lw / 2)) < 0.12 and 0.8 < h / max(1e-6, lh) < 1.25
                    and same_look):
                hit = b
                break
        if hit is None:
            blocks.append({"lines": [it]})
        else:
            hit["lines"].append(it)
    out = []
    for b in blocks:
        ls = b["lines"]
        x0 = min(l["bbox"][0] for l in ls)
        y0 = min(l["bbox"][1] for l in ls)
        x1 = max(l["bbox"][0] + l["bbox"][2] for l in ls)
        y1 = max(l["bbox"][1] + l["bbox"][3] for l in ls)
        out.append({"t": ls[0]["t"], "text": "/".join(l["text"] for l in ls), "conf": float(np.mean([l["conf"] for l in ls])),
                    "bbox": [x0, y0, x1 - x0, y1 - y0], "line_h": float(np.median([l["bbox"][3] for l in ls])),
                    "n_lines": len(ls), "angle": float(np.median([l["angle"] for l in ls])),
                    "styles": [l["style"] for l in ls if l.get("style")]})
    return out


def _numbers(s: str) -> tuple[str, tuple[str, ...]]:
    n = _norm(s)
    return re.sub(r"\d+", "#", n), tuple(re.findall(r"\d+", n))


def _split_numbered(c: dict) -> list[dict]:
    """Same words, different number (SHOT 01 → SHOT 02, 第 1 步 → 第 2 步) read for two samples or more in a row:
    one label per shot, not one cue. A number misread in a single frame stays part of its run."""
    runs: list[list] = []
    for o in c["obs"]:
        skel, nums = _numbers(o["text"])
        key = (skel, nums) if nums else None
        if runs and (key is None or runs[-1][0] == key):
            runs[-1][1].append(o)
        else:
            runs.append([key, [o]])
    stable = [i for i, (key, obs) in enumerate(runs) if key is not None and len(obs) >= 2]
    if len(stable) < 2:  # a number ticking every frame is a counter, one cue
        return [c]
    merged: list[list] = []
    for i, (key, obs) in enumerate(runs):  # one-sample readings join the stable run before (the first one: after)
        if i in stable and not (merged and merged[-1][0] == key):
            merged.append([key, list(obs)])
        elif merged:
            merged[-1][1] += obs
        else:
            runs[stable[0]][1][:0] = obs
    if len(merged) < 2 or len({k[0] for k, _ in merged if k}) != 1:
        return [c]
    out = []
    for _, obs in merged:
        votes: dict[str, int] = {}
        for o in obs:
            votes[o["text"]] = votes.get(o["text"], 0) + 1
        text = max(votes, key=votes.get)
        out.append({**c, "obs": obs, "first": obs[0]["t"], "last": obs[-1]["t"], "text": text,
                    "conf": max(o["conf"] for o in obs if o["text"] == text), "reveal": False})
    return out


def build_cues(items: list[dict], step: float) -> list[dict]:
    """Track text blocks over time: same place + same words = one cue; same place, new words = the next cue."""
    by_t: dict[float, list[dict]] = {}
    for it in items:
        by_t.setdefault(it["t"], []).append(it)
    cues: list[dict] = []
    open_: list[dict] = []
    for t in sorted(by_t):
        for c in [c for c in open_ if c["last"] < t - 2.5 * step]:
            open_.remove(c)
        for b in _blocks(by_t[t]):
            x, y, w, h = b["bbox"]
            cx, cy = x + w / 2, y + h / 2
            best, best_d = None, 9.0
            for c in open_:
                if c["last"] >= t:
                    continue
                d = abs(cy - c["cy"]) / max(0.02, c["line_h"]) + abs(cx - c["cx"]) * 4
                if abs(cy - c["cy"]) < max(0.03, 0.8 * c["line_h"]) + 0.02 and abs(cx - c["cx"]) < 0.2 and d < best_d:
                    best, best_d = c, d
            if best is not None:
                sim = _similar(b["text"], best["text"])
                grow = len(_norm(b["text"])) > len(_norm(best["text"])) and _norm(b["text"]).startswith(_norm(best["text"])[:max(1, len(_norm(best["text"])) - 1)])
                if sim >= 0.6 or grow:
                    if grow and sim < 0.9:
                        best["reveal"] = True
                    best["obs"].append(b)
                    best["last"] = t
                    if grow:
                        best["text"], best["conf"] = b["text"], b["conf"]
                    continue
                open_.remove(best)  # same place, new words: the previous cue ended
            c = {"text": b["text"], "conf": b["conf"], "first": t, "last": t, "cx": cx, "cy": cy, "line_h": b["line_h"], "obs": [b]}
            cues.append(c)
            open_.append(c)
    # a one-sample cue right before another at the same place is that text mid-entrance (scaling / blurred / half
    # typed) misread by OCR: fold it into the next one
    cues.sort(key=lambda c: c["first"])
    merged_into: set[int] = set()
    for i, c in enumerate(cues):
        if len(c["obs"]) != 1:
            continue
        for j in range(i + 1, len(cues)):
            o = cues[j]
            if o["first"] - c["last"] > 1.6 * step:
                break
            entering = c["line_h"] < 0.85 * o["line_h"] or _similar(c["text"], o["text"]) >= 0.4  # still scaling in / half read
            if (abs(o["cy"] - c["cy"]) < max(0.03, 0.8 * o["line_h"]) and abs(o["cx"] - c["cx"]) < 0.15 and len(o["obs"]) >= 2
                    and entering):
                o["obs"] = c["obs"] + o["obs"]
                o["first"] = c["first"]
                o["entrance_misread"] = True
                merged_into.add(i)
                break
    cues = [c for i, c in enumerate(cues) if i not in merged_into]
    # the same words at the same place with a short gap (OCR missed a sample, a transition dimmed it): one cue
    cues.sort(key=lambda c: c["first"])
    keep: list[dict] = []
    for c in cues:
        prev = next((o for o in reversed(keep) if abs(o["cy"] - c["cy"]) < max(0.03, 0.8 * o["line_h"])
                     and abs(o["cx"] - c["cx"]) < 0.15 and c["first"] - o["last"] <= 1.0 + 1e-6 and o["last"] < c["first"]), None)
        if prev is not None and _similar(prev["text"], c["text"]) >= 0.8:
            prev["obs"] += c["obs"]
            prev["last"] = c["last"]
            continue
        keep.append(c)
    cues = [p for c in keep for p in _split_numbered(c)]
    out = []
    for c in cues:
        obs = c["obs"]
        if not c.get("reveal"):  # the reading seen most often (OCR varies frame to frame)
            votes: dict[str, list[float]] = {}
            for o in obs:
                votes.setdefault(o["text"], []).append(o["conf"])
            c["text"] = max(votes, key=lambda k: (len(votes[k]), max(votes[k])))
            c["conf"] = max(votes[c["text"]])
        boxes = np.array([o["bbox"] for o in obs])
        centers = boxes[:, :2] + boxes[:, 2:] / 2
        x0, y0 = boxes[:, 0].min(), boxes[:, 1].min()
        x1, y1 = (boxes[:, 0] + boxes[:, 2]).max(), (boxes[:, 1] + boxes[:, 3]).max()
        styles = [s for o in obs for s in o["styles"]]
        out.append({
            "t0": c["first"], "t1": round(c["last"] + step, 3), "text": c["text"], "conf": round(c["conf"], 3),
            "bbox": [round(float(v), 4) for v in (x0, y0, x1 - x0, y1 - y0)],
            "bbox_median": [round(float(v), 4) for v in np.median(boxes, axis=0)],
            "line_h": round(float(np.median([o["line_h"] for o in obs])), 4),
            "n_lines": int(max(o["n_lines"] for o in obs)), "angle": round(float(np.median([o["angle"] for o in obs])), 1),
            "drift": round(float(np.ptp(centers, axis=0).max()), 4) if len(obs) > 1 else 0.0,
            "samples": len(obs), "reveal": bool(c.get("reveal")),
            "style_obs": styles, "first_style_multicolor": bool(obs[0]["styles"] and any(s.get("multicolor") for s in obs[0]["styles"])),
        })
    return out


# ----------------------------------------------------------------------------- style summary + kind

def merge_style(styles: list[dict]) -> dict:
    if not styles:
        return {}
    def vote(key):
        vals = [s.get(key) for s in styles if s.get(key)]
        return max(dict.fromkeys(vals), key=vals.count) if vals else None  # ties: first seen (set order varies per run)
    n = len(styles)
    out = {"fill_name": vote("fill_name"), "fill": vote("fill")}
    stroked = [s for s in styles if s.get("stroke")]
    if len(stroked) >= max(1, 0.5 * n):
        names = [s["stroke_name"] for s in stroked]
        out.update(stroke_name=max(dict.fromkeys(names), key=names.count),
                   stroke=stroked[0]["stroke"], stroke_ratio=round(float(np.median([s["stroke_ratio"] for s in stroked])), 3))
    boxed = [s for s in styles if s.get("box")]
    if len(boxed) >= max(1, 0.5 * n):
        out.update(box=True, box_name=vote("box_name"), box_color=boxed[0]["box_color"])
    if sum(1 for s in styles if s.get("gradient")) >= max(1, 0.5 * n):
        out["gradient"] = True
    multi = [s for s in styles if s.get("multicolor")]
    if multi and len(multi) >= 0.25 * n:
        hl = [s["highlight_name"] for s in multi]
        out.update(multicolor=True, highlight_name=max(dict.fromkeys(hl), key=hl.count))
    w = [s["weight"] for s in styles if s.get("weight")]
    if w:
        out["weight"] = round(float(np.median(w)), 3)
    return out


def style_text(st: dict, line_h: float | None = None, frame_h: int | None = None) -> str:
    if not st:
        return ""
    parts = [T("{c}字", "{c} text", c=st.get('fill_name', '?'))]
    if st.get("stroke"):
        parts.append(T("{c}描边", "{c} outline", c=st['stroke_name']))
    if st.get("box"):
        parts.append(T("{c}底框", "{c} box", c=st.get('box_name', '')).strip())
    if st.get("gradient"):
        parts.append(T("渐变", "gradient"))
    if st.get("multicolor"):
        parts.append(T("关键词{c}色高亮", "keywords highlighted in {c}" if st.get('highlight_name') else "keyword highlight", c=st.get('highlight_name', '')))
    if st.get("weight", 0) > 0.2:
        parts.append(T("粗体", "bold"))
    if line_h:
        parts.append(T("字高 {h:.1%}", "line height {h:.1%}", h=line_h) + (T("（约 {px:.0f}px）", " (about {px:.0f}px)", px=line_h * frame_h) if frame_h else ""))
    return join(parts)


def _decor_score(c: dict) -> tuple[int, list[str]]:
    st, why = c.get("style") or {}, []
    if c["line_h"] >= 0.045:
        why.append(T("字号大", "large size"))
    if abs(c["angle"]) >= 4:
        why.append(T("倾斜", "tilted"))
    if st.get("fill_name") not in (None, COLOR_ZH["white"], COLOR_ZH["black"], COLOR_ZH["grey"]):
        why.append(T("{c}色字", "{c} fill", c=st['fill_name']))
    if st.get("multicolor") or st.get("gradient"):
        why.append(T("多色/渐变", "multi-colour / gradient"))
    if st.get("stroke") and st.get("stroke_ratio", 0) >= 0.06:
        why.append(T("粗描边", "thick outline"))
    if (c.get("anim_in") or {}).get("kind") == "pop":
        why.append(T("弹出入场", "pop-in entrance"))
    return len(why), why


_NUMERIC = re.compile(r"[+\-−]?[¥$€£]?[\d.,，．:：%+\-−万亿千百kKmMwW]*\d[\d.,，．:：%+\-−万亿千百kKmMwW]*")


def _block_lines(c: dict, cues: list[dict]) -> int:
    """Other lines on screen at the same time, of about the same size, stacked within a few lines of this one:
    the rest of a paragraph / list / page it belongs to."""
    cy = c["bbox"][1] + c["bbox"][3] / 2
    n = 0
    for o in cues:
        if o is c or o["t0"] >= c["t1"] - 0.05 or o["t1"] <= c["t0"] + 0.05:
            continue
        if not 0.7 <= o["line_h"] / max(c["line_h"], 1e-6) <= 1.4:
            continue
        if abs(o["bbox"][1] + o["bbox"][3] / 2 - cy) <= 4 * c["line_h"]:
            n += 1
    return n


def _aligned(lane: list[dict]) -> bool:
    """Lines of one subtitle track share a horizontal anchor: centred, left- or right-aligned. Words of a page
    (a menu, a file list, a button) that happen to sit at the same height are scattered across it."""
    if len(lane) < 2:
        return True
    anchors = ([c["bbox"][0] for c in lane], [c["bbox"][0] + c["bbox"][2] / 2 for c in lane],
               [c["bbox"][0] + c["bbox"][2] for c in lane])
    return min(float(np.median(np.abs(np.array(a) - np.median(a)))) for a in anchors) <= 0.05


def classify_cues(cues: list[dict], duration: float) -> None:
    """Assign each cue a kind (subtitle / huazi / title / label / scene)."""
    # lanes: cues stacked at the same place one after another
    lanes: list[list[dict]] = []
    for c in sorted(cues, key=lambda c: c["t0"]):
        cy = c["bbox"][1] + c["bbox"][3] / 2
        for lane in lanes:
            ref = lane[-1]
            rcy = ref["bbox"][1] + ref["bbox"][3] / 2
            # one after another at the same place, same size: not two texts on screen together
            if (abs(cy - rcy) < max(0.03, 1.2 * ref["line_h"]) and abs(c["line_h"] - ref["line_h"]) < 0.35 * ref["line_h"]
                    and c["t0"] >= ref["t1"] - 0.6):
                lane.append(c)
                break
        else:
            lanes.append([c])
    for lane in lanes:
        changing = len({_norm(c["text"]) for c in lane})
        med = float(np.median([c["t1"] - c["t0"] for c in lane]))
        h = float(np.median([c["line_h"] for c in lane]))
        tilted = float(np.median([abs(c["angle"]) for c in lane])) >= 4
        # readable lines (kinetic typography flashing words for a fraction of a second is not a subtitle track)
        # a lane of changing numbers is a counter / chart value drawn by the picture, not a subtitle track
        counter = changing >= 2 and all(_NUMERIC.fullmatch(_norm(c["text"])) for c in lane)
        # SHOT 01 → SHOT 02 → …, 第 1 步 → 第 2 步: the same words with a running number are a label, not lines read out
        numbered = changing >= 2 and len({_numbers(c["text"])[0] for c in lane}) == 1 and all(_numbers(c["text"])[1] for c in lane)
        is_sub = ((changing >= 3 or (changing >= 2 and duration < 15)) and 0.7 <= med <= 7.0 and h < 0.07 and not tilted
                  and not counter and not numbered)
        # words of a page / document in the picture (a screenshot, a recorded screen) can line up at one height and
        # change like a subtitle track. Each of them is one line among others of the same size on screen with it:
        # a lane made only of such lines is page text, and in a lane whose lines do not share a horizontal anchor
        # the lines sitting in such a block are page text while the lone ones may still be captions
        page = set()
        if is_sub:
            block = {id(c): _block_lines(c, cues) for c in lane}
            if len(lane) >= 3 and all(n >= 3 for n in block.values()):
                page = {id(c) for c in lane}
            elif not _aligned(lane):
                page = {id(c) for c in lane if block[id(c)] >= 2}
        for c in lane:
            c["_counter"] = counter
            c["lane"] = lanes.index(lane)
            c["_page"] = id(c) in page
            c["_sub_lane"] = is_sub and not c["_page"]
            c["_lane_texts"] = changing
    for c in cues:
        st = c.get("style") or {}
        score, why = _decor_score(c)
        cy = c["bbox"][1] + c["bbox"][3] / 2
        dur = c["t1"] - c["t0"]
        moving = c["drift"] > 0.04 and c["samples"] >= 2
        if moving and not (st.get("stroke") or st.get("box")):
            kind = "scene"
            why = [T("跟着画面移动、没有描边或底框", "moves with the picture, no outline or box")]
        elif c.get("_page"):
            kind = "scene"
            why = [T("画面里页面/文档的字：和同字号的几行字同时出现、挨在一起",
                     "text of a page / document in the picture: one line in a block of same-size lines on screen together")]
        elif c.get("_sub_lane") and not (score >= 3 and c["line_h"] >= 0.05):
            kind = "subtitle"
        elif cy < 0.3 and (dur >= 0.5 * duration or dur >= 8) and not moving and c.get("_lane_texts", 1) == 1:
            kind = "title"
        elif moving or c.get("_lane_texts", 1) >= 2:
            kind = "label"  # a tag that follows an object, or a run of chapter cards / captions at one place
        elif score >= 2:
            kind = "huazi"
        else:
            kind = "label"
        c["kind"], c["kind_zh"] = kind, KIND_ZH[kind]
        if c.pop("_counter", False):
            c["kind"], c["kind_zh"] = "counter", KIND_ZH["counter"]
        c["decor"] = why
        if moving and kind != "scene":
            c["follows"] = True  # tracked to an object in the picture (label with a leader / tag)
        c["band"] = _band(cy)
        c.pop("_sub_lane", None)
        c.pop("_page", None)
        c.pop("_lane_texts", None)


# ----------------------------------------------------------------------------- dense pass

def _sig(roi: np.ndarray) -> np.ndarray:
    e = cv2.Canny(roi, 60, 160).astype(np.float32)
    return cv2.resize(e, (64, 12), interpolation=cv2.INTER_AREA).ravel()


def _ncc(a: np.ndarray, b: np.ndarray) -> float:
    a, b = a - a.mean(), b - b.mean()
    d = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(a @ b / d) if d > 1e-6 else 0.0


def dense_pass(path: str | Path, info: VideoInfo, cues: list[dict]) -> tuple[np.ndarray, float]:
    """Decode grey frames at ~10 fps once: keep a small copy of every frame (sticker search) and, for each text
    cue, the edge signature of its box around its start / end (timing + animation)."""
    fps = min(DENSE_FPS, max(2.0, DENSE_MAX / max(info.duration, 0.1)))
    small = []
    for c in cues:
        c["_dense"] = []
    win = 1.0
    for i, g in enumerate(iter_frames(path, info, DENSE_W, gray=True, fps=fps)):
        t = i / fps
        H, W = g.shape
        small.append(cv2.resize(g, (SMALL_W, max(8, int(round(SMALL_W * H / W)))), interpolation=cv2.INTER_AREA))
        for c in cues:
            if not (c["t0"] - win <= t <= c["t1"] + win):
                continue
            x, y, w, h = c["bbox"]
            px, py = 0.03 + 0.15 * w, 0.6 * c["line_h"]
            X0, Y0 = int(max(0, x - px) * W), int(max(0, y - py) * H)
            X1, Y1 = int(min(1, x + w + px) * W), int(min(1, y + h + py) * H)
            roi = g[Y0:Y1, X0:X1]
            if roi.shape[0] < 4 or roi.shape[1] < 8:
                continue
            c["_dense"].append((t, roi.copy()))
    return np.array(small) if small else np.zeros((0, 8, SMALL_W), np.uint8), 1.0 / fps


def _extent(mask: np.ndarray) -> tuple[float, float, float, float]:
    """(x-extent, y-extent, cx, cy) of the True pixels, as fractions of the mask size."""
    ys, xs = np.nonzero(mask)
    if len(xs) < 5:
        return 0.0, 0.0, 0.5, 0.5
    x0, x1 = np.percentile(xs, [3, 97])
    y0, y1 = np.percentile(ys, [3, 97])
    return (float(x1 - x0) / mask.shape[1], float(y1 - y0) / mask.shape[0],
            float(xs.mean()) / mask.shape[1], float(ys.mean()) / mask.shape[0])


def refine_cue(c: dict, step: float, dstep: float, prev_last: float | None, next_first: float | None) -> None:
    """Snap start / end to the dense frames and read the entrance / exit animation.
    prev_last / next_first: when the previous cue at the same place was last seen and the next one first seen
    (OCR times). Their look in this box is the competitor: a frame belongs to this cue only if it matches this
    cue better than the neighbour."""
    dense = c.pop("_dense", [])
    if len(dense) < 3:
        return
    times = np.array([t for t, _ in dense])
    rois = [r for _, r in dense]
    shape = rois[len(rois) // 2].shape
    rois = [r if r.shape == shape else cv2.resize(r, (shape[1], shape[0])) for r in rois]
    a, b = c["t0"], c["t1"] - step  # first / last OCR sighting
    mid = [i for i, t in enumerate(times) if a - 1e-6 <= t <= b + 1e-6] or [int(np.argmin(np.abs(times - (a + b) / 2)))]
    if len(mid) > 4:
        mid = mid[len(mid) // 4:len(mid) - len(mid) // 4] or mid
    sigs = [_sig(r) for r in rois]
    ref = np.mean([sigs[i] for i in mid], axis=0)
    pres = np.array([_ncc(s_, ref) for s_ in sigs])
    plateau = float(np.median(pres[mid]))
    comp = np.zeros(len(times))
    for t_ref, side in ((prev_last, -1), (next_first, 1)):
        if t_ref is None:
            continue
        # only frames on the neighbour's side of its sighting (it was surely on screen there)
        near = [i for i, t in enumerate(times) if 0 <= (t - t_ref) * side <= 0.2]
        if near:
            r2 = np.mean([sigs[i] for i in near], axis=0)
            comp = np.maximum(comp, [_ncc(s_, r2) for s_ in sigs])
    vis = (pres >= max(0.45, 0.6 * plateau)) & (pres > comp + 0.08)
    lo = prev_last if prev_last is not None else -1.0
    hi = next_first if next_first is not None else 1e9
    i0 = int(np.argmin(np.abs(times - a)))
    while i0 > 0 and vis[i0 - 1] and times[i0 - 1] > lo + 1e-6:
        i0 -= 1
    i1 = int(np.argmin(np.abs(times - b)))
    while i1 < len(times) - 1 and vis[i1 + 1] and times[i1 + 1] < hi - 1e-6:
        i1 += 1
    if i1 < i0:
        return
    c["t0"], c["t1"] = round(float(times[i0]), 3), round(float(times[i1] + dstep), 3)
    c["timing"] = "dense"
    ref_i = mid[len(mid) // 2]

    def extents(i: int, bg_i: int):
        bg = rois[bg_i].astype(np.int16)
        m = np.abs(rois[i].astype(np.int16) - bg) > 22
        return _extent(m), float(m.mean())

    def animation(edge: int, outside: int, inward: int) -> str | None:
        """edge: first (last) visible frame; outside: the frame before (after) it; inward: +1 / -1."""
        if outside < 0 or outside >= len(times):
            return None
        if comp[outside] > 0.5 and comp[outside] >= pres[outside]:
            # the neighbour was showing right before: a swap at the same place. Only "instant or not" is readable.
            return "cut" if pres[edge] >= 0.85 * plateau else None
        if pres[edge] >= 0.85 * plateau and pres[outside] < 0.35:
            return "cut"
        (rx, ry, rcx, rcy), rd = extents(ref_i, outside)
        if rx < 0.05 or rd < 1e-4:
            return None
        frames = [edge + inward * j for j in range(4) if 0 <= edge + inward * j < len(times)
                  and abs(times[edge + inward * j] - times[edge]) <= 0.35]
        first = frames[0]
        (ex, ey, cx, cy), d = extents(first, outside)
        xr, yr, dens = ex / rx, ey / max(ry, 1e-3), d / rd
        if c.get("reveal") and inward > 0:
            return "reveal"
        if xr < 0.8 and yr < 0.8 and abs(xr - yr) < 0.3:
            return "pop"
        if inward > 0 and xr < 0.65 and yr > 0.8:
            return "reveal"
        if abs(cx - rcx) > 0.12 or abs(cy - rcy) > 0.25:
            return "slide"
        if dens < 0.6:
            return "fade"
        return "cut"

    k_in = animation(i0, i0 - 1, 1)
    if k_in:
        c["anim_in"] = {"kind": k_in, "kind_zh": ANIM_ZH[k_in]}
    k_out = animation(i1, i1 + 1, -1)
    if k_out:
        k_out = {"cut": "cut_out", "pop": "pop_out", "fade": "fade_out", "slide": "slide_out", "reveal": "cut_out"}[k_out]
        c["anim_out"] = {"kind": k_out, "kind_zh": ANIM_ZH[k_out]}
    # mid-cue motion with the same words: a keyword bounce / colour change / wobble
    inside = pres[i0 + 1:i1]
    if len(inside) >= 6 and float(np.percentile(inside, 10)) < 0.6 * plateau:
        c["mid_motion"] = True


# ----------------------------------------------------------------------------- stickers

def _cells(frames: np.ndarray) -> np.ndarray:
    n, h, w = frames.shape
    gh, gw = h // CELL, w // CELL
    return frames[:, :gh * CELL, :gw * CELL].reshape(n, gh, CELL, gw, CELL).astype(np.float32).mean(axis=(2, 4))


def find_stickers(small: np.ndarray, dstep: float, cuts: list[float], cues: list[dict], duration: float) -> list[dict]:
    """Overlay pictures (stickers, GIFs, emoji, picture-in-picture) from the small grey frames.
    Cue 1: mid-shot, a compact block changes at once while the rest of the frame is quiet, and the change
           stays (something was put there). Paired with a later change that restores the block = it left.
    Cue 2: a block that survives a cut while everything around it changes.
    Kept strict on purpose: in animation / motion graphics things appear all the time; a missed sticker costs
    less than a report full of invented ones."""
    n = len(small)
    if n < 8:
        return []
    C = _cells(small)
    gh, gw = C.shape[1:]
    D = np.abs(np.diff(small[:, :gh * CELL, :gw * CELL].astype(np.int16), axis=0))
    Dc = D.reshape(n - 1, gh, CELL, gw, CELL).mean(axis=(2, 4)).astype(np.float32)
    cut_idx = sorted({int(round(c / dstep)) for c in cuts if 0 < c < duration})
    near_cut = np.zeros(n - 1, bool)
    for k in cut_idx:
        near_cut[max(0, k - 3):min(n - 1, k + 3)] = True
    total = gh * gw
    Dm = _compensated_change(small, gh, gw)  # change after removing camera motion (pan / zoom)
    gq = np.median(Dm.reshape(n - 1, -1), axis=1)

    def shot_bounds(i):
        return max([k for k in cut_idx if k <= i], default=0), min([k for k in cut_idx if k > i], default=n)

    def region(i, box):
        x, y, w, h = box
        return C[min(max(i, 0), n - 1), y:y + h, x:x + w]

    def ring_of(box, grow=2):
        x, y, w, h = box
        m = np.zeros((gh, gw), bool)
        m[max(0, y - grow):y + h + grow, max(0, x - grow):x + w + grow] = True
        m[y:y + h, x:x + w] = False
        return m

    onsets = []
    for i in range(1, n - 1):
        if near_cut[i] or gq[i] > 2.0:
            continue
        spike = Dm[i] > np.maximum(14.0, 4 * gq[i] + 6)
        if spike.sum() < 2 or spike.mean() > 0.4:
            continue
        nlab, lab, stats, _ = cv2.connectedComponentsWithStats(spike.astype(np.uint8), connectivity=8)
        for j in range(1, nlab):
            x, y, w, h, area = stats[j]
            box = (x, y, w, h)
            if area < max(3, 0.006 * total) or area > 0.4 * total or area / float(w * h) < 0.4:
                continue
            if spike.sum() - area > 0.02 * total:
                continue  # other things change at the same moment
            inside = float(Dm[i][lab == j].mean())
            ring = ring_of(box)
            if ring.any() and float(Dm[i][ring].mean()) > 0.25 * inside:
                continue  # soft edge: motion, not a pasted layer
            before = Dm[max(0, i - 10):i - 1, y:y + h, x:x + w]
            if before.size and float(before.mean()) * 4 > inside:
                continue  # the block was already busy
            onsets.append({"i": i, "box": box})
    merged: list[dict] = []
    for o in onsets:
        for m in merged:
            if o["i"] - m["i1"] <= 3 and _iou(o["box"], m["box"]) > 0.3:
                m["i1"], m["box"] = o["i"], _union(m["box"], o["box"])
                break
        else:
            merged.append({"i0": o["i"], "i1": o["i"], "box": o["box"]})
    found, used = [], set()
    for a_i, m in enumerate(merged):
        if a_i in used:
            continue
        sa, sb = shot_bounds(m["i0"])
        before, after, later = m["i0"] - 2, m["i1"] + 3, m["i1"] + 8
        if before < sa or later >= sb:
            continue
        ref = region(before, m["box"])
        if float(np.abs(region(after, m["box"]) - ref).mean()) < 15 or float(np.abs(region(later, m["box"]) - ref).mean()) < 15:
            continue  # nothing stayed: a flash, a blink, a passing object
        end_i, paired = sb - 1, False
        for b_i in range(a_i + 1, len(merged)):
            e = merged[b_i]
            if e["i0"] >= sb:
                break
            if _iou(e["box"], m["box"]) > 0.45 and e["i0"] > m["i1"] + 3 and e["i1"] + 3 < sb:
                # the same block changes at once again and the place looks like it did before the block came
                # (compared as a texture histogram, so a background that panned on meanwhile still matches;
                # an outfit swap or a new object does not)
                h_before, h_during, h_after = (_hist(small[i_], m["box"]) for i_ in (before, e["i0"] - 2, e["i1"] + 3))
                d_bd, d_ba = float(np.abs(h_during - h_before).sum()), float(np.abs(h_after - h_before).sum())
                if d_bd > 0.3 and d_ba < 0.5 * d_bd:
                    end_i, paired = e["i0"], True
                    used.add(b_i)
                    break
        st = _sticker(m["box"], m["i0"], end_i, paired, False, small, Dc, dstep, gh, gw)
        # without the matching exit, only shapes that do not occur naturally: a looping GIF, a block that pops in
        # and then holds still, or a hard-edged rectangle of video (picture-in-picture)
        if paired or st["looping"] or st["kind"] == "pip" or st["activity"] < 1.5:
            found.append(st)
    for k in cut_idx:
        if k < 4 or k + 4 >= n:
            continue
        pairs = [np.abs(C[b_] - C[a_]) for a_ in (k - 2, k - 1) for b_ in (k, k + 1)]
        d = np.min(pairs, axis=0)
        glob = float(np.median(np.max(pairs, axis=0)))
        if glob < 30:
            continue
        tex = small[k][:gh * CELL, :gw * CELL].reshape(gh, CELL, gw, CELL).std(axis=(1, 3)) > 8
        unchanged = d < max(5.0, 0.15 * glob)
        if float(unchanged.mean()) > 0.15:
            continue  # a jump cut on the same set: the background carries over, so "unchanged" proves nothing
        surv = unchanged & tex
        stay = np.abs(C[min(n - 1, k + 3)] - C[k - 3]) < max(8.0, 0.2 * glob)
        surv &= stay
        nlab, lab, stats, _ = cv2.connectedComponentsWithStats(surv.astype(np.uint8), connectivity=8)
        for j in range(1, nlab):
            x, y, w, h, area = stats[j]
            box = (x, y, w, h)
            if area < max(3, 0.006 * total) or area > 0.3 * total or area / float(w * h) < 0.5:
                continue
            if w > 0.6 * gw or h > 0.6 * gh:
                continue  # a band across the frame (letterbox, empty background), not a sticker
            patch = small[k][y * CELL:(y + h) * CELL, x * CELL:(x + w) * CELL]
            if float((cv2.Canny(patch, 60, 160) > 0).mean()) < 0.04:
                continue  # nothing drawn there: an empty patch of background that happened not to change
            ring = ring_of(box)
            if ring.any() and float(surv[ring].mean()) > 0.2:
                continue  # the area around survived too: similar shots, not a layer on top
            hit = [s_ for s_ in found if _iou(box, s_["_cells"]) > 0.4 and s_["_i0"] <= k <= s_["_i1"] + 2]
            for s_ in hit:
                s_["crosses_cut"] = True
            if not hit:
                sa, _ = shot_bounds(k - 1)
                _, sb = shot_bounds(k)
                found.append(_sticker(box, sa, sb - 1, False, True, small, Dc, dstep, gh, gw))
    found += _static_blocks(small, Dc, dstep, cut_idx, found, gh, gw)
    out = []
    for s_ in found:
        bx = s_["bbox"]
        x_, y_, w_, h_ = s_["_cells"]
        # slivers along the frame edge are motion / crop artefacts, not something pasted on
        if min(w_, h_) < 2 or (x_ == 0 or y_ == 0 or x_ + w_ >= gw or y_ + h_ >= gh) and min(w_ / gw, h_ / gh) < 0.15:
            continue
        covered = 0.0
        for c in cues:
            if c["t0"] - 0.4 <= s_["t1"] and s_["t0"] <= c["t1"] + 0.4:
                covered = max(covered, _overlap_frac(bx, c["bbox"]), _overlap_frac(c["bbox"], bx) * 0.8)
        if covered >= 0.3:
            continue  # text and its own animation / box
        if s_["t1"] - s_["t0"] >= 0.8 * duration and not s_["animated"]:
            continue  # a watermark / layout skin: reported as a static overlay elsewhere
        out.append(s_)
    out = _dedupe_stickers(out)
    for k, s_ in enumerate(out, 1):
        s_["id"] = f"sticker_{k:02d}"
        for key in ("_cells", "_i0", "_i1"):
            s_.pop(key, None)
    return out


def _static_blocks(small: np.ndarray, Dc: np.ndarray, dstep: float, cut_idx: list[int], found: list[dict], gh: int, gw: int) -> list[dict]:
    """A pasted picture on moving footage (an app icon, a screenshot card over a talking head): a block with
    content that holds still while everything around it moves, floating inside the frame."""
    n = len(small)
    win = max(6, int(round(1.0 / dstep)))
    total = gh * gw
    hits: list[dict] = []
    for a in range(0, n - 1 - win, max(1, win // 2)):
        if any(a < k <= a + win for k in cut_idx):
            continue
        act = Dc[a:a + win].mean(axis=0)
        mid = small[a + win // 2][:gh * CELL, :gw * CELL]
        tex = mid.reshape(gh, CELL, gw, CELL).std(axis=(1, 3)) > 6
        still = (act < 1.2) & tex
        nlab, lab, stats, _ = cv2.connectedComponentsWithStats(still.astype(np.uint8), connectivity=8)
        for j in range(1, nlab):
            x, y, w, h, area = stats[j]
            if area < max(4, 0.01 * total) or area > 0.4 * total or area / float(w * h) < 0.6:
                continue
            if x == 0 or y == 0 or x + w >= gw or y + h >= gh:
                continue  # touches the frame edge: background / letterbox
            ring = np.zeros((gh, gw), bool)
            ring[max(0, y - 1):y + h + 1, max(0, x - 1):x + w + 1] = True
            ring[y:y + h, x:x + w] = False
            if float(act[ring].mean()) < 4.0 or float((act[ring] > 2.0).mean()) < 0.6:
                continue  # the surroundings are still too: a static scene, not a layer
            patch = mid[y * CELL:(y + h) * CELL, x * CELL:(x + w) * CELL]
            if float((cv2.Canny(patch, 60, 160) > 0).mean()) < 0.04:
                continue
            hits.append({"a": a, "b": a + win, "box": (x, y, w, h)})
    out: list[dict] = []
    for h_ in hits:
        for o in out:
            if _iou(h_["box"], o["box"]) > 0.4 and h_["a"] <= o["b"] + 1:
                o["b"] = max(o["b"], h_["b"])
                o["n"] += 1
                break
        else:
            out.append(dict(h_, n=1))
    res = []
    for o in out:
        if o["n"] < 2:
            continue  # held for at least ~1.5 s
        if any(_iou(o["box"], f["_cells"]) > 0.4 and f["_i0"] <= o["b"] and o["a"] <= f["_i1"] for f in found):
            continue
        st = _sticker(o["box"], o["a"], o["b"], False, False, small, Dc, dstep, gh, gw)
        st.update(kind="static_sticker", kind_zh=STICKER_ZH["static_sticker"], appears_mid_shot=True, confidence="medium",
                  evidence=T("周围画面在动、这一块不动且边界清楚", "the picture around it moves while this block holds still with a clean edge"))
        res.append(st)
    return res


def _hist(frame: np.ndarray, box, bins: int = 16) -> np.ndarray:
    x, y, w, h = box
    patch = frame[y * CELL:(y + h) * CELL, x * CELL:(x + w) * CELL]
    hst = np.bincount((patch // (256 // bins)).ravel(), minlength=bins).astype(np.float32)
    return hst / max(1.0, hst.sum())


def _compensated_change(small: np.ndarray, gh: int, gw: int) -> np.ndarray:
    """Per-cell change between consecutive frames after warping the earlier frame by the camera's motion
    (a similarity transform fitted to tracked corners). Falls back to the plain difference when tracking fails."""
    n = len(small)
    out = np.zeros((n - 1, gh, gw), np.float32)
    for i in range(n - 1):
        a, b = small[i], small[i + 1]
        warped = a
        pts = cv2.goodFeaturesToTrack(a, maxCorners=150, qualityLevel=0.01, minDistance=5, blockSize=5)
        if pts is not None and len(pts) >= 12:
            nxt, st, _ = cv2.calcOpticalFlowPyrLK(a, b, pts, None, winSize=(15, 15), maxLevel=2)
            ok = st.ravel() == 1 if st is not None else np.zeros(len(pts), bool)
            if ok.sum() >= 10:
                M, inl = cv2.estimateAffinePartial2D(pts.reshape(-1, 2)[ok], nxt.reshape(-1, 2)[ok], method=cv2.RANSAC,
                                                     ransacReprojThreshold=1.0)
                moved = M is not None and (abs(M[0, 2]) > 0.2 or abs(M[1, 2]) > 0.2 or abs(M[0, 0] - 1) > 0.002)
                if moved and inl is not None and inl.mean() > 0.5:
                    warped = cv2.warpAffine(a, M, (a.shape[1], a.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        d = np.abs(b[:gh * CELL, :gw * CELL].astype(np.int16) - warped[:gh * CELL, :gw * CELL].astype(np.int16))
        out[i] = d.reshape(gh, CELL, gw, CELL).mean(axis=(1, 3))
    return out


def _sticker(box, i0, i1, paired, crosses, small, Dc, dstep, gh, gw) -> dict:
    x, y, w, h = box
    n = len(small)
    i1 = min(i1, n - 1)
    seg = Dc[i0 + 1:max(i0 + 2, i1 - 1), y:y + h, x:x + w]
    activity = float(seg.mean()) if seg.size else 0.0
    animated = activity > 2.5
    period = None
    if animated and i1 - i0 > 12:
        # the middle of the block only (its corners can show the moving background around a round sticker)
        px, py = max(1, int(w * CELL * 0.2)), max(1, int(h * CELL * 0.2))
        X = small[i0 + 2:i1 - 1, y * CELL + py:(y + h) * CELL - py, x * CELL + px:(x + w) * CELL - px].astype(np.float32)
        m = len(X)
        r = [float(np.abs(X[L:] - X[:-L]).mean()) for L in range(1, min(60, m - 2))]
        # a loop: some lag brings the picture back much closer than the shorter lags before it
        for L in range(3, len(r) // 2 + 1):  # 2L must still be a measured lag
            peak = max(r[:L - 1])
            # a real animation (not sensor / generator shimmer) that comes back at L and again at 2L
            if peak > 6.0 and r[L - 1] < 0.45 * peak and r[2 * L - 1] < 0.45 * peak:
                period = round(L * dstep, 2)
                break
    # a rectangle of video content (straight edges, continuously changing, not looping): picture-in-picture
    rect = False
    if animated and period is None and w >= 4 and h >= 4:
        # straight, hard borders on all four sides of the block
        f = small[(i0 + i1) // 2].astype(np.float32)
        gx, gy = np.abs(cv2.Sobel(f, cv2.CV_32F, 1, 0)), np.abs(cv2.Sobel(f, cv2.CV_32F, 0, 1))
        X0, Y0, X1, Y1 = x * CELL, y * CELL, (x + w) * CELL - 1, (y + h) * CELL - 1

        def edge_strength(vals: np.ndarray) -> float:
            return float(np.median(vals)) if vals.size else 0.0

        sides = []
        for xx in (X0, X1):
            sides.append(max(edge_strength(gx[Y0:Y1, max(0, xx - d)]) for d in (-1, 0, 1) if 0 <= xx - d < f.shape[1]))
        for yy in (Y0, Y1):
            sides.append(max(edge_strength(gy[max(0, yy - d), X0:X1]) for d in (-1, 0, 1) if 0 <= yy - d < f.shape[0]))
        interior = float(np.median(np.hypot(gx, gy)[Y0 + 2:Y1 - 2, X0 + 2:X1 - 2])) if Y1 - Y0 > 6 and X1 - X0 > 6 else 0.0
        rect = min(sides) > max(20.0, 2.5 * interior)
    kind = "pip" if rect and w * h >= 0.04 * gh * gw else ("animated_sticker" if animated else "static_sticker")
    # measured on real footage (eval/articles, koubo): an appear / disappear pair over moving live or AI picture is
    # usually the picture itself (an arm, an outfit swap); only a looping GIF or a block that holds perfectly still
    # inside is trusted without a look
    conf = "medium" if (crosses or (paired and (period is not None or not animated))) else "low"
    activity, x, y, w, h = float(activity), int(x), int(y), int(w), int(h)
    t0, t1 = round((i0 + 1) * dstep, 2), round(i1 * dstep, 2)
    return {"kind": kind, "kind_zh": STICKER_ZH[kind], "t0": t0, "t1": t1,
            "bbox": [round(float(x) / gw, 3), round(float(y) / gh, 3), round(float(w) / gw, 3), round(float(h) / gh, 3)],
            "animated": bool(animated), "loop_period_s": period, "looping": period is not None, "activity": round(activity, 1),
            "appears_mid_shot": not crosses or paired, "disappears_mid_shot": paired, "crosses_cut": crosses,
            "confidence": conf, "_cells": box, "_i0": i0, "_i1": i1}


def _iou(a, b) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    return inter / float(aw * ah + bw * bh - inter) if inter else 0.0


def _union(a, b):
    x0, y0 = min(a[0], b[0]), min(a[1], b[1])
    x1, y1 = max(a[0] + a[2], b[0] + b[2]), max(a[1] + a[3], b[1] + b[3])
    return (x0, y0, x1 - x0, y1 - y0)


def _overlap_frac(a, b) -> float:
    """Share of box a covered by box b (0-1 coordinates)."""
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    return ix * iy / max(1e-6, a[2] * a[3])


def _dedupe_stickers(items: list[dict]) -> list[dict]:
    items = sorted(items, key=lambda s: (s["t0"], -s["bbox"][2] * s["bbox"][3]))
    keep: list[dict] = []
    for s in items:
        dup = False
        for k in keep:
            if _iou(s["bbox"], k["bbox"]) > 0.5 and s["t0"] <= k["t1"] and k["t0"] <= s["t1"]:
                k["t0"], k["t1"] = min(k["t0"], s["t0"]), max(k["t1"], s["t1"])
                k["crosses_cut"] = k["crosses_cut"] or s["crosses_cut"]
                if s["confidence"] == "medium":
                    k["confidence"] = "medium"
                dup = True
                break
        if not dup:
            keep.append(s)
    return keep


# ----------------------------------------------------------------------------- SFX alignment

def visual_events(cues: list[dict], stickers: list[dict], cuts: list[float]) -> list[dict]:
    ev = []
    for c in cues:
        if c["kind"] == "scene":
            continue
        what = T("{k}「{t}」出现", "{k} \"{t}\" appears", k=c['kind_zh'], t=c['text'].replace('/', ' ')[:16])
        ev.append({"t": c["t0"], "type": f"{c['kind']}_in", "what": what, "ref": c["id"]})
        if c.get("mid_motion"):
            ev.append({"t": None, "type": "mid", "ref": c["id"]})
    for s in stickers:
        ev.append({"t": s["t0"], "type": "sticker_in", "what": T("{k}出现", "{k} appears", k=s['kind_zh']), "ref": s["id"]})
        if s.get("disappears_mid_shot"):
            ev.append({"t": s["t1"], "type": "sticker_out", "what": T("{k}消失", "{k} disappears", k=s['kind_zh']), "ref": s["id"]})
    for t in cuts:
        ev.append({"t": t, "type": "cut", "what": T("切镜", "cut"), "ref": None})
    return [e for e in ev if e["t"] is not None]


SFX_TOL = 0.2


def align_sfx(sfx: list[dict], events: list[dict]) -> dict:
    """Which on-screen event each sound effect lands on, and which pops / stickers carry a sound."""
    times = np.array([e["t"] for e in events]) if events else np.zeros(0)
    counts: dict[str, int] = {}
    possible: dict[str, int] = {}  # low-confidence signal candidates, kept apart from heard / reviewed effects
    for s in sfx:
        t = float(s.get("t", -9))
        if not len(times):
            break
        d = np.abs(times - t)
        # prefer a text / sticker entrance over a cut when both are in reach
        order = sorted(range(len(events)), key=lambda i: (d[i] > SFX_TOL, events[i]["type"] == "cut", d[i]))
        i = order[0]
        if d[i] <= SFX_TOL:
            s["on"] = {"type": events[i]["type"], "what": events[i]["what"], "dt": round(float(events[i]["t"] - t), 3), "ref": events[i]["ref"]}
            tally = possible if s.get("confidence") == "low" else counts
            tally[events[i]["type"]] = tally.get(events[i]["type"], 0) + 1
    st = np.array([float(s.get("t", -9)) for s in sfx]) if sfx else np.zeros(0)
    voiced = {}
    for e in events:
        if e["type"] == "cut":
            continue
        has = bool(len(st) and np.min(np.abs(st - e["t"])) <= SFX_TOL)
        k = e["type"]
        a, b = voiced.get(k, (0, 0))
        voiced[k] = (a + has, b + 1)
    return {"sfx_on": counts, "sfx_on_possible": possible, "events_with_sfx": {k: {"with_sfx": a, "total": b} for k, (a, b) in voiced.items()}}


def anchored_sfx(path: str | Path, events: list[dict], known: list[dict]) -> list[dict]:
    """Extra SFX candidates: a sharp transient right on a text pop / sticker entrance (not cuts: music hits
    land there too). Editors put a pop / ding on these moments far more often than chance."""
    from .audio import has_transient, onset_envelope, sfx_type

    env = onset_envelope(str(path))
    if env is None:
        return []
    perc, frame_db, S, freqs, hop_t, share = env
    if not len(perc):
        return []
    peak_db = float(np.percentile(frame_db, 99))
    w2 = int(round(1.0 / hop_t))
    known_t = np.array([float(k.get("t", -9)) for k in known]) if known else np.zeros(0)
    out = []
    for e in events:
        if e["type"] == "cut":
            continue
        a, b = int((e["t"] - 0.08) / hop_t), int((e["t"] + 0.15) / hop_t)
        if a < 1 or b >= len(perc):
            continue
        c = a + int(np.argmax(perc[a:b]))
        if not has_transient(share, c):
            continue
        loc = float(np.percentile(perc[max(0, c - w2):c + w2], 90)) + 1e-6
        strength = float(perc[c]) / loc
        if strength < 1.6 or frame_db[c] < peak_db - 30:
            continue
        t = round(c * hop_t, 3)
        if len(known_t) and np.min(np.abs(known_t - t)) < 0.12:
            continue
        if any(abs(o["t"] - t) < 0.12 for o in out):
            continue
        kind, info = sfx_type(S, freqs, frame_db, c, hop_t)
        out.append({"t": t, "type": kind, **info, "strength": round(strength, 1), "source": "deterministic_anchored",
                    "confidence": "medium", "anchor": e["what"]})
    return out


# ----------------------------------------------------------------------------- speech anchors / persistent layers

ANCHOR_KINDS = ("huazi", "title", "label", "counter")
ANCHOR_BEFORE, ANCHOR_AFTER = 0.5, 1.0  # an element popping in just before a line starts / just after it ends still belongs to it


def speech_lines(cues: list[dict]) -> list[dict]:
    """The subtitle lane carrying the spoken lines: the one with the most different lines (a filing number or a
    watermark repeats one text; OCR noise in a picture rarely forms 3+ distinct lines in one lane)."""
    lanes: dict = {}
    for c in cues:
        if c["kind"] == "subtitle" and not c.get("part_of_picture"):
            lanes.setdefault(c.get("lane"), []).append(c)
    best = max(lanes.values(), key=lambda cs: (len({_norm(c["text"]) for c in cs}), sum(c["t1"] - c["t0"] for c in cs)), default=[])
    return sorted(best, key=lambda c: c["t0"]) if len({_norm(c["text"]) for c in best}) >= 3 else []


def cjk_count(s: str) -> int:
    return sum(1 for ch in s if "\u3040" <= ch <= "\u9fff" or "\uac00" <= ch <= "\ud7af")


def _shared_word(a: str, b: str) -> str | None:
    """Longest run of characters both texts share: 2+ CJK characters or 4+ latin / digits."""
    a, b = _norm(a), _norm(b)
    if not a or not b:
        return None
    m = SequenceMatcher(None, a, b, autojunk=False).find_longest_match(0, len(a), 0, len(b))
    w = a[m.a:m.a + m.size]
    return w if m.size >= (2 if cjk_count(w) else 4) else None


def line_anchor(t: float, text: str, lines: list[dict]) -> dict | None:
    """Which spoken line an element entering at t belongs to. A shared word with a nearby line wins over plain timing
    (a 花字 repeating the keyword is placed on that word); otherwise the line being spoken, else the one just
    finished, else the one about to start."""
    near = [ln for ln in lines if ln["t0"] - ANCHOR_BEFORE <= t <= ln["t1"] + ANCHOR_AFTER]
    if not near:
        return None
    word_hits = [(ln, w) for ln in near if text and (w := _shared_word(text, ln["text"]))]
    if word_hits:
        ln, word = max(word_hits, key=lambda x: (len(x[1]), -abs(t - x[0]["t0"])))
    else:
        word = None
        during = [ln for ln in near if ln["t0"] - 0.15 <= t < ln["t1"]]
        after = [ln for ln in near if ln["t1"] <= t]
        ln = during[-1] if during else (after[-1] if after else near[0])
    if ln["t0"] - 0.15 <= t < ln["t1"]:
        rel, dt = "during", t - ln["t0"]
    elif t >= ln["t1"]:
        rel, dt = "after", t - ln["t1"]
    else:
        rel, dt = "before", ln["t0"] - t
    return {"line": ln["id"], "text": ln["text"], "rel": rel, "dt": round(max(0.0, dt), 2), "word": word}


def anchor_layers(cues: list[dict], stickers: list[dict], cuts: list[float], min_persist_s: float = 2.0) -> None:
    """Tie each 花字 / title / sticker to the spoken line it lands on, so a remake with new wording moves it with its
    line instead of keeping the old second; mark layers that stay on across cuts (a disclaimer, a title bar, a
    corner badge) as persistent, to be laid on once rather than generated shot by shot.

    「文字标注」 also catches text inside the picture (packaging, UI, OCR noise), so a label is anchored only when it
    repeats a word of the line, and a non-CJK persistent text only when it is read the same way at least twice."""
    for e in cues + stickers:
        e.pop("anchor", None)
        e.pop("persistent", None)
    lines = speech_lines(cues)
    texts = [c for c in cues if c["kind"] in ANCHOR_KINDS and not c.get("part_of_picture")]
    stk = [s for s in stickers if not s.get("in_picture") and s.get("confidence") != "low"]
    for e in texts + stk:
        if not lines or e["t1"] - e["t0"] > 6.0:  # a long-lived layer is not "said" by the line it starts on
            continue
        text = e.get("text") or ""
        a = line_anchor(e["t0"], text, lines)
        if a and a["word"] and len(a["word"]) < 0.5 * len(_norm(text)):
            a["word"] = None  # two shared characters out of a long text is chance, not the keyword
        if a and (e.get("kind") != "label" or a["word"]):
            e["anchor"] = a
    spans = [e for e in texts + stk
             if e["t1"] - e["t0"] >= min_persist_s and any(e["t0"] + 0.2 < t < e["t1"] - 0.2 for t in cuts)]
    for e in spans:
        text = e.get("text") or ""
        same = [o for o in spans if text and _similar(o.get("text") or "", text) >= 0.7]
        if not text or cjk_count(text) >= 2 or len(same) >= 2:
            e["persistent"] = {"cuts": sum(1 for t in cuts if e["t0"] + 0.2 < t < e["t1"] - 0.2)}


def persistent_groups(elems: list[dict]) -> list[dict]:
    """Persistent layers with the same text (one disclaimer re-laid after each transition) as one group."""
    groups: list[dict] = []
    for e in sorted((e for e in elems if e.get("persistent")), key=lambda e: e["t0"]):
        text = e.get("text") or ""
        g = next((g for g in groups if text and _similar(g["text"], text) >= 0.7), None)
        if g:
            g["t1"] = max(g["t1"], e["t1"])
            g["n"] += 1
        else:
            groups.append({"text": text, "name": layer_name(e), "t0": e["t0"], "t1": e["t1"], "n": 1})
    return groups


def overlays_at(pack: dict | None, t0: float, t1: float) -> list[str]:
    """Kinds of post-production layer on screen anywhere in [t0, t1] (subtitles, 花字, stickers ...), excluding words
    that are the picture's own content. Used to warn when a frame handed to a generator carries them."""
    if not pack:
        return []
    kinds = []
    for c in pack.get("text_cues", []):
        if c["kind"] != "scene" and not c.get("part_of_picture") and min(t1, c["t1"]) > max(t0, c["t0"]):
            kinds.append(c.get("kind_zh") or c["kind"])
    for s in pack.get("stickers", []):
        if not s.get("in_picture") and s.get("confidence") != "low" and min(t1, s["t1"]) > max(t0, s["t0"]):
            kinds.append(T("贴纸", "sticker"))
    return list(dict.fromkeys(kinds))


def anchor_text(a: dict) -> str:
    """「line」 + where in it, for the report and summary."""
    line = T("「{t}」", "\"{t}\"", t=a["text"].replace("/", " ")[:18])
    pos = {"during": T("{l}开始后 {d:.1f}s", "{d:.1f}s into {l}"), "after": T("{l}说完后 {d:.1f}s", "{d:.1f}s after {l}"),
           "before": T("{l}开始前 {d:.1f}s", "{d:.1f}s before {l}")}[a["rel"]].format(l=line, d=a["dt"])
    return pos + (T("，对上「{w}」", ", on \"{w}\"", w=a["word"]) if a.get("word") else "")


def layer_name(e: dict) -> str:
    if e.get("text"):
        return T("{k}「{t}」", "{k} \"{t}\"", k=e.get("kind_zh", ""), t=e["text"].replace("/", " ")[:14])
    return str(e.get("what") or e.get("kind_zh") or T("贴纸", "sticker"))[:24]


# ----------------------------------------------------------------------------- top level

def analyze(path: str | Path, info: VideoInfo, cuts: list[float], out_dir: Path | None = None, ocr: bool = True,
            speech: bool | None = None) -> dict:
    """Whole-video packaging pass: text cues (subtitles / 花字 / titles / labels) and stickers. speech=False (no voice
    in the audio) rules out keywords lighting up as they are said."""
    items, step = ocr_pass(path, info) if ocr else ([], 0.0)
    cues = build_cues(items, step) if items else []
    for k, c in enumerate(sorted(cues, key=lambda c: (c["t0"], c["bbox"][1])), 1):
        c["id"] = f"text_{k:03d}"
    small, dstep = dense_pass(path, info, cues)
    for c in cues:
        c["_first"], c["_last"] = c["t0"], c["t1"] - step  # OCR sightings, before refinement moves t0 / t1
    # refine timing; a cue cannot extend into its neighbours at the same place
    for c in cues:
        cy = c["bbox"][1] + c["bbox"][3] / 2
        same = [o for o in cues if o is not c and abs((o["bbox"][1] + o["bbox"][3] / 2) - cy) < max(0.03, c["line_h"])
                and abs(o["bbox"][0] + o["bbox"][2] / 2 - c["bbox"][0] - c["bbox"][2] / 2) < 0.2]
        prev_last = max([o["_last"] for o in same if o["_first"] < c["_first"]], default=None)
        next_first = min([o["_first"] for o in same if o["_first"] > c["_first"]], default=None)
        refine_cue(c, step, dstep, prev_last, next_first)
    for c in cues:
        c.pop("_dense", None)
        c.pop("_last", None)
        c.pop("_first", None)
        c["style"] = merge_style(c.pop("style_obs"))
        if c["style"].get("multicolor") and not c.pop("first_style_multicolor", False) and c["samples"] >= 2 and speech is not False:
            c["style"]["highlight_timing"] = "spoken"  # colour arrives later: keyword lights up when it is said
        c.pop("first_style_multicolor", None)
    classify_cues(cues, info.duration)
    for c in cues:  # a label / title changing colour is the picture behind it (colour bars, a cut), not a spoken keyword
        if c["kind"] not in ("subtitle", "huazi"):
            c["style"].pop("highlight_timing", None)
    # subtitles in one lane share a template: per-line fill / stroke readings that disagree with the lane are noise
    # (a keyword bouncing in its highlight colour, a dark frame); keyword highlight stays per line
    lanes: dict[int, list[dict]] = {}
    for c in cues:
        if c["kind"] == "subtitle":
            lanes.setdefault(c["lane"], []).append(c)
    for lane in lanes.values():
        for key, keys in (("fill_name", ("fill_name", "fill")), ("stroke_name", ("stroke_name", "stroke", "stroke_ratio"))):
            vals = [c["style"].get(key) for c in lane]
            top_ = max(dict.fromkeys(vals), key=vals.count)
            if vals.count(top_) >= 0.6 * len(vals):
                donor = next(c["style"] for c in lane if c["style"].get(key) == top_)
                for c in lane:
                    for k2 in keys:
                        if donor.get(k2) is None:
                            c["style"].pop(k2, None)
                        else:
                            c["style"][k2] = donor[k2]
    for c in cues:
        c["style_zh"] = style_text(c["style"], c["line_h"], info.height if info.rotation not in (90, 270) else info.width)
    stickers = find_stickers(small, dstep, cuts, cues, info.duration) if len(small) else []
    if out_dir is not None and stickers:
        d = Path(out_dir) / "packaging"
        d.mkdir(parents=True, exist_ok=True)
        for s in stickers:
            try:
                p = extract_frame(path, (s["t0"] + s["t1"]) / 2, d / f"{s['id']}_frame.jpg", width=720)
                img = read_image(p)
                if img is not None:
                    H, W = img.shape[:2]
                    x, y, w, h = s["bbox"]
                    crop = img[int(y * H):int((y + h) * H), int(x * W):int((x + w) * W)]
                    if crop.size:
                        write_image(d / f"{s['id']}.jpg", crop)
                        s["image"] = f"packaging/{s['id']}.jpg"
                p.unlink(missing_ok=True)
            except Exception as exc:  # pragma: no cover
                LOG.debug("sticker crop failed: %s", exc)
    kinds: dict[str, int] = {}
    for c in cues:
        kinds[c["kind"]] = kinds.get(c["kind"], 0) + 1
    # the raw OCR hits go back to the caller for the per-shot text (popped before the breakdown is written)
    return {"_ocr_items": items, "text_cues": cues, "stickers": stickers, "ocr": {"step_s": round(step, 3), "frames": int(round(info.duration / step)) if step else 0,
                                                            "dense_step_s": round(dstep, 3)},
            "counts": {"text": kinds, "stickers": len(stickers)}}


# ----------------------------------------------------------------------------- exports

def _ts(t: float, sep: str = ",") -> str:
    ms = int(round(max(0.0, t) * 1000))  # round once, then split: 3.9996 -> 00:00:04,000 (not 03,000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def to_srt(cues: list[dict], kinds=("subtitle",)) -> str:
    rows = [c for c in sorted(cues, key=lambda c: c["t0"]) if c["kind"] in kinds]
    return "\n".join(f"{i}\n{_ts(c['t0'])} --> {_ts(c['t1'])}\n{c['text'].replace('/', chr(10))}\n" for i, c in enumerate(rows, 1))


def _ass_color(hexrgb: str | None, default: str) -> str:
    h = (hexrgb or default).lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H00{b}{g}{r}".upper()


def to_ass(cues: list[dict], width: int, height: int) -> str:
    """Subtitles + 花字 + titles + labels with their measured colours, size and position (\\pos), plus a \\fad / \\t
    pop for the measured entrance. Fonts are not measured: replace "Sans" with the real font."""
    head = ["[Script Info]", "ScriptType: v4.00+", f"PlayResX: {width}", f"PlayResY: {height}", "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, "
            "StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"]
    styles, events = {}, []
    for c in sorted(cues, key=lambda c: c["t0"]):
        if c["kind"] == "scene":
            continue
        st = c.get("style") or {}
        x, y, w, h = c["bbox"]
        rows = c["text"].split("/")
        # a narrow tall box is a vertical column of characters; otherwise the text must fit the measured box width
        vertical = len(rows) == 1 and len(_norm(rows[0])) > 1 and h * height > 2 * w * width
        size = c["line_h"] * height * 0.95
        if vertical:
            size = w * width * 0.95
        else:
            em = max(sum(1.0 if cjk_count(ch) else 0.55 for ch in r) for r in rows)
            size = min(size, w * width * 1.05 / max(1.0, em))
        size = max(12, int(round(size)))
        name = f"{c['kind']}_{len(styles) + 1}"
        box = st.get("box")
        outline = max(0, int(round(st.get("stroke_ratio", 0.0) * size / 0.95))) if st.get("stroke") else 0
        styles[name] = (f"Style: {name},Sans,{size},{_ass_color(st.get('fill'), '#ffffff')},&H0000FFFF,"
                        f"{_ass_color(st.get('box_color') if box else st.get('stroke'), '#000000')},{_ass_color(st.get('box_color'), '#000000')},"
                        f"{-1 if st.get('weight', 0) > 0.2 else 0},0,0,0,100,100,0,{-c['angle']:.0f},{3 if box else 1},{outline if not box else 8},0,5,0,0,0,1")
        tags = f"\\pos({(x + w / 2) * width:.0f},{(y + h / 2) * height:.0f})"
        ak = (c.get("anim_in") or {}).get("kind")
        if ak == "pop":
            tags += "\\fscx60\\fscy60\\t(0,180,\\fscx110\\fscy110)\\t(180,260,\\fscx100\\fscy100)"
        elif ak == "fade" or (c.get("anim_out") or {}).get("kind") == "fade_out":
            tags += "\\fad(200,200)"
        # OCR text is literal: "{...}" would be read as override tags and "\\" as an escape
        text = c["text"].replace("\\", "＼").replace("{", "｛").replace("}", "｝")
        text = "\\N".join(text) if vertical else text.replace("/", "\\N")
        events.append(f"Dialogue: {0 if c['kind'] == 'subtitle' else 1},{_ts(c['t0'], '.')[1:-1]},{_ts(c['t1'], '.')[1:-1]},{name},,0,0,0,,{{{tags}}}{text}")
    return "\n".join(head + list(styles.values()) + ["", "[Events]",
                     "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"] + events) + "\n"


def restyle_rendered(pack: dict, shots: list[dict], video: str | Path, frame_h: int | None) -> int:
    """Text on shots judged code-rendered / screen-recorded: measure its style again with the rendered-picture rules
    (text_style(rendered=True)); text on other shots gets its original reading back (a review may relabel a shot).
    Run after classification, so footage / AI subtitles are never touched. Returns how many cues were re-measured."""
    rendered = {r["index"] for r in shots if r["base"]["label"] in ("code_render", "screen_capture")}
    todo = []
    for c in pack.get("text_cues", []):
        if c.get("shot") in rendered and c.get("style") and "style_overlay" not in c:
            todo.append(c)
        elif c.get("shot") not in rendered and "style_overlay" in c:
            c["style"] = c.pop("style_overlay")
            c["style_zh"] = style_text(c["style"], c.get("line_h"), frame_h)
    if not todo or not Path(video).is_file():
        return 0
    cap = cv2.VideoCapture(str(video))
    n = 0
    for c in todo:
        cap.set(cv2.CAP_PROP_POS_MSEC, (c["t0"] + c["t1"]) / 2 * 1000)
        ok, fr = cap.read()
        if not ok:
            continue
        H, W = fr.shape[:2]
        x, y, w, h = c["bbox"]
        st = text_style(fr, (int(x * W), int(y * H), int((x + w) * W), int((y + h) * H)), rendered=True)
        if st:
            c["style_overlay"] = c["style"]
            c["style"] = {**{k: v for k, v in c["style"].items() if k in ("highlight_timing",)}, **st}
            c["style_zh"] = style_text(c["style"], c.get("line_h"), frame_h)
            n += 1
    cap.release()
    return n


def summary_lines(pack: dict, sfx_align: dict | None = None) -> list[str]:
    cues = [c for c in pack.get("text_cues", []) if not c.get("part_of_picture")]  # words filmed in the scene are not packaging
    L = []
    subs = [c for c in cues if c["kind"] == "subtitle"]
    if subs:
        st = merge_style([c["style"] for c in subs if c.get("style")])
        anim = {}
        for c in subs:
            k = (c.get("anim_in") or {}).get("kind_zh")
            if k:
                anim[k] = anim.get(k, 0) + 1
        lines = max(c["n_lines"] for c in subs)
        bands = {BAND_ZH.get(c["band"], c["band"]) for c in subs}
        L.append(T("字幕 {n} 句（{b}，最多 {l} 行）：{s}", "{n} subtitle lines ({b}, up to {l} rows): {s}",
                   n=len(subs), b='/'.join(sorted(bands)), l=lines, s=style_text(st, float(np.median([c['line_h'] for c in subs]))))
                 + (T("；入场：{a}", "; entrance: {a}", a=join(f'{k}×{v}' for k, v in sorted(anim.items(), key=lambda kv: -kv[1]))) if anim else "")
                 + (T("；说到关键词时变色", "; keywords change colour as they are spoken") if any((c.get('style') or {}).get('highlight_timing') == 'spoken' for c in subs) else "")
                 + (T("；句中有弹跳/变色动效", "; bounce / colour-change motion inside lines") if sum(1 for c in subs if c.get("mid_motion")) >= max(2, 0.2 * len(subs)) else ""))
    for kind in ("huazi", "title", "label", "counter"):
        cs = [c for c in cues if c["kind"] == kind]
        if cs:
            names = join(T("「{t}」", "\"{t}\"", t=c['text'].replace('/', ' ')[:14]) for c in cs[:6]) + (T("等", " …") if len(cs) > 6 else "")
            extra = ""
            if kind == "huazi":
                extra = T("（{d}）", " ({d})", d=join(dict.fromkeys(w for c in cs for w in c.get("decor", []))))
            if kind == "label" and any(c.get("follows") for c in cs):
                extra = T("（其中 {n} 个跟着物体移动）", " ({n} of them follow an object)", n=sum(1 for c in cs if c.get('follows')))
            L.append(T("{k} {n} 处{e}：{names}", "{k} ×{n}{e}: {names}", k=KIND_ZH[kind], n=len(cs), e=extra, names=names))
    st_all = [s for s in pack.get("stickers", []) if not s.get("in_picture")]
    st = [s for s in st_all if s.get("confidence") != "low"]
    maybe = len(st_all) - len(st)
    if maybe:
        L.append(T("另有 {n} 处疑似贴纸（画面里一块突然变了，可能只是画面内容），需要看图确认",
                   "{n} more possible stickers (a block of the picture changed suddenly; may just be picture content), check the frames", n=maybe))
    if st:
        kinds: dict[str, int] = {}
        for s in st:
            kinds[s["kind_zh"]] = kinds.get(s["kind_zh"], 0) + 1
        loops = sum(1 for s in st if s.get("looping"))
        L.append(T("贴纸/动图 ", "Stickers / GIFs: ") + join(T("{k} {v} 处", "{k} ×{v}", k=k, v=v) for k, v in kinds.items()) + (T("（{n} 处循环播放）", " ({n} looping)", n=loops) if loops else "")
                 + (T("；VLM 看到的没有截图，需要核对", "; seen by the VLM without a frame grab, needs checking") if any(s.get("confidence") == "vlm" for s in st) else ""))
    if sfx_align:
        on = sfx_align.get("sfx_on", {})
        if on:
            L.append(T("音效卡点：", "SFX hits on: ") + join(T("{k} {v} 处", "{k} ×{v}", k=EVENT_ZH.get(k, k), v=v) for k, v in sorted(on.items(), key=lambda kv: -kv[1])))
        maybe_on = sfx_align.get("sfx_on_possible", {})
        if maybe_on:
            L.append(T("可能的音效卡点（信号候选，待确认）：", "Possible SFX hits (unconfirmed signal candidates) on: ")
                     + join(T("{k} {v} 处", "{k} ×{v}", k=EVENT_ZH.get(k, k), v=v) for k, v in sorted(maybe_on.items(), key=lambda kv: -kv[1])))
    elems = [c for c in cues if c["kind"] in ANCHOR_KINDS and not c.get("part_of_picture")] + st
    anchored = sorted((e for e in elems if e.get("anchor")), key=lambda e: (not e["anchor"].get("word"), e["t0"]))
    if anchored:
        L.append(T("按台词定位 {n} 处（换文案时跟着这句话走，不按原秒数放）：", "Placed by spoken line ×{n} (with new wording they follow the line, not the old second): ", n=len(anchored))
                 + join(f"{layer_name(e)} → {anchor_text(e['anchor'])}" for e in anchored[:3]) + (T("等", " …") if len(anchored) > 3 else ""))
    groups = persistent_groups(elems)
    if groups:
        L.append(T("常驻图层 {n} 个（跨切镜不变，复刻时整段叠一次，不进逐镜生成）：", "{n} persistent layers (unchanged across cuts: lay each on once for its span, not per shot): ", n=len(groups))
                 + join(f"{g['name']} {g['t0']:.1f}–{g['t1']:.1f}s" + (T("（{k} 段）", " ({k} spans)", k=g["n"]) if g["n"] > 1 else "") for g in groups[:4])
                 + (T("等", " …") if len(groups) > 4 else ""))
    return L


# ----------------------------------------------------------------------------- pipeline hooks

# bases whose own picture has things popping in and out (cards, UI, animated objects): a block that appears
# mid-shot there is content unless it also crosses a cut or loops like a GIF
CONTENT_BASES = ("code_render", "screen_capture", "cg_3d", "anim_2d", "stop_motion")
LAYER_ZH = LangDict({"huazi": "花字", "animated_sticker": "动态贴纸/GIF", "static_sticker": "静态贴纸", "pip": "画中画"},
                    en={"huazi": "styled text", "animated_sticker": "animated sticker / GIF", "static_sticker": "static sticker", "pip": "picture-in-picture"})


def clean_region(stickers: list[dict], t0: float, t1: float, min_area: float = 0.45) -> tuple[float, float, float, float] | None:
    """The largest band of the frame (left / right / above / below) free of the stickers that sit on this shot for
    most of it, so the picture's own statistics are measured without the pasted layer. None if no sticker
    covers the shot or the free band is too small to measure.

    Only stickers seen being pasted on within a shot (popped in mid-shot, or looping) count. A block that merely
    survives a cut is often content the two shots share (a character in consecutive illustrations, a heading on
    a layout card); cropping it away cost labels / holdout2 three shots (static -> code render, code render ->
    3D / AI video) and fixed none."""
    dur = max(1e-6, t1 - t0)
    boxes = [s["bbox"] for s in stickers
             if s.get("confidence") != "low" and (s.get("appears_mid_shot") or s.get("looping"))
             and min(t1, s["t1"]) - max(t0, s["t0"]) >= 0.4 * dur]
    if not boxes:
        return None
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[0] + b[2] for b in boxes)
    y1 = max(b[1] + b[3] for b in boxes)
    cands = [(0.0, 0.0, x0, 1.0), (x1, 0.0, 1.0 - x1, 1.0), (0.0, 0.0, 1.0, y0), (0.0, y1, 1.0, 1.0 - y1)]
    best = max(cands, key=lambda c: c[2] * c[3])
    return tuple(round(v, 4) for v in best) if best[2] * best[3] >= min_area else None


def shot_layers(pack: dict, rec: dict, label: str) -> list[dict]:
    """花字 / sticker layers on one shot. Marks stickers on content bases that are probably part of the picture."""
    t0, t1 = rec["start"], rec["end"]
    out = []
    for c in pack.get("text_cues", []):
        if c["kind"] == "huazi" and min(t1, c["t1"]) - max(t0, c["t0"]) > 0.1:
            out.append({"kind": "huazi", "source": "code_or_editor", "band": c.get("band"), "texts": [c["text"]], "ref": c["id"]})
    for s in pack.get("stickers", []):
        ov = min(t1, s["t1"]) - max(t0, s["t0"])
        if ov <= 0.1:
            continue
        if s.get("confirmed") is False or (s.get("in_picture") and s.get("confirmed") is None and s.get("source") is None):
            continue
        if (label in CONTENT_BASES and s.get("confirmed") is None and s.get("bbox") and not (s.get("crosses_cut") or s.get("looping"))
                and ov >= 0.5 * (s["t1"] - s["t0"])):
            s["in_picture"] = True  # a thing appearing inside an animated / rendered picture, not a pasted layer
            s["in_picture_why"] = T("出现在{l}画面里、不跨切镜也不循环：更像画面内容本身", "appears inside a {l} picture, does not cross a cut or loop: more likely picture content", l=label)
            continue
        if not s.get("in_picture") and s.get("confidence") != "low":
            band = _band(s["bbox"][1] + s["bbox"][3] / 2) if s.get("bbox") else None
            out.append({"kind": s["kind"], "source": "editor", "band": band, "bbox": s.get("bbox"), "ref": s["id"]})
    return out


def merge_vlm(pack: dict, whole: dict | None) -> None:
    """Stickers / text effects the whole-video VLM saw that the pixel pass did not."""
    if not whole:
        return
    for s in whole.get("stickers") or []:
        try:
            a, b = float(s.get("t0", s.get("t", 0))), float(s.get("t1", s.get("t0", s.get("t", 0))) or 0)
        except (TypeError, ValueError):
            continue
        b = max(b, a + 0.5)
        if any(min(b, o["t1"]) - max(a, o["t0"]) > 0 for o in pack.get("stickers", []) if not o.get("in_picture")):
            continue
        pack.setdefault("stickers", []).append({"id": f"sticker_vlm_{len(pack['stickers']) + 1:02d}", "kind": "animated_sticker"
                                                if any(w in str(s.get("what", "")).lower() for w in ("gif", "anim")) or "动" in str(s.get("what", "")) else "static_sticker",
                                                "kind_zh": str(s.get("what") or T("贴纸", "sticker")), "t0": round(a, 2), "t1": round(b, 2),
                                                "where": s.get("where", ""), "bbox": None, "confidence": "vlm", "source": "vlm"})
    pack["vlm_text_effects"] = [e for e in (whole.get("text_effects") or []) if isinstance(e, dict)][:60]


def relocalize(pack: dict, frame_h: int | None) -> None:
    """Display labels (kind_zh, style_zh, colour names) are stored in the language of the first run.
    Re-derive them from their codes so a report re-rendered with another --lang is not half one, half the other.
    Free text from a VLM or reviewer (VLM / agent stickers) stays as written."""
    name_to_code = {name: code for code in COLOR_ZH for name in (COLOR_ZH._zh[code], COLOR_ZH._en.get(code))}
    for c in pack.get("text_cues", []):
        if c.get("kind") in KIND_ZH:
            c["kind_zh"] = KIND_ZH[c["kind"]]
        for k in ("anim_in", "anim_out"):
            if isinstance(c.get(k), dict) and c[k].get("kind") in ANIM_ZH:
                c[k]["kind_zh"] = ANIM_ZH[c[k]["kind"]]
        st = c.get("style")
        if isinstance(st, dict):
            for k in ("fill_name", "stroke_name", "box_name", "highlight_name"):
                if st.get(k) in name_to_code:
                    st[k] = COLOR_ZH[name_to_code[st[k]]]
            c["style_zh"] = style_text(st, c.get("line_h"), frame_h)
    for st in pack.get("stickers", []):
        if st.get("source") not in ("vlm", "agent") and st.get("kind") in STICKER_ZH:
            st["kind_zh"] = STICKER_ZH[st["kind"]]


def apply_review(pack: dict) -> None:
    """An agent's look at the stickers and text kinds (rea-video review / apply-review) overrides the pixel pass."""
    rv = pack.get("review")
    if not rv:
        return
    for c in pack.get("text_cues", []):
        if c["id"] in rv.get("text", {}):
            c["kind"] = rv["text"][c["id"]]
            c["kind_zh"] = KIND_ZH[c["kind"]]
            c["reviewed"] = True
    for st in pack.get("stickers", []):
        a = rv.get("stickers", {}).get(st["id"])
        if not a:
            continue
        st["confirmed"] = a["is_overlay"]
        if a["is_overlay"]:
            st["confidence"] = "confirmed"
            st.pop("in_picture", None)
            if a.get("what"):
                st["what"] = a["what"]
        else:
            st["in_picture"] = True
            from .pipeline import reviewer_name

            st["in_picture_why"] = T("{by} 看图：画面本身的东西", "{by} looked at the frames: part of the picture itself", by=reviewer_name(rv.get('by', 'agent')))
    # the reviewer's missed stickers are this review's list: drop the ones an earlier apply added, then add the current ones
    pack["stickers"] = [st for st in pack.get("stickers", []) if not str(st.get("id", "")).startswith("sticker_agent_")]
    ids = {st["id"] for st in pack.get("stickers", [])}
    for k, m in enumerate(rv.get("missed", []), 1):
        sid = f"sticker_agent_{k:02d}"
        if sid in ids:
            continue
        try:
            t0 = float(m["t0"])
            t1 = float(m.get("t1", t0 + 1.0))
        except (TypeError, ValueError):
            continue
        what = str(m.get("what") or T("贴纸", "sticker"))
        pack.setdefault("stickers", []).append({"id": sid, "kind": "animated_sticker" if (any(w in what.lower() for w in ("gif", "anim")) or "动" in what) else "static_sticker",
                                                "kind_zh": what, "t0": round(t0, 2), "t1": round(max(t1, t0 + 0.2), 2), "bbox": None,
                                                "where": str(m.get("where", "")), "confidence": "confirmed", "source": "agent"})


def finalize_pack(breakdown: dict, out: Path) -> dict | None:
    from .classify import _same_words

    """After shots are labelled and the audio plan exists: SFX alignment, exports, summary lines."""
    pack = breakdown.get("packaging")
    if not pack:
        return None
    out = Path(out)
    labels = {r["id"]: r["base"]["label"] for r in breakdown["shots"]}
    for c in pack.get("text_cues", []):
        mid = (c["t0"] + c["t1"]) / 2
        r = next((r for r in breakdown["shots"] if r["start"] <= mid < r["end"]), None)
        c["shot"] = r["index"] if r else None
        # on a rendered / recorded picture, words are the picture's content, not a separate overlay
        c["part_of_picture"] = bool(r and labels[r["id"]] in ("code_render", "screen_capture") and c["kind"] not in ("subtitle",))
        # an image reader listed this shot's post-production words: the rest is text filmed in the scene
        said = r and ((r.get("vlm") or {}).get("overlay_text") if isinstance((r.get("vlm") or {}).get("overlay_text"), list)
                      else (r.get("review") or {}).get("overlay_text"))
        if isinstance(said, list) and not any(_same_words(c["text"], o) for o in said):  # [] = no post words in this shot
            c["part_of_picture"] = True
    src = breakdown.get("source") or {}
    frame_h = src.get("width") if src.get("rotation") in (90, 270) else src.get("height")
    if src.get("path"):
        restyle_rendered(pack, breakdown["shots"], src["path"], frame_h)
    stickers = [s for s in pack.get("stickers", []) if not s.get("in_picture")]
    cues = [c for c in pack.get("text_cues", []) if c["kind"] != "scene" and not c.get("part_of_picture")]
    cuts = [r["start"] for r in breakdown["shots"][1:]]
    plan = breakdown.get("audio_plan") or {}
    sfx = plan.get("sfx_merged", [])
    # heard, or looked for on the separated effects track: then a silent track means no effects, not "guess from the mix"
    has_vlm_sfx = any(e.get("source") == "vlm" for e in sfx) or (out / "stems" / "effects.wav").is_file()
    if not has_vlm_sfx:
        known = {round(float(e.get("t", -9)), 2) for e in sfx}
        for e in pack.get("sfx_anchored", []):
            if all(abs(e["t"] - k) >= 0.12 for k in known):
                sfx.append(dict(e, confidence="low"))
        sfx.sort(key=lambda e: float(e.get("t", 0)))
    anchor_layers(cues, stickers, cuts)
    events = visual_events(cues, stickers, cuts)
    pack["sfx_alignment"] = align_sfx(sfx, events)
    pack["summary_zh"] = summary_lines({**pack, "stickers": stickers}, pack["sfx_alignment"])
    d = out / "packaging"
    d.mkdir(parents=True, exist_ok=True)
    srt = to_srt(cues)
    pack["files"] = {}
    for stale in ("subtitles.srt", "overlays.ass"):  # a re-run with no subtitles must not keep the old export
        (d / stale).unlink(missing_ok=True)
    if srt.strip():
        (d / "subtitles.srt").write_text(srt, encoding="utf-8")
        pack["files"]["srt"] = "packaging/subtitles.srt"
    src = breakdown["source"]
    w, h = (src["height"], src["width"]) if src.get("rotation") in (90, 270) else (src["width"], src["height"])  # as displayed
    if cues:
        (d / "overlays.ass").write_text(to_ass([c for c in cues if not c.get("part_of_picture")], w, h), encoding="utf-8")
        pack["files"]["ass"] = "packaging/overlays.ass"
    timeline = {"text": [{k: c.get(k) for k in ("id", "kind", "kind_zh", "t0", "t1", "text", "bbox", "style", "style_zh", "anim_in",
                                                 "anim_out", "mid_motion", "follows", "part_of_picture", "anchor", "persistent")} for c in cues],
                "stickers": stickers,
                "sfx": [{k: e.get(k) for k in ("t", "type", "description", "source", "confidence", "on")} for e in sfx]}
    from .util import write_json

    write_json(d / "timeline.json", timeline)
    pack["files"]["timeline"] = "packaging/timeline.json"
    return pack
