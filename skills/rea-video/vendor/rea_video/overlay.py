"""Overlay layers: things composited on top of the base picture.

1. Static overlays: pixels that stay frozen while the rest of the shot changes
   (titles, logos, watermarks, layout frames) -> almost always rendered by code/editor.
2. Text (OCR, optional rapidocr): subtitle band, titles, labels; text that changes at a
   fixed band in sync with speech is a subtitle track.
3. Persistent template: regions frozen across *all* shots (layout skins, watermarks)."""
from __future__ import annotations

import hashlib
import os
import uuid
from pathlib import Path

import cv2
import numpy as np

from .util import LOG, OCR_LANGS, fetch

# Recognition models for languages other than the bundled Chinese/English one. Detection stays the bundled
# model, which finds Japanese text lines fine; only the recognizer's character set has to change. The ONNX
# files from RapidOCR carry their character list in the model metadata, so no separate dict is needed.
_REC_MODELS = {
    "ja": ("japan_PP-OCRv4_rec_mobile.onnx",
           "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv4/rec/japan_PP-OCRv4_rec_mobile.onnx",
           "e1075a67dba758ecfc7ebc78a10ae61c95ac8fb66a9c86fab5541e33f085cb7a"),
}
_OCR: dict = {}  # language -> RapidOCR instance, or None when it could not be loaded


def ocr_lang() -> str:
    """Subtitle language for OCR: $REA_OCR_LANG (set by --ocr-lang / prefs ocr_lang), default zh."""
    lang = os.getenv("REA_OCR_LANG", "zh").strip().lower() or "zh"
    if lang not in OCR_LANGS:
        raise ValueError(f"unsupported OCR language {lang!r} (choose from {', '.join(OCR_LANGS)})")
    return lang


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def rec_model(lang: str) -> Path:
    """Path of the recognition model for `lang`: $REA_OCR_REC_MODEL if set, else downloaded once and cached
    in $REA_VIDEO_MODELS next to the stem model."""
    override = os.getenv("REA_OCR_REC_MODEL")
    if override:
        return Path(override).expanduser()
    from .stems import models_dir

    name, url, sha = _REC_MODELS[lang]
    p = models_dir() / name
    if p.is_file() and _sha256(p) == sha:
        return p
    p.parent.mkdir(parents=True, exist_ok=True)
    LOG.info("downloading OCR model %s -> %s", name, p)
    tmp = p.with_name(f"{p.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.part")
    try:
        fetch(url, tmp)
        if _sha256(tmp) != sha:
            raise OSError(f"checksum mismatch for {name}")
        tmp.replace(p)
    finally:
        tmp.unlink(missing_ok=True)
    return p


class _RapidOCR3:
    """rapidocr 3.x (used on Python >= 3.13, where rapidocr-onnxruntime has no release) behind the
    rapidocr-onnxruntime call shape: ocr(img) -> ([[box, text, score], ...] or None, elapse)."""

    def __init__(self, rec_model_path: str | None = None):
        from rapidocr import RapidOCR  # type: ignore

        params = {"Global.log_level": "warning"}
        if rec_model_path:  # its character list is read from the ONNX metadata, as with rapidocr-onnxruntime
            params["Rec.model_path"] = rec_model_path
        self._ocr = RapidOCR(params=params)

    def __call__(self, img):
        out = self._ocr(img)
        boxes, txts, scores = getattr(out, "boxes", None), getattr(out, "txts", None), getattr(out, "scores", None)
        if boxes is None or txts is None or scores is None:
            return None, getattr(out, "elapse", 0.0)
        return [[np.asarray(b).tolist(), t, float(s)] for b, t, s in zip(boxes, txts, scores)], out.elapse


def _ocr_engine(**kwargs):
    try:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore
    except ImportError:
        return _RapidOCR3(**kwargs)
    return RapidOCR(**kwargs)


def get_ocr():
    lang = ocr_lang()
    if lang not in _OCR:
        try:
            kwargs = {"rec_model_path": str(rec_model(lang))} if lang in _REC_MODELS else {}
            _OCR[lang] = _ocr_engine(**kwargs)
        except Exception as exc:  # pragma: no cover - optional dependency / offline
            LOG.warning("OCR disabled (pip install 'rea-video[ocr]' to enable; lang=%s): %s", lang, exc)
            _OCR[lang] = None
    return _OCR[lang]


def _boxes_from_mask(mask: np.ndarray, min_area_frac: float = 0.002) -> list[list[int]]:
    h, w = mask.shape
    m = cv2.morphologyEx(mask.astype(np.uint8) * 255, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, _labels, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    boxes = []
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if area >= min_area_frac * h * w:
            boxes.append([int(x), int(y), int(bw), int(bh)])
    return boxes


def _band(y_center: float, h: int) -> str:
    r = y_center / h
    if r < 0.22:
        return "top"
    if r > 0.70:
        return "bottom"
    return "middle"


def static_overlays(frames: list[np.ndarray]) -> dict:
    """Detect frozen, edge-rich regions while the shot's background changes."""
    if len(frames) < 4:
        return {"background_changes": False, "boxes": [], "static_edge_ratio": 0.0}
    grays = np.stack([cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) for f in frames])
    std = grays.std(axis=0)
    h, w = std.shape
    moving = std > 6.0
    background_changes = bool(moving.mean() > 0.15)
    edges = cv2.Canny(grays[len(grays) // 2].astype(np.uint8), 60, 160) > 0
    edges = cv2.dilate(edges.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    frozen = std < 1.5
    static_edges = frozen & edges
    out = {"background_changes": background_changes, "boxes": [],
           "static_edge_ratio": float(static_edges.sum() / max(1, edges.sum()))}
    if not background_changes:
        return out
    # keep only frozen edge clusters (text/graphics), not large flat frozen areas
    for x, y, bw, bh in _boxes_from_mask(static_edges, 0.0015):
        density = float(static_edges[y:y + bh, x:x + bw].mean())
        if density < 0.06:
            continue
        out["boxes"].append({"bbox": [x / w, y / h, bw / w, bh / h], "band": _band(y + bh / 2, h), "edge_density": density})
    return out


def ocr_frames(frames: list[np.ndarray], times: list[float], max_frames: int = 4) -> list[dict]:
    ocr = get_ocr()
    if ocr is None or not frames:
        return []
    idx = np.unique(np.linspace(0, len(frames) - 1, num=min(max_frames, len(frames))).round().astype(int))
    results = []
    for i in idx:
        f = frames[i]
        h, w = f.shape[:2]
        scale = 1.0
        if w < 720:  # upscale small analysis frames for better CJK recognition
            scale = 720 / w
            f = cv2.resize(f, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        try:
            res, _ = ocr(f)
        except Exception as exc:  # pragma: no cover
            LOG.debug("ocr failed: %s", exc)
            continue
        for box, text, conf in res or []:
            pts = np.array(box, dtype=np.float32) / scale
            x0, y0 = pts.min(axis=0)
            x1, y1 = pts.max(axis=0)
            ang = float(np.degrees(np.arctan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0])))
            results.append({"t": round(times[i], 3), "text": text, "conf": float(conf),
                            "bbox": [float(x0 / w), float(y0 / h), float((x1 - x0) / w), float((y1 - y0) / h)],
                            "band": _band((y0 + y1) / 2, h), "angle": round(ang, 1)})
    return results


def shot_ocr_items(whole: list[dict] | None, step: float, start: float, end: float) -> list[dict] | None:
    """The whole-video OCR pass already read this shot: its hits in [start, end), or None when that pass is
    missing or too sparse here (fewer than one read per 0.6 s, or no read inside the shot)."""
    if whole is None or not step or step > 0.6:
        return None
    first_read = np.ceil(start / step - 1e-6) * step  # reads happen at 0, step, 2*step, ...
    if first_read >= end:
        return None
    return [dict(it, band=_band(it["bbox"][1] + it["bbox"][3] / 2, 1)) for it in whole if start <= it["t"] < end]


def shot_ocr_frames(duration: float) -> int:
    """Frames to OCR for a shot of this length when the whole-video pass is not there: one per ~0.75 s, 1 to 4."""
    return int(min(4, max(1, np.ceil(duration / 0.75))))


def summarize_text(items: list[dict]) -> dict:
    """Group OCR hits into tracks: same band + similar x-position."""
    if not items:
        return {"tracks": [], "text_coverage": 0.0}
    tracks: list[dict] = []
    for it in sorted(items, key=lambda d: (d["band"], d["t"])):
        cx = it["bbox"][0] + it["bbox"][2] / 2
        cy = it["bbox"][1] + it["bbox"][3] / 2
        hit = None
        for tr in tracks:
            if tr["band"] == it["band"] and abs(tr["cy"] - cy) < 0.06:
                hit = tr
                break
        if hit is None:
            hit = {"band": it["band"], "cy": cy, "cx": cx, "texts": [], "times": [], "heights": [], "axis_aligned": True, "pos": {}}
            tracks.append(hit)
        if it["text"] not in hit["texts"]:
            hit["texts"].append(it["text"])
        hit["times"].append(it["t"])
        hit["heights"].append(it["bbox"][3])
        hit["pos"].setdefault(it["text"], []).append((it["bbox"][0], it["bbox"][1]))
        hit["axis_aligned"] = hit["axis_aligned"] and abs(it["angle"]) < 3
    out = []
    for tr in tracks:
        changing = len(tr["texts"]) > 1
        kind = "subtitle" if tr["band"] == "bottom" and changing else ("title" if tr["band"] == "top" else "label")
        if tr["band"] == "middle" and changing:
            kind = "subtitle"
        # the same words seen at different places = printed on something that moves (a cup, a sign), not an overlay
        rep = [np.array(p) for p in tr["pos"].values() if len(p) >= 2]
        drift = round(float(max(np.ptp(p, axis=0).max() for p in rep)), 3) if rep else None
        out.append({"kind": kind, "band": tr["band"], "texts": tr["texts"][:12], "changing": changing,
                    "axis_aligned": tr["axis_aligned"], "text_height": float(np.median(tr["heights"])),
                    "y_center": round(tr["cy"], 3), "drift": drift})
    cov = float(sum(i["bbox"][2] * i["bbox"][3] for i in items) / max(1, len({i["t"] for i in items})))
    return {"tracks": out, "text_coverage": cov, "items": items[:80]}


def persistent_template(frames: list[np.ndarray]) -> dict:
    """Regions frozen across the whole video (sampled across shots)."""
    if len(frames) < 6:
        return {"frozen_ratio": 0.0, "boxes": []}
    grays = np.stack([cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) for f in frames])
    std = grays.std(axis=0)
    frozen = std < 2.0
    h, w = std.shape
    edges = cv2.Canny(grays[0].astype(np.uint8), 60, 160) > 0
    boxes = [{"bbox": [x / w, y / h, bw / w, bh / h], "band": _band(y + bh / 2, h)}
             for x, y, bw, bh in _boxes_from_mask(frozen & edges, 0.001)]
    return {"frozen_ratio": float(frozen.mean()), "frozen_edge_ratio": float((frozen & edges).sum() / max(1, edges.sum())), "boxes": boxes[:20]}
