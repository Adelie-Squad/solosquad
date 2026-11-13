"""Sound effects on their own track: dialogue / music / effects separation, then effects found on that track.

The two-stem model in stems.py splits voice from accompaniment, so effects land inside one of them and an onset
detector on the mix mostly finds plosives and drum hits (a 60 s talking-head clip with 12 known effects mixed in:
1/12 found on the mix, 8/12 on the effects track). Backend: BandIt v2, multilingual checkpoint (Watcharasupat,
Wu and Orife, "Remastering Divide and Remaster", arXiv 2407.07275; weights CC BY-SA 4.0), as an ONNX conversion
with unchanged weights, CPU via onnxruntime, downloaded once into $REA_VIDEO_MODELS (~149 MB).
"""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

import numpy as np

LOG = logging.getLogger(__name__)

MODEL_NAME = "bandit-v2-multi.onnx"
MODEL_URL = "https://github.com/xuankhanh/MediaDownloader/releases/download/separator-models-v1/bandit-v2-multi.onnx"
MODEL_SHA256 = "319b6293f007e27b43026953ef80d88bb000cf52bbc5ffc382683c97445171e4"
SR, N_FFT, HOP = 48000, 2048, 512          # the checkpoint's STFT (configs/models/bandit-mus64.yaml)
CHUNK_S, STEP_S = 8.0, 4.0                 # trained on 8 s chunks; half-overlapped windows, cross-faded
STEMS = ("speech", "music", "effects")     # output order of the masks
WINDOW = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)).astype(np.float32)

# onset detection on the effects track: 10 ms frames, a rise over the recent median, a floor, merged when close
FRAME = 480
FLOOR_DB, RISE_DB, MERGE_S = -40.0, 12.0, 0.3
# over digital silence a quiet sound was still placed there on purpose (eval case v10: a -54 dB hit on a -92 dB track,
# on a particle burst); over a live bed the floor stays, or voice leakage and room sound come through
QUIET_FLOOR_DB, SILENT_BED_DB = -58.0, -80.0


def ensure_model(force: bool = False) -> Path:
    from .stems import ensure_file

    return ensure_file(MODEL_NAME, MODEL_URL, MODEL_SHA256, "~149 MB", force=force)


def _load_mono(path: str | Path) -> np.ndarray | None:
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True)
    if r.returncode != 0 or not r.stdout:
        return None
    return np.frombuffer(r.stdout, np.float32).copy()


def _stft(y: np.ndarray) -> np.ndarray:
    y = np.pad(y, (N_FFT // 2, N_FFT // 2), mode="reflect")  # center=True, reflect padding
    n = 1 + (len(y) - N_FFT) // HOP
    idx = np.arange(N_FFT)[:, None] + HOP * np.arange(n)[None, :]
    return np.fft.rfft(y[idx] * WINDOW[:, None], axis=0) / np.sqrt(N_FFT)  # normalized=True


def _istft(S: np.ndarray, length: int) -> np.ndarray:
    fr = np.fft.irfft(S * np.sqrt(N_FFT), n=N_FFT, axis=0) * WINDOW[:, None]
    n = fr.shape[1]
    out = np.zeros(N_FFT + HOP * (n - 1))
    wsum = np.zeros_like(out)
    for i in range(n):
        out[i * HOP:i * HOP + N_FFT] += fr[:, i]
        wsum[i * HOP:i * HOP + N_FFT] += WINDOW ** 2
    return (out / np.maximum(wsum, 1e-8))[N_FFT // 2:N_FFT // 2 + length]


def separate(x: np.ndarray, session) -> np.ndarray:
    """Mono 48 kHz signal -> (3, n) speech / music / effects."""
    ch, step = int(CHUNK_S * SR), int(STEP_S * SR)
    fade = np.hanning(ch).astype(np.float32)
    starts = list(range(0, max(1, len(x) - ch + step), step))
    out = np.zeros((3, len(x)))
    wts = np.zeros(len(x))
    for a in starts:
        seg = x[a:a + ch]
        n = len(seg)
        if n < ch:
            seg = np.pad(seg, (0, ch - n))
        S = _stft(seg)
        m = session.run(None, {"spec": np.stack([S.real, S.imag], -1)[None].astype(np.float32)})[0][0]  # 3, F, T, 2
        w = fade[:n] if len(starts) > 1 else np.ones(n)
        for k in range(3):
            out[k, a:a + n] += _istft((m[k, ..., 0] + 1j * m[k, ..., 1]) * S, ch)[:n] * w
        wts[a:a + n] += w
    return out / np.maximum(wts, 1e-6)


def extract_effects(src: str | Path, out_dir: str | Path) -> dict:
    """Write stems/effects.wav; {"ok": False, "reason"} when the model or the audio is not there."""
    try:
        import onnxruntime as ort

        session = ort.InferenceSession(str(ensure_model()), providers=["CPUExecutionProvider"])
    except Exception as e:  # offline / no onnxruntime: the report falls back to effects found on the mix
        LOG.warning("effects separation unavailable: %s", e)
        return {"ok": False, "reason": f"{type(e).__name__}: {e}"}
    x = _load_mono(src)
    if x is None or len(x) < SR // 2:
        return {"ok": False, "reason": "no audio"}
    fx = np.clip(separate(x, session)[2], -1, 1).astype(np.float32)
    path = Path(out_dir) / "stems" / "effects.wav"
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-c:a", "pcm_s16le", str(path)],
                   input=fx.tobytes(), check=True)
    return {"ok": True, "model": MODEL_NAME, "effects": str(path), "level_db": round(float(20 * np.log10(np.sqrt((fx ** 2).mean()) + 1e-9)), 1)}


def _kind(seg: np.ndarray) -> str:
    """Coarse type from duration, brightness and tonality: click / pop / ding / whoosh / impact / other."""
    dur = len(seg) / SR
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) + 1e-9
    freqs = np.fft.rfftfreq(len(seg), 1 / SR)
    centroid = float((spec * freqs).sum() / spec.sum())
    flat = float(np.exp(np.log(spec).mean()) / spec.mean())  # 0 tonal .. 1 noise-like
    if dur < 0.06:
        return "click"
    if flat < 0.08 and dur >= 0.25:
        return "ding"
    if flat < 0.15:
        return "pop"
    if centroid < 700:
        return "impact"
    if dur >= 0.25:
        return "whoosh"
    return "other"


def detect(effects_wav: str | Path) -> list[dict]:
    """Effects on the separated track: [{t, dur, type, level_db, source}]."""
    y = _load_mono(effects_wav)
    if y is None:
        return []
    n = len(y) // FRAME
    db = 20 * np.log10(np.sqrt((y[:n * FRAME].reshape(n, FRAME) ** 2).mean(1)) + 1e-9)
    out: list[dict] = []
    i = 5
    while i < n:
        base = float(np.median(db[max(0, i - 30):i]))
        quiet_ok = db[i] > QUIET_FLOOR_DB and float(np.median(db[max(0, i - 150):i])) < SILENT_BED_DB  # 1.5 s of silence before it
        if (db[i] > FLOOR_DB or quiet_ok) and db[i] - base > RISE_DB:
            j = i
            while j < n - 1 and db[j + 1] > max(db[i] - 20, base + 6) and j - i < 300:
                j += 1
            t, dur = i * FRAME / SR, (j - i + 1) * FRAME / SR
            if out and t - (out[-1]["t"] + out[-1]["dur"]) < MERGE_S:  # one sound with a second attack: one effect
                out[-1]["dur"] = round(t + dur - out[-1]["t"], 3)
                out[-1]["level_db"] = max(out[-1]["level_db"], round(float(db[i:j + 1].max()), 1))
            else:
                out.append({"t": round(t, 3), "dur": round(dur, 3), "level_db": round(float(db[i:j + 1].max()), 1)})
            i = j + 1
            continue
        i += 1
    for e in out:
        a = int(e["t"] * SR)
        e["type"] = _kind(y[a:a + max(int(e["dur"] * SR), FRAME)])
        # what the effects track holds around it (1.5 s either side): digital silence means the sound was placed on its own
        i0, i1 = int(e["t"] * SR / FRAME), int((e["t"] + e["dur"]) * SR / FRAME)
        ctx = np.r_[db[max(0, i0 - 150):max(0, i0 - 10)], db[i1 + 10:i1 + 150]]
        e["bed_db"] = round(float(np.median(ctx)), 1) if len(ctx) else -120.0
        e["source"] = "effects_stem"
        e["confidence"] = "medium"
    return out


SAME_SOUND = 0.85  # cosine of band-energy shapes; eval daihuo: repeats of one effect 0.95, different effects <= 0.5
_EDGES = np.geomspace(80, 16000, 25)


def _shape(y: np.ndarray, e: dict) -> np.ndarray | None:
    a = int(float(e.get("t", 0)) * SR)
    seg = y[a:a + int(min(max(float(e.get("dur") or 0), 0.08), 0.4) * SR)]
    if len(seg) < FRAME:
        return None
    sp = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
    f = np.fft.rfftfreq(len(seg), 1 / SR)
    v = np.log10(np.array([sp[(f >= lo) & (f < hi)].sum() for lo, hi in zip(_EDGES[:-1], _EDGES[1:])]) + 1e-12)
    v = v - v.mean()
    n = np.linalg.norm(v)
    return v / n if n > 0 else None


def group(events: list[dict], wav: str | Path) -> list[dict]:
    """The same sound used again gets the same group: [{id, members (indexes into events), rep}] in order of first use.
    rep is the loudest member, the one to listen to."""
    y = _load_mono(wav)
    groups: list[dict] = []
    if y is None:
        return [{"id": f"F{i + 1}", "members": [i], "rep": i} for i in range(len(events))]
    shapes = [_shape(y, e) for e in events]
    for i, (e, v) in enumerate(zip(events, shapes)):
        best = None
        for g in groups:
            r = events[g["rep"]]
            w = shapes[g["rep"]]
            d1, d2 = max(float(e.get("dur") or 0), 0.02), max(float(r.get("dur") or 0), 0.02)
            if v is not None and w is not None and float(v @ w) >= SAME_SOUND and max(d1, d2) / min(d1, d2) <= 2.5:
                best = g
                break
        if best:
            best["members"].append(i)
            if float(e.get("level_db", -99)) > float(events[best["rep"]].get("level_db", -99)):
                best["rep"] = i
        else:
            groups.append({"id": f"F{len(groups) + 1}", "members": [i], "rep": i})
    return groups

