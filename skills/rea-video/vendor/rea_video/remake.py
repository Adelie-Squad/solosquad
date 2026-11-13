"""Rebuild a video on the original timeline from remake results.

- generated clips (capsule-cinema)  -> trimmed / padded to the original shot length
- still_motion / static_hold shots  -> rebuilt locally from one image using the measured
                                       zoom/pan (deterministic, no model call)
- everything else                    -> original footage kept (marked in the compare video)
- with overlays=True, the measured subtitles / 花字 / titles are laid back on over the replaced shots only (kept
  original footage already carries them)
Outputs remake.mp4 (original audio) and compare.mp4 (original | remake side by side)."""
from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path

import cv2

from .util import LOG, read_json, read_image


def _ff(args: list[str], cwd: Path | None = None) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True, cwd=cwd)


def render_still_motion(image: Path, out: Path, duration: float, size: tuple[int, int], fps: float,
                        zoom_per_s: float = 0.0, pan_px_per_s: float = 0.0, pan_dir_deg: float = 0.0,
                        analysis_width: int = 480) -> Path:
    """Re-create a Ken Burns move: per-frame similarity transform about the frame centre,
    with the zoom rate and pan speed measured during decomposition."""
    img = read_image(image)
    if img is None:
        raise FileNotFoundError(image)
    w, h = size
    img = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
    n = max(1, int(round(duration * fps)))
    px_scale = w / float(analysis_width)
    vx = math.cos(math.radians(pan_dir_deg)) * pan_px_per_s * px_scale
    vy = math.sin(math.radians(pan_dir_deg)) * pan_px_per_s * px_scale
    out.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", f"{fps}",
                             "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", str(out)], stdin=subprocess.PIPE)
    assert proc.stdin is not None
    # the measured motion maps frame t -> t+1; start slightly zoomed in when zooming out so edges never show
    base = 1.0 + max(0.0, -zoom_per_s * duration) + 0.02 + (abs(vx) + abs(vy)) * duration / max(w, h)
    for i in range(n):
        t = i / fps
        s = base * (1.0 + zoom_per_s * t)
        M = cv2.getRotationMatrix2D((w / 2, h / 2), 0, s)
        M[0, 2] += vx * t - vx * duration / 2
        M[1, 2] += vy * t - vy * duration / 2
        frame = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
        proc.stdin.write(frame.tobytes())
    proc.stdin.close()
    proc.wait()
    return out


MAX_SPEEDUP = 3.0   # a generated clip is retimed to the original shot length, up to this much faster
MAX_SLOWDOWN = 1.25  # and up to this much slower; past that the remainder is trimmed / held


def fit_speed(clip_s: float, duration: float) -> float:
    """Playback speed that fits a generated clip into the original shot. Models have a minimum length
    (often 4-5 s), so a 1.2 s shot comes back as 4 s of the same action: playing only its first 1.2 s
    cuts the action off and slows the edit, so the whole clip is sped up instead (within limits)."""
    if clip_s <= 0 or duration <= 0:
        return 1.0
    return max(1 / MAX_SLOWDOWN, min(MAX_SPEEDUP, clip_s / duration))


def _clip_seconds(src: Path) -> float:
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(src)],
                           capture_output=True, text=True, check=True)
        return float(r.stdout.strip() or 0)
    except (subprocess.CalledProcessError, ValueError, FileNotFoundError):
        return 0.0


def _fit_clip(src: Path, out: Path, duration: float, size: tuple[int, int], fps: float) -> Path:
    w, h = size
    speed = fit_speed(_clip_seconds(src), duration)
    vf = (f"setpts=PTS/{speed:.4f},scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},fps={fps},"
          f"tpad=stop_mode=clone:stop_duration={duration:.3f},trim=duration={duration:.3f},setpts=PTS-STARTPTS")
    _ff(["-i", str(src), "-an", "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", str(out)])
    return out


def _original_segment(src: Path, out: Path, start: float, duration: float, size: tuple[int, int], fps: float) -> Path:
    w, h = size
    _ff(["-ss", f"{start:.4f}", "-i", str(src), "-t", f"{duration:.4f}", "-an",
         "-vf", f"scale={w}:{h},fps={fps}", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", str(out)])
    return out


def replaced_spans(b: dict, legend: list[tuple]) -> list[tuple[float, float]]:
    """Time spans of shots no longer showing the original picture, adjacent ones merged."""
    shots = {sh["index"]: sh for sh in b["shots"]}
    spans: list[list[float]] = []
    for i, how in legend:
        if how == "original":
            continue
        a, z = shots[i]["start"], shots[i]["end"]
        if spans and abs(spans[-1][1] - a) < 1e-3:
            spans[-1][1] = z
        else:
            spans.append([a, z])
    return [(a, z) for a, z in spans]


def overlay_cues(b: dict, spans: list[tuple[float, float]]) -> tuple[list[dict], list[dict]]:
    """Text layers to lay back on, clipped to the replaced spans, and the stickers there that need an asset by hand.
    A layer cut by a span edge loses its entrance animation, so it does not pop in again mid-line."""
    from .packaging import ANCHOR_KINDS, cjk_count, speech_lines

    pack = b.get("packaging") or {}
    speech = {c["id"] for c in speech_lines(pack.get("text_cues", [])) if c.get("id")}
    cues, stickers = [], []
    for c in pack.get("text_cues", []):
        if c["kind"] == "scene" or c.get("part_of_picture"):
            continue
        # spoken lines and styled text go back on; other OCR reads only when they hold real words, not "8uXrH"-like noise
        if not (c.get("id") in speech or (c["kind"] in ANCHOR_KINDS and c["kind"] != "label") or cjk_count(c.get("text", "")) >= 2):
            continue
        for a, z in spans:
            lo, hi = max(c["t0"], a), min(c["t1"], z)
            if hi - lo >= 0.1:
                cues.append({**c, "t0": lo, "t1": hi, **({"anim_in": None} if lo > c["t0"] + 1e-3 else {}),
                             **({"anim_out": None} if hi < c["t1"] - 1e-3 else {})})
    for st in pack.get("stickers", []):
        if not st.get("in_picture") and st.get("confidence") != "low" and any(min(st["t1"], z) - max(st["t0"], a) >= 0.1 for a, z in spans):
            stickers.append({k: st.get(k) for k in ("id", "kind_zh", "what", "t0", "t1", "bbox", "image")})
    return cues, stickers


def assemble(breakdown_path: Path, results_path: Path, out_dir: Path | None = None, overlays: bool = False) -> str:
    b = read_json(breakdown_path)
    bdir = breakdown_path.parent
    jobs_path = results_path.with_name("jobs.json")
    jobs = {j["shot"]: j for j in read_json(jobs_path)["jobs"]} if jobs_path.is_file() else {}
    results = read_json(results_path).get("results", {}) if results_path.is_file() else {}
    out_dir = out_dir or results_path.parent
    seg_dir = out_dir / "segments"
    seg_dir.mkdir(parents=True, exist_ok=True)
    src = Path(b["source"]["path"])
    w, h = b["source"]["width"], b["source"]["height"]
    if b["source"].get("rotation") in (90, 270):
        w, h = h, w
    w, h = w - w % 2, h - h % 2
    fps = float(b["source"]["fps"]) if b["source"]["fps"] and b["source"]["fps"] <= 60 else 30.0
    parts, legend = [], []
    for sh in b["shots"]:
        dur = sh["duration"]
        seg = seg_dir / f"shot_{int(sh['index']):03d}.mp4"  # 不用 JSON 里的 id 拼路径，防 ../
        res = results.get(str(sh["index"])) or {}
        job = jobs.get(sh["index"], {})
        if res.get("video") and Path(res["video"]).is_file():
            _fit_clip(Path(res["video"]), seg, dur, (w, h), fps)
            legend.append((sh["index"], "generated"))
        elif job.get("executor") == "local_ffmpeg" or sh["base"]["label"] in ("still_motion", "static_hold"):
            m = sh["replication"].get("local", {})
            img = bdir / sh["assets"]["first_frame"]
            render_still_motion(img, seg, dur, (w, h), fps, m.get("zoom_per_s", 0.0), m.get("pan_px_per_s", 0.0),
                                m.get("pan_dir_deg", 0.0), m.get("analysis_width", 480))
            legend.append((sh["index"], "local_still"))
        else:
            _original_segment(src, seg, sh["start"], dur, (w, h), fps)
            legend.append((sh["index"], "original"))
        parts.append(seg)
    lst = seg_dir / "concat.txt"
    lst.write_text("".join("file '" + str(p.resolve()).replace("'", "'\\''") + "'\n" for p in parts), encoding="utf-8")
    silent = out_dir / "remake_silent.mp4"
    _ff(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(silent)])
    overlay_log: dict = {}
    if overlays:
        from .packaging import to_ass

        cues, stickers = overlay_cues(b, replaced_spans(b, legend))
        overlay_log = {"text": len(cues), "stickers_to_add": stickers}
        if cues:
            (out_dir / "overlays_remake.ass").write_text(to_ass(cues, w, h), encoding="utf-8")
            try:  # relative name + cwd: no filter-string escaping of the path
                _ff(["-i", silent.name, "-vf", "ass=overlays_remake.ass", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
                     "remake_overlaid.mp4"], cwd=out_dir)
                silent = out_dir / "remake_overlaid.mp4"
                overlay_log["ass"] = str(out_dir / "overlays_remake.ass")
            except subprocess.CalledProcessError as exc:  # ffmpeg built without libass
                overlay_log["error"] = f"ffmpeg ass filter failed ({exc.returncode}); overlays_remake.ass can be burned in another editor"
                LOG.warning(overlay_log["error"])
    final = out_dir / "remake.mp4"
    if b["source"].get("has_audio"):
        _ff(["-i", str(silent), "-i", str(src), "-map", "0:v", "-map", "1:a?", "-c:v", "copy", "-c:a", "aac", "-shortest", str(final)])
    else:
        final = silent
    compare = out_dir / "compare.mp4"
    ch = 720 if h >= 720 else h - h % 2
    label = ",drawtext=text='{t}':x=10:y=10:fontcolor=white:box=1:boxcolor=black@0.5"
    for with_text in (True, False):  # drawtext needs libfreetype; fall back to plain hstack
        la, lb = (label.format(t="original"), label.format(t="remake")) if with_text else ("", "")
        try:
            _ff(["-i", str(src), "-i", str(final), "-filter_complex",
                 f"[0:v]scale=-2:{ch}{la}[a];[1:v]scale=-2:{ch}{lb}[b];[a][b]hstack=inputs=2[v]",
                 "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", "-shortest", str(compare)])
            break
        except subprocess.CalledProcessError:
            if not with_text:
                raise
    log = {"legend": legend, "remake": str(final), "compare": str(compare), **({"overlays": overlay_log} if overlays else {})}
    (out_dir / "assemble_log.json").write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")
    LOG.info("remake -> %s ; compare -> %s", final, compare)
    return json.dumps(log, ensure_ascii=False)
