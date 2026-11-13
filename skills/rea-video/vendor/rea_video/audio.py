"""Audio reverse-engineering: voice / music / sound effects, and how they lock to picture.

numpy only (no librosa/scipy):
- HPSS (median-filter harmonic/percussive separation) on an STFT
- voice: syllabic (3-8 Hz) modulation of the voiced speech band, pauses, pitch (f0) range
- music: a continuous harmonic bed that persists through speech pauses and/or a periodic
  beat; tempo + beat grid, key (Krumhansl profiles), section changes (chroma novelty)
- SFX: strong percussive/transient events that are neither speech syllables nor on-grid
  drum hits; coarse type (whoosh / ding / pop / click / impact / typing) and whether they
  coincide with cuts or motion-graphics beats
- edit: do cuts land on beats / onsets?"""
from __future__ import annotations

from .i18n import LangDict, T, semi

import numpy as np

from .media import extract_audio

SR = 22050
# share of a frame's energy in the percussive part. A sustained tone / drone sits near 1e-5; the quietest real hit
# or drum in the eval set is ~5e-3. Below this there is no beat to count and no transient to call a sound effect
PERC_FLOOR = 1e-3
WEAK_PERC, WEAK_BEAT = 0.045, 0.2  # both this low: no drums, no tempo to report
TONE_PERC_MAX = 0.06  # percussive share (90th pct) below which a held-tone check still runs
N_FFT = 1024
HOP = 256
T_HOP = HOP / SR
_KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
SFX_TYPE_ZH = LangDict({"whoosh": "嗖/转场呼啸", "ding": "叮/提示音", "pop": "啵/弹出", "click": "咔哒/点击", "impact": "重击/低频冲击",
                        "typing": "打字/连续点击", "hit": "打点/敲击"},
                       en={"whoosh": "whoosh / transition swish", "ding": "ding / notification", "pop": "pop", "click": "click",
                           "impact": "impact / low-end hit", "typing": "typing / rapid clicks", "hit": "hit / tap"})


def _stft(x: np.ndarray) -> np.ndarray:
    if len(x) < N_FFT:
        x = np.pad(x, (0, N_FFT - len(x)))
    n = 1 + (len(x) - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(n)[:, None]
    return np.abs(np.fft.rfft(x[idx] * np.hanning(N_FFT)[None, :], axis=1)).astype(np.float32)


def _median_filter(a: np.ndarray, size: int, axis: int, chunk: int = 600) -> np.ndarray:
    pad = size // 2
    if axis == 0:
        padded = np.pad(a, ((pad, pad), (0, 0)), mode="edge")
        out = np.empty_like(a)
        for s in range(0, a.shape[0], chunk):
            e = min(a.shape[0], s + chunk)
            win = np.lib.stride_tricks.sliding_window_view(padded[s:e + 2 * pad], size, axis=0)
            out[s:e] = np.median(win, axis=-1)
        return out
    return _median_filter(a.T, size, 0, chunk).T


def hpss(S: np.ndarray, size: int = 17) -> tuple[np.ndarray, np.ndarray]:
    H = _median_filter(S, size, axis=0)
    P = _median_filter(S, size, axis=1)
    mh = H ** 2 / (H ** 2 + P ** 2 + 1e-12)
    return S * mh, S * (1 - mh)


def _peaks(env: np.ndarray, min_gap: int, thr: float) -> np.ndarray:
    if len(env) < 3:
        return np.array([], int)
    c = np.where((env[1:-1] > env[:-2]) & (env[1:-1] >= env[2:]) & (env[1:-1] > thr))[0] + 1
    picked: list[int] = []
    for i in c[np.argsort(-env[c])]:
        if all(abs(i - p) >= min_gap for p in picked):
            picked.append(int(i))
    return np.array(sorted(picked), int)


def _runs(flags: np.ndarray, win_s: float, min_len_s: float = 0.6, merge_gap_s: float = 0.6) -> list[list[float]]:
    segs: list[list[float]] = []
    i, n = 0, len(flags)
    while i < n:
        if flags[i]:
            j = i
            while j < n and flags[j]:
                j += 1
            a, b = i * win_s, j * win_s
            if segs and a - segs[-1][1] <= merge_gap_s:
                segs[-1][1] = b
            else:
                segs.append([a, b])
            i = j
        else:
            i += 1
    return [[round(a, 2), round(b, 2)] for a, b in segs if b - a >= min_len_s]


def _seg_mask(segs: list[list[float]], n: int) -> np.ndarray:
    """Boolean mask over n STFT frames, True inside the [start, end] second ranges."""
    m = np.zeros(n, bool)
    for a, b in segs:
        m[int(a / T_HOP):int(b / T_HOP)] = True
    return m


def _chroma(S: np.ndarray, freqs: np.ndarray) -> np.ndarray:
    valid = (freqs > 60) & (freqs < 4000)
    pc = (np.round(12 * np.log2(freqs[valid] / 440.0)) + 9) % 12
    C = np.zeros((S.shape[0], 12), np.float32)
    for k in range(12):
        C[:, k] = S[:, valid][:, pc == k].sum(axis=1)
    return C / (C.sum(axis=1, keepdims=True) + 1e-9)


def _key(chroma_mean: np.ndarray) -> dict:
    best = (-2.0, "C", "major")
    for k in range(12):
        for prof, mode in ((_KS_MAJOR, "major"), (_KS_MINOR, "minor")):
            r = float(np.corrcoef(np.roll(prof, k), chroma_mean)[0, 1])
            if r > best[0]:
                best = (r, _NOTES[k], mode)
    return {"tonic": best[1], "mode": best[2], "confidence": round(best[0], 3)}


def _f0(x: np.ndarray, segs: list[list[float]], max_frames: int = 240) -> dict:
    """Autocorrelation pitch on voiced frames inside speech segments."""
    frame = int(0.04 * SR)
    lo, hi = int(SR / 400), int(SR / 70)
    f0s = []
    starts = []
    for a, b in segs:
        starts += list(range(int(a * SR), max(int(a * SR), int(b * SR) - frame), frame))
    if not starts:
        return {}
    for s in np.array(starts)[np.linspace(0, len(starts) - 1, num=min(max_frames, len(starts))).astype(int)]:
        seg = x[s:s + frame]
        if len(seg) < frame or np.sqrt(np.mean(seg ** 2)) < 0.01:
            continue
        seg = seg - seg.mean()
        ac = np.correlate(seg, seg, "full")[frame - 1:]
        if ac[0] <= 0:
            continue
        lag = lo + int(np.argmax(ac[lo:hi]))
        if ac[lag] / ac[0] > 0.45:
            f0s.append(SR / lag)
    if len(f0s) < 8:
        return {}
    f = np.array(f0s)
    med = float(np.median(f))
    return {"f0_median_hz": round(med, 1), "f0_cv": round(float(np.std(f) / med), 3),
            "gender_hint": "male" if med < 150 else ("female" if med > 200 else "uncertain")}


def vocal_style(x: np.ndarray, Sh: np.ndarray, freqs: np.ndarray, voice_segs: list[list[float]], beats: np.ndarray) -> dict:
    """Sung/rapped vocals vs spoken narration.
    - sung notes hold a steady pitch for >= 160 ms; speech glides
    - sung or rapped syllables lock to the beat grid (beats + half beats); narration does not"""
    if not voice_segs:
        return {}
    frame, hop = int(0.04 * SR), int(0.02 * SR)
    lo, hi = int(SR / 500), int(SR / 70)
    f0 = []
    for a, b in voice_segs:
        for s in range(int(a * SR), int(b * SR) - frame, hop):
            seg = x[s:s + frame]
            if np.sqrt(np.mean(seg ** 2)) < 0.01:
                f0.append(0.0)
                continue
            seg = seg - seg.mean()
            ac = np.correlate(seg, seg, "full")[frame - 1:]
            lag = lo + int(np.argmax(ac[lo:hi]))
            f0.append(SR / lag if ac[0] > 0 and ac[lag] / ac[0] > 0.5 else 0.0)
        f0.append(0.0)
        if len(f0) > 6000:
            break
    f = np.array(f0)
    voiced = f > 0
    sustained = 0
    i = 0
    while i < len(f):
        if voiced[i]:
            j = i
            while j + 1 < len(f) and voiced[j + 1] and abs(f[j + 1] - f[j]) / f[j] < 0.03:
                j += 1
            if j - i + 1 >= 8:
                sustained += j - i + 1
            i = j + 1
        else:
            i += 1
    sustained_ratio = sustained / max(1, int(voiced.sum()))
    out = {"sustained_note_ratio": round(float(sustained_ratio), 3)}
    if len(beats) > 8:
        band = (freqs > 300) & (freqs < 3400)
        env = np.maximum(0, np.diff(np.log1p(Sh[:, band].sum(axis=1)), prepend=0))
        inside = _seg_mask(voice_segs, len(env))
        pk = _peaks(env * inside, min_gap=int(0.08 / T_HOP), thr=float(np.percentile(env[inside], 75)) if inside.any() else 0)
        grid = np.sort(np.concatenate([beats, (beats[:-1] + beats[1:]) / 2]))
        if len(pk) > 10:
            t = pk * T_HOP
            d = np.min(np.abs(t[:, None] - grid[None, :]), axis=1)
            spacing = float(np.median(np.diff(grid))) if len(grid) > 1 else 1.0
            chance = min(1.0, 2 * 0.045 / max(spacing, 1e-3))
            out["onsets_on_beat_ratio"] = round(float((d < 0.045).mean()), 3)
            out["onsets_on_beat_chance"] = round(chance, 3)
    lock = out.get("onsets_on_beat_ratio", 0) > max(0.45, 1.5 * out.get("onsets_on_beat_chance", 1))
    out["sung"] = bool(sustained_ratio > 0.3 or lock)
    out["style"] = "singing" if sustained_ratio > 0.3 else ("rap_or_rhythmic" if lock else "speech")
    return out


def sfx_type(S: np.ndarray, freqs: np.ndarray, frame_db: np.ndarray, c: int, hop_t: float = T_HOP) -> tuple[str, dict]:
    """Coarse type of the transient starting at STFT frame c, from its spectrum and decay."""
    w = slice(c, min(len(S), c + int(0.12 / hop_t)))
    spec = S[w].mean(axis=0)
    total = float(spec.sum()) + 1e-9
    hf_ratio = float(spec[freqs > 4000].sum() / total)
    centroid = float((spec * freqs).sum() / total)
    tonal = float(spec.max() / (spec.mean() + 1e-9))
    j = c
    while j < len(frame_db) - 1 and frame_db[j] > frame_db[c] - 15 and (j - c) * hop_t < 1.5:
        j += 1
    d = (j - c) * hop_t
    if d > 0.25 and hf_ratio > 0.25:
        kind = "whoosh"
    elif tonal > 25 and centroid > 1200:
        kind = "ding"
    elif centroid < 350:
        kind = "impact"
    elif d < 0.06 and hf_ratio > 0.3:
        kind = "click"
    elif hf_ratio > 0.2 or tonal > 15:
        kind = "pop"
    else:
        kind = "hit"
    return kind, {"dur": round(d, 3), "centroid_hz": int(centroid), "hf_ratio": round(hf_ratio, 3)}


def steady_tone(x: np.ndarray, Sh: np.ndarray, frames: np.ndarray, n_fine: int = 8192) -> float | None:
    """Frequency of a single held pitch, or None: a sine, a square-wave buzzer, mains hum.
    Two checks. The strongest harmonic peak stays on the same bin from frame to frame (a melody moves).
    And on a fine averaged spectrum (~2.7 Hz bins, so 50 Hz hum and its harmonics separate), nearly all the
    energy sits on one fundamental and its whole-number multiples, with the fundamental itself clearly
    present (a chord's notes are not multiples of a sounding note)."""
    M = Sh[frames] ** 2
    if len(M) < int(1.0 / T_HOP):
        return None
    pk = M.argmax(axis=1)
    mode = int(np.bincount(pk).argmax())
    if float((np.abs(pk - mode) <= 1).mean()) <= 0.9:
        return None
    keep = np.repeat(frames, HOP)[:len(x)]
    y = x[:len(keep)][keep]
    n = len(y) // n_fine
    if n < 1:
        return None
    win = np.hanning(n_fine)
    P = (np.abs(np.fft.rfft(y[:n * n_fine].reshape(n, n_fine) * win, axis=1)) ** 2).mean(axis=0)
    P[:int(20 * n_fine / SR)] = 0  # below hearing: DC and rumble
    total = P.sum() + 1e-12
    bins = np.arange(len(P))
    top = int(P.argmax())
    for m in (1, 2, 3):  # the loudest peak may be the 2nd or 3rd harmonic (hum often peaks at 100/120 Hz)
        f0 = top / m
        if f0 * SR / n_fine < 30:
            break
        k = np.maximum(1, np.round(bins / f0))
        comb = np.abs(bins - k * f0) <= 3 + 0.01 * k * f0
        fund = np.abs(bins - f0) <= 3
        if P[comb].sum() / total > 0.9 and P[fund].sum() / total > 0.02:
            return float(f0 * SR / n_fine)
    return None


def perc_share(S: np.ndarray, Sp: np.ndarray) -> np.ndarray:
    return (Sp ** 2).sum(axis=1) / ((S ** 2).sum(axis=1) + 1e-12)


def has_transient(share: np.ndarray, c: int) -> bool:
    return bool(share[max(0, c - 3):c + 4].max() >= PERC_FLOOR)


def onset_envelope(path: str):
    """(percussive onset curve, frame dB, magnitude STFT, freqs, seconds per frame, percussive share) of a file's
    soundtrack."""
    x = extract_audio(path, SR)
    if x is None or len(x) < SR * 0.3:
        return None
    S = _stft(x)
    freqs = np.fft.rfftfreq(N_FFT, 1 / SR)
    _, Sp = hpss(S)
    frame_db = 10 * np.log10((S ** 2).mean(axis=1) + 1e-12)
    perc = np.maximum(0, np.diff(np.log1p(Sp.sum(axis=1)), prepend=0))
    return perc, frame_db, S, freqs, T_HOP, perc_share(S, Sp)


def _tempo_and_beats(music: dict, perc: np.ndarray, perc90: float, music_segs: list[list[float]]) -> np.ndarray:
    """Tempo, beat strength and beat times from the percussive onset curve; writes them into music and returns
    the beat times (seconds). Marks no_beat instead when there are no drums to count."""
    beats = np.array([])
    env = perc - perc.mean()
    ac = np.correlate(env, env, "full")[len(env) - 1:]
    ac /= ac[0] + 1e-9
    lo, hi = int(60 / 190 / T_HOP), int(60 / 60 / T_HOP)
    lag = lo + int(np.argmax(ac[lo:hi])) if hi < len(ac) else 0
    if lag and not music.get("no_beat") and perc90 < WEAK_PERC and ac[lag] < WEAK_BEAT:
        # a pad or drone with no drums: the onset curve is codec ripple and its best "period" is noise
        music["no_beat"] = True
    if lag and not music.get("no_beat"):
        tempo = 60 / (lag * T_HOP)
        if tempo < 75:  # prefer the common 75-180 BPM octave
            tempo *= 2
            lag = max(1, lag // 2)
        music["tempo_bpm"] = round(float(tempo), 1)
        music["tempo_alternatives"] = [round(float(tempo) / 2, 1), round(float(tempo) * 2, 1)]
        music["beat_strength"] = round(float(ac[lag]), 3)
        # beat grid: best phase of a comb at the tempo, then snap to local onset peaks
        phase = int(np.argmax([perc[p::lag].sum() for p in range(lag)]))
        grid = np.arange(phase, len(perc), lag)
        snapped = []
        for g in grid:
            a, b = max(0, g - 3), min(len(perc), g + 4)
            snapped.append(a + int(np.argmax(perc[a:b])))
        beats = np.array(snapped) * T_HOP
        in_music = np.zeros_like(beats, bool)
        for a, b in music_segs:
            in_music |= (beats >= a) & (beats <= b)
        beats = beats[in_music]
        music["beats"] = [round(float(b), 3) for b in beats[:400]]
    return beats


def _section_changes(C: np.ndarray, hb_db: np.ndarray) -> list[float]:
    """Section boundaries (seconds): chroma + loudness novelty, comparing the 4 s before and after each point."""
    blk = int(round(0.5 / T_HOP))
    cb = np.array([C[i:i + blk].mean(axis=0) for i in range(0, len(C) - blk, blk)])
    eb = np.array([hb_db[i:i + blk].mean() for i in range(0, len(C) - blk, blk)])
    k = 8
    nov = np.zeros(len(cb))
    for i in range(k, len(cb) - k):
        a, b = cb[i - k:i].mean(axis=0), cb[i:i + k].mean(axis=0)
        cos = float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
        nov[i] = (1 - cos) * 4 + abs(eb[i - k:i].mean() - eb[i:i + k].mean()) / 12
    pk = _peaks(nov, min_gap=k, thr=max(0.25, float(np.percentile(nov, 90))))
    return [round(float(i * 0.5), 2) for i in pk][:20]


def _sfx(S: np.ndarray, freqs: np.ndarray, perc: np.ndarray, share: np.ndarray, frame_db: np.ndarray, peak_db: float,
         dur: float, speech_segs: list[list[float]], music_segs: list[list[float]], beats: np.ndarray,
         marks: list[float]) -> dict:
    """Salient transients outside speech and off the beat grid, typed coarsely, with sync to visual marks."""
    onset = perc
    speech_frame = _seg_mask(speech_segs, len(onset))
    music_frame = _seg_mask(music_segs, len(onset))
    w2 = int(round(1.0 / T_HOP))
    loc = np.array([np.percentile(onset[max(0, i - w2):i + w2], 90) for i in range(len(onset))])
    cand = _peaks(onset, min_gap=int(0.06 / T_HOP), thr=0.0)
    beat_frames = (beats / T_HOP).astype(int) if len(beats) else np.array([], int)
    events = []
    for c in cand:
        strength = float(onset[c] / (loc[c] + 1e-6))
        # deterministic SFX detection inside a full mix is weak (validated: ~0.2 precision on
        # capsule-cinema cue sheets), so only keep salient transients that stand out from
        # everything around them and sit in a gap of the voice track; the VLM lists the rest
        if strength < 3.0 or frame_db[c] < peak_db - 30 or speech_frame[c]:
            # inside narration, consonant onsets after pauses look exactly like small SFX
            continue
        if music_frame[c] and strength < 6.0:
            continue  # under a music bed only very prominent transients are trusted
        if len(beat_frames) and np.min(np.abs(beat_frames - c)) * T_HOP < 0.05:
            continue
        if not has_transient(share, c) or c * T_HOP > dur - 0.1:
            continue  # the onset curve is relative: a held tone's codec noise wobbles it; the last 0.1 s is the track stopping
        kind, info = sfx_type(S, freqs, frame_db, c, T_HOP)
        events.append({"t": round(c * T_HOP, 3), "type": kind, **info, "strength": round(strength, 1),
                       "source": "deterministic", "confidence": "low"})
    # dense click runs = typing / UI clicks
    ts = np.array([e["t"] for e in events])
    for e in events:
        if e["type"] in ("click", "pop", "hit") and ((np.abs(ts - e["t"]) < 0.6).sum() >= 4):
            e["type"] = "typing"
    synced = 0
    for e in events:
        if marks:
            d = min(abs(e["t"] - m) for m in marks)
            e["sync_with_visual"] = bool(d < 0.12)
            synced += e["sync_with_visual"]
    types: dict[str, int] = {}
    for e in events:
        types[e["type"]] = types.get(e["type"], 0) + 1
    return {"present": len(events) >= 3, "method": "salient transients in voice gaps (low confidence; VLM adds the full list)", "count": len(events), "per_minute": round(len(events) / dur * 60, 1),
            "types": types, "types_zh": {SFX_TYPE_ZH[k]: v for k, v in types.items()},
            "sync_ratio": round(synced / len(events), 3) if events and marks else None, "events": events[:300]}


def analyze_audio(path: str, cut_times: list[float] | None = None, visual_marks: list[float] | None = None) -> dict:
    x = extract_audio(path, SR)
    if x is None or len(x) < SR * 0.3:
        return {"has_audio": False}
    dur = len(x) / SR
    S = _stft(x)
    freqs = np.fft.rfftfreq(N_FFT, 1 / SR)
    Sh, Sp = hpss(S)
    frame_db = 10 * np.log10((S ** 2).mean(axis=1) + 1e-12)
    peak_db = float(np.percentile(frame_db, 99))
    silent = frame_db < peak_db - 45

    # ---------------- voice ----------------------------------------------------------------
    band = (freqs > 300) & (freqs < 3400)
    sb = Sh[:, band].sum(axis=1)
    sb_db = 10 * np.log10(sb ** 2 + 1e-12)
    w1 = int(round(0.5 / T_HOP))
    local_max = np.array([sb_db[max(0, i - w1):i + w1].max() for i in range(len(sb_db))])
    dip = sb_db < local_max - 12          # gaps between syllables / phrases
    harm_ratio = (Sh ** 2).sum(axis=1) / ((S ** 2).sum(axis=1) + 1e-12)
    share = perc_share(S, Sp)
    win = int(round(1.0 / T_HOP))
    step = int(round(0.5 / T_HOP))
    speech_w, music_w = [], []
    hb_db = 10 * np.log10(Sh.sum(axis=1) ** 2 + 1e-12)
    perc = np.maximum(0, np.diff(np.log1p(Sp.sum(axis=1)), prepend=0))
    for s in range(0, max(1, len(sb) - win + 1), step):
        seg = sb[s:s + win]
        z = (seg - seg.mean()) / (seg.std() + 1e-9)
        mod = np.abs(np.fft.rfft(z))
        mf = np.fft.rfftfreq(len(z), T_HOP)
        syl = float(mod[(mf > 3) & (mf < 8)].sum() / (mod[(mf > 0.5) & (mf < 20)].sum() + 1e-9))
        voiced = float((~silent[s:s + win]).mean())
        gaps = float(dip[s:s + win].mean())
        speech_w.append(syl > 0.36 and voiced > 0.4 and 0.05 < gaps < 0.85)
        # music bed over ~3 s: what remains in the gaps between words is still loud and tonal
        # (TTS/voice-over leaves near-silence or noisy ambience there); with no gaps at all, the
        # track is continuous and mostly harmonic; or a clear periodic beat
        a, b = max(0, s - win), min(len(hb_db), s + 2 * win)
        g = dip[a:b] & (frame_db[a:b] > peak_db - 45)
        if g.sum() >= 0.08 * (b - a):
            bed = float(np.median(frame_db[a:b][g])) > peak_db - 40 and float(np.median(harm_ratio[a:b][g])) > 0.62
        else:
            bed = float(np.median(harm_ratio[a:b])) > 0.6 and float(np.percentile(frame_db[a:b], 10)) > peak_db - 35
        pe = perc[a:b] - perc[a:b].mean()
        ac = np.correlate(pe, pe, "full")[len(pe) - 1:]
        lo, hi = int(0.3 / T_HOP), min(len(ac) - 1, int(1.0 / T_HOP))
        beat_ac = float(ac[lo:hi].max() / (ac[0] + 1e-9)) if hi > lo and ac[0] > 0 else 0.0
        music_w.append(bool(bed or beat_ac > 0.35))
    speech_w, music_w = np.array(speech_w), np.array(music_w)
    speech_segs = _runs(speech_w, 0.5)
    music_segs = _runs(music_w, 0.5, min_len_s=1.5, merge_gap_s=1.0)
    speech_ratio = float(sum(b - a for a, b in speech_segs) / dur)
    music_ratio = float(sum(b - a for a, b in music_segs) / dur)
    voice = {"present": speech_ratio > 0.1, "ratio": round(speech_ratio, 3), "segments": speech_segs[:80]}
    voice.update(_f0(x, speech_segs))

    # ---------------- music: tempo, beats, key, sections ------------------------------------
    music: dict = {"present": music_ratio > 0.25, "ratio": round(music_ratio, 3), "segments": music_segs[:40]}
    beats = np.array([])
    perc90 = float(np.percentile(share, 90))
    if music["present"] and perc90 < PERC_FLOOR:
        music["no_beat"] = True  # a held tone / drone: nothing percussive to count a tempo from
    if music["present"] and perc90 < TONE_PERC_MAX:
        # checked a little above the no-beat floor: hiss under a tone, or low hum, leaks a few percent into the
        # percussive part and can fake a weak beat, while real drums sit far above this
        hz = steady_tone(x, Sh, _seg_mask(music_segs, len(Sh)) & ~silent)
        if hz:
            # one pitch held the whole time (test tone, beep, mains hum): it passes the "loud and harmonic" bed test,
            # but there is no melody, no harmony and no beat, so it is not music
            music = {"present": False, "ratio": music["ratio"], "segments": music_segs[:40],
                     "steady_tone": {"hz": round(hz, 1), "segments": music_segs[:40]}}
    if music["present"]:
        beats = _tempo_and_beats(music, perc, perc90, music_segs)
        C = _chroma(Sh, freqs)
        mask = _seg_mask(music_segs, len(C))
        if mask.sum() > 50:
            music["key"] = _key(C[mask].mean(axis=0))
            music["section_changes"] = _section_changes(C, hb_db)
        music["start"] = music_segs[0][0] if music_segs else None
        music["end"] = music_segs[-1][1] if music_segs else None

    if voice.get("present") and music.get("present"):
        voice.update(vocal_style(x, Sh, freqs, speech_segs, beats))

    sfx = _sfx(S, freqs, perc, share, frame_db, peak_db, dur, speech_segs, music_segs, beats,
               sorted(set((cut_times or []) + (visual_marks or []))))

    # ---------------- editing vs audio -----------------------------------------------------
    out = {
        "has_audio": True, "duration": round(dur, 3),
        "rms_dbfs": round(float(20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)), 1),
        "peak_dbfs": round(float(20 * np.log10(np.abs(x).max() + 1e-9)), 1),
        "silence_ratio": round(float(silent.mean()), 3),
        "voice": voice, "music": music, "sfx": sfx,
        # compatibility keys used by the classifier / reports
        "speech_likely": voice["present"], "music_likely": music["present"], "tempo_bpm": music.get("tempo_bpm"),
    }
    onset = perc
    cuts = np.array([c for c in (cut_times or []) if c > 0.2])
    on = _peaks(onset, min_gap=int(0.1 / T_HOP), thr=float(np.percentile(onset, 80))) * T_HOP
    if len(cuts) and len(on):
        dmin = np.min(np.abs(cuts[:, None] - on[None, :]), axis=1)
        out["cuts_on_onset_ratio"] = round(float((dmin < 0.08).mean()), 3)
        out["cuts_on_onset_chance"] = round(float(min(1.0, len(on) / dur * 0.16)), 3)
    if len(cuts) and len(beats):
        db_ = np.min(np.abs(cuts[:, None] - beats[None, :]), axis=1)
        out["cuts_on_beat_ratio"] = round(float((db_ < 0.07).mean()), 3)
        chance = min(1.0, len(beats) / dur * 0.14)
        out["cuts_on_beat_chance"] = round(float(chance), 3)
        out["beat_synced_edit"] = bool(len(cuts) >= 4 and out["cuts_on_beat_ratio"] > max(0.5, chance * 1.8))
    else:
        out["beat_synced_edit"] = False
    out["energy_curve"] = [round(float(v), 1) for v in frame_db[:: max(1, int(0.5 / T_HOP))]]
    return out


def merge_audio_with_vlm(audio: dict, whole: dict | None) -> dict:
    """Combine measured audio facts with what the VLM heard; build a replication plan."""
    if not audio.get("has_audio"):
        return {"tracks": [], "plan": []}
    whole = whole or {}
    n = whole.get("narration") or {}
    m = whole.get("music") or {}
    vlm_sfx = [e for e in (whole.get("sfx") or []) if isinstance(e, dict)]
    det_sfx = (audio.get("sfx") or {}).get("events", [])
    sfx = [dict(e, source="vlm") for e in vlm_sfx]
    for e in det_sfx:
        if not any(abs(float(v.get("t", -9)) - e["t"]) < 0.25 for v in vlm_sfx):
            sfx.append(e)
    sfx.sort(key=lambda e: float(e.get("t", 0)))
    voice = audio.get("voice", {})
    music = audio.get("music", {})
    plan = []
    if voice.get("present") or n.get("type") in ("tts", "human", "mixed"):
        plan.append({"track": "voice", "rule": "A01-narration",
                     "what": ((T("TTS 旁白", "TTS voice-over") if n.get('type') == 'tts' else T("真人口播/对白", "human talking head / dialogue") if n.get('type') == 'human' else T("人声", "voice"))
                             + f"{T('，', ', ')}{n.get('voice') or voice.get('gender_hint') or ''}{T('，', ', ')}{n.get('style') or ''}").strip(T("，", ", ")),
                     "how": T("capsule-cinema DoubaoTTSTool / UniversalTTSTool（或 MiniMax 克隆音色）；需要卡原时间窗时用时长可控 TTS",
                              "capsule-cinema DoubaoTTSTool / UniversalTTSTool (or a MiniMax cloned voice); use duration-controlled TTS when it must fit the original time window"),
                     "segments": voice.get("segments", [])[:40], "lines": n.get("lines", [])[:60],
                     "real_material": n.get("type") == "human"})
    if music.get("present") or m.get("present"):
        src = m.get("source_guess") or "unknown"
        plan.append({"track": "music", "rule": "A03-music",
                     "what": semi().join(x for x in [m.get("style") or m.get("genre") or "", m.get("mood") or "",
                                                   (T("无明显节拍", "no clear beat") if music.get("no_beat") and not m.get("bpm_estimate")
                                                    else f"{music.get('tempo_bpm') or m.get('bpm_estimate') or '?'} BPM"),
                                                   (f"{music['key']['tonic']} {music['key']['mode']}" if music.get("key") else "")] if x),
                     "how": (T("疑似知名歌曲，需要授权或换成风格相近的授权曲/生成曲", "Possibly a well-known song: needs a licence, or swap in a licensed / generated track in a similar style") if src == "popular_song" else
                             T("capsule-cinema UniversalMusicGenerationTool（Suno）或曲库：按 BPM/调性/情绪选曲，在段落变化点对齐镜头",
                               "capsule-cinema UniversalMusicGenerationTool (Suno) or a stock library: pick by BPM / key / mood and line up the shots with the section changes")),
                     "segments": music.get("segments", []), "section_changes": music.get("section_changes", []),
                     "source_guess": src, "song_guess": m.get("song_guess", ""),
                     "beat_synced_cuts": bool(audio.get("beat_synced_edit") or m.get("beat_synced_cuts"))})
    if sfx:
        plan.append({"track": "sfx", "rule": "A04-sfx", "what": T("{n} 个音效", "{n} SFX", n=len(sfx)),
                     "how": T("按时间点摆放：capsule-cinema SoundEffectsTool / 音效库，或像 plush 配方那样程序合成（音高对齐 BGM 调性）",
                              "Place by timestamp: capsule-cinema SoundEffectsTool / an SFX library, or synthesise procedurally like the plush recipe (pitched to the music key)"),
                     "events": sfx[:200]})
    if whole.get("ambience"):
        plan.append({"track": "ambience", "rule": "A04-sfx", "what": whole["ambience"], "how": T("环境声素材或视频生音效模型", "Ambience stock or a video-to-audio model")})
    return {"sfx_merged": sfx[:300], "plan": plan, "mix": whole.get("mix", "")}


def refine_with_stems(audio: dict, vocals_wav: str) -> dict:
    """Re-measure the vocal style on the separated dry vocals (no BGM underneath, so pitch tracking is clean)."""
    voice = audio.get("voice") or {}
    segs = voice.get("segments") or []
    if not voice.get("present") or not segs:
        return audio
    x = extract_audio(vocals_wav, SR)
    if x is None or len(x) < SR:
        return audio
    Sh, _ = hpss(_stft(x))
    freqs = np.fft.rfftfreq(N_FFT, 1 / SR)
    beats = np.array((audio.get("music") or {}).get("beats") or [], float)
    st = vocal_style(x, Sh, freqs, segs, beats)
    if st:
        rep = vocal_repetition(x, freqs)
        st["chorus_repeat_share"] = rep
        if rep > 0.1 and st["style"] == "speech":  # repeated melodic lines = a song (rap included); narration does not repeat
            st["style"], st["sung"] = "rap_or_rhythmic", True
        voice.update(st)
        voice["style_measured_on"] = "vocals_stem"
    return audio


def vocal_repetition(x: np.ndarray, freqs: np.ndarray, win_s: float = 4.0, min_lag_s: float = 6.0) -> float:
    """Share of 4 s vocal windows whose pitch-class pattern recurs >= 6 s later (choruses / hooks).
    The clip's average pitch-class profile is removed first: one voice speaking keeps roughly the same
    profile the whole time, so without this every window of plain narration "matches" every other one.
    What is left is the melodic movement, which only repeats when a line is sung (or rapped) again."""
    S = _stft(x).astype(np.float64)
    C = _chroma(S, freqs).astype(np.float64)
    e = (S ** 2).sum(axis=1)
    blk = max(1, int(0.25 / T_HOP))
    n = len(C) // blk
    if n < 4 * win_s / 0.25:
        return 0.0
    C = C[:n * blk].reshape(n, blk, 12).mean(axis=1)
    E = 10 * np.log10(e[:n * blk].reshape(n, blk).mean(axis=1) + 1e-12)
    act = E > np.percentile(E, 95) - 30
    if not act.any():
        return 0.0
    C = C - C[act].mean(axis=0)
    W = int(win_s / 0.25)
    feats, idx = [], []
    for i in range(0, n - W, 2):
        if act[i:i + W].mean() < 0.6:
            continue
        f = C[i:i + W].ravel()
        feats.append((f - f.mean()) / (f.std() + 1e-9))
        idx.append(i)
    if len(feats) < 4:
        return 0.0
    F, idx = np.array(feats), np.array(idx)
    with np.errstate(all="ignore"):  # some BLAS builds raise spurious floating-point flags on large products
        sim = F @ F.T / F.shape[1]
    sim[np.abs(idx[:, None] - idx[None, :]) * 0.25 < min_lag_s] = -1
    return round(float((sim.max(axis=1) > 0.6).mean()), 3)
