"""Contact sheets, storyboard image and face presence."""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .i18n import LangDict, T
from .util import fmt_time

LABEL_COLOR = {
    "live_action": (46, 160, 67), "ai_video": (217, 70, 239), "avatar": (236, 72, 153), "cg_3d": (14, 165, 233),
    "code_render": (245, 158, 11), "screen_capture": (100, 116, 139), "still_motion": (168, 85, 247),
    "static_hold": (148, 163, 184), "anim_2d": (234, 88, 12), "stop_motion": (161, 98, 7),
    "film_footage": (190, 18, 60),
}
# short names for the storyboard strip (the full names are too long for a 200px cell)
LABEL_SHORT = LangDict({
    "live_action": "实拍", "ai_video": "AI 视频", "avatar": "数字人", "cg_3d": "3D 渲染", "code_render": "代码渲染",
    "screen_capture": "录屏/截图", "still_motion": "静图推拉", "static_hold": "静帧", "anim_2d": "2D 动画",
    "stop_motion": "定格动画", "film_footage": "影视片段",
}, en={
    "live_action": "Live action", "ai_video": "AI video", "avatar": "Avatar", "cg_3d": "3D render", "code_render": "Code render",
    "screen_capture": "Screen cap", "still_motion": "Pan/zoom", "static_hold": "Still", "anim_2d": "2D anim",
    "stop_motion": "Stop motion", "film_footage": "Film clip",
})
_FONT_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/STHeiti Light.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def _font(size: int):
    for p in _FONT_CANDIDATES:
        if Path(p).is_file():
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _fit_font(d: ImageDraw.ImageDraw, text: str, size: int, max_w: int, min_size: int = 13):
    """Largest font from `size` down to `min_size` whose rendering of `text` fits in `max_w` pixels."""
    f = _font(size)
    while size > min_size and d.textlength(text, font=f) > max_w:
        size -= 1
        f = _font(size)
    return f


def _to_pil(bgr: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))


def shot_sheet(frames: list[np.ndarray], times: list[float], out: Path, n: int = 4, cell_w: int = 240) -> Path | None:
    if not frames:
        return None
    idx = np.unique(np.linspace(0, len(frames) - 1, num=min(n, len(frames))).round().astype(int))
    cells = []
    font = _font(14)
    for i in idx:
        im = _to_pil(frames[i])
        im = im.resize((cell_w, int(im.height * cell_w / im.width)))
        d = ImageDraw.Draw(im)
        label = fmt_time(times[i])
        d.rectangle([0, 0, 72, 18], fill=(0, 0, 0))
        d.text((4, 2), label, fill=(255, 255, 255), font=font)
        cells.append(im)
    h = max(c.height for c in cells)
    sheet = Image.new("RGB", (cell_w * len(cells), h), (20, 20, 20))
    for k, c in enumerate(cells):
        sheet.paste(c, (k * cell_w, 0))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=88)
    return out


def storyboard(items: list[tuple[np.ndarray, str, str, float, float]], out: Path, cols: int = 6, cell_w: int = 200) -> Path | None:
    """items: (frame, label, title, start, end)."""
    if not items:
        return None
    small = _font(15)
    cells = []
    for frame, label, title, st, en in items:
        im = _to_pil(frame)
        im = im.resize((cell_w, int(im.height * cell_w / im.width)))
        bar = 56
        cell = Image.new("RGB", (cell_w, im.height + bar), (255, 255, 255))
        cell.paste(im, (0, 0))
        d = ImageDraw.Draw(cell)
        color = LABEL_COLOR.get(label, (80, 80, 80))
        d.rectangle([0, im.height, cell_w, im.height + bar], fill=color)
        d.text((8, im.height + 4), title, fill=(255, 255, 255), font=_fit_font(d, title, 21, cell_w - 14))
        d.text((8, im.height + 33), f"{st:.1f}–{en:.1f}s", fill=(255, 255, 255), font=small)
        d.line([(cell_w - 1, 0), (cell_w - 1, im.height + bar)], fill=(255, 255, 255), width=2)  # gap between cells
        cells.append(cell)
    ch = max(c.height for c in cells)
    rows = (len(cells) + cols - 1) // cols
    sheet = Image.new("RGB", (cell_w * min(cols, len(cells)), ch * rows), (240, 240, 240))
    for k, c in enumerate(cells):
        sheet.paste(c, ((k % cols) * cell_w, (k // cols) * ch))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=88)
    return out


_CASCADE = None


def face_presence(frames: list[np.ndarray]) -> float:
    """Fraction of frames with a frontal face covering >= 2% of the frame."""
    global _CASCADE
    if not frames:
        return 0.0
    if _CASCADE is None:
        try:
            path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"  # type: ignore[attr-defined]
            _CASCADE = cv2.CascadeClassifier(path)
        except Exception:  # pragma: no cover
            _CASCADE = False
    if not _CASCADE or _CASCADE.empty():
        return 0.0
    hits = 0
    for f in frames[:: max(1, len(frames) // 6)]:
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
        faces = _CASCADE.detectMultiScale(g, scaleFactor=1.15, minNeighbors=5, minSize=(32, 32))
        area = g.shape[0] * g.shape[1]
        if any(w * h >= 0.02 * area for (_x, _y, w, h) in faces):
            hits += 1
    n = len(frames[:: max(1, len(frames) // 6)])
    return hits / max(1, n)


def audio_timeline(audio: dict, sfx: list[dict], cuts: list[float], duration: float, out: Path, width: int = 1200) -> Path:
    """Lanes: loudness curve, voice, music (+beats), sfx markers, picture cuts."""
    lane_h, top = 26, 24
    lanes = [T("响度", "Level"), T("人声", "Voice"), T("音乐", "Music"), T("音效", "SFX"), T("切镜", "Cuts")]
    h = top + lane_h * len(lanes) + 20
    im = Image.new("RGB", (width, h), (250, 250, 249))
    d = ImageDraw.Draw(im)
    font = _font(13)
    x0 = 52
    sx = (width - x0 - 10) / max(duration, 0.1)
    for i, name in enumerate(lanes):
        y = top + i * lane_h
        d.text((6, y + 5), name, fill=(60, 60, 60), font=font)
        d.line([(x0, y + lane_h - 1), (width - 10, y + lane_h - 1)], fill=(225, 225, 225))
    ec = audio.get("energy_curve") or []
    if ec:
        lo, hi = min(ec), max(ec)
        pts = [(x0 + i * 0.5 * sx, top + lane_h - 3 - (v - lo) / max(1e-6, hi - lo) * (lane_h - 6)) for i, v in enumerate(ec)]
        d.line(pts, fill=(100, 116, 139), width=1)
    for a, b in audio.get("voice", {}).get("segments", []):
        d.rectangle([x0 + a * sx, top + lane_h + 6, x0 + b * sx, top + 2 * lane_h - 6], fill=(37, 99, 235))
    for a, b in audio.get("music", {}).get("segments", []):
        d.rectangle([x0 + a * sx, top + 2 * lane_h + 6, x0 + b * sx, top + 3 * lane_h - 6], fill=(16, 185, 129))
    for bt in audio.get("music", {}).get("beats", [])[:600]:
        d.line([(x0 + bt * sx, top + 2 * lane_h + 2), (x0 + bt * sx, top + 2 * lane_h + 6)], fill=(6, 95, 70))
    for e in sfx:
        t = float(e.get("t", 0))
        c = (234, 88, 12) if e.get("source") == "vlm" else (251, 146, 60)
        d.ellipse([x0 + t * sx - 3, top + 3 * lane_h + 9, x0 + t * sx + 3, top + 3 * lane_h + 15], fill=c)
    for t in cuts:
        d.line([(x0 + t * sx, top + 4 * lane_h + 4), (x0 + t * sx, top + 5 * lane_h - 4)], fill=(30, 30, 30), width=2)
    for s in range(0, int(duration) + 1, max(1, int(duration // 10) or 1)):
        d.text((x0 + s * sx - 4, h - 18), f"{s}s", fill=(120, 120, 120), font=_font(11))
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out)
    return out
