"""Local speech-to-text: what is said and when, without a VLM and without burned-in subtitles.

Optional: `pip install "rea-video[asr]"` (sherpa-onnx, which runs on the onnxruntime stack the stems model
already uses). The recognizer is SenseVoice (Chinese / English / Japanese / Korean / Cantonese); a voice-activity
detector cuts the track into spoken stretches first, so every line has a start and an end. About 160 MB is
downloaded on first use. Run it on the separated vocal stem when there is one: music under the voice is what
makes a recognizer invent words.

SenseVoice has no Bengali: it hears Bengali as English, Japanese or Korean and writes nonsense in those. `--asr-lang bn`
($REA_ASR_LANG) swaps in a Bengali streaming zipformer (about 90 MB, from Vosk) behind the same voice-activity cuts.

The text is a machine transcript. On-screen subtitles and a VLM's transcript outrank it wherever they exist.
"""
from __future__ import annotations

import importlib.util
import os
import re
import tarfile
import uuid
from pathlib import Path

import numpy as np

from .media import extract_audio
from .stems import models_dir
from .util import ASR_LANGS, LOG, fetch, sha256_file

SR = 16000
BASE_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models"
MODEL_DIR = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
ARCHIVE_SHA256 = "7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e"
MODEL_FILES = ("model.int8.onnx", "tokens.txt")
VAD_NAME = "silero_vad.onnx"
VAD_SHA256 = "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6"
MAX_SENTENCE_S = 6.0  # a longer stretch is shown sentence by sentence
MAX_LINE_S = 12.0  # a stretch of speech longer than this is split, so one line stays one subtitle-sized thought
LANGS = ("zh", "en", "ja", "ko", "yue")
# --asr-lang bn: a streaming zipformer converted from Vosk's small Bengali model (alphacep/vosk-model-small-streaming-bn)
BN_MODEL_DIR = "sherpa-onnx-streaming-zipformer-bn-vosk-2026-02-09"
BN_ARCHIVE_SHA256 = "1bc89d81ee33ba7ddef8454736aeeb55e3cc1593274272485c6da342202b4b18"
BN_MODEL_FILES = ("encoder.onnx", "decoder.onnx", "joiner.onnx", "tokens.txt")
TAIL_PAD_S = 0.66  # silence fed after a stretch: a streaming encoder holds back its last frames until it sees what follows


def available() -> bool:
    return importlib.util.find_spec("sherpa_onnx") is not None


def asr_lang() -> str:
    """Speech language: $REA_ASR_LANG (set by --asr-lang / prefs asr_lang), default auto."""
    lang = os.getenv("REA_ASR_LANG", "auto").strip().lower() or "auto"
    if lang not in ASR_LANGS:
        raise ValueError(f"unsupported speech language {lang!r} (choose from {', '.join(ASR_LANGS)})")
    return lang


def _ensure_vad() -> Path:
    root = models_dir()
    vad = root / VAD_NAME
    root.mkdir(parents=True, exist_ok=True)
    if not (vad.is_file() and sha256_file(vad) == VAD_SHA256):
        tmp = vad.with_name(f"{vad.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.part")
        try:
            fetch(f"{BASE_URL}/{VAD_NAME}", tmp)
            if sha256_file(tmp) != VAD_SHA256:
                raise OSError(f"checksum mismatch for {VAD_NAME}")
            tmp.replace(vad)
        finally:
            tmp.unlink(missing_ok=True)
    return vad


def _ensure_archive(model_dir: str, archive_sha256: str, files: tuple[str, ...], size: str) -> Path:
    """models_dir()/model_dir holding `files` from the release archive model_dir.tar.bz2, downloaded and checked once."""
    root = models_dir()
    d = root / model_dir
    if not all((d / f).is_file() for f in files):
        LOG.info("downloading speech model %s (~%s) -> %s", model_dir, size, d)
        arc = root / f"{model_dir}.{os.getpid()}.{uuid.uuid4().hex[:8]}.part"
        stage = root / f"{model_dir}.{os.getpid()}.{uuid.uuid4().hex[:8]}.tmp"
        try:
            fetch(f"{BASE_URL}/{model_dir}.tar.bz2", arc, timeout=120)
            if sha256_file(arc) != archive_sha256:
                raise OSError(f"checksum mismatch for {model_dir}.tar.bz2")
            stage.mkdir()
            with tarfile.open(arc, "r:bz2") as tar:
                for name in files:  # only the files needed, written under our own names: no archive path is trusted
                    src = tar.extractfile(f"{model_dir}/{name}")
                    if src is None:
                        raise OSError(f"{name} missing from the model archive")
                    with open(stage / name, "wb") as f:
                        while chunk := src.read(1 << 20):
                            f.write(chunk)
            if d.exists():  # an incomplete earlier copy
                for f in d.iterdir():
                    f.unlink()
                d.rmdir()
            stage.replace(d)
        finally:
            arc.unlink(missing_ok=True)
            if stage.exists():
                for f in stage.iterdir():
                    f.unlink()
                stage.rmdir()
    return d


def ensure_models() -> tuple[Path, Path, Path]:
    """-> (recognizer model, tokens, vad model), downloading and checking them on first use."""
    vad = _ensure_vad()
    d = _ensure_archive(MODEL_DIR, ARCHIVE_SHA256, MODEL_FILES, "160 MB")
    return d / MODEL_FILES[0], d / MODEL_FILES[1], vad


def ensure_bn_models() -> tuple[Path, Path]:
    """-> (folder with the Bengali zipformer's encoder / decoder / joiner / tokens, vad model)."""
    vad = _ensure_vad()
    return _ensure_archive(BN_MODEL_DIR, BN_ARCHIVE_SHA256, BN_MODEL_FILES, "90 MB"), vad


def _stretches(x: np.ndarray, vad_model: Path) -> list[tuple[float, np.ndarray]]:
    """Spoken stretches of a 16 kHz mono track: (start second, samples)."""
    import sherpa_onnx

    cfg = sherpa_onnx.VadModelConfig()
    cfg.silero_vad.model = str(vad_model)
    cfg.silero_vad.min_silence_duration = 0.3
    cfg.silero_vad.min_speech_duration = 0.25
    cfg.silero_vad.max_speech_duration = MAX_LINE_S
    cfg.sample_rate = SR
    vad = sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=60)
    win = cfg.silero_vad.window_size
    out: list[tuple[float, np.ndarray]] = []

    def drain() -> None:
        while not vad.empty():
            seg = vad.front
            out.append((seg.start / SR, np.array(seg.samples, dtype=np.float32)))
            vad.pop()

    for i in range(0, len(x) - win + 1, win):
        vad.accept_waveform(x[i:i + win])
        drain()
    vad.flush()
    drain()
    return out


def _by_speaker(stretches: list[tuple[float, np.ndarray]], turns: list[dict] | None) -> list[tuple[float, np.ndarray]]:
    """Cut each spoken stretch where the speaker changes inside it."""
    if not turns:
        return stretches
    from .speakers import change_points

    out: list[tuple[float, np.ndarray]] = []
    for start, samples in stretches:
        t = start
        for c in change_points(turns, start, start + len(samples) / SR) + [start + len(samples) / SR]:
            piece = samples[int(round((t - start) * SR)):int(round((c - start) * SR))]
            if len(piece):
                out.append((t, piece))
            t = c
    return out


def _sentences(start: float, end: float, text: str) -> list[dict]:
    """One spoken stretch as lines. A long stretch is split at sentence ends, each sentence given its share of
    the time by length: inside a stretch the times are an estimate, the stretch's own start and end are measured."""
    parts = [p.strip() for p in re.split(r"(?<=[。！？!?])|(?<=\.)(?=\s)", text) if p and p.strip()]
    if end - start <= MAX_SENTENCE_S:
        return [{"start": round(start, 2), "end": round(end, 2), "text": text}]
    if len(parts) < 2:  # one run-on sentence: break at commas into pieces of about MAX_SENTENCE_S
        clauses = [c for c in re.split(r"(?<=[，,；;])", text) if c.strip()]
        want = max(1, round(len(text) * MAX_SENTENCE_S / (end - start)))
        parts = []
        for c in clauses:
            if parts and len(parts[-1]) + len(c) <= want:
                parts[-1] += c
            else:
                parts.append(c)
        parts = [p.strip() for p in parts]
        if len(parts) < 2:
            return [{"start": round(start, 2), "end": round(end, 2), "text": text}]
    total = sum(len(p) for p in parts)
    out, t = [], start
    for p in parts:
        z = t + (end - start) * len(p) / total
        out.append({"start": round(t, 2), "end": round(z, 2), "text": p, "timing": "estimated"})
        t = z
    return out


def _decode(rec, samples: np.ndarray, streaming: bool) -> tuple[str, str]:
    """One spoken stretch -> (text, language heard; empty when the recognizer does not say)."""
    st = rec.create_stream()
    st.accept_waveform(SR, samples)
    if streaming:
        st.accept_waveform(SR, np.zeros(int(TAIL_PAD_S * SR), dtype=np.float32))
        st.input_finished()
        while rec.is_ready(st):
            rec.decode_stream(st)
        return (rec.get_result(st) or "").strip(), ""
    rec.decode_stream(st)
    return (st.result.text or "").strip(), str(getattr(st.result, "lang", "") or "").strip("<|>")


def transcribe(audio: str | Path, language: str | None = None, threads: int = 2, turns: list[dict] | None = None) -> dict:
    """{"ok", "engine", "language", "lines": [{"start", "end", "text"}]}; ok=False with a reason when it cannot run.
    language: None follows --asr-lang ($REA_ASR_LANG, default auto); "bn" is the Bengali model, anything else is a hint
    for SenseVoice ("auto" lets it detect each line).
    turns: who speaks when (speakers.diarize). A stretch of speech is then cut where the speaker changes, so two
    people answering each other without a pause become two lines, and every line carries its "speaker"."""
    if not available():
        return {"ok": False, "reason": "not_installed"}
    x = extract_audio(audio, SR)
    if x is None or len(x) < SR // 2:
        return {"ok": False, "reason": "no audio"}
    try:
        import sherpa_onnx

        lang = language or asr_lang()
        if lang == "bn":
            d, vad_model = ensure_bn_models()
            rec = sherpa_onnx.OnlineRecognizer.from_transducer(
                tokens=str(d / "tokens.txt"), encoder=str(d / "encoder.onnx"), decoder=str(d / "decoder.onnx"),
                joiner=str(d / "joiner.onnx"), num_threads=threads, sample_rate=SR, feature_dim=80)
            engine = "zipformer-bn-vosk (sherpa-onnx)"
        else:
            model, tokens, vad_model = ensure_models()
            rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(model=str(model), tokens=str(tokens), num_threads=threads, use_itn=True,
                                                                 language=lang if lang in LANGS else "")
            engine = "sensevoice-small-int8 (sherpa-onnx)"
        lines, langs = [], []
        for start, samples in _by_speaker(_stretches(x, vad_model), turns):
            text, heard = _decode(rec, samples, streaming=lang == "bn")
            if len(text.strip("。，、！？.,!? ")) < 1:
                continue
            got = _sentences(start, start + len(samples) / SR, text)
            if turns:
                from .speakers import speaker_at

                who = speaker_at(turns, start, start + len(samples) / SR)
                got = [dict(ln, speaker=who) for ln in got] if who else got
            lines += got
            if heard:
                langs.append(heard)
    except Exception as exc:  # offline on first use, a broken wheel: the breakdown goes on without a transcript
        LOG.warning("speech recognition failed: %s", str(exc)[:200])
        return {"ok": False, "reason": f"{type(exc).__name__}: {str(exc)[:120]}"}
    return {"ok": True, "engine": engine, "language": "bn" if lang == "bn" else (max(set(langs), key=langs.count) if langs else ""),
            "lines": lines}
