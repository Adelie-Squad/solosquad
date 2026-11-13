"""Face detection for shot analysis: YuNet (OpenCV FaceDetectorYN, ~230 KB ONNX, downloaded once to
$REA_VIDEO_MODELS) with five landmarks per face. Falls back to a Haar cascade on OpenCV builds that still ship
it. YuNet also fires on cartoon / plush / illustrated faces: a face means "a character is on screen", not
"this is live action"."""
from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path

import cv2
import numpy as np

from .util import fetch, sha256_file

LOG = logging.getLogger(__name__)
MODEL_NAME = "face_detection_yunet_2023mar.onnx"
# 固定到 commit，并校验 sha256：防止上游或中间人替换模型
MODEL_URL = f"https://github.com/opencv/opencv_zoo/raw/f12e12798e8314f7c074a6656816c048dcc95b7a/models/face_detection_yunet/{MODEL_NAME}"
MODEL_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
MIN_AREA = 0.02  # a face must cover >= 2% of the frame to count

_DET = None  # cv2.FaceDetectorYN | "haar" cascade | False (unavailable)


def _models_dir() -> Path:
    return Path(os.getenv("REA_VIDEO_MODELS", str(Path.home() / ".cache/rea-video/models"))).expanduser()


def _ensure_model() -> Path | None:
    p = _models_dir() / MODEL_NAME
    if p.is_file() and sha256_file(p) == MODEL_SHA256:
        return p
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f"{p.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.part")
    try:
        LOG.info("downloading face model %s -> %s", MODEL_NAME, p)
        fetch(MODEL_URL, tmp)
        if sha256_file(tmp) != MODEL_SHA256:
            raise OSError("checksum mismatch")
        tmp.replace(p)
        return p
    except Exception as exc:  # offline: fall back to Haar if this OpenCV has it
        LOG.warning("face model download failed (%s); face detection falls back to Haar or is skipped", str(exc)[:120])
        return None
    finally:
        tmp.unlink(missing_ok=True)


def _detector():
    global _DET
    if _DET is not None:
        return _DET
    _DET = False
    model = _ensure_model() if hasattr(cv2, "FaceDetectorYN") else None
    if model:
        try:
            _DET = ("yunet", cv2.FaceDetectorYN.create(str(model), "", (320, 320), 0.6, 0.3, 50))
            return _DET
        except Exception as exc:  # pragma: no cover
            LOG.warning("YuNet failed to load: %s", exc)
    if hasattr(cv2, "CascadeClassifier"):
        try:
            c = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")  # type: ignore[attr-defined]
            if not c.empty():
                _DET = ("haar", c)
        except Exception:  # pragma: no cover
            pass
    if not _DET:
        LOG.warning("no face detector available: face-based evidence and shot-size measurement are skipped")
    return _DET


def detect(frame: np.ndarray) -> list[dict]:
    """Faces in one BGR frame, largest first: {box: [x, y, w, h] in 0..1, area, score, landmarks: 5x[x, y] in 0..1 | None}."""
    det = _detector()
    if not det:
        return []
    kind, d = det
    h, w = frame.shape[:2]
    out = []
    if kind == "yunet":
        d.setInputSize((w, h))
        _, faces = d.detect(frame)
        for f in (faces if faces is not None else []):
            x, y, fw, fh = (float(v) for v in f[:4])
            lm = [[float(f[4 + 2 * i]) / w, float(f[5 + 2 * i]) / h] for i in range(5)]  # r-eye, l-eye, nose, r-mouth, l-mouth
            out.append({"box": [x / w, y / h, fw / w, fh / h], "area": fw * fh / (w * h), "score": float(f[14]), "landmarks": lm})
    else:
        g = cv2.equalizeHist(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        for (x, y, fw, fh) in d.detectMultiScale(g, scaleFactor=1.15, minNeighbors=5, minSize=(32, 32)):
            out.append({"box": [x / w, y / h, fw / w, fh / h], "area": fw * fh / (w * h), "score": 1.0, "landmarks": None})
    out = [f for f in out if f["area"] >= MIN_AREA]
    return sorted(out, key=lambda f: -f["area"])


def shot_faces(frames: list[np.ndarray], max_frames: int = 6) -> dict:
    """Face summary over a shot's sampled frames: presence ratio and the main face per sampled frame."""
    if not frames:
        return {"presence": 0.0, "frames": []}
    step = max(1, len(frames) // max_frames)
    picked = list(range(0, len(frames), step))[:max_frames]
    per = []
    for i in picked:
        fs = detect(frames[i])
        per.append({"i": i, "face": fs[0] if fs else None, "count": len(fs)})
    hits = sum(1 for p in per if p["face"])
    return {"presence": hits / len(per), "frames": per}
