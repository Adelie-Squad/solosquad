"""FFmpeg/ffprobe wrappers. Frames are read through an ffmpeg rawvideo pipe so every
codec ffmpeg understands (h264/hevc/vp9/prores...) works the same on macOS and Linux."""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import numpy as np

from .util import LOG


class MediaError(RuntimeError):
    pass


_PASSTHROUGH: list[str] | None = None


def passthrough_args() -> list[str]:
    """`-fps_mode passthrough` on ffmpeg >= 5.1, `-vsync passthrough` before that."""
    global _PASSTHROUGH
    if _PASSTHROUGH is None:
        try:
            out = subprocess.run(["ffmpeg", "-hide_banner", "-version"], capture_output=True, text=True).stdout
            import re as _re
            m = _re.search(r"ffmpeg version n?(\d+)\.(\d+)", out)
            major, minor = (int(m.group(1)), int(m.group(2))) if m else (7, 0)
        except OSError:  # pragma: no cover
            major, minor = 7, 0
        _PASSTHROUGH = ["-fps_mode", "passthrough"] if (major, minor) >= (5, 1) else ["-vsync", "passthrough"]
    return list(_PASSTHROUGH)


def require_tools() -> None:
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise MediaError(f"{tool} not found on PATH")


def ffprobe(path: str | Path) -> dict:
    cmd = ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)]
    try:
        out = subprocess.run(cmd, check=True, capture_output=True, text=True).stdout
    except subprocess.CalledProcessError as exc:  # pragma: no cover - depends on file
        raise MediaError(f"ffprobe failed: {exc.stderr.strip()}") from exc
    return json.loads(out)


def _ratio(value: str | None) -> float:
    if not value or value in ("0/0", "N/A"):
        return 0.0
    if "/" in value:
        a, b = value.split("/", 1)
        try:
            return float(a) / float(b) if float(b) else 0.0
        except ValueError:
            return 0.0
    try:
        return float(value)
    except ValueError:
        return 0.0


@dataclass
class VideoInfo:
    path: str
    width: int
    height: int
    fps: float
    duration: float
    nb_frames: int
    vcodec: str
    has_audio: bool
    rotation: int
    raw: dict

    @property
    def display_size(self) -> tuple[int, int]:
        """(width, height) as shown, after rotation metadata."""
        return (self.height, self.width) if self.rotation in (90, 270) else (self.width, self.height)

    @property
    def aspect_ratio(self) -> str:
        w, h = (self.height, self.width) if self.rotation in (90, 270) else (self.width, self.height)
        if not w or not h:
            return "unknown"
        r = w / h
        for name, val in (("9:16", 9 / 16), ("3:4", 3 / 4), ("6:7", 6 / 7), ("1:1", 1.0), ("4:3", 4 / 3), ("16:9", 16 / 9), ("21:9", 21 / 9)):
            if abs(r - val) / val < 0.04:
                return name
        return f"{w}:{h}"


def video_info(path: str | Path) -> VideoInfo:
    data = ffprobe(path)
    vstreams = [s for s in data.get("streams", []) if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")]
    if not vstreams:
        raise MediaError(f"no video stream in {path}")
    v = vstreams[0]
    fmt = data.get("format", {})
    fps = _ratio(v.get("avg_frame_rate")) or _ratio(v.get("r_frame_rate")) or 30.0
    duration = float(v.get("duration") or fmt.get("duration") or 0.0)
    nb = int(v.get("nb_frames") or 0) or int(round(duration * fps))
    rotation = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            try:
                rotation = int(abs(float(sd["rotation"]))) % 360
            except (TypeError, ValueError):
                pass
    if "rotate" in (v.get("tags") or {}):
        try:
            rotation = int(v["tags"]["rotate"]) % 360
        except ValueError:
            pass
    has_audio = any(s.get("codec_type") == "audio" for s in data.get("streams", []))
    return VideoInfo(
        path=str(path), width=int(v.get("width") or 0), height=int(v.get("height") or 0), fps=fps,
        duration=duration, nb_frames=nb, vcodec=str(v.get("codec_name") or ""), has_audio=has_audio,
        rotation=rotation, raw=data,
    )


def scaled_size(info: VideoInfo, width: int) -> tuple[int, int]:
    """Output size for an ffmpeg `scale=width:-2` (display orientation aware)."""
    w, h = info.width, info.height
    if info.rotation in (90, 270):
        w, h = h, w
    width = min(width, w) if w else width
    width -= width % 2
    height = int(round(h * width / w)) if w else width
    height -= height % 2
    return width, max(2, height)


def frame_times(path: str | Path, n: int, fps: float) -> np.ndarray | None:
    """Real timestamps (s, from 0) of the n frames iter_frames passes through, read from packet pts
    (no decoding). None when they match frame / fps to within half a frame (constant frame rate; the
    caller keeps index / fps) or when the packet count does not line up with the decoded frames."""
    if n < 2 or fps <= 0:
        return None
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time",
                              "-of", "csv=p=0", str(path)], capture_output=True, text=True, timeout=120).stdout
        pts = sorted(float(x.strip().rstrip(",")) for x in out.split() if x.strip().rstrip(",") not in ("", "N/A"))
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    if len(pts) != n:
        return None
    t = np.asarray(pts) - pts[0]
    if np.max(np.abs(t - np.arange(n) / fps)) <= 0.5 / fps:
        return None
    return t


def iter_frames(
    path: str | Path,
    info: VideoInfo,
    width: int,
    start: float | None = None,
    duration: float | None = None,
    gray: bool = False,
    fps: float | None = None,
    crop: tuple[float, float, float, float] | None = None,
) -> Iterator[np.ndarray]:
    """Yield decoded frames (BGR uint8, or gray if gray=True) at the requested width.
    By default frames are passed through untouched (no fps resampling) so duplicate-frame
    statistics stay meaningful; fps= resamples to a fixed rate (frame i is at start + i / fps).
    crop=(x, y, w, h) in 0-1 of the displayed frame keeps only that region (width applies to the crop)."""
    w, h = scaled_size(info, width)
    vf = []
    if fps:
        vf.append(f"fps={fps:g}")
    if crop:
        cx, cy, cw, ch = crop
        vf.append(f"crop=trunc(iw*{cw:.4f}/2)*2:trunc(ih*{ch:.4f}/2)*2:trunc(iw*{cx:.4f}):trunc(ih*{cy:.4f})")
        full_w, full_h = scaled_size(info, 1 << 16)  # displayed size at native resolution
        crop_w, crop_h = max(2.0, full_w * cw), max(2.0, full_h * ch)
        w = max(2, int(min(width, crop_w)) // 2 * 2)
        h = max(2, int(round(w * crop_h / crop_w)) // 2 * 2)
    vf.append(f"scale={w}:{h}:flags=area")
    cmd = ["ffmpeg", "-v", "error", "-nostdin"]
    if start is not None and start > 0:
        # half a frame early: a start rounded to just past a frame's timestamp would drop that frame
        cmd += ["-ss", f"{max(start - 0.5 / info.fps, 0.0) if info.fps > 0 else start:.4f}"]
    cmd += ["-i", str(path)]
    if duration is not None:
        cmd += ["-t", f"{max(duration, 0.01):.4f}"]
    pix = "gray" if gray else "bgr24"
    cmd += ["-an", "-sn", "-vf", ",".join(vf), *([] if fps else passthrough_args()), "-f", "rawvideo", "-pix_fmt", pix, "-"]
    frame_bytes = w * h * (1 if gray else 3)
    # stderr goes to a temp file: an unread PIPE fills up (~64 KB of decode errors on a damaged file) and
    # ffmpeg blocks, so stdout stalls forever
    errf = tempfile.TemporaryFile()
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=errf)
    assert proc.stdout is not None
    count = 0
    try:
        while True:
            buf = proc.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            arr = np.frombuffer(buf, dtype=np.uint8)
            count += 1
            yield arr.reshape((h, w)) if gray else arr.reshape((h, w, 3))
        if count == 0:
            proc.wait()
            errf.seek(0)
            err = errf.read()[-4000:].decode(errors="ignore")
            if err.strip():
                raise MediaError(f"ffmpeg decoded no frames: {err.strip()[:300]}")
        elif proc.wait() != 0:
            # the stream ended early (a damaged file): what was read is analysed, but say that it is not all of it
            errf.seek(0)
            err = errf.read()[-4000:].decode(errors="ignore").strip()
            LOG.warning("ffmpeg stopped after %d frames of %s: %s", count, Path(path).name, err[:300] or f"exit {proc.returncode}")
    finally:
        proc.stdout.close()
        proc.kill()
        proc.wait()
        errf.close()


def extract_frame(path: str | Path, t: float, out_path: str | Path, width: int | None = None) -> Path:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    vf = ["-vf", f"scale={width}:-2"] if width else []
    out_path.unlink(missing_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{max(t, 0):.4f}", "-i", str(path), "-frames:v", "1", *vf, "-q:v", "2", str(out_path)]
    if subprocess.run(cmd, capture_output=True).returncode != 0 or not out_path.is_file():
        # t past the last frame's timestamp (low fps, last shot): take the file's last frame instead
        cmd = ["ffmpeg", "-v", "error", "-y", "-sseof", "-3", "-i", str(path), "-update", "1", *vf, "-q:v", "2", str(out_path)]
        _run_ffmpeg(cmd, f"frame at {t:.2f}s")
    return out_path


def _run_ffmpeg(cmd: list[str], what: str) -> None:
    got = subprocess.run(cmd, capture_output=True)
    if got.returncode != 0:
        raise MediaError(f"ffmpeg failed ({what}): {got.stderr.decode(errors='ignore').strip()[-300:] or got.returncode}")


def cut_clip(path: str | Path, start: float, duration: float, out_path: str | Path, width: int = 480,
             audio: bool = False, crf: int = 28) -> Path:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{max(start, 0):.4f}", "-i", str(path), "-t", f"{duration:.4f}",
           "-vf", f"scale='min({width},iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf), "-pix_fmt", "yuv420p"]
    cmd += ["-c:a", "aac", "-b:a", "64k"] if audio else ["-an"]
    cmd += ["-movflags", "+faststart", str(out_path)]
    _run_ffmpeg(cmd, f"clip {start:.2f}s +{duration:.2f}s")
    return out_path


def extract_audio(path: str | Path, sr: int = 16000) -> np.ndarray | None:
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path), "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        LOG.debug("no audio extracted: %s", proc.stderr.decode(errors="ignore")[:200])
        return None
    return np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
