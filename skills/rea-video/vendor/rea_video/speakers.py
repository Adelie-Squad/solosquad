"""Who speaks when: split the voice track by speaker, and give each speaker a track of their own.

Runs on the separated vocal stem (music under the voice confuses a speaker model as much as a recognizer).
Three steps, all local on the sherpa-onnx stack the speech recognizer uses (`pip install "rea-video[asr]"`):

1. turns: a pyannote segmentation model finds speech, pauses and speaker changes, including two people talking
   at once. Its own grouping of the turns is not used: with several people taking quick turns it mixes them up.
2. voices: every turn is cut into pieces of about 1.5 s, each piece gets a speaker embedding (3D-Speaker CAM++,
   Chinese + English), and the pieces are grouped by how alike they sound. Then each group's audio is pooled and
   embedded again as one long sample, which is a far better measure of a voice: groups that sound alike are
   merged (one person shouting and whispering), and a voice heard for a moment only is given to the nearest one
   or dropped.
3. per speaker: time on air, pitch, and stems/voice_S1.wav ... (the vocal stem with everyone else muted).

About 35 MB of models are downloaded on first use. Stretches where two people talk at once are listed, and stay
in both speakers' tracks: pulling overlapping voices apart is not attempted.

What this cannot know: which on-screen character a voice belongs to (the VLM's speaker names are matched onto
the voices by time when there are any), and whether two voices are one actor or one TTS engine in two styles.
"""
from __future__ import annotations

import importlib.util
import os
import subprocess
import tarfile
import uuid
from pathlib import Path

import numpy as np

from .media import extract_audio
from .stems import ensure_file, models_dir
from .util import LOG, fetch, sha256_file

SR = 16000
SEG_DIR = "sherpa-onnx-pyannote-segmentation-3-0"
SEG_URL = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/{SEG_DIR}.tar.bz2"
SEG_ARCHIVE_SHA256 = "24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488"
SEG_FILE = "model.onnx"
EMB_NAME = "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
EMB_URL = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/{EMB_NAME}"
EMB_SHA256 = "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2"

PIECE_S = 1.5             # length of the pieces that are embedded one by one
MAX_PIECES = 600          # longer soundtracks use longer pieces
PIECE_SIMILARITY = 0.42   # first pass: groups of pieces at least this alike (average cosine) are joined
MERGE_SIMILARITY = 0.62   # second pass, on pooled audio: parts of one voice score 0.58-0.97, two voices up to 0.59
FOLD_S = 2.5              # a voice with less audio than this is measured too poorly to stand as a group of its own
FOLD_SIMILARITY = 0.3     # ... it joins the speaker it is most like, when it is at least this alike
MIN_SPEAKER_S = 1.2       # a voice heard for less than this in total is not a speaker of its own
MINOR_S, MINOR_SHARE = 5.0, 0.08  # heard for less than both: a voice in passing
MIN_SPEECH_S = 3.0        # less speech than this in the whole track: no speakers are reported
MIN_TURN_S = 0.25
JOIN_GAP_S = 0.35         # same speaker again after a gap this short: one turn
MAX_SPEAKERS = 12


def available() -> bool:
    return importlib.util.find_spec("sherpa_onnx") is not None


def ensure_models() -> tuple[Path, Path]:
    """-> (segmentation model, speaker-embedding model), downloaded and checked on first use."""
    root = models_dir()
    seg = root / SEG_DIR / SEG_FILE
    if not seg.is_file():
        root.mkdir(parents=True, exist_ok=True)
        LOG.info("downloading speaker models (~35 MB) -> %s", root)
        arc = root / f"{SEG_DIR}.{os.getpid()}.{uuid.uuid4().hex[:8]}.part"
        tmp = root / f"{SEG_FILE}.{os.getpid()}.{uuid.uuid4().hex[:8]}.part"
        try:
            fetch(SEG_URL, arc, timeout=120)
            if sha256_file(arc) != SEG_ARCHIVE_SHA256:
                raise OSError(f"checksum mismatch for {SEG_DIR}.tar.bz2")
            with tarfile.open(arc, "r:bz2") as tar:  # the one file needed, written under our own name: no archive path is trusted
                src = tar.extractfile(f"{SEG_DIR}/{SEG_FILE}")
                if src is None:
                    raise OSError(f"{SEG_FILE} missing from the model archive")
                with open(tmp, "wb") as f:
                    while chunk := src.read(1 << 20):
                        f.write(chunk)
            seg.parent.mkdir(parents=True, exist_ok=True)
            tmp.replace(seg)
        finally:
            arc.unlink(missing_ok=True)
            tmp.unlink(missing_ok=True)
    return seg, ensure_file(EMB_NAME, EMB_URL, EMB_SHA256, "~28 MB")


def _raw_turns(x: np.ndarray, seg: Path, emb: Path, threads: int) -> list[tuple[float, float]]:
    """Stretches of speech by one person, in time order (two may overlap when two people talk at once)."""
    import sherpa_onnx

    cfg = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(seg)), num_threads=threads),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(emb), num_threads=threads),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=-1, threshold=0.3),  # split freely: only the boundaries are kept
        min_duration_on=MIN_TURN_S, min_duration_off=0.3)
    if not cfg.validate():
        raise OSError("speaker models failed to load")
    sd = sherpa_onnx.OfflineSpeakerDiarization(cfg)
    return sorted((float(r.start), float(r.end)) for r in sd.process(x).sort_by_start_time())


def _pieces(raw: list[tuple[float, float]], piece_s: float) -> list[tuple[float, float, int]]:
    """Cut every turn into equal pieces of about piece_s: (start, end, index of the turn)."""
    out = []
    for i, (a, b) in enumerate(raw):
        n = max(1, int(round((b - a) / piece_s)))
        step = (b - a) / n
        out += [(a + k * step, a + (k + 1) * step, i) for k in range(n)]
    return out


def group_pieces(V: np.ndarray, similarity: float = PIECE_SIMILARITY, k: int | None = None) -> np.ndarray:
    """Average-linkage grouping of unit vectors by cosine similarity. Stops when no two groups are at least
    `similarity` alike, or at k groups when k is given. -> a group label per row."""
    n = len(V)
    labels = np.arange(n)
    if n < 2:
        return labels
    S = (V @ V.T).astype(np.float64)
    np.fill_diagonal(S, -np.inf)
    size = np.ones(n)
    alive = np.ones(n, bool)
    left = n
    while left > (k or 1):
        i, j = np.unravel_index(int(np.argmax(S)), S.shape)
        if not k and S[i, j] < similarity:
            break
        row = (S[i] * size[i] + S[j] * size[j]) / (size[i] + size[j])  # average similarity to the joined group
        S[i], S[:, i] = row, row
        S[j], S[:, j] = -np.inf, -np.inf
        S[i, i] = -np.inf
        size[i] += size[j]
        alive[j] = False
        labels[labels == labels[j]] = labels[i]
        left -= 1
    return labels


def _settle(V: np.ndarray, labels: np.ndarray, rounds: int = 3) -> np.ndarray:
    """Move each piece to the group whose average voice it is closest to (a few k-means rounds on the sphere)."""
    for _ in range(rounds):
        ids = np.unique(labels)
        C = np.stack([V[labels == g].mean(axis=0) for g in ids])
        C /= np.linalg.norm(C, axis=1, keepdims=True) + 1e-9
        new = ids[np.argmax(V @ C.T, axis=1)]
        if (new == labels).all():
            break
        labels = new
    return labels


def _smooth(pieces: list[tuple[float, float, int]], labels: np.ndarray) -> np.ndarray:
    """One piece inside a turn that disagrees with the pieces on both sides is a mismeasured piece, not a
    1.5 s interjection in the middle of someone's sentence (those arrive as turns of their own)."""
    out = labels.copy()
    for i in range(1, len(pieces) - 1):
        if pieces[i - 1][2] == pieces[i][2] == pieces[i + 1][2] and labels[i - 1] == labels[i + 1] != labels[i]:
            out[i] = labels[i - 1]
    return out


def _embedder(emb: Path, threads: int):
    import sherpa_onnx

    ex = sherpa_onnx.SpeakerEmbeddingExtractor(sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(emb), num_threads=threads))

    def embed(samples: np.ndarray) -> np.ndarray | None:
        if len(samples) < SR * 0.4:
            return None
        st = ex.create_stream()
        st.accept_waveform(SR, samples[:SR * 60])  # a minute of one voice is plenty
        st.input_finished()
        v = np.array(ex.compute(st), np.float32)
        n = float(np.linalg.norm(v))
        return v / n if n > 0 else None

    return embed


def _solo_ranges(turns: list[tuple[float, float, int]]) -> dict[int, list[tuple[float, float]]]:
    """Per speaker, the parts of their turns where nobody else is talking (the clean samples of that voice)."""
    out: dict[int, list[tuple[float, float]]] = {}
    for a, b, s in turns:
        cuts = sorted((max(a, c), min(b, d)) for c, d, o in turns if o != s and c < b and d > a)
        t = a
        for c, d in cuts:
            if c - t >= 0.2:
                out.setdefault(s, []).append((t, c))
            t = max(t, d)
        if b - t >= 0.2:
            out.setdefault(s, []).append((t, b))
    return out


def _pool(x: np.ndarray, ranges: list[tuple[float, float]]) -> np.ndarray:
    return np.concatenate([x[int(a * SR):int(b * SR)] for a, b in ranges]) if ranges else np.zeros(0, np.float32)


def regroup(turns: list[tuple[float, float, int]], measure, fixed: bool = False) -> list[tuple[float, float, int]]:
    """Merge voices that sound alike and fold away voices heard only for a moment.
    `measure(ranges)` -> unit-length embedding of that audio pooled into one sample, or None when there is too
    little to measure. The most alike pair is merged first and the merged voice is measured again, so a voice
    split three ways comes back together even when its two most different parts would not merge directly.
    `fixed`: the caller named the number of speakers, so nothing is merged or dropped."""
    if fixed or len({s for _, _, s in turns}) < 2:
        return turns
    solo = _solo_ranges(turns)
    ranges: dict[int, list[tuple[float, float]]] = {s: solo.get(s, []) for s in {s for _, _, s in turns}}
    secs = {s: sum(b - a for a, b, o in turns if o == s) for s in ranges}
    vec = {s: measure(r) for s, r in ranges.items()}
    label = {s: s for s in ranges}

    def sim(g: int, h: int) -> float:
        return float(vec[g] @ vec[h]) if vec[g] is not None and vec[h] is not None else -1.0

    while True:
        big = [g for g in ranges if secs[g] >= FOLD_S]
        best = max(((sim(g, h), g, h) for i, g in enumerate(big) for h in big[i + 1:]), default=None)
        if best is None or best[0] < MERGE_SIMILARITY:
            break
        _, g, h = best
        keep, gone = (g, h) if secs[g] >= secs[h] else (h, g)
        ranges[keep] = sorted(ranges[keep] + ranges.pop(gone))
        secs[keep] += secs.pop(gone)
        vec[keep] = measure(ranges[keep])
        label[gone] = keep
    # a voice heard only briefly: a short sample measures poorly, so it goes to the speaker it is most like
    # unless it is clearly nobody's (then it is a one-line voice of its own, or too short to keep at all)
    real = [g for g in ranges if secs[g] >= FOLD_S] or [max(secs, key=secs.get)]
    drop = set()
    for g in list(ranges):
        if g in real:
            continue
        near = max(((sim(g, r), r) for r in real), default=(-1.0, None))
        if near[0] >= FOLD_SIMILARITY:
            label[g] = near[1]
        elif secs[g] < MIN_SPEAKER_S:
            drop.add(g)

    def root(s: int) -> int:
        while label[s] != s:
            s = label[s]
        return s

    return [(a, b, root(s)) for a, b, s in turns if root(s) not in drop]


def _tidy(turns: list[tuple[float, float, int]]) -> list[dict]:
    """Number the speakers by first appearance (S1, S2, ...) and join a speaker's turns across short gaps."""
    order: dict[int, str] = {}
    out: list[dict] = []
    last: dict[str, dict] = {}
    for a, b, s in sorted(turns):
        name = order.setdefault(s, f"S{len(order) + 1}")
        prev = last.get(name)
        if prev and a - prev["end"] <= JOIN_GAP_S:
            prev["end"] = round(max(prev["end"], b), 2)
            continue
        row = {"start": round(a, 2), "end": round(b, 2), "speaker": name}
        out.append(row)
        last[name] = row
    return [t for t in out if t["end"] - t["start"] >= MIN_TURN_S]


def overlaps(turns: list[dict]) -> list[list[float]]:
    """Stretches where two speakers talk at once."""
    out: list[list[float]] = []
    for i, t in enumerate(turns):
        for u in turns[i + 1:]:
            if u["start"] >= t["end"]:
                break
            if u["speaker"] != t["speaker"]:
                a, b = max(t["start"], u["start"]), min(t["end"], u["end"])
                if b - a >= 0.15:
                    out.append([round(a, 2), round(b, 2)])
    return out


def _pitch(x: np.ndarray, ranges: list[tuple[float, float]]) -> dict:
    """Median pitch of one voice (autocorrelation on 40 ms frames) and what it suggests."""
    frame = int(0.04 * SR)
    lo, hi = int(SR / 400), int(SR / 70)
    f0 = []
    for a, b in ranges:
        for s in range(int(a * SR), int(b * SR) - frame, frame):
            seg = x[s:s + frame]
            if np.sqrt(np.mean(seg ** 2)) < 0.01:
                continue
            seg = seg - seg.mean()
            ac = np.correlate(seg, seg, "full")[frame - 1:]
            if ac[0] <= 0:
                continue
            lag = lo + int(np.argmax(ac[lo:hi]))
            if ac[lag] / ac[0] > 0.45:
                f0.append(SR / lag)
        if len(f0) > 400:
            break
    if len(f0) < 8:
        return {}
    med = float(np.median(f0))
    return {"f0_median_hz": round(med, 1), "gender_hint": "male" if med < 150 else ("female" if med > 200 else "uncertain")}


def diarize(audio: str | Path, num_speakers: int | None = None, threads: int = 2) -> dict:
    """{"ok", "count", "speakers": [{"id", "seconds", "share", "turns", "first", ...}], "turns": [{"start", "end",
    "speaker"}], "overlaps": [[start, end]]}; ok=False with a reason when it cannot run."""
    if not available():
        return {"ok": False, "reason": "not_installed"}
    x = extract_audio(audio, SR)
    if x is None or len(x) < SR:
        return {"ok": False, "reason": "no audio"}
    try:
        seg, emb = ensure_models()
        raw = _raw_turns(x, seg, emb, threads)
        if not raw:
            return {"ok": True, "count": 0, "speakers": [], "turns": [], "overlaps": []}
        embed = _embedder(emb, threads)
        spoken_s = sum(b - a for a, b in raw)
        pieces = _pieces(raw, max(PIECE_S, spoken_s / MAX_PIECES))
        vecs = [embed(x[int(a * SR):int(b * SR)]) for a, b, _ in pieces]
        known = [i for i, v in enumerate(vecs) if v is not None]
        if not known:
            return {"ok": True, "count": 0, "speakers": [], "turns": [], "overlaps": []}
        V = np.stack([vecs[i] for i in known])
        got = _settle(V, group_pieces(V, k=num_speakers))
        labels = np.full(len(pieces), -1)
        labels[known] = got
        for i in np.where(labels < 0)[0]:  # too short to measure: the speaker of the nearest piece in time
            j = min(known, key=lambda q: abs(pieces[q][0] - pieces[i][0]))
            labels[i] = labels[j]
        labels = _smooth(pieces, labels)
        first = [(a, b, int(g)) for (a, b, _), g in zip(pieces, labels)]
        turns = _tidy(regroup(first, lambda ranges: embed(_pool(x, ranges)), fixed=bool(num_speakers)))
    except Exception as exc:  # offline on first use, a broken wheel: the breakdown goes on without speakers
        LOG.warning("speaker separation failed: %s", str(exc)[:200])
        return {"ok": False, "reason": f"{type(exc).__name__}: {str(exc)[:120]}"}
    if sum(t["end"] - t["start"] for t in turns) < MIN_SPEECH_S:
        turns = []  # a cough, a shout in the music: nobody is speaking in this video
    names = sorted({t["speaker"] for t in turns}, key=lambda n: int(n[1:]))[:MAX_SPEAKERS]
    turns = [t for t in turns if t["speaker"] in names]
    spoken = sum(t["end"] - t["start"] for t in turns) or 1.0
    speakers = []
    for n in names:
        mine = [t for t in turns if t["speaker"] == n]
        secs = sum(t["end"] - t["start"] for t in mine)
        speakers.append({"id": n, "seconds": round(secs, 2), "share": round(secs / spoken, 3), "turns": len(mine),
                         "first": mine[0]["start"], **_pitch(x, [(t["start"], t["end"]) for t in mine]),
                         # a few seconds in passing (a clip inside the video, a bystander): not one of the people who carry it
                         **({"minor": True} if secs < MINOR_S and secs / spoken < MINOR_SHARE else {})})
    return {"ok": True, "engine": "pyannote-segmentation-3.0 + 3D-Speaker CAM++ (sherpa-onnx)", "count": len(speakers),
            "speakers": speakers, "turns": turns, "overlaps": overlaps(turns)}


def name_speakers(who: dict, lines: list[dict]) -> None:
    """Give each voice the name a viewer used for it. `lines`: a script with "start", "end" and "speaker" names
    (the VLM watched the video and wrote who says each line). A voice takes the name that covers most of its
    time, when that name is not already taken by a voice it covers better."""
    turns = who.get("turns") or []
    votes: dict[str, dict[str, float]] = {}
    for ln in lines:
        name = str(ln.get("speaker") or "").strip()
        try:
            a, b = float(ln.get("start")), float(ln.get("end"))
        except (TypeError, ValueError):
            continue
        if not name or b <= a:
            continue
        for t in turns:
            o = min(b, t["end"]) - max(a, t["start"])
            if o > 0:
                votes.setdefault(t["speaker"], {}).setdefault(name, 0.0)
                votes[t["speaker"]][name] += o
    taken: set[str] = set()
    pairs = sorted(((sec, sid, name) for sid, v in votes.items() for name, sec in v.items()), reverse=True)
    named: dict[str, str] = {}
    for sec, sid, name in pairs:
        if sid in named or name in taken or sec < 0.5 * sum(votes[sid].values()):
            continue
        named[sid] = name
        taken.add(name)
    for sp in who.get("speakers") or []:
        sp.pop("name", None)
        if sp["id"] in named:
            sp["name"] = named[sp["id"]][:20]


def speaker_at(turns: list[dict], start: float, end: float) -> str:
    """The speaker who talks for most of [start, end], or "" when nobody does."""
    got: dict[str, float] = {}
    for t in turns:
        o = min(end, t["end"]) - max(start, t["start"])
        if o > 0:
            got[t["speaker"]] = got.get(t["speaker"], 0.0) + o
    return max(got, key=got.get) if got else ""


def change_points(turns: list[dict], start: float, end: float, min_piece: float = 0.5) -> list[float]:
    """Times inside [start, end] where the speaker changes, for cutting one stretch of speech into lines:
    the middle of the silence between two turns, or of the stretch where both talk."""
    inside = [t for t in turns if t["end"] > start and t["start"] < end]
    cuts: list[float] = []
    for p, q in zip(inside, inside[1:]):
        if p["speaker"] == q["speaker"]:
            continue
        c = (min(p["end"], end) + max(q["start"], start)) / 2
        if c - (cuts[-1] if cuts else start) >= min_piece and end - c >= min_piece:
            cuts.append(round(c, 3))
    return cuts


def write_tracks(vocals: str | Path, turns: list[dict], out_dir: str | Path, fade_s: float = 0.03) -> dict[str, str]:
    """stems/voice_S1.wav ...: the vocal stem with only that speaker's turns left in (same length as the video,
    so the tracks line up in an editor). -> {speaker id: file name}"""
    from .stems import SR as STEM_SR, load_stereo, save_wav

    mix = load_stereo(vocals)
    out = Path(out_dir) / "stems"
    for old in out.glob("voice_S*.wav"):
        old.unlink()
    if mix is None or not turns:
        return {}
    files: dict[str, str] = {}
    fade = max(1, int(fade_s * STEM_SR))
    for name in sorted({t["speaker"] for t in turns}, key=lambda n: int(n[1:])):
        gate = np.zeros(mix.shape[1], np.float32)
        for t in turns:
            if t["speaker"] == name:
                gate[max(0, int(t["start"] * STEM_SR) - fade):int(t["end"] * STEM_SR) + fade] = 1.0
        gate = np.convolve(gate, np.ones(fade, np.float32) / fade, mode="same")  # short ramps instead of clicks
        f = out / f"voice_{name}.wav"
        try:
            save_wav(mix * gate[None, :], f)
        except (OSError, subprocess.CalledProcessError) as exc:
            LOG.warning("could not write %s: %s", f.name, exc)
            continue
        files[name] = f.name
    return files
