"""Material provenance: which pixels came from *real, imported material* (camera footage,
photos, screenshots / screen recordings) versus things the maker generated (AI) or
rendered (code / 3D templates).

Two different things are kept apart:
  items       pixels in the frame that came from real material (footage, photos, screenshots, recordings,
              a clip playing inside a UI). A remake must be given these files; a model cannot regenerate them.
  references  what a *generated* picture depicts and a remake should be conditioned on (the product, its
              logo, a person's look). The pixels were generated, so this is not real material in the frame.

Full-frame material follows from the base label (live action = real footage, screen
capture = real UI, still image = photo/AI image/graphic). Embedded material is found inside
rendered layouts: rectangles or regions whose texture is photographic (high grey-level
entropy) or that hold dense small UI text (a screenshot pasted into a card)."""
from __future__ import annotations

from .i18n import LangDict, T

import cv2
import numpy as np

BLOCK = 16
KIND_ZH = LangDict({
    "real_footage": "实拍视频素材", "photo_or_image": "照片/图片素材", "screenshot": "界面截图",
    "screen_recording": "录屏素材", "video_clip": "嵌入视频片段", "ai_generated": "AI 生成", "rendered": "制作方渲染",
    "photo": "真实照片", "ai_image": "AI 生成图", "graphic": "设计图形", "logo": "Logo/品牌标识", "product_photo": "商品实拍图",
    "film_clip": "影视原片片段",
}, en={
    "real_footage": "live footage", "photo_or_image": "photo / image", "screenshot": "UI screenshot",
    "screen_recording": "screen recording", "video_clip": "embedded video clip", "ai_generated": "AI-generated", "rendered": "rendered by the creator",
    "photo": "photo", "ai_image": "AI-generated image", "graphic": "designed graphic", "logo": "logo / brand mark", "product_photo": "product photo",
    "film_clip": "clip from a film / series",
})
REF_ZH = LangDict({"product_photo": "商品参考图", "logo": "Logo/品牌参考", "photo": "人物/场景参考图", "real_footage": "动作/场景参考视频",
                   "screenshot": "界面参考图", "screen_recording": "界面参考录屏", "video_clip": "参考视频", "photo_or_image": "参考图"},
                  en={"product_photo": "product reference image", "logo": "logo / brand reference", "photo": "person / scene reference image",
                      "real_footage": "action / scene reference video", "screenshot": "UI reference image", "screen_recording": "UI reference recording",
                      "video_clip": "reference video", "photo_or_image": "reference image"})
# bases whose pixels a model / renderer produced: what the VLM "sees" in them is a reference, not embedded material
GENERATED_BASES = ("ai_video", "avatar")
# a 3D render can still carry a pasted screenshot or recording; products / logos / people in it are modelled
RENDER_REF_KINDS = ("product_photo", "logo", "photo", "real_footage", "ai_image")
ORIGIN_ZH = LangDict({"real": "用户真实素材", "ai_generated": "AI 生成", "rendered": "制作方渲染", "mixed": "混合（含真实素材）",
                      "third_party": "影视原片（版权属于片方）", "unknown": "待确认"},
                     en={"real": "the user's real material", "ai_generated": "AI-generated", "rendered": "rendered by the creator",
                         "mixed": "mixed (includes real material)", "third_party": "film / TV source (rights belong to the studio)", "unknown": "to confirm"})
REAL_KINDS = {"real_footage", "photo_or_image", "screenshot", "screen_recording", "video_clip", "photo", "logo", "product_photo", "film_clip"}


def _entropy(gray_block: np.ndarray) -> float:
    h = np.bincount((gray_block >> 3).ravel(), minlength=32).astype(np.float64)
    p = h[h > 0] / h.sum()
    return float(-(p * np.log2(p)).sum())


def block_classes(bgr: np.ndarray) -> dict[str, np.ndarray]:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    bh, bw = h // BLOCK, w // BLOCK
    photo = np.zeros((bh, bw), bool)
    flat = np.zeros((bh, bw), bool)
    for by in range(bh):
        for bx in range(bw):
            g = gray[by * BLOCK:(by + 1) * BLOCK, bx * BLOCK:(bx + 1) * BLOCK]
            sd = float(g.std())
            if sd < 2.0:
                flat[by, bx] = True
            elif sd > 6.0 and _entropy(g) > 3.4:
                photo[by, bx] = True
    return {"photo": photo, "flat": flat, "shape": np.array([bh, bw])}


def _rects(bgr: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Large axis-aligned rectangles (cards, windows, pasted screenshots)."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    edges = cv2.Canny(gray, 40, 120)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8))
    cnts, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cnts:
        x, y, bw, bh = cv2.boundingRect(c)
        area = bw * bh
        if area < 0.03 * w * h or area > 0.9 * w * h or bw < 0.15 * w or bh < 0.08 * h:
            continue
        fill = cv2.contourArea(cv2.convexHull(c)) / float(area)
        if fill > 0.85:
            out.append((x, y, bw, bh))
    return _nms(out)


def _light_panels(bgr: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Bright, low-saturation rectangles (pasted web/app screenshots, documents) — these
    often touch the frame edges, so contour-based rectangle search misses them."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, w = hsv.shape[:2]
    light = ((hsv[..., 2] > 200) & (hsv[..., 1] < 60)).astype(np.uint8)
    if light.mean() > 0.85:  # the whole frame is light: that's the base, not a panel
        return []
    light = cv2.morphologyEx(light, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    n, _lab, stats, _ = cv2.connectedComponentsWithStats(light, connectivity=8)
    out = []
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if 0.05 * w * h <= bw * bh <= 0.85 * w * h and area / float(bw * bh) > 0.75 and bw > 0.3 * w and bh > 0.1 * h:
            out.append((int(x), int(y), int(bw), int(bh)))
    return out


def _iou(a, b) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix, iy = max(0, min(ax + aw, bx + bw) - max(ax, bx)), max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    return inter / float(aw * ah + bw * bh - inter + 1e-6)


def _nms(rects, thr: float = 0.5):
    rects = sorted(rects, key=lambda r: -r[2] * r[3])
    keep = []
    for r in rects:
        if all(_iou(r, k) < thr for k in keep):
            keep.append(r)
    return keep


def _photo_regions(cls: dict, frame_shape) -> list[tuple[int, int, int, int]]:
    photo = cls["photo"].astype(np.uint8)
    photo = cv2.morphologyEx(photo, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, _lab, stats, _ = cv2.connectedComponentsWithStats(photo, connectivity=8)
    bh, bw = cls["shape"]
    out = []
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if area >= 0.03 * bh * bw and area / float(ww * hh) > 0.45:
            out.append((x * BLOCK, y * BLOCK, ww * BLOCK, hh * BLOCK))
    return out


def detect_embedded(frames: list[np.ndarray], ocr_items: list[dict] | None = None) -> list[dict]:
    """Find imported material inside a rendered layout. Returns normalized regions."""
    if not frames:
        return []
    mid = frames[len(frames) // 2]
    h, w = mid.shape[:2]
    cls = block_classes(mid)
    cands = _nms(_rects(mid) + _light_panels(mid) + _photo_regions(cls, mid.shape))
    grays = np.stack([cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) for f in frames]) if len(frames) > 2 else None
    found = []
    for x, y, rw, rh in cands:
        if rw * rh > 0.85 * w * h:
            continue
        bx0, by0, bx1, by1 = x // BLOCK, y // BLOCK, max(x // BLOCK + 1, (x + rw) // BLOCK), max(y // BLOCK + 1, (y + rh) // BLOCK)
        photo_frac = float(cls["photo"][by0:by1, bx0:bx1].mean())
        roi = cv2.cvtColor(mid[y:y + rh, x:x + rw], cv2.COLOR_BGR2HSV)
        light = float(np.median(roi[..., 2])) > 170
        sat = float(roi[..., 1].mean() / 255.0)
        nx, ny, nw, nh = x / w, y / h, rw / w, rh / h
        inside = [t for t in (ocr_items or []) if nx <= t["bbox"][0] + t["bbox"][2] / 2 <= nx + nw and ny <= t["bbox"][1] + t["bbox"][3] / 2 <= ny + nh]
        # count per sampled frame (subtitles changing over time must not add up)
        by_t: dict[float, list[dict]] = {}
        for t in inside:
            by_t.setdefault(t.get("t", 0.0), []).append(t)
        texts = max(by_t.values(), key=len) if by_t else []
        small = [t for t in texts if t["bbox"][3] < 0.03]
        moving = False
        if grays is not None:
            inside = grays[:, y:y + rh, x:x + rw].std(axis=0).mean()
            mask = np.ones(grays.shape[1:], bool)
            mask[y:y + rh, x:x + rw] = False
            outside = grays.std(axis=0)[mask].mean() if mask.any() else 0.0
            moving = bool(inside > 4.0 and inside > 2.5 * outside)
        kind, why = None, ""
        text_area = sum(t["bbox"][2] * t["bbox"][3] for t in texts) / max(1e-6, nw * nh)
        if photo_frac >= 0.35 and text_area < 0.2 and not (ny > 0.6 and nh < 0.2):  # not a subtitle band
            kind = "video_clip" if moving else "photo_or_image"
            why = T("区域内 {p:.0%} 的块是照片纹理（灰度熵高、无平涂色）", "{p:.0%} of the blocks in the region have photographic texture (high grey-level entropy, no flat fills)", p=photo_frac)
        elif (light and sat < 0.3 and len(small) >= 6) or len(small) >= 15:
            kind = "screen_recording" if moving else "screenshot"
            why = T("浅色界面面板内有 {n} 处文字（其中 {s} 处小字号）", "a light UI panel holding {n} text items ({s} of them small type)", n=len(texts), s=len(small))
        if kind:
            certain = kind in ("screenshot", "screen_recording")
            found.append({"kind": kind, "kind_zh": KIND_ZH[kind], "bbox": [round(nx, 3), round(ny, 3), round(nw, 3), round(nh, 3)],
                          "area": round(nw * nh, 3), "moving": moving, "evidence": why,
                          # an embedded picture/clip may be a real photo or an AI image: needs VLM / human
                          "real_material": True if certain else None, "source": "deterministic"})
    return _dedupe(found)


def _dedupe(found: list[dict]) -> list[dict]:
    """Drop regions mostly contained in a larger region (a thumbnail inside a screenshot is
    part of that screenshot; nested duplicates of the same panel collapse to the larger)."""
    found = sorted(found, key=lambda r: -r["area"])
    keep: list[dict] = []
    for r in found:
        x, y, w, h = r["bbox"]
        contained = False
        for k in keep:
            kx, ky, kw, kh = k["bbox"]
            ix = max(0.0, min(x + w, kx + kw) - max(x, kx))
            iy = max(0.0, min(y + h, ky + kh) - max(y, ky))
            if ix * iy > 0.7 * w * h:
                contained = True
                break
        if not contained:
            keep.append(r)
    return keep


def material_summary(label: str, image_source: str | None, embedded: list[dict], vlm: dict | None, moving: bool = True) -> dict:
    """Shot-level origin: real (user-supplied) material vs AI-generated vs maker-rendered."""
    items: list[dict] = []
    if label == "live_action":
        items.append({"kind": "real_footage", "region": "full", "real_material": True})
    elif label == "film_footage":
        # the original clip is the material: a remake needs the source file (and the right to use it)
        items.append({"kind": "film_clip", "region": "full", "real_material": True})
    elif label == "screen_capture":
        items.append({"kind": "screen_recording" if moving and image_source != "screenshot" else "screenshot", "region": "full", "real_material": True})
    elif label in ("static_hold", "still_motion"):
        src = image_source or "unknown"
        if src in ("photo", "screenshot"):
            items.append({"kind": src, "region": "full", "real_material": True})
        elif src == "unknown":
            items.append({"kind": "photo_or_image", "region": "full", "real_material": None})
    full_kinds = {i["kind"] for i in items}
    for e in embedded:
        if e["kind"] in full_kinds:
            continue  # already covered by the full-frame item
        items.append({"kind": e["kind"], "region": "embedded", "bbox": e["bbox"], "real_material": e.get("real_material", True), "moving": e.get("moving", False),
                      "evidence": e.get("evidence", "")})
    refs: list[dict] = []
    for e in (vlm or {}).get("embedded_assets", []) or []:
        if not (isinstance(e, dict) and e.get("is_real_material")):
            continue
        kind = e.get("kind", "photo_or_image")
        desc = e.get("description", "")
        if label in GENERATED_BASES or (label == "cg_3d" and kind in RENDER_REF_KINDS) or label in ("live_action", "film_footage"):
            # generated / modelled / filmed pixels: the product or person is something to supply as a reference
            # (for live action the whole frame is already real footage)
            # camera footage "in" a generated or filmed picture is not something a remake can be given
            if kind not in ("ai_image", "real_footage", "video_clip") and (label not in ("live_action", "film_footage") or kind in ("product_photo", "logo")):
                refs.append({"kind": kind, "kind_zh": REF_ZH.get(kind, T("参考素材", "reference material")), "description": desc, "source": "vlm"})
            continue
        if kind == "real_footage":
            kind = "video_clip"  # a clip inside a layout: real file, but not necessarily camera footage
        items.append({"kind": kind, "region": "embedded", "real_material": True, "description": desc, "source": "vlm"})
    vlm_origin = (vlm or {}).get("material_origin")
    real = [i for i in items if i.get("real_material")]
    uncertain = [i for i in items if i.get("real_material") is None]
    if label in ("ai_video", "avatar"):
        base = "ai_generated"
    elif label in ("code_render", "cg_3d"):
        base = "rendered"
    elif label in ("live_action", "screen_capture"):
        base = "real"
    elif label == "film_footage":
        base = "third_party"
    elif image_source == "ai_image":
        base = "ai_generated"
    elif image_source == "graphic":
        base = "rendered"
    elif image_source in ("photo", "screenshot"):
        base = "real"
    else:
        base = "unknown"
    if vlm_origin in ("real", "ai_generated", "rendered", "mixed"):
        base = vlm_origin if base == "unknown" else base
    origin = base
    if real and base in ("ai_generated", "rendered"):
        origin = "mixed"
    return {"origin": origin, "origin_zh": ORIGIN_ZH[origin], "has_real_material": bool(real), "uncertain": bool(uncertain),
            "items": [dict(i, kind_zh=KIND_ZH.get(i["kind"], i["kind"])) for i in items], "references": refs}
