"""Strip the soundtrack into stems: the original mix, vocals (dry voice / singing) and the rest (BGM + SFX + ambience).

Backend: UVR MDX-Net "Inst HQ 3" (ONNX, ~67 MB, CPU via onnxruntime). The model predicts the instrumental;
vocals = mix - instrumental. Weights come from the public UVR model repo on GitHub and are cached in
$REA_VIDEO_MODELS (default ~/.cache/rea-video/models).
"""
from __future__ import annotations

import logging
import os
import subprocess
import uuid
from pathlib import Path

import numpy as np

from .util import fetch, sha256_file

LOG = logging.getLogger(__name__)
SR = 44100
MODEL_NAME = "UVR-MDX-NET-Inst_HQ_3.onnx"
MODEL_URL = f"https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/{MODEL_NAME}"
N_FFT, HOP, DIM_F, DIM_T = 6144, 1024, 3072, 256
COMPENSATE = 1.022
CHUNK = HOP * (DIM_T - 1)
TRIM = N_FFT // 2
GEN = CHUNK - 2 * TRIM
WINDOW = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)).astype(np.float32)  # periodic hann


def models_dir() -> Path:
    return Path(os.getenv("REA_VIDEO_MODELS", str(Path.home() / ".cache/rea-video/models"))).expanduser()


MODEL_SHA256 = "317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc"  # 校验下载，防替换


def ensure_file(name: str, url: str, sha256: str, size: str, force: bool = False) -> Path:
    """A model file in models_dir(), downloaded once and checked against its SHA-256."""
    p = models_dir() / name
    if not force and p.is_file() and sha256_file(p) == sha256:
        return p
    p.parent.mkdir(parents=True, exist_ok=True)
    LOG.info("downloading %s (%s) -> %s", name, size, p)
    # per-process temp name: several decompose runs may download at the same time
    tmp = p.with_name(f"{p.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.part")
    try:
        fetch(url, tmp)
        if sha256_file(tmp) != sha256:
            raise OSError(f"checksum mismatch for {name} ({tmp.stat().st_size} bytes); delete it and retry")
        tmp.replace(p)  # atomic: readers see the old file or the complete new one
    finally:
        tmp.unlink(missing_ok=True)
    return p


def ensure_model(force: bool = False) -> Path:
    return ensure_file(MODEL_NAME, MODEL_URL, MODEL_SHA256, "~67 MB", force=force)


def _session():
    import onnxruntime as ort

    try:
        return ort.InferenceSession(str(ensure_model()), providers=["CPUExecutionProvider"])
    except Exception as e:  # corrupted cache (e.g. an older interrupted download): fetch again once
        if "protobuf" not in str(e).lower() and "load model" not in str(e).lower():
            raise
        LOG.warning("cached stem model is unreadable (%s); downloading again", str(e)[:120])
        return ort.InferenceSession(str(ensure_model(force=True)), providers=["CPUExecutionProvider"])


def load_stereo(path: str | Path) -> np.ndarray | None:
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
                       capture_output=True)
    if r.returncode != 0 or not r.stdout:
        return None
    return np.frombuffer(r.stdout, np.float32).reshape(-1, 2).T.copy()


def save_wav(x: np.ndarray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-",
                    "-c:a", "pcm_s16le", str(path)], input=np.clip(x, -1, 1).T.astype(np.float32).tobytes(), check=True)


def _stft(x: np.ndarray) -> np.ndarray:
    """x [2, CHUNK] -> model input [4, DIM_F, DIM_T] (L re, L im, R re, R im); same as torch.stft(center=True)."""
    xp = np.pad(x, ((0, 0), (N_FFT // 2, N_FFT // 2)), mode="reflect")
    idx = np.arange(DIM_T)[:, None] * HOP + np.arange(N_FFT)[None, :]
    spec = np.fft.rfft(xp[:, idx] * WINDOW, axis=-1)  # [2, T, F]
    spec = spec.transpose(0, 2, 1)[:, :DIM_F]           # [2, F, T]
    return np.stack([spec.real, spec.imag], axis=1).reshape(4, DIM_F, DIM_T).astype(np.float32)


def _istft(s: np.ndarray) -> np.ndarray:
    s = s.reshape(2, 2, DIM_F, DIM_T)
    c = s[:, 0] + 1j * s[:, 1]
    c = np.concatenate([c, np.zeros((2, N_FFT // 2 + 1 - DIM_F, DIM_T), c.dtype)], axis=1)  # [2, F, T]
    frames = np.fft.irfft(c.transpose(0, 2, 1), n=N_FFT, axis=-1) * WINDOW  # [2, T, N_FFT]
    n = N_FFT + HOP * (DIM_T - 1)
    out = np.zeros((2, n), np.float32)
    norm = np.zeros(n, np.float32)
    for t in range(DIM_T):
        out[:, t * HOP:t * HOP + N_FFT] += frames[:, t]
        norm[t * HOP:t * HOP + N_FFT] += WINDOW ** 2
    out = out / np.maximum(norm, 1e-8)
    return out[:, N_FFT // 2:N_FFT // 2 + CHUNK]


def separate(mix: np.ndarray, batch: int = 1) -> tuple[np.ndarray, np.ndarray]:
    """mix [2, n] -> (vocals, instrumental)."""
    sess = _session()
    n = mix.shape[1]
    pad = GEN - n % GEN
    mp = np.concatenate([np.zeros((2, TRIM), np.float32), mix, np.zeros((2, pad + TRIM), np.float32)], axis=1)
    starts = list(range(0, n + pad, GEN))
    pieces = []
    for i in range(0, len(starts), batch):
        specs = np.stack([_stft(mp[:, s:s + CHUNK]) for s in starts[i:i + batch]])
        outs = sess.run(None, {"input": specs})[0]
        pieces += [_istft(o)[:, TRIM:-TRIM] for o in outs]
    inst = np.concatenate(pieces, axis=1)[:, :n] * COMPENSATE
    return mix - inst, inst


def _db(x: np.ndarray) -> float:
    return float(20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9))


def extract_stems(path: str | Path, out_dir: str | Path) -> dict:
    """Write original.wav / vocals.wav / music.wav into out_dir/stems and return a short summary."""
    out = Path(out_dir) / "stems"
    mix = load_stereo(path)
    if mix is None or mix.shape[1] < SR // 2:
        return {"ok": False, "reason": "no audio"}
    save_wav(mix, out / "original.wav")
    try:
        voc, inst = separate(mix)
    except Exception as e:  # missing onnxruntime / offline: keep the original track at least
        LOG.warning("stem separation failed: %s", e)
        return {"ok": False, "reason": f"{type(e).__name__}: {e}", "original": str(out / "original.wav")}
    save_wav(voc, out / "vocals.wav")
    save_wav(inst, out / "music.wav")
    got = {"ok": True, "model": MODEL_NAME, "original": str(out / "original.wav"), "vocals": str(out / "vocals.wav"),
           "music": str(out / "music.wav"), "level_db": {"mix": round(_db(mix), 1), "vocals": round(_db(voc), 1),
                                                        "music": round(_db(inst), 1)}}
    # effects get a track of their own (dialogue / music / effects model): the two stems above both carry some
    from .effects import extract_effects

    fx = extract_effects(path, out_dir)
    if fx.get("ok"):
        got["effects"] = fx["effects"]
        got["level_db"]["effects"] = fx["level_db"]
        got["effects_model"] = fx["model"]
    return got


SFX_DIR = "sfx"


def cut_sfx(src: str | Path, sfx: list[dict], out_dir: str | Path, limit: int = 60, groups: list[dict] | None = None) -> int:
    """One short clip per sound effect (out_dir/sfx/sfx_NN.wav), cut from the separated effects track when there
    is one, else from the original sound, so a reader can hear what each one is before looking for a similar one.
    Sets e["clip"]; returns how many were written."""
    import shutil

    d = Path(out_dir) / SFX_DIR
    shutil.rmtree(d, ignore_errors=True)
    for e in sfx:
        e.pop("clip", None)
    fx = Path(out_dir) / "stems" / "effects.wav"
    if fx.is_file():  # the effect alone, without the voice and music around it
        src = fx
    if not sfx or not Path(src).is_file():
        return 0
    d.mkdir(parents=True, exist_ok=True)
    n = 0
    picks = [(k, sfx[g["rep"]]) for k, g in enumerate(groups, 1)] if groups else list(enumerate(sfx[:limit], 1))
    for i, e in picks[:limit]:
        t = float(e.get("t", 0.0))
        a = max(0.0, t - 0.12)  # a little lead-in so the attack is heard
        dur = min(max(float(e.get("dur") or 0.0), 0.3) + 0.35, 1.5)
        f = d / f"sfx_{i:02d}.wav"
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.3f}", "-t", f"{dur:.3f}", "-i", str(src), "-vn",
                            "-ac", "1", "-ar", "22050", "-af", "afade=t=out:st={:.3f}:d=0.08".format(max(0.0, dur - 0.08)),
                            "-c:a", "pcm_s16le", str(f)], capture_output=True)
        if r.returncode == 0 and f.is_file() and f.stat().st_size > 100:
            e["clip"] = f"{SFX_DIR}/{f.name}"
            n += 1
    for g in groups or []:  # one clip per distinct sound, shared by every time it is used
        clip = sfx[g["rep"]].get("clip")
        g["clip"] = clip
        for i in g.get("members") or [j for j, e in enumerate(sfx) if e.get("group") == g["id"]]:
            if clip:
                sfx[i]["clip"] = clip
    return n
