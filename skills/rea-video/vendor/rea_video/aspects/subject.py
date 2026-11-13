"""The subject of a frame, the region that framing and lighting are measured on.

1. A face (YuNet, with landmarks): talking heads, vlogs, interviews.
2. Otherwise the in-focus region: where fine detail concentrates (hands and products on a desk, food, objects).
   Out-of-focus background and flat surfaces carry little Laplacian energy, so the sharpest blob is what the
   camera was focused on.
3. Otherwise the centre of the frame (flat or uniformly sharp pictures).

Returned box coordinates are fractions of the frame (x, y, w, h)."""
from __future__ import annotations

import cv2
import numpy as np


def salient_box(bgr: np.ndarray) -> list[float] | None:
    h, w = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    energy = np.abs(cv2.Laplacian(gray, cv2.CV_32F))
    energy = cv2.GaussianBlur(energy, (0, 0), max(w, h) / 30)
    if float(energy.max()) <= 1e-3:
        return None
    thr = np.percentile(energy, 80)
    mask = (energy >= thr).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n <= 1:
        return None
    # the component holding the most energy, not just the largest
    best = max(range(1, n), key=lambda i: float(energy[lab == i].sum()))
    x, y, bw, bh = (int(v) for v in stats[best, :4])
    if bw * bh > 0.85 * w * h or bw * bh < 0.01 * w * h:
        return None
    return [x / w, y / h, bw / w, bh / h]


def subject(bgr: np.ndarray, face: dict | None) -> dict:
    if face:
        return {"kind": "face", "box": face["box"], "landmarks": face.get("landmarks"), "area": face["area"]}
    box = salient_box(bgr)
    if box:
        return {"kind": "focus", "box": box, "landmarks": None, "area": box[2] * box[3]}
    return {"kind": "frame", "box": [0.2, 0.2, 0.6, 0.6], "landmarks": None, "area": 0.36}
